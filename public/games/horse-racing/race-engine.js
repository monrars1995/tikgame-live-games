/**
 * race-engine.js
 * Pure state machine for Horse Racing.
 * NO DOM, NO Canvas — just data in, state out.
 * The renderer (game.js) reads state and draws.
 *
 * Phases: WAITING → COUNTDOWN → RACING → FINISHED → COOLDOWN → WAITING
 *
 * @module games/horse-racing/race-engine
 */

class RaceEngine {
	/**
	 * @param {Object} config - RACE_CONFIG from config.js
	 */
	constructor(config) {
		this.config = config;
		this.listeners = {};
		this.reset();
	}

	// ==========================================
	// STATE
	// ==========================================

	reset() {
		this.state = {
			phase: "waiting",
			phaseStartedAt: Date.now(),
			lanes: this.config.lanes.map((lane) => ({
				...lane,
				distance: 0,
				supporters: new Map(), // uniqueId → { nickname, totalContrib }
			})),
			winner: null,
			raceCount: this.state?.raceCount || 0,
			recentEvents: [], // last N events for HUD feed
			userLanes: new Map(),
		};
		this.nextAutoLane = 0;
		this.lastChatBoost = new Map();
		this.comboProgress = new Map();
		this.seenGiftEvents = new Set();
		this._emit("phaseChange", { phase: "waiting" });
	}

	// ==========================================
	// PHASE TRANSITIONS
	// ==========================================

	/**
	 * Advance phase. Called by a tick loop or event trigger.
	 * @param {string} nextPhase
	 */
	_setPhase(nextPhase) {
		this.state.phase = nextPhase;
		this.state.phaseStartedAt = Date.now();
		this._emit("phaseChange", { phase: nextPhase });
	}

	/** Time elapsed in current phase (ms) */
	phaseElapsed() {
		return Date.now() - this.state.phaseStartedAt;
	}

	/** Time remaining in current phase (ms), or Infinity */
	phaseRemaining() {
		const dur = this.config.phases[this.state.phase]?.duration ?? Infinity;
		if (dur === Infinity) return Infinity;
		return Math.max(0, dur - this.phaseElapsed());
	}

	// ==========================================
	// TICK — call from requestAnimationFrame
	// ==========================================

	/**
	 * Main update tick. Handles phase timeouts / auto-transitions.
	 * Returns current state for rendering.
	 */
	tick() {
		const { phase } = this.state;
		const remaining = this.phaseRemaining();

		if (phase === "countdown" && remaining <= 0) {
			this._setPhase("racing");
			this._checkFinish();
		} else if (phase === "racing" && remaining <= 0) {
			// Time limit — pick horse with most distance as winner
			this._resolveWinner();
		} else if (phase === "finished" && remaining <= 0) {
			this._setPhase("cooldown");
		} else if (phase === "cooldown" && remaining <= 0) {
			this.state.raceCount++;
			this.reset();
		}

		return this.state;
	}

	// ==========================================
	// EVENT HANDLERS (called by game.js)
	// ==========================================

	/**
	 * Process a gift event.
	 * @param {{giftId: number, giftValue: number, user: {uniqueId: string, nickname: string}}} data
	 */
	handleGift(data) {
		if (!["waiting", "countdown", "racing"].includes(this.state.phase)) return;
		if (data?.messageId) {
			const eventKey = `${data.messageId}:${data.repeatCount || 1}:${Boolean(data.repeatEnd)}`;
			if (this.seenGiftEvents.has(eventKey)) return;
			this.seenGiftEvents.add(eventKey);
			if (this.seenGiftEvents.size > 3000) {
				this.seenGiftEvents.delete(this.seenGiftEvents.values().next().value);
			}
		}
		const user = data?.user;
		const laneIdx = this._laneForUser(user);
		if (laneIdx < 0) return;
		const count = this._giftCount(data);
		if (count <= 0) return;
		if (this.state.phase === "waiting") this._setPhase("countdown");
		const distance = this.config.giftToDistance(data.giftValue) * count;
		this._moveLane(laneIdx, distance, user, { ...data, _count: count });
		if (this.state.phase === "racing") this._checkFinish();
	}

	/**
	 * Process a chat event.
	 * First non-empty comment joins the race; 1–5 or a horse name selects a lane.
	 * Subsequent comments cannot switch teams within the same race.
	 * @param {{user: {uniqueId: string, nickname: string}, comment: string}} data
	 */
	handleChat(data) {
		const comment = (data.comment || "").trim();
		if (!comment || !["waiting", "countdown", "racing"].includes(this.state.phase)) return;
		const laneIdx = this._laneForUser(data.user, this.config.chatToLane(comment));
		if (laneIdx < 0) return;
		if (this.state.phase === "waiting") this._setPhase("countdown");
		const key = String(data.user.uniqueId).toLowerCase();
		const now = Date.now();
		if (now - (this.lastChatBoost.get(key) ?? -Infinity) < this.config.chatCooldownMs) return;
		this.lastChatBoost.set(key, now);
		this._moveLane(laneIdx, this.config.chatDistance, data.user, {
			_isChat: true,
			_comment: comment,
		});
		if (this.state.phase === "racing") this._checkFinish();
	}

	/**
	 * Process a like event.
	 * @param {{user: {uniqueId: string, nickname: string}, likeCount: number}} data
	 */
	handleLike(data) {
		if (!["waiting", "countdown", "racing"].includes(this.state.phase)) return;
		const count = Math.min(100, Math.max(0, Math.floor(Number(data.likeCount) || 0)));
		if (!count) return;
		const laneIdx = this._laneForUser(data.user);
		if (laneIdx < 0) return;
		if (this.state.phase === "waiting") this._setPhase("countdown");
		this._moveLane(laneIdx, count * this.config.likeDistance, data.user, {
			_isLike: true,
			_count: count,
		});
		if (this.state.phase === "racing") this._checkFinish();
	}

	// ==========================================
	// INTERNAL
	// ==========================================

	_laneForUser(user, preferred = -1) {
		const key = String(user?.uniqueId || "").trim().toLowerCase();
		if (!key) return -1;
		if (this.state.userLanes.has(key)) return this.state.userLanes.get(key);
		const laneIdx = preferred >= 0 && preferred < this.state.lanes.length
			? preferred
			: this.nextAutoLane++ % this.state.lanes.length;
		this.state.userLanes.set(key, laneIdx);
		return laneIdx;
	}

	_giftCount(data) {
		const cumulative = Math.min(1000, Math.max(1, Math.floor(Number(data.repeatCount) || 1)));
		const userId = String(data.user?.uniqueId || "").toLowerCase();
		const giftId = String(data.giftId || data.giftName || "gift");
		const comboId = data.comboId || data.groupId || "";
		const key = `${userId}:${giftId}:${comboId}`;
		const now = Date.now();
		for (const [oldKey, progress] of this.comboProgress) {
			if (now - progress.at > 120_000 || this.comboProgress.size > 1000) this.comboProgress.delete(oldKey);
		}
		const previous = this.comboProgress.get(key);
		// Standalone gifts without a streak id are discrete packets.
		if (!comboId && !data.isCombo && cumulative === 1 && !data.repeatEnd) return 1;
		const delta = !previous || cumulative < previous.count
			? cumulative
			: Math.max(0, cumulative - previous.count);
		if (comboId || cumulative > 1 || !data.repeatEnd) {
			this.comboProgress.set(key, { count: cumulative, at: now });
		} else {
			this.comboProgress.delete(key);
		}
		return delta;
	}

	/**
	 * Move a lane forward and track supporter contribution.
	 * @private
	 */
	_moveLane(laneIdx, distance, user, rawData) {
		const lane = this.state.lanes[laneIdx];
		if (!lane) return;

		lane.distance = Math.min(lane.distance + distance, this.config.finishLine);

		// Track supporter
		const supporterId = String(user.uniqueId).toLowerCase();
		const existing = lane.supporters.get(supporterId);
		if (existing) {
			existing.totalContrib += distance;
		} else {
			lane.supporters.set(supporterId, {
				nickname: user.nickname,
				totalContrib: distance,
			});
		}

		if (rawData._isChat) {
			// Chat vote event
			this._addRecentEvent({
				type: "vote",
				nickname: user.nickname,
				laneFlag: lane.flag,
				laneName: lane.name,
				distance,
				comment: rawData._comment,
			});
		} else if (rawData._isLike) {
			this._addRecentEvent({
				type: "like",
				nickname: user.nickname,
				laneFlag: lane.flag,
				laneName: lane.name,
				count: rawData._count,
				distance,
			});
		} else {
			// Gift event
			this._addRecentEvent({
				type: "gift",
				nickname: user.nickname,
				laneFlag: lane.flag,
				laneName: lane.name,
				distance,
				giftName: rawData.giftName || "",
				giftEmoji: this.config.getGiftEmoji(rawData.giftName),
				count: rawData._count,
			});
		}

		this._emit("laneMove", { laneIdx, distance, lane, user });
	}

	/** @private */
	_checkFinish() {
		for (const lane of this.state.lanes) {
			if (lane.distance >= this.config.finishLine) {
				this.state.winner = lane;
				this._setPhase("finished");
				this._emit("raceFinished", { winner: lane });
				return;
			}
		}
	}

	/** @private — fallback when race times out */
	_resolveWinner() {
		let best = this.state.lanes[0];
		for (const lane of this.state.lanes) {
			if (lane.distance > best.distance) best = lane;
		}
		this.state.winner = best;
		this._setPhase("finished");
		this._emit("raceFinished", { winner: best });
	}

	/** @private — keep last 20 events for HUD feed */
	_addRecentEvent(evt) {
		evt.timestamp = Date.now();
		this.state.recentEvents.unshift(evt);
		if (this.state.recentEvents.length > 20) {
			this.state.recentEvents.length = 20;
		}
	}

	// ==========================================
	// EVENT EMITTER (simple)
	// ==========================================

	on(event, fn) {
		(this.listeners[event] ??= []).push(fn);
	}

	_emit(event, data) {
		(this.listeners[event] || []).forEach((fn) => {
			try {
				fn(data);
			} catch (e) {
				console.error(`[RaceEngine] Error in ${event} listener:`, e);
			}
		});
	}
}

// Export for browser global
if (typeof module !== "undefined" && module.exports) {
	module.exports = RaceEngine;
} else {
	window.RaceEngine = RaceEngine;
}
