// Run only against disposable local emulators. Never uses a real project/key.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const functionsRequire = createRequire(path.resolve(__dirname, '../functions/package.json'));
const { initializeApp, deleteApp } = functionsRequire('firebase-admin/app');
const { getFirestore } = functionsRequire('firebase-admin/firestore');
const { getAuth } = functionsRequire('firebase-admin/auth');
const { createBusinessService } = require('../functions/lib/business/service.js');

const projectId = 'demo-kintai-business';
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  assert.match(process.env[name] || '', /^(127\.0\.0\.1|localhost):\d+$/, 'Local emulator required');
}
assert.equal(process.env.GCLOUD_PROJECT, projectId, 'Dedicated disposable project required');
const app = initializeApp({ projectId });
const db = getFirestore(app);
const auth = getAuth(app);
const results = [];
let enabled = true;
let translations = 0;
let translationImpl = async fields => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v ? `译文:${v}` : '']));
const service = createBusinessService({ db, getAccount: uid => auth.getUser(uid), featureEnabled: () => enabled, translate: async fields => { translations++; return translationImpl(fields); } });
const actor = uid => ({ uid });
const theme = (id, name = '架空の販売基盤') => ({ id, expectedVersion: 0, name, description: '検証専用・実業務ではありません', sourceLocale: 'ja', order: 10, referenceLinks: [] });
const initiative = (id, themeId) => ({ id, expectedVersion: 0, themeId, name: '架空の倉庫準備', description: '検証用', sourceLocale: 'ja', referenceLinks: [], assigneeIds: ['business-fang'], status: 'not_started', plannedStartMonth: '2026-12', plannedEndMonth: '2027-02', targetMemo: '年越しの予定', milestones: [{ id: 'stable-first', name: '見積確認', order: 0, archived: false }, { id: 'stable-second', name: '契約確認', order: 1, archived: false }] });
const read = async (collection, id) => (await db.doc(`${collection}/${id}`).get()).data();
const reject = (promise, code) => assert.rejects(promise, e => e.code === code);
async function check(name, fn) { await fn(); results.push({ name, passed: true }); }
function gateTranslation() {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  translationImpl = async fields => { started(); await gate; return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value ? `译文:${value}` : ''])); };
  return { ready, release: () => release() };
}
async function main() {
  const profiles = [
    ['business-yasushi', 'ヤスシ（検証）', 'employee_manager'],
    ['business-president', '社長（検証）', 'president_viewer'],
    ['business-fang', '方（検証）', 'employee'],
    ['business-outsider', '共有対象外（検証）', 'employee']
  ];
  for (const [uid, displayName, role] of profiles) {
    await auth.createUser({ uid, displayName, email: `${uid}@example.test`, password: 'Local-test-only-2026!' });
    await auth.setCustomUserClaims(uid, { role });
    await db.doc(`users/${uid}`).set({ uid, displayName, role, email: `${uid}@example.test`, active: true, locale: 'ja' });
  }
  const manager = actor('business-yasushi'), president = actor('business-president'), employee = actor('business-fang');
  await db.doc('workLogs/untouched').set({ userId: employee.uid, text: 'private original memo', updatedAt: 12345, attachments: [{ name: 'private.pdf' }] });
  const memoBefore = await read('workLogs', 'untouched');
  await check('bootstrap visible to both administrators, not employee', async () => {
    for (const admin of [manager, president]) { const w = await service.getBusinessWorkspace(admin, {}); assert.equal(w.canManage, true); assert.equal(w.settings.version, 0); assert.equal(w.memberCandidates.length, 4); }
    await reject(service.getBusinessWorkspace(employee, {}), 'permission-denied');
  });
  await service.saveBusinessSettings(president, { expectedVersion: 0, enabled: true, memberIds: [manager.uid, president.uid, employee.uid] });
  await check('no automatic enrolment for another account', async () => reject(service.getBusinessWorkspace(actor('business-outsider'), {}), 'permission-denied'));
  await check('president and manager both create and edit themes/initiatives', async () => {
    for (const [index, admin] of [manager, president].entries()) {
      const id = `theme-${index}`; await service.saveBusinessTheme(admin, theme(id));
      await service.saveBusinessTheme(admin, { ...theme(id, '編集済みの架空テーマ'), expectedVersion: 1 });
      await service.saveBusinessInitiative(admin, initiative(`initiative-${index}`, id));
      await service.saveBusinessInitiative(admin, { ...initiative(`initiative-${index}`, id), expectedVersion: 1, targetMemo: '更新済み' });
    }
  });
  await check('employee management and extra-field requests fail', async () => {
    await reject(service.saveBusinessTheme(employee, theme('forbidden')), 'permission-denied');
    await assert.rejects(service.setBusinessMilestoneCompletion(employee, { initiativeId: 'initiative-0', milestoneId: 'stable-first', expectedVersion: 2, completed: true, assigneeIds: [employee.uid] }));
  });
  await check('assigned employee can complete and undo a stable milestone id, with retry idempotency', async () => {
    const request = { initiativeId: 'initiative-0', milestoneId: 'stable-first', expectedVersion: 2, completed: true };
    await service.setBusinessMilestoneCompletion(employee, request);
    const once = await read('businessInitiatives', 'initiative-0');
    const count = (await db.collection('businessHistory').where('entityId', '==', 'initiative-0').get()).size;
    await service.setBusinessMilestoneCompletion(employee, request);
    assert.deepEqual(await read('businessInitiatives', 'initiative-0'), once);
    assert.equal((await db.collection('businessHistory').where('entityId', '==', 'initiative-0').get()).size, count);
    assert.equal(once.status, 'not_started');
    await service.setBusinessMilestoneCompletion(employee, { ...request, expectedVersion: once.version, completed: false });
  });
  await check('assignment removal prevents old milestone and status requests', async () => {
    const before = await read('businessInitiatives', 'initiative-1');
    await service.saveBusinessInitiative(manager, { ...initiative('initiative-1', 'theme-1'), expectedVersion: before.version, assigneeIds: [] });
    await reject(service.setBusinessMilestoneCompletion(employee, { initiativeId: before.id, milestoneId: 'stable-first', expectedVersion: before.version, completed: true }), 'permission-denied');
    await reject(service.setBusinessStatus(employee, { initiativeId: before.id, expectedVersion: before.version, status: 'completed' }), 'permission-denied');
    await service.setBusinessStatus(president, { initiativeId: before.id, expectedVersion: before.version + 1, status: 'completed' });
    assert.ok((await read('businessInitiatives', before.id)).milestones.every(m => !m.completed));
  });
  await check('concurrent admin edits commit exactly one change', async () => {
    const before = await read('businessThemes', 'theme-0');
    const outcomes = await Promise.allSettled([service.saveBusinessTheme(manager, { ...theme('theme-0', '管理担当の変更'), expectedVersion: before.version }), service.saveBusinessTheme(president, { ...theme('theme-0', '社長の変更'), expectedVersion: before.version })]);
    assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(outcomes.find(x => x.status === 'rejected').reason.code, 'aborted');
    assert.equal((await read('businessThemes', 'theme-0')).version, before.version + 1);
  });
  await check('posting a recent update is idempotent and leaves structural version/status unchanged', async () => {
    const before = await read('businessInitiatives', 'initiative-0');
    const post = { id: 'update-test', initiativeId: before.id, body: '架空の近況報告です', sourceLocale: 'ja' };
    await service.postBusinessUpdate(employee, post); await service.postBusinessUpdate(employee, post);
    const after = await read('businessInitiatives', before.id);
    assert.equal(after.version, before.version); assert.equal(after.status, before.status);
    assert.equal(after.latestUpdate.id, post.id);
    assert.equal((await db.collection('businessUpdates').where('initiativeId', '==', before.id).get()).size, 1);
    await reject(service.postBusinessUpdate(manager, post), 'already-exists');
  });
  await check('translation cache is reused after status changes', async () => {
    const row = await read('businessInitiatives', 'initiative-0');
    const input = { kind: 'initiative', id: row.id, targetLocale: 'zh-CN', expectedContentVersion: row.contentVersion };
    const first = await service.translateBusinessContent(employee, input);
    const calls = translations;
    await service.setBusinessStatus(employee, { initiativeId: row.id, expectedVersion: row.version, status: 'in_progress' });
    const second = await service.translateBusinessContent(president, input);
    assert.equal(second.cached, true); assert.deepEqual(first.fields, second.fields); assert.equal(translations, calls);
  });
  await check('late translation cannot replace edited original', async () => {
    const row = await read('businessThemes', 'theme-1');
    const gate = gateTranslation();
    const pending = service.translateBusinessContent(manager, { kind: 'theme', id: row.id, targetLocale: 'zh-CN', expectedContentVersion: row.contentVersion });
    const rejection = reject(pending, 'aborted');
    await gate.ready;
    await service.saveBusinessTheme(president, { ...theme(row.id, '翻訳中に更新した原文'), expectedVersion: row.version });
    gate.release(); await rejection;
  });
  await check('membership removal during translation rejects the response and cached data access', async () => {
    const row = await read('businessThemes', 'theme-1');
    const gate = gateTranslation();
    const pending = service.translateBusinessContent(employee, { kind: 'theme', id: row.id, targetLocale: 'zh-CN', expectedContentVersion: row.contentVersion });
    const rejection = reject(pending, 'permission-denied');
    await gate.ready;
    await service.saveBusinessSettings(manager, { expectedVersion: 1, enabled: true, memberIds: [manager.uid, president.uid, 'business-outsider'] });
    gate.release(); await rejection;
    const cached = await read('businessInitiatives', 'initiative-0');
    await reject(service.translateBusinessContent(employee, { kind: 'initiative', id: cached.id, targetLocale: 'zh-CN', expectedContentVersion: cached.contentVersion }), 'permission-denied');
    await service.saveBusinessSettings(president, { expectedVersion: 2, enabled: true, memberIds: [manager.uid, president.uid, employee.uid] });
  });
  await check('translation provider failure does not undo original save', async () => {
    const row = await read('businessThemes', 'theme-1');
    translationImpl = async () => { throw new Error('synthetic provider outage'); };
    await reject(service.translateBusinessContent(manager, { kind: 'theme', id: row.id, targetLocale: 'zh-CN', expectedContentVersion: row.contentVersion }), 'unavailable');
    assert.equal((await read('businessThemes', row.id)).name, '翻訳中に更新した原文');
  });
  await check('theme archive preserves rows and blocks new work until restored', async () => {
    const row = await read('businessThemes', 'theme-0');
    await service.setBusinessArchived(president, { kind: 'theme', id: row.id, expectedVersion: row.version, archived: true });
    await reject(service.postBusinessUpdate(employee, { id: 'blocked-update', initiativeId: 'initiative-0', body: '停止対象', sourceLocale: 'ja' }), 'failed-precondition');
    assert.ok(await read('businessInitiatives', 'initiative-0'));
    await service.setBusinessArchived(manager, { kind: 'theme', id: row.id, expectedVersion: row.version + 1, archived: false });
  });
  await check('setting pause blocks writes/translations but allows both admins to restore', async () => {
    await service.saveBusinessSettings(president, { expectedVersion: 3, enabled: false, memberIds: [manager.uid, president.uid, employee.uid] });
    const w = await service.getBusinessWorkspace(employee, {}); assert.deepEqual(w.initiatives, []); assert.equal(w.settings.enabled, false);
    await reject(service.postBusinessUpdate(employee, { id: 'paused-post', initiativeId: 'initiative-0', body: '停止中', sourceLocale: 'ja' }), 'failed-precondition');
    await service.saveBusinessSettings(manager, { expectedVersion: 4, enabled: true, memberIds: [manager.uid, president.uid, employee.uid] });
  });
  await check('global stop, disabled account, and anonymous access all fail closed', async () => {
    enabled = false; await reject(service.getBusinessWorkspace(manager, {}), 'failed-precondition'); enabled = true;
    await auth.updateUser(employee.uid, { disabled: true }); await reject(service.getBusinessWorkspace(employee, {}), 'permission-denied'); await auth.updateUser(employee.uid, { disabled: false });
    await reject(service.getBusinessWorkspace(undefined, {}), 'unauthenticated');
  });
  await check('theme and settings audit pages are available with their proper permissions', async () => {
    const themeHistory = await service.getBusinessHistory(employee, { kind: 'theme', id: 'theme-0' });
    assert.ok(themeHistory.history.length > 0);
    assert.ok(themeHistory.history.every(row => row.entityType === 'theme'));
    const settingsHistory = await service.getBusinessHistory(president, { kind: 'settings', id: 'current' });
    assert.ok(settingsHistory.history.length > 0);
    assert.ok(settingsHistory.history.every(row => row.entityType === 'settings' && row.entityId === 'current'));
    await reject(service.getBusinessHistory(employee, { kind: 'settings', id: 'current' }), 'permission-denied');
  });
  await check('same id in different entity types never mixes history', async () => {
    await service.saveBusinessTheme(manager, theme('same-id'));
    await service.saveBusinessInitiative(president, initiative('same-id', 'theme-0'));
    const t = await service.getBusinessHistory(employee, { kind: 'theme', id: 'same-id' });
    const i = await service.getBusinessInitiativeDetail(employee, { initiativeId: 'same-id' });
    assert.equal(t.history.length, 1); assert.equal(i.history.length, 1);
    assert.equal(t.history[0].entityType, 'theme'); assert.equal(i.history[0].entityType, 'initiative');
  });
  await check('all original work memo content, attachments and timestamps remain unchanged', async () => assert.deepEqual(await read('workLogs', 'untouched'), memoBefore));
  await check('detail exposes shared updates and actor/change history', async () => {
    const detail = await service.getBusinessInitiativeDetail(employee, { initiativeId: 'initiative-0' });
    assert.equal(detail.updates[0].authorId, employee.uid);
    assert.ok(detail.history.some(row => row.action === 'milestone_completion' && row.actorId === employee.uid));
  });
}
main().then(() => {
  const result = { projectId, emulatorsOnly: true, liveOpenAIRequests: 0, passed: true, checks: results };
  if (process.env.BUSINESS_TEST_RESULT) fs.writeFileSync(path.resolve(process.env.BUSINESS_TEST_RESULT), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, checks: results.length, emulatorsOnly: true }));
}).catch(error => { console.error(JSON.stringify({ passed: false, completedChecks: results.length, code: error.code || error.name, message: String(error.message).slice(0, 300) })); process.exitCode = 1; }).finally(() => deleteApp(app));
