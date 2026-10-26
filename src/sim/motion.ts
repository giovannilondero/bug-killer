/**
 * How one step of input moves a developer: the dash it may start, the
 * velocity it sets, where that takes them. `PlayerControlSystem` and
 * `IntegrateSystem` step it on the run server; a browser predicting its own
 * developer replays the same functions, so the two agree.
 */
import type { Arena } from "../content/arenas.ts"
import { DT, PLAYER } from "./constants.ts"
import { clampToArena, length, normalize } from "./math.ts"
import type { InputValue, Vec } from "./schema.ts"

export interface Motion {
  readonly dashCooldown: number
  readonly dashTime: number
  readonly dashDirection: Vec
}

/** One step of `input` for a developer standing at `position`; `coffee` when the buff is still on after this step's tick. */
export const steer = (motion: Motion, position: Vec, input: InputValue, coffee: boolean) => {
  let dashCooldown = Math.max(0, motion.dashCooldown - DT)
  let dashTime = Math.max(0, motion.dashTime - DT)
  let dashDirection = motion.dashDirection
  const move = length(input.move) > 1 ? normalize(input.move) : input.move
  const dashed = input.dash && dashCooldown === 0
  if (dashed) {
    dashDirection = length(move) > 0 ? normalize(move) : normalize({ x: input.aim.x - position.x, y: input.aim.y - position.y })
    dashTime = PLAYER.dashTime
    dashCooldown = PLAYER.dashCooldown
  }
  const speed = PLAYER.speed * (coffee ? 1.45 : 1)
  const velocity =
    dashTime > 0 ? { x: dashDirection.x * PLAYER.dashSpeed, y: dashDirection.y * PLAYER.dashSpeed } : { x: move.x * speed, y: move.y * speed }
  return { motion: { dashCooldown, dashTime, dashDirection }, velocity, dashed }
}

/** Where a developer moving at `velocity` stands one step later, kept inside the arena and out of its walls. */
export const glide = (position: Vec, velocity: Vec, arena: Arena): Vec =>
  clampToArena({ x: position.x + velocity.x * DT, y: position.y + velocity.y * DT }, PLAYER.radius, arena)
