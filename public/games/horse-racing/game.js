/**
 * game.js
 * Horse Racing — Canvas renderer + TikTokBridge wiring.
 * Reads state from RaceEngine, draws track + horses on Canvas,
 * updates DOM HUD elements (flags, gift legend, event feed).
 *
 * @module games/horse-racing/game
 */

(() => {
	// ==========================================
	// SETUP
	// ==========================================
	const config = window.RACE_CONFIG;
	const engine = new RaceEngine(config);
	let visualDistances = config.lanes.map(() => 0);
	let particles = [];

	const canvas = document.getElementById("raceCanvas");
	const ctx = canvas.getContext("2d");

	// DOM HUD elements
	const phaseBanner = document.getElementById("phaseBanner");
	const phaseText = document.getElementById("phaseText");
	const phaseTimer = document.getElementById("phaseTimer");
	const laneLabelsDiv = document.getElementById("laneLabels");
	const eventFeedDiv = document.getElementById("eventFeed");
	const winnerOverlay = document.getElementById("winnerOverlay");
	const winnerEmoji = document.getElementById("winnerEmoji");
	const winnerName = document.getElementById("winnerName");
	const winnerSupporters = document.getElementById("winnerSupporters");
	const hasStreamer = new URLSearchParams(window.location.search).has("id") ||
		new URLSearchParams(window.location.search).has("username");
	let connectionHint = hasStreamer ? "Conectando à live…" : "Abra a arena pelo painel para conectar";

	// ==========================================
	// CANVAS SIZING
	// ==========================================
	function resize() {
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
	}
	window.addEventListener("resize", resize);
	resize();

	// ==========================================
	// BRIDGE → ENGINE WIRING
	// ==========================================
	TikTokBridge.on("gift", (data) => engine.handleGift(data));
	TikTokBridge.on("chat", (data) => engine.handleChat(data));
	TikTokBridge.on("like", (data) => engine.handleLike(data));
	TikTokBridge.on("connected", () => { connectionHint = null; });
	TikTokBridge.on("reconnecting", () => { connectionHint = "Reconectando à live…"; });
	TikTokBridge.on("disconnected", () => { connectionHint = "Live desconectada · reconectando…"; });
	TikTokBridge.on("error", () => { connectionHint = "Sem conexão · confira o @ e a live"; });
	engine.on("laneMove", ({ laneIdx, lane, distance }) => {
		const width = canvas.width;
		const height = canvas.height;
		const left = Math.min(280, Math.max(175, width * 0.39));
		const right = width - Math.max(20, width * 0.04);
		const x = left + (right - left) * (lane.distance / config.finishLine);
		const y = height * (0.15 + (laneIdx + 0.5) * 0.7 / config.lanes.length);
		const amount = Math.min(24, Math.max(5, Math.round(distance / 4)));
		for (let i = 0; i < amount; i++) {
			particles.push({ x, y, vx: (Math.random() - 0.5) * 5, vy: (Math.random() - 0.5) * 5, life: 1, color: lane.color });
		}
		if (particles.length > 220) particles.splice(0, particles.length - 220);
	});
	engine.on("raceFinished", ({ winner }) => {
		for (let i = 0; i < 90; i++) {
			particles.push({ x: canvas.width / 2, y: canvas.height * 0.42, vx: (Math.random() - 0.5) * 12, vy: -Math.random() * 9, life: 1, color: i % 3 ? winner.color : "#ffe3a2" });
		}
		if (particles.length > 220) particles.splice(0, particles.length - 220);
	});

	// ==========================================
	// BUILD LANE LABELS (with gift legend)
	// ==========================================
	function buildLaneLabels() {
		laneLabelsDiv.innerHTML = "";
		config.lanes.forEach((lane) => {
			const el = document.createElement("div");
			el.className = "lane-label";
			el.id = `lane-label-${lane.id}`;
			el.style.borderLeftColor = lane.color;

			const voteNum = lane.id + 1; // 1-indexed for viewers

			el.innerHTML =
				`<div class="lane-top">` +
				`<span class="lane-flag">${lane.flag}</span> ` +
				`<span class="lane-name">${lane.name}</span> ` +
				`<span class="lane-vote">COMENTE ${voteNum}</span>` +
				`<span class="lane-dist">0%</span>` +
				`</div>`;
			laneLabelsDiv.appendChild(el);
		});
	}
	buildLaneLabels();

	// Rebuild lane labels on reset (flags might re-render)
	engine.on("phaseChange", ({ phase }) => {
		if (phase === "waiting") {
			buildLaneLabels();
			visualDistances = config.lanes.map(() => 0);
		}
	});

	// ==========================================
	// RENDER LOOP
	// ==========================================
	let lastFeedHead = null;

	function frame() {
		const state = engine.tick();
		drawTrack(state);
		updateHUD(state);
		requestAnimationFrame(frame);
	}

	// ==========================================
	// CANVAS DRAWING
	// ==========================================
	function drawTrack(state) {
		const W = canvas.width;
		const H = canvas.height;
		const laneCount = state.lanes.length;

		// Clear
		ctx.clearRect(0, 0, W, H);

		// Track dimensions
		const trackTop = H * 0.15;
		const trackBottom = H * 0.85;
		const trackHeight = trackBottom - trackTop;
		const laneH = trackHeight / laneCount;
		const trackLeft = Math.min(280, Math.max(175, W * 0.39));
		const trackRight = W - Math.max(20, W * 0.04);
		const trackWidth = trackRight - trackLeft;

		// Draw track background
		ctx.fillStyle = "rgba(5, 10, 28, 0.24)";
		ctx.beginPath();
		ctx.roundRect(
			trackLeft - 10,
			trackTop - 10,
			trackWidth + 20,
			trackHeight + 20,
			12,
		);
		ctx.fill();

		// Draw lanes
		state.lanes.forEach((lane, i) => {
			const y = trackTop + i * laneH;

			// Lane stripe (alternating)
			if (i % 2 === 0) {
				ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
				ctx.fillRect(trackLeft, y, trackWidth, laneH);
			}

			// Lane divider
			if (i > 0) {
				ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
				ctx.lineWidth = 1;
				ctx.setLineDash([8, 8]);
				ctx.beginPath();
				ctx.moveTo(trackLeft, y);
				ctx.lineTo(trackRight, y);
				ctx.stroke();
				ctx.setLineDash([]);
			}

			// Progress bar
			visualDistances[i] += (lane.distance - visualDistances[i]) * 0.11;
			if (Math.abs(lane.distance - visualDistances[i]) < 0.05) visualDistances[i] = lane.distance;
			const progress = Math.min(visualDistances[i] / config.finishLine, 1);
			const barWidth = trackWidth * progress;
			ctx.fillStyle = lane.color + "50";
			ctx.fillRect(trackLeft, y + 4, barWidth, laneH - 8);

			// Horse position
			const horseX = trackLeft + barWidth;
			const horseY = y + laneH / 2;

			// Horse circle (lane color)
			ctx.beginPath();
			ctx.shadowColor = lane.color;
			ctx.shadowBlur = 22;
			ctx.arc(horseX, horseY, Math.min(laneH * 0.28, 27), 0, Math.PI * 2);
			ctx.fillStyle = lane.color;
			ctx.fill();
			ctx.strokeStyle = "#fff";
			ctx.lineWidth = 2;
			ctx.stroke();
			ctx.shadowBlur = 0;

			// A horse sprite-like glyph makes the runner unmistakable at 450px.
			const flagSize = Math.min(31, Math.round(laneH * 0.32));
			ctx.font = `${flagSize}px serif`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText("🏇", horseX, horseY);
		});

		// Finish line
		ctx.strokeStyle = "rgba(255, 215, 0, 0.6)";
		ctx.lineWidth = 3;
		ctx.setLineDash([12, 6]);
		ctx.beginPath();
		ctx.moveTo(trackRight, trackTop - 5);
		ctx.lineTo(trackRight, trackBottom + 5);
		ctx.stroke();
		ctx.setLineDash([]);

		// Finish label
		ctx.fillStyle = "#ffd700";
		ctx.font = "bold 14px sans-serif";
		ctx.textAlign = "center";
		ctx.fillText("CHEGADA", trackRight - 12, trackTop - 15);

		particles = particles.filter((particle) => particle.life > 0.02);
		for (const particle of particles) {
			particle.x += particle.vx;
			particle.y += particle.vy;
			particle.vy += 0.1;
			particle.life -= 0.025;
			ctx.globalAlpha = Math.max(0, particle.life);
			ctx.fillStyle = particle.color;
			ctx.fillRect(particle.x, particle.y, 3.5, 3.5);
		}
		ctx.globalAlpha = 1;
	}

	// ==========================================
	// HUD UPDATE
	// ==========================================
	function updateHUD(state) {
		// Phase text
		const phaseLabels = {
			waiting: "🏇 Comente para começar",
			countdown: "⏳ Preparar, apontar...",
			racing: "🏁 Corrida valendo!",
			finished: "🎉 Temos um campeão!",
			cooldown: "⏳ Próxima corrida em breve",
		};
		phaseText.textContent = connectionHint || phaseLabels[state.phase] || state.phase;

		// Phase timer
		const remaining = engine.phaseRemaining();
		if (remaining !== Infinity && remaining > 0) {
			phaseTimer.textContent = Math.ceil(remaining / 1000) + "s";
		} else {
			phaseTimer.textContent = "";
		}

		// Countdown pulse animation
		if (state.phase === "countdown") {
			phaseBanner.classList.add("countdown");
		} else {
			phaseBanner.classList.remove("countdown");
		}

		// Lane labels (progress %)
		state.lanes.forEach((lane) => {
			const el = document.getElementById(`lane-label-${lane.id}`);
			if (el) {
				const pct = Math.round((lane.distance / config.finishLine) * 100);
				el.querySelector(".lane-dist").textContent = pct + "%";
			}
		});

		// Event feed
		if (state.recentEvents[0] !== lastFeedHead) {
			lastFeedHead = state.recentEvents[0] || null;
			renderFeed(state.recentEvents.slice(0, 8));
		}

		// Winner overlay
		if (state.phase === "finished" && state.winner) {
			showWinner(state.winner);
		} else {
			winnerOverlay.classList.add("hidden");
		}
	}

	function renderFeed(events) {
		eventFeedDiv.innerHTML = "";
		events.forEach((evt) => {
			const el = document.createElement("div");
			el.className = "feed-item " + evt.type;
			if (evt.type === "gift") {
				el.textContent = `${evt.giftEmoji} ${evt.nickname} → ${evt.laneFlag} · ${evt.count > 1 ? `${evt.count}× · ` : ""}+${Math.round(evt.distance)}`;
			} else if (evt.type === "vote") {
				el.textContent = `💬 ${evt.nickname} → ${evt.laneFlag} (+${evt.distance})`;
			} else if (evt.type === "chat") {
				el.textContent = `💬 ${evt.nickname}: ${evt.text}`;
			} else if (evt.type === "like") {
				el.textContent = `❤️ ${evt.nickname} → ${evt.laneFlag} · ${evt.count} curtidas`;
			}
			eventFeedDiv.appendChild(el);
		});
	}

	function showWinner(winner) {
		winnerOverlay.classList.remove("hidden");
		winnerEmoji.textContent = `🏇 ${winner.flag}`;
		winnerName.textContent = winner.name + " venceu!";
		winnerName.style.color = winner.color;

		// Top 3 supporters
		const supporters = Array.from(winner.supporters.values())
			.sort((a, b) => b.totalContrib - a.totalContrib)
			.slice(0, 3);

		if (supporters.length > 0) {
			winnerSupporters.textContent =
				"Torcida destaque: " +
				supporters.map((s) => `${s.nickname} (${Math.round(s.totalContrib)})`).join(", ");
		} else {
			winnerSupporters.textContent = "";
		}
	}

	// ==========================================
	// START
	// ==========================================
	requestAnimationFrame(frame);
	console.log(
		"[HorseRacing] Game loaded, waiting for TikTokBridge connection...",
	);
})();
