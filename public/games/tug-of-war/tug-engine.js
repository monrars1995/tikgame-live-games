/** State and rules for Cabo de Guerra. No DOM or network access. */
class TugEngine {
	constructor({ utils, now = () => Date.now(), roundMs = 60_000, resultMs = 7_000, winAt = 100 } = {}) {
		if (!utils?.GiftTracker || !utils?.viewer) throw new Error("LiveGameUtils é obrigatório");
		this.utils = utils;
		this.now = now;
		this.roundMs = roundMs;
		this.resultMs = resultMs;
		this.winAt = winAt;
		this.gifts = new utils.GiftTracker();
		this.listeners = new Map();
		this.members = new Map();
		this.pendingGifts = new Map();
		this.draining = false;
		this.state = {
			phase: "waiting", round: 1, startedAt: 0, position: 0,
			winner: null, teams: [this._team("azul"), this._team("vermelho")],
			recent: [],
		};
	}

	_team(id) {
		return { id, label: id === "azul" ? "TIME AZUL" : "TIME VERMELHO", wins: 0, power: 0, members: 0 };
	}

	on(event, handler) {
		if (!this.listeners.has(event)) this.listeners.set(event, new Set());
		this.listeners.get(event).add(handler);
		return () => this.listeners.get(event)?.delete(handler);
	}

	_emit(event, data) {
		for (const handler of this.listeners.get(event) || []) handler(data);
	}

	_teamFromComment(comment) {
		const value = String(comment || "").trim().toLowerCase();
		if (/^(1|azul|blue|time azul|#azul)$/.test(value)) return 0;
		if (/^(2|vermelho|red|time vermelho|#vermelho)$/.test(value)) return 1;
		return -1;
	}

	_member(event, preferred = -1) {
		const viewer = this.utils.viewer(event);
		const id = String(viewer?.id || "").trim().toLowerCase();
		if (!id) return null;
		let member = this.members.get(id);
		if (!member) {
			const teamIdx = preferred >= 0 ? preferred :
				(this.state.teams[0].members <= this.state.teams[1].members ? 0 : 1);
			member = {
				id, name: String(viewer.name || id).slice(0, 32),
				avatar: String(viewer.avatar || ""), teamIdx,
				power: 0, totalPower: 0, likes: 0, coins: 0, lastChatAt: -Infinity,
			};
			this.members.set(id, member);
			this.state.teams[teamIdx].members++;
		} else {
			member.name = String(viewer.name || member.name).slice(0, 32);
			if (viewer.avatar) member.avatar = String(viewer.avatar);
		}
		return member;
	}

	_start() {
		if (this.state.phase !== "waiting") return;
		this.state.phase = "running";
		this.state.startedAt = this.now();
		this._emit("phase", this.state.phase);
	}

	_apply(member, amount, kind, detail = "") {
		if (!member || !Number.isFinite(amount) || amount <= 0 || this.state.phase === "result") return;
		this._start();
		const power = Math.min(amount, 200);
		member.power += power;
		member.totalPower += power;
		const team = this.state.teams[member.teamIdx];
		team.power += power;
		this.state.position = this.utils.clamp
			? this.utils.clamp(this.state.position + (member.teamIdx === 0 ? -power : power), -this.winAt, this.winAt)
			: Math.max(-this.winAt, Math.min(this.winAt, this.state.position + (member.teamIdx === 0 ? -power : power)));
		const action = { kind, member, teamIdx: member.teamIdx, power, detail, at: this.now() };
		this.state.recent.unshift(action);
		if (this.state.recent.length > 8) this.state.recent.length = 8;
		this._emit("action", action);
		if (!this.draining && Math.abs(this.state.position) >= this.winAt) this._finish(member.teamIdx);
	}

	handleChat(event) {
		this.tick();
		if (this.state.phase === "result" || !String(event?.comment || "").trim()) return;
		const member = this._member(event, this._teamFromComment(event.comment));
		if (!member || this.now() - member.lastChatAt < 8_000) return;
		member.lastChatAt = this.now();
		this._apply(member, member.power === 0 ? 1.5 : 0.5, "chat", "entrou no time");
	}

	handleLike(event) {
		this.tick();
		if (this.state.phase === "result") return;
		const count = Math.min(100, Math.max(0, Math.floor(Number(event?.likeCount) || 0)));
		if (!count) return;
		const member = this._member(event);
		if (!member) return;
		member.likes += count;
		this._apply(member, count * 0.12, "like", `${count} curtidas`);
	}

	handleGift(event) {
		this.tick();
		const units = Math.min(100, Math.max(0, Number(this.gifts.consume(event)) || 0));
		if (!units) return;
		if (this.state.phase === "result") {
			// Keep paid interactions received while the victory graphic is on screen.
			const viewer = this.utils.viewer(event);
			if (!viewer?.id) return;
			const coins = Math.min(10_000, Math.max(1, Number(event?.giftValue) || 1));
			const key = `${viewer.id}:${event?.giftId || event?.giftName || "gift"}:${coins}`;
			const queued = this.pendingGifts.get(key);
			if (queued) queued.units += units;
			else this.pendingGifts.set(key, {
				event: { user: { uniqueId: viewer.id, nickname: viewer.name, profilePictureUrl: viewer.avatar }, giftName: event?.giftName, giftValue: coins },
				units,
				preferred: this.members.get(viewer.id)?.teamIdx ?? -1,
			});
			return;
		}
		this._scoreGift(event, units);
	}

	_scoreGift(event, units, preferred = -1) {
		const member = this._member(event, preferred);
		if (!member) return;
		const coins = Math.min(10_000, Math.max(1, Number(event?.giftValue) || 1));
		member.coins += units * coins;
		const each = Math.min(60, 2.5 + coins * 0.4);
		this._apply(member, units * each, "gift", `${units}× ${String(event?.giftName || "presente").slice(0, 36)}`);
	}

	_finish(winnerIdx) {
		if (this.state.phase !== "running") return;
		this.state.phase = "result";
		this.state.startedAt = this.now();
		this.state.winner = winnerIdx;
		if (winnerIdx !== null) this.state.teams[winnerIdx].wins++;
		this._emit("finish", { winnerIdx, round: this.state.round });
		this._emit("phase", this.state.phase);
	}

	_resetRound() {
		const queued = Array.from(this.pendingGifts.values());
		this.pendingGifts.clear();
		this.state.round++;
		this.state.phase = "waiting";
		this.state.startedAt = 0;
		this.state.position = 0;
		this.state.winner = null;
		this.state.recent = [];
		for (const team of this.state.teams) { team.power = 0; team.members = 0; }
		this.members.clear();
		this._emit("phase", this.state.phase);
		this.draining = true;
		for (const gift of queued) this._scoreGift(gift.event, gift.units, gift.preferred);
		this.draining = false;
		if (Math.abs(this.state.position) >= this.winAt) this._finish(this.state.position < 0 ? 0 : 1);
	}

	remaining() {
		if (this.state.phase === "waiting") return this.roundMs;
		const duration = this.state.phase === "result" ? this.resultMs : this.roundMs;
		return Math.max(0, duration - (this.now() - this.state.startedAt));
	}

	tick() {
		if (this.state.phase === "running" && this.remaining() <= 0) {
			const p = this.state.position;
			this._finish(p < -0.001 ? 0 : p > 0.001 ? 1 : null);
		} else if (this.state.phase === "result" && this.remaining() <= 0) {
			this._resetRound();
		}
		return this.state;
	}

	leaders(teamIdx, count = 3) {
		return Array.from(this.members.values())
			.filter((member) => member.teamIdx === teamIdx && member.power > 0)
			.sort((a, b) => b.power - a.power)
			.slice(0, count);
	}
}

if (typeof module !== "undefined" && module.exports) module.exports = TugEngine;
else window.TugEngine = TugEngine;
