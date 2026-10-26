import type { PickupKind } from "./schema.ts"

/** Hardcore: one sanity for everyone, all run long. Reviving brings a teammate back to it. */
export const HARDCORE = { maxHp: 1 } as const

/** The pickups a run hands out: hardcore drops Pizza, a heal with nothing left to heal. Green tests stay. */
export const allowedPickups = <K extends PickupKind>(kinds: ReadonlyArray<K>, hardcore: boolean): ReadonlyArray<K> =>
  hardcore ? kinds.filter((kind) => kind !== "pizza") : kinds
