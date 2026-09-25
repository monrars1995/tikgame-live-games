import test from "node:test";
import assert from "node:assert/strict";
import { KiteEngine, segmentsIntersect, KITE_RULES } from "../public/games/kite-championship/kite-engine.js";

const user = (id) => ({ user: { uniqueId: id, nickname: id.toUpperCase() }, comment: "olá" });

function round(options = {}) {
  let time = 1000;
  const engine = new KiteEngine({ clock: () => time, ...options });
  return { engine, advance: (ms) => { time += ms; engine.tick(time); return time; }, now: () => time };
}

test("crossed physical strings are required for a cut", () => {
  assert.equal(segmentsIntersect({ x: 0, y: 100 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 0 }), true);
  assert.equal(segmentsIntersect({ x: 0, y: 100 }, { x: 0, y: 0 }, { x: 100, y: 100 }, { x: 100, y: 0 }), false);
});

test("first chat enters once, field is capped, and overflow waits in FIFO order", () => {
  const { engine, advance } = round({ rules: { maxKites: 2, lobbyMs: 100, resultsMs: 100 } });
  engine.chat(user("a"));
  engine.chat(user("a"));
  engine.chat(user("b"));
  engine.chat(user("c"));
  engine.chat(user("d"));
  assert.deepEqual(engine.kites.map((kite) => kite.id), ["a", "b"]);
  assert.deepEqual(engine.queue.map((pilot) => pilot.id), ["c", "d"]);
  advance(101);
  assert.equal(engine.phase, "active");
  advance(KITE_RULES.roundMs + 1);
  assert.equal(engine.phase, "results");
  advance(101);
  assert.deepEqual(engine.kites.map((kite) => kite.id), ["c", "d"]);
});

test("rose crosses the opponent's line and damages much more than a like", () => {
  const setup = () => {
    const control = round();
    control.engine.chat(user("a"));
    control.engine.chat(user("b"));
    control.advance(8100);
    return control;
  };
  const rose = setup();
  rose.engine.gift({ ...user("a"), giftName: "Rose", giftValue: 1 }, 1, true);
  rose.advance(650);
  const roseDamage = 100 - rose.engine.kites[1].hp;
  const hit = rose.engine.drainEvents().find((event) => event.type === "hit");
  assert.equal(hit?.kind, "gift");
  assert.equal(roseDamage, 25);

  const likes = setup();
  likes.engine.like({ ...user("a"), likeCount: 10 });
  likes.advance(650);
  const likeDamage = 100 - likes.engine.kites[1].hp;
  assert.ok(likeDamage > 0);
  assert.ok(likeDamage < roseDamage / 3, `10 likes dealt ${likeDamage}, 1 rose dealt ${roseDamage}`);
});

test("five roses are a visible knockout and award a cut, score and trophy", () => {
  const { engine, advance } = round();
  engine.chat(user("a"));
  engine.chat(user("b"));
  advance(8100);
  assert.equal(engine.gift({ ...user("a"), giftName: "Rosa", giftValue: 1 }, 5, true), true);
  advance(650);
  assert.equal(engine.kites[1].hp, 0);
  assert.equal(engine.phase, "results");
  assert.equal(engine.winner.id, "a");
  assert.equal(engine.pilots.get("a").cuts, 1);
  assert.equal(engine.pilots.get("a").trophies, 1);
  assert.equal(engine.ranking[0].id, "a");
});

test("paid gifts received while queued become pressure when the pilot enters", () => {
  const { engine, advance } = round({ rules: { maxKites: 2, lobbyMs: 100, roundMs: 1000, resultsMs: 100 } });
  engine.chat(user("a")); engine.chat(user("b"));
  engine.gift({ ...user("c"), giftName: "Rose", giftValue: 1 }, 5, true);
  assert.equal(engine.pilots.get("c").pending, 125);
  advance(101); advance(1001); advance(101);
  assert.equal(engine.kites[0].id, "c");
  assert.equal(engine.kites[0].pressure, 125);
});

test("round timer chooses the healthiest survivor when no cut occurs", () => {
  const { engine, advance } = round({ rules: { lobbyMs: 100, roundMs: 1000 } });
  engine.chat(user("a")); engine.chat(user("b"));
  advance(101);
  engine.gift({ ...user("a"), giftName: "Rose", giftValue: 1 }, 1, true);
  advance(650);
  advance(351);
  assert.equal(engine.phase, "results");
  assert.equal(engine.winner.id, "a");
});

test("chat flood cannot grow the queue or the pilot ranking without bound", () => {
  const { engine } = round({ rules: { maxKites: 2, maxQueue: 3, maxPilots: 5 } });
  for (let index = 0; index < 1000; index++) engine.chat(user(`viewer-${index}`));
  assert.equal(engine.kites.length, 2);
  assert.equal(engine.queue.length, 3);
  assert.equal(engine.pilots.size, 5);
  assert.equal(engine.gift({ ...user("late-gifter"), giftName: "Rose", giftValue: 1 }, 1, true), true);
  assert.equal(engine.queue.length, 3);
  assert.ok(engine.queue.some((pilot) => pilot.id === "late-gifter" && pilot.pending === 25));
  assert.equal(engine.pilots.size, 5);
});

test("lobby stores a paid rose without dealing damage before the round starts", () => {
  const { engine, advance } = round();
  engine.chat(user("a")); engine.chat(user("b"));
  engine.gift({ ...user("a"), giftName: "Rose", giftValue: 1 }, 1, true);
  advance(1000);
  assert.equal(engine.phase, "lobby");
  assert.equal(engine.kites[1].hp, 100);
  assert.equal(engine.kites[0].attack, null);
  assert.equal(engine.kites[0].pressure, 25);
  advance(7100);
  assert.equal(engine.phase, "active");
  assert.ok(engine.kites[0].attack);
  assert.equal(engine.kites[1].hp, 100);
  advance(650);
  assert.equal(engine.kites[1].hp, 75);
});

test("cut kite can queue but never respawns during the same round", () => {
  const { engine, advance } = round();
  engine.chat(user("a")); engine.chat(user("b")); engine.chat(user("c"));
  advance(8100);
  engine.gift({ ...user("a"), giftName: "Rose", giftValue: 1 }, 5, true);
  advance(650);
  assert.equal(engine.phase, "active");
  assert.equal(engine.kites.find((kite) => kite.id === "b").alive, false);
  engine.chat(user("b"));
  engine.gift({ ...user("b"), giftName: "Rose", giftValue: 1 }, 1, true);
  assert.equal(engine.kites.filter((kite) => kite.id === "b").length, 1);
  assert.equal(engine.queue[0].id, "b");
  assert.equal(engine.pilots.get("b").pending, 25);
  advance(KITE_RULES.roundMs + 1);
  advance(KITE_RULES.resultsMs + 1);
  assert.equal(engine.kites.filter((kite) => kite.id === "b").length, 1);
  assert.equal(engine.kites[0].id, "b");
});

test("rose sent during results waits for the next round and cannot rewrite the winner", () => {
  const { engine, advance } = round();
  engine.chat(user("a")); engine.chat(user("b"));
  advance(8100);
  advance(KITE_RULES.roundMs + 1);
  assert.equal(engine.phase, "results");
  const previous = {
    winner: engine.winner.id,
    hp: engine.kites.map((kite) => kite.hp),
    cuts: engine.pilots.get("a").cuts,
    score: engine.pilots.get("a").score,
  };
  engine.gift({ ...user("a"), giftName: "Rose", giftValue: 1 }, 5, true);
  advance(1000);
  assert.equal(engine.winner.id, previous.winner);
  assert.deepEqual(engine.kites.map((kite) => kite.hp), previous.hp);
  assert.equal(engine.pilots.get("a").cuts, previous.cuts);
  assert.equal(engine.pilots.get("a").score, previous.score);
  assert.equal(engine.pilots.get("a").pending, 125);
  advance(KITE_RULES.resultsMs);
  assert.equal(engine.phase, "lobby");
  assert.equal(engine.kites[0].id, "a");
  assert.equal(engine.kites[0].pressure, 125);
});

test("a paid strike still in flight at zero is saved for the next round", () => {
  const { engine, advance } = round({ rules: { lobbyMs: 100, roundMs: 1000, resultsMs: 100 } });
  engine.chat(user("a")); engine.chat(user("b"));
  advance(101);
  advance(600);
  engine.gift({ ...user("a"), giftName: "Rose", giftValue: 1 }, 1, true);
  advance(401);
  assert.equal(engine.phase, "results");
  assert.equal(engine.kites[1].hp, 100);
  assert.equal(engine.pilots.get("a").pending, 25);
  advance(101);
  assert.equal(engine.kites.find((kite) => kite.id === "a").pressure, 25);
});

test("a new gifter takes the last chat-only seat when the waiting queue is full", () => {
  const { engine } = round({ rules: { maxKites: 1, maxQueue: 1, maxPilots: 4 } });
  engine.chat(user("a"));
  engine.chat(user("b"));
  assert.equal(engine.queue[0].id, "b");
  assert.equal(engine.gift({ ...user("c"), giftName: "Rose", giftValue: 1 }, 1, true), true);
  assert.equal(engine.queue.length, 1);
  assert.equal(engine.queue[0].id, "c");
  assert.equal(engine.queue[0].pending, 25);
});

test("a gift still lights up the sky when every queue seat is already paid", () => {
  const { engine, advance } = round({ rules: { maxKites: 1, maxQueue: 1, maxPilots: 4, lobbyMs: 100, roundMs: 1000 } });
  engine.chat(user("a"));
  engine.gift({ ...user("b"), giftName: "Rose", giftValue: 1 }, 1, true);
  assert.equal(engine.queue[0].pending, 25);
  advance(101); advance(1001);
  assert.equal(engine.phase, "results");
  const snapshot = { hp: engine.kites[0].hp, winner: engine.winner.id, score: engine.pilots.get("a").score };
  engine.drainEvents();
  assert.equal(engine.gift({ ...user("c"), giftName: "Rose", giftValue: 1 }, 5, true), true);
  const effects = engine.drainEvents().filter((event) => event.type === "skyGift");
  assert.equal(effects.length, 1);
  assert.equal(effects[0].units, 5);
  assert.equal(engine.queue[0].id, "b");
  assert.equal(engine.pilots.has("c"), false);
  assert.deepEqual({ hp: engine.kites[0].hp, winner: engine.winner.id, score: engine.pilots.get("a").score }, snapshot);
});

test("priority admission restores a displaced chat pilot when the pilot cap prevents entry", () => {
  const { engine } = round({ rules: { maxKites: 1, maxQueue: 2, maxPilots: 3 } });
  engine.chat(user("a")); engine.chat(user("b")); engine.chat(user("c"));
  engine.drainEvents();
  assert.equal(engine.gift({ ...user("d"), giftName: "Rose", giftValue: 1 }, 1, true), true);
  assert.deepEqual(engine.queue.map((pilot) => pilot.id), ["b", "c"]);
  assert.equal(engine.pilots.size, 3);
  assert.equal(engine.drainEvents().filter((event) => event.type === "skyGift").length, 1);
});
