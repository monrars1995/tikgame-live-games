import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../public/games/top-coins-vs-taps/engine.js", import.meta.url), "utf8");
const context = { module: { exports: {} } };
runInNewContext(source, context);
const Engine = context.module.exports;
const user = (id) => ({ user: { uniqueId: id, nickname: id } });

test("presentes acumulam valor por usuário e combo incremental", () => {
	const engine = new Engine();
	engine.gift({ ...user("ana"), giftName: "Rosa", giftValue: 1, repeatCount: 5 }, 5);
	engine.gift({ ...user("bia"), giftName: "Ouro", giftValue: 50, repeatCount: 1 }, 1);
	const state = engine.snapshot();
	assert.equal(state.coinTotal, 55);
	assert.equal(state.coins[0].id, "bia");
	assert.equal(state.topGift.value, 50);
	assert.equal(state.topCombo.count, 5);
});

test("taps ordenam participantes separadamente das moedas", () => {
	const engine = new Engine();
	engine.like({ ...user("ana"), likeCount: 15 });
	engine.like({ ...user("bia"), likeCount: 30 });
	engine.gift({ ...user("ana"), giftValue: 1 }, 1);
	assert.equal(engine.snapshot().taps[0].id, "bia");
	assert.equal(engine.snapshot().coins[0].id, "ana");
	assert.equal(engine.snapshot().tapTotal, 45);
});

test("timer declara vitória por poder normalizado e reinicia limpo", () => {
	let time = 1_000;
	const engine = new Engine({ now: () => time, durationMs: 60_000, resultMs: 2_000 });
	engine.like({ ...user("ana"), likeCount: 25 });
	time += 60_000;
	assert.equal(engine.tick().winner, "taps");
	assert.equal(engine.snapshot().remainingMs, 0);
	time += 2_000;
	const reset = engine.tick();
	assert.equal(reset.phase, "waiting");
	assert.equal(reset.round, 2);
	assert.equal(reset.tapTotal, 0);
});

test("presente no banner de resultado entra na rodada seguinte", () => {
	let time = 1_000;
	const engine = new Engine({ now: () => time, durationMs: 1_000, resultMs: 2_000 });
	engine.like({ ...user("lia"), likeCount: 2 });
	time += 1_000;
	engine.tick();
	assert.equal(engine.snapshot().phase, "finished");
	engine.gift({ ...user("ana"), giftName: "Rosa", giftValue: 1, repeatCount: 5 }, 5);
	engine.gift({ ...user("bia"), giftName: "Ouro", giftValue: 50, repeatCount: 1 }, 1);
	assert.equal(engine.snapshot().coinTotal, 0);
	time += 2_000;
	const next = engine.tick();
	assert.equal(next.round, 2);
	assert.equal(next.coinTotal, 55);
	assert.equal(next.coins[0].id, "bia");
	assert.equal(next.topCombo.count, 5);
	assert.equal(next.phase, "running");
});
