import { applicationDefault, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore } from "firebase-admin/firestore";

const args = process.argv.slice(2);
const valueOf = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : "";
};

const projectId = valueOf("--project");
const confirmProject = valueOf("--confirm-project");
const apply = args.includes("--apply");

if (!projectId || projectId !== confirmProject) {
  throw new Error("--project と --confirm-project に同じプロジェクトIDを指定してください。");
}
if (projectId !== "gpt-kintai" && projectId !== "demo-kintai") {
  throw new Error(`許可されていないプロジェクトです: ${projectId}`);
}

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const collectionNames = ["products", "productObservations"];
const plans = await Promise.all(collectionNames.map(async (collectionName) => {
  const snapshot = await db.collection(collectionName).orderBy(FieldPath.documentId()).get();
  const targets = snapshot.docs.filter((item) => typeof item.data().isDemo !== "boolean");
  return { collectionName, snapshot, targets };
}));
const targets = plans.flatMap((plan) => plan.targets);

console.log(JSON.stringify({
  projectId,
  mode: apply ? "apply" : "dry-run",
  collections: Object.fromEntries(plans.map((plan) => [plan.collectionName, {
    documentCount: plan.snapshot.size,
    updateCount: plan.targets.length,
    targetIds: plan.targets.map((item) => item.id)
  }])),
  updateCount: targets.length,
}, null, 2));

if (!apply || targets.length === 0) process.exit(0);

for (let offset = 0; offset < targets.length; offset += 450) {
  const batch = db.batch();
  for (const item of targets.slice(offset, offset + 450)) {
    batch.update(item.ref, { isDemo: false });
  }
  await batch.commit();
}

console.log(`Updated ${targets.length} normal product/product-observation document(s).`);
