import { PLAYER, ROCKET } from "./constants.ts"
import type { PickupKind, Vec } from "./schema.ts"
import { Ops } from "@typeonce/ritmo-math"

/**
 * Weapons a developer picks up from the floor. Each is also a pickup kind;
 * picking one up replaces whatever weapon is in hand, and when its seconds
 * run out the basic gun comes back.
 */
export const weaponPickups = ["pairProgramming", "pushForce", "flameWar"] as const satisfies ReadonlyArray<PickupKind>
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
  pairProgramming: { seconds: 12, cooldown: PLAYER.fireCooldown, upgradable: true },
  pushForce: { seconds: 12, cooldown: ROCKET.cooldown, upgradable: false },
  flameWar: { seconds: 10, cooldown: 0.1, upgradable: false }
} as const satisfies Record<WeaponKind, WeaponSpec>

/** How much faster any weapon fires under Hotfix. */
export const HOTFIX_COOLDOWN = PLAYER.rapidCooldown / PLAYER.fireCooldown

export const basicGun: WeaponValue = { kind: "gun", seconds: 0 }

export const isWeapon = (kind: PickupKind): kind is WeaponPickup => (weaponPickups as ReadonlyArray<PickupKind>).includes(kind)

/** A picked-up weapon, with its full timer. */
export const pickUp = (kind: WeaponPickup): WeaponValue => ({ kind, seconds: WEAPONS[kind].seconds })

/** Flame war: how far and how wide the fire reaches, and what each puff deals to everything in it. */
export const FLAME = { range: 200, halfAngle: 0.45, damage: 0.3 } as const

/** A cone of fire: from `origin` along the unit vector `direction`, out to `range`, `halfAngle` radians to each side. */
export interface Cone {
  origin: Vec
  direction: Vec
  range: number
  halfAngle: number
}

export const flameCone = (origin: Vec, direction: Vec): Cone => ({ origin, direction, range: FLAME.range, halfAngle: FLAME.halfAngle })

/**
 * Whether `point` is inside `cone`: close enough, and within its angle of the
 * aim. Only the centre counts. Walls are not its business: Combat also
 * checks that none stands between `cone.origin` and `point`.
 */
export const inCone = (cone: Cone, point: Vec): boolean => {
  const dx = point.x - cone.origin.x
  const dy = point.y - cone.origin.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  if (distance > cone.range) return false
  if (distance === 0) return true
  const cos = (dx * cone.direction.x + dy * cone.direction.y) / distance
  return cos >= Ops.cos(cone.halfAngle)
}
