/**
 * tiktokEventNormalizer.js
 * Pure functions that normalize raw tiktok-live-connector payloads
 * into a consistent shape for downstream consumers (games, bridge, debug).
 *
 * @module lib/tiktokEventNormalizer
 */

/**
 * Extract consistent user object from raw TikTok data.
 * @param {Object} raw - Raw event data from tiktok-live-connector
 * @returns {{uniqueId: string, nickname: string, profilePictureUrl: string}}
 */
export function normalizeUser(raw) {
	const user = raw?.user || raw || {};
	const uniqueId = String(user.displayId || user.uniqueId || raw?.uniqueId || user.userId || "").trim();
	return {
		uniqueId,
		nickname: String(user.nickname || raw?.nickname || uniqueId || "Participante"),
		profilePictureUrl: String(user.profilePictureUrl || user.avatarThumb?.urlList?.[0] || raw?.profilePictureUrl || ""),
	};
}

/**
 * Normalize chat event.
 * @param {Object} raw - Raw chat event
 * @returns {{user: Object, comment: string, timestamp: number}}
 */
export function normalizeChat(raw) {
	return {
		user: normalizeUser(raw),
		comment: String(raw?.comment ?? raw?.content ?? "").trim().slice(0, 200),
		timestamp: Date.now(),
	};
}

/**
 * Normalize like event.
 * @param {Object} raw - Raw like event
 * @returns {{user: Object, likeCount: number, totalLikeCount: number, timestamp: number}}
 */
export function normalizeLike(raw) {
	return {
		user: normalizeUser(raw),
		likeCount: Math.max(0, Number(raw?.count ?? raw?.likeCount) || 0),
		totalLikeCount: Math.max(0, Number(raw?.totalLikeCount) || 0),
		timestamp: Date.now(),
	};
}

/**
 * Normalize share event.
 * @param {Object} raw - Raw social event (filtered for shares only)
 * @returns {{user: Object, timestamp: number}}
 */
export function normalizeShare(raw) {
	return {
		user: normalizeUser(raw),
		timestamp: Date.now(),
	};
}

/**
 * Categorize gift by diamond value.
 * @param {number} value - Diamond count
 * @returns {"small"|"medium"|"large"}
 */
export function categorizeGift(value) {
	if (value >= 100) return "large";
	if (value >= 10) return "medium";
	return "small";
}

/**
 * Normalize gift event — the canonical shape for all consumers.
 * Adds giftId which was previously missing.
 *
 * @param {Object} raw - Raw gift event from tiktok-live-connector
 * @returns {{user: Object, giftId: number, giftName: string, giftValue: number, repeatCount: number, giftType: string, timestamp: number}}
 */
export function normalizeGift(raw) {
	const gift = raw?.gift || {};
	const details = raw?.giftDetails || {};
	const extended = raw?.extendedGiftInfo || {};
	let extra = raw?.monitorExtra || {};
	if (typeof extra === "string") {
		try { extra = JSON.parse(extra); } catch { extra = {}; }
	}
	const giftValue = [
		raw?.diamondCount,
		details.diamondCount,
		gift.diamondCount,
		gift.diamond_count,
		extended.diamond_count,
		raw?.giftValue,
	].map(Number).find((value) => Number.isFinite(value) && value > 0) ?? 1;
	const repeatCount = Math.max(1, Number(raw?.repeatCount ?? gift.repeat_count ?? 1) || 1);
	return {
		user: normalizeUser(raw),
		giftId: raw?.giftId || gift.id || details.id || gift.gift_id || 0,
		giftName: String(raw?.giftName || details.giftName || gift.name || extended.name || "Presente"),
		giftValue,
		repeatCount,
		repeatEnd: raw?.repeatEnd === true || raw?.repeatEnd === 1 || raw?.repeatEnd === "1" || gift.repeat_end === 1,
		isCombo: Number(raw?.giftType ?? details.giftType ?? gift.type ?? gift.gift_type ?? 0) === 1 || gift.combo === true,
		comboId: String(raw?.groupId || extra?.group_id || ""),
		messageId: String(raw?.msgId || raw?.common?.msgId || raw?.logId || ""),
		giftType: categorizeGift(giftValue),
		timestamp: Date.now(),
	};
}
