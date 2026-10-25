import { Clock } from "@typeonce/ritmo"

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
export const HOSTILE_SHOT = { radius: 9, life: 5 } as const

export const BOMB_RADIUS = 520
export const COMBO_WINDOW = 2.6
export const WAVE_INTERVAL = 15
export const SPAWN_SAFE_DISTANCE = 380
export const FIRST_CLIENT_DELAY = 7

/** A client brings back a fixed bug every so often (seconds). */
export const RESURRECT = { first: 28, min: 24, max: 40, hpFactor: 1.5, speedFactor: 1.15, distance: 300 } as const

/** Tobia shows up after `idle` seconds without progress, or when the arena holds `pileUp` waves of bugs. */
export const TOBIA = { idle: 11, pileUp: 2, cooldown: 30, firstCooldown: 12 } as const

export const HOMING = { range: 520, turnRate: 9 } as const

/** Seconds each timed power-up lasts. Weapons time themselves (`weapons.ts`). */
export const BUFF_SECONDS = { hotfix: 8, refactor: 10, coffee: 8, unitTest: 6, revert: 0, pizza: 0, tools: 10, ai: 0, pairProgramming: 0, codeFreeze: 8, memoryLeak: 8 } as const

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
