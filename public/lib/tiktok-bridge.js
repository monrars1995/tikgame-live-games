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
				this._dispatch("error", { message: "Informe um @ do TikTok válido." });
				return;
			}

			const sameSocket = this.socket && this.serverUrl === serverUrl;
			const changedRoom = this.username !== null && this.username !== name;
			this.username = name;
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
				this._setDisconnected();
				this._dispatch("reconnecting", { attempt: 0, delayMs: 0 });
			}));
			socket.on("connect_error", current((error) => {
				this._dispatch("error", { message: error?.message || "Falha na conexão local." });
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
			socket.on("tiktok_disconnected", current(() => this._setDisconnected()));
			socket.on("tiktok_reconnecting", current((data) => {
				this.liveReady = false;
				this.awaitingRoomAck = false;
				this._dispatch("reconnecting", data);
			}));
			socket.on("tiktok_error", current((data) => this._dispatch("error", data)));
			socket.on("connection-error", current((data) => {
				this.awaitingRoomAck = false;
				this.switchPending = false;
				this.liveReady = false;
				this._dispatch("error", data);
			}));
			socket.on("error", current((data) => this._dispatch("error", data)));
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
			this._dispatch("connected", data);
		}

		_setDisconnected() {
			if (!this.liveReady) return;
			this.liveReady = false;
			this._dispatch("disconnected");
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
