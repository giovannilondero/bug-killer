import type { Arena } from "./arenas.ts"
import { backlog } from "./backlog.ts"
import { projectOf } from "./bugs.ts"
import type { BacklogBug } from "./bugs.ts"
import type { ClientId } from "./clients.ts"
import type { Tier } from "../sim/tiers.ts"

/** How a boss fights; each pattern is one branch of the boss system. */
export const bossPatterns = ["dispenser", "crash", "twoFactor", "undefined", "mergeConflict", "raceCondition", "infiniteLoop", "stackOverflow"] as const
export type BossPattern = (typeof bossPatterns)[number]

/** The two halves a merge conflict splits into. */
export const conflictSides = ["ours", "theirs"] as const
export type ConflictSide = (typeof conflictSides)[number]

/** The twins a race condition forks into. */
export const raceThreads = ["main", "worker"] as const
export type RaceThread = (typeof raceThreads)[number]

export interface Boss {
  readonly key: string
  readonly title: string
  readonly pattern: BossPattern
  readonly hp: number
  readonly radius: number
  readonly color: string
  /** What its projectiles say. */
  readonly shotText: string
}

export const levelIds = ["glacier", "sidequests", "keystone", "foundry", "monorepo", "microservices", "legacy", "production", "endless"] as const
export type LevelId = (typeof levelIds)[number]

export interface Level {
  readonly id: LevelId
  readonly sprint: string
  readonly name: string
  readonly projects: ReadonlyArray<string>
  /** `crt`: an old terminal's floor, with phosphor glow and scanlines. */
  readonly theme: { readonly background: string; readonly grid: string; readonly accent: string; readonly crt?: boolean }
  readonly clients: ReadonlyArray<ClientId>
  /** Seconds between client messages. */
  readonly clientEvery: number
  /** Bugs released per wave. */
  readonly waveSize: number
  /** The highest content tier this level offers (see `src/sim/tiers.ts`); Endless climbs to it. */
  readonly tier: Tier
  readonly boss: Boss
  readonly bugs: ReadonlyArray<BacklogBug>
  /** Endless mode: waves never run out, and every `every` waves the next boss steps in. */
  readonly endless?: { readonly bosses: ReadonlyArray<Boss>; readonly every: number }
  /** The floor it is played on; the normal arena when left out. */
  readonly arena?: Arena
}

const bugsOf = (projects: ReadonlyArray<string>, bossKey: string): ReadonlyArray<BacklogBug> =>
  backlog.filter((bug) => projects.includes(projectOf(bug.key)) && bug.key !== bossKey)

const level = (spec: Omit<Level, "bugs">): Level => ({ ...spec, bugs: bugsOf(spec.projects, spec.boss.key) })

export const levels: ReadonlyArray<Level> = [
  level({
    id: "glacier",
    sprint: "Sprint 1",
    name: "Glacier",
    projects: ["GLC"],
    theme: { background: "#071725", grid: "#0f2c44", accent: "#7fdcff" },
    clients: ["ornella", "gualtiero"],
    clientEvery: 16,
    waveSize: 4,
    tier: 0,
    boss: {
      key: "GLC-37",
      title: "[Dispenser] Pouring only stops when the request times out",
      pattern: "dispenser",
      hp: 90,
      radius: 54,
      color: "#7fdcff",
      shotText: "💧"
    }
  }),
  level({
    id: "sidequests",
    sprint: "Sprint 2",
    name: "Side Quests",
    projects: ["MEOW", "BREW", "GYM", "PARK", "QUIZ", "TAPAS", "LOOP"],
    theme: { background: "#0c1a10", grid: "#173222", accent: "#8cff9e" },
    clients: ["kevin", "samanta", "gualtiero"],
    clientEvery: 14,
    waveSize: 5,
    tier: 1,
    boss: {
      key: "QUIZ-276",
      title: "App crashes on launch on iOS 17",
      pattern: "crash",
      hp: 95,
      radius: 50,
      color: "#c6ff6b",
      shotText: "SIGABRT"
    }
  }),
  level({
    id: "keystone",
    sprint: "Sprint 3",
    name: "Keystone",
    projects: ["KEY"],
    theme: { background: "#140c22", grid: "#25173c", accent: "#c79bff" },
    clients: ["samanta", "ornella", "ugo"],
    clientEvery: 12,
    waveSize: 6,
    tier: 2,
    boss: {
      key: "KEY-3242",
      title: "API access skips two-factor authentication",
      pattern: "twoFactor",
      hp: 70,
      radius: 52,
      color: "#c79bff",
      shotText: "401"
    }
  }),
  level({
    id: "foundry",
    sprint: "Sprint 4",
    name: "Foundry",
    projects: ["FND"],
    theme: { background: "#1c0b0b", grid: "#361616", accent: "#ff7a59" },
    clients: ["ugo", "ugo", "kevin", "ornella"],
    clientEvery: 10,
    waveSize: 7,
    tier: 3,
    boss: {
      key: "FND-2245",
      title: "TypeError: Cannot read properties of undefined (reading 'id')",
      pattern: "undefined",
      hp: 190,
      radius: 62,
      color: "#ff7a59",
      shotText: "undefined"
    }
  }),
  level({
    id: "monorepo",
    sprint: "Sprint 5",
    name: "Monorepo",
    projects: ["MONO"],
    theme: { background: "#15120a", grid: "#2c2612", accent: "#e3b341" },
    clients: ["fabrizio", "samanta", "kevin", "fabrizio", "ugo"],
    clientEvery: 10,
    waveSize: 7,
    tier: 4,
    boss: {
      key: "MONO-4096",
      title: "CONFLICT (content): Merge conflict in pnpm-lock.yaml",
      pattern: "mergeConflict",
      hp: 120,
      radius: 58,
      color: "#e3b341",
      shotText: "======="
    }
  }),
  level({
    id: "microservices",
    sprint: "Sprint 6",
    name: "Microservices",
    projects: ["MSVC"],
    theme: { background: "#081517", grid: "#11302f", accent: "#3ee6c4" },
    clients: ["debora", "kevin", "fabrizio", "debora", "samanta"],
    clientEvery: 10,
    waveSize: 7,
    tier: 5,
    boss: {
      key: "MSVC-1024",
      title: "Race condition: two services write the same order at once",
      pattern: "raceCondition",
      hp: 140,
      radius: 50,
      color: "#3ee6c4",
      shotText: "409"
    }
  }),
  level({
    id: "legacy",
    sprint: "Sprint 7",
    name: "Legacy",
    projects: ["LGC"],
    theme: { background: "#020a03", grid: "#0b2a10", accent: "#33ff66", crt: true },
    clients: ["gualtiero", "ugo", "ornella", "debora", "fabrizio"],
    clientEvery: 9,
    waveSize: 8,
    tier: 5,
    boss: {
      key: "LGC-1983",
      title: "10 GOTO 10",
      pattern: "infiniteLoop",
      hp: 170,
      radius: 48,
      color: "#33ff66",
      shotText: "GOTO"
    }
  }),
  level({
    id: "production",
    sprint: "Sprint 8",
    name: "Production",
    projects: ["PROD"],
    theme: { background: "#170909", grid: "#311212", accent: "#ff5a4f" },
    clients: ["ugo", "debora", "fabrizio", "gualtiero", "ornella", "kevin"],
    clientEvery: 8,
    waveSize: 9,
    tier: 5,
    boss: {
      key: "PROD-404",
      title: "RangeError: Maximum call stack size exceeded",
      pattern: "stackOverflow",
      hp: 200,
      radius: 54,
      color: "#f48024",
      shotText: "f()"
    }
  })
]

/**
 * Endless: every open bug from every project, drawn at random and forever,
 * a little tougher after each boss. Every sprint's boss takes its turn, in
 * campaign order, and every sprint's clients write in: a new sprint joins
 * the rotation just by being in `levels`.
 */
export const endlessLevel: Level = {
  id: "endless",
  sprint: "∞",
  name: "Endless",
  projects: [...new Set(levels.flatMap((l) => l.projects))],
  theme: { background: "#0e0b14", grid: "#221a30", accent: "#ffd84a" },
  clients: [...new Set(levels.flatMap((l) => l.clients))],
  clientEvery: 13,
  waveSize: 4,
  // Every tier, up to S6: Endless climbs there a step at a time.
  tier: 5,
  boss: levels[0]!.boss,
  bugs: backlog.filter((bug) => !levels.some((l) => l.boss.key === bug.key)),
  endless: { bosses: levels.map((l) => l.boss), every: 6 }
}
