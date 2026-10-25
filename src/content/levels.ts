import { arenas } from "./arenas.ts"
import type { Arena } from "./arenas.ts"
import { backlog } from "./backlog.ts"
import { projectOf } from "./bugs.ts"
import type { BacklogBug } from "./bugs.ts"
import type { ClientId } from "./clients.ts"
import type { Tier } from "../sim/tiers.ts"

/** How a boss fights; each pattern is one branch of the boss system. */
export const bossPatterns = ["dispenser", "crash", "twoFactor", "undefined"] as const
export type BossPattern = (typeof bossPatterns)[number]

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

export const levelIds = ["glacier", "sidequests", "keystone", "foundry", "endless", "hotdesk"] as const
export type LevelId = (typeof levelIds)[number]

export interface Level {
  readonly id: LevelId
  readonly sprint: string
  readonly name: string
  readonly projects: ReadonlyArray<string>
  readonly theme: { readonly background: string; readonly grid: string; readonly accent: string }
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
  /**
   * A bonus level, outside the campaign: playable once `after` sprints are
   * cleared, it draws `tickets` at random from the whole backlog, then its boss.
   */
  readonly bonus?: { readonly after: number; readonly tickets: number }
}

/** How many tickets a level releases before its boss: its backlog, or a bonus level's draw. */
export const ticketsOf = (level: Level): number => level.bonus?.tickets ?? level.bugs.length

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
  })
]

/**
 * Endless: every open bug from every project, drawn at random and forever,
 * a little tougher after each boss. The four sprint bosses take turns.
 */
export const endlessLevel: Level = {
  id: "endless",
  sprint: "∞",
  name: "Endless",
  projects: [...new Set(levels.flatMap((l) => l.projects))],
  theme: { background: "#0e0b14", grid: "#221a30", accent: "#ffd84a" },
  clients: ["ugo", "ornella", "kevin", "samanta", "gualtiero"],
  clientEvery: 13,
  waveSize: 4,
  // Every tier, up to S6: Endless climbs there a step at a time.
  tier: 5,
  boss: levels[0]!.boss,
  bugs: backlog.filter((bug) => !levels.some((l) => l.boss.key === bug.key)),
  endless: { bosses: levels.map((l) => l.boss), every: 6 }
}

/**
 * A bonus level draws from what Endless does, every open ticket of every
 * project, and offers the content of the sprint that unlocks it.
 */
const bonus = (spec: Omit<Level, "bugs" | "projects" | "tier" | "bonus"> & { readonly bonus: NonNullable<Level["bonus"]> }): Level => ({
  ...spec,
  projects: endlessLevel.projects,
  bugs: endlessLevel.bugs,
  tier: levels[spec.bonus.after - 1]?.tier ?? 0
})

const sprintBoss = (id: LevelId): Boss => levels.find((l) => l.id === id)!.boss

/**
 * Bonus levels: optional, in arenas of their own, each unlocked by clearing
 * a sprint and ending with one of the campaign's bosses. One entry each.
 */
export const bonusLevels: ReadonlyArray<Level> = [
  bonus({
    id: "hotdesk",
    sprint: "Bonus",
    name: "Hotdesk",
    theme: { background: "#14110a", grid: "#2b2412", accent: "#ffb347" },
    clients: ["samanta", "kevin", "ornella"],
    clientEvery: 12,
    waveSize: 5,
    boss: sprintBoss("keystone"),
    arena: arenas.small,
    bonus: { after: 3, tickets: 30 }
  })
]
