import { createHash } from "node:crypto";
import { FieldPath, type Firestore, type Transaction } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { archiveInput, assertAssigned, assertEditable, assertVersion, collections, completionInput, contentVersion, detailInput, historyInput, initiativeInput, isManager, mergeMilestones, publicRow, scopeOf, settingsInput, statusInput, themeInput, translationFields, translationInput, updateInput, type Kind, type Milestone, type Row } from "./domain.js";

type Auth = { uid: string } | undefined;
type Context = { uid: string; profile: Row; scopeId: string; settings: Row; canManage: boolean; bootstrap: boolean };
export type BusinessDependencies = {
  db: Firestore;
  getAccount: (uid: string) => Promise<{ disabled: boolean }>;
  featureEnabled: () => boolean;
  now?: () => number;
  translate: (fields: Record<string, string>, sourceLocale: string, targetLocale: string, uid: string) => Promise<Record<string, string>>;
};

const PAGE_SIZE = 50;
const LIST_LIMIT = 500;
export function createBusinessService(deps: BusinessDependencies) {
  const { db } = deps;
  const now = deps.now ?? Date.now;
  function enabled() {
    if (!deps.featureEnabled()) throw new HttpsError("failed-precondition", "会社の取り組みは現在停止中です。");
  }
  async function authorize(auth: Auth, tx?: Transaction, mode: "normal" | "workspace" | "settings" = "normal"): Promise<Context> {
    enabled();
    if (!auth) throw new HttpsError("unauthenticated", "ログインが必要です。");
    let account: { disabled: boolean };
    try { account = await deps.getAccount(auth.uid); } catch { throw new HttpsError("permission-denied", "利用できないアカウントです。"); }
    if (account.disabled) throw new HttpsError("permission-denied", "利用できないアカウントです。");
    const profileRef = db.doc(`users/${auth.uid}`);
    const profileSnapshot = tx ? await tx.get(profileRef) : await profileRef.get();
    const profile = profileSnapshot.data();
    if (!profile || profile.active !== true) throw new HttpsError("permission-denied", "利用できないアカウントです。");
    const scopeId = scopeOf(profile);
    const settingsRef = db.doc(`businessSettings/${scopeId}`);
    const settingsSnapshot = tx ? await tx.get(settingsRef) : await settingsRef.get();
    const settings = settingsSnapshot.data() ?? { enabled: false, memberIds: [], version: 0 };
    const canManage = isManager(profile.role);
    const bootstrap = !settingsSnapshot.exists && canManage;
    if (!settings.memberIds.includes(auth.uid) && !(bootstrap && mode !== "normal")) throw new HttpsError("permission-denied", "共有メンバーだけが利用できます。");
    if (mode === "normal" && settings.enabled !== true) throw new HttpsError("failed-precondition", "会社の取り組みは現在停止中です。");
    if (mode === "settings" && !canManage) throw new HttpsError("permission-denied", "管理権限が必要です。");
    return { uid: auth.uid, profile, scopeId, settings, canManage, bootstrap };
  }
  function manage(ctx: Context) { if (!ctx.canManage) throw new HttpsError("permission-denied", "管理権限が必要です。"); }
  function scoped(snapshot: { exists: boolean; data(): Row | undefined }, ctx: Context): Row {
    if (!snapshot.exists) throw new HttpsError("not-found", "対象が見つかりません。");
    const row = snapshot.data()!;
    if (row.scopeId !== ctx.scopeId) throw new HttpsError("permission-denied", "対象を参照できません。");
    return row;
  }
  async function readEntity(kind: Kind, id: string, ctx: Context, tx?: Transaction): Promise<Row> {
    const ref = db.doc(`${collections[kind]}/${id}`);
    return scoped(tx ? await tx.get(ref) : await ref.get(), ctx);
  }
  async function activeParent(row: Row, ctx: Context, tx: Transaction) {
    assertEditable(await readEntity("theme", row.themeId, ctx, tx));
  }
  function history(tx: Transaction, ctx: Context, entityType: string, entityId: string, action: string, before: Row | null, after: Row, at: number) {
    const ref = db.collection("businessHistory").doc();
    tx.create(ref, { id: ref.id, scopeId: ctx.scopeId, entityType, entityId, action, actorId: ctx.uid, actorName: String(ctx.profile.displayName || ""), createdAt: at, before: before ? publicRow(before) : null, after: publicRow(after) });
  }
  const member = (uid: string, data: Row) => ({ uid, displayName: String(data.displayName || ""), role: String(data.role || "employee"), active: data.active === true });
  async function memberRows(ctx: Context) {
    const rows = await Promise.all(ctx.settings.memberIds.map(async (uid: string) => {
      const snapshot = await db.doc(`users/${uid}`).get();
      const profile = snapshot.data();
      return profile && scopeOf(profile) === ctx.scopeId ? member(uid, profile) : { uid, displayName: "", role: "employee", active: false };
    }));
    return rows;
  }
  async function getBusinessWorkspace(auth: Auth, _data: unknown) {
    const ctx = await authorize(auth, undefined, "workspace");
    const settings = { enabled: ctx.settings.enabled === true, memberIds: ctx.settings.memberIds, version: ctx.settings.version };
    const [members, candidateSnapshot] = await Promise.all([
      memberRows(ctx),
      ctx.canManage ? db.collection("users").limit(LIST_LIMIT + 1).get() : undefined
    ]);
    if (candidateSnapshot && candidateSnapshot.size > LIST_LIMIT) throw new HttpsError("resource-exhausted", "アカウント一覧が上限を超えています。管理担当者へ確認してください。");
    const memberCandidates = candidateSnapshot?.docs.filter((doc) => {
      const profile = doc.data();
      return profile.active === true && scopeOf(profile) === ctx.scopeId;
    }).map((doc) => member(doc.id, doc.data())) ?? [];
    let themes: Row[] = [];
    let initiatives: Row[] = [];
    if (settings.enabled) {
      const [themeSnapshot, initiativeSnapshot] = await Promise.all([
        db.collection("businessThemes").where("scopeId", "==", ctx.scopeId).limit(LIST_LIMIT + 1).get(),
        db.collection("businessInitiatives").where("scopeId", "==", ctx.scopeId).limit(LIST_LIMIT + 1).get()
      ]);
      if (themeSnapshot.size > LIST_LIMIT || initiativeSnapshot.size > LIST_LIMIT) throw new HttpsError("resource-exhausted", "取り組み一覧が上限を超えています。管理担当者へ確認してください。");
      themes = themeSnapshot.docs.map((doc) => publicRow(doc.data())).sort((a, b) => a.order - b.order);
      initiatives = initiativeSnapshot.docs.map((doc) => publicRow(doc.data()));
    }
    const current = await authorize(auth, undefined, "workspace");
    if (current.scopeId !== ctx.scopeId || current.settings.version !== settings.version || current.canManage !== ctx.canManage) throw new HttpsError("aborted", "共有設定が変更されました。再取得してください。");
    return { settings, canManage: ctx.canManage, members, memberCandidates, themes, initiatives, fetchedAt: now() };
  }
  function cursor(value?: string): [number, string] | undefined {
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
      if (!Array.isArray(parsed) || parsed.length !== 2 || !Number.isFinite(parsed[0]) || typeof parsed[1] !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(parsed[1])) throw new Error();
      return parsed as [number, string];
    } catch { throw new HttpsError("invalid-argument", "ページ情報が無効です。"); }
  }
  async function page(collection: string, ctx: Context, field: string, id: string, next?: string, entityType?: string) {
    let query = db.collection(collection).where("scopeId", "==", ctx.scopeId).where(field, "==", id);
    if (entityType) query = query.where("entityType", "==", entityType);
    query = query.orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc");
    const after = cursor(next);
    if (after) query = query.startAfter(...after);
    const snapshot = await query.limit(PAGE_SIZE + 1).get();
    const visible = snapshot.docs.slice(0, PAGE_SIZE);
    const last = visible.at(-1);
    return { rows: visible.map((doc) => publicRow(doc.data())), next: snapshot.size > PAGE_SIZE && last ? Buffer.from(JSON.stringify([last.data().createdAt, last.id])).toString("base64url") : null };
  }
  async function getBusinessInitiativeDetail(auth: Auth, data: unknown) {
    const input = detailInput.parse(data);
    const ctx = await authorize(auth);
    await readEntity("initiative", input.initiativeId, ctx);
    const [updates, entries] = await Promise.all([
      page("businessUpdates", ctx, "initiativeId", input.initiativeId, input.updatesCursor),
      page("businessHistory", ctx, "entityId", input.initiativeId, input.historyCursor, "initiative")
    ]);
    const current = await authorize(auth);
    if (current.scopeId !== ctx.scopeId) throw new HttpsError("permission-denied", "共有範囲が変更されました。");
    return { updates: updates.rows, history: entries.rows, nextUpdatesCursor: updates.next, nextHistoryCursor: entries.next, fetchedAt: now() };
  }
  async function getBusinessHistory(auth: Auth, data: unknown) {
    const input = historyInput.parse(data);
    const ctx = await authorize(auth);
    if (input.kind === "settings") manage(ctx);
    else await readEntity("theme", input.id, ctx);
    const entityId = input.kind === "settings" ? ctx.scopeId : input.id;
    const entries = await page("businessHistory", ctx, "entityId", entityId, input.cursor, input.kind);
    const current = await authorize(auth);
    if (current.scopeId !== ctx.scopeId) throw new HttpsError("permission-denied", "共有範囲が変更されました。");
    if (input.kind === "settings") manage(current);
    return { history: entries.rows.map((row) => input.kind === "settings" ? { ...row, entityId: "current" } : row), nextCursor: entries.next, fetchedAt: now() };
  }
  async function saveBusinessTheme(auth: Auth, data: unknown) {
    const { expectedVersion, ...input } = themeInput.parse(data);
    return db.runTransaction(async (tx) => {
      const ctx = await authorize(auth, tx); manage(ctx);
      const ref = db.doc(`businessThemes/${input.id}`);
      const snapshot = await tx.get(ref);
      const before = snapshot.exists ? scoped(snapshot, ctx) : undefined;
      assertVersion(before, expectedVersion);
      if (before) assertEditable(before);
      const at = now();
      const after: Row = { ...before, ...input, scopeId: ctx.scopeId, archived: false, version: expectedVersion + 1, createdAt: before?.createdAt ?? at, updatedAt: at, updatedBy: ctx.uid };
      after.contentVersion = contentVersion("theme", after);
      tx.set(ref, after); history(tx, ctx, "theme", input.id, before ? "edit" : "create", before ?? null, after, at);
      return { id: input.id, version: after.version };
    });
  }
  async function saveBusinessInitiative(auth: Auth, data: unknown) {
    const { expectedVersion, ...input } = initiativeInput.parse(data);
    return db.runTransaction(async (tx) => {
      const ctx = await authorize(auth, tx); manage(ctx);
      const ref = db.doc(`businessInitiatives/${input.id}`);
      const snapshot = await tx.get(ref);
      const before = snapshot.exists ? scoped(snapshot, ctx) : undefined;
      assertVersion(before, expectedVersion);
      if (before) assertEditable(before);
      assertEditable(await readEntity("theme", input.themeId, ctx, tx));
      for (const uid of input.assigneeIds) {
        if (!ctx.settings.memberIds.includes(uid)) throw new HttpsError("invalid-argument", "担当者は共有メンバーから選択してください。");
        const profile = (await tx.get(db.doc(`users/${uid}`))).data();
        if (!profile || profile.active !== true || scopeOf(profile) !== ctx.scopeId) throw new HttpsError("invalid-argument", "利用できない担当者です。");
        let account: { disabled: boolean };
        try { account = await deps.getAccount(uid); } catch { throw new HttpsError("invalid-argument", "担当者のアカウントを確認してください。"); }
        if (account.disabled) throw new HttpsError("invalid-argument", "停止中の担当者は指定できません。");
      }
      const at = now();
      const after: Row = { ...before, ...input, milestones: mergeMilestones(input.milestones, before?.milestones ?? [], ctx.uid, at), scopeId: ctx.scopeId, archived: false, version: expectedVersion + 1, createdAt: before?.createdAt ?? at, updatedAt: at, updatedBy: ctx.uid };
      after.contentVersion = contentVersion("initiative", after);
      tx.set(ref, after); history(tx, ctx, "initiative", input.id, before ? "edit" : "create", before ?? null, after, at);
      return { id: input.id, version: after.version };
    });
  }
  async function setBusinessArchived(auth: Auth, data: unknown) {
    const input = archiveInput.parse(data);
    return db.runTransaction(async (tx) => {
      const ctx = await authorize(auth, tx); manage(ctx);
      const before = await readEntity(input.kind, input.id, ctx, tx);
      if (before.archived === input.archived) return { id: input.id, version: before.version };
      assertVersion(before, input.expectedVersion);
      const at = now();
      const after = { ...before, archived: input.archived, version: before.version + 1, updatedAt: at, updatedBy: ctx.uid };
      tx.set(db.doc(`${collections[input.kind]}/${input.id}`), after);
      history(tx, ctx, input.kind, input.id, input.archived ? "archive" : "restore", before, after, at);
      return { id: input.id, version: after.version };
    });
  }
  async function postBusinessUpdate(auth: Auth, data: unknown) {
    const input = updateInput.parse(data);
    return db.runTransaction(async (tx) => {
      const ctx = await authorize(auth, tx);
      const initiative = await readEntity("initiative", input.initiativeId, ctx, tx);
      assertEditable(initiative); await activeParent(initiative, ctx, tx);
      const ref = db.doc(`businessUpdates/${input.id}`);
      const existing = await tx.get(ref);
      if (existing.exists) {
        const row = scoped(existing, ctx);
        if (row.authorId !== ctx.uid || row.initiativeId !== input.initiativeId || row.body !== input.body || row.sourceLocale !== input.sourceLocale) throw new HttpsError("already-exists", "投稿の識別子が使用されています。");
        return { id: input.id };
      }
      const at = now();
      const row: Row = { ...input, scopeId: ctx.scopeId, authorId: ctx.uid, authorName: String(ctx.profile.displayName || ""), createdAt: at };
      row.contentVersion = contentVersion("update", row);
      tx.create(ref, row);
      tx.update(db.doc(`businessInitiatives/${input.initiativeId}`), { latestUpdate: publicRow(row), updatedAt: at, updatedBy: ctx.uid });
      return { id: input.id };
    });
  }
  async function setBusinessStatus(auth: Auth, data: unknown) {
    const input = statusInput.parse(data);
    return db.runTransaction(async (tx) => {
      const ctx = await authorize(auth, tx);
      const before = await readEntity("initiative", input.initiativeId, ctx, tx);
      assertEditable(before); assertAssigned(before, ctx.uid, ctx.canManage); await activeParent(before, ctx, tx);
      if (before.status === input.status) return { id: input.initiativeId, version: before.version };
      assertVersion(before, input.expectedVersion);
      const at = now();
      const after = { ...before, status: input.status, version: before.version + 1, updatedAt: at, updatedBy: ctx.uid };
      tx.set(db.doc(`businessInitiatives/${input.initiativeId}`), after);
      history(tx, ctx, "initiative", input.initiativeId, "status", before, after, at);
      return { id: input.initiativeId, version: after.version };
    });
  }
  async function setBusinessMilestoneCompletion(auth: Auth, data: unknown) {
    const input = completionInput.parse(data);
    return db.runTransaction(async (tx) => {
      const ctx = await authorize(auth, tx);
      const before = await readEntity("initiative", input.initiativeId, ctx, tx);
      assertEditable(before); assertAssigned(before, ctx.uid, ctx.canManage); await activeParent(before, ctx, tx);
      const milestone = before.milestones.find((item: Milestone) => item.id === input.milestoneId);
      if (!milestone) throw new HttpsError("not-found", "節目が見つかりません。");
      assertEditable(milestone);
      // An uncertain-response retry may carry the old version; an already-applied
      // desired value is safe after rechecking current authorization and archive state.
      if (milestone.completed === input.completed) return { id: input.initiativeId, version: before.version };
      assertVersion(before, input.expectedVersion);
      const at = now();
      const milestones = before.milestones.map((item: Milestone) => item.id === input.milestoneId ? { ...item, completed: input.completed, updatedAt: at, updatedBy: ctx.uid } : item);
      const after = { ...before, milestones, version: before.version + 1, updatedAt: at, updatedBy: ctx.uid };
      tx.set(db.doc(`businessInitiatives/${input.initiativeId}`), after);
      history(tx, ctx, "initiative", input.initiativeId, "milestone_completion", before, after, at);
      return { id: input.initiativeId, version: after.version };
    });
  }
  async function saveBusinessSettings(auth: Auth, data: unknown) {
    const input = settingsInput.parse(data);
    return db.runTransaction(async (tx) => {
      const ctx = await authorize(auth, tx, "settings");
      assertVersion(ctx.settings, input.expectedVersion);
      if (!input.memberIds.includes(ctx.uid)) throw new HttpsError("invalid-argument", "操作する管理担当者を共有メンバーに含めてください。");
      const roles: string[] = [];
      for (const uid of input.memberIds) {
        const profile = (await tx.get(db.doc(`users/${uid}`))).data();
        if (!profile || profile.active !== true || scopeOf(profile) !== ctx.scopeId) throw new HttpsError("invalid-argument", "有効な同じ環境のアカウントを選択してください。");
        let account: { disabled: boolean };
        try { account = await deps.getAccount(uid); } catch { throw new HttpsError("invalid-argument", "アカウントを確認してください。"); }
        if (account.disabled) throw new HttpsError("invalid-argument", "停止中のアカウントは指定できません。");
        roles.push(String(profile.role));
      }
      if (!roles.includes("employee_manager") || !roles.includes("president_viewer")) throw new HttpsError("invalid-argument", "管理担当者と社長の両方を共有メンバーに含めてください。");
      const at = now();
      const after = { scopeId: ctx.scopeId, enabled: input.enabled, memberIds: input.memberIds, version: input.expectedVersion + 1, updatedAt: at, updatedBy: ctx.uid };
      tx.set(db.doc(`businessSettings/${ctx.scopeId}`), after);
      history(tx, ctx, "settings", ctx.scopeId, "settings", ctx.bootstrap ? null : ctx.settings, after, at);
      return { version: after.version };
    });
  }
  async function translateBusinessContent(auth: Auth, data: unknown) {
    const input = translationInput.parse(data);
    const ctx = await authorize(auth);
    const row = await readEntity(input.kind, input.id, ctx);
    const hash = contentVersion(input.kind, row);
    if (hash !== input.expectedContentVersion || row.contentVersion !== hash) throw new HttpsError("aborted", "原文が更新されました。最新の内容を取得してください。");
    const fields = translationFields(input.kind, row);
    const key = createHash("sha256").update(JSON.stringify([ctx.scopeId, hash, input.targetLocale])).digest("hex");
    const cacheRef = db.doc(`businessTranslations/${key}`);
    const cached = (await cacheRef.get()).data();
    const cachedFields = cached?.scopeId === ctx.scopeId && cached?.contentVersion === hash && cached?.targetLocale === input.targetLocale ? cached.fields : undefined;
    let result: Record<string, string>;
    if (cachedFields) result = cachedFields;
    else if (row.sourceLocale === input.targetLocale) result = fields;
    else {
      try { result = await deps.translate(fields, row.sourceLocale, input.targetLocale, ctx.uid); }
      catch { throw new HttpsError("unavailable", "翻訳できませんでした。原文は保存されています。再試行できます。"); }
    }
    const keys = Object.keys(fields).sort();
    if (!result || JSON.stringify(Object.keys(result).sort()) !== JSON.stringify(keys) || keys.some((name) => typeof result[name] !== "string" || result[name].length > 20000 || (fields[name].trim() && !result[name].trim()))) throw new HttpsError("unavailable", "翻訳結果を確認できませんでした。原文で表示し、再試行してください。");
    // This transaction is also mandatory on cache hits. It closes the window
    // where a removed member or changed source might receive a previous result.
    await db.runTransaction(async (tx) => {
      const current = await authorize(auth, tx);
      const latest = await readEntity(input.kind, input.id, current, tx);
      if (current.scopeId !== ctx.scopeId || latest.contentVersion !== hash || contentVersion(input.kind, latest) !== hash) throw new HttpsError("aborted", "原文が更新されました。古い翻訳は反映しません。");
      if (!cachedFields && row.sourceLocale !== input.targetLocale) tx.set(cacheRef, { scopeId: ctx.scopeId, contentVersion: hash, targetLocale: input.targetLocale, fields: result, createdAt: now() });
    });
    return { kind: input.kind, id: input.id, targetLocale: input.targetLocale, contentVersion: hash, fields: result, cached: Boolean(cachedFields) };
  }
  return { getBusinessWorkspace, getBusinessInitiativeDetail, getBusinessHistory, saveBusinessTheme, saveBusinessInitiative, setBusinessArchived, postBusinessUpdate, setBusinessStatus, setBusinessMilestoneCompletion, saveBusinessSettings, translateBusinessContent };
}
