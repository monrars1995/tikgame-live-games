/** Deterministic rules for Céu de Corte. The browser renderer owns no game state. */
export const KITE_RULES = Object.freeze({
  width: 450,
  height: 800,
  maxKites: 1000,
  maxQueue: 1000,
  maxPilots: 3000,
  health: 100,
  lobbyMs: 8000,
  roundMs: 60000,
  resultsMs: 7000,
  roseDamage: 25,
  likeDamage: 0.55,
  npcDamage: 2,
  npcAttackMs: 6200,
  cutBonus: 100,
  trophyBonus: 300,
});

export const KITE_PALETTE = [
  "#ff636e", "#43dce4", "#ffc04d", "#b286ff", "#70ed8e", "#ff8ed9",
  "#ff945a", "#67aaff", "#d8ef6a", "#e66cba", "#72e4bd", "#f3ae7f",
];

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { const value = clamp(t, 0, 1); return value * value * (3 - 2 * value); };
const ATTACK_PROFILES = Object.freeze({
  like: Object.freeze({ approach: 520, retreat: 380, arcX: 4, arcY: 5 }),
  gift: Object.freeze({ approach: 640, retreat: 480, arcX: 14, arcY: 20 }),
  special: Object.freeze({ approach: 550, retreat: 620, arcX: 24, arcY: 31 }),
  npc: Object.freeze({ approach: 640, retreat: 570, arcX: 11, arcY: 14 }),
});
const strongerKind = (previous, incoming) =>
  ["like", "gift", "special"].indexOf(incoming) > ["like", "gift", "special"].indexOf(previous)
    ? incoming : previous;

export function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const ab1 = cross(a, b, c);
  const ab2 = cross(a, b, d);
  const cd1 = cross(c, d, a);
  const cd2 = cross(c, d, b);
  return ab1 * ab2 < -0.0001 && cd1 * cd2 < -0.0001;
}

function hash(value) {
  let result = 2166136261;
  for (const char of String(value)) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

function halton(index, base) {
  let fraction = 1;
  let result = 0;
  while (index > 0) {
    fraction /= base;
    result += fraction * (index % base);
    index = Math.floor(index / base);
  }
  return result;
}

function viewerFrom(event) {
  const user = event?.user || event || {};
  const id = String(user.uniqueId || user.displayId || user.userId || user.id || "").replace(/^@/, "").trim().toLowerCase();
  return id ? { id, name: String(user.nickname || id).slice(0, 26), avatar: String(user.profilePictureUrl || "") } : null;
}

/**
 * A round has a capped active field. Overflow waits in FIFO order. All gifts use
 * their incremental combo delta, supplied by the shared GiftTracker.
 */
export class KiteEngine {
  constructor(options = {}) {
    this.rules = { ...KITE_RULES, ...(options.rules || {}) };
    this.clock = options.clock || Date.now;
    this.phase = "waiting";
    this.deadline = 0;
    this.round = 1;
    this.kites = [];
    this.kiteById = new Map();
    this.aliveHumans = 0;
    this.npcs = this._makeNPCs();
    this.queue = [];
    this.queuedById = new Map();
    this.pilots = new Map();
    this.events = [];
    this.winner = null;
    this.lastTick = this.clock();
    this.windTime = NaN;
    this.windX = 0;
    this.windY = 0;
  }

  get active() { return this.kites.filter((kite) => kite.alive); }
  get remainingMs() { return this.deadline ? Math.max(0, this.deadline - this.clock()) : 0; }
  get ranking() {
    return [...this.pilots.values()].sort((a, b) =>
      b.trophies - a.trophies || b.cuts - a.cuts || b.score - a.score || a.id.localeCompare(b.id));
  }

  drainEvents() { return this.events.splice(0); }

  _emit(type, data = {}) {
    this.events.push({ type, at: this.clock(), ...data });
    if (this.events.length > 80) this.events.splice(0, this.events.length - 80);
  }

  _pilot(user) {
    let pilot = this.pilots.get(user.id);
    if (!pilot) {
      if (this.pilots.size >= this.rules.maxPilots) {
        const protectedIds = new Set([
          ...this.kites.map((kite) => kite.id),
          ...this.queue.map((queued) => queued.id),
          ...this.ranking.slice(0, 3).map((leader) => leader.id),
        ]);
        let victim = null;
        for (const candidate of this.pilots.values()) {
          if (protectedIds.has(candidate.id)) continue;
          if (!victim || candidate.score < victim.score || (candidate.score === victim.score && candidate.lastSeen < victim.lastSeen)) victim = candidate;
        }
        if (!victim) return null;
        this.pilots.delete(victim.id);
      }
      pilot = { ...user, trophies: 0, cuts: 0, score: 0, pending: 0, pendingKind: "like", pendingUnits: 0, lastSeen: this.clock() };
      this.pilots.set(user.id, pilot);
    } else {
      pilot.name = user.name;
      if (user.avatar) pilot.avatar = user.avatar;
      pilot.lastSeen = this.clock();
    }
    return pilot;
  }

  _makeKite(user) {
    const slot = this.kites.length;
    // Keep the small-room choreography intact; later admissions fill the sky
    // using a low-discrepancy 2D sequence instead of stacking in four rows.
    const smallField = Math.min(this.rules.maxKites, 12);
    const early = slot < smallField;
    const baseX = early ? 36 + slot * (378 / Math.max(1, smallField - 1))
      : 28 + halton(slot - smallField + 1, 2) * (this.rules.width - 56);
    const baseY = early ? 300 + (slot % 4) * 55
      : 190 + halton(slot - smallField + 1, 3) * 320;
    const anchorX = baseX;
    const anchorY = early ? 728 : 645 + halton(slot - smallField + 1, 5) * 85;
    const seed = hash(user.id);
    const kite = {
      id: user.id, name: user.name, avatar: user.avatar,
      color: KITE_PALETTE[seed % KITE_PALETTE.length],
      hp: this.rules.health, alive: true, slot, anchorX, anchorY, baseX, baseY, seed,
      motionPhase: (seed % 6283) / 1000,
      x: baseX, y: baseY, vx: 0, vy: 0, tilt: 0,
      pressure: clamp(this.pilots.get(user.id)?.pending || 0, 0, 5000),
      reserveKind: this.pilots.get(user.id)?.pending ? this.pilots.get(user.id)?.pendingKind : "like",
      reserveUnits: this.pilots.get(user.id)?.pendingUnits || 0,
      attack: null, lastHitAt: 0, fallAt: 0,
    };
    this.kites.push(kite);
    this.kiteById.set(kite.id, kite);
    this.aliveHumans++;
    const pilot = this.pilots.get(user.id);
    if (pilot) { pilot.pending = 0; pilot.pendingUnits = 0; pilot.pendingKind = "like"; }
    this._emit("join", { id: kite.id, name: kite.name, x: kite.x, y: kite.y });
    return kite;
  }

  _makeNPCs() {
    const names = ["NPC Brisa", "NPC Rajada", "NPC Trovão"];
    const colors = ["#a9f5ff", "#fbe784", "#daacff"];
    const smallField = Math.min(this.rules.maxKites, 12);
    const humanAnchors = Array.from({ length: smallField }, (_, slot) =>
      36 + slot * (378 / Math.max(1, smallField - 1)));
    const anchors = [];
    return names.map((name, index) => {
      // Give bot strings their own ground points, between possible human lines.
      const ideal = this.rules.width * (index + 1) / 4;
      let anchorX = ideal;
      let best = -Infinity;
      for (let candidate = 42; candidate <= this.rules.width - 42; candidate += 2) {
        const humanGap = Math.min(...humanAnchors.map((x) => Math.abs(x - candidate)));
        const botGap = anchors.length ? Math.min(...anchors.map((x) => Math.abs(x - candidate))) : 100;
        const score = Math.min(humanGap, 28) * 2 - Math.abs(candidate - ideal) * .18
          - Math.max(0, 65 - botGap) * 3;
        if (score > best) { best = score; anchorX = candidate; }
      }
      anchors.push(anchorX);
      const id = `npc:sky-${index + 1}`;
      const slot = this.rules.maxKites + index;
      return {
        id, name, npc: true, avatar: "", color: colors[index],
        hp: this.rules.health, alive: true, slot, anchorX, anchorY: 728,
        baseX: anchorX, baseY: 300 + (slot % 4) * 55,
        seed: hash(`${id}:${this.round}`),
        motionPhase: index * 2.1 + this.round * .37,
        x: anchorX, y: 300 + (slot % 4) * 55,
        vx: 0, vy: 0, tilt: 0,
        pressure: 0, reserveKind: "like", reserveUnits: 0,
        attack: null, lastHitAt: 0, fallAt: 0, nextAttackAt: 0,
      };
    });
  }

  join(user) {
    if (!user?.id) return null;
    const existing = this.kiteById.get(user.id);
    if (this.phase !== "results" && existing?.alive) {
      this._pilot(user);
      return existing;
    }
    const queued = this.queuedById.get(user.id);
    if (queued) { this._pilot(user); return null; }
    const needsQueue = this.phase === "results" || Boolean(existing) || this.kites.length >= this.rules.maxKites;
    if (needsQueue && this.queue.length >= this.rules.maxQueue) return null;
    const pilot = this._pilot(user);
    if (!pilot) return null;
    if (needsQueue) {
      this.queue.push(pilot);
      this.queuedById.set(pilot.id, pilot);
      this._emit("queue", { name: pilot.name, position: this.queue.length });
      return null;
    }
    const kite = this._makeKite(pilot);
    if (this.phase === "waiting") {
      this.phase = "lobby";
      this.deadline = this.clock() + this.rules.lobbyMs;
      this._emit("phase", { phase: this.phase });
    }
    return kite;
  }

  chat(event) {
    return this.join(viewerFrom(event));
  }

  _chooseTarget(attacker) {
    // Live viewers fight each other first. Bots provide combat when a viewer
    // is alone, while their own light attacks can only target real viewers.
    const rivals = attacker.npc || this.aliveHumans > 1 ? this.kites : this.npcs;
    let target = null;
    let bestParallel = 1;
    let bestDistance = Infinity;
    for (const candidate of rivals) {
      if (!candidate.alive || candidate.id === attacker.id) continue;
      const horizontal = Math.abs(candidate.anchorX - attacker.anchorX);
      // Parallel strings cannot intersect. Prefer a line with useful spacing.
      const parallel = horizontal < 28 ? 1 : 0;
      const distance = horizontal + Math.abs(candidate.y - attacker.y) * .28;
      if (!target || parallel < bestParallel || (parallel === bestParallel
        && (distance < bestDistance || (distance === bestDistance && candidate.hp < target.hp)))) {
        target = candidate;
        bestParallel = parallel;
        bestDistance = distance;
      }
    }
    return target;
  }

  _attack(kite, damage, kind, units = 1) {
    const target = this.phase === "active" ? this._chooseTarget(kite) : null;
    const amount = clamp(finite(damage), 0, 5000);
    if (!target) {
      kite.pressure = clamp(kite.pressure + amount, 0, kind === "like" && kite.reserveKind === "like" ? 150 : 5000);
      kite.reserveKind = strongerKind(kite.reserveKind, kind);
      kite.reserveUnits += units;
      this._emit("charge", { id: kite.id, name: kite.name, kind, units });
      return;
    }
    const total = amount + kite.pressure;
    kite.pressure = 0;
    // Repeated events extend the same strike instead of teleporting the kite.
    if (kite.attack && !kite.attack.resolved) {
      kite.attack.damage += total;
      kite.attack.units += units;
      if (kind === "special" || (kind === "gift" && kite.attack.kind === "like")) kite.attack.kind = kind;
      return;
    }
    const now = this.clock();
    const profile = ATTACK_PROFILES[kind] || ATTACK_PROFILES.gift;
    const impact = now + profile.approach;
    const direction = kite.anchorX < target.anchorX ? 1 : -1;
    const reach = 58;
    kite.attack = {
      targetId: target.id, kind, units,
      damage: total, started: now, impact, end: impact + profile.retreat,
      fromX: kite.x, fromY: kite.y,
      crossX: clamp(target.x + direction * reach, 22, this.rules.width - 22),
      crossY: target.y,
      direction, arcX: profile.arcX, arcY: profile.arcY,
      resolved: false,
    };
    this._emit("strike", { id: kite.id, name: kite.name, target: target.name, kind, units });
  }

  like(event) {
    if (this.phase === "results") return false;
    const user = viewerFrom(event);
    const kite = user && this.kiteById.get(user.id);
    if (!kite?.alive) return false;
    const raw = Math.floor(finite(event?.likeCount ?? event?.count, 1));
    if (raw <= 0) return false;
    const count = clamp(raw, 1, 100);
    this._attack(kite, count * this.rules.likeDamage, "like", count);
    return true;
  }

  gift(event, units = 1, rose = false) {
    const user = viewerFrom(event);
    if (!user || units <= 0) return false;
    const count = clamp(Math.floor(finite(units, 1)), 1, 1000);
    const coins = Math.max(1, finite(event?.giftValue ?? event?.diamondCount, 1));
    const isRose = rose || /rose|rosa/i.test(String(event?.giftName || ""));
    const perGift = isRose ? this.rules.roseDamage : clamp(18 + Math.sqrt(coins) * 14, 22, 175);
    const amount = perGift * count;
    const kind = coins >= 50 && !isRose ? "special" : "gift";
    let kite = this.join(user); // Paid interaction also admits a new player.
    let displaced = null;
    let displacedIndex = -1;
    if (!kite && !this.queuedById.has(user.id) && this.queue.length >= this.rules.maxQueue) {
      // Reserve a seat for a gift ahead of the last chat-only pilot. Do not
      // displace someone who has already paid to join the next round.
      const chatOnly = this.queue.findLastIndex((pilot) => pilot.pending === 0);
      if (chatOnly >= 0) {
        displacedIndex = chatOnly;
        displaced = this.queue.splice(chatOnly, 1)[0];
        this.queuedById.delete(displaced.id);
        kite = this.join(user);
      }
    }
    if (!kite) {
      // When every seat is already backed by a gift, give the new present a
      // bounded on-screen sky effect instead of silently dropping it.
      const pilot = this.queuedById.get(user.id);
      if (!pilot) {
        if (displaced) {
          this.queue.splice(displacedIndex, 0, displaced);
          this.queuedById.set(displaced.id, displaced);
        }
        this._emit("skyGift", { id: user.id, name: user.name, kind, units: count, coins });
        return true;
      }
      pilot.pending = clamp(pilot.pending + amount, 0, 5000);
      pilot.pendingKind = strongerKind(pilot.pendingKind, kind);
      pilot.pendingUnits += count;
      this._emit("charge", { id: user.id, name: user.name, kind, units: count });
      return true;
    }
    this._attack(kite, amount, kind, count);
    return true;
  }

  _windAt(now) {
    if (this.windTime === now) return;
    const t = now / 1000;
    this.windTime = now;
    this.windX = Math.sin(t * .17) * 9 + Math.sin(t * .46 + 1.1) * 5;
    this.windY = Math.sin(t * .25 + .7) * 3;
  }

  _basePose(kite, now, out = {}) {
    this._windAt(now);
    const t = now / 1000;
    const phase = kite.motionPhase;
    const npc = kite.npc === true;
    const crowded = kite.slot >= 12 && !npc;
    const spanX = npc ? 36 : crowded ? 4 : 15;
    const spanY = npc ? 27 : crowded ? 6 : 19;
    const gust = Math.sin(t * .31 + phase * 1.3) * Math.sin(t * .9 + phase);
    out.x = clamp(kite.baseX + this.windX * (npc ? 1.2 : crowded ? .35 : .8)
      + Math.sin(t * (npc ? .54 : .62) + phase) * spanX
      + Math.sin(t * 1.27 + phase * 1.8) * (npc ? 7 : crowded ? 2 : 5)
      + gust * (npc ? 11 : crowded ? 2 : 7), 23, this.rules.width - 23);
    out.y = clamp(kite.baseY + this.windY * (npc ? 1.2 : 1)
      + Math.cos(t * (npc ? .71 : .53) + phase) * spanY
      + Math.sin(t * 1.14 + phase * 1.4) * (npc ? 7 : crowded ? 2 : 5), 190, 520);
    return out;
  }

  _pose(kite, now, out = {}) {
    const base = this._basePose(kite, now, out);
    const attack = kite.attack;
    if (!attack) return base;
    if (now <= attack.impact) {
      const t = clamp((now - attack.started) / (attack.impact - attack.started), 0, 1);
      const bend = Math.sin(Math.PI * t);
      const progress = smooth(t);
      out.x = mix(attack.fromX, attack.crossX, progress) + bend * attack.arcX * attack.direction;
      out.y = mix(attack.fromY, attack.crossY, progress) - bend * attack.arcY;
      return out;
    }
    const t = clamp((now - attack.impact) / (attack.end - attack.impact), 0, 1);
    const bend = Math.sin(Math.PI * t);
    const progress = smooth(t);
    out.x = mix(attack.crossX, base.x, progress) - bend * attack.arcX * attack.direction * .35;
    out.y = mix(attack.crossY, base.y, progress) - bend * attack.arcY * .3;
    return out;
  }

  _resolve(kite, attack, now) {
    if (this.phase !== "active") return;
    attack.resolved = true;
    const target = this.kiteById.get(attack.targetId)
      || this.npcs.find((item) => item.id === attack.targetId);
    if (!target?.alive) return;
    // Use the planned impact instant even if the browser skipped frames in a background tab.
    const blade = this._pose(kite, attack.impact);
    const victim = this._pose(target, attack.impact);
    const crossing = segmentsIntersect(
      { x: kite.anchorX, y: kite.anchorY ?? 728 }, blade,
      { x: target.anchorX, y: target.anchorY ?? 728 }, victim,
    );
    if (!crossing) {
      this._emit("miss", { name: kite.name, target: target.name, x: blade.x, y: blade.y });
      return;
    }
    const hit = Math.min(target.hp, attack.damage);
    target.hp = Math.max(0, target.hp - attack.damage);
    target.lastHitAt = now;
    const pilot = this.pilots.get(kite.id);
    if (pilot) pilot.score += Math.ceil(hit);
    this._emit("hit", { id: kite.id, name: kite.name, target: target.name, damage: hit, x: (blade.x + victim.x) / 2, y: (blade.y + victim.y) / 2, kind: attack.kind, units: attack.units });
    if (target.hp === 0) {
      target.alive = false;
      if (!target.npc) this.aliveHumans--;
      target.fallAt = now;
      if (pilot) { pilot.cuts += 1; pilot.score += this.rules.cutBonus; }
      this._emit("cut", { id: kite.id, name: kite.name, target: target.name,
        attackerNpc: Boolean(kite.npc), targetNpc: Boolean(target.npc),
        x: victim.x, y: victim.y, kind: attack.kind });
      if (this.phase === "active" && (
        this.aliveHumans === 0 ||
        (this.aliveHumans === 1 && this.kites.length > 1) ||
        (this.aliveHumans === 1 && this.npcs.every((npc) => !npc.alive))
      )) this._finish(now);
    }
  }

  _finish(now) {
    if (this.phase !== "active") return;
    // Strikes still in flight, including paid gifts sent near zero, belong to
    // the next round; the closed result must never change afterwards.
    for (const kite of this.kites) {
      const pilot = this.pilots.get(kite.id);
      if (!pilot) continue;
      const unspent = kite.attack && !kite.attack.resolved ? kite.attack.damage : 0;
      const amount = kite.pressure + unspent;
      if (amount > 0) {
        pilot.pending = clamp(pilot.pending + amount, 0, 5000);
        pilot.pendingKind = strongerKind(pilot.pendingKind,
          unspent ? kite.attack.kind : kite.reserveKind);
        pilot.pendingUnits += unspent ? kite.attack.units : kite.reserveUnits;
      }
      kite.pressure = 0;
      kite.attack = null;
    }
    for (const npc of this.npcs) npc.attack = null;
    this.winner = null;
    for (const kite of this.kites) {
      if (!kite.alive) continue;
      const score = this.pilots.get(kite.id)?.score || 0;
      const currentScore = this.winner ? this.pilots.get(this.winner.id)?.score || 0 : -1;
      if (!this.winner || kite.hp > this.winner.hp || (kite.hp === this.winner.hp && score > currentScore)) {
        this.winner = kite;
      }
    }
    if (this.winner) {
      const pilot = this.pilots.get(this.winner.id);
      pilot.trophies += 1;
      pilot.score += this.rules.trophyBonus;
    }
    this.phase = "results";
    this.deadline = now + this.rules.resultsMs;
    this._emit("finish", { winner: this.winner?.name || null, id: this.winner?.id || null });
  }

  _nextRound(now) {
    const old = [];
    for (const kite of this.kites) {
      if (kite.alive) old.push(this.pilots.get(kite.id));
    }
    this.round += 1;
    this.kites = [];
    this.kiteById.clear();
    this.aliveHumans = 0;
    this.npcs = this._makeNPCs();
    this.winner = null;
    this.phase = "waiting";
    this.deadline = 0;
    const waiting = this.queue.splice(0, this.rules.maxKites);
    for (const pilot of waiting) {
      this.queuedById.delete(pilot.id);
      this.join(pilot);
    }
    for (const pilot of old) {
      if (this.kites.length >= this.rules.maxKites) break;
      this.join(pilot);
    }
    this._emit("phase", { phase: this.phase, round: this.round });
    this.lastTick = now;
  }

  _releaseReserves() {
    if (this.phase !== "active" || (this.aliveHumans < 2 && !this.npcs.some((npc) => npc.alive))) return;
    for (const kite of this.kites) {
      if (!kite.alive || kite.pressure <= 0 || kite.attack) continue;
      const kind = kite.reserveKind;
      const units = kite.reserveUnits || 1;
      kite.reserveKind = "like";
      kite.reserveUnits = 0;
      this._attack(kite, 0, kind, units);
    }
  }

  tick(now = this.clock()) {
    const elapsedMs = Math.max(1, now - this.lastTick);
    const seconds = elapsedMs / 1000;
    const velocityBlend = 1 - Math.exp(-elapsedMs / 95);
    this.lastTick = now;
    if (this.phase === "lobby" && now >= this.deadline) {
      this.phase = "active";
      this.deadline = now + this.rules.roundMs;
      for (let index = 0; index < this.npcs.length; index++) {
        this.npcs[index].nextAttackAt = now + this.rules.npcAttackMs + index * 700;
      }
      this._emit("phase", { phase: this.phase });
    }
    for (const kite of this.kites) {
      if (!kite.alive) continue;
      const oldX = kite.x;
      const oldY = kite.y;
      this._pose(kite, now, kite);
      kite.vx = mix(kite.vx, clamp((kite.x - oldX) / seconds, -650, 650), velocityBlend);
      kite.vy = mix(kite.vy, clamp((kite.y - oldY) / seconds, -650, 650), velocityBlend);
      kite.tilt = clamp(kite.vx / 370, -.32, .32);
    }
    for (const kite of this.npcs) {
      if (!kite.alive) continue;
      const oldX = kite.x;
      const oldY = kite.y;
      this._pose(kite, now, kite);
      kite.vx = mix(kite.vx, clamp((kite.x - oldX) / seconds, -650, 650), velocityBlend);
      kite.vy = mix(kite.vy, clamp((kite.y - oldY) / seconds, -650, 650), velocityBlend);
      kite.tilt = clamp(kite.vx / 370, -.32, .32);
    }
    if (this.phase === "active" && now < this.deadline) this._releaseReserves();
    if (this.phase === "active" && now < this.deadline && this.aliveHumans > 0) {
      for (const npc of this.npcs) {
        if (!npc.alive || npc.attack || now < npc.nextAttackAt) continue;
        npc.nextAttackAt = now + this.rules.npcAttackMs;
        this._attack(npc, this.rules.npcDamage, "npc");
      }
    }
    for (const kite of this.kites) {
      if (this.phase !== "active" || !kite.alive || !kite.attack) continue;
      const attack = kite.attack;
      if (!attack.resolved && now >= attack.impact && attack.impact <= this.deadline) this._resolve(kite, attack, now);
      if (now >= attack.end) kite.attack = null;
    }
    for (const kite of this.npcs) {
      if (this.phase !== "active" || !kite.alive || !kite.attack) continue;
      const attack = kite.attack;
      if (!attack.resolved && now >= attack.impact && attack.impact <= this.deadline) this._resolve(kite, attack, now);
      if (now >= attack.end) kite.attack = null;
    }
    if (this.phase === "active" && now >= this.deadline) this._finish(now);
    if (this.phase === "results" && now >= this.deadline) this._nextRound(now);
    return this;
  }
}
