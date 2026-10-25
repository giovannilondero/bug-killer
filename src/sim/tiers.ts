import type { BacklogType } from "../content/bugs.ts"
import type { Level } from "../content/levels.ts"
import type { PickupKind } from "./schema.ts"

/**
 * Content tiers: when each pickup (and, later, each ticket kind) may show up.
 * Tier 0 is the content of the first four sprints; each later tier is
 * introduced by the sprint named here, in this order.
 */
export const tiers = ["base", "S2", "S3", "S4", "S5", "S6"] as const
export type Tier = number

/** Endless unlocks the next tier every this many waves. */
export const WAVES_PER_TIER = 3

/** Ticket types that arrive with a later sprint; until then such a ticket is a plain bug. */
export type GatedType = Exclude<BacklogType, "bug">

/** What can be gated by tier: pickups and ticket types. */
export type Unlockable = PickupKind | GatedType

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
  story: 1
} as const satisfies Record<Unlockable, Tier>

export type TierTable = Readonly<Record<Unlockable, Tier>>

/** The highest tier a run allows right now: the level's, or in Endless one step every few waves up to it. */
export const tierOf = (level: Level, wave: number): Tier =>
  level.endless ? Math.min(level.tier, Math.floor(wave / WAVES_PER_TIER)) : level.tier

/** The subset of `kinds` a run at `tier` may offer, in the same order. */
export const unlocked = <K extends Unlockable>(kinds: ReadonlyArray<K>, tier: Tier, table: TierTable = contentTiers): ReadonlyArray<K> =>
  kinds.filter((kind) => table[kind] <= tier)

export const isUnlocked = (kind: Unlockable, tier: Tier, table: TierTable = contentTiers): boolean => table[kind] <= tier

/** The type a backlog ticket plays as at `tier`: a type not unlocked yet is a plain bug. */
export const ticketTypeAt = (type: BacklogType | undefined, tier: Tier, table: TierTable = contentTiers): BacklogType =>
  type === undefined || type === "bug" || !isUnlocked(type, tier, table) ? "bug" : type
