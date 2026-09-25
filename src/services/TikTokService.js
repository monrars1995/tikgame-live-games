/** TikTok connections and event delivery for independent streamer rooms. */
import { TikTokLiveConnection } from "tiktok-live-connector";
import {
	normalizeChat,
	normalizeGift,
	normalizeLike,
	normalizeShare,
} from "../lib/tiktokEventNormalizer.js";
import { getDelay, shouldRetry, sleep } from "../lib/tiktokReconnectPolicy.js";

export class TikTokService {
	constructor({
		connectionFactory = (username, options) => new TikTokLiveConnection(username, options),
		delayForAttempt = getDelay,
		canRetry = shouldRetry,
		wait = sleep,
		cleanupIntervalMs = 60_000,
	} = {}) {
		this.connectionFactory = connectionFactory;
		this.delayForAttempt = delayForAttempt;
		this.canRetry = canRetry;
		this.wait = wait;
		this.connections = new Map();
		this.connecting = new Map();
		this.connectingRecords = new Map();
		this.roomClients = new Map();
		this.reconnectState = new Map();
		this.cleanupInterval = setInterval(() => this.checkInactiveConnections(), cleanupIntervalMs);
		this.cleanupInterval.unref?.();
	}

	/** Reuse an established connection or await the same in-flight attempt. */
	async connect(username, io, { retry = false } = {}) {
		const active = this.connections.get(username);
		if (active && !active.closed) {
			active.lastActivity = Date.now();
			return true;
		}
		const pending = this.connecting.get(username);
		if (pending) return pending;

		const attempt = this._connectOnce(username, io);
		this.connecting.set(username, attempt);
		let connected = false;
		try {
			connected = await attempt;
		} finally {
			if (this.connecting.get(username) === attempt) this.connecting.delete(username);
		}
		if (!connected && !retry && this.getClientCount(username) > 0) {
			this._scheduleReconnect(username, io);
		}
		return connected;
	}

	async _connectOnce(username, io) {
		let record;
		try {
			const connection = this.connectionFactory(username, {
				processInitialData: true,
				enableExtendedGiftInfo: true,
			});
			record = {
				connection, io, closed: false, ready: false,
				connectedEmitted: false, roomId: undefined, lastActivity: Date.now(),
			};
			this.connectingRecords.set(username, record);
			const emitConnected = () => {
				if (record.closed || record.connectedEmitted) return;
				record.connectedEmitted = true;
				io.to(username).emit("tiktok_connected", {
					roomId: record.roomId,
					timestamp: Date.now(),
				});
			};

			connection.on("chat", (data) => {
				if (record.closed) return;
				this.updateActivity(username);
				io.to(username).emit("tiktok_chat", normalizeChat(data));
			});
			connection.on("like", (data) => {
				if (record.closed) return;
				this.updateActivity(username);
				io.to(username).emit("tiktok_like", normalizeLike(data));
			});
			connection.on("social", (data) => {
				if (record.closed || data.displayType !== "pm_mt_msg_viewer_share") return;
				this.updateActivity(username);
				io.to(username).emit("tiktok_share", normalizeShare(data));
			});
			connection.on("gift", (data) => {
				if (record.closed) return;
				this.updateActivity(username);
				io.to(username).emit("tiktok_gift", normalizeGift(data));
			});
			connection.on("connected", (state) => {
				if (record.closed) return;
				record.roomId = state?.roomId ?? record.roomId;
				if (record.ready) emitConnected();
			});
			connection.on("disconnected", () => {
				if (record.closed) return;
				record.closed = true;
				if (this.connections.get(username) !== record) return;
				this.connections.delete(username);
				io.to(username).emit("tiktok_disconnected", { timestamp: Date.now() });
				if (this.getClientCount(username) > 0) this._scheduleReconnect(username, io);
			});
			connection.on("error", (error) => {
				if (record.closed) return;
				io.to(username).emit("tiktok_error", {
					message: error?.message || String(error),
					timestamp: Date.now(),
				});
			});

			const state = await connection.connect();
			if (record.closed) return false;
			record.ready = true;
			record.roomId = record.roomId ?? state?.roomId ?? connection.state?.roomId;
			this.connections.set(username, record);
			emitConnected();
			return true;
		} catch (error) {
			console.error(`[TikTokService] Cannot connect to ${username}:`, error?.message);
			if (record) {
				record.closed = true;
				this._closeConnection(record.connection);
			}
			return false;
		} finally {
			if (this.connectingRecords.get(username) === record) {
				this.connectingRecords.delete(username);
			}
		}
	}

	_scheduleReconnect(username, io) {
		if (this.reconnectState.has(username) || this.getClientCount(username) === 0) return;
		const state = { cancelled: false, attempt: 0, promise: null };
		this.reconnectState.set(username, state);
		state.promise = this._runReconnect(username, io, state).finally(() => {
			if (this.reconnectState.get(username) === state) this.reconnectState.delete(username);
		});
	}

	async _runReconnect(username, io, state) {
		while (this.canRetry(state.attempt)) {
			if (state.cancelled || this.getClientCount(username) === 0 || this.connections.has(username)) return;
			const delayMs = this.delayForAttempt(state.attempt);
			io.to(username).emit("tiktok_reconnecting", {
				attempt: state.attempt + 1, delayMs, timestamp: Date.now(),
			});
			await this.wait(delayMs);
			if (state.cancelled || this.getClientCount(username) === 0 || this.connections.has(username)) return;
			if (await this.connect(username, io, { retry: true })) return;
			state.attempt++;
		}
		if (!state.cancelled && this.getClientCount(username) > 0) {
			io.to(username).emit("tiktok_error", {
				message: `Reconnect failed after ${state.attempt} attempts. Streamer may have ended the live.`,
				timestamp: Date.now(),
			});
		}
	}

	_cancelReconnect(username) {
		const state = this.reconnectState.get(username);
		if (state) state.cancelled = true;
		this.reconnectState.delete(username);
	}

	_closeConnection(connection) {
		try {
			Promise.resolve(connection.disconnect()).catch(() => {});
		} catch {
			// A failed initial connection may have nothing to disconnect.
		}
	}

	disconnect(username) {
		this._cancelReconnect(username);
		const record = this.connections.get(username) || this.connectingRecords.get(username);
		if (!record) return;
		const wasActive = this.connections.get(username) === record;
		record.closed = true;
		this.connections.delete(username);
		this.connectingRecords.delete(username);
		this._closeConnection(record.connection);
		if (wasActive) record.io.to(username).emit("tiktok_disconnected", { timestamp: Date.now() });
	}

	updateActivity(username) {
		const record = this.connections.get(username) || this.connectingRecords.get(username);
		if (record && !record.closed) record.lastActivity = Date.now();
	}

	addClientToRoom(username) {
		const count = this.getClientCount(username) + 1;
		this.roomClients.set(username, count);
		const record = this.connections.get(username);
		if (record) record.noClientsSince = null;
		return count;
	}

	removeClientFromRoom(username) {
		const count = Math.max(0, this.getClientCount(username) - 1);
		if (count === 0) {
			this.roomClients.delete(username);
			this._cancelReconnect(username);
			const record = this.connections.get(username);
			if (record) record.noClientsSince = Date.now();
		} else {
			this.roomClients.set(username, count);
		}
		return count;
	}

	getClientCount(username) {
		return this.roomClients.get(username) || 0;
	}

	checkInactiveConnections() {
		const now = Date.now();
		for (const [username, record] of this.connections) {
			if (this.getClientCount(username) === 0 && now - (record.noClientsSince ?? record.lastActivity) > 5 * 60_000) {
				this.disconnect(username);
			}
		}
	}

	getStats() {
		return {
			activeConnections: this.connections.size,
			connections: Array.from(this.connections.keys()),
			rooms: Object.fromEntries(this.roomClients),
		};
	}
}

export default new TikTokService();
