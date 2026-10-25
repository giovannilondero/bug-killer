import assert from "node:assert/strict"
import { test } from "node:test"

import { locales, text } from "../src/content/i18n.ts"
import { endlessLevel, levels } from "../src/content/levels.ts"
import type { Level } from "../src/content/levels.ts"
import { lapOf } from "../src/sim/bosses.ts"
import { createSimulation, idleInput } from "../src/sim/simulation.ts"
import type { View } from "../src/sim/simulation.ts"
import { Game, Player } from "../src/sim/schema.ts"
import type { Vec } from "../src/sim/schema.ts"

const legacy = levels.find((level) => level.id === "legacy")!
const microservices = levels.find((level) => level.id === "microservices")!

/** A run of `level` where the developer stands still and can't be hurt. */
const scene = (level: Level) => {
  const made = createSimulation({ level, seed: 5, locale: "en", input: { snapshot: () => idleInput }, presentation: { fx: () => undefined, chat: () => undefined } })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  let current = sim.view()
  const Untouchable = Game.System("Test/Untouchable", { queries: { player: Game.Query({ selection: { player: Game.Query.write(Player) } }) } }, ({ queries }) => {
    for (const match of queries.player.each()) match.data.player.update((p) => ({ ...p, invulnerable: 999 }))
  })
  /** One step, the developer kept untouchable. */
  const step = () => {
    assert.ok(sim.runtime.tick(Game.Schedule(Untouchable)).ok)
    assert.ok(sim.step().ok)
    current = sim.view()
    return current
  }
  /** Steps until `done` holds or the seconds run out. */
  const until = (done: (view: View) => boolean, seconds: number) => {
    for (let i = 0; i < seconds * 60 && !done(current); i++) step()
    return current
  }
  return { step, until }
}

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)

test("Legacy is the 7th sprint, right after Microservices, and harder", () => {
  assert.equal(levels.indexOf(legacy), 6)
  assert.equal(levels[5]!.id, "microservices")
  assert.equal(legacy.sprint, "Sprint 7")
  assert.equal(legacy.name, "Legacy")
  assert.deepEqual(legacy.projects, ["LGC"])
  assert.equal(legacy.tier, 5, "everything is unlocked")
  assert.ok(legacy.bugs.length >= 28 && legacy.bugs.length <= 34, `${legacy.bugs.length} tickets`)
  assert.ok(legacy.bugs.every((bug) => bug.key.startsWith("LGC-")))
  const epics = legacy.bugs.filter((bug) => bug.type === "epic")
  assert.ok(epics.length >= 1, "some Epics")
  assert.ok(legacy.bugs.some((bug) => bug.type === "story"), "some Stories")
  for (const epic of epics) assert.notEqual(epic.status, "Deploying", `${epic.key}: an Epic never deploys`)
  assert.equal(legacy.boss.pattern, "infiniteLoop")
  assert.ok(legacy.theme.crt, "a green-phosphor terminal")
  // Harder than sprint 6: bigger waves, clients more often, a tougher boss.
  assert.ok(legacy.waveSize > microservices.waveSize)
  assert.ok(legacy.clientEvery < microservices.clientEvery)
  assert.ok(legacy.boss.hp > microservices.boss.hp)
})

test("Infinite loop runs its circuit faster every lap, leaving a trail of hostile shots", () => {
  const { step, until } = scene({ ...legacy, bugs: [] })
  until((v) => v.bosses.length === 1 && lapOf(v.bosses[0]!.course) === 1, 40)
  /** Seconds and distance run in each lap, from lap 1 on (lap 0 starts off the circuit). */
  const laps: Array<{ seconds: number; distance: number }> = []
  let previous = until(() => false, 0).bosses[0]!.position
  let lap = { seconds: 0, distance: 0 }
  let shots = 0
  for (let i = 0; i < 60 * 60 && laps.length < 3; i++) {
    const view = step()
    const boss = view.bosses[0]!
    lap.seconds += 1 / 60
    lap.distance += dist(previous, boss.position)
    previous = boss.position
    shots = Math.max(shots, view.hostile.filter((shot) => shot.text === legacy.boss.shotText).length)
    if (lapOf(boss.course) > laps.length + 1) {
      laps.push(lap)
      lap = { seconds: 0, distance: 0 }
    }
  }
  assert.equal(laps.length, 3, "three laps in a minute")
  for (let i = 1; i < laps.length; i++) {
    assert.ok(laps[i]!.seconds < laps[i - 1]!.seconds, `lap ${i + 1} takes ${laps[i]!.seconds.toFixed(2)}s, lap ${i} ${laps[i - 1]!.seconds.toFixed(2)}s`)
    const speed = (l: { seconds: number; distance: number }) => l.distance / l.seconds
    assert.ok(speed(laps[i]!) > speed(laps[i - 1]!) * 1.05, `lap ${i + 1} at ${speed(laps[i]!).toFixed(0)} px/s, lap ${i} at ${speed(laps[i - 1]!).toFixed(0)} px/s`)
    // The same circuit every lap.
    assert.ok(Math.abs(laps[i]!.distance - laps[i - 1]!.distance) < laps[0]!.distance * 0.1)
  }
  assert.ok(shots >= 10, `a trail of ${shots} shots`)
})

test("Infinite loop's new strings exist in every language", () => {
  for (const locale of locales) {
    const strings = text[locale]
    assert.ok(strings.taglines.legacy.length > 0)
    assert.ok(strings.bossPhase.faster.length > 0)
    assert.match(strings.hud.lap(3), /3/)
  }
})

test("Endless rotates Infinite loop seventh", () => {
  assert.equal(endlessLevel.endless!.bosses[6]!.pattern, "infiniteLoop")
  assert.ok(endlessLevel.bugs.some((bug) => bug.key.startsWith("LGC-")))
})
