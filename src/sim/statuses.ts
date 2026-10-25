import type { PickupKind } from "./schema.ts"

/**
 * Status effects that bugs and bosses carry; developers never do. A status
 * remembers who applied it, so whatever it does later (damage, a kill)
 * counts for that developer.
 */
export const statusKinds = ["freeze"] as const
export type StatusKind = (typeof statusKinds)[number]

export interface StatusValue {
  kind: StatusKind
  seconds: number
  /** Seat of the developer who applied it: who gets the points, fixes and mission progress. */
  by: number
  /** How many hits are piled up, for statuses that stack. */
  stacks: number
}

export interface StatusEffect {
  /** How long a hit lasts. */
  seconds: number
  /** Speed multipliers while it lasts: a boss is never stopped. */
  bugSpeed: number
  bossSpeed: number
  /** Damage per second per stack, credited to `by`. */
  dps: number
  /** Repeated hits add a stack up to this many; 1 only refreshes the timer. */
  maxStacks: number
}

/** What each status does. */
export const statusEffects = {
  /** Code freeze: the bug stops dead, a boss is only slowed. */
  freeze: { seconds: 2, bugSpeed: 0, bossSpeed: 0.5, dps: 0, maxStacks: 1 }
} as const satisfies Record<StatusKind, StatusEffect>

export type StatusTable = Readonly<Record<StatusKind, StatusEffect>>

/** Timed buffs that make every hit of their holder apply a status, whatever the weapon. */
export const statusBuffs = [{ buff: "codeFreeze", status: "freeze" }] as const satisfies ReadonlyArray<{ buff: PickupKind; status: StatusKind }>

/** The statuses a developer's hits apply right now, from the buffs they hold. */
export const inflictedBy = (buffs: Readonly<Record<PickupKind, number>>): ReadonlyArray<StatusKind> =>
  statusBuffs.filter(({ buff }) => buffs[buff] > 0).map(({ status }) => status)

/** `statuses` after a hit by `by`: a fresh status, or a refreshed (and maybe stacked) one owned by the latest hitter. */
export const applyStatus = (
  statuses: ReadonlyArray<StatusValue>,
  kind: StatusKind,
  by: number,
  table: StatusTable = statusEffects
): Array<StatusValue> => {
  const effect = table[kind]
  const current = statuses.find((status) => status.kind === kind)
  const next: StatusValue = current
    ? { kind, seconds: effect.seconds, by, stacks: Math.min(effect.maxStacks, current.stacks + 1) }
    : { kind, seconds: effect.seconds, by, stacks: 1 }
  return [...statuses.filter((status) => status.kind !== kind), next]
}

/** One step of `dt`: what is left, and the damage each status deals, with who to credit it to. */
export const tickStatuses = (
  statuses: ReadonlyArray<StatusValue>,
  dt: number,
  table: StatusTable = statusEffects
): { statuses: Array<StatusValue>; damage: Array<{ kind: StatusKind; amount: number; by: number }> } => {
  const damage = statuses
    .filter((status) => table[status.kind].dps > 0)
    .map((status) => ({ kind: status.kind, amount: table[status.kind].dps * status.stacks * Math.min(dt, status.seconds), by: status.by }))
  const left = statuses
    .map((status) => ({ ...status, seconds: status.seconds - dt }))
    .filter((status) => status.seconds > 0)
  return { statuses: left, damage }
}

/** How fast a bug or boss may move under its statuses: the strongest slow wins. */
export const speedFactor = (statuses: ReadonlyArray<StatusValue>, boss: boolean, table: StatusTable = statusEffects): number =>
  statuses.reduce((factor, status) => Math.min(factor, boss ? table[status.kind].bossSpeed : table[status.kind].bugSpeed), 1)

export const hasStatus = (statuses: ReadonlyArray<StatusValue>, kind: StatusKind): boolean =>
  statuses.some((status) => status.kind === kind)
