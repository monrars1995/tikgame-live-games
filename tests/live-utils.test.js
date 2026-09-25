import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../public/games/shared/live-utils.js", import.meta.url), "utf8");
const context = { module: { exports: {} } };
runInNewContext(source, context);
const { GiftTracker, viewer, isRose } = context.module.exports;

test("viewer normaliza identidade e detecta Rosa por nome ou ID", () => {
	assert.equal(viewer({ user: { uniqueId: "@Ana", nickname: "Ana" } }).id, "@ana");
	assert.equal(isRose({ giftName: "Rosa" }), true);
	assert.equal(isRose({ giftId: 5655 }), true);
});

test("combo de cinco Rosas incrementa somente cinco unidades", () => {
	const tracker = new GiftTracker();
	const event = (count, repeatEnd = false) => ({ user: { uniqueId: "ana" }, giftId: 5655, comboId: "g1", repeatCount: count, repeatEnd });
	assert.equal(tracker.consume(event(1)), 1);
	assert.equal(tracker.consume(event(2)), 1);
	assert.equal(tracker.consume(event(5)), 3);
	assert.equal(tracker.consume(event(5, true)), 0);
	assert.equal(tracker.consume(event(5, true)), 0);
});

test("presentes avulsos contam individualmente, mas mensagem duplicada é ignorada", () => {
	const tracker = new GiftTracker();
	const gift = { user: { uniqueId: "ana" }, giftName: "Rosa", repeatCount: 1, messageId: "m1" };
	assert.equal(tracker.consume(gift), 1);
	assert.equal(tracker.consume(gift), 0);
	assert.equal(tracker.consume({ ...gift, messageId: "m2" }), 1);
});
