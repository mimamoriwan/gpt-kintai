// @vitest-environment node
import { build } from "esbuild";
import { runInNewContext } from "node:vm";
import { beforeAll, describe, expect, it } from "vitest";
let code;
beforeAll(async () => {
  const result = await build({
    entryPoints: ["src/sw.ts"], bundle: true, write: false, format: "iife",
    define: { "import.meta.env.VITE_FIREBASE_PROJECT_ID": '"fixture-project"', "import.meta.env.VITE_USE_FIREBASE_EMULATORS": '"false"', "import.meta.env": '{}' },
    plugins: [{ name: "worker-native-boundaries", setup(builder) {
      builder.onResolve({ filter: /^(firebase\/|workbox-)|\/lib\/pushStorage(?:\.js)?$/ }, args => ({ path: args.path, namespace: "worker-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "worker-fixture" }, args => ({ contents: args.path.includes("pushStorage") ? `
        export const claimPushEvent = async (id, user) => {
          if (!fixture.state.enabled || fixture.state.userId !== user || fixture.seen.has(id)) return false;
          fixture.seen.add(id); return true;
        };
        export const getPushState = async () => fixture.state;
        export const releasePushEvent = async id => fixture.seen.delete(id);
      ` : `
        export const initializeApp = () => ({});
        export const isSupported = () => fixture.sdkReady;
        export const getMessaging = () => { self.addEventListener('push', () => fixture.relays++); return {}; };
        export const onBackgroundMessage = () => {};
        export const clientsClaim = () => {};
        export const cleanupOutdatedCaches = () => {};
        export const precacheAndRoute = () => {};
        export const createHandlerBoundToURL = () => () => {};
        export class NavigationRoute {};
        export const registerRoute = () => {};
      ` }));
    } }]
  });
  code = result.outputFiles[0].text;
});
const payload = { type: "test", eventId: "test-one", instructionId: "", userId: "fixture-user", locale: "ja" };
function boot(visible = false) {
  const handlers = new Map();
  const notifications = [];
  const fixture = { state: { enabled: true, userId: "fixture-user" }, seen: new Set(), sdkReady: new Promise(() => {}), relays: 0 };
  const self = {
    __WB_MANIFEST: [], location: { origin: "https://fixture.invalid" },
    clients: { matchAll: async () => visible ? [{ visibilityState: "visible", postMessage: () => fixture.relays++ }] : [] },
    registration: { showNotification: async (title, options) => { notifications.push({ title, ...options }); } },
    addEventListener: (type, handler) => handlers.set(type, [...(handlers.get(type) || []), handler])
  };
  runInNewContext(code, { self, fixture, URL, console });
  const send = async data => {
    const waiting = []; let stopped = false;
    const event = { data: { json: () => ({ data }) }, stopImmediatePropagation: () => { stopped = true; }, waitUntil: promise => waiting.push(promise) };
    for (const handler of handlers.get("push") || []) { handler(event); if (stopped) break; }
    const synchronousWaitCount = waiting.length;
    await Promise.all(waiting);
    return { synchronousWaitCount, stopped };
  };
  return { fixture, handlers, notifications, self, send };
}
describe("native push event lifetime", () => {
  it.each([false, true])("handles an actual push at cold startup before the async SDK check, visible window=%s", async visible => {
    const worker = boot(visible);
    const result = await worker.send(payload);
    expect(result).toEqual({ synchronousWaitCount: 1, stopped: true });
    expect(worker.notifications).toHaveLength(1);
    expect(worker.notifications[0].title).toBe("テスト通知");
    expect(worker.fixture.relays).toBe(0);
  });
  it("keeps the push event alive until the asynchronous notification display completes", async () => {
    const worker = boot(true);
    let displayStarted;
    const started = new Promise(resolve => { displayStarted = resolve; });
    let finish;
    worker.self.registration.showNotification = () => { displayStarted(); return new Promise(resolve => { finish = resolve; }); };
    let complete = false;
    const work = worker.send(payload).then(() => { complete = true; });
    await started;
    expect(complete).toBe(false);
    finish(); await work;
    expect(complete).toBe(true);
  });
  it("silences duplicate real pushes and suppresses disabled or different-account devices", async () => {
    const worker = boot();
    await worker.send(payload); await worker.send(payload);
    expect(worker.notifications[1]).toMatchObject({ tag: "test-one", silent: true });
    worker.fixture.state.enabled = false;
    await worker.send({ ...payload, eventId: "test-off" });
    worker.fixture.state = { enabled: true, userId: "other-user" };
    await worker.send({ ...payload, eventId: "test-other" });
    expect(worker.notifications).toHaveLength(2);
  });
  it("leaves unrelated messages to their own handlers", async () => {
    const worker = boot();
    expect(await worker.send({ type: "unrelated" })).toEqual({ synchronousWaitCount: 0, stopped: false });
    expect(worker.notifications).toHaveLength(0);
  });
});
