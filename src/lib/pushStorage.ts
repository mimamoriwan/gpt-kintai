export interface PushDeviceState {
  deviceId: string;
  revokeKey: string;
  userId: string;
  enabled: boolean;
  locale: "ja" | "zh-CN";
}
export type PushRevocation = Pick<PushDeviceState, "deviceId" | "revokeKey">;
let connection: Promise<IDBDatabase> | undefined;
function database(): Promise<IDBDatabase> {
  if (!connection) connection = new Promise((resolve, reject) => {
    const request = indexedDB.open("gyoumulog-announcement-push", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("settings");
    request.onerror = () => { connection = undefined; reject(new Error("通知設定を保存できません。")); };
    request.onsuccess = () => resolve(request.result);
  });
  return connection;
}
export async function readPushValue<T>(key: string): Promise<T | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("settings", "readonly");
    const request = tx.objectStore("settings").get(key);
    tx.oncomplete = () => resolve(request.result as T | undefined);
    tx.onerror = () => reject(new Error("通知設定を読み取れません。"));
  });
}
export async function writePushValue(key: string, value: unknown): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("settings", "readwrite");
    tx.objectStore("settings").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error("通知設定を保存できません。"));
  });
}
export const getPushState = () => readPushValue<PushDeviceState>("device");
export const savePushState = (state: PushDeviceState) => writePushValue("device", state);

export async function ensurePushIdentity(userId: string, locale: "ja" | "zh-CN"): Promise<PushDeviceState> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("settings", "readwrite");
    const store = tx.objectStore("settings");
    const request = store.get("device");
    let state: PushDeviceState;
    request.onsuccess = () => {
      state = request.result || { deviceId: crypto.randomUUID(),
        revokeKey: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join(""),
        userId, locale, enabled: false };
      if (!request.result) store.put(state, "device");
    };
    tx.oncomplete = () => resolve(state);
    tx.onerror = () => reject(new Error("通知設定を保存できません。"));
  });
}

// Modify the revocation queue inside one transaction; multiple tabs share it.
export async function updateRevocations(change: (queue: PushRevocation[]) => PushRevocation[]): Promise<void> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("settings", "readwrite");
    const store = tx.objectStore("settings");
    const request = store.get("revocations");
    request.onsuccess = () => store.put(change(request.result || []), "revocations");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error("通知の解除情報を保存できません。"));
  });
}

export async function claimPushEvent(eventId: string, userId: string): Promise<boolean> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("settings", "readwrite");
    const store = tx.objectStore("settings");
    const device = store.get("device");
    let claimed = false;
    device.onsuccess = () => {
      const state = device.result as PushDeviceState | undefined;
      if (!state?.enabled || state.userId !== userId) return;
      const seen = store.get("seen");
      seen.onsuccess = () => {
        const cutoff = Date.now() - 24 * 60 * 60_000;
        const entries = (seen.result || []) as [string, number][];
        if (entries.some(([id]) => id === eventId)) return;
        store.put([...entries.filter(([, time]) => time > cutoff).slice(-999), [eventId, Date.now()]], "seen");
        claimed = true;
      };
    };
    tx.oncomplete = () => resolve(claimed);
    tx.onerror = () => reject(new Error("通知を処理できません。"));
  });
}

export async function releasePushEvent(eventId: string) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("settings", "readwrite");
    const store = tx.objectStore("settings");
    const read = store.get("seen");
    read.onsuccess = () => store.put(((read.result || []) as [string, number][]).filter(([id]) => id !== eventId), "seen");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error("通知を処理できません。"));
  });
}
