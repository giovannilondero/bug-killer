import assert from "node:assert/strict"

import type { Level } from "../src/content/levels.ts"
import { makePickup } from "../src/sim/drafts.ts"
import { createSimulation, idleInput } from "../src/sim/simulation.ts"
import type { View } from "../src/sim/simulation.ts"
import { Game, Pickup } from "../src/sim/schema.ts"
import type { ChatValue, FxValue, InputValue, PickupKind, Vec } from "../src/sim/schema.ts"

/**
 * A run of `level` driven by `input`, which reads the View like a player reads
 * the screen. While `guarded`, a Green tests pickup is dropped at the
 * developer's feet whenever theirs runs low (and none is already there), so a long fight can't end it.
 */
export const scene = (level: Level, { input = () => idleInput, guarded = true }: { input?: (view: View) => InputValue; guarded?: boolean } = {}) => {
  let current: View | null = null
  const fx: Array<FxValue> = []
  const chat: Array<ChatValue> = []
  const made = createSimulation({
    level,
    seed: 5,
    locale: "en",
    input: { snapshot: () => input(current!) },
    presentation: { fx: (e) => fx.push(e), chat: (e) => chat.push(e) }
  })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  current = sim.view()
  /** Drops a `kind` pickup at the developer's feet. */
  const drop = (kind: PickupKind) => {
    const at = current!.player!.position
    const Drop = Game.System("Test/Drop", { commands: Game.System.commands(Game.System.spawns(Pickup)) }, ({ commands }) => {
      commands.spawn(makePickup(kind, at))
    })
    assert.ok(sim.runtime.tick(Game.Schedule(Drop, Game.Schedule.applyDeferred())).ok)
    current = sim.view()
  }
  const guard = () => {
    const me = current!.player
    if (me && me.hp > 0 && me.buffs.unitTest < 1 && !current!.pickups.some((p) => p.kind === "unitTest" && dist(p.position, me.position) < 20)) drop("unitTest")
  }
  /** Steps until `done` holds or the seconds run out; `each` sees every View on the way. */
  const until = (done: (view: View) => boolean, seconds: number, each: (view: View) => void = () => undefined) => {
    for (let i = 0; i < seconds * 60 && !done(current!); i++) {
      if (guarded) guard()
      assert.ok(sim.step().ok)
      current = sim.view()
      each(current)
    }
    return current!
  }
  return { until, drop, view: () => current!, fx, chat }
}

export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)

/** The one of `among` closest to `to`. */
export const nearest = <T extends { readonly position: Vec }>(among: ReadonlyArray<T>, to: Vec): T | undefined =>
  [...among].sort((a, b) => dist(a.position, to) - dist(b.position, to))[0]

/**
 * Fires at whatever `target` picks from the View, and holds fire when it picks
 * nothing. Stands its ground, or with `keepAway` backs off from a target closer
 * than that, so one sitting on the developer can still be shot.
 */
export const shooter = (target: (view: View) => { readonly position: Vec } | null | undefined, { keepAway = 0 } = {}) => (view: View): InputValue => {
  const at = target(view)
  if (!at) return idleInput
  const me = view.player!.position
  const away = dist(me, at.position) < keepAway ? { x: me.x - at.position.x || 1, y: me.y - at.position.y } : { x: 0, y: 0 }
  return { ...idleInput, move: away, aim: at.position, fire: true }
}

/** Shoots the nearest boss. */
export const gunner = shooter((view) => nearest(view.bosses, view.player!.position))
