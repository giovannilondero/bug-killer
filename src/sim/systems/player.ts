import { arenaOf } from "../../content/arenas.ts"
import { DT, PARTY, PLAYER, ROCKET } from "../constants.ts"
import { makeRocket, makeShot } from "../drafts.ts"
import { clampToArena, distanceSquared, length, normalize } from "../math.ts"
import { PlayerWrite } from "../queries.ts"
import { BombBlast, FlameBurst, Fx, Game, Input, LevelSpec, Rocket, Run, Shot, pickupKinds } from "../schema.ts"
import type { InputValue, Vec } from "../schema.ts"
import { HOTFIX_COOLDOWN, WEAPONS, basicGun, flameCone } from "../weapons.ts"
import type { WeaponKind } from "../weapons.ts"
import { Ops } from "@typeonce/ritmo-math"

const still: InputValue = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, fire: false, dash: false, bomb: false }

/**
 * One pull of the trigger, whatever the weapon: where it fires from and
 * toward, whose kill it is, and the power-ups that change its shots. Refactor
 * and Tools are already off here for a weapon they don't apply to.
 */
interface Trigger {
  muzzle: Vec
  /** Unit vector toward the crosshair. */
  aim: Vec
  /** The crosshair itself, in world coordinates. */
  target: Vec
  owner: number
  refactor: boolean
  tools: boolean
}

/** `direction` turned by `angle` radians. */
const turn = (direction: Vec, angle: number): Vec => {
  const cos = Ops.cos(angle)
  const sin = Ops.sin(angle)
  return { x: direction.x * cos - direction.y * sin, y: direction.x * sin + direction.y * cos }
}

/**
 * Moving, aiming, shooting, dashing, and bombing: everything each
 * developer's input does. A developer who is down cannot act; a teammate
 * standing close for a few seconds brings them back.
 */
export const PlayerControlSystem = Game.System(
  "BugKiller/PlayerControl",
  {
    queries: { player: PlayerWrite },
    resources: {
      input: Game.System.readResource(Input),
      run: Game.System.readResource(Run),
      level: Game.System.readResource(LevelSpec)
    },
    events: {
      fx: Game.System.writeEvent(Fx),
      bomb: Game.System.writeEvent(BombBlast),
      flame: Game.System.writeEvent(FlameBurst)
    },
    commands: Game.System.commands(Game.System.spawns(Shot, Rocket))
  },
  ({ queries, resources, events, commands }) => {
    const phase = resources.run.get().phase
    const inputs = resources.input.get()
    const team = queries.player.each()
    const arena = arenaOf(resources.level.get())
    const up = team.filter((match) => match.data.player.get().hp > 0).map((match) => match.data.position.get())

    /** Bullets from `lanes` barrels side by side (pixels off the aim line), fanned out by Refactor. */
    const bullets = (trigger: Trigger, lanes: ReadonlyArray<number>) => {
      const side = { x: -trigger.aim.y, y: trigger.aim.x }
      for (const offset of trigger.refactor ? [-0.2, 0, 0.2] : [0]) {
        const direction = turn(trigger.aim, offset)
        for (const lane of lanes) {
          const at = { x: trigger.muzzle.x + side.x * lane, y: trigger.muzzle.y + side.y * lane }
          commands.spawn(makeShot(at, direction, trigger.refactor ? 1 : 0, trigger.tools, trigger.owner))
        }
      }
    }

    /** What each weapon does with one pull of the trigger. */
    const fire: Record<WeaponKind, (trigger: Trigger) => void> = {
      gun: (trigger) => bullets(trigger, [0]),
      pairProgramming: (trigger) => bullets(trigger, [-8, 8]),
      // One rocket to the crosshair, kept on the floor so the far explosion happens where it can be seen.
      pushForce: (trigger) => commands.spawn(makeRocket(trigger.muzzle, clampToArena(trigger.target, ROCKET.radius, arena), trigger.owner)),
      // No bullets: a puff of fire that burns everything in the cone, resolved in Combat.
      flameWar: (trigger) => {
        const cone = flameCone(trigger.muzzle, trigger.aim)
        events.flame.emit({ ...cone, owner: trigger.owner })
        events.fx.emit({ type: "flame", x: cone.origin.x, y: cone.origin.y, angle: Ops.atan2(cone.direction.y, cone.direction.x), range: cone.range, spread: cone.halfAngle })
      }
    }

    for (const { data } of team) {
      const position = data.position.get()
      const state = data.player.get()
      const input = inputs[state.slot] ?? { ...still, aim: state.aim }

      if (phase === "dead" || phase === "cleared") {
        data.velocity.set({ x: 0, y: 0 })
        continue
      }

      if (state.hp <= 0) {
        // Down: a teammate within reach keeps the revive going; alone, it fades.
        data.velocity.set({ x: 0, y: 0 })
        const helped = up.some((other) => distanceSquared(other, position) <= PARTY.reviveRadius ** 2)
        const revive = helped ? state.revive + DT : Math.max(0, state.revive - DT)
        if (revive >= PARTY.reviveSeconds) {
          data.player.set({ ...state, hp: PARTY.reviveHp, revive: 0, invulnerable: 2 })
          events.fx.emit({ type: "revived", x: position.x, y: position.y, slot: state.slot, name: state.name })
        } else {
          data.player.set({ ...state, revive })
        }
        continue
      }

      const buffs = { ...state.buffs }
      for (const kind of pickupKinds) {
        buffs[kind] = Math.max(0, buffs[kind] - DT)
      }

      // The weapon in hand runs out like a power-up, and the basic gun comes back.
      const left = state.weapon.seconds - DT
      const weapon = state.weapon.kind === "gun" || left > 0 ? { ...state.weapon, seconds: Math.max(0, left) } : basicGun

      let { fireCooldown, dashCooldown, dashTime, dashDirection, invulnerable, bombs } = state
      fireCooldown = Math.max(0, fireCooldown - DT)
      dashCooldown = Math.max(0, dashCooldown - DT)
      dashTime = Math.max(0, dashTime - DT)
      invulnerable = Math.max(0, invulnerable - DT)

      const move = length(input.move) > 1 ? normalize(input.move) : input.move
      if (input.dash && dashCooldown === 0) {
        dashDirection = length(move) > 0 ? normalize(move) : normalize({ x: input.aim.x - position.x, y: input.aim.y - position.y })
        dashTime = PLAYER.dashTime
        dashCooldown = PLAYER.dashCooldown
        invulnerable = Math.max(invulnerable, PLAYER.dashTime + 0.08)
        events.fx.emit({ type: "dash", x: position.x, y: position.y })
      }

      const speed = PLAYER.speed * (buffs.coffee > 0 ? 1.45 : 1)
      data.velocity.set(
        dashTime > 0
          ? { x: dashDirection.x * PLAYER.dashSpeed, y: dashDirection.y * PLAYER.dashSpeed }
          : { x: move.x * speed, y: move.y * speed }
      )

      const aim = normalize({ x: input.aim.x - position.x, y: input.aim.y - position.y })
      if (input.fire && fireCooldown === 0 && (aim.x !== 0 || aim.y !== 0)) {
        const spec = WEAPONS[weapon.kind]
        fireCooldown = buffs.hotfix > 0 ? spec.cooldown * HOTFIX_COOLDOWN : spec.cooldown
        const muzzle = { x: position.x + aim.x * 22, y: position.y + aim.y * 22 }
        fire[weapon.kind]({
          muzzle,
          aim,
          target: input.aim,
          owner: state.slot,
          refactor: spec.upgradable && buffs.refactor > 0,
          tools: spec.upgradable && buffs.tools > 0
        })
        events.fx.emit({ type: "shoot", x: muzzle.x, y: muzzle.y, weapon: weapon.kind })
      }

      if (input.bomb && bombs > 0) {
        bombs -= 1
        events.bomb.emit({ x: position.x, y: position.y, slot: state.slot })
        events.fx.emit({ type: "bomb", x: position.x, y: position.y })
      }

      data.player.set({
        ...state,
        buffs,
        weapon,
        fireCooldown,
        dashCooldown,
        dashTime,
        dashDirection,
        invulnerable,
        bombs,
        aim: input.aim
      })
    }
  }
)
