import { KiteEngine } from "./kite-engine.js";

const canvas = document.getElementById("arena");
const ctx = canvas.getContext("2d", { alpha: false });
const engine = new KiteEngine();
const utils = window.LiveGameUtils;
const tracker = new utils.GiftTracker();
const demo = new URLSearchParams(location.search).get("demo") === "1";
const $ = (id) => document.getElementById(id);
const timer = $("timer");
const phaseLabel = $("phaseLabel");
const roundNumber = $("roundNumber");
const pilotCount = $("pilotCount");
const ranking = $("ranking");
const queueCount = $("queueCount");
const connectionStatus = $("connectionStatus");
const connectionTitle = $("connectionTitle");
const connectionDetail = $("connectionDetail");
const announcer = $("announcer");
const winner = $("winner");
const winnerName = $("winnerName");
const particles = [];
let noticeUntil = 0;
let lastHud = 0;
let lastRankKey = "";
let connected = false;
const liveUsername = (new URLSearchParams(location.search).get("id") || new URLSearchParams(location.search).get("username") || "")
  .trim().replace(/^@/, "").toLowerCase();
let lastLiveError = null;
let retryAttempt = 0;
let maxAttempts = 5;
let retryDelayMs = 0;
let exhausted = false;

function status(title, detail = "", tone = "pending") {
  connectionTitle.textContent = title;
  connectionDetail.textContent = detail;
  connectionStatus.className = `connection-status ${tone}`;
}

function cause(error) {
  if (typeof error === "string") return error.trim().slice(0, 130);
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "");
  if (/LOCAL_SOCKET|ECONNREFUSED/.test(code) || /ECONNREFUSED|websocket error/i.test(message)) {
    return "Servidor local indisponível. Confira se o TikGame está aberto.";
  }
  if (/NOT_LIVE|LIVE_OFFLINE|LIVE_ENDED|ROOM_NOT_FOUND|LIVE_NOT_FOUND/.test(code)
    || /not live|not found|currently streaming|cannot connect to .*live/i.test(message)) {
    return "Live não encontrada. Confira o @ e se a transmissão está ativa e pública.";
  }
  if (/ACCESS_DENIED|FORBIDDEN|UNAUTHORIZED|AUTH_/.test(code) || /access denied|forbidden|unauthorized|status 403/i.test(message)) {
    return "TikTok recusou o acesso a esta live.";
  }
  if (/RATE_LIMIT|TOO_MANY/.test(code) || /rate limit|too many requests|status 429/i.test(message)) {
    return "TikTok limitou novas conexões temporariamente.";
  }
  if (/TIMEOUT|TIMED_OUT/.test(code) || /timed? ?out|ETIMEDOUT/i.test(message)) {
    return "TikTok não respondeu a tempo.";
  }
  if (message && !/reconnect failed|tentativas esgotadas/i.test(message)) return message.trim().slice(0, 130);
  return "Não foi possível acessar a transmissão.";
}

function showRetry() {
  if (exhausted) return;
  const progress = retryAttempt > 0 ? ` · ${retryAttempt}/${maxAttempts}` : "";
  const wait = retryDelayMs > 0 ? ` Próxima tentativa em ${Math.ceil(retryDelayMs / 1000)} s.` : " Tentando novamente.";
  status(`@${liveUsername} · RECONECTANDO${progress}`, `${cause(lastLiveError)}${wait}`, "retrying");
}

if (demo) {
  $("demoBadge").hidden = false;
  status("DEMONSTRAÇÃO", "Prévia interativa com eventos simulados.");
  const names = ["Ana", "Biel", "Carla", "Davi", "Eva", "Fê", "Gui", "Iara"];
  for (let index = 0; index < names.length; index++) {
    engine.chat({ user: { uniqueId: `demo-${index}`, nickname: names[index] }, comment: "solta pipa" });
  }
  let turn = 0;
  setInterval(() => {
    const index = turn % names.length;
    const user = { uniqueId: `demo-${index}`, nickname: names[index] };
    if (turn % 4 === 0) engine.gift({ user, giftName: "Rose", giftValue: 1 }, turn % 12 === 0 ? 5 : 1, true);
    else if (turn % 11 === 0) engine.gift({ user, giftName: "Special", giftValue: 50 }, 1, false);
    else engine.like({ user, likeCount: turn % 3 === 0 ? 60 : 14 });
    turn++;
  }, 1400);
} else {
  status(liveUsername ? `CONECTANDO @${liveUsername}` : "LIVE SEM PERFIL",
    liveUsername ? "Aguardando acesso à transmissão." : "Abra a arena pelo painel com o @ da live.");
  window.TikTokBridge.on("connected", () => {
    connected = true;
    lastLiveError = null;
    retryAttempt = 0;
    retryDelayMs = 0;
    exhausted = false;
    status(`● LIVE @${liveUsername} CONECTADA`, "Interações ativadas.", "live");
  });
  window.TikTokBridge.on("disconnected", (data) => {
    connected = false;
    if (data?.source === "local") {
      status("PONTE LOCAL INTERROMPIDA", "Reconectando ao servidor TikGame…", "local");
    } else {
      lastLiveError = { message: "Sinal da live interrompido." };
      showRetry();
    }
  });
  window.TikTokBridge.on("reconnecting", (data) => {
    connected = false;
    if (data?.source === "local") {
      status("PONTE LOCAL · RECONECTANDO", "Confira se o servidor TikGame continua aberto.", "local");
      return;
    }
    if (exhausted) return;
    if (data?.lastError) lastLiveError = data.lastError;
    retryAttempt = Number.isFinite(Number(data?.attempt)) ? Math.max(0, Math.floor(Number(data.attempt))) : retryAttempt;
    maxAttempts = Number.isFinite(Number(data?.maxAttempts)) && Number(data.maxAttempts) > 0
      ? Math.floor(Number(data.maxAttempts)) : maxAttempts;
    retryDelayMs = Number.isFinite(Number(data?.delayMs)) ? Math.max(0, Number(data.delayMs)) : 0;
    showRetry();
  });
  window.TikTokBridge.on("error", (error) => {
    connected = false;
    if (error?.source === "local") {
      status("SERVIDOR TIKGAME INDISPONÍVEL", cause(error), "local");
      return;
    }
    lastLiveError = error?.lastError || (error?.exhausted ? lastLiveError || error : error || lastLiveError);
    if (error?.exhausted || error?.retryable === false) {
      exhausted = true;
      const progress = error?.exhausted ? ` APÓS ${retryAttempt || maxAttempts} TENTATIVAS` : "";
      status(`LIVE @${liveUsername} INDISPONÍVEL${progress}`,
        `${cause(lastLiveError)} Confira a live e abra o diagnóstico no painel para tentar de novo.`, "error");
      return;
    }
    showRetry();
  });
  window.TikTokBridge.on("chat", (event) => engine.chat(event));
  window.TikTokBridge.on("like", (event) => engine.like(event));
  window.TikTokBridge.on("gift", (event) => {
    const units = tracker.consume(event);
    if (units) engine.gift(event, units, utils.isRose(event));
  });
}

function seeded(seed) {
  const value = Math.sin(seed * 90.391 + 4.723) * 13792.332;
  return value - Math.floor(value);
}

const city = document.createElement("canvas");
city.width = 450;
city.height = 800;
const cityCtx = city.getContext("2d");

function drawCity() {
  const c = cityCtx;
  c.fillStyle = "#6592ab";
  c.beginPath();
  c.moveTo(0, 660);
  c.bezierCurveTo(75, 505, 160, 532, 240, 630);
  c.bezierCurveTo(335, 540, 365, 570, 450, 610);
  c.lineTo(450, 800); c.lineTo(0, 800); c.fill();
  c.fillStyle = "#486f88";
  c.beginPath(); c.moveTo(0, 696); c.bezierCurveTo(120, 556, 169, 625, 234, 680);
  c.bezierCurveTo(300, 581, 395, 587, 450, 657);
  c.lineTo(450, 800); c.lineTo(0, 800); c.fill();

  const colors = ["#e7aa77", "#df916f", "#c88b7a", "#f0bb83", "#b57e81", "#dca789", "#a87576"];
  for (let row = 0; row < 4; row++) {
    const y = 625 + row * 46;
    for (let column = -1; column < 9; column++) {
      const x = column * 58 + ((row % 2) * 24) + seeded(column * 17 + row) * 7;
      const w = 51 + seeded(column * 23 + row) * 20;
      const h = 45 + seeded(column * 13 + row) * 24;
      c.fillStyle = colors[Math.floor(seeded(column * 9 + row * 8) * colors.length)];
      c.fillRect(x, y - h, w, h + 3);
      c.fillStyle = "#865c67";
      c.beginPath(); c.moveTo(x - 4, y - h); c.lineTo(x + w + 4, y - h);
      c.lineTo(x + w, y - h - 5); c.lineTo(x, y - h - 5); c.fill();
      c.fillStyle = "#3a5d70";
      c.fillRect(x + 10, y - h + 13, 10, 14);
      c.fillRect(x + w - 20, y - h + 12, 11, 14);
      c.fillStyle = "#f8d6a3";
      c.fillRect(x + 12, y - h + 15, 6, 8);
      if (row >= 2) {
        c.fillStyle = "#594a54";
        c.fillRect(x + w / 2 - 5, y - h + 25, 13, h - 25);
      }
    }
  }
  // Rooftop water tanks, antennas and a glowing electrical pole.
  c.fillStyle = "#153d57";
  c.fillRect(88, 580, 23, 28); c.fillRect(85, 578, 29, 7);
  c.fillRect(305, 601, 25, 29); c.fillRect(302, 598, 31, 7);
  c.strokeStyle = "#1c4358"; c.lineWidth = 3;
  c.beginPath(); c.moveTo(183, 605); c.lineTo(183, 556); c.moveTo(170, 568); c.lineTo(197, 568); c.stroke();
  c.fillStyle = "#274b5c"; c.fillRect(408, 515, 6, 285);
  c.fillRect(389, 539, 44, 7); c.fillRect(393, 558, 37, 5);
  c.fillStyle = "#172e46"; c.fillRect(395, 535, 7, 14); c.fillRect(420, 535, 7, 14);
  c.strokeStyle = "#314657"; c.lineWidth = 2;
  c.beginPath(); c.moveTo(0, 585); c.quadraticCurveTo(190, 650, 399, 542);
  c.moveTo(0, 607); c.quadraticCurveTo(200, 658, 424, 550); c.stroke();
  c.fillStyle = "#24465b"; c.fillRect(0, 733, 450, 67);
  c.fillStyle = "#365e70"; c.fillRect(0, 733, 450, 5);
}
drawCity();

function drawSky(t) {
  const gradient = ctx.createLinearGradient(0, 0, 0, 800);
  gradient.addColorStop(0, "#58a5db"); gradient.addColorStop(.48, "#98cde1");
  gradient.addColorStop(.78, "#f7c59e"); gradient.addColorStop(1, "#e4a27d");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 450, 800);
  const glow = ctx.createRadialGradient(358, 236, 5, 358, 236, 175);
  glow.addColorStop(0, "#fff7b5a8"); glow.addColorStop(1, "#fff7b500");
  ctx.fillStyle = glow; ctx.fillRect(175, 50, 370, 370);
  ctx.fillStyle = "#fff3ca";
  ctx.beginPath(); ctx.arc(358, 236, 39, 0, Math.PI * 2); ctx.fill();
  // A faint daytime moon, drifting clouds, and wind trails.
  ctx.fillStyle = "#f5f8ff88"; ctx.beginPath(); ctx.arc(70, 220, 20, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#77b5dc"; ctx.beginPath(); ctx.arc(79, 213, 20, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 5; i++) {
    const x = ((i * 132 + t * (5 + i * 2)) % 610) - 100;
    const y = 169 + (i % 3) * 94;
    ctx.fillStyle = "#f7fcff88";
    ctx.beginPath(); ctx.ellipse(x, y, 45 + i * 3, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + 18, y - 6, 29, 10, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = "#edfaff65"; ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const x = ((t * 44 + i * 100) % 550) - 75;
    const y = 276 + i * 41;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 34, y - 7, x + 70, y); ctx.stroke();
  }
  ctx.drawImage(city, 0, 0);
  const flicker = .45 + (Math.sin(t * 14) + 1) * .18;
  ctx.fillStyle = `rgba(255,232,158,${flicker})`;
  ctx.beginPath(); ctx.arc(411, 552, 4, 0, Math.PI * 2); ctx.fill();
}

function drawKite(kite, now) {
  const age = now - kite.fallAt;
  const falling = !kite.alive;
  if (falling && age > 1700) return;
  const x = kite.x + (falling ? Math.sin(age * .016) * 23 : 0);
  const y = kite.y + (falling ? age * .15 : 0);
  const alpha = falling ? 1 - age / 1700 : 1;
  const beat = now - kite.lastHitAt < 500 ? 1.18 : 1;
  const rotation = Math.sin(now * .0018 + kite.slot) * .1 + (falling ? age * .002 : 0);
  ctx.save(); ctx.globalAlpha = Math.max(0, alpha);
  if (!falling) {
    ctx.strokeStyle = kite.attack && !kite.attack.resolved ? "#fff7c5" : "#f5ffffd6";
    ctx.lineWidth = kite.attack && !kite.attack.resolved ? 2.4 : 1.2;
    ctx.shadowColor = kite.attack ? "#ffec80" : "#fff";
    ctx.shadowBlur = kite.attack ? 12 : 4;
    ctx.beginPath(); ctx.moveTo(kite.anchorX, 728); ctx.lineTo(x, y); ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.translate(x, y); ctx.rotate(rotation); ctx.scale(beat, beat);
  ctx.shadowColor = kite.color; ctx.shadowBlur = 17;
  ctx.fillStyle = kite.color; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, -27); ctx.lineTo(22, 0); ctx.lineTo(0, 29); ctx.lineTo(-22, 0); ctx.closePath();
  ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
  ctx.strokeStyle = "#ffffffab"; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, 28); ctx.moveTo(-21, 0); ctx.lineTo(21, 0); ctx.stroke();
  ctx.fillStyle = "#fff8d6"; ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = kite.color; ctx.lineWidth = 2.3;
  ctx.beginPath(); ctx.moveTo(0, 27); ctx.quadraticCurveTo(-13, 42, 3, 56); ctx.quadraticCurveTo(17, 65, 3, 78); ctx.stroke();
  ctx.restore();
  if (falling) return;
  const label = kite.name.length > 14 ? `${kite.name.slice(0, 13)}…` : kite.name;
  ctx.font = "800 11px Inter, Arial, sans-serif";
  const labelW = Math.min(110, ctx.measureText(label).width + 18);
  ctx.fillStyle = "#0d294acb";
  ctx.beginPath(); ctx.roundRect(x - labelW / 2, y - 63, labelW, 19, 9); ctx.fill();
  ctx.strokeStyle = `${kite.color}cc`; ctx.lineWidth = 1; ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#fff";
  ctx.fillText(label, x, y - 53);
  ctx.fillStyle = "#112a41d9";
  ctx.beginPath(); ctx.roundRect(x - 26, y - 40, 52, 5, 3); ctx.fill();
  ctx.fillStyle = kite.hp <= 25 ? "#ff4d5b" : kite.hp <= 50 ? "#ffc44b" : "#62e6a4";
  ctx.beginPath(); ctx.roundRect(x - 26, y - 40, 52 * kite.hp / engine.rules.health, 5, 3); ctx.fill();
}

function burst(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.PI * 2 * i / count + Math.random() * .3;
    const speed = 1.8 + Math.random() * 4.5;
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 1.5, life: 1, color, size: 2 + Math.random() * 3 });
  }
  if (particles.length > 180) particles.splice(0, particles.length - 180);
}

function drawParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy; p.vy += .08; p.life -= .024;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.globalAlpha = p.life; ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function announce(text, cut = false) {
  announcer.textContent = text;
  announcer.classList.toggle("cut", cut);
  announcer.classList.add("show");
  noticeUntil = performance.now() + (cut ? 2200 : 1350);
}

function processEvents(events) {
  for (const event of events) {
    if (event.type === "join") announce(`${event.name} soltou a pipa!`);
    if (event.type === "cut") {
      burst(event.x, event.y, "#fff1a0", 42);
      burst(event.x, event.y, "#ff5c7f", 22);
      announce(`✂ ${event.name} cortou ${event.target}!`, true);
    }
    if (event.type === "hit") {
      const intensity = event.kind === "special" ? 54 : event.kind === "gift" ? 23 : event.units >= 60 ? 30 : event.units >= 30 ? 18 : 8;
      burst(event.x, event.y, event.kind === "like" ? "#ff6f9b" : "#ffdf80", intensity);
    }
    if (event.type === "skyGift") {
      burst(225, 300, event.kind === "special" ? "#ffe174" : "#ff77a8", event.kind === "special" ? 75 : 42);
      burst(225, 300, "#f7ffff", 24);
      announce(`✦ ${event.name} iluminou o céu!`, true);
    }
    if (event.type === "finish") {
      announce(event.winner ? `🏆 ${event.winner} domina o céu!` : "Fim de rodada!", true);
      burst(225, 360, "#ffe08b", 70);
    }
  }
}

function renderRanking() {
  const top = engine.ranking.slice(0, 3);
  const key = top.map((pilot) => `${pilot.id}:${pilot.trophies}:${pilot.cuts}:${pilot.score}`).join("|");
  if (key === lastRankKey) return;
  lastRankKey = key;
  ranking.replaceChildren();
  for (let index = 0; index < 3; index++) {
    const pilot = top[index];
    const card = document.createElement("div");
    card.className = `rank-item ${["first", "second", "third"][index]}`;
    const medal = document.createElement("span"); medal.className = "rank-medal";
    medal.textContent = ["🥇", "🥈", "🥉"][index];
    const copy = document.createElement("span"); copy.className = "rank-copy";
    const name = document.createElement("span"); name.className = "rank-name";
    name.textContent = pilot ? `@${pilot.id}` : "LUGAR LIVRE";
    const score = document.createElement("span"); score.className = "rank-score";
    score.textContent = pilot ? `${pilot.trophies} 🏆 · ${pilot.cuts} cortes` : "ENTRE NA LIVE";
    copy.append(name, score); card.append(medal, copy); ranking.append(card);
  }
}

function renderHud() {
  const remaining = engine.remainingMs;
  const seconds = engine.phase === "waiting" ? engine.rules.roundMs / 1000 : Math.ceil(remaining / 1000);
  timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  phaseLabel.textContent = ({ waiting: "AGUARDANDO", lobby: "PREPARE A LINHA", active: "LINHAS CRUZANDO", results: "FIM DA RODADA" })[engine.phase];
  roundNumber.textContent = String(engine.round).padStart(2, "0");
  pilotCount.textContent = `${engine.active.length} NO CÉU`;
  queueCount.textContent = engine.queue.length ? `+${engine.queue.length} NA FILA` : "";
  winner.hidden = engine.phase !== "results" || !engine.winner;
  if (!winner.hidden) winnerName.textContent = engine.winner.name;
  renderRanking();
}

function frame(now) {
  const gameNow = Date.now();
  engine.tick(gameNow);
  processEvents(engine.drainEvents());
  drawSky(now / 1000);
  const currentKites = engine.kites.filter((kite) => kite.alive || gameNow - kite.fallAt < 1700);
  // Draw lines first so the diamond sprites always remain above the cords.
  for (const kite of currentKites) drawKite(kite, gameNow);
  drawParticles();
  if (lastHud + 125 < now) { renderHud(); lastHud = now; }
  if (noticeUntil && now > noticeUntil) { announcer.classList.remove("show"); noticeUntil = 0; }
  requestAnimationFrame(frame);
}

renderHud();
requestAnimationFrame(frame);
console.info(`[Céu de Corte] ${demo ? "demonstração" : connected ? "live" : "aguardando ponte"}`);
