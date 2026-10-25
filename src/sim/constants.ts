import { Clock } from "@typeonce/ritmo"

import type { TicketType } from "../content/bugs.ts"

export const STEP = Clock.hz(60)
export const DT = STEP.dt

export const PLAYER = {
  radius: 16,
  speed: 270,
  maxHp: 6,
  bombs: 2,
  fireCooldown: 0.15,
  rapidCooldown: 0.065,
  dashSpeed: 760,
  dashTime: 0.16,
  dashCooldown: 0.85,
  hurtInvulnerability: 1.1
} as const

/** Playing together: seats, hoodie colours, reviving, and how much more backlog a bigger team gets. */
export const PARTY = {
  maxPlayers: 4,
  colors: ["#3a6df0", "#e0569b", "#2bb673", "#f08a24"],
  reviveRadius: 70,
  reviveSeconds: 2.5,
  reviveHp: 3,
  waveSizePerPlayer: 0.5,
  bossHpPerPlayer: 0.6
} as const

export const SHOT = { speed: 820, life: 0.85, radius: 5, damage: 1 } as const
/** `git push --force`: a slow rocket, and the blast that never hurts a developer. */
export const ROCKET = { speed: 430, radius: 8, damage: 6, blastRadius: 130, cooldown: 0.9 } as const
export const HOSTILE_SHOT = { radius: 9, life: 5 } as const

export const BOMB_RADIUS = 520

/**
 * Breakpoints: traps a developer drops where they stand. One goes off when a
 * bug comes within `trigger` of it, hurting and freezing everything within `blast`.
 */
export const BREAKPOINT = { charges: 2, max: 5, radius: 12, trigger: 60, blast: 170, damage: 4 } as const
export const COMBO_WINDOW = 2.6
export const WAVE_INTERVAL = 15
export const SPAWN_SAFE_DISTANCE = 380
export const FIRST_CLIENT_DELAY = 7

/** A client brings back a fixed bug every so often (seconds). */
export const RESURRECT = { first: 28, min: 24, max: 40, hpFactor: 1.5, speedFactor: 1.15, distance: 300 } as const

/** Tobia shows up after `idle` seconds without progress, or when the arena holds `pileUp` waves of bugs. */
export const TOBIA = { idle: 11, pileUp: 2, cooldown: 30, firstCooldown: 12 } as const

export const HOMING = { range: 520, turnRate: 9 } as const

/** A Deploying bug lights its fuse this close to a developer (gap between bodies), then goes off over this radius. */
export const DEPLOY = { reach: 50, fuse: 1, chainFuse: 0.12, radius: 130, damage: 4 } as const

/** An Epic's nest: every few seconds it releases a sub-task of one of these priorities, while fewer than `brood` are alive. */
export const EPIC = { every: 3, brood: 6, priorities: ["Lowest", "Low"], ring: 14 } as const

/** How a ticket's type scales its priority's stats. */
export interface TicketScale {
  readonly hp: number
  readonly speed: number
  readonly radius: number
  readonly points: number
}

export const ticketScales = {
  bug: { hp: 1, speed: 1, radius: 1, points: 1 },
  story: { hp: 1.5, speed: 0.9, radius: 1.2, points: 1.5 },
  subtask: { hp: 0.5, speed: 1.4, radius: 0.7, points: 0.5 },
  // An Epic never moves: a big nest that has to be dug out.
  epic: { hp: 8, speed: 0, radius: 2, points: 4 }
} as const satisfies Record<TicketType, TicketScale>

/** How many sub-tasks a closed Story splits into. */
export const STORY_SUBTASKS = 2

/** Seconds each timed power-up lasts. Weapons time themselves (`weapons.ts`). */
export const BUFF_SECONDS = { hotfix: 8, refactor: 10, coffee: 8, unitTest: 6, revert: 0, pizza: 0, tools: 10, ai: 0, pairProgramming: 0, codeFreeze: 8, memoryLeak: 8, pushForce: 0, flameWar: 0, breakpoint: 0 } as const

/** The "AI" turret: how long it lasts, how far it sees, how fast it shoots, and how often it makes things up. */
export const TURRET = { seconds: 12, range: 560, cooldown: 0.2, radius: 18, hallucinateMin: 3, hallucinateMax: 6 } as const

/** Bonus calls: when they ring, and what each kind asks and pays. */
export const CALLS = {
  first: 16,
  min: 26,
  max: 42,
  meet: { radius: 120, goal: 5, duration: 20, points: 500 },
  slack: { pings: 3, reach: 36, duration: 16, points: 350 }
} as const

/** Endless mode: how much tougher each beaten boss makes the next round. */
export const ENDLESS = {
  hpPerLoop: 0.2,
  speedPerLoop: 0.05,
  maxSpeed: 1.4,
  bossHpPerLoop: 0.25,
  maxWaveSize: 12,
  minWaveInterval: 7
} as const

/** A race condition's twins: one fixed alone comes back unless the other is fixed within `window` seconds. */
export const RACE = { window: 4, rebootShield: 1 } as const

/**
 * An infinite loop's circuit: `speed` radians a second on its first lap, `speedup`
 * more of that for every lap run, up to `maxSpeed`. It drops a shot every `trail`
 * radians, `drift` px/s slow.
 */
export const LOOP = { speed: 0.36, speedup: 0.15, maxSpeed: 0.9, trail: (Math.PI * 2) / 44, drift: 18 } as const

/**
 * A stack overflow's tower: `frames` frames, `frameHeight` px each. It drops the
 * top one for every `1 / frames` of its health lost, as a bug `frameHp` times
 * tougher than a Medium one and `speedup` faster for every frame already gone.
 * While a dropped frame is alive it stays shielded, and `linger` seconds after.
 */
export const STACK = { frames: 6, frameHeight: 13, frameHp: 2, speedup: 0.3, linger: 0.25 } as const
