/** TikTokBridge wiring and the lightweight DOM renderer for Rosas x Corações. */
(() => {
	const params = new URLSearchParams(window.location.search);
	const demo = params.get("demo") === "1";
	const streamer = params.get("id") || params.get("username");
	const engine = new DuelEngine();
	const utils = window.LiveGameUtils;
	const byId = (id) => document.getElementById(id);
	const stage = byId("stage");
	const effectLayer = byId("effectLayer");
	const winner = byId("winner");
	const connectionArea = document.querySelector(".status-area");
	const connectionText = byId("connectionText");
	let renderQueued = false;
	let lastLeaderboardKey = "";
	let hitTimer = 0;
	let shakeTimer = 0;

	if (demo) {
		byId("demoBadge").hidden = false;
		connectionText.textContent = "PRÉVIA LOCAL";
		connectionArea.classList.add("connected");
	} else if (streamer) {
		connectionText.textContent = "CONECTANDO…";
	} else {
		connectionText.textContent = "ABRA PELO PAINEL";
	}

	function setConnection(label, ready) {
		if (demo) return;
		connectionText.textContent = label;
		connectionArea.classList.toggle("connected", ready);
	}

	function scheduleRender() {
		if (renderQueued) return;
		renderQueued = true;
		window.requestAnimationFrame(() => { renderQueued = false; render(); });
	}

	function createRankRow(entry, index, side) {
		const item = document.createElement("li");
		item.className = "rank-item";
		const number = document.createElement("span");
		number.className = "rank-number";
		number.textContent = String(index + 1);
		const avatar = document.createElement("span");
		avatar.className = "rank-avatar";
		avatar.textContent = entry.name.slice(0, 1).toUpperCase() || "?";
		const name = document.createElement("span");
		name.className = "rank-name";
		name.textContent = entry.name;
		const value = document.createElement("span");
		value.className = "rank-value";
		value.textContent = `${utils.formatNumber(entry.value)} ${side === "roses" ? "🪙" : "♥"}`;
		item.append(number, avatar, name, value);
		return item;
	}

	function renderRanking(side, id) {
		const list = byId(id);
		const entries = engine.top(side, 3);
		const rows = [];
		for (let i = 0; i < 3; i++) {
			if (entries[i]) rows.push(createRankRow(entries[i], i, side));
			else {
				const empty = document.createElement("li");
				empty.className = "rank-empty";
				empty.textContent = i === 0 ? "Seu nome pode estar aqui" : "Aguardando torcida";
				rows.push(empty);
			}
		}
		list.replaceChildren(...rows);
	}

	function render() {
		const state = engine.tick();
		const totalSeconds = Math.ceil(state.remainingMs / 1000);
		const roseHealth = Math.max(0, Math.round(state.rosesHealth / engine.maxHealth * 100));
		const heartHealth = Math.max(0, Math.round(state.heartsHealth / engine.maxHealth * 100));
		byId("roundNumber").textContent = String(state.roundNumber).padStart(2, "0");
		byId("timer").textContent = `${String(Math.floor(totalSeconds / 60)).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
		byId("roundTrackFill").style.width = `${Math.max(0, state.remainingMs / engine.durationMs * 100)}%`;
		byId("roseCoins").textContent = utils.formatNumber(state.roseCoins);
		byId("heartLikes").textContent = utils.formatNumber(state.heartLikes);
		byId("roseHealthFill").style.width = `${roseHealth}%`;
		byId("heartHealthFill").style.width = `${heartHealth}%`;
		byId("roseHealthLabel").textContent = `${roseHealth}%`;
		byId("heartHealthLabel").textContent = `${heartHealth}%`;
		byId("roseJoined").textContent = utils.formatNumber(state.joined.roses);
		byId("heartJoined").textContent = utils.formatNumber(state.joined.hearts);
		const leaderboardKey = `${state.roundNumber}:${state.roseCoins}:${state.heartLikes}`;
		if (leaderboardKey !== lastLeaderboardKey) {
			lastLeaderboardKey = leaderboardKey;
			renderRanking("roses", "roseTop");
			renderRanking("hearts", "heartTop");
		}
		winner.hidden = state.phase !== "finished";
		if (state.phase === "finished") {
			byId("winnerTitle").textContent = state.winner === "roses" ? "🌹 ROSAS VENCERAM!" : state.winner === "hearts" ? "♥ CORAÇÕES VENCERAM!" : "EMPATE ÉPICO!";
			byId("winnerDetail").textContent = `${utils.formatNumber(state.roseCoins)} moedas  ×  ${utils.formatNumber(state.heartLikes)} curtidas${state.queuedRoseCoins ? ` · +${utils.formatNumber(state.queuedRoseCoins)} moedas na próxima` : ""}`;
		}
	}

	function addEffect(text, side, amount) {
		const now = performance.now();
		// At high event rates, gameplay continues without allocating hundreds of DOM nodes.
		if (now - addEffect.lastAt < 90) return;
		addEffect.lastAt = now;
		const label = document.createElement("span");
		label.className = `pop-label ${side}`;
		label.textContent = text;
		effectLayer.appendChild(label);
		label.addEventListener("animationend", () => label.remove(), { once: true });
		const quantity = side === "hearts" ? amount >= 60 ? 16 : amount >= 30 ? 12 : amount >= 10 ? 8 : 4 : amount >= 50 ? 16 : 9;
		for (let i = 0; i < quantity; i++) {
			const bit = document.createElement("span");
			bit.className = `burst ${side}`;
			bit.textContent = side === "roses" ? i % 3 === 0 ? "✦" : "🌹" : i % 3 === 0 ? "✦" : "♥";
			const angle = Math.PI * 2 * i / quantity;
			const radius = 65 + Math.random() * 90;
			bit.style.setProperty("--tx", `${Math.cos(angle) * radius}px`);
			bit.style.setProperty("--ty", `${Math.sin(angle) * radius}px`);
			bit.style.setProperty("--rot", `${Math.round(Math.random() * 360)}deg`);
			effectLayer.appendChild(bit);
			bit.addEventListener("animationend", () => bit.remove(), { once: true });
		}
		stage.classList.remove("hit-roses", "hit-hearts");
		stage.classList.add(`hit-${side}`);
		window.clearTimeout(hitTimer);
		hitTimer = window.setTimeout(() => stage.classList.remove("hit-roses", "hit-hearts"), 260);
		if (side === "hearts" && amount >= 30) {
			stage.classList.remove("frenzy");
			void stage.offsetWidth;
			stage.classList.add("frenzy");
			window.clearTimeout(shakeTimer);
			shakeTimer = window.setTimeout(() => stage.classList.remove("frenzy"), 600);
		}
	}
	addEffect.lastAt = 0;

	engine.on((event) => {
		if (event.type === "hit") addEffect(
			event.side === "roses" ? `🌹 +${utils.formatNumber(event.amount)} MOEDAS` : `♥ +${utils.formatNumber(event.amount)} TAPS`,
			event.side, event.amount,
		);
		scheduleRender();
	});

	if (!demo) {
		TikTokBridge.on("chat", (event) => engine.handleChat(event));
		TikTokBridge.on("gift", (event) => engine.handleGift(event));
		TikTokBridge.on("like", (event) => engine.handleLike(event));
		TikTokBridge.on("connected", () => setConnection("LIVE CONECTADA", true));
		TikTokBridge.on("reconnecting", () => setConnection("RECONECTANDO…", false));
		TikTokBridge.on("disconnected", () => setConnection("LIVE DESCONECTADA", false));
		TikTokBridge.on("error", () => setConnection("VERIFIQUE O @ E A LIVE", false));
	}

	if (demo) {
		const people = ["Luna", "Leo", "Bia", "Davi", "Mari", "Rafa", "Nina", "Gui"];
		people.forEach((name, index) => engine.handleChat({ user: { uniqueId: name.toLowerCase(), nickname: name }, comment: index % 2 ? "coração" : "rosa" }));
		let step = 0;
		window.setInterval(() => {
			if (engine.state.phase === "finished") return;
			step++;
			const name = people[step % people.length];
			const participant = { uniqueId: name.toLowerCase(), nickname: name };
			if (step % 3 === 0) {
				engine.handleGift({ user: participant, giftId: 5655, giftName: "Rose", giftValue: 1, repeatCount: step % 9 === 0 ? 5 : 1 });
			} else {
				engine.handleLike({ user: participant, likeCount: step % 10 === 0 ? 60 : step % 5 === 0 ? 30 : 9 + step % 13 });
			}
		}, 850);
	}

	window.setInterval(scheduleRender, 100);
	scheduleRender();
	if (demo) window.TikGameDuelDemo = engine;
})();
