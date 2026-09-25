/**
 * Small browser bridge between the local Socket.io gateway and a game.
 * Public API: TikTokBridge.connect(username, serverUrl) and .on(event, handler).
 */
((global) => {
	class TikTokBridge {
		constructor() {
			this.socket = null;
			this.serverUrl = null;
			this.username = null;
			this.isInitialized = false;
			this.liveReady = false;
			this.awaitingRoomAck = false;
			this.switchPending = false;
			this.lastError = null;
			this.eventHandlers = {
				chat: [], gift: [], like: [], share: [],
				connected: [], disconnected: [], reconnecting: [], error: [],
			};

			global.addEventListener("load", () => {
				const params = new URLSearchParams(global.location.search);
				const user = params.get("id") || params.get("username");
				if (user) this.connect(user);
			});
		}

		/** Start or retry a streamer room, changing rooms on the same socket when possible. */
		connect(username, serverUrl = global.location.origin) {
			const name = typeof username === "string"
				? username.trim().replace(/^@/, "").toLowerCase()
				: "";
			if (!/^[a-z0-9_.]+$/.test(name)) {
				this._reportError({ code: "INVALID_USERNAME", message: "Informe um @ do TikTok válido.", retryable: false }, "input");
				return;
			}

			const sameSocket = this.socket && this.serverUrl === serverUrl;
			const changedRoom = this.username !== null && this.username !== name;
			this.username = name;
			this.lastError = null;
			if (changedRoom) {
				this.liveReady = false;
				this.switchPending = true;
			}

			if (sameSocket) {
				// Calling connect again is an explicit retry after a failed first join.
				if (this.socket.connected && (changedRoom || !this.liveReady)) this._joinRoom();
				else if (!this.socket.connected) this.socket.connect?.();
				return;
			}

			const previousSocket = this.socket;
			this.socket = null;
			previousSocket?.disconnect();
			this.liveReady = false;
			this.awaitingRoomAck = false;
			this.serverUrl = serverUrl;
			this.socket = io(serverUrl);
			this.isInitialized = true;
			this._bindSocket(this.socket);
			if (this.socket.connected) this._joinRoom();
		}

		_bindSocket(socket) {
			const current = (handler) => (...args) => {
				if (this.socket === socket) handler(...args);
			};
			socket.on("connect", current(() => this._joinRoom()));
			socket.on("disconnect", current(() => {
				this.awaitingRoomAck = false;
				this._setDisconnected({ source: "local", username: this.username });
				this._reportReconnecting({ attempt: 0, delayMs: 0 }, "local");
			}));
			socket.on("connect_error", current((error) => {
				this._reportError({ code: "LOCAL_SOCKET_ERROR", message: error?.message || "Falha na conexão local.", retryable: true }, "local");
			}));
			socket.on("room-joined", current((data) => {
				if (data?.room !== this.username) return;
				this.awaitingRoomAck = false;
				this.switchPending = false;
				this._setConnected(data);
			}));
			// A room can join unsuccessfully and the service may connect on a later retry.
			socket.on("tiktok_connected", current((data) => {
				if (this.awaitingRoomAck) return; // room-joined will confirm the initial join.
				this.switchPending = false;
				this._setConnected({ ...data, room: this.username });
			}));

			const relay = (event) => current((data) => {
				if (!this.switchPending) this._dispatch(event, data);
			});
			socket.on("tiktok_chat", relay("chat"));
			socket.on("tiktok_gift", relay("gift"));
			socket.on("tiktok_like", relay("like"));
			socket.on("tiktok_share", relay("share"));
			socket.on("tiktok_disconnected", current(() => this._setDisconnected({ source: "tiktok", username: this.username })));
			socket.on("tiktok_reconnecting", current((data) => {
				if (data?.username && data.username !== this.username) return;
				this.liveReady = false;
				this.awaitingRoomAck = false;
				this._reportReconnecting(data, "tiktok");
			}));
			socket.on("tiktok_error", current((data) => {
				if (!data?.username || data.username === this.username) this._reportError(data, "tiktok");
			}));
			socket.on("connection-error", current((data) => {
				if (data?.username && data.username !== this.username) return;
				this.awaitingRoomAck = false;
				this.switchPending = false;
				this.liveReady = false;
				this._reportError(data, "tiktok");
			}));
			socket.on("error", current((data) => this._reportError(data, "local")));
		}

		_joinRoom() {
			if (!this.socket?.connected || !this.username) return;
			this.liveReady = false;
			this.awaitingRoomAck = true;
			this.socket.emit("join-room", this.username);
		}

		_setConnected(data) {
			if (this.liveReady) return;
			this.liveReady = true;
			this.lastError = null;
			this._dispatch("connected", data);
		}

		_setDisconnected(data) {
			if (!this.liveReady) return;
			this.liveReady = false;
			this._dispatch("disconnected", data);
		}

		_reportError(data, source) {
			const detail = data && typeof data === "object" ? data : { message: String(data || "Falha na conexão.") };
			const error = { ...detail, message: detail.message || "Falha na conexão.", source, username: detail.username || this.username };
			this.lastError = error;
			this._dispatch("error", error);
		}

		_reportReconnecting(data, source) {
			const detail = data && typeof data === "object" ? data : {};
			const lastError = source === "tiktok" ? detail.lastError || (this.lastError?.source === "tiktok" ? this.lastError : null) : null;
			this._dispatch("reconnecting", { ...detail, source, username: detail.username || this.username, lastError });
		}

		/** Event names: chat, gift, like, share, connected, disconnected, reconnecting, error. */
		on(event, callback) {
			if (this.eventHandlers[event] && typeof callback === "function") {
				this.eventHandlers[event].push(callback);
			}
		}

		_dispatch(event, data) {
			for (const handler of this.eventHandlers[event] || []) {
				try {
					handler(data);
				} catch (error) {
					console.error(`[TikTokBridge] ${event} handler:`, error);
				}
			}
		}
	}

	global.TikTokBridge = new TikTokBridge();
})(window);
