/** Pure round rules for the Rosas x Corações LIVE duel. */
((global) => {
	const utils = global.LiveGameUtils;
	if (!utils) throw new Error("LiveGameUtils must load before DuelEngine");

	const SIDES = ["roses", "hearts"];
	const heartDamagePerLike = 0.7;
	const roseDamagePerCoin = 8;

	function preferredSide(comment) {
		const text = String(comment || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
		if (/\b(rosa|rosas|rose|roses)\b/.test(text) || text.includes("🌹")) return "roses";
		if (/\b(coracao|coracoes|heart|hearts|like|likes)\b/.test(text) || text.includes("❤️") || text.includes("♥")) return "hearts";
		return null;
	}

	class DuelEngine {
		constructor(options = {}) {
			this.now = options.now || (() => Date.now());
			this.durationMs = options.durationMs ?? 60_000;
			this.cooldownMs = options.cooldownMs ?? 7_000;
			this.maxHealth = options.maxHealth ?? 1000;
			this.gifts = new utils.GiftTracker();
			this.pendingGifts = new Map();
			this.listeners = new Set();
			this.seriesWins = { roses: 0, hearts: 0 };
			this.roundNumber = 1;
			this._newRound();
		}

		_newRound() {
			this.participants = new Map();
			this.supporters = { roses: new Map(), hearts: new Map() };
			this.state = {
				phase: "waiting", roundNumber: this.roundNumber, remainingMs: this.durationMs,
				rosesHealth: this.maxHealth, heartsHealth: this.maxHealth,
				roseCoins: 0, roseGifts: 0, heartLikes: 0, queuedRoseCoins: 0,
				joined: { roses: 0, hearts: 0 }, winner: null,
			};
			this.startedAt = null;
			this.finishedAt = null;
			this._emit("round", { roundNumber: this.roundNumber });
			if (this.pendingGifts.size) {
				const queued = [...this.pendingGifts.values()];
				this.pendingGifts.clear();
				for (const gift of queued) this._applyGift(gift.user, gift.coins, gift.units, false);
				if (this.state.heartsHealth <= 0) this._finish("roses");
			}
		}

		on(handler) {
			this.listeners.add(handler);
			return () => this.listeners.delete(handler);
		}

		_emit(type, detail = {}) {
			for (const handler of this.listeners) handler({ type, ...detail });
		}

		_start() {
			if (this.state.phase !== "waiting") return;
			this.state.phase = "running";
			this.startedAt = this.now();
			this._emit("start", { roundNumber: this.roundNumber });
		}

		_join(event, side = null) {
			const user = utils.viewer(event);
			if (!user.id) return null;
			let participant = this.participants.get(user.id);
			if (participant) {
				participant.name = user.name;
				return participant;
			}
			const team = SIDES.includes(side) ? side
				: this.state.joined.roses <= this.state.joined.hearts ? "roses" : "hearts";
			participant = { ...user, side: team };
			this.participants.set(user.id, participant);
			this.state.joined[team]++;
			this._emit("join", { participant });
			return participant;
		}

		handleChat(event) {
			if (this.state.phase === "finished") return;
			const participant = this._join(event, preferredSide(event?.comment));
			if (participant) this._start();
			return participant;
		}

		_recordSupport(side, user, amount) {
			const current = this.supporters[side].get(user.id) || { ...user, value: 0 };
			current.name = user.name;
			current.value += amount;
			this.supporters[side].set(user.id, current);
		}

		handleGift(event) {
			const units = this.gifts.consume(event);
			if (!units) return 0;
			const user = utils.viewer(event);
			if (!user.id) return 0;
			const value = Math.max(1, Math.floor(utils.clamp(event?.giftValue, 1, 100_000)));
			const coins = units * value;
			if (this.state.phase === "finished") {
				const pending = this.pendingGifts.get(user.id) || { user, coins: 0, units: 0 };
				pending.user = user;
				pending.coins += coins;
				pending.units += units;
				this.pendingGifts.set(user.id, pending);
				this.state.queuedRoseCoins += coins;
				this._emit("queuedGift", { user, coins, units });
				return coins;
			}
			this._applyGift(user, coins, units);
			return coins;
		}

		_applyGift(user, coins, units, resolveVictory = true) {
			this._join({ user: { uniqueId: user.id, nickname: user.name, profilePictureUrl: user.avatar } }, "roses");
			this._start();
			const damage = Math.min(this.maxHealth, coins * roseDamagePerCoin);
			this.state.roseCoins += coins;
			this.state.roseGifts += units;
			this.state.heartsHealth = Math.max(0, this.state.heartsHealth - damage);
			this._recordSupport("roses", user, coins);
			this._emit("hit", { side: "roses", user, amount: coins, damage, units });
			if (resolveVictory && this.state.heartsHealth <= 0) this._finish("roses");
		}

		handleLike(event) {
			if (this.state.phase === "finished") return 0;
			const user = this._join(event, "hearts");
			if (!user) return 0;
			const likes = Math.floor(utils.clamp(event?.likeCount ?? 1, 0, 1000));
			if (!likes) return 0;
			this._start();
			const damage = likes * heartDamagePerLike;
			this.state.heartLikes += likes;
			this.state.rosesHealth = Math.max(0, this.state.rosesHealth - damage);
			this._recordSupport("hearts", user, likes);
			this._emit("hit", { side: "hearts", user, amount: likes, damage, units: likes });
			if (this.state.rosesHealth <= 0) this._finish("hearts");
			return likes;
		}

		_finish(winner = null) {
			if (this.state.phase === "finished") return;
			if (!winner) {
				const roseDamage = this.maxHealth - this.state.heartsHealth;
				const heartDamage = this.maxHealth - this.state.rosesHealth;
				winner = roseDamage > heartDamage ? "roses" : heartDamage > roseDamage ? "hearts" : "tie";
			}
			this.state.phase = "finished";
			this.state.remainingMs = 0;
			this.state.winner = winner;
			this.finishedAt = this.now();
			if (winner !== "tie") this.seriesWins[winner]++;
			this._emit("finish", { winner, roundNumber: this.roundNumber });
		}

		tick() {
			if (this.state.phase === "running") {
				this.state.remainingMs = Math.max(0, this.durationMs - (this.now() - this.startedAt));
				if (this.state.remainingMs === 0) this._finish();
			} else if (this.state.phase === "finished" && this.now() - this.finishedAt >= this.cooldownMs) {
				this.roundNumber++;
				this._newRound();
			}
			return this.state;
		}

		top(side, limit = 3) {
			if (!SIDES.includes(side)) return [];
			return [...this.supporters[side].values()]
				.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
				.slice(0, limit);
		}
	}

	if (typeof module !== "undefined" && module.exports) module.exports = DuelEngine;
	else global.DuelEngine = DuelEngine;
})(typeof window !== "undefined" ? window : globalThis);
