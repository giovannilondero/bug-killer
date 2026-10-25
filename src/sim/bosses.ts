import type * as Random from "@typeonce/ritmo-math/Random"
import { Ops } from "@typeonce/ritmo-math"

import { arenas } from "../content/arenas.ts"
import type { Arena } from "../content/arenas.ts"
import type { Strings } from "../content/i18n.ts"
import type { BossPattern, ConflictSide, RaceThread } from "../content/levels.ts"
import { DT, RACE } from "./constants.ts"
import type { BugSeed } from "./drafts.ts"
import { clamp, normalize, openPoint } from "./math.ts"
import type { BossValue, Vec } from "./schema.ts"

/** What a boss knows, and can do, on one tick of its fight. */
export interface Brain {
  /** Its own state, a copy the fight may change: timers, volleys, phase. */
  readonly boss: BossValue
  readonly position: Vec
  readonly radius: number
  /** The nearest developer still standing. */
  readonly target: Vec
  /** The angle from the boss to `target`. */
  readonly aim: number
  /** 0 at full health, close to 1 near the end. */
  readonly rage: number
  readonly arena: Arena
  readonly random: Random.Random
  readonly strings: Strings
  /** Bugs in the arena, so minions don't pile up forever. */
  readonly minions: number
  /** Other bosses with the same key still fighting: the rest of a boss that split. */
  readonly kin: number
  readonly fire: (angle: number, speed: number) => void
  readonly ring: (count: number, speed: number, offset: number) => void
  /** A velocity toward `target`. */
  readonly chase: (speed: number) => Vec
  /** A velocity toward `goal`. */
  readonly steer: (goal: Vec, speed: number) => Vec
  readonly teleport: (to: Vec) => void
  readonly spawnMinion: (seed: BugSeed, at: Vec) => void
  /** Puts another boss in the arena, `shape.offset` away from this one. */
  readonly fork: (shape: BossShape) => void
  readonly announce: (text: string) => void
}

/** One of the shapes a boss takes when a hit would change it: where it stands relative to the old one, and how big it is. */
export interface BossShape {
  readonly boss: BossValue
  readonly offset: Vec
  readonly radius: number
}

/** A boss changing shape instead of taking a hit: its next phase, or the pieces it splits into. */
export interface BossTurn {
  readonly into: ReadonlyArray<BossShape>
  readonly announce: keyof Strings["bossPhase"]
}

export interface BossRules {
  /** One tick of the fight: attacks through the brain, and returns where it moves. */
  readonly fight: (brain: Brain) => Vec
  /**
   * What a hit that would leave it at `hp` turns it into instead, or `null` to take
   * the hit as it is (at 0 hp it is fixed). `radius` is its current size.
   */
  readonly turn: (boss: BossValue, hp: number, radius: number) => BossTurn | null
  /** What fixing one piece says while the rest of the boss still fights; "one side resolved" when left out. */
  readonly piece?: keyof Strings["bossPhase"]
}

const minion = (key: string, summary: string, priority: BugSeed["priority"]): BugSeed => ({ key, summary, priority, status: "Open" })

/** A point on an ellipse around the arena's centre, as wide as the arena allows. */
const orbit = (arena: Arena, angle: number, rx: number, ry: number): Vec => ({
  x: arena.width / 2 + Ops.cos(angle) * rx * (arena.width / arenas.normal.width),
  y: arena.height / 2 + Ops.sin(angle) * ry * (arena.height / arenas.normal.height)
})

/** The same point seen in the mirror down the arena's middle. */
const mirror = (arena: Arena, at: Vec): Vec => ({ x: arena.width - at.x, y: at.y })

/** An angle as `theirs` fires it: reflected across the vertical axis. */
const reflect = (angle: number, side: ConflictSide | null): number => (side === "theirs" ? Math.PI - angle : angle)

const conflictLooks = {
  ours: { color: "#7ee787", shotText: "<<<<<<<" },
  theirs: { color: "#ff7b72", shotText: ">>>>>>>" }
} as const satisfies Record<ConflictSide, { color: string; shotText: string }>

const raceLooks = {
  main: { color: "#3ee6c4", shotText: "409" },
  worker: { color: "#ff9bd2", shotText: "412" }
} as const satisfies Record<RaceThread, { color: string; shotText: string }>

const otherThread = (thread: RaceThread): RaceThread => (thread === "main" ? "worker" : "main")

/**
 * Where a race condition's `thread` runs at `age`: both twins share one lap
 * round the arena, half a lap apart. A fixed twin comes back at its spot.
 */
export const raceSpot = (arena: Arena, age: number, thread: RaceThread): Vec =>
  orbit(arena, age * 0.6 + (thread === "worker" ? Math.PI : 0), 380, 240)

/**
 * Every boss pattern, in one table: each is one of the level's worst tickets
 * and fights like it. A new boss adds its pattern to `bossPatterns` and one
 * entry here; the type makes sure none is forgotten.
 */
export const bossRules: Record<BossPattern, BossRules> = {
  // Pours for a few seconds, then stops "for timeout".
  dispenser: {
    fight: ({ boss, rage, fire, chase, announce, strings }) => {
      const pouring = boss.volley % 2 === 0
      if (pouring && boss.timer > 0 && Math.floor(boss.age * 14) !== Math.floor((boss.age - DT) * 14)) {
        const spin = boss.age * (1.6 + rage)
        fire(spin, 210)
        fire(spin + Math.PI, 210)
        if (rage > 0.5) fire(spin + Math.PI / 2, 190)
      }
      if (boss.timer <= 0) {
        boss.volley += 1
        boss.timer = pouring ? 1.6 : 3.2
        if (!pouring) announce(strings.bossPhase.dispenserRestart)
      }
      return chase(35 + rage * 40)
    },
    turn: () => null
  },

  // The app that crashes and restarts somewhere else.
  crash: {
    fight: ({ boss, rage, target, arena, random, strings, minions, ring, chase, teleport, spawnMinion }) => {
      if (boss.timer > 0) return chase(60)
      const to = openPoint(random, target, 320, arena)
      teleport(to)
      boss.volley += 1
      boss.timer = 2.6 - rage
      // Restarting, it sprays crash reports all around.
      ring(12 + Math.round(rage * 8), 230, random.range(0, Math.PI))
      if (boss.volley % 2 === 0 && minions < 8) {
        for (let i = 0; i < 2; i++) {
          spawnMinion(minion(`CRASH-${boss.volley}${i}`, strings.minions.crash, "Low"), { x: to.x + (i ? 50 : -50), y: to.y })
        }
      }
      return { x: 0, y: 0 }
    },
    turn: () => null
  },

  // The login that wants a second factor: circles the arena centre, wide as the arena; phase two is faster and angrier.
  twoFactor: {
    fight: ({ boss, aim, arena, fire, ring, steer }) => {
      const goal = orbit(arena, boss.age * (boss.phase === 1 ? 0.5 : 0.8), 420, 260)
      if (boss.timer <= 0) {
        const shots = boss.phase === 1 ? 3 : 5
        for (let i = 0; i < shots; i++) fire(aim + (i - (shots - 1) / 2) * 0.16, boss.phase === 1 ? 260 : 320)
        boss.volley += 1
        if (boss.phase === 2 && boss.volley % 3 === 0) ring(14, 200, aim)
        boss.timer = boss.phase === 1 ? 1.1 : 0.75
      }
      return steer(goal, boss.phase === 1 ? 160 : 215)
    },
    // Fixed once, it asks for the second factor: full health again, behind a shield.
    turn: (boss, hp, radius) =>
      hp <= 0 && boss.phase === 1
        ? { into: [{ boss: { ...boss, hp: boss.maxHp, phase: 2, shield: 2.5, hitFlash: 0.3, timer: 1 }, offset: { x: 0, y: 0 }, radius }], announce: "otp" }
        : null
  },

  // The `undefined` that is everywhere.
  undefined: {
    fight: ({ boss, rage, aim, position, arena, strings, minions, fire, ring, chase, spawnMinion }) => {
      if (boss.timer <= 0) {
        boss.volley += 1
        const step = boss.volley % 3
        if (step === 0) {
          ring(16 + Math.round(rage * 10), 200, boss.age)
        } else if (step === 1) {
          for (let i = -2; i <= 2; i++) fire(aim + i * 0.12, 300)
        } else if (minions < 10) {
          for (let i = 0; i < 3; i++) {
            const angle = (i / 3) * Math.PI * 2 + boss.age
            spawnMinion(
              minion(`NULL-${boss.volley}${i}`, strings.minions.null, rage > 0.5 ? "High" : "Medium"),
              { x: clamp(position.x + Ops.cos(angle) * 90, 40, arena.width - 40), y: clamp(position.y + Ops.sin(angle) * 90, 40, arena.height - 40) }
            )
          }
        } else {
          ring(10, 260, aim)
        }
        boss.timer = 1.5 - rage * 0.6
      }
      return chase(50 + rage * 50)
    },
    turn: () => null
  },

  // Two versions of the same file. Whole, it fires both sides at once; at half
  // health it splits into ours and theirs, which move and fire in mirror.
  mergeConflict: {
    fight: ({ boss, aim, rage, arena, kin, fire, ring, chase, steer }) => {
      if (boss.side === null) {
        if (boss.timer <= 0) {
          boss.volley += 1
          if (boss.volley % 3 === 0) {
            ring(14, 210, boss.age)
          } else {
            // A "<" and a ">" closing in on you.
            for (const side of [-1, 1]) for (let i = 0; i < 3; i++) fire(aim + side * (0.28 + i * 0.12), 270)
          }
          boss.timer = 1.4 - rage * 0.4
        }
        return chase(45 + rage * 30)
      }
      // Both halves count the same clock, so `theirs` is always `ours` in the mirror.
      const ours = orbit(arena, boss.age * 0.55, 400, 250)
      const goal = boss.side === "ours" ? ours : mirror(arena, ours)
      if (boss.timer <= 0) {
        boss.volley += 1
        const spin = boss.age * 1.3
        for (let i = 0; i < 4; i++) fire(reflect(spin + (i * Math.PI) / 2, boss.side), 220)
        if (boss.volley % 2 === 0) for (let i = -1; i <= 1; i++) fire(aim + i * 0.14, 290)
        // Left alone, the other side wants its changes in, now.
        boss.timer = kin > 0 ? 1.05 : 0.7
      }
      return steer(goal, 190)
    },
    turn: (boss, hp, radius) => {
      if (boss.side !== null || hp > boss.maxHp / 2) return null
      const half = Math.ceil(boss.maxHp / 2)
      const shape = (side: ConflictSide, x: number): BossShape => ({
        boss: { ...boss, ...conflictLooks[side], side, hp: half, maxHp: half, phase: 2, shield: 0, hitFlash: 0.3, timer: 1, volley: 0, statuses: [] },
        offset: { x, y: 0 },
        radius: Math.round(radius * 0.75)
      })
      return { into: [shape("ours", -70), shape("theirs", 70)], announce: "conflict" }
    }
  },

  // Two services writing the same row. It forks into twins on its first tick;
  // fix one alone and the other restarts it, unless it is fixed in time too.
  raceCondition: {
    fight: ({ boss, position, radius, aim, rage, arena, kin, strings, fire, ring, steer, fork, announce }) => {
      if (boss.thread === null) {
        const half = Math.ceil(boss.hp / 2)
        Object.assign(boss, { ...raceLooks.main, thread: "main", hp: half, maxHp: half })
        fork({ boss: { ...boss, ...raceLooks.worker, thread: "worker" }, offset: { x: 90, y: 0 }, radius })
        return { x: 0, y: 0 }
      }
      if (kin > 0) {
        boss.revive = 0
      } else if (boss.revive === 0) {
        // Its twin was just fixed: the clock starts.
        boss.revive = RACE.window
      } else {
        boss.revive = Math.max(0, boss.revive - DT)
        if (boss.revive === 0) {
          const thread = otherThread(boss.thread)
          const at = raceSpot(arena, boss.age, thread)
          fork({
            boss: { ...boss, ...raceLooks[thread], thread, hp: boss.maxHp, shield: RACE.rebootShield, hitFlash: 0.3, timer: 1, statuses: [] },
            offset: { x: at.x - position.x, y: at.y - position.y },
            radius
          })
          announce(strings.bossPhase.restarted)
        }
      }
      if (boss.timer <= 0) {
        boss.volley += 1
        if (boss.volley % 3 === 0) {
          ring(10 + Math.round(rage * 6), 210, boss.age)
        } else {
          for (let i = -1; i <= 1; i++) fire(aim + i * 0.15, 280)
        }
        // Running alone, it races to restart its twin.
        boss.timer = (kin > 0 ? 1.2 : 0.7) - rage * 0.3
      }
      return steer(raceSpot(arena, boss.age, boss.thread), kin > 0 ? 180 : 230)
    },
    turn: () => null,
    piece: "threadDown"
  }
}

/** A velocity of `speed` from `from` toward `to`. */
export const toward = (from: Vec, to: Vec, speed: number): Vec => {
  const d = normalize({ x: to.x - from.x, y: to.y - from.y })
  return { x: d.x * speed, y: d.y * speed }
}
