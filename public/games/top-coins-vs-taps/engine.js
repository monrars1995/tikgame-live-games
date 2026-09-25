/** Ranked two-column battle. No DOM or network access. */
class TopBattleEngine {
	constructor({ now = () => Date.now(), durationMs = 120_000, resultMs = 8_000 } = {}) {
		this.now = now;
		this.durationMs = durationMs;
		this.resultMs = resultMs;
		this.round = 1;
		this.pendingGifts = new Map();
		this.reset();
	}

	reset() {
		this.phase = "waiting";
		this.startedAt = 0;
		this.finishedAt = 0;
		this.winner = null;
		this.users = new Map();
		this.coinTotal = 0;
		this.tapTotal = 0;
		this.topGift = null;
		this.topCombo = null;
		this.lastAction = null;
		this.rankingsDirty = true;
		this.rankings = { coins: [], taps: [] };
	}

	_person(event) {
		const user = event?.user || event || {};
		const id = String(user.uniqueId || user.displayId || "").trim().toLowerCase();
		if (!id) return null;
		let person = this.users.get(id);
		if (!person) {
			person = { id, name: String(user.nickname || user.uniqueId || id).slice(0, 36), coins: 0, taps: 0 };
			this.users.set(id, person);
		}
		return person;
	}

	_start() {
		if (this.phase === "waiting") {
			this.phase = "running";
			this.startedAt = this.now();
		}
	}

	chat(event) {
		if (this.phase === "finished") return false;
		return Boolean(this._person(event));
	}

	gift(event, units = 1) {
		const count = Math.min(1000, Math.floor(Number(units) || 0));
		const value = Math.min(100_000, Math.max(1, Number(event?.giftValue) || 1));
		if (this.phase === "finished") {
			const user = event?.user || event || {};
			const id = String(user.uniqueId || user.displayId || "").trim().toLowerCase();
			if (!id || count <= 0) return 0;
			const giftName = String(event?.giftName || "Presente").slice(0, 40);
			const key = `${id}:${value}:${giftName}`;
			const queued = this.pendingGifts.get(key);
			if (queued) {
				queued.units += count;
				queued.event.repeatCount = Math.max(queued.event.repeatCount, Math.floor(Number(event?.repeatCount) || count));
			} else {
				this.pendingGifts.set(key, {
					event: { user: { uniqueId: id, nickname: String(user.nickname || id).slice(0, 36) }, giftValue: value, giftName, repeatCount: Math.floor(Number(event?.repeatCount) || count) },
					units: count,
				});
			}
			return value * count;
		}
		const person = this._person(event);
		if (!person || count <= 0) return 0;
		this._start();
		const amount = value * count;
		person.coins += amount;
		this.coinTotal += amount;
		this.rankingsDirty = true;
		const giftName = String(event?.giftName || "Presente").slice(0, 40);
		if (!this.topGift || value > this.topGift.value) this.topGift = { name: person.name, giftName, value };
		const combo = Math.max(1, Math.floor(Number(event?.repeatCount) || count));
		if (!this.topCombo || combo > this.topCombo.count) this.topCombo = { name: person.name, giftName, count: combo };
		this.lastAction = { side: "coins", name: person.name, amount, at: this.now() };
		return amount;
	}

	like(event) {
		if (this.phase === "finished") return 0;
		const person = this._person(event);
		const count = Math.min(10_000, Math.floor(Number(event?.likeCount) || 0));
		if (!person || count <= 0) return 0;
		this._start();
		person.taps += count;
		this.tapTotal += count;
		this.rankingsDirty = true;
		this.lastAction = { side: "taps", name: person.name, amount: count, at: this.now() };
		return count;
	}

	tick() {
		const now = this.now();
		if (this.phase === "running" && now - this.startedAt >= this.durationMs) {
			this.phase = "finished";
			this.finishedAt = now;
			const coinsPower = this.coinTotal * 20;
			this.winner = coinsPower === this.tapTotal ? "draw" : coinsPower > this.tapTotal ? "coins" : "taps";
		} else if (this.phase === "finished" && now - this.finishedAt >= this.resultMs) {
			const queued = Array.from(this.pendingGifts.values());
			this.pendingGifts.clear();
			this.round++;
			this.reset();
			for (const packet of queued) {
				for (let remaining = packet.units; remaining > 0; remaining -= 1000) {
					this.gift(packet.event, Math.min(remaining, 1000));
				}
			}
		}
		return this.snapshot();
	}

	snapshot() {
		if (this.rankingsDirty) {
			const rankings = { coins: [], taps: [] };
			for (const person of this.users.values()) {
				for (const side of ["coins", "taps"]) {
					if (person[side] <= 0) continue;
					const leaders = rankings[side];
					const index = leaders.findIndex((other) => person[side] > other[side] ||
						(person[side] === other[side] && person.name.localeCompare(other.name) < 0));
					if (index >= 0) leaders.splice(index, 0, person);
					else if (leaders.length < 10) leaders.push(person);
					if (leaders.length > 10) leaders.pop();
				}
			}
			this.rankings = rankings;
			this.rankingsDirty = false;
		}
		return {
			phase: this.phase,
			round: this.round,
			remainingMs: this.phase === "running" ? Math.max(0, this.durationMs - (this.now() - this.startedAt)) : this.phase === "finished" ? 0 : this.durationMs,
			coinTotal: this.coinTotal,
			tapTotal: this.tapTotal,
			coinPower: this.coinTotal * 20,
			tapPower: this.tapTotal,
			coins: this.rankings.coins,
			taps: this.rankings.taps,
			topGift: this.topGift,
			topCombo: this.topCombo,
			winner: this.winner,
			lastAction: this.lastAction,
		};
	}
}

if (typeof module !== "undefined" && module.exports) module.exports = TopBattleEngine;
else window.TopBattleEngine = TopBattleEngine;
