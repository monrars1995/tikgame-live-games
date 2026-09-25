(() => {
	const params = new URLSearchParams(location.search);
	const demo = params.get("demo") === "1";
	const streamer = params.get("id") || params.get("username");
	const utils = window.LiveGameUtils;
	const engine = new window.TugEngine({ utils });
	const $ = (id) => document.getElementById(id);
	const elements = {
		mode: $("modeBadge"), status: $("statusText"), round: $("roundNumber"), timer: $("timer"),
		bluePower: $("bluePower"), redPower: $("redPower"), blueMembers: $("blueMembers"), redMembers: $("redMembers"),
		blueWins: $("blueWins"), redWins: $("redWins"), rope: $("ropeAssembly"), marker: $("momentumMarker"),
		blueLeaders: $("blueLeaders"), redLeaders: $("redLeaders"), winner: $("winnerBanner"),
		winnerText: $("winnerText"), ticker: $("actionTicker"), burst: $("burstLayer"),
	};
	const crews = document.querySelectorAll(".crew");
	let connectionText = demo ? "Demonstração · eventos simulados" : streamer ? "Conectando à live…" : "Abra pelo painel para conectar";
	let visualPosition = 0;
	let dirty = true;
	let lastHud = 0;
	let lastFrame = 0;
	let raf = 0;
	let demoInterval;
	if (demo) {
		elements.mode.textContent = "DEMONSTRAÇÃO";
		elements.mode.classList.add("demo");
	}

	const onLive = (type, handler) => window.TikTokBridge.on(type, (event) => {
		if (!demo) handler(event);
	});
	onLive("chat", (event) => engine.handleChat(event));
	onLive("like", (event) => engine.handleLike(event));
	onLive("gift", (event) => engine.handleGift(event));
	onLive("connected", () => { connectionText = ""; dirty = true; });
	onLive("reconnecting", () => { connectionText = "Reconectando à live…"; dirty = true; });
	onLive("disconnected", () => { connectionText = "Live desconectada · reconectando…"; dirty = true; });
	onLive("error", () => { connectionText = "Sem conexão · confira o @ e a live"; dirty = true; });

	function burst(color, amount) {
		const fragment = document.createDocumentFragment();
		for (let i = 0; i < amount; i++) {
			const particle = document.createElement("i");
			particle.className = "spark";
			particle.style.setProperty("--spark-color", color);
			particle.style.setProperty("--dx", `${(Math.random() - .5) * 320}px`);
			particle.style.setProperty("--dy", `${(Math.random() - .5) * 180}px`);
			particle.style.left = `${50 + visualPosition * .3}%`;
			particle.addEventListener("animationend", () => particle.remove(), { once: true });
			fragment.appendChild(particle);
		}
		elements.burst.appendChild(fragment);
	}

	engine.on("action", ({ kind, member, teamIdx, detail, power }) => {
		const team = teamIdx === 0 ? "AZUL" : "VERMELHO";
		const verb = kind === "gift" ? `mandou ${detail}` : kind === "like" ? `deu ${detail}` : "entrou na disputa";
		elements.ticker.textContent = `@${member.name} ${verb} · +${power.toFixed(1)} para o ${team}`;
		elements.ticker.classList.remove("hit");
		void elements.ticker.offsetWidth;
		elements.ticker.classList.add("hit");
		if (kind === "gift") burst(teamIdx === 0 ? "#59d9ff" : "#ff6489", Math.min(36, Math.ceil(power / 2) + 8));
		dirty = true;
	});
	engine.on("finish", ({ winnerIdx }) => {
		const color = winnerIdx === 0 ? "#65ddff" : winnerIdx === 1 ? "#ff728f" : "#ffe1a6";
		elements.winner.style.setProperty("--winner-color", color);
		elements.winnerText.textContent = winnerIdx === null ? "EMPATE!" : `${winnerIdx === 0 ? "AZUL" : "VERMELHO"} VENCEU!`;
		elements.winner.classList.remove("hidden");
		burst(color, 45);
		dirty = true;
	});
	engine.on("phase", (phase) => {
		if (phase === "waiting") {
			elements.winner.classList.add("hidden");
			elements.ticker.textContent = "Seu time precisa de você!";
		}
		dirty = true;
	});

	function buildLeaders(container, teamIdx) {
		container.replaceChildren();
		const leaders = engine.leaders(teamIdx, 3);
		if (!leaders.length) {
			const empty = document.createElement("span");
			empty.className = "leader-placeholder";
			empty.textContent = "Seu nome pode aparecer aqui";
			container.appendChild(empty);
			return;
		}
		leaders.forEach((member, index) => {
			const row = document.createElement("div");
			row.className = "leader-row";
			const rank = document.createElement("span");
			rank.className = "rank";
			rank.textContent = `${index + 1}.`;
			const name = document.createElement("span");
			name.className = "name";
			name.textContent = `@${member.name}`;
			const value = document.createElement("span");
			value.className = "value";
			value.textContent = `${(Math.round(member.power * 10) / 10).toLocaleString("pt-BR")} ⚡`;
			row.append(rank, name, value);
			container.appendChild(row);
		});
	}

	function refreshHud() {
		const { state } = engine;
		const remaining = Math.ceil(engine.remaining() / 1000);
		elements.round.textContent = String(state.round).padStart(2, "0");
		elements.timer.textContent = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
		for (let i = 0; i < 2; i++) {
			const prefix = i === 0 ? "blue" : "red";
			const team = state.teams[i];
			elements[`${prefix}Power`].textContent = (Math.round(team.power * 10) / 10).toLocaleString("pt-BR");
			elements[`${prefix}Members`].textContent = `${team.members} ${team.members === 1 ? "jogador" : "jogadores"}`;
			elements[`${prefix}Wins`].textContent = team.wins;
		}
		const phaseText = state.phase === "waiting" ? "Comente para entrar na disputa"
			: state.phase === "result" ? "Rodada encerrada!"
			: "Puxe a corda com sua equipe!";
		elements.status.textContent = connectionText || phaseText;
		if (dirty) {
			buildLeaders(elements.blueLeaders, 0);
			buildLeaders(elements.redLeaders, 1);
			dirty = false;
		}
	}

	function frame(at) {
		engine.tick();
		const delta = Math.min(2, Math.max(.2, (at - lastFrame) / 16.67 || 1));
		lastFrame = at;
		visualPosition += (engine.state.position - visualPosition) * Math.min(.22, .105 * delta);
		if (Math.abs(visualPosition - engine.state.position) < .015) visualPosition = engine.state.position;
		const shift = visualPosition * .5;
		elements.rope.style.setProperty("--rope-shift", `${shift}px`);
		elements.marker.style.left = `${50 + visualPosition * .46}%`;
		for (const crew of crews) crew.style.setProperty("--crew-shift", `${shift}px`);
		if (at - lastHud > 100 || dirty) {
			refreshHud();
			lastHud = at;
		}
		raf = requestAnimationFrame(frame);
	}

	if (demo) {
		const demoUsers = ["Lia", "Davi", "Bia", "Rafa", "Maju", "Theo", "Nina", "Leo"];
		let step = 0;
		const demoAction = () => {
			const index = step++ % demoUsers.length;
			const user = { uniqueId: `demo${index}`, nickname: demoUsers[index] };
			if (step <= demoUsers.length) engine.handleChat({ user, comment: index % 2 === 0 ? "azul" : "vermelho" });
			else if (step % 4 === 0) engine.handleGift({ user, giftName: "Rosa", giftId: 5655, giftValue: 1, repeatCount: step % 8 === 0 ? 5 : 1, messageId: `demo-gift-${step}` });
			else if (step % 7 === 0) engine.handleGift({ user, giftName: "Presente especial", giftValue: 50, repeatCount: 1, messageId: `demo-gift-${step}` });
			else engine.handleLike({ user, likeCount: 10 + step % 30 });
		};
		for (let i = 0; i < 3; i++) demoAction();
		demoInterval = setInterval(demoAction, 1_250);
	}
	raf = requestAnimationFrame(frame);
	window.addEventListener("pagehide", () => { cancelAnimationFrame(raf); clearInterval(demoInterval); });
})();
