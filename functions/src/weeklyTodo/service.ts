import type { Firestore, Transaction } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { requireWorkAuth, type PasswordAuthContext } from "../passwordChange.js";
import { addBusinessMilestonesInput, businessLinkKey, digest, documentId, historyInput, mutationInput, reportBusinessCompletionInput, scopeOf, snapshot, translationInput, validateItems, weekDates, weekInput, type Row, type Snapshot, type TodoItem } from "./domain.js";
import { reportDateJst, reportInput, reportItemHash, reportLogs, reportable } from "./reportLink.js";
import { activeMilestone, canReadLinkedWeeklyTodo, readLinkedInitiative, writeLinkedCompletion } from "./businessLink.js";

type Dependencies = {
  db: Firestore; getAccount: (uid: string) => Promise<{ disabled: boolean }>; now?: () => number;
  businessEnabled?: () => boolean;
  translate: (fields: Record<string, string>, source: string, target: string, uid: string) => Promise<Record<string, string>>;
};
export function createWeeklyTodoService({ db, getAccount, translate, now = Date.now, businessEnabled = () => false }: Dependencies) {
  async function authorize(auth: PasswordAuthContext | undefined) {
    const verified = await requireWorkAuth(auth, async uid => (await db.doc(`users/${uid}`).get()).data());
    const account = await getAccount(verified.uid);
    if (account.disabled) throw new HttpsError("permission-denied", "利用できないアカウントです。");
    const profile = (await db.doc(`users/${verified.uid}`).get()).data()!;
    return { uid: verified.uid, profile, scopeId: scopeOf(profile) };
  }
  function ref(scope: string, uid: string, week: string) { return db.doc(`weeklyTodoWeeks/${documentId(scope, uid, week)}`); }
  async function currentProfile(tx: Transaction, ctx: Awaited<ReturnType<typeof authorize>>) {
    const profile = (await tx.get(db.doc(`users/${ctx.uid}`))).data();
    if (!profile?.active || !["employee", "employee_manager", "president_viewer"].includes(profile.role) || scopeOf(profile) !== ctx.scopeId || profile.passwordChangeRequired || profile.passwordAuthTimeAfter !== ctx.profile.passwordAuthTimeAfter) throw new HttpsError("permission-denied", "アカウントの状態が変更されました。");
    return profile;
  }
  async function member(uid: string, scope: string) {
    const profile = (await db.doc(`users/${uid}`).get()).data();
    if (!profile?.active || !["employee", "employee_manager", "president_viewer"].includes(profile.role) || scopeOf(profile) !== scope) throw new HttpsError("permission-denied", "この共有内容を参照できません。");
    return profile;
  }
  function visibleSnapshot(value: Snapshot | null | undefined, canRead: boolean) {
    return value && !canRead ? { ...value, items: value.items.filter(item => !item.businessLink) } : value || null;
  }
  function publicWeek(row: Row, canRead: boolean) {
    return { userId: row.userId, weekStart: row.weekStart, shared: visibleSnapshot(row.shared, canRead), initial: visibleSnapshot(row.initial, canRead), review: visibleSnapshot(row.review, canRead), reviewRevision: row.reviewRevision ?? null };
  }
  async function addBusinessMilestonesToWeeklyTodo(auth: PasswordAuthContext | undefined, data: unknown) {
    const input = addBusinessMilestonesInput.parse(data);
    const dates = weekDates(input.weekStart);
    const ctx = await authorize(auth);
    return db.runTransaction(async tx => {
      const profile = await currentProfile(tx, ctx);
      const at = now();
      const today = reportDateJst(at);
      if (today < dates.weekStart || today > dates.weekEnd) throw new HttpsError("failed-precondition", "週が変わりました。今週の予定を確認してください。", { reason: "linked-todo-week-changed" });
      const { initiative } = await readLinkedInitiative(db, tx, ctx.uid, profile, input.initiativeId, businessEnabled());
      const recordRef = ref(ctx.scopeId, ctx.uid, input.weekStart);
      const before = (await tx.get(recordRef)).data();
      const items: TodoItem[] = before?.draft?.items || before?.shared?.items || [];
      const selected = input.milestoneIds.map(milestoneId => {
        const milestone = activeMilestone(initiative, milestoneId);
        const existing = items.find(item => item.businessLink?.initiativeId === input.initiativeId && item.businessLink.milestoneId === milestoneId);
        if (existing) return { item: existing, existing: true };
        if (milestone.completed || initiative.status === "completed") throw new HttpsError("failed-precondition", "すでに完了した項目は追加できません。", { reason: "linked-milestone-unavailable" });
        const businessLink = { initiativeId: input.initiativeId, milestoneId, initiativeName: initiative.name, milestoneName: milestone.name };
        const item: TodoItem = {
          id: businessLinkKey(businessLink), title: milestone.name, goal: milestone.name, progress: 0, memo: "",
          sourceLocale: initiative.sourceLocale, memoLocale: initiative.sourceLocale, withdrawn: false, businessLink
        };
        return { item, existing: false };
      });
      const additions = selected.filter(row => !row.existing).map(row => row.item);
      const result = { itemIds: selected.map(row => row.item.id), addedCount: additions.length };
      if (!additions.length) return result;
      if (initiative.version !== input.expectedInitiativeVersion) throw new HttpsError("aborted", "取り組みが更新されています。最新情報を取得してください。");
      const nextItems = [...items, ...additions];
      if (nextItems.length > 30) throw new HttpsError("resource-exhausted", "今週のTo Doは30件までです。", { reason: "linked-todo-limit" });
      validateItems(nextItems, "draft");
      const { lastOperationId: _lastId, lastOperationHash: _lastHash, ...previous } = before || {};
      tx.set(recordRef, { ...previous, scopeId: ctx.scopeId, userId: ctx.uid, weekStart: input.weekStart, version: (before?.version || 0) + 1, draft: { items: nextItems, at }, updatedAt: at });
      return result;
    });
  }
  async function getWeeklyTodoWorkspace(auth: PasswordAuthContext | undefined, data: unknown) {
    const { weekStart } = weekInput.parse(data); const dates = weekDates(weekStart); const ctx = await authorize(auth);
    const users = await db.collection("users").where("active", "==", true).get();
    const members = users.docs.map(doc => ({ ...doc.data(), uid: doc.id } as Row)).filter(row => {
      try { return ["employee", "employee_manager", "president_viewer"].includes(row.role) && scopeOf(row) === ctx.scopeId; } catch { return false; }
    });
    const records = await Promise.all(members.map(async profile => ({ profile, row: (await ref(ctx.scopeId, profile.uid, weekStart).get()).data() })));
    const own = records.find(record => record.profile.uid === ctx.uid)?.row;
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
    // Linked tasks follow company-initiative membership in shared views.
    const canRead = await canReadLinkedWeeklyTodo(db, ctx.uid, current.profile, businessEnabled());
    const weeks = records.filter(({ row }) => row?.shared).map(({ row }) => publicWeek(row!, canRead)).filter(row => row.shared?.items.length);
    return { ...dates, members: members.map(profile => ({ uid: profile.uid, displayName: profile.displayName || "", role: profile.role })), weeks,
      ownDraft: { items: own?.draft?.items || own?.shared?.items || [], version: own?.version || 0 }, reportLink,
      carryover: (previousRow?.shared?.items || []).filter((item: TodoItem) => !item.withdrawn && item.progress < 100 && !(own?.carriedSources || []).includes(digest({ weekStart: previousStart, itemId: item.id }))).map((item: TodoItem) => ({ ...item, carriedFrom: { weekStart: previousStart, itemId: item.id } })), fetchedAt: now() };
  }
  async function mutate(auth: PasswordAuthContext | undefined, data: unknown, kind: "draft" | "share" | "review" | "completion") {
    const report = kind === "completion" ? reportBusinessCompletionInput.parse(data) : undefined;
    const input = report || mutationInput.parse(data);
    const dates = weekDates(input.weekStart);
    validateItems(input.items, kind === "completion" ? "draft" : kind);
    const ctx = await authorize(auth);
    const operationHash = digest(report ? [kind, report] : [kind, input.items]);
    return db.runTransaction(async tx => {
      const profile = await currentProfile(tx, ctx);
      const recordRef = ref(ctx.scopeId, ctx.uid, input.weekStart); const before = (await tx.get(recordRef)).data();
      if (before?.lastOperationId === input.operationId && before?.lastOperationHash === operationHash) {
        return { version: before.version, ...(report ? { items: before.draft.items } : {}) };
      }
      if ((before?.version || 0) !== input.expectedVersion) throw new HttpsError("aborted", "他の画面で更新されています。入力を保持して最新内容と比較してください。");
      const oldItems: TodoItem[] = before?.shared?.items || [];
      // Shared items must remain traceable; withdrawal replaces destructive removal.
      if (oldItems.some(old => !input.items.some(item => item.id === old.id))) throw new HttpsError("invalid-argument", "共有済みの項目は削除せず取り下げてください。");
      const oldDraft: TodoItem[] = before?.draft?.items || [];
      const known = new Map([...oldItems, ...oldDraft].map(item => [item.id, item]));
      const reportableItems = input.items.filter(item => before?.reportableItems?.includes(item.id) || (known.has(item.id) && reportItemHash(known.get(item.id)!) !== reportItemHash(item))).map(item => item.id);
      for (const item of input.items) {
        const existing = known.get(item.id);
        if (existing) {
          if (digest(existing.carriedFrom || null) !== digest(item.carriedFrom || null) || digest(existing.businessLink || null) !== digest(item.businessLink || null) || digest(existing.businessCompletion || null) !== digest(item.businessCompletion || null)) {
            throw new HttpsError("invalid-argument", "元の取り組みと完了報告は変更できません。");
          }
          if (existing.businessCompletion && (item.withdrawn || reportItemHash(existing) !== reportItemHash(item))) {
            throw new HttpsError("failed-precondition", "完了報告を取り消してから編集してください。", { reason: "linked-todo-reopen-first" });
          }
          continue;
        }
        if (item.businessCompletion || (item.businessLink && !item.carriedFrom)) throw new HttpsError("invalid-argument", "元の取り組みから追加してください。");
        if (!item.carriedFrom) continue;
        const previous = new Date(`${input.weekStart}T00:00:00Z`); previous.setUTCDate(previous.getUTCDate() - 7);
        if (item.carriedFrom.weekStart !== previous.toISOString().slice(0, 10)) throw new HttpsError("invalid-argument", "前週の項目を選んでください。");
        const source = (await tx.get(ref(ctx.scopeId, ctx.uid, item.carriedFrom.weekStart))).data();
        const previousItem: TodoItem | undefined = source?.shared?.items.find((old: TodoItem) => old.id === item.carriedFrom!.itemId && !old.withdrawn && old.progress < 100);
        if (!previousItem || digest(previousItem.businessLink || null) !== digest(item.businessLink || null)) throw new HttpsError("invalid-argument", "引き継ぎ元を確認してください。");
      }
      const used = new Set<string>(before?.carriedSources || []);
      for (const item of input.items) if (item.carriedFrom && !known.has(item.id)) {
        const key = digest(item.carriedFrom);
        if (used.has(key)) throw new HttpsError("invalid-argument", "この項目は取り込み済みです。");
        used.add(key);
      }
      const at = now(); const version = input.expectedVersion + 1;
      let draftItems = input.items;
      let sharedItems = input.items;
      if (report) {
        if (reportDateJst(at) < dates.weekStart) throw new HttpsError("failed-precondition", "将来の週は完了報告できません。");
        const item = input.items.find(row => row.id === report.itemId);
        if (!item?.businessLink || item.withdrawn || !item.title || !item.goal || Boolean(item.businessCompletion) !== (report.action === "reopen") || (report.action === "reopen" && report.completeMilestone)) {
          throw new HttpsError("invalid-argument", "報告する業務を確認してください。");
        }
        const linked = await readLinkedInitiative(db, tx, ctx.uid, profile, item.businessLink.initiativeId, businessEnabled());
        const reportId = digest([ctx.scopeId, ctx.uid, input.weekStart, item.id, input.operationId]);
        const next = writeLinkedCompletion(db, tx, linked, { uid: ctx.uid, name: profile.displayName || "", item, link: item.businessLink, weekStart: input.weekStart, reportId, at, completeMilestone: report.completeMilestone, action: report.action, reportLocale: report.reportLocale });
        draftItems = input.items.map(row => row.id === item.id ? next : row);
        // Completing one task must never share the other unsent draft edits.
        sharedItems = oldItems.some(row => row.id === item.id) ? oldItems.map(row => row.id === item.id ? next : row) : [...oldItems, next];
        validateItems(draftItems, "draft");
        validateItems(sharedItems, "share");
        if (!reportableItems.includes(item.id)) reportableItems.push(item.id);
      }
      const after: Row = { ...(before || {}), scopeId: ctx.scopeId, userId: ctx.uid, weekStart: input.weekStart, version, draft: { items: draftItems, at }, updatedAt: at, lastOperationId: input.operationId, lastOperationHash: operationHash, carriedSources: [...used], reportableItems };
      // Clicking share without changing the content must not make a completed
      // reflection appear outdated. Explicit reflection submissions still record time.
      if (kind !== "draft" && (kind === "review" || before?.shared?.contentVersion !== digest(sharedItems))) {
        const next = snapshot(sharedItems, (before?.shared?.revision || 0) + 1, at);
        after.shared = next; after.initial = before?.initial || next;
        if (kind === "review") { after.review = next; after.reviewRevision = next.revision; }
        tx.create(db.doc(`weeklyTodoHistory/${documentId(ctx.scopeId, ctx.uid, input.weekStart)}_${String(next.revision).padStart(8, "0")}`), { scopeId: ctx.scopeId, userId: ctx.uid, weekStart: input.weekStart, kind: report ? "share" : kind, snapshot: next });
      }
      tx.set(recordRef, after); return { version, ...(report ? { items: draftItems } : {}) };
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
    const canRead = await canReadLinkedWeeklyTodo(db, ctx.uid, current.profile, businessEnabled());
    return { history: rows.flatMap(row => {
      const visible = visibleSnapshot(row?.snapshot, canRead);
      return visible?.items.length ? [{ kind: row!.kind, snapshot: visible }] : [];
    }), cursor: end > 10 ? String(end - 10) : null };
  }
  async function translateWeeklyTodoContent(auth: PasswordAuthContext | undefined, data: unknown) {
    const input = translationInput.parse(data); weekDates(input.weekStart); const ctx = await authorize(auth); await member(input.userId, ctx.scopeId);
    const historyRef = db.doc(`weeklyTodoHistory/${documentId(ctx.scopeId, input.userId, input.weekStart)}_${String(input.revision).padStart(8, "0")}`);
    const content: Snapshot | undefined = (await historyRef.get()).data()?.snapshot;
    if (!content || content.contentVersion !== input.contentVersion) throw new HttpsError("aborted", "原文が更新されています。最新内容を取得してください。");
    const linked = content.items.some(item => item.businessLink);
    const canRead = linked && await canReadLinkedWeeklyTodo(db, ctx.uid, ctx.profile, businessEnabled());
    const items = visibleSnapshot(content, canRead)!.items;
    const cacheRef = db.doc(`weeklyTodoTranslations/${digest([ctx.scopeId, ctx.uid, input.userId, input.contentVersion, input.targetLocale, ...(linked ? [canRead] : [])])}`);
    const cached = (await cacheRef.get()).data(); let fields: Record<string, string> = cached?.fields || {};
    if (!cached) {
      fields = {};
      for (const source of ["ja", "zh-CN"]) {
        const group: Record<string, string> = {};
        for (const item of items) {
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
    if (canRead && !await canReadLinkedWeeklyTodo(db, ctx.uid, current.profile, businessEnabled())) throw new HttpsError("permission-denied", "共有設定が変更されました。");
    const latest = (await historyRef.get()).data()?.snapshot;
    if (latest?.contentVersion !== input.contentVersion) throw new HttpsError("aborted", "原文が更新されました。");
    if (!cached) await cacheRef.set({ fields, createdAt: now() });
    return { fields, contentVersion: input.contentVersion, targetLocale: input.targetLocale };
  }
  return { getWeeklyTodoWorkspace, getWeeklyTodoHistory, saveWeeklyTodoDraft: (auth: PasswordAuthContext | undefined, data: unknown) => mutate(auth, data, "draft"), shareWeeklyTodo: (auth: PasswordAuthContext | undefined, data: unknown) => mutate(auth, data, "share"), shareWeeklyTodoReview: (auth: PasswordAuthContext | undefined, data: unknown) => mutate(auth, data, "review"), translateWeeklyTodoContent, addWeeklyTodoToDailyReport, addBusinessMilestonesToWeeklyTodo, reportLinkedWeeklyTodoCompletion: (auth: PasswordAuthContext | undefined, data: unknown) => mutate(auth, data, "completion") };
}
