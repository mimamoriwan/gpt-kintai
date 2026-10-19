import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { onCall } from "firebase-functions/v2/https";
import { changeAccountEmail as changeEmail, completeAccountRecovery as completeRecovery, getAccountManagement as getManagement, setAccountRecovery as setRecovery } from "./accountRecovery.js";

const options = { enforceAppCheck: process.env.FUNCTIONS_EMULATOR !== "true", invoker: "public", timeoutSeconds: 60, region: "asia-northeast1", maxInstances: 5, memory: "256MiB" } as const;
// Resolve Admin services inside the callback; index.ts initializes after imports.
function dependencies() { return { db: getFirestore(), auth: getAuth() }; }
export const getAccountManagement = onCall(options, (request) => getManagement(request.auth, request.data, dependencies()));
export const setAccountRecovery = onCall(options, (request) => setRecovery(request.auth, request.data, dependencies()));
export const changeAccountEmail = onCall(options, (request) => changeEmail(request.auth, request.data, dependencies()));
// The short-lived grant authorizes this one operation; App Check is still required.
export const completeAccountRecovery = onCall(options, (request) => completeRecovery(request.auth, request.data, dependencies()));
