import { arenaOf } from "../../content/arenas.ts"
import { breakpointSpot } from "../breakpoints.ts"
import { DT, PARTY, PLAYER, ROCKET } from "../constants.ts"
import { makeBreakpoint, makeRocket, makeShot } from "../drafts.ts"
import { clampToArena, distanceSquared } from "../math.ts"
import { steer } from "../motion.ts"
import { PlayerWrite } from "../queries.ts"
import { BombBlast, Breakpoint, FlameBurst, Fx, Game, Input, LevelSpec, Rocket, Run, Shot } from "../schema.ts"
import type { InputValue } from "../schema.ts"
import { bulletsOf, flameOf, pull, wearOff } from "../trigger.ts"
import type { Trigger } from "../trigger.ts"
import type { WeaponKind } from "../weapons.ts"

const still: InputValue = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, fire: false, dash: false, bomb: false, breakpoint: false }

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
    commands: Game.System.commands(Game.System.spawns(Shot, Rocket, Breakpoint))
  },
  ({ queries, resources, events, commands }) => {
    const phase = resources.run.get().phase
    const inputs = resources.input.get()
    const team = queries.player.each()
    const arena = arenaOf(resources.level.get())
    const up = team.filter((match) => match.data.player.get().hp > 0).map((match) => match.data.position.get())

    const bullets = (trigger: Trigger, owner: number) => {
      for (const { at, direction } of bulletsOf(trigger)) commands.spawn(makeShot(at, direction, trigger.refactor ? 1 : 0, trigger.tools, owner))
    }

    /** What each weapon does with one pull of the trigger. */
    const fire: Record<WeaponKind, (trigger: Trigger, owner: number) => void> = {
      gun: bullets,
      pairProgramming: bullets,
      // One rocket to the crosshair, kept on the floor so the far explosion happens where it can be seen.
      pushForce: (trigger, owner) => commands.spawn(makeRocket(trigger.muzzle, clampToArena(trigger.target, ROCKET.radius, arena), owner)),
      // No bullets: a puff of fire that burns everything in the cone, resolved in Combat.
      flameWar: (trigger, owner) => {
        const { cone, fx } = flameOf(trigger, arena, owner)
        events.flame.emit({ ...cone, owner })
        events.fx.emit(fx)
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
          data.player.set({ ...state, hp: Math.min(PARTY.reviveHp, state.maxHp), revive: 0, invulnerable: 2 })
          events.fx.emit({ type: "revived", x: position.x, y: position.y, slot: state.slot, name: state.name })
        } else {
          data.player.set({ ...state, revive })
        }
        continue
      }

      // The browser predicting this developer replays the same `wearOff`, `steer` and `pull`.
      const { buffs, weapon } = wearOff(state.buffs, state.weapon)

      let { invulnerable, bombs, breakpoints } = state
      invulnerable = Math.max(0, invulnerable - DT)

      const steered = steer(state, position, input, buffs.coffee > 0)
      const { dashCooldown, dashTime, dashDirection } = steered.motion
      if (steered.dashed) {
        invulnerable = Math.max(invulnerable, PLAYER.dashTime + 0.08)
        events.fx.emit({ type: "dash", x: position.x, y: position.y, slot: state.slot })
      }
      data.velocity.set(steered.velocity)

      const { fireCooldown, trigger } = pull(state.fireCooldown, weapon.kind, buffs, position, input)
      if (trigger) {
        fire[weapon.kind](trigger, state.slot)
        events.fx.emit({ type: "shoot", x: trigger.muzzle.x, y: trigger.muzzle.y, weapon: weapon.kind, slot: state.slot })
      }

      if (input.bomb && bombs > 0) {
        bombs -= 1
        events.bomb.emit({ x: position.x, y: position.y, slot: state.slot })
        events.fx.emit({ type: "bomb", x: position.x, y: position.y })
      }

      const spot = input.breakpoint && breakpoints > 0 ? breakpointSpot(position, arena) : null
      if (spot) {
        breakpoints -= 1
        commands.spawn(makeBreakpoint(spot, state.slot))
        events.fx.emit({ type: "breakpointSet", x: spot.x, y: spot.y })
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
        breakpoints,
        aim: input.aim
      })
    }
  }
)
