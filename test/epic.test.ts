import assert from "node:assert/strict"
import { test } from "node:test"

import { arenaOf } from "../src/content/arenas.ts"
import type { BacklogBug } from "../src/content/bugs.ts"
import { endlessLevel, levels } from "../src/content/levels.ts"
import type { Level } from "../src/content/levels.ts"
import { EPIC } from "../src/sim/constants.ts"
import { makeBug } from "../src/sim/drafts.ts"
import { createSimulation, idleInput } from "../src/sim/simulation.ts"
import type { View } from "../src/sim/simulation.ts"
import { Bug, Game, Player } from "../src/sim/schema.ts"
import type { InputValue, Vec } from "../src/sim/schema.ts"
import { contentTiers } from "../src/sim/tiers.ts"
import type { Tier } from "../src/sim/tiers.ts"

const epic = (key: string, priority: BacklogBug["priority"] = "Medium"): BacklogBug =>
  ({ key, summary: "As a company we want one repo for everything", priority, status: "To Do", type: "epic" })

/** Foundry played at the Epics' tier with an empty backlog: only what a test sets down is in the arena. */
const atEpicTier: Level = { ...levels[3]!, tier: contentTiers.epic, bugs: [] }

const scene = (input: (view: () => View) => InputValue = () => idleInput) => {
  let current: View | null = null
  const made = createSimulation({
    level: atEpicTier,
    seed: 3,
    locale: "en",
    input: { snapshot: () => input(() => current!) },
    presentation: { fx: () => undefined, chat: () => undefined }
  })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  current = sim.view()
  const place = (seed: BacklogBug, at: Vec) => {
    const Place = Game.System("Test/Place", { commands: Game.System.commands(Game.System.spawns(Bug)) }, ({ commands }) => {
      commands.spawn(makeBug(seed, at))
    })
    assert.ok(sim.runtime.tick(Game.Schedule(Place, Game.Schedule.applyDeferred())).ok)
    current = sim.view()
  }
  /** Takes the ticket out of the arena, as if it had been closed. */
  const close = (key: string) => {
    const Close = Game.System("Test/Close", { queries: { bugs: Game.Query({ selection: { bug: Game.Query.read(Bug) } }) }, commands: Game.System.commands(Game.System.despawns(Bug)) }, ({ queries, commands }) => {
      for (const match of queries.bugs.each()) if (match.data.bug.get().key === key) commands.despawn(match.entity)
    })
    assert.ok(sim.runtime.tick(Game.Schedule(Close, Game.Schedule.applyDeferred())).ok)
    current = sim.view()
  }
  /** Nothing hurts the developer for a while: the nest is watched, not fought. */
  const shield = () => {
    const Shield = Game.System("Test/Shield", { queries: { player: Game.Query({ selection: { player: Game.Query.write(Player) } }) } }, ({ queries }) => {
      for (const match of queries.player.each()) match.data.player.update((p) => ({ ...p, invulnerable: 999 }))
    })
    assert.ok(sim.runtime.tick(Game.Schedule(Shield)).ok)
  }
  /** Steps until `done` holds (or the seconds run out), handing every view to `see`. */
  const until = (done: (view: View) => boolean, seconds: number, see: (view: View) => void = () => undefined) => {
    for (let i = 0; i < seconds * 60 && !done(current!); i++) {
      assert.ok(sim.step().ok)
      current = sim.view()
      see(current)
    }
    return current!
  }
  return { place, close, shield, until, view: () => current! }
}

const childrenOf = (view: View, key: string) => view.bugs.filter((bug) => bug.key.startsWith(`${key}-`))

test("an Epic never moves and releases a Lowest or Low sub-task about every 3 s, never more than 6 alive", () => {
  const { place, close, shield, until, view } = scene()
  shield()
  const at = { x: 300, y: 260 }
  place(epic("MONO-900"), at)
  assert.equal(view().bugs[0]!.type, "epic")

  /** The second each new child first showed up. */
  const born = new Map<string, number>()
  let most = 0
  let seconds = 0
  until(() => false, 30, (v) => {
    seconds += 1 / 60
    const nest = v.bugs.find((bug) => bug.key === "MONO-900")!
    assert.deepEqual(nest.position, at, "the Epic stays where it was put")
    const children = childrenOf(v, "MONO-900")
    most = Math.max(most, children.length)
    for (const child of children) if (!born.has(child.key)) born.set(child.key, seconds)
  })
  assert.equal(most, EPIC.brood, "never more than 6 alive")
  assert.deepEqual([...born.keys()], ["MONO-900-1", "MONO-900-2", "MONO-900-3", "MONO-900-4", "MONO-900-5", "MONO-900-6"])
  const times = [...born.values()]
  for (let i = 1; i < times.length; i++) {
    assert.ok(Math.abs(times[i]! - times[i - 1]! - EPIC.every) < 0.1, `released at ${times.map((t) => t.toFixed(2)).join(", ")} s`)
  }
  for (const child of childrenOf(view(), "MONO-900")) {
    assert.equal(child.type, "subtask")
    assert.ok(child.priority === "Lowest" || child.priority === "Low", child.priority)
  }

  // One child closed: the nest makes another, and keeps counting.
  const victim = childrenOf(view(), "MONO-900")[0]!
  close(victim.key)
  assert.equal(childrenOf(view(), "MONO-900").length, EPIC.brood - 1)
  const refilled = until((v) => childrenOf(v, "MONO-900").length === EPIC.brood, EPIC.every + 0.5)
  assert.ok(childrenOf(refilled, "MONO-900").some((bug) => bug.key === "MONO-900-7"))
})

test("the wave doesn't complete while an Epic is open, and does once it is closed; the notes list it and count its sub-tasks", () => {
  const key = "MONO-901"
  /** Stands still and shoots whatever is nearest, sub-tasks first since they come closer. */
  const gunner = (view: () => View): InputValue => {
    const v = view()
    const me = v.player!.position
    let best: Vec | null = null
    let distance = Infinity
    for (const bug of v.bugs) {
      const d = (bug.position.x - me.x) ** 2 + (bug.position.y - me.y) ** 2
      if (d < distance) [best, distance] = [bug.position, d]
    }
    return best ? { ...idleInput, aim: best, fire: true } : idleInput
  }
  const { place, until, view } = scene(gunner)
  const me = view().player!.position
  place(epic(key, "High"), { x: me.x, y: me.y - 260 })

  let wasOpen = false
  const done = until((v) => v.run.phase !== "waves", 90, (v) => {
    if (v.bugs.some((bug) => bug.key === key)) {
      wasOpen = true
      assert.equal(v.run.phase, "waves", "no boss while the Epic is open")
    }
  })
  assert.ok(wasOpen)
  assert.equal(done.run.phase, "boss", "closed, the wave completes")
  assert.deepEqual(done.run.fixed.map((f) => [f.key, f.type]), [[key, "epic"]])
  assert.ok(done.run.subtasks > 0, "its sub-tasks are counted, not listed")
})

test("Epics come with sprint 5's tier: before it an Epic in the backlog is a plain bug, from it a nest in open space", () => {
  /** The type and spot of the backlog's one Epic when it is released. */
  const release = (tier: Tier) => {
    const level: Level = { ...levels[3]!, tier, bugs: [epic("MONO-902")] }
    const made = createSimulation({ level, seed: 9, locale: "en", input: { snapshot: () => idleInput }, presentation: { fx: () => undefined, chat: () => undefined } })
    if (!made.ok) throw new Error(JSON.stringify(made.error))
    for (let i = 0; i < 5 * 60; i++) {
      assert.ok(made.value.step().ok)
      const bug = made.value.view().bugs.find((b) => b.key === "MONO-902")
      if (bug) return bug
    }
    throw new Error("never released")
  }
  assert.equal(release(3).type, "bug", "Foundry's tier")
  const nest = release(contentTiers.epic)
  assert.equal(nest.type, "epic")
  const arena = arenaOf(levels[3]!)
  const inside = (value: number, size: number) => value >= 140 && value <= size - 140
  assert.ok(inside(nest.position.x, arena.width) && inside(nest.position.y, arena.height), `in open space, not on the edge: ${JSON.stringify(nest.position)}`)
  assert.ok(contentTiers.epic <= endlessLevel.tier, "Endless gets there")
})
