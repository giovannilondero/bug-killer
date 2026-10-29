/**
 * What one step of input does to a developer's trigger: the power-ups and
 * the weapon wearing off, whether it fires, and what leaves the barrel.
 * `PlayerControlSystem` steps it on the run server; a browser predicting its
 * own developer replays the same functions, so its own shots show on the
 * step they are fired.
 */
import type { Arena } from "../content/arenas.ts"
import { DT } from "./constants.ts"
import { normalize } from "./math.ts"
import { pickupKinds } from "./schema.ts"
import type { FxValue, InputValue, PickupKind, Vec } from "./schema.ts"
import { firstWall } from "./walls.ts"
import { HOTFIX_COOLDOWN, WEAPONS, basicGun, flameCone } from "./weapons.ts"
import type { Cone, WeaponKind, WeaponValue } from "./weapons.ts"
import { Ops } from "@typeonce/ritmo"

export type Buffs = Record<PickupKind, number>

/**
 * One pull of the trigger, whatever the weapon: where it fires from and
 * toward, and the power-ups that change its shots. Refactor and Tools are
 * already off here for a weapon they don't apply to.
 */
export interface Trigger {
  readonly weapon: WeaponKind
  readonly muzzle: Vec
  /** Unit vector toward the crosshair. */
  readonly aim: Vec
  /** The crosshair itself, in world coordinates. */
  readonly target: Vec
  readonly refactor: boolean
  readonly tools: boolean
}

/** The power-ups and the weapon in hand, one step later: each runs out, and the basic gun comes back. */
export const wearOff = (buffs: Buffs, weapon: WeaponValue) => {
  const worn = { ...buffs }
  for (const kind of pickupKinds) worn[kind] = Math.max(0, worn[kind] - DT)
  const left = weapon.seconds - DT
  return { buffs: worn, weapon: weapon.kind === "gun" || left > 0 ? { ...weapon, seconds: Math.max(0, left) } : basicGun }
}

/** One step of `input` on the trigger of a developer at `position`, with the power-ups and weapon already worn off. */
export const pull = (fireCooldown: number, weapon: WeaponKind, buffs: Buffs, position: Vec, input: InputValue) => {
  const cooled = Math.max(0, fireCooldown - DT)
  const aim = normalize({ x: input.aim.x - position.x, y: input.aim.y - position.y })
  if (!input.fire || cooled > 0 || (aim.x === 0 && aim.y === 0)) return { fireCooldown: cooled, trigger: null }
  const spec = WEAPONS[weapon]
  const trigger: Trigger = {
    weapon,
    muzzle: { x: position.x + aim.x * 22, y: position.y + aim.y * 22 },
    aim,
    target: input.aim,
    refactor: spec.upgradable && buffs.refactor > 0,
    tools: spec.upgradable && buffs.tools > 0
  }
  return { fireCooldown: buffs.hotfix > 0 ? spec.cooldown * HOTFIX_COOLDOWN : spec.cooldown, trigger }
}

/** `direction` turned by `angle` radians. */
const turn = (direction: Vec, angle: number): Vec => {
  const cos = Ops.cos(angle)
  const sin = Ops.sin(angle)
  return { x: direction.x * cos - direction.y * sin, y: direction.x * sin + direction.y * cos }
}

/** The barrels of the weapons that fire bullets, side by side: pixels off the aim line. */
const lanes: Partial<Record<WeaponKind, ReadonlyArray<number>>> = { gun: [0], pairProgramming: [-8, 8] }

/** Where each bullet of a pull starts and which way it flies, fanned out by Refactor; none for a weapon without bullets. */
export const bulletsOf = (trigger: Trigger): Array<{ readonly at: Vec; readonly direction: Vec }> => {
  const side = { x: -trigger.aim.y, y: trigger.aim.x }
  const bullets: Array<{ at: Vec; direction: Vec }> = []
  for (const offset of trigger.refactor ? [-0.2, 0, 0.2] : [0]) {
    const direction = turn(trigger.aim, offset)
    for (const lane of lanes[trigger.weapon] ?? []) {
      bullets.push({ at: { x: trigger.muzzle.x + side.x * lane, y: trigger.muzzle.y + side.y * lane }, direction })
    }
  }
  return bullets
}

/** One puff of Flame war: the cone it burns, and the puff drawn as far as it burns, up to the first wall straight ahead. */
export const flameOf = (trigger: Trigger, arena: Arena, slot: number): { readonly cone: Cone; readonly fx: FxValue } => {
  const cone = flameCone(trigger.muzzle, trigger.aim)
  const end = { x: cone.origin.x + cone.direction.x * cone.range, y: cone.origin.y + cone.direction.y * cone.range }
  const range = cone.range * (firstWall(arena, cone.origin, end) ?? 1)
  return { cone, fx: { type: "flame", x: cone.origin.x, y: cone.origin.y, angle: Ops.atan2(cone.direction.y, cone.direction.x), range, spread: cone.halfAngle, slot } }
}
