import type { Level } from "../content/levels.ts"
import type { PickupKind } from "./schema.ts"

/**
 * Content tiers: when each pickup (and, later, each ticket kind) may show up.
 * Tier 0 is the content of the first four sprints; each later tier is
 * introduced by the sprint named here, in this order.
 */
export const tiers = ["base", "S2", "S3", "S4", "S5", "S6"] as const
/** A tier is an index into `tiers`: 0 (base) to 5 (S6). */
export type Tier = IndexOf<Exclude<keyof typeof tiers, keyof ReadonlyArray<unknown>>>
type IndexOf<K> = K extends `${infer N extends number}` ? N : never

/** Endless unlocks the next tier every this many waves. */
export const WAVES_PER_TIER = 3

/** What can be gated by tier: pickups, and the ticket kinds still to come. */
export type Unlockable = PickupKind

/**
 * The one table both the campaign and Endless read. New content adds one entry
 * here, with the tier of the sprint that introduces it.
 */
export const contentTiers = {
  hotfix: 0,
  refactor: 0,
  coffee: 0,
  unitTest: 0,
  revert: 0,
  pizza: 0,
  tools: 0,
  ai: 0,
  pairProgramming: 1,
  codeFreeze: 2,
  memoryLeak: 3,
  pushForce: 4,
  flameWar: 5
} as const satisfies Record<Unlockable, Tier>

export type TierTable = Readonly<Record<Unlockable, Tier>>

/**
 * The highest tier a run allows right now: the level's, or in Endless one step every few waves up to it.
 * `wave` is the wave on the floor (counted up as it is released): waves 1–3 play at tier 0, 4–6 at tier 1.
 */
export const tierOf = (level: Level, wave: number): Tier =>
  // Never above the level's own tier, so the minimum is still a `Tier`.
  level.endless ? (Math.min(level.tier, Math.floor(Math.max(0, wave - 1) / WAVES_PER_TIER)) as Tier) : level.tier

/** Whether a run at `tier` may offer `kind`. */
export const isUnlocked = (kind: Unlockable, tier: Tier, table: TierTable = contentTiers): boolean => table[kind] <= tier

/** The subset of `kinds` a run at `tier` may offer, in the same order. */
export const unlocked = <K extends Unlockable>(kinds: ReadonlyArray<K>, tier: Tier, table: TierTable = contentTiers): ReadonlyArray<K> =>
  kinds.filter((kind) => isUnlocked(kind, tier, table))
