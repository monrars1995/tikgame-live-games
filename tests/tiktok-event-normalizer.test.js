import test from "node:test";
import assert from "node:assert/strict";
import { normalizeChat, normalizeGift, normalizeLike } from "../src/lib/tiktokEventNormalizer.js";

test("normaliza usuário e chat no formato aninhado do conector 2.x", () => {
	const event = normalizeChat({ user: { displayId: "monrars", nickname: "Mon" }, content: "2" });
	assert.equal(event.user.uniqueId, "monrars");
	assert.equal(event.user.nickname, "Mon");
	assert.equal(event.comment, "2");
});

test("preserva rosa, valor, grupo e fim de combo", () => {
	const event = normalizeGift({
		user: { uniqueId: "ana", nickname: "Ana" },
		gift: { id: 5655, name: "Rose", diamondCount: 1, type: 1 },
		groupId: "combo-123", repeatCount: 5, repeatEnd: 1,
	});
	assert.equal(event.giftName, "Rose");
	assert.equal(event.giftId, 5655);
	assert.equal(event.giftValue, 1);
	assert.equal(event.repeatCount, 5);
	assert.equal(event.repeatEnd, true);
	assert.equal(event.isCombo, true);
	assert.equal(event.comboId, "combo-123");
});

test("usa a contagem de curtidas do conector 2.x", () => {
	const event = normalizeLike({ user: { displayId: "bia" }, count: 30, totalLikeCount: 250 });
	assert.equal(event.user.uniqueId, "bia");
	assert.equal(event.likeCount, 30);
	assert.equal(event.totalLikeCount, 250);
});

test("valor zero no campo legado não oculta moedas no presente aninhado", () => {
	const event = normalizeGift({ user: { displayId: "ana" }, diamondCount: 0, gift: { name: "Ouro", diamondCount: 50 } });
	assert.equal(event.giftValue, 50);
});
