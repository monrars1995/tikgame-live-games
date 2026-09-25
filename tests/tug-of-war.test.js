import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function loadClassic(path) {
	const context = { module: { exports: {} }, console };
	runInNewContext(readFileSync(resolve(root, path), "utf8"), context, { filename: path });
	return context.module.exports;
}
const utils = loadClassic("public/games/shared/live-utils.js");
const TugEngine = loadClassic("public/games/tug-of-war/tug-engine.js");
const user = (id) => ({ user: { uniqueId: id, nickname: id } });

test("comentário escolhe equipe, texto livre equilibra novas entradas e o time permanece", () => {
	let now = 1_000;
	const game = new TugEngine({ utils, now: () => now });
	game.handleChat({ ...user("ana"), comment: "azul" });
	game.handleChat({ ...user("bia"), comment: "olá" });
	game.handleChat({ ...user("cai"), comment: "2" });
	assert.equal(game.members.get("ana").teamIdx, 0);
	assert.equal(game.members.get("bia").teamIdx, 1);
	assert.equal(game.members.get("cai").teamIdx, 1);
	assert.equal(game.state.phase, "running");
	const power = game.members.get("ana").power;
	game.handleChat({ ...user("ana"), comment: "vermelho" });
	assert.equal(game.members.get("ana").teamIdx, 0);
	assert.equal(game.members.get("ana").power, power, "chat repetido não gera spam imediato");
	now += 8_001;
	game.handleChat({ ...user("ana"), comment: "vermelho" });
	assert.equal(game.members.get("ana").power, power + .5);
});

test("curtidas têm menos força que rosa e combo cumulativo conta só novas unidades", () => {
	const game = new TugEngine({ utils });
	const person = user("lia");
	game.handleLike({ ...person, likeCount: 10 });
	const afterLikes = game.members.get("lia").power;
	assert.equal(afterLikes, 1.2);
	for (const repeatCount of [1, 2, 5, 5]) {
		game.handleGift({ ...person, giftId: 5655, giftName: "Rosa", giftValue: 1, comboId: "series-1", repeatCount, repeatEnd: repeatCount === 5 });
	}
	assert.equal(game.members.get("lia").power, afterLikes + 5 * 2.9);
	assert.equal(game.members.get("lia").coins, 5);
	assert.ok(2.9 > afterLikes);
});

test("presente de 50 moedas é decisivo, resultado bloqueia eventos e vitórias persistem", () => {
	let now = 10_000;
	const game = new TugEngine({ utils, now: () => now, winAt: 20, resultMs: 5_000 });
	game.handleGift({ ...user("rafa"), giftName: "Especial", giftValue: 50, repeatCount: 1, messageId: "g-1" });
	assert.equal(game.state.phase, "result");
	assert.equal(game.state.winner, 0);
	assert.equal(game.state.teams[0].wins, 1);
	const power = game.members.get("rafa").power;
	game.handleLike({ ...user("rafa"), likeCount: 100 });
	assert.equal(game.members.get("rafa").power, power);
	now += 5_001;
	game.tick();
	assert.equal(game.state.phase, "waiting");
	assert.equal(game.state.round, 2);
	assert.equal(game.state.teams[0].wins, 1);
	assert.equal(game.members.size, 0, "participantes da rodada anterior são liberados");
});

test("presentes durante a celebração entram na rodada seguinte sem duplicar", () => {
	let now = 10_000;
	const game = new TugEngine({ utils, now: () => now, winAt: 20, resultMs: 5_000 });
	game.handleGift({ ...user("ana"), giftName: "Especial", giftValue: 50, repeatCount: 1, messageId: "first" });
	assert.equal(game.state.phase, "result");
	const rose = { ...user("bia"), giftName: "Rosa", giftId: 5655, giftValue: 1, repeatCount: 1, messageId: "during" };
	game.handleGift(rose);
	game.handleGift(rose);
	assert.equal(game.pendingGifts.size, 1);
	now += 5_001;
	game.tick();
	assert.equal(game.state.round, 2);
	assert.equal(game.state.phase, "running");
	assert.equal(game.members.get("bia").coins, 1);
	assert.equal(game.members.get("bia").power, 2.9);
});

test("ao terminar o tempo vence quem puxou mais; sem ação não entra usuário vazio", () => {
	let now = 0;
	const game = new TugEngine({ utils, now: () => now, roundMs: 1_000 });
	game.handleChat({ ...user("a"), comment: "1" });
	game.handleChat({ ...user("b"), comment: "2" });
	game.handleLike({ ...user("b"), likeCount: 50 });
	game.handleChat({ user: {}, comment: "azul" });
	assert.equal(game.members.size, 2);
	now = 1_001;
	game.tick();
	assert.equal(game.state.phase, "result");
	assert.equal(game.state.winner, 1);
	assert.equal(game.state.teams[1].wins, 1);
});

test("ID de mensagem repetido não aplica presente duas vezes", () => {
	const game = new TugEngine({ utils });
	const rose = { ...user("bia"), giftId: 5655, giftName: "Rose", giftValue: 1, repeatCount: 1, repeatEnd: true, messageId: "same" };
	game.handleGift(rose);
	game.handleGift(rose);
	assert.equal(game.members.get("bia").coins, 1);
});
