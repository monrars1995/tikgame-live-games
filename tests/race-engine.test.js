import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function loadClassic(relativePath) {
	const context = { module: { exports: {} }, console };
	runInNewContext(readFileSync(resolve(root, relativePath), "utf8"), context, { filename: relativePath });
	return context.module.exports;
}

const config = loadClassic("public/games/horse-racing/config.js");
const RaceEngine = loadClassic("public/games/horse-racing/race-engine.js");
const user = (uniqueId) => ({ uniqueId, nickname: uniqueId });

test("primeiro comentário escolhe o cavalo e o mesmo usuário não troca no meio da corrida", () => {
	const engine = new RaceEngine(config);
	engine.handleChat({ user: user("ana"), comment: "2" });
	assert.equal(engine.state.phase, "countdown");
	assert.equal(engine.state.userLanes.get("ana"), 1);
	assert.equal(engine.state.lanes[1].distance, config.chatDistance);
	engine.handleChat({ user: user("ana"), comment: "1" });
	assert.equal(engine.state.userLanes.get("ana"), 1);
	assert.equal(engine.state.lanes[1].distance, config.chatDistance, "spam de chat respeita o intervalo");
	engine.handleChat({ user: user("bia"), comment: "olá" });
	assert.equal(engine.state.userLanes.get("bia"), 0, "texto livre entra no próximo cavalo");
});

test("Rosa em combo soma apenas unidades novas; curtidas são mais fracas", () => {
	const engine = new RaceEngine(config);
	const rose = (repeatCount, repeatEnd = false) => ({
		user: user("ana"), giftId: 5655, giftName: "Rose", giftValue: 1,
		comboId: "grupo-1", repeatCount, repeatEnd,
	});
	engine.handleChat({ user: user("ana"), comment: "3" });
	engine.handleGift(rose(1));
	engine.handleGift(rose(2));
	engine.handleGift(rose(5));
	engine.handleGift(rose(5, true));
	const beforeLike = engine.state.lanes[2].distance;
	assert.equal(beforeLike, config.chatDistance + 5 * config.giftToDistance(1));
	engine.handleLike({ user: user("ana"), likeCount: 10 });
	assert.equal(engine.state.lanes[2].distance - beforeLike, 10 * config.likeDistance);
	assert.ok(config.giftToDistance(50) > 5 * config.giftToDistance(1));
	assert.equal(config.getGiftEmoji("Rosa"), "🌹");
});

test("presentes sem comentário entram no próximo cavalo e a chegada declara vencedor", () => {
	const shortRace = { ...config, finishLine: 20 };
	const engine = new RaceEngine(shortRace);
	engine.handleGift({ user: user("cami"), giftName: "Perfume", giftValue: 50, repeatCount: 1 });
	assert.equal(engine.state.userLanes.get("cami"), 0);
	assert.equal(engine.state.phase, "countdown");
	engine._setPhase("racing");
	engine.handleGift({ user: user("cami"), giftName: "Rose", giftValue: 1, repeatCount: 1 });
	assert.equal(engine.state.phase, "finished");
	assert.equal(engine.state.winner.id, 0);
});

test("combo sem identificador de grupo ainda aplica apenas o delta cumulativo", () => {
	const engine = new RaceEngine(config);
	for (const repeatCount of [1, 2, 5, 5]) {
		engine.handleGift({ user: user("duda"), giftId: 5655, giftName: "Rose", giftValue: 1, isCombo: true, repeatCount, repeatEnd: repeatCount === 5 });
	}
	assert.equal(engine.state.lanes[0].distance, 5 * config.giftToDistance(1));
});

test("presente repetido com o mesmo ID de mensagem não ganha impulso duas vezes", () => {
	const engine = new RaceEngine(config);
	const event = { user: user("evelyn"), giftId: 5655, giftName: "Rose", giftValue: 1, messageId: "msg-7", repeatCount: 1, repeatEnd: true };
	engine.handleGift(event);
	engine.handleGift(event);
	assert.equal(engine.state.lanes[0].distance, config.giftToDistance(1));
});

test("impulso que alcança a chegada no countdown termina ao abrir a corrida", () => {
	const engine = new RaceEngine({ ...config, finishLine: 8, phases: { ...config.phases, countdown: { duration: 0 } } });
	engine.handleGift({ user: user("fran"), giftName: "Rosa", giftValue: 1, repeatCount: 1 });
	assert.equal(engine.state.phase, "countdown");
	engine.tick();
	assert.equal(engine.state.phase, "finished");
	assert.equal(engine.state.winner.id, 0);
});

test("feed atualiza mesmo após atingir o limite e reset limpa os participantes", () => {
	const engine = new RaceEngine(config);
	for (let i = 0; i < 25; i++) engine.handleChat({ user: user(`u${i}`), comment: "1" });
	assert.equal(engine.state.recentEvents.length, 20);
	assert.equal(engine.state.recentEvents[0].nickname, "u24");
	engine.reset();
	assert.equal(engine.state.userLanes.size, 0);
	assert.equal(engine.state.recentEvents.length, 0);
});
