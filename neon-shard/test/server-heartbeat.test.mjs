import test from "node:test";
import assert from "node:assert/strict";
import { ServerHeartbeat } from "../js/account/server-heartbeat.js";

class FakeTarget {
  listeners = new Map();
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type, fn) { if (this.listeners.get(type) === fn) this.listeners.delete(type); }
  emit(type) { this.listeners.get(type)?.(); }
}

test("ServerHeartbeat：啟動立即握手、每 10 秒觸發，且不重疊請求", async () => {
  const documentRef = new FakeTarget();
  documentRef.visibilityState = "visible";
  const windowRef = new FakeTarget();
  let tick;
  let delay;
  let calls = 0;
  let release;
  const heartbeat = new ServerHeartbeat({
    baseUrl: "https://api.example.test/",
    documentRef,
    windowRef,
    setIntervalImpl: (fn, ms) => { tick = fn; delay = ms; return 7; },
    clearIntervalImpl: (id) => assert.equal(id, 7),
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, "https://api.example.test/api/health");
      assert.equal(options.credentials, "omit");
      return new Promise((resolve) => { release = resolve; });
    },
  });

  heartbeat.start();
  assert.equal(delay, 10_000);
  await Promise.resolve();
  const first = heartbeat.ping();
  tick();
  assert.strictEqual(first, heartbeat.ping());
  assert.equal(calls, 1);
  release({ ok: true });
  assert.equal(await first, true);

  documentRef.emit("visibilitychange");
  await Promise.resolve();
  assert.equal(calls, 2);
  release({ ok: true });
  await heartbeat.ping();

  windowRef.emit("online");
  await Promise.resolve();
  assert.equal(calls, 3);
  release({ ok: true });
  await heartbeat.ping();

  heartbeat.stop();
  assert.equal(documentRef.listeners.has("visibilitychange"), false);
  assert.equal(windowRef.listeners.has("online"), false);
});

test("ServerHeartbeat：網路錯誤不會造成未處理例外", async () => {
  const heartbeat = new ServerHeartbeat({
    baseUrl: "https://api.example.test",
    fetchImpl: async () => { throw new TypeError("offline"); },
  });
  assert.equal(await heartbeat.ping(), false);
});
