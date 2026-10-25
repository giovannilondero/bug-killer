import { levels } from "./content/levels.ts"
import type { Level, LevelId } from "./content/levels.ts"

/**
 * What this browser has achieved: sprints unlocked and best scores.
 * Pure data: the host reads and writes it to local storage as JSON.
 */
export interface Progress {
  /** How many sprints can be played, counting from the first: one more than the sprints cleared. */
  readonly unlocked: number
  /** Best solo score per level. */
  readonly best: Readonly<Partial<Record<string, number>>>
}

export const emptyProgress: Progress = { unlocked: 1, best: {} }

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
  const { unlocked, best } = raw as { unlocked?: unknown; best?: unknown }
  return {
    unlocked: typeof unlocked === "number" && Number.isInteger(unlocked) && unlocked >= 1 ? unlocked : 1,
    best: typeof best === "object" && best !== null
      ? Object.fromEntries(Object.entries(best).filter(([, score]) => isScore(score)))
      : {}
  }
}

/** The JSON the host stores: the same shape older versions wrote, so they keep loading it. */
export const saveProgress = (progress: Progress): string => JSON.stringify(progress)

export const sprintUnlocked = (progress: Progress, index: number): boolean => index < progress.unlocked

export const sprintsCleared = (progress: Progress): number => Math.min(levels.length, progress.unlocked - 1)

export const bestScore = (progress: Progress, level: LevelId): number | undefined => progress.best[level]

/** How a run ended, as far as progress cares. Only solo runs set records. */
export interface RunResult {
  readonly score: number
  readonly solo: boolean
}

const withBest = (progress: Progress, level: LevelId, score: number): Progress =>
  score > (progress.best[level] ?? 0) ? { ...progress, best: { ...progress.best, [level]: score } } : progress

/** Clearing sprint `index` unlocks the next one, solo or together; a solo clear may set the sprint's best score. */
export const clearSprint = (progress: Progress, index: number, run: RunResult): Progress => {
  const unlocked = { ...progress, unlocked: Math.max(progress.unlocked, index + 2) }
  const level = levels[index]
  return run.solo && level ? withBest(unlocked, level.id, run.score) : unlocked
}

/** A bonus level opens once the sprint it follows is cleared; it is never needed to go on. */
export const bonusUnlocked = (progress: Progress, level: Level): boolean =>
  level.bonus !== undefined && sprintsCleared(progress) >= level.bonus.after

/** Clearing a bonus level unlocks nothing: a solo clear may only set its best score. */
export const clearBonus = (progress: Progress, level: Level, run: RunResult): Progress =>
  run.solo ? withBest(progress, level.id, run.score) : progress

/** An Endless run only ends in defeat: a solo run that beats the best score is a new record. */
export const endEndless = (progress: Progress, run: RunResult): { readonly progress: Progress; readonly record: boolean } => {
  const record = run.solo && run.score > (progress.best.endless ?? 0)
  return { progress: record ? withBest(progress, "endless", run.score) : progress, record }
}

/** Every sprint playable, scores untouched: the `?tutti` shortcut for demos and playtests. */
export const unlockEverySprint = (progress: Progress): Progress => ({ ...progress, unlocked: Math.max(progress.unlocked, levels.length) })
