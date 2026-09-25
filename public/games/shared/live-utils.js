/** Reusable, bounded helpers shared by all TikGame LIVE overlays. */
(() => {
	const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
	const formatNumber = (value) => Math.round(Number(value) || 0).toLocaleString("pt-BR");

	function viewer(event) {
		const user = event?.user || event || {};
		const rawId = String(user.uniqueId || user.displayId || user.userId || "").trim();
		return {
			id: rawId.toLowerCase(),
			name: String(user.nickname || rawId || "Convidado").trim().slice(0, 36),
			avatar: String(user.profilePictureUrl || "").slice(0, 1024),
		};
	}

	function isRose(event) {
		return String(event?.giftId || "") === "5655" || /^(rose|rosa)$/i.test(String(event?.giftName || "").trim());
	}

	class GiftTracker {
		constructor() {
			this.seen = new Set();
			this.progress = new Map();
		}

		reset() {
			this.seen.clear();
			this.progress.clear();
		}

		/** Incremental gift units; combo events commonly carry cumulative counts. */
		consume(event) {
			const user = viewer(event);
			if (!user.id) return 0;
			const count = Math.floor(clamp(event?.repeatCount || 1, 1, 1000));
			const giftId = String(event?.giftId || event?.giftName || "gift");
			const groupId = String(event?.comboId || event?.groupId || "");
			const ended = Boolean(event?.repeatEnd);
			const messageId = String(event?.messageId || "");
			if (messageId) {
				const messageKey = `${messageId}:${count}:${ended}`;
				if (this.seen.has(messageKey)) return 0;
				this.seen.add(messageKey);
				if (this.seen.size > 3000) this.seen.delete(this.seen.values().next().value);
			}

			if (!groupId && !event?.isCombo && count === 1 && !ended) return 1;
			const key = `${user.id}:${giftId}:${groupId}`;
			const now = Date.now();
			if (this.progress.size > 1000) {
				for (const [oldKey, value] of this.progress) {
					if (now - value.at > 120_000 || this.progress.size > 1000) this.progress.delete(oldKey);
				}
			}
			const previous = this.progress.get(key);
			const delta = !previous || count < previous.count ? count : Math.max(0, count - previous.count);
			if (groupId || count > 1 || !ended) this.progress.set(key, { count, at: now });
			else this.progress.delete(key);
			return delta;
		}
	}

	const api = { clamp, formatNumber, viewer, isRose, GiftTracker };
	if (typeof module !== "undefined" && module.exports) module.exports = api;
	else window.LiveGameUtils = api;
})();
