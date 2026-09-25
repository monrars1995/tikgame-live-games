/** Deterministic rules for Céu de Corte. The browser renderer owns no game state. */
export const KITE_RULES = Object.freeze({
  width: 450,
  height: 800,
  maxKites: 12,
  maxQueue: 120,
  maxPilots: 500,
  health: 100,
  lobbyMs: 8000,
  roundMs: 60000,
  resultsMs: 7000,
  roseDamage: 25,
  likeDamage: 0.55,
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
const ease = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
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
    this.queue = [];
    this.pilots = new Map();
    this.events = [];
    this.winner = null;
    this.nextSerial = 0;
    this.lastTick = this.clock();
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
    const anchorX = 36 + slot * (378 / Math.max(1, this.rules.maxKites - 1));
    const seed = hash(user.id);
    const kite = {
      id: user.id, name: user.name, avatar: user.avatar,
      color: KITE_PALETTE[seed % KITE_PALETTE.length],
      hp: this.rules.health, alive: true, slot, anchorX, seed,
      x: anchorX, y: 330 + (slot % 4) * 55,
      pressure: clamp(this.pilots.get(user.id)?.pending || 0, 0, 5000),
      reserveKind: this.pilots.get(user.id)?.pending ? this.pilots.get(user.id)?.pendingKind : "like",
      reserveUnits: this.pilots.get(user.id)?.pendingUnits || 0,
      attack: null, lastHitAt: 0, fallAt: 0,
    };
    this.kites.push(kite);
    const pilot = this.pilots.get(user.id);
    if (pilot) { pilot.pending = 0; pilot.pendingUnits = 0; pilot.pendingKind = "like"; }
    this._emit("join", { id: kite.id, name: kite.name, x: kite.x, y: kite.y });
    return kite;
  }

  join(user) {
    if (!user?.id) return null;
    const existing = this.kites.find((kite) => kite.id === user.id);
    if (this.phase !== "results" && existing?.alive) {
      this._pilot(user);
      return existing;
    }
    const queued = this.queue.find((pilot) => pilot.id === user.id);
    if (queued) { this._pilot(user); return null; }
    const needsQueue = this.phase === "results" || Boolean(existing) || this.kites.length >= this.rules.maxKites;
    if (needsQueue && this.queue.length >= this.rules.maxQueue) return null;
    const pilot = this._pilot(user);
    if (!pilot) return null;
    if (needsQueue) {
      this.queue.push(pilot);
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
    const rivals = this.active.filter((kite) => kite.id !== attacker.id);
    if (!rivals.length) return null;
    rivals.sort((a, b) => Math.abs(a.anchorX - attacker.anchorX) - Math.abs(b.anchorX - attacker.anchorX) || a.hp - b.hp);
    return rivals[0];
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
    const direction = kite.anchorX < target.anchorX ? 1 : -1;
    kite.attack = {
      targetId: target.id, kind, units,
      damage: total, started: now, impact: now + 640, end: now + 1120,
      fromX: kite.x, fromY: kite.y,
      crossX: clamp(target.x + direction * 58, 22, this.rules.width - 22),
      crossY: target.y,
      resolved: false,
    };
    this._emit("strike", { id: kite.id, name: kite.name, target: target.name, kind, units });
  }

  like(event) {
    if (this.phase === "results") return false;
    const user = viewerFrom(event);
    const kite = user && this.kites.find((item) => item.id === user.id && item.alive);
    if (!kite) return false;
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
    if (!kite && !this.queue.some((pilot) => pilot.id === user.id) && this.queue.length >= this.rules.maxQueue) {
      // Reserve a seat for a gift ahead of the last chat-only pilot. Do not
      // displace someone who has already paid to join the next round.
      const chatOnly = this.queue.findLastIndex((pilot) => pilot.pending === 0);
      if (chatOnly >= 0) {
        displacedIndex = chatOnly;
        displaced = this.queue.splice(chatOnly, 1)[0];
        kite = this.join(user);
      }
    }
    if (!kite) {
      // When every seat is already backed by a gift, give the new present a
      // bounded on-screen sky effect instead of silently dropping it.
      const pilot = this.queue.find((queued) => queued.id === user.id);
      if (!pilot) {
        if (displaced) this.queue.splice(displacedIndex, 0, displaced);
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

  _basePose(kite, now) {
    const t = now / 1000;
    return {
      x: clamp(kite.anchorX + Math.sin(t * 0.8 + kite.seed) * 20 + Math.sin(t * 1.7 + kite.slot) * 6, 23, this.rules.width - 23),
      y: 300 + (kite.slot % 4) * 55 + Math.cos(t * 0.7 + kite.slot * 1.8) * 23 + Math.sin(t * 1.8 + kite.seed) * 8,
    };
  }

  _pose(kite, now) {
    const base = this._basePose(kite, now);
    const attack = kite.attack;
    if (!attack) return base;
    if (now <= attack.impact) {
      const t = ease((now - attack.started) / (attack.impact - attack.started));
      return { x: mix(attack.fromX, attack.crossX, t), y: mix(attack.fromY, attack.crossY, t) };
    }
    const t = ease((now - attack.impact) / (attack.end - attack.impact));
    return { x: mix(attack.crossX, base.x, t), y: mix(attack.crossY, base.y, t) };
  }

  _resolve(kite, attack, now) {
    if (this.phase !== "active") return;
    attack.resolved = true;
    const target = this.kites.find((item) => item.id === attack.targetId && item.alive);
    if (!target) return;
    // Use the planned impact instant even if the browser skipped frames in a background tab.
    const blade = this._pose(kite, attack.impact);
    const victim = this._pose(target, attack.impact);
    const crossing = segmentsIntersect(
      { x: kite.anchorX, y: 728 }, blade,
      { x: target.anchorX, y: 728 }, victim,
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
      target.fallAt = now;
      if (pilot) { pilot.cuts += 1; pilot.score += this.rules.cutBonus; }
      this._emit("cut", { id: kite.id, name: kite.name, target: target.name, x: victim.x, y: victim.y, kind: attack.kind });
      if (this.phase === "active" && this.active.length <= 1 && this.kites.length > 1) this._finish(now);
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
    const survivors = this.active;
    survivors.sort((a, b) => b.hp - a.hp || (this.pilots.get(b.id)?.score || 0) - (this.pilots.get(a.id)?.score || 0));
    this.winner = survivors[0] || null;
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
    const old = this.active.map((kite) => this.pilots.get(kite.id)).filter(Boolean);
    this.round += 1;
    this.kites = [];
    this.winner = null;
    this.phase = "waiting";
    this.deadline = 0;
    const waiting = this.queue.splice(0, this.rules.maxKites);
    for (const pilot of waiting) this.join(pilot);
    for (const pilot of old) {
      if (this.kites.length >= this.rules.maxKites) break;
      this.join(pilot);
    }
    this._emit("phase", { phase: this.phase, round: this.round });
    this.lastTick = now;
  }

  _releaseReserves() {
    if (this.phase !== "active" || this.active.length < 2) return;
    for (const kite of this.active) {
      if (kite.pressure <= 0 || kite.attack) continue;
      const kind = kite.reserveKind;
      const units = kite.reserveUnits || 1;
      kite.reserveKind = "like";
      kite.reserveUnits = 0;
      this._attack(kite, 0, kind, units);
    }
  }

  tick(now = this.clock()) {
    this.lastTick = now;
    if (this.phase === "lobby" && now >= this.deadline) {
      this.phase = "active";
      this.deadline = now + this.rules.roundMs;
      this._emit("phase", { phase: this.phase });
    }
    for (const kite of this.kites) {
      if (!kite.alive) continue;
      const pose = this._pose(kite, now);
      kite.x = pose.x;
      kite.y = pose.y;
    }
    if (this.phase === "active" && now < this.deadline) this._releaseReserves();
    for (const kite of this.kites) {
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
