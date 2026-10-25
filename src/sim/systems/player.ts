import { DT, PARTY, PLAYER } from "../constants.ts"
import { makeShot } from "../drafts.ts"
import { distanceSquared, length, normalize } from "../math.ts"
import { PlayerWrite } from "../queries.ts"
import { BombBlast, Fx, Game, Input, Run, Shot, pickupKinds } from "../schema.ts"
import type { InputValue } from "../schema.ts"
import { Ops } from "@typeonce/ritmo-math"

const still: InputValue = { move: { x: 0, y: 0 }, aim: { x: 0, y: 0 }, fire: false, dash: false, bomb: false }

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
      run: Game.System.readResource(Run)
    },
    events: {
      fx: Game.System.writeEvent(Fx),
      bomb: Game.System.writeEvent(BombBlast)
    },
    commands: Game.System.commands(Game.System.spawns(Shot))
  },
  ({ queries, resources, events, commands }) => {
    const phase = resources.run.get().phase
    const inputs = resources.input.get()
    const team = queries.player.each()
    const up = team.filter((match) => match.data.player.get().hp > 0).map((match) => match.data.position.get())

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

      const buffs = { ...state.buffs }
      for (const kind of pickupKinds) {
        buffs[kind] = Math.max(0, buffs[kind] - DT)
      }

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
        fireCooldown = buffs.hotfix > 0 ? PLAYER.rapidCooldown : PLAYER.fireCooldown
        const muzzle = { x: position.x + aim.x * 22, y: position.y + aim.y * 22 }
        const spread = buffs.refactor > 0 ? [-0.2, 0, 0.2] : [0]
        for (const offset of spread) {
          const cos = Ops.cos(offset)
          const sin = Ops.sin(offset)
          commands.spawn(makeShot(muzzle, { x: aim.x * cos - aim.y * sin, y: aim.x * sin + aim.y * cos }, buffs.refactor > 0 ? 1 : 0, buffs.tools > 0, state.slot))
        }
        events.fx.emit({ type: "shoot", x: muzzle.x, y: muzzle.y })
      }

      if (input.bomb && bombs > 0) {
        bombs -= 1
        events.bomb.emit({ x: position.x, y: position.y, slot: state.slot })
        events.fx.emit({ type: "bomb", x: position.x, y: position.y })
      }

      data.player.set({
        ...state,
        buffs,
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
