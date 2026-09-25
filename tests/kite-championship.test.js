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

test("three NPC kites appear while waiting without consuming viewer slots or ranking seats", () => {
  const { engine } = round({ rules: { maxKites: 1, maxQueue: 1, maxPilots: 2 } });
  assert.equal(engine.phase, "waiting");
  assert.equal(engine.npcs.length, 3);
  assert.equal(new Set(engine.npcs.map((kite) => kite.id)).size, 3);
  assert.ok(engine.npcs.every((kite) => kite.npc && kite.alive && kite.hp === engine.rules.health
    && kite.name.startsWith("NPC ") && Number.isFinite(kite.anchorX) && kite.attack === null));
  assert.equal(engine.active.length, 0);
  assert.equal(engine.pilots.size, 0);
  engine.chat(user("a")); engine.chat(user("b"));
  assert.deepEqual(engine.kites.map((kite) => kite.id), ["a"]);
  assert.deepEqual(engine.queue.map((pilot) => pilot.id), ["b"]);
  assert.deepEqual(engine.ranking.map((pilot) => pilot.id).sort(), ["a", "b"]);
  assert.ok(engine.npcs.every((kite) => !engine.pilots.has(kite.id)));
});

test("a solo viewer can cut each NPC by crossing lines with roses and win only after the last cut", () => {
  const { engine, advance } = round({ rules: { npcAttackMs: 100000 } });
  engine.chat(user("solo"));
  advance(8100);
  assert.equal(engine.phase, "active");
  for (let index = 0; index < 3; index++) {
    assert.equal(engine.gift({ ...user("solo"), giftName: "Rosa", giftValue: 1 }, 5, true), true);
    advance(650);
    assert.equal(engine.npcs.filter((kite) => !kite.alive).length, index + 1);
    assert.equal(engine.phase, index === 2 ? "results" : "active");
    if (index < 2) advance(500);
  }
  assert.equal(engine.winner.id, "solo");
  assert.equal(engine.pilots.get("solo").cuts, 3);
  assert.equal(engine.pilots.get("solo").trophies, 1);
  assert.equal(engine.ranking.length, 1);
  const cuts = engine.drainEvents().filter((event) => event.type === "cut");
  assert.equal(cuts.length, 3);
  assert.ok(cuts.every((event) => event.targetNpc === true && event.attackerNpc === false));
});

test("a solo viewer's rose still deals 25 damage and likes remain much weaker against NPCs", () => {
  const setup = () => {
    const game = round({ rules: { npcAttackMs: 100000 } });
    game.engine.chat(user("solo"));
    game.advance(8100);
    return game;
  };
  const rose = setup();
  rose.engine.gift({ ...user("solo"), giftName: "Rose", giftValue: 1 }, 1, true);
  rose.advance(650);
  assert.equal(rose.engine.npcs[0].hp, 75);
  const likes = setup();
  likes.engine.like({ ...user("solo"), likeCount: 10 });
  likes.advance(650);
  assert.equal(likes.engine.npcs[0].hp, 94.5);
});

test("NPCs attack only live viewers during active play, cause no trophy, and renew next round", () => {
  const { engine, advance } = round({ rules: { lobbyMs: 100, npcAttackMs: 2000, resultsMs: 100 } });
  advance(10000);
  assert.equal(engine.phase, "waiting");
  assert.ok(engine.npcs.every((kite) => kite.attack === null));
  engine.chat(user("solo"));
  advance(101);
  engine.kites[0].hp = 1;
  advance(2001);
  assert.equal(engine.npcs[0].attack?.kind, "npc");
  assert.equal(engine.npcs[0].attack?.damage, 2);
  const npc = engine.npcs[0];
  const halfway = engine._pose(npc, npc.attack.started + 320);
  const victim = engine.kites[0];
  assert.ok(Math.hypot(halfway.x - victim.x, halfway.y - victim.y)
    < Math.hypot(npc.attack.fromX - victim.x, npc.attack.fromY - victim.y));
  advance(650);
  assert.equal(engine.kites[0].alive, false);
  const botCut = engine.drainEvents().find((event) => event.type === "cut");
  assert.equal(botCut?.attackerNpc, true);
  assert.equal(botCut?.targetNpc, false);
  assert.equal(engine.phase, "results");
  assert.equal(engine.winner, null);
  assert.equal(engine.pilots.get("solo").trophies, 0);
  assert.ok(engine.npcs.every((kite) => kite.attack === null));
  const previousNPCs = engine.npcs;
  advance(101);
  assert.equal(engine.phase, "waiting");
  assert.equal(engine.npcs.length, 3);
  assert.ok(engine.npcs.every((kite, index) => kite !== previousNPCs[index]
    && kite.alive && kite.hp === engine.rules.health && kite.attack === null));
  assert.equal(engine.ranking.length, 1);
});

test("1000 viewers occupy distinct sky positions and the 1001st waits without blocking combat", () => {
  const { engine, advance } = round({ rules: { lobbyMs: 100, npcAttackMs: 100000 } });
  assert.equal(KITE_RULES.maxKites, 1000);
  for (let index = 0; index <= 1000; index++) engine.chat(user(`viewer-${index}`));
  assert.equal(engine.kites.length, 1000);
  assert.equal(engine.aliveHumans, 1000);
  assert.equal(engine.queue.length, 1);
  assert.equal(engine.queue[0].id, "viewer-1000");
  assert.equal(engine.pilots.size, 1001);
  assert.equal(engine.npcs.length, 3);
  assert.ok(engine.kites.every((kite) => kite.x >= 23 && kite.x <= 427
    && kite.y >= 190 && kite.y <= 510 && kite.anchorY >= 645 && kite.anchorY <= 730));
  const occupiedCells = new Set(engine.kites.map((kite) =>
    `${Math.floor(kite.x / 8)}:${Math.floor(kite.y / 8)}`));
  assert.ok(occupiedCells.size > 850, `${occupiedCells.size} distinct 8px cells`);

  advance(101);
  assert.equal(engine.phase, "active");
  engine.drainEvents();
  assert.equal(engine.gift({ ...user("viewer-999"), giftName: "Rose", giftValue: 1 }, 1, true), true);
  advance(650);
  const hit = engine.drainEvents().find((event) => event.type === "hit" && event.id === "viewer-999");
  assert.equal(hit?.damage, 25);
  assert.equal(engine.aliveHumans, 1000);
  for (let frame = 0; frame < 120; frame++) advance(16);
  assert.equal(engine.kites.length, 1000);
  assert.equal(engine.queue[0].id, "viewer-1000");
  assert.ok(engine.kites.every((kite) => Number.isFinite(kite.x) && Number.isFinite(kite.y)
    && Number.isFinite(kite.vx) && Number.isFinite(kite.vy) && Math.abs(kite.tilt) <= .32));
});

test("wind makes human flight smooth while NPCs visibly patrol within the sky", () => {
  const { engine, advance, now } = round();
  engine.chat(user("a")); engine.chat(user("b"));
  engine.tick(now()); // Establish the initial pose before measuring adjacent frames.
  const human = engine.kites[0];
  const npc = engine.npcs[0];
  let previousHumanX = human.x;
  let previousNpcX = npc.x;
  let minHumanX = human.x; let maxHumanX = human.x;
  let minNpcX = npc.x; let maxNpcX = npc.x;
  let minNpcY = npc.y; let maxNpcY = npc.y;
  for (let frame = 0; frame < 480; frame++) {
    advance(16);
    assert.ok(Math.abs(human.x - previousHumanX) < 2);
    assert.ok(Math.abs(npc.x - previousNpcX) < 2);
    assert.ok(human.x >= 23 && human.x <= 427 && human.y >= 190 && human.y <= 520);
    assert.ok(npc.x >= 23 && npc.x <= 427 && npc.y >= 190 && npc.y <= 520);
    assert.ok(Number.isFinite(human.vx) && Number.isFinite(human.vy)
      && Number.isFinite(npc.vx) && Number.isFinite(npc.vy));
    assert.ok(Math.abs(human.tilt) <= .32 && Math.abs(npc.tilt) <= .32);
    minHumanX = Math.min(minHumanX, human.x); maxHumanX = Math.max(maxHumanX, human.x);
    minNpcX = Math.min(minNpcX, npc.x); maxNpcX = Math.max(maxNpcX, npc.x);
    minNpcY = Math.min(minNpcY, npc.y); maxNpcY = Math.max(maxNpcY, npc.y);
    previousHumanX = human.x;
    previousNpcX = npc.x;
  }
  assert.ok(maxHumanX - minHumanX > 15);
  assert.ok(maxNpcX - minNpcX > 40);
  assert.ok(maxNpcY - minNpcY > 20);
  assert.ok(engine.npcs.every((kite) => kite.attack === null));
});

test("likes, roses, and premium gifts take distinct smooth paths but only crossed lines deal damage", () => {
  const strike = (kind) => {
    const game = round({ rules: { lobbyMs: 100, npcAttackMs: 100000 } });
    game.engine.chat(user("a")); game.engine.chat(user("b"));
    game.advance(101);
    const attacker = game.engine.kites[0];
    if (kind === "like") game.engine.like({ ...user("a"), likeCount: 1 });
    else game.engine.gift({ ...user("a"), giftName: kind === "gift" ? "Rosa" : "Turbo",
      giftValue: kind === "gift" ? 1 : 50 }, 1, kind === "gift");
    const attack = attacker.attack;
    assert.equal(game.engine._pose(attacker, attack.started).x, attack.fromX);
    assert.equal(game.engine._pose(attacker, attack.started).y, attack.fromY);
    const midway = game.engine._pose(attacker, attack.started + 250);
    const blade = game.engine._pose(attacker, attack.impact);
    const victim = game.engine._pose(game.engine.kites[1], attack.impact);
    assert.ok(Math.abs(blade.x - attack.crossX) < 1e-9);
    assert.ok(Math.abs(blade.y - attack.crossY) < 1e-9);
    const atEnd = game.engine._pose(attacker, attack.end);
    const idleAtEnd = game.engine._basePose(attacker, attack.end);
    assert.ok(Math.hypot(atEnd.x - idleAtEnd.x, atEnd.y - idleAtEnd.y) < 1e-8);
    assert.equal(segmentsIntersect(
      { x: attacker.anchorX, y: attacker.anchorY }, blade,
      { x: game.engine.kites[1].anchorX, y: game.engine.kites[1].anchorY }, victim,
    ), true);
    game.advance(attack.impact - game.now());
    return { game, midway, duration: attack.impact - attack.started };
  };
  const like = strike("like");
  const rose = strike("gift");
  const premium = strike("special");
  assert.deepEqual([like.duration, rose.duration, premium.duration], [520, 640, 550]);
  assert.equal(new Set([like, rose, premium].map(({ midway }) =>
    `${midway.x.toFixed(2)}:${midway.y.toFixed(2)}`)).size, 3);
  assert.equal(like.game.engine.kites[1].hp, 99.45);
  assert.equal(rose.game.engine.kites[1].hp, 75);
  assert.equal(premium.game.engine.kites[1].hp, 0);
  assert.equal(premium.game.engine.pilots.get("a").trophies, 1);
  assert.equal(KITE_RULES.roseDamage, 25);
  assert.equal(KITE_RULES.likeDamage, .55);
});
