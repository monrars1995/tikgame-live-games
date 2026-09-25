import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const context = { module: { exports: {} }, console, Date };
const load = (relative) => runInNewContext(readFileSync(resolve(root, relative), "utf8"), context, { filename: relative });
load("public/games/shared/live-utils.js");
context.LiveGameUtils = context.module.exports;
context.module = { exports: {} };
load("public/games/roses-vs-hearts/duel-engine.js");
const DuelEngine = context.module.exports;
const user = (uniqueId) => ({ uniqueId, nickname: uniqueId });

test("chat escolhe torcida; texto livre alterna participantes e não duplica entrada", () => {
	const engine = new DuelEngine();
	engine.handleChat({ user: user("ana"), comment: "ROSA" });
	engine.handleChat({ user: user("bia"), comment: "coração" });
	engine.handleChat({ user: user("cami"), comment: "cheguei" });
	engine.handleChat({ user: user("cami"), comment: "likes" });
	assert.equal(engine.state.phase, "running");
	assert.equal(engine.participants.get("ana").side, "roses");
	assert.equal(engine.participants.get("bia").side, "hearts");
	assert.equal(engine.participants.get("cami").side, "roses");
	assert.equal(engine.state.joined.roses, 2);
	assert.equal(engine.state.joined.hearts, 1);
});

test("cinco rosas em combo dão cinco unidades; replay não dobra e likes são mais fracos", () => {
	const engine = new DuelEngine();
	const gift = (repeatCount, repeatEnd = false) => ({
		user: user("ana"), giftId: 5655, giftName: "Rose", giftValue: 1,
		comboId: "combo-1", repeatCount, repeatEnd,
	});
	for (const count of [1, 2, 5]) engine.handleGift(gift(count));
	assert.equal(engine.handleGift(gift(5, true)), 0);
	assert.equal(engine.state.roseGifts, 5);
	assert.equal(engine.state.roseCoins, 5);
	assert.equal(engine.state.heartsHealth, 960);
	assert.equal(engine.handleLike({ user: user("bia"), likeCount: 10 }), 10);
	assert.equal(engine.state.rosesHealth, 993);
	assert.ok(8 > 0.7, "cada Rosa causa mais impacto que um tap");
	assert.equal(engine.top("roses")[0].name, "ana");
	assert.equal(engine.top("hearts")[0].value, 10);
});

test("presente de 50 moedas antes do chat entra na disputa e respeita valor do item", () => {
	const engine = new DuelEngine();
	engine.handleGift({ user: user("bruna"), giftId: 123, giftName: "Perfume", giftValue: 50, repeatCount: 1 });
	assert.equal(engine.state.phase, "running");
	assert.equal(engine.participants.get("bruna").side, "roses");
	assert.equal(engine.state.roseCoins, 50);
	assert.equal(engine.state.heartsHealth, 600);
	engine.handleChat({ user: user("bruna"), comment: "coração" });
	assert.equal(engine.participants.get("bruna").side, "roses", "a torcida fica estável na rodada");
});

test("rodada tem 60 segundos, maior dano vence e a série persiste após reset", () => {
	let time = 1_000;
	const engine = new DuelEngine({ now: () => time });
	engine.handleChat({ user: user("ana"), comment: "rosa" });
	engine.handleGift({ user: user("ana"), giftValue: 1, repeatCount: 1 });
	time += 59_999;
	assert.equal(engine.tick().remainingMs, 1);
	time++;
	assert.equal(engine.tick().winner, "roses");
	assert.equal(engine.seriesWins.roses, 1);
	time += 7_000;
	assert.equal(engine.tick().phase, "waiting");
	assert.equal(engine.state.roundNumber, 2);
	assert.equal(engine.state.roseCoins, 0);
	assert.equal(engine.participants.size, 0);
	assert.equal(engine.seriesWins.roses, 1);
});

test("likes em massa podem vencer; presente na celebração fica reservado", () => {
	const engine = new DuelEngine({ maxHealth: 100 });
	engine.handleLike({ user: user("bia"), likeCount: 150 });
	assert.equal(engine.state.winner, "hearts");
	assert.equal(engine.state.rosesHealth, 0);
	assert.equal(engine.handleGift({ user: user("ana"), giftValue: 50, repeatCount: 1 }), 50);
	assert.equal(engine.state.roseCoins, 0);
	assert.equal(engine.state.queuedRoseCoins, 50);
});

test("presente pago e combo durante o resultado entram só uma vez na rodada seguinte", () => {
	let time = 0;
	const engine = new DuelEngine({ now: () => time, durationMs: 1000, cooldownMs: 1000 });
	engine.handleChat({ user: user("ana"), comment: "rosa" });
	time = 1000;
	assert.equal(engine.tick().phase, "finished");
	const combo = (repeatCount, repeatEnd = false) => ({
		user: user("bia"), giftId: 5655, giftName: "Rose", giftValue: 1,
		comboId: "combo-virada", repeatCount, repeatEnd,
	});
	for (const count of [1, 2, 5]) engine.handleGift(combo(count));
	assert.equal(engine.handleGift(combo(5, true)), 0);
	engine.handleGift({ user: user("cami"), giftId: 123, giftName: "Perfume", giftValue: 50, repeatCount: 1 });
	assert.equal(engine.state.roseCoins, 0, "o resultado anterior não muda");
	assert.equal(engine.state.queuedRoseCoins, 55);
	time = 2000;
	engine.tick();
	assert.equal(engine.state.roundNumber, 2);
	assert.equal(engine.state.phase, "running");
	assert.equal(engine.state.roseCoins, 55);
	assert.equal(engine.state.roseGifts, 6);
	assert.equal(engine.state.heartsHealth, 560);
	assert.equal(engine.top("roses")[0].name, "cami");
	assert.equal(engine.handleGift(combo(5, true)), 0, "fim de combo após a virada não duplica");
	assert.equal(engine.state.roseCoins, 55);
});

test("todos os presentes reservados recebem crédito mesmo se o primeiro já nocautear", () => {
	let time = 0;
	const engine = new DuelEngine({ now: () => time, durationMs: 1000, cooldownMs: 1000, maxHealth: 100 });
	engine.handleChat({ user: user("ana"), comment: "rosa" });
	time = 1000;
	engine.tick();
	engine.handleGift({ user: user("bia"), giftName: "Perfume", giftValue: 50, repeatCount: 1 });
	engine.handleGift({ user: user("cami"), giftName: "Rose", giftValue: 1, repeatCount: 5 });
	time = 2000;
	engine.tick();
	assert.equal(engine.state.roundNumber, 2);
	assert.equal(engine.state.winner, "roses");
	assert.equal(engine.state.roseCoins, 55);
	assert.equal(engine.state.roseGifts, 6);
	assert.equal(engine.top("roses").length, 2);
});
