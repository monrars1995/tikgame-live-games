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

test("structured TikTok failure and retry preserve the specific cause until recovery", () => {
	const { bridge, sockets } = setup();
	const errors = [];
	const retries = [];
	bridge.on("error", (value) => errors.push(value));
	bridge.on("reconnecting", (value) => retries.push(value));
	bridge.connect("@streamer");
	const socket = sockets[0];
	socket.deliver("connect");
	const failure = {
		code: "LIVE_NOT_FOUND", message: "Live não encontrada", retryable: true,
		username: "streamer", timestamp: 42,
	};
	socket.deliver("connection-error", failure);
	assert.equal(errors[0].source, "tiktok");
	assert.equal(errors[0].code, "LIVE_NOT_FOUND");
	assert.equal(errors[0].username, "streamer");
	assert.equal(errors[0].timestamp, 42);

	socket.deliver("tiktok_reconnecting", { username: "streamer", attempt: 2, maxAttempts: 5, delayMs: 4000 });
	assert.equal(retries[0].source, "tiktok");
	assert.equal(retries[0].attempt, 2);
	assert.equal(retries[0].maxAttempts, 5);
	assert.equal(retries[0].lastError.code, "LIVE_NOT_FOUND");

	socket.deliver("tiktok_connected", { roomId: "recovered" });
	assert.equal(bridge.lastError, null);
	socket.deliver("tiktok_reconnecting", { username: "streamer", attempt: 1, maxAttempts: 5, delayMs: 2000 });
	assert.equal(retries[1].lastError, null);
});

test("final exhausted state is delivered as an error and not converted into a retry", () => {
	const { bridge, sockets } = setup();
	const errors = [];
	const retries = [];
	bridge.on("error", (value) => errors.push(value));
	bridge.on("reconnecting", (value) => retries.push(value));
	bridge.connect("streamer");
	const socket = sockets[0];
	socket.deliver("connect");
	socket.deliver("tiktok_error", {
		code: "RECONNECT_EXHAUSTED", message: "Falha após 5 tentativas", retryable: false,
		username: "streamer", exhausted: true, timestamp: 84,
	});
	assert.equal(errors.length, 1);
	assert.equal(errors[0].source, "tiktok");
	assert.equal(errors[0].exhausted, true);
	assert.equal(errors[0].retryable, false);
	assert.equal(retries.length, 0);
});

test("local socket failure stays separate from TikTok failure and ignores stale room errors", () => {
	const { bridge, sockets } = setup();
	const errors = [];
	const retries = [];
	bridge.on("error", (value) => errors.push(value));
	bridge.on("reconnecting", (value) => retries.push(value));
	bridge.connect("alpha");
	const socket = sockets[0];
	socket.deliver("connect");
	bridge.connect("beta");
	socket.deliver("connection-error", { username: "alpha", code: "LIVE_OFFLINE", message: "old room" });
	socket.deliver("tiktok_reconnecting", { username: "alpha", attempt: 1 });
	assert.equal(errors.length, 0);
	assert.equal(retries.length, 0);
	socket.deliver("connect_error", new Error("transport close"));
	assert.equal(errors[0].source, "local");
	assert.equal(errors[0].code, "LOCAL_SOCKET_ERROR");
	assert.equal(errors[0].message, "transport close");
	socket.deliver("disconnect");
	assert.equal(retries[0].source, "local");
	assert.equal(retries[0].lastError, null);
});
