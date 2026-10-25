// Plays every level headless with two autopilots and saves views worth drawing:
// crowds, each boss, both kinds of call, power-ups, turrets, Breakpoints, zombies, a teammate down.
// `node bench/fixtures.ts` writes bench/fixtures.json, read by the bench's `?scene=` mode.
import { writeFileSync } from "node:fs"

import { endlessLevel, levels } from "../src/content/levels.ts"
import { PARTY } from "../src/sim/constants.ts"
import { makePickup } from "../src/sim/drafts.ts"
import { Game, Pickup, pickupKinds } from "../src/sim/schema.ts"
import type { InputValue } from "../src/sim/schema.ts"
import { createSimulation, idleInput } from "../src/sim/simulation.ts"
import type { View } from "../src/sim/simulation.ts"

const pilot = (view: View | null, slot: number, tick: number): InputValue => {
  const me = view?.players.find((p) => p.slot === slot)
  if (!view || !me) return idleInput
  const targets = [...view.bugs, ...view.bosses].map((t) => t.position)
  let nearest = targets[0]
  let best = Infinity
  for (const t of targets) {
    const d = Math.hypot(t.x - me.position.x, t.y - me.position.y)
    if (d < best) {
      best = d
      nearest = t
    }
  }
  if (!nearest) return { ...idleInput, move: { x: Math.sin(tick / 40 + slot), y: 0 } }
  const away = { x: me.position.x - nearest.x, y: me.position.y - nearest.y }
  const length = Math.hypot(away.x, away.y) || 1
  const strafe = best < 220 ? 1 : -0.4
  return {
    move: { x: (away.x / length) * strafe + (-away.y / length) * 0.6, y: (away.y / length) * strafe + (away.x / length) * 0.6 },
    aim: nearest,
    fire: true,
    dash: best < 60,
    bomb: false,
    breakpoint: best < 140 && me.breakpoints > 0
  }
}

const scenes: Record<string, View> = {}
const want: Record<string, (v: View) => boolean> = {
  crowd: (v) => v.bugs.length >= 18,
  meet: (v) => v.calls.active?.kind === "meet" && v.calls.active.progress > 0,
  slack: (v) => v.calls.active?.kind === "slack",
  turret: (v) => v.turrets.length > 0 && v.bugs.length > 5,
  breakpoint: (v) => v.breakpoints.length > 0 && v.bugs.length > 3,
  zombie: (v) => v.bugs.some((b) => b.resurrectedBy !== null),
  hostile: (v) => v.hostile.length > 3,
  down: (v) => v.players.some((p) => p.hp <= 0) && v.players.some((p) => p.hp > 0),
  target: (v) => v.missions.active?.kind === "killTarget" && v.bugs.some((b) => b.key === (v.missions.active as { target?: string }).target)
}

for (const level of [...levels, endlessLevel]) {
  let view: View | null = null
  let tick = 0
  const made = createSimulation({
    level,
    seed: 3,
    locale: "en",
    party: [0, 1].map((slot) => ({ slot, name: slot ? "Ada" : "Linus", color: PARTY.colors[slot]! })),
    inputs: { snapshot: () => [pilot(view, 0, tick), pilot(view, 1, tick)] },
    presentation: { fx: () => {}, chat: () => {} }
  })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  for (; tick < 60 * 240; tick++) {
    view = sim.view()
    if (view.run.phase === "dead" || view.run.phase === "cleared") break
    if (tick % (60 * 15) === 0 && view.player) {
      const kind = pickupKinds[(tick / 900) % pickupKinds.length]!
      const at = { x: view.player.position.x + 30, y: view.player.position.y }
      const Drop = Game.System("Bench/Drop", { commands: Game.System.commands(Game.System.spawns(Pickup)) }, ({ commands }) => {
        commands.spawn(makePickup(kind, at))
      })
      sim.runtime.tick(Game.Schedule(Drop, Game.Schedule.applyDeferred()))
    }
    for (const [name, test] of Object.entries(want)) {
      if (!scenes[name] && test(view)) scenes[name] = view
    }
    const bossKey = view.bosses[0]?.key
    if (bossKey && view.bosses[0]!.age > 4 && !scenes[`boss-${bossKey}`]) scenes[`boss-${bossKey}`] = view
    const r = sim.step()
    if (!r.ok) throw new Error(JSON.stringify(r.error))
  }
}

writeFileSync(new URL("./fixtures.json", import.meta.url), JSON.stringify(scenes))
console.log(Object.keys(scenes).join(", "))
