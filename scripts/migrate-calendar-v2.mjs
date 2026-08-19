import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const valueOf = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : "";
};
const projectId = valueOf("--project");
const confirmProject = valueOf("--confirm-project");
const apply = args.includes("--apply");
const backupFile = valueOf("--backup");
if (!projectId || projectId !== confirmProject) throw new Error("--project と --confirm-project に同じプロジェクトIDを指定してください。");
if (!["gpt-kintai", "demo-kintai"].includes(projectId)) throw new Error(`許可されていないプロジェクトです: ${projectId}`);
if (apply && !backupFile) throw new Error("--apply には --backup <新規ファイルパス> が必要です。");

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const [usersSnapshot, membersSnapshot, eventsSnapshot] = await Promise.all([
  db.collection("users").get(), db.collection("calendarMembers").get(), db.collection("calendarEvents").get()
]);
const scopeOf = (data) => data.isDemo === true ? `demo:${String(data.demoDatasetId || "missing")}` : "real";
const scopePrefix = (scope) => scope === "real" ? "real" : `demo_${createHash("sha256").update(scope.slice(5)).digest("hex").slice(0, 16)}`;
const safeId = (value) => value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 110);
const memberPlans = [];
const memberByUser = new Map();

for (const member of membersSnapshot.docs) {
  const linkedUserId = String(member.data().linkedUserId || "");
  if (linkedUserId) memberByUser.set(`${scopeOf(member.data())}:${linkedUserId}`, member.id);
}
const usersByScope = new Map();
for (const user of usersSnapshot.docs.filter((item) => item.data().active !== false)) {
  const scope = scopeOf(user.data());
  usersByScope.set(scope, [...(usersByScope.get(scope) || []), user]);
  const key = `${scope}:${user.id}`;
  if (memberByUser.has(key)) continue;
  const id = `${scopePrefix(scope)}_${safeId(user.id)}`;
  memberByUser.set(key, id);
  memberPlans.push({ id, scope, data: {
    displayName: String(user.data().displayName || ""), linkedUserId: user.id,
    roleHint: String(user.data().role || "employee"), active: true,
    order: ((usersByScope.get(scope)?.length || 1) * 10)
  } });
}
for (const [scope, users] of usersByScope) {
  const hasPresident = users.some((item) => item.data().role === "president_viewer")
    || membersSnapshot.docs.some((item) => scopeOf(item.data()) === scope && item.data().roleHint === "president_viewer");
  if (!hasPresident) memberPlans.push({ id: `${scopePrefix(scope)}_role-president`, scope, data: {
    displayName: "社長", linkedUserId: "", roleHint: "president_viewer", active: true, order: 30
  } });
}

const eventPlans = eventsSnapshot.docs.filter((item) => {
  const data = item.data();
  return !data.groupId || !data.eventType || !data.startDate || !data.endDate
    || (Array.isArray(data.participants) && data.participants.some((participant) => !participant.memberId));
}).map((item) => {
  const data = item.data();
  const scope = scopeOf(data);
  return { ref: item.ref, data: {
    groupId: String(data.groupId || item.id), eventType: String(data.eventType || "work"),
    startDate: String(data.startDate || data.date), endDate: String(data.endDate || data.date),
    participants: Array.isArray(data.participants) ? data.participants.map((participant) => ({
      memberId: memberByUser.get(`${scope}:${String(participant.userId || participant.memberId || "")}`) || String(participant.memberId || participant.userId || ""),
      displayName: String(participant.displayName || "")
    })) : []
  } };
});

console.log(JSON.stringify({ projectId, mode: apply ? "apply" : "dry-run", calendarMembersToCreate: memberPlans.length, eventsToUpdate: eventPlans.length, eventIds: eventPlans.map((item) => item.ref.id) }, null, 2));
if (!apply) process.exit(0);

await mkdir(dirname(backupFile), { recursive: true });
await writeFile(backupFile, JSON.stringify({
  projectId,
  exportedAt: new Date().toISOString(),
  calendarMembers: membersSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
  calendarEvents: eventsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
}, null, 2), { flag: "wx" });
console.log(`Backup written to ${backupFile}`);

const writes = [
  ...memberPlans.map((plan) => ({ ref: db.doc(`calendarMembers/${plan.id}`), data: {
    ...plan.data,
    ...(plan.scope === "real" ? { isDemo: false } : { isDemo: true, demoDatasetId: plan.scope.slice(5), seedVersion: "calendar-v2" }),
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp()
  } })),
  ...eventPlans.map((plan) => ({ ref: plan.ref, data: { ...plan.data, updatedAt: FieldValue.serverTimestamp() } }))
];
for (let offset = 0; offset < writes.length; offset += 450) {
  const batch = db.batch();
  for (const write of writes.slice(offset, offset + 450)) batch.set(write.ref, write.data, { merge: true });
  await batch.commit();
}
console.log(`Created ${memberPlans.length} calendar member(s) and updated ${eventPlans.length} calendar event(s).`);
