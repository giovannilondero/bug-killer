import assert from "node:assert/strict"
import { test } from "node:test"

import { arenaOf } from "../src/content/arenas.ts"
import type { BacklogBug } from "../src/content/bugs.ts"
import { endlessLevel, levels } from "../src/content/levels.ts"
import type { Level } from "../src/content/levels.ts"
import { EPIC, PLAYER } from "../src/sim/constants.ts"
import { makeBug } from "../src/sim/drafts.ts"
import { createSimulation, idleInput } from "../src/sim/simulation.ts"
import type { View } from "../src/sim/simulation.ts"
import { Bug, Game } from "../src/sim/schema.ts"
import type { FxValue, InputValue, Vec } from "../src/sim/schema.ts"
import { contentTiers } from "../src/sim/tiers.ts"
import type { Tier } from "../src/sim/tiers.ts"

const epic = (key: string, priority: BacklogBug["priority"] = "Medium"): BacklogBug =>
  ({ key, summary: "As a company we want one repo for everything", priority, status: "To Do", type: "epic" })

/** Foundry played at the Epics' tier with an empty backlog: only what a test sets down is in the arena. */
const atEpicTier: Level = { ...levels[3]!, tier: contentTiers.epic, bugs: [] }

const scene = (input: (view: () => View) => InputValue = () => idleInput) => {
  let current: View | null = null
  const fx: Array<FxValue> = []
  const made = createSimulation({
    level: atEpicTier,
    seed: 3,
    locale: "en",
    input: { snapshot: () => input(() => current!) },
    presentation: { fx: (e) => fx.push(e), chat: () => undefined }
  })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  current = sim.view()
  const place = (seeds: ReadonlyArray<readonly [BacklogBug, Vec]>) => {
    const Place = Game.System("Test/Place", { commands: Game.System.commands(Game.System.spawns(Bug)) }, ({ commands }) => {
      for (const [seed, at] of seeds) commands.spawn(makeBug(seed, at))
    })
    assert.ok(sim.runtime.tick(Game.Schedule(Place, Game.Schedule.applyDeferred())).ok)
    current = sim.view()
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
  return { place, until, fx, view: () => current! }
}

const childrenOf = (view: View, key: string) => view.bugs.filter((bug) => bug.key.startsWith(`${key}-`))

const towards = (from: Vec, to: Vec): Vec => {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
}

/** The bug nearest to the developer, if any. */
const nearestBug = (view: View, only: (bug: View["bugs"][number]) => boolean = () => true) => {
  const me = view.player!.position
  let best: View["bugs"][number] | null = null
  for (const bug of view.bugs.filter(only)) {
    if (!best || Math.hypot(bug.position.x - me.x, bug.position.y - me.y) < Math.hypot(best.position.x - me.x, best.position.y - me.y)) best = bug
  }
  return best
}

/** Stands still and shoots whatever is nearest, sub-tasks first since they come closer. */
const gunner = (view: () => View): InputValue => {
  const target = nearestBug(view())
  return target ? { ...idleInput, aim: target.position, fire: true } : idleInput
}

/**
 * Runs circles of `radius` around `centre`, faster than any sub-task, so the brood
 * trails behind on a smaller circle and never reaches the developer.
 */
const orbit = (me: Vec, centre: Vec, radius: number): Vec => {
  const out = towards(centre, me)
  const drift = Math.max(-1, Math.min(1, (radius - Math.hypot(me.x - centre.x, me.y - centre.y)) / 40))
  return { x: -out.y + out.x * drift, y: out.x + out.y * drift }
}

test("an Epic never moves and releases a Lowest or Low sub-task about every 3 s, never more than 6 alive", () => {
  const key = "MONO-900"
  let at: Vec = { x: 0, y: 0 }
  /** Once the brood is full, shoot one sub-task down. */
  let hunting = false
  const kite = (view: () => View): InputValue => {
    const v = view()
    const me = v.player!.position
    const move = orbit(me, at, 300)
    const prey = hunting ? nearestBug(v, (bug) => bug.parent === key) : null
    return prey ? { ...idleInput, move, aim: prey.position, fire: true } : { ...idleInput, move }
  }
  const { place, until, view } = scene(kite)
  const start = view().player!.position
  at = { x: start.x + 300, y: start.y }
  place([[epic(key), at]])
  assert.equal(view().bugs[0]!.type, "epic")

  /** The second each new child first showed up. */
  const born = new Map<string, number>()
  let most = 0
  let seconds = 0
  const watch = (v: View) => {
    seconds += 1 / 60
    const nest = v.bugs.find((bug) => bug.key === key)!
    assert.deepEqual(nest.position, at, "the Epic stays where it was put")
    const children = childrenOf(v, key)
    most = Math.max(most, children.length)
    for (const child of children) if (!born.has(child.key)) born.set(child.key, seconds)
  }
  until(() => false, 24, watch)
  assert.equal(view().player!.hp, PLAYER.maxHp, "kiting kept the developer out of reach")
  assert.equal(most, EPIC.brood, "never more than 6 alive")
  assert.deepEqual([...born.keys()], ["MONO-900-1", "MONO-900-2", "MONO-900-3", "MONO-900-4", "MONO-900-5", "MONO-900-6"])
  const times = [...born.values()]
  for (let i = 1; i < times.length; i++) {
    assert.ok(Math.abs(times[i]! - times[i - 1]! - EPIC.every) < 0.1, `released at ${times.map((t) => t.toFixed(2)).join(", ")} s`)
  }
  for (const child of childrenOf(view(), key)) {
    assert.equal(child.type, "subtask")
    assert.ok(child.priority === "Lowest" || child.priority === "Low", child.priority)
  }

  // A child closed: the nest makes another, and keeps counting.
  hunting = true
  until((v) => childrenOf(v, key).length < EPIC.brood, 5, watch)
  hunting = false
  assert.ok(childrenOf(view(), key).length < EPIC.brood, "a sub-task was shot down")
  const refilled = until((v) => childrenOf(v, key).some((bug) => bug.key === "MONO-900-7"), EPIC.every + 0.5, watch)
  assert.ok(childrenOf(refilled, key).some((bug) => bug.key === "MONO-900-7"))
})

test("an Epic stays a still nest whatever its status: it never deploys, wanders or reopens", () => {
  const { place, until, fx, view } = scene(gunner)
  const me = view().player!.position
  // A Deploying Epic within a fuse's reach, one In development, and a row of Epics Ready for QA.
  const rows: Array<readonly [BacklogBug, Vec]> = [
    [{ ...epic("MONO-910", "Lowest"), status: "Deploying" }, { x: me.x + 90, y: me.y }],
    [{ ...epic("MONO-911", "Lowest"), status: "In development" }, { x: me.x - 90, y: me.y }],
    ...[0, 1, 2, 3, 4].map((i) => [{ ...epic(`MONO-92${i}`, "Lowest"), status: "Ready for QA" }, { x: me.x + (i - 2) * 90, y: me.y - 160 }] as const)
  ]
  place(rows)
  for (const bug of view().bugs) assert.equal(bug.trait, "plain", `${bug.key} is a plain nest`)

  const spots = new Map(rows.map(([seed, at]) => [seed.key, at]))
  const closed = new Set<string>()
  until(() => [...spots.keys()].every((key) => closed.has(key)), 60, (v) => {
    for (const bug of v.bugs) {
      const at = spots.get(bug.key)
      if (!at) continue
      assert.ok(!closed.has(bug.key), `${bug.key} came back`)
      assert.deepEqual(bug.position, at, `${bug.key} stays where it was put`)
    }
    for (const key of spots.keys()) if (!v.bugs.some((bug) => bug.key === key)) closed.add(key)
  })
  assert.equal(closed.size, spots.size, "all closed")
  until(() => false, 1)
  assert.ok(!view().bugs.some((bug) => spots.has(bug.key)), "none reopened")
  assert.ok(!fx.some((e) => e.type === "fuse" || e.type === "reopen"), "no fuse, no reopen")
})

test("the wave doesn't complete while an Epic is open, and does once it is closed; the notes list it and count its sub-tasks", () => {
  const key = "MONO-901"
  const { place, until, view } = scene(gunner)
  const me = view().player!.position
  place([[epic(key, "High"), { x: me.x, y: me.y - 260 }]])

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
