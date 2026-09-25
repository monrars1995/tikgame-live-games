import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyConnectionError } from "../src/lib/tiktokConnectionError.js";

test("classifies an offline room without exposing connector exception text", () => {
	class UserOfflineError extends Error {}
	const result = classifyConnectionError(new UserOfflineError("The requested user isn't online :( token=secret"), "streamer");
	assert.equal(result.code, "LIVE_OFFLINE");
	assert.equal(result.retryable, false);
	assert.equal(result.username, "streamer");
	assert.equal(result.causeType, "UserOfflineError");
	assert.equal(Number.isFinite(result.timestamp), true);
	assert.doesNotMatch(JSON.stringify(result), /secret|token=/);
});

test("extracts connector 2.x error event payload and classifies forbidden access", () => {
	const result = classifyConnectionError({
		info: "Error while connecting",
		exception: Object.assign(new Error("Request failed with status code 403. api_key=secret"), { response: { statusCode: 403 } }),
	}, "streamer");
	assert.equal(result.code, "CONNECTOR_ACCESS");
	assert.equal(result.retryable, false);
	assert.equal(result.httpStatus, 403);
	assert.match(result.message, /recusou o acesso/);
	assert.doesNotMatch(JSON.stringify(result), /api_key|secret/);
});

test("respects connector rate-limit delay and retries network failures", () => {
	class SignatureRateLimitError extends Error {}
	const rate = new SignatureRateLimitError("rate limited");
	rate.retryAfter = 17_000;
	assert.deepEqual(
		(({ code, retryable, retryAfterMs }) => ({ code, retryable, retryAfterMs }))(classifyConnectionError(rate, "streamer")),
		{ code: "RATE_LIMITED", retryable: true, retryAfterMs: 17_000 },
	);
	const network = classifyConnectionError(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }), "streamer");
	assert.equal(network.code, "NETWORK_ERROR");
	assert.equal(network.retryable, true);
});
