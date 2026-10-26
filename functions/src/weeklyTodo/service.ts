import type { Firestore } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { requireWorkAuth, type PasswordAuthContext } from "../passwordChange.js";
import { carryoverKey, digest, documentId, historyInput, mutationInput, scopeOf, snapshot, translationInput, validateItems, weekDates, weekInput, type Row, type Snapshot, type TodoItem } from "./domain.js";
import { reportDateJst, reportInput, reportItemHash, reportLogs, reportable } from "./reportLink.js";
import { createWeeklyTodoCarryover } from "./carryover.js";

type Dependencies = {
  db: Firestore; getAccount: (uid: string) => Promise<{ disabled: boolean }>; now?: () => number;
  translate: (fields: Record<string, string>, source: string, target: string, uid: string) => Promise<Record<string, string>>;
};
export function createWeeklyTodoService({ db, getAccount, translate, now = Date.now }: Dependencies) {
  const carryover = createWeeklyTodoCarryover({ db, getAccount, now });
  async function authorize(auth: PasswordAuthContext | undefined) {
    const verified = await requireWorkAuth(auth, async uid => (await db.doc(`users/${uid}`).get()).data());
    const account = await getAccount(verified.uid);
    if (account.disabled) throw new HttpsError("permission-denied", "利用できないアカウントです。");
    const profile = (await db.doc(`users/${verified.uid}`).get()).data()!;
    return { uid: verified.uid, profile, scopeId: scopeOf(profile) };
  }
  function ref(scope: string, uid: string, week: string) { return db.doc(`weeklyTodoWeeks/${documentId(scope, uid, week)}`); }
  async function member(uid: string, scope: string) {
    const profile = (await db.doc(`users/${uid}`).get()).data();
    if (!profile?.active || !["employee", "employee_manager", "president_viewer"].includes(profile.role) || scopeOf(profile) !== scope) throw new HttpsError("permission-denied", "この共有内容を参照できません。");
    return profile;
  }
  function publicWeek(row: Row) {
    return { userId: row.userId, weekStart: row.weekStart, shared: row.shared || null, initial: row.initial || null, review: row.review || null, reviewRevision: row.reviewRevision ?? null };
  }
  async function getWeeklyTodoWorkspace(auth: PasswordAuthContext | undefined, data: unknown) {
    const { weekStart } = weekInput.parse(data); const dates = weekDates(weekStart); const ctx = await authorize(auth);
    await carryover.ensure(ctx.uid, weekStart);
    const users = await db.collection("users").where("active", "==", true).get();
    const members = users.docs.map(doc => ({ ...doc.data(), uid: doc.id } as Row)).filter(row => {
      try { return ["employee", "employee_manager", "president_viewer"].includes(row.role) && scopeOf(row) === ctx.scopeId; } catch { return false; }
    });
    const records = await Promise.all(members.map(async profile => ({ profile, row: (await ref(ctx.scopeId, profile.uid, weekStart).get()).data() })));
    const own = records.find(record => record.profile.uid === ctx.uid)?.row;
    // Explicit projections: private drafts never leave this API for other users.
    const weeks = records.filter(({ row }) => row?.shared).map(({ row }) => publicWeek(row!));
    const previous = new Date(`${weekStart}T00:00:00Z`); previous.setUTCDate(previous.getUTCDate() - 7);
    const previousStart = previous.toISOString().slice(0, 10);
    const previousRow = (await ref(ctx.scopeId, ctx.uid, previousStart).get()).data();
    const reportDate = reportDateJst(now());
    const reportItems: TodoItem[] = own?.draft?.items || own?.shared?.items || [];
    const reportLink = ctx.profile.role === "president_viewer" ? null : { reportDate, items: await Promise.all(reportItems.filter(item => reportDate >= weekStart && reportDate <= dates.weekEnd && reportable(item, own || {})).map(async item => {
      const logs = await Promise.all(reportLogs(ctx.scopeId, ctx.uid, weekStart, reportDate, item).map(log => db.doc(`workLogs/${log.id}`).get()));
      return { itemId: item.id, added: logs.every(log => log.exists) };
    })) };
    const current = await authorize(auth);
    if (current.scopeId !== ctx.scopeId) throw new HttpsError("permission-denied", "利用環境が変更されました。");
    return { ...dates, members: members.map(profile => ({ uid: profile.uid, displayName: profile.displayName || "", role: profile.role })), weeks,
      ownDraft: { items: own?.draft?.items || own?.shared?.items || [], version: own?.version || 0 }, reportLink, carryoverPending: own?.carryoverPending || [],
      carryover: (previousRow?.shared?.items || []).filter((item: TodoItem) => !item.withdrawn && item.progress < 100 && !(own?.carriedSources || []).includes(carryoverKey({ weekStart: previousStart, itemId: item.id }))).map((item: TodoItem) => ({ ...item, carriedFrom: { weekStart: previousStart, itemId: item.id } })), fetchedAt: now() };
  }
  async function mutate(auth: PasswordAuthContext | undefined, data: unknown, kind: "draft" | "share" | "review") {
    const input = mutationInput.parse(data); weekDates(input.weekStart); validateItems(input.items, kind); const ctx = await authorize(auth);
    return db.runTransaction(async tx => {
      const profile = (await tx.get(db.doc(`users/${ctx.uid}`))).data();
      if (!profile?.active || !["employee", "employee_manager", "president_viewer"].includes(profile.role) || scopeOf(profile) !== ctx.scopeId || profile.passwordChangeRequired || profile.passwordAuthTimeAfter !== ctx.profile.passwordAuthTimeAfter) throw new HttpsError("permission-denied", "アカウントの状態が変更されました。");
      const recordRef = ref(ctx.scopeId, ctx.uid, input.weekStart); const before = (await tx.get(recordRef)).data();
      if (before?.lastOperationId === input.operationId && before?.lastOperationHash === digest([kind, input.items])) return { version: before.version };
      if ((before?.version || 0) !== input.expectedVersion) throw new HttpsError("aborted", "他の画面で更新されています。入力を保持して最新内容と比較してください。");
      const oldItems: TodoItem[] = before?.shared?.items || [];
      // Shared items must remain traceable; withdrawal replaces destructive removal.
      if (oldItems.some(old => !input.items.some(item => item.id === old.id))) throw new HttpsError("invalid-argument", "共有済みの項目は削除せず取り下げてください。");
      const oldDraft: TodoItem[] = before?.draft?.items || [];
      const known = new Map([...oldItems, ...oldDraft].map(item => [item.id, item]));
      const reportableItems = input.items.filter(item => before?.reportableItems?.includes(item.id) || (known.has(item.id) && reportItemHash(known.get(item.id)!) !== reportItemHash(item))).map(item => item.id);
      for (const item of input.items) {
        const existing = known.get(item.id);
        if (existing && carryoverKey(existing.carriedFrom) !== carryoverKey(item.carriedFrom)) throw new HttpsError("invalid-argument", "引き継ぎ元は変更できません。");
        if (!item.carriedFrom || existing) continue;
        const previous = new Date(`${input.weekStart}T00:00:00Z`); previous.setUTCDate(previous.getUTCDate() - 7);
        if (item.carriedFrom.weekStart !== previous.toISOString().slice(0, 10)) throw new HttpsError("invalid-argument", "前週の項目を選んでください。");
        const source = (await tx.get(ref(ctx.scopeId, ctx.uid, item.carriedFrom.weekStart))).data();
        if (!source?.shared?.items.some((old: TodoItem) => old.id === item.carriedFrom!.itemId && !old.withdrawn && old.progress < 100)) throw new HttpsError("invalid-argument", "引き継ぎ元を確認してください。");
      }
      const used = new Set<string>(before?.carriedSources || []);
      for (const item of input.items) if (item.carriedFrom && !known.has(item.id)) {
        const key = carryoverKey(item.carriedFrom);
        if (used.has(key)) throw new HttpsError("invalid-argument", "この項目は取り込み済みです。");
        used.add(key);
      }
      const at = now(); const version = input.expectedVersion + 1;
      const after: Row = { ...(before || {}), scopeId: ctx.scopeId, userId: ctx.uid, weekStart: input.weekStart, version, draft: { items: input.items, at }, updatedAt: at, lastOperationId: input.operationId, lastOperationHash: digest([kind, input.items]), carriedSources: [...used], reportableItems };
      // Clicking share without changing the content must not make a completed
      // reflection appear outdated. Explicit reflection submissions still record time.
      if (kind !== "draft" && (kind === "review" || before?.shared?.contentVersion !== digest(input.items))) {
        const next = snapshot(input.items, (before?.shared?.revision || 0) + 1, at);
        after.shared = next; after.initial = before?.initial || next;
        if (kind === "review") { after.review = next; after.reviewRevision = next.revision; }
        tx.create(db.doc(`weeklyTodoHistory/${documentId(ctx.scopeId, ctx.uid, input.weekStart)}_${String(next.revision).padStart(8, "0")}`), { scopeId: ctx.scopeId, userId: ctx.uid, weekStart: input.weekStart, kind, snapshot: next });
      }
      tx.set(recordRef, after); return { version };
    });
  }
  async function addWeeklyTodoToDailyReport(auth: PasswordAuthContext | undefined, data: unknown) {
    const input = reportInput.parse(data); const dates = weekDates(input.weekStart); const ctx = await authorize(auth);
    return db.runTransaction(async tx => {
      const profile = (await tx.get(db.doc(`users/${ctx.uid}`))).data();
      await requireWorkAuth(auth, async () => profile);
      if (!profile || profile.role === "president_viewer" || scopeOf(profile) !== ctx.scopeId || profile.passwordAuthTimeAfter !== ctx.profile.passwordAuthTimeAfter) throw new HttpsError("permission-denied", "本人の日報に追加できるアカウントで操作してください。");
      const at = now(); const reportDate = reportDateJst(at);
      if (input.reportDate !== reportDate) throw new HttpsError("failed-precondition", "日付が変わりました。再読み込みして本日の日報に追加してください。", { reason: "report-date-changed" });
      if (reportDate < input.weekStart || reportDate > dates.weekEnd) throw new HttpsError("failed-precondition", "今週の業務だけを本日の日報に追加できます。", { reason: "report-week-not-current" });
      const row = (await tx.get(ref(ctx.scopeId, ctx.uid, input.weekStart))).data();
      if (!row || row.version !== input.expectedVersion) throw new HttpsError("aborted", "To Doが更新されています。入力を保持して最新内容を確認してください。");
      const item: TodoItem | undefined = (row.draft?.items || row.shared?.items || []).find((item: TodoItem) => item.id === input.itemId);
      if (!item || !reportable(item, row)) throw new HttpsError("invalid-argument", "更新済みの業務を選んでください。");
      if (profile.isDemo === true && !profile.seedVersion) throw new HttpsError("failed-precondition", "デモ環境の設定を確認してください。");
      const logs = reportLogs(ctx.scopeId, ctx.uid, input.weekStart, reportDate, item);
      const existing = await Promise.all(logs.map(log => tx.get(db.doc(`workLogs/${log.id}`))));
      for (const log of existing) if (log.exists && (log.data()?.userId !== ctx.uid || scopeOf(log.data()!) !== ctx.scopeId || log.data()?.workDate !== reportDate)) throw new HttpsError("permission-denied", "追加先を確認できません。");
      let addedCount = 0;
      logs.forEach((log, index) => {
        if (existing[index].exists) return;
        tx.create(db.doc(`workLogs/${log.id}`), { userId: ctx.uid, userName: profile.displayName || "", workDate: reportDate, tagId: "weekly_todo", tagLabel: log.tagLabel, text: log.text, attachments: [],
          ...(profile.isDemo === true ? { isDemo: true, demoDatasetId: profile.demoDatasetId, seedVersion: profile.seedVersion } : {}),
          createdAt: Timestamp.fromMillis(at), updatedAt: Timestamp.fromMillis(at) });
        addedCount++;
      });
      return { reportDate, addedCount, alreadyAdded: addedCount === 0 };
    });
  }
  async function getWeeklyTodoHistory(auth: PasswordAuthContext | undefined, data: unknown) {
    const input = historyInput.parse(data); weekDates(input.weekStart); const ctx = await authorize(auth); await member(input.userId, ctx.scopeId);
    const prefix = documentId(ctx.scopeId, input.userId, input.weekStart);
    const row = (await ref(ctx.scopeId, input.userId, input.weekStart).get()).data();
    const max = row?.shared?.revision || 0; const end = input.cursor ? Number(input.cursor) : max;
    if (!Number.isSafeInteger(end) || end < 0 || end > max) throw new HttpsError("invalid-argument", "履歴の位置を確認してください。");
    const revisions = Array.from({ length: Math.min(10, end) }, (_, i) => end - i);
    const rows = await Promise.all(revisions.map(async revision => (await db.doc(`weeklyTodoHistory/${prefix}_${String(revision).padStart(8, "0")}`).get()).data()));
    const current = await authorize(auth); await member(input.userId, current.scopeId);
    if (current.scopeId !== ctx.scopeId) throw new HttpsError("permission-denied", "利用環境が変更されました。");
    return { history: rows.filter(Boolean).map(row => ({ kind: row!.kind, snapshot: row!.snapshot })), cursor: end > 10 ? String(end - 10) : null };
  }
  async function translateWeeklyTodoContent(auth: PasswordAuthContext | undefined, data: unknown) {
    const input = translationInput.parse(data); weekDates(input.weekStart); const ctx = await authorize(auth); await member(input.userId, ctx.scopeId);
    const historyRef = db.doc(`weeklyTodoHistory/${documentId(ctx.scopeId, input.userId, input.weekStart)}_${String(input.revision).padStart(8, "0")}`);
    const content: Snapshot | undefined = (await historyRef.get()).data()?.snapshot;
    if (!content || content.contentVersion !== input.contentVersion) throw new HttpsError("aborted", "原文が更新されています。最新内容を取得してください。");
    const cacheRef = db.doc(`weeklyTodoTranslations/${digest([ctx.scopeId, ctx.uid, input.userId, input.contentVersion, input.targetLocale])}`);
    const cached = (await cacheRef.get()).data(); let fields: Record<string, string> = cached?.fields || {};
    if (!cached) {
      fields = {};
      for (const source of ["ja", "zh-CN"]) {
        const group: Record<string, string> = {};
        for (const item of content.items) {
          if (item.sourceLocale === source) { group[`${item.id}:title`] = item.title; group[`${item.id}:goal`] = item.goal; }
          if (item.memoLocale === source) group[`${item.id}:memo`] = item.memo;
        }
        if (!Object.keys(group).length) continue;
        let result: Record<string, string>;
        try { result = source === input.targetLocale ? group : await translate(group, source, input.targetLocale, ctx.uid); }
        catch { throw new HttpsError("unavailable", "翻訳できませんでした。原文を表示しています。"); }
        if (!result || digest(Object.keys(result).sort()) !== digest(Object.keys(group).sort()) || Object.keys(group).some(key => typeof result[key] !== "string" || result[key].length > 12000 || (group[key] && !result[key].trim()))) throw new HttpsError("unavailable", "翻訳結果を確認できませんでした。");
        Object.assign(fields, result);
      }
    }
    const current = await authorize(auth); await member(input.userId, current.scopeId);
    if (current.scopeId !== ctx.scopeId) throw new HttpsError("permission-denied", "利用環境が変更されました。");
    const latest = (await historyRef.get()).data()?.snapshot;
    if (latest?.contentVersion !== input.contentVersion) throw new HttpsError("aborted", "原文が更新されました。");
    if (!cached) await cacheRef.set({ fields, createdAt: now() });
    return { fields, contentVersion: input.contentVersion, targetLocale: input.targetLocale };
  }
  return { getWeeklyTodoWorkspace, getWeeklyTodoHistory, saveWeeklyTodoDraft: (auth: PasswordAuthContext | undefined, data: unknown) => mutate(auth, data, "draft"), shareWeeklyTodo: (auth: PasswordAuthContext | undefined, data: unknown) => mutate(auth, data, "share"), shareWeeklyTodoReview: (auth: PasswordAuthContext | undefined, data: unknown) => mutate(auth, data, "review"), translateWeeklyTodoContent, addWeeklyTodoToDailyReport };
}
