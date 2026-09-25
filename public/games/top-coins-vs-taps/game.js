(() => {
	const utils = window.LiveGameUtils;
	const engine = new window.TopBattleEngine();
	const gifts = new utils.GiftTracker();
	const params = new URLSearchParams(window.location.search);
	const demo = params.get("demo") === "1";
	const hasStreamer = params.has("id") || params.has("username");
	const $ = (id) => document.getElementById(id);
	const status = $("liveStatus");
	const result = $("result");
	const effects = $("effects");
	let lastRound = engine.round;
	let lastPhase = engine.phase;
	let lastSecond = -1;
	let dirty = true;
	let lastEffectAt = 0;

	function setStatus(message, tone = "") {
		status.textContent = message;
		status.className = `live-status ${tone}`;
	}

	function initials(name) {
		return String(name || "?").trim().slice(0, 1).toUpperCase() || "?";
	}

	function hue(name) {
		let n = 0;
		for (const char of String(name)) n = (n * 31 + char.charCodeAt(0)) % 360;
		return n;
	}

	function renderRows(container, people, side) {
		const fragment = document.createDocumentFragment();
		for (let i = 0; i < 10; i++) {
			const person = people[i];
			const row = document.createElement("li");
			row.className = `rank-row${person ? "" : " rank-empty"}`;
			const pos = document.createElement("b");
			pos.className = "rank-pos";
			pos.textContent = i === 0 ? "♛" : String(i + 1);
			const avatar = document.createElement("span");
			avatar.className = "rank-avatar";
			avatar.style.setProperty("--hue", String(hue(person?.name || `rank${i}`)));
			avatar.textContent = initials(person?.name || "?");
			const name = document.createElement("span");
			name.className = "rank-name";
			name.textContent = person?.name || `Top ${i + 1}`;
			const value = document.createElement("strong");
			value.className = "rank-value";
			value.textContent = `${utils.formatNumber(person?.[side] || 0)}${side === "coins" ? " 🪙" : " ♥"}`;
			row.append(pos, avatar, name, value);
			fragment.appendChild(row);
		}
		container.replaceChildren(fragment);
	}

	function burst(side, amount, major = false) {
		const now = Date.now();
		if (now - lastEffectAt < 120) return;
		lastEffectAt = now;
		const effect = document.createElement("span");
		effect.className = `effect ${side}${major ? " major" : ""}`;
		effect.textContent = `${side === "coins" ? "🪙" : "❤️"} +${utils.formatNumber(amount)}`;
		effect.style.left = `${side === "coins" ? 8 + Math.random() * 25 : 58 + Math.random() * 22}%`;
		effect.style.top = `${42 + Math.random() * 20}%`;
		effects.appendChild(effect);
		if (effects.children.length > 24) effects.firstElementChild.remove();
		setTimeout(() => effect.remove(), 1100);
	}

	function receiveGift(event) {
		const units = gifts.consume(event);
		if (!units) return;
		const amount = engine.gift(event, units);
		if (amount > 0) {
			dirty = true;
			burst("coins", amount, Number(event.giftValue) >= 50 || units >= 5);
		}
	}

	function receiveLike(event) {
		const amount = engine.like(event);
		if (amount > 0) {
			dirty = true;
			burst("taps", amount, amount >= 30);
		}
	}

	function render() {
		const state = engine.tick();
		if (state.round !== lastRound) {
			lastRound = state.round;
			// Keep combo progress across the result screen and round boundary.
			dirty = true;
		}
		if (state.phase !== lastPhase) {
			lastPhase = state.phase;
			dirty = true;
		}

		const seconds = Math.ceil(state.remainingMs / 1000);
		if (seconds !== lastSecond) {
			lastSecond = seconds;
			$("timer").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
		}
		if (!dirty) return;
		dirty = false;
		$("coinTotal").textContent = `${utils.formatNumber(state.coinTotal)} VALOR EM PRESENTES`;
		$("tapTotal").textContent = `${utils.formatNumber(state.tapTotal)} CURTIDAS`;
		$("topGift").textContent = state.topGift ? `${state.topGift.name} · ${state.topGift.giftName} · ${utils.formatNumber(state.topGift.value)}` : "Aguardando...";
		$("topCombo").textContent = state.topCombo ? `${state.topCombo.name} · ${state.topCombo.giftName} ×${utils.formatNumber(state.topCombo.count)}` : "Aguardando...";
		const totalPower = state.coinPower + state.tapPower;
		const coinShare = totalPower > 0 ? utils.clamp(state.coinPower / totalPower * 100, 3, 97) : 50;
		$("coinPower").style.width = `${coinShare}%`;
		$("tapPower").style.width = `${100 - coinShare}%`;
		renderRows($("coinsList"), state.coins, "coins");
		renderRows($("tapsList"), state.taps, "taps");
		result.classList.toggle("hidden", state.phase !== "finished");
		if (state.phase === "finished") {
			$("resultText").textContent = state.winner === "draw" ? "EMPATE!" : state.winner === "coins" ? "TOP MOEDAS VENCEU!" : "TOP TAPS VENCEU!";
		}
	}

	if (demo) {
		document.body.classList.add("demo");
		$("demoBadge").hidden = false;
		setStatus("MODO DEMONSTRAÇÃO", "connected");
		const names = ["Ana", "Eduardo", "Duda", "Lia", "Ramon", "Nina", "Bruno", "Bia", "Caio", "João", "Mila", "Luiz"];
		let sequence = 0;
		setInterval(() => {
			const name = names[Math.floor(Math.random() * names.length)];
			const user = { uniqueId: `demo_${name}`, nickname: name };
			if (Math.random() < 0.42) {
				const count = Math.random() < 0.22 ? 5 : 1;
				const value = Math.random() < 0.15 ? 50 : 1;
				receiveGift({ user, giftId: value === 1 ? 5655 : 9000, giftName: value === 1 ? "Rosa" : "Presente", giftValue: value, repeatCount: count, repeatEnd: true, messageId: `demo_${++sequence}` });
			} else {
				receiveLike({ user, likeCount: 5 + Math.floor(Math.random() * 40) });
			}
		}, 700);
	} else {
		setStatus(hasStreamer ? "CONECTANDO À LIVE…" : "ABRA PELO PAINEL PARA CONECTAR");
		window.TikTokBridge.on("chat", (event) => { engine.chat(event); });
		window.TikTokBridge.on("gift", receiveGift);
		window.TikTokBridge.on("like", receiveLike);
		window.TikTokBridge.on("connected", () => setStatus("AO VIVO · CONECTADO", "connected"));
		window.TikTokBridge.on("reconnecting", () => setStatus("RECONECTANDO…"));
		window.TikTokBridge.on("disconnected", () => setStatus("LIVE DESCONECTADA"));
		window.TikTokBridge.on("error", () => setStatus("FALHA · CONFIRA O @", "error"));
	}
	setInterval(render, 100);
	render();
})();
