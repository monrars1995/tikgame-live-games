/**
 * config.js
 * Horse Racing game configuration.
 *
 * LANE SYSTEM:
 * - Each lane is a horse chosen with a comment (1–5 or its name).
 * - Gifts and likes boost the sender's horse; viewers without a choice join
 *   the next lane automatically so a paid interaction is never discarded.
 *
 * CUSTOMIZING:
 * - Use debug.html to discover exact gift names from your TikTok stream.
 * - Update giftEmojis below to match your audience's available gifts.
 *
 * @module games/horse-racing/config
 */

const CONFIG = {
	// ==========================================
	// Five original horses, each with a number and a distinct colour.
	// ==========================================
	lanes: [
		{ id: 0, name: "Relâmpago", flag: "⚡", color: "#FECC5E", aliases: ["relampago"] },
		{ id: 1, name: "Foguete", flag: "🚀", color: "#FF6C86", aliases: ["foguete"] },
		{ id: 2, name: "Trovão", flag: "🌩️", color: "#59D6F8", aliases: ["trovao"] },
		{ id: 3, name: "Ventania", flag: "🌪️", color: "#9C8BFF", aliases: ["ventania"] },
		{ id: 4, name: "Estrela", flag: "🌟", color: "#7CE2A7", aliases: ["estrela"] },
	],

	// ==========================================
	// Gift names only control the feed icon, never the horse being boosted.
	// ==========================================
	giftEmojis: {
		rose: "🌹", rosa: "🌹", gg: "✌️", "ice cream cone": "🍦",
		"finger heart": "🫰", tiktok: "🎵", "hand heart": "💕",
		"little crown": "👑", butterfly: "🦋", "love you": "💗",
		perfume: "💐", doughnut: "🍩", cap: "🧢", star: "⭐",
		concert: "🎸", garland: "🏵️",
	},

	// ==========================================
	// RACE PHASES & TIMING (ms)
	// ==========================================
	phases: {
		/** WAITING — lobby, waiting for first gift to start countdown */
		waiting: { duration: Infinity },
		/** COUNTDOWN — 10s before race begins */
		countdown: { duration: 8_000 },
		/** RACING — gifts move horses, first to finish wins */
		racing: { duration: 90_000 },
		/** FINISHED — show winner for 8s */
		finished: { duration: 7_000 },
		/** COOLDOWN — brief pause before auto-reset */
		cooldown: { duration: 4_000 },
	},

	// ==========================================
	// RACE MECHANICS
	// ==========================================
	/** Distance (arbitrary units) a horse must reach to win */
	finishLine: 300,

	/** Distance a single chat vote gives (much less than gifts) */
	chatDistance: 2,
	chatCooldownMs: 15_000,
	likeDistance: 0.2,

	/**
	 * Convert gift diamond value to movement distance.
	 * A 50-coin gift outruns five Roses, while a per-gift cap prevents a single
	 * very large gift from instantly finishing an entire race.
	 */
	giftToDistance(giftValue) {
		const value = Math.max(1, Number(giftValue) || 1);
		return Math.min(140, Math.round(8 * Math.pow(value, 0.55)));
	},

	/**
	 * Get gift emoji by name (for HUD/feed display).
	 */
	getGiftEmoji(giftName) {
		return this.giftEmojis[(giftName || "").trim().toLowerCase()] || "🎁";
	},

	/**
	 * Chat-based lane selection.
	 * Viewer types a horse name, alias, or number 1–5.
	 * Case-insensitive, trimmed.
	 * @returns {number} lane index or -1 if no match
	 */
	chatToLane(comment) {
		const text = (comment || "").toLowerCase().trim();
		if (!text) return -1;

		// Number shortcut: "1"-"5"
		const num = /^\d+$/.test(text) ? Number(text) : NaN;
		if (num >= 1 && num <= this.lanes.length) return num - 1;

		// Build alias lookup on first call (lazy init)
		if (!this._chatAliasMap) {
			this._chatAliasMap = {};
			for (const lane of this.lanes) {
				// Horse name itself
				this._chatAliasMap[lane.name.toLowerCase()] = lane.id;
				// All aliases
				for (const alias of lane.aliases || []) {
					this._chatAliasMap[alias.toLowerCase()] = lane.id;
				}
			}
		}

		return this._chatAliasMap[text] ?? -1;
	},
};

// Make available in both module and browser global contexts
if (typeof module !== "undefined" && module.exports) {
	module.exports = CONFIG;
} else {
	window.RACE_CONFIG = CONFIG;
}
