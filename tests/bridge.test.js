import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../public/lib/tiktok-bridge.js", import.meta.url), "utf8");

class FakeSocket {
	constructor() {
		this.connected = false;
		this.handlers = new Map();
		this.sent = [];
		this.disconnectCalls = 0;
		this.connectCalls = 0;
	}

	on(name, handler) {
		const handlers = this.handlers.get(name) || [];
		handlers.push(handler);
		this.handlers.set(name, handlers);
	}

	emit(name, value) {
		this.sent.push({ name, value });
	}

	deliver(name, value) {
		if (name === "connect") this.connected = true;
		if (name === "disconnect") this.connected = false;
		for (const handler of this.handlers.get(name) || []) handler(value);
	}

	disconnect() {
		this.disconnectCalls++;
		this.deliver("disconnect");
	}

	connect() {
		this.connectCalls++;
	}
}

function setup(search = "") {
	const sockets = [];
	const listeners = new Map();
	const window = {
		location: { origin: "http://localhost:3100", search },
		addEventListener(name, callback) { listeners.set(name, callback); },
	};
	runInNewContext(source, {
		window,
		io() {
			const socket = new FakeSocket();
			sockets.push(socket);
			return socket;
		},
		URLSearchParams,
		console,
	});
	return { bridge: window.TikTokBridge, sockets, listeners };
}

test("rejoins after Socket.io loss and emits one connected event per recovery", () => {
	const { bridge, sockets } = setup();
	const connected = [];
	const disconnected = [];
	bridge.on("connected", (value) => connected.push(value));
	bridge.on("disconnected", () => disconnected.push(true));
	bridge.connect("@Alice");
	const socket = sockets[0];
	socket.deliver("connect");
	assert.deepEqual(socket.sent, [{ name: "join-room", value: "alice" }]);

	// The service broadcasts before the join acknowledgement on first connect.
	socket.deliver("tiktok_connected", { roomId: "123" });
	assert.equal(connected.length, 0);
	socket.deliver("room-joined", { room: "alice" });
	socket.deliver("tiktok_connected", { roomId: "123" });
	assert.equal(connected.length, 1);

	socket.deliver("tiktok_disconnected");
	assert.equal(disconnected.length, 1);
	socket.deliver("tiktok_reconnecting", { attempt: 1, delayMs: 100 });
	socket.deliver("tiktok_connected", { roomId: "456" });
	assert.equal(connected.length, 2);
	assert.equal(connected[1].room, "alice");

	socket.deliver("disconnect");
	socket.deliver("connect");
	assert.deepEqual(socket.sent, [
		{ name: "join-room", value: "alice" },
		{ name: "join-room", value: "alice" },
	]);
	socket.deliver("room-joined", { room: "alice" });
	assert.equal(connected.length, 3);
	assert.equal(disconnected.length, 2);
});

test("initial join failure can recover from a later tiktok_connected broadcast", () => {
	const { bridge, sockets } = setup();
	const connected = [];
	const errors = [];
	bridge.on("connected", (value) => connected.push(value));
	bridge.on("error", (value) => errors.push(value));
	bridge.connect("streamer");
	const socket = sockets[0];
	socket.deliver("connect");
	socket.deliver("connection-error", { message: "offline" });
	assert.equal(errors.length, 1);
	socket.deliver("tiktok_reconnecting", { attempt: 1, delayMs: 100 });
	socket.deliver("tiktok_connected", { roomId: "late" });
	assert.equal(connected.length, 1);
	assert.equal(connected[0].room, "streamer");
});

test("switches rooms and retries without creating duplicate handlers", () => {
	const { bridge, sockets } = setup();
	let chats = 0;
	const connected = [];
	bridge.on("chat", () => chats++);
	bridge.on("connected", (value) => connected.push(value.room));
	bridge.connect("alpha");
	const socket = sockets[0];
	socket.deliver("connect");
	socket.deliver("room-joined", { room: "alpha" });

	bridge.connect("@Beta");
	assert.equal(sockets.length, 1);
	assert.equal(socket.handlers.get("tiktok_chat").length, 1);
	socket.deliver("tiktok_chat", { comment: "old room" });
	socket.deliver("room-joined", { room: "alpha" });
	assert.equal(chats, 0);
	assert.equal(connected.length, 1);
	socket.deliver("room-joined", { room: "beta" });
	socket.deliver("tiktok_chat", { comment: "new room" });
	assert.equal(chats, 1);
	assert.deepEqual(connected, ["alpha", "beta"]);
	assert.deepEqual(socket.sent.map(({ value }) => value), ["alpha", "beta"]);

	bridge.connect("beta"); // Already connected: no redundant join.
	assert.equal(socket.sent.length, 2);
	socket.deliver("tiktok_disconnected");
	bridge.connect("beta"); // Explicit retry after a failed connection.
	assert.equal(socket.sent.length, 3);
	assert.equal(socket.sent[2].value, "beta");
});

test("changing the server discards stale socket events and joins the new one", () => {
	const { bridge, sockets } = setup();
	let chats = 0;
	bridge.on("chat", () => chats++);
	bridge.connect("alpha");
	const oldSocket = sockets[0];
	oldSocket.deliver("connect");
	oldSocket.deliver("room-joined", { room: "alpha" });

	bridge.connect("alpha", "http://localhost:3200");
	assert.equal(oldSocket.disconnectCalls, 1);
	const newSocket = sockets[1];
	oldSocket.deliver("tiktok_chat", { comment: "stale" });
	assert.equal(chats, 0);
	newSocket.deliver("connect");
	assert.deepEqual(newSocket.sent, [{ name: "join-room", value: "alpha" }]);
	newSocket.deliver("room-joined", { room: "alpha" });
	newSocket.deliver("tiktok_chat", { comment: "fresh" });
	assert.equal(chats, 1);
});

test("retry restarts a socket that stopped reconnecting automatically", () => {
	const { bridge, sockets } = setup();
	bridge.connect("alpha");
	const socket = sockets[0];
	socket.deliver("connect");
	socket.deliver("room-joined", { room: "alpha" });
	socket.deliver("disconnect");
	bridge.connect("alpha");
	assert.equal(socket.connectCalls, 1);
	socket.deliver("connect");
	assert.deepEqual(socket.sent.map(({ value }) => value), ["alpha", "alpha"]);
});
