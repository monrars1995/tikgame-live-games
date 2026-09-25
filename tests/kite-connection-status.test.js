import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../public/games/kite-championship/game.js", import.meta.url), "utf8")
  .replace(/^import \{ KiteEngine \} from "\.\/kite-engine\.js";\s*/, "");

function setup(search = "?id=streamer") {
  const listeners = new Map();
  const elements = new Map();
  const drawing = new Proxy({
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  const node = () => ({
    textContent: "", className: "", hidden: false,
    classList: { add() {}, remove() {}, toggle() {} },
    append() {}, replaceChildren() {},
    getContext: () => drawing,
  });
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, node());
      return elements.get(id);
    },
    createElement: node,
  };
  class KiteEngine {
    constructor() {
      this.rules = { roundMs: 60_000 };
      this.phase = "waiting";
      this.round = 1;
      this.active = [];
      this.queue = [];
      this.ranking = [];
    }
  }
  const window = {
    LiveGameUtils: { GiftTracker: class {}, isRose: () => false },
    TikTokBridge: {
      on(event, callback) { listeners.set(event, callback); },
    },
  };
  runInNewContext(source, {
    KiteEngine, document, window, URLSearchParams,
    location: { search },
    requestAnimationFrame() {},
    setInterval() {},
    console: { info() {} },
  });
  return {
    emit(event, payload) { listeners.get(event)?.(payload); },
    title: () => elements.get("connectionTitle").textContent,
    detail: () => elements.get("connectionDetail").textContent,
    tone: () => elements.get("connectionStatus").className,
  };
}

test("kite HUD keeps the TikTok failure cause visible during retries and ends after exhaustion", () => {
  const ui = setup();
  assert.match(ui.title(), /CONECTANDO @streamer/);

  ui.emit("reconnecting", {
    source: "tiktok", attempt: 1, maxAttempts: 5, delayMs: 2000,
    lastError: { code: "LIVE_NOT_FOUND", message: "Room not found" },
  });
  assert.match(ui.title(), /1\/5/);
  assert.match(ui.detail(), /Live não encontrada/);
  assert.match(ui.detail(), /2 s/);

  ui.emit("error", { source: "tiktok", code: "LIVE_NOT_FOUND", message: "Room not found", retryable: true });
  assert.match(ui.title(), /1\/5/);
  assert.match(ui.detail(), /Live não encontrada/);

  ui.emit("reconnecting", { source: "tiktok", attempt: 5, maxAttempts: 5, delayMs: 32000 });
  assert.match(ui.title(), /5\/5/);
  assert.match(ui.detail(), /Live não encontrada/);

  ui.emit("error", {
    source: "tiktok", code: "RECONNECT_EXHAUSTED", message: "Reconnect failed after 5 attempts",
    retryable: false, exhausted: true,
  });
  assert.match(ui.title(), /INDISPONÍVEL APÓS 5 TENTATIVAS/);
  assert.match(ui.detail(), /Live não encontrada/);
  assert.match(ui.detail(), /diagnóstico no painel/);
  assert.match(ui.tone(), /error/);

  ui.emit("reconnecting", { source: "tiktok", attempt: 6, maxAttempts: 5 });
  assert.match(ui.title(), /INDISPONÍVEL APÓS 5 TENTATIVAS/);
  ui.emit("connected", { room: "streamer" });
  assert.match(ui.title(), /LIVE @streamer CONECTADA/);
  assert.match(ui.tone(), /live/);
});

test("kite HUD distinguishes local server failures from TikTok room failures", () => {
  const ui = setup();
  ui.emit("error", { source: "local", code: "LOCAL_SOCKET_ERROR", message: "transport close" });
  assert.match(ui.title(), /SERVIDOR TIKGAME INDISPONÍVEL/);
  assert.match(ui.tone(), /local/);
  ui.emit("reconnecting", { source: "local", attempt: 0, delayMs: 0 });
  assert.match(ui.title(), /PONTE LOCAL/);
  assert.doesNotMatch(ui.title(), /@streamer/);
});
