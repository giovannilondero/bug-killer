import { PLAYER } from "./constants.ts"
import type { PickupKind } from "./schema.ts"

/**
 * Weapons a developer picks up from the floor. Each is also a pickup kind;
 * picking one up replaces whatever weapon is in hand, and when its seconds
 * run out the basic gun comes back.
 */
export const weaponPickups = ["pairProgramming"] as const satisfies ReadonlyArray<PickupKind>
export type WeaponPickup = (typeof weaponPickups)[number]

/** What a developer is holding: the basic gun, which never runs out, or a picked-up weapon. */
export type WeaponKind = "gun" | WeaponPickup

export interface WeaponValue {
  kind: WeaponKind
  /** Seconds left before the basic gun comes back; 0 for the gun itself. */
  seconds: number
}

export interface WeaponSpec {
  /** Seconds it lasts once picked up. */
  readonly seconds: number
  /** Seconds between two pulls of the trigger. Hotfix shortens it for every weapon. */
  readonly cooldown: number
  /** Whether Refactor (spread and pierce) and Tools (homing) change its shots. */
  readonly upgradable: boolean
}

/** Every weapon: a new one adds an entry here and its firing behaviour in `PlayerControlSystem`. */
export const WEAPONS = {
  gun: { seconds: 0, cooldown: PLAYER.fireCooldown, upgradable: true },
  pairProgramming: { seconds: 12, cooldown: PLAYER.fireCooldown, upgradable: true }
} as const satisfies Record<WeaponKind, WeaponSpec>

/** How much faster any weapon fires under Hotfix. */
export const HOTFIX_COOLDOWN = PLAYER.rapidCooldown / PLAYER.fireCooldown

export const basicGun: WeaponValue = { kind: "gun", seconds: 0 }

export const isWeapon = (kind: PickupKind): kind is WeaponPickup => (weaponPickups as ReadonlyArray<PickupKind>).includes(kind)

/** A picked-up weapon, with its full timer. */
export const pickUp = (kind: WeaponPickup): WeaponValue => ({ kind, seconds: WEAPONS[kind].seconds })
