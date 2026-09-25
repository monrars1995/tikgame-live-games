import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { TikTokService } from "../src/services/TikTokService.js";
import { registerSocketHandlers } from "../src/server.js";

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

function fakeIo() {
	const events = [];
	return {
		events,
		to(room) {
			return { emit(name, payload) { events.push({ room, name, payload }); } };
		},
	};
}

class FakeConnection extends EventEmitter {
	constructor(connectResult) {
		super();
		this.connectResult = connectResult;
		this.disconnected = false;
	}
	connect() {
		return this.connectResult();
	}
	disconnect() {
		this.disconnected = true;
		this.emit("disconnected");
	}
}

test("concurrent joins await one real connection before reporting success", async (t) => {
	const gate = deferred();
	const created = [];
	const service = new TikTokService({
		connectionFactory: () => {
			const connection = new FakeConnection(() => gate.promise);
			created.push(connection);
			return connection;
		},
	});
	t.after(() => {
		clearInterval(service.cleanupInterval);
		service.disconnect("streamer");
	});
	const io = fakeIo();
	service.addClientToRoom("streamer");
	let settled = false;
	const first = service.connect("streamer", io).then((value) => {
		settled = true;
		return value;
	});
	const second = service.connect("streamer", io);
	assert.equal(created.length, 1);
	assert.equal(service.getStats().activeConnections, 0);
	await setImmediate();
	assert.equal(settled, false);
	assert.equal(io.events.filter((event) => event.name === "tiktok_connected").length, 0);
	gate.resolve({ roomId: "room-1" });
	assert.deepEqual(await Promise.all([first, second]), [true, true]);
	assert.equal(service.getStats().activeConnections, 1);
	assert.equal(io.events.filter((event) => event.name === "tiktok_connected").length, 1);
});

test("first connection failure retries and a subsequent attempt can recover", async (t) => {
	const retryGate = deferred();
	let created = 0;
	const service = new TikTokService({
		connectionFactory: () => {
			created++;
			return new FakeConnection(() => created === 1
				? Promise.reject(new Error("temporarily offline"))
				: Promise.resolve({ roomId: "room-2" }));
		},
		delayForAttempt: () => 0,
		wait: () => retryGate.promise,
	});
	t.after(() => {
		clearInterval(service.cleanupInterval);
		service.disconnect("streamer");
	});
	const io = fakeIo();
	service.addClientToRoom("streamer");
	assert.equal(await service.connect("streamer", io), false);
	assert.equal(created, 1);
	const retry = service.reconnectState.get("streamer");
	assert.ok(retry);
	assert.equal(io.events.filter((event) => event.name === "tiktok_reconnecting").length, 1);
	retryGate.resolve();
	await retry.promise;
	assert.equal(created, 2);
	assert.equal(service.getStats().activeConnections, 1);
	assert.equal(io.events.filter((event) => event.name === "tiktok_connected").length, 1);
});

test("leaving the last room cancels a scheduled retry", async (t) => {
	const retryGate = deferred();
	let created = 0;
	const service = new TikTokService({
		connectionFactory: () => {
			created++;
			return new FakeConnection(() => Promise.reject(new Error("offline")));
		},
		wait: () => retryGate.promise,
	});
	t.after(() => clearInterval(service.cleanupInterval));
	service.addClientToRoom("streamer");
	assert.equal(await service.connect("streamer", fakeIo()), false);
	const retry = service.reconnectState.get("streamer");
	assert.ok(retry);
	assert.equal(service.removeClientFromRoom("streamer"), 0);
	retryGate.resolve();
	await retry.promise;
	assert.equal(created, 1);
	assert.equal(service.reconnectState.has("streamer"), false);
});

test("an established connection reconnects after a network disconnect", async (t) => {
	const retryGate = deferred();
	const created = [];
	const service = new TikTokService({
		connectionFactory: () => {
			const connection = new FakeConnection(() => Promise.resolve({ roomId: "room-3" }));
			created.push(connection);
			return connection;
		},
		wait: () => retryGate.promise,
	});
	t.after(() => {
		clearInterval(service.cleanupInterval);
		service.disconnect("streamer");
	});
	const io = fakeIo();
	service.addClientToRoom("streamer");
	assert.equal(await service.connect("streamer", io), true);
	created[0].emit("disconnected");
	assert.equal(service.getStats().activeConnections, 0);
	const retry = service.reconnectState.get("streamer");
	assert.ok(retry);
	retryGate.resolve();
	await retry.promise;
	assert.equal(created.length, 2);
	assert.equal(service.getStats().activeConnections, 1);
	assert.equal(io.events.filter((event) => event.name === "tiktok_disconnected").length, 1);
	assert.equal(io.events.filter((event) => event.name === "tiktok_connected").length, 2);
});

test("a room without viewers closes after five minutes even if the live keeps emitting", async (t) => {
	const connection = new FakeConnection(() => Promise.resolve({ roomId: "room-4" }));
	const service = new TikTokService({ connectionFactory: () => connection });
	t.after(() => clearInterval(service.cleanupInterval));
	service.addClientToRoom("streamer");
	assert.equal(await service.connect("streamer", fakeIo()), true);
	service.removeClientFromRoom("streamer");
	const record = service.connections.get("streamer");
	record.noClientsSince = Date.now() - 5 * 60_000 - 1;
	service.updateActivity("streamer");
	service.checkInactiveConnections();
	assert.equal(service.getStats().activeConnections, 0);
	assert.equal(connection.disconnected, true);
});

class FakeSocket extends EventEmitter {
	constructor() {
		super();
		this.id = "socket-1";
		this.rooms = new Set();
		this.sent = [];
	}
	emit(name, ...args) {
		if (["room-joined", "connection-error", "error"].includes(name)) {
			this.sent.push({ name, payload: args[0] });
		}
		return super.emit(name, ...args);
	}
	join(room) { this.rooms.add(room); }
	leave(room) { this.rooms.delete(room); }
}

test("socket room membership is idempotent and suppresses stale join results", async () => {
	const firstJoin = deferred();
	const socket = new FakeSocket();
	const counts = new Map();
	let connectCalls = 0;
	const service = {
		addClientToRoom: (room) => counts.set(room, (counts.get(room) || 0) + 1),
		removeClientFromRoom: (room) => counts.set(room, (counts.get(room) || 0) - 1),
		connect: (room) => {
			connectCalls++;
			return room === "alice" ? firstJoin.promise : Promise.resolve(true);
		},
	};
	registerSocketHandlers(socket, fakeIo(), service);
	socket.emit("join-room", "@Alice");
	socket.emit("join-room", "alice");
	assert.equal(counts.get("alice"), 1);
	assert.equal(connectCalls, 1);
	socket.emit("join-room", "Bob");
	assert.equal(counts.get("alice"), 0);
	assert.equal(counts.get("bob"), 1);
	firstJoin.resolve(true);
	await setImmediate();
	assert.deepEqual(socket.sent.filter((event) => event.name === "room-joined").map((event) => event.payload.room), ["bob"]);
	socket.emit("leave-room", "bob");
	socket.emit("leave-room", "bob");
	socket.emit("disconnect");
	assert.equal(counts.get("bob"), 0);
	assert.equal(socket.rooms.size, 0);
});
