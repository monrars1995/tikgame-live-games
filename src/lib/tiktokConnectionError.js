/** Public, credential-free diagnostics for failures from tiktok-live-connector. */

function connectorException(value) {
	if (value && typeof value === "object" && value.exception) return value.exception;
	return value;
}

function httpStatus(error) {
	const value = error?.statusCode ?? error?.response?.statusCode ?? error?.response?.status;
	if (Number.isInteger(Number(value)) && Number(value) >= 400) return Number(value);
	const match = String(error?.message || "").match(/(?:status(?: code)?|HTTP)\s*[:=]?\s*(4\d\d|5\d\d)/i);
	return match ? Number(match[1]) : null;
}

export function classifyConnectionError(value, username) {
	const error = connectorException(value);
	const name = String(error?.constructor?.name && error.constructor.name !== "Object"
		? error.constructor.name : error?.name || "");
	const details = `${name} ${error?.message || ""} ${value?.info || ""}`.toLowerCase();
	const status = httpStatus(error);
	let code = "CONNECTION_FAILED";
	let message = "Não foi possível conectar ao TikTok. Verifique a live e tente novamente.";
	let retryable = true;

	if (name === "InvalidUniqueIdError" || /invalid (?:unique.?id|username)/.test(details)) {
		code = "INVALID_USERNAME";
		message = "O @ informado não é um perfil TikTok válido.";
		retryable = false;
	} else if (name === "UserOfflineError" || /(?:isn't online|not online|streamer.*offline|live.*(?:ended|offline)|not currently live)/.test(details)) {
		code = "LIVE_OFFLINE";
		message = "Esta live não está disponível no TikTok. Confira o @ e se a transmissão está pública e ativa.";
		retryable = false;
	} else if (name === "SignatureRateLimitError" || status === 429 || /rate.?limit|too many requests/.test(details)) {
		code = "RATE_LIMITED";
		message = "O acesso ao conector foi limitado temporariamente. Aguardando para tentar de novo.";
	} else if (status === 401 || status === 403 || /(?:unauthori[sz]ed|forbidden|access denied|invalid api key|premium feature|missing tokens|authenticate)/.test(details)) {
		code = "CONNECTOR_ACCESS";
		message = "O TikTok ou o serviço de conexão recusou o acesso. Verifique o conector e a disponibilidade da live.";
		retryable = false;
	} else if (name === "SignAPIError" || /(?:sign(?:ature)?.*(?:failed|error)|missing cursor)/.test(details)) {
		code = "SIGNATURE_UNAVAILABLE";
		message = "O serviço de assinatura da conexão TikTok está indisponível. Verifique a configuração do conector.";
		retryable = false;
	} else if (name === "ConnectTimeoutError" || status >= 500 || /(?:timeout|econnreset|econnrefused|enetunreach|eai_again|enotfound|socket hang up)/.test(details)) {
		code = "NETWORK_ERROR";
		message = "A conexão com o TikTok falhou por rede. Tentando novamente.";
	}

	const result = {
		code,
		message,
		retryable,
		username,
		timestamp: Date.now(),
	};
	// Only stable identifiers and a numeric status are exposed. Raw errors may
	// contain URLs, cookies, API keys or account details.
	if (/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) result.causeType = name;
	if (status !== null) result.httpStatus = status;
	const route = String(error?.config?.routeId || "");
	if (/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(route)) result.route = route;
	const retryAfter = Number(error?.retryAfter);
	if (code === "RATE_LIMITED" && Number.isFinite(retryAfter) && retryAfter > 0) {
		result.retryAfterMs = Math.min(Math.ceil(retryAfter), 10 * 60_000);
	}
	return result;
}

export function connectionInterrupted(username) {
	return {
		code: "CONNECTION_INTERRUPTED",
		message: "A conexão com a live caiu. Tentando recuperar.",
		retryable: true,
		username,
		timestamp: Date.now(),
	};
}
