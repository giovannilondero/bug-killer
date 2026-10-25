import { levels } from "./content/levels.ts"
import type { Level, LevelId } from "./content/levels.ts"

/**
 * What this browser has achieved: sprints unlocked, best scores and hardcore badges.
 * Pure data: the host reads and writes it to local storage as JSON.
 */
export interface Progress {
  /** How many sprints can be played, counting from the first: one more than the sprints cleared. */
  readonly unlocked: number
  /** Best solo score per level. */
  readonly best: Readonly<Partial<Record<string, number>>>
  /** Levels cleared in hardcore at least once: a badge on their card. */
  readonly badges: ReadonlyArray<string>
}

export const emptyProgress: Progress = { unlocked: 1, best: {}, badges: [] }

const isScore = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0

/** Reads saved progress; anything missing or malformed falls back to a fresh start. */
export const loadProgress = (saved: string | null): Progress => {
  let raw: unknown
  try {
    raw = JSON.parse(saved ?? "null")
  } catch {
    return emptyProgress
  }
  if (typeof raw !== "object" || raw === null) return emptyProgress
  const { unlocked, best, badges } = raw as { unlocked?: unknown; best?: unknown; badges?: unknown }
  return {
    unlocked: typeof unlocked === "number" && Number.isInteger(unlocked) && unlocked >= 1 ? unlocked : 1,
    best: typeof best === "object" && best !== null
      ? Object.fromEntries(Object.entries(best).filter(([, score]) => isScore(score)))
      : {},
    badges: Array.isArray(badges) ? badges.filter((id): id is string => typeof id === "string") : []
  }
}

/** The JSON the host stores: the same shape older versions wrote, so they keep loading it; badges only once there are some. */
export const saveProgress = (progress: Progress): string => {
  const { badges, ...rest } = progress
  return JSON.stringify(badges.length > 0 ? progress : rest)
}

export const sprintUnlocked = (progress: Progress, index: number): boolean => index < progress.unlocked

export const sprintsCleared = (progress: Progress): number => Math.min(levels.length, progress.unlocked - 1)

export const bestScore = (progress: Progress, level: LevelId): number | undefined => progress.best[level]

export const hardcoreBadge = (progress: Progress, level: LevelId): boolean => progress.badges.includes(level)

/** Which Endless a record belongs to: each combination keeps its own. */
export interface EndlessMode {
  readonly hardcore: boolean
}

/** Where an Endless record is kept in `best`: plain `endless` for the normal run, as older versions saved it. */
const endlessKey = (mode: EndlessMode): string => (mode.hardcore ? "endless/hardcore" : "endless")

export const endlessBest = (progress: Progress, mode: EndlessMode): number | undefined => progress.best[endlessKey(mode)]

/** How a run ended, as far as progress cares. Only solo runs set records; hardcore is off unless said. */
export interface RunResult {
  readonly score: number
  readonly solo: boolean
  readonly hardcore?: boolean
}

const withBest = (progress: Progress, key: string, score: number): Progress =>
  score > (progress.best[key] ?? 0) ? { ...progress, best: { ...progress.best, [key]: score } } : progress

const withBadge = (progress: Progress, level: LevelId): Progress =>
  progress.badges.includes(level) ? progress : { ...progress, badges: [...progress.badges, level] }

/**
 * Clearing sprint `index` unlocks the next one, solo or together; a solo clear may set the sprint's best score.
 * A hardcore clear also earns the sprint's badge, and unlocks nothing more.
 */
export const clearSprint = (progress: Progress, index: number, run: RunResult): Progress => {
  const unlocked = { ...progress, unlocked: Math.max(progress.unlocked, index + 2) }
  const level = levels[index]
  if (!level) return unlocked
  const badged = run.hardcore === true ? withBadge(unlocked, level.id) : unlocked
  return run.solo ? withBest(badged, level.id, run.score) : badged
}

/** A bonus level opens once the sprint it follows is cleared; it is never needed to go on. */
export const bonusUnlocked = (progress: Progress, level: Level): boolean =>
  level.bonus !== undefined && sprintsCleared(progress) >= level.bonus.after

/** Clearing a bonus level unlocks nothing: a hardcore clear earns its badge, a solo clear may set its best score. */
export const clearBonus = (progress: Progress, level: Level, run: RunResult): Progress => {
  const badged = run.hardcore === true ? withBadge(progress, level.id) : progress
  return run.solo ? withBest(badged, level.id, run.score) : badged
}

/** An Endless run only ends in defeat: a solo run that beats the best score of its mode is a new record. */
export const endEndless = (progress: Progress, run: RunResult): { readonly progress: Progress; readonly record: boolean } => {
  const key = endlessKey({ hardcore: run.hardcore === true })
  const record = run.solo && run.score > (progress.best[key] ?? 0)
  return { progress: record ? withBest(progress, key, run.score) : progress, record }
}

/** Every sprint playable, scores untouched: the `?tutti` shortcut for demos and playtests. */
export const unlockEverySprint = (progress: Progress): Progress => ({ ...progress, unlocked: Math.max(progress.unlocked, levels.length) })
