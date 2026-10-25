import assert from "node:assert/strict"
import { test } from "node:test"

import { traitOf } from "../src/content/bugs.ts"
import type { BacklogBug } from "../src/content/bugs.ts"
import { levels } from "../src/content/levels.ts"
import type { Level } from "../src/content/levels.ts"
import { makeBug, makeShot } from "../src/sim/drafts.ts"
import { createSimulation, idleInput } from "../src/sim/simulation.ts"
import { Bug, Game, Shot } from "../src/sim/schema.ts"
import type { FxValue, Vec } from "../src/sim/schema.ts"

const deploying = (key: string, priority: BacklogBug["priority"] = "Medium"): BacklogBug =>
  ({ key, summary: "Hotfix straight to production on a Friday", priority, status: "Deploying" })

const PLACEHOLDER = "FND-0000"

const plain = (key: string, priority: BacklogBug["priority"] = "Lowest"): BacklogBug =>
  ({ key, summary: "Button one pixel off", priority, status: "Open" })

/** Foundry with an empty backlog: only the bugs a test sets down are in the arena, and nobody moves or shoots. */
const scene = (level: Level = { ...levels[3]!, bugs: [] }) => {
  const fx: Array<FxValue & { frame: number }> = []
  let frame = 0
  const made = createSimulation({
    level,
    seed: 7,
    locale: "en",
    input: { snapshot: () => idleInput },
    presentation: { fx: (e) => fx.push({ ...e, frame }), chat: () => undefined }
  })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  const step = (seconds: number, until: () => boolean = () => false) => {
    for (let i = 0; i < seconds * 60 && !until(); i++, frame++) assert.ok(sim.step().ok)
  }
  const me = () => sim.view().player!
  const place = (bugs: ReadonlyArray<readonly [BacklogBug, Vec]>) => {
    const Place = Game.System("Test/Place", { commands: Game.System.commands(Game.System.spawns(Bug)) }, ({ commands }) => {
      for (const [seed, at] of bugs) commands.spawn(makeBug(seed, at))
    })
    assert.ok(sim.runtime.tick(Game.Schedule(Place, Game.Schedule.applyDeferred())).ok)
  }
  // A slow bug far off in a corner keeps the boss away while the test runs.
  place([[plain(PLACEHOLDER), { x: 40, y: 40 }]])
  // Past the spawn invulnerability, so a blast really costs sanity.
  step(2)
  const bugs = () => sim.view().bugs.filter((bug) => bug.key !== PLACEHOLDER)
  const shoot = (at: Vec) => {
    const Fire = Game.System("Test/Fire", { commands: Game.System.commands(Game.System.spawns(Shot)) }, ({ commands }) => {
      commands.spawn(makeShot(at, { x: 1, y: 0 }, 0, false, 0))
    })
    assert.ok(sim.runtime.tick(Game.Schedule(Fire, Game.Schedule.applyDeferred())).ok)
  }
  const frameOf = () => frame
  return { sim, fx, step, me, place, shoot, bugs, frame: frameOf }
}

test("a Deploying bug next to a developer stops, telegraphs for about a second, then explodes for 1 sanity", () => {
  const { sim, fx, step, me, place, bugs } = scene()
  const start = me()
  place([[deploying("FND-9001"), { x: start.position.x + 220, y: start.position.y }]])

  step(4, () => fx.some((e) => e.type === "fuse"))
  const fuse = fx.find((e) => e.type === "fuse")
  assert.ok(fuse, "the fuse is lit once it gets close")
  const lit = bugs()[0]!
  assert.equal(lit.trait, "deploying")
  assert.ok(lit.fuse !== null, "the bug carries its fuse")

  step(0.5)
  const waiting = bugs()[0]
  assert.ok(waiting, "still there half a second in")
  assert.ok(Math.hypot(waiting.position.x - lit.position.x, waiting.position.y - lit.position.y) < 1, "it stopped to deploy")
  assert.equal(me().hp, start.hp, "no harm before the blast")

  step(1.5, () => fx.some((e) => e.type === "deploy"))
  const blast = fx.find((e) => e.type === "deploy")
  assert.ok(blast, "and then it deploys")
  const seconds = (blast.frame - fuse.frame) / 60
  assert.ok(seconds > 0.8 && seconds < 1.3, `fuse lasted ${seconds.toFixed(2)} s`)
  step(0.1)
  assert.equal(bugs().length, 0, "the bug is gone")
  assert.equal(me().hp, start.hp - 1, "the developer in the radius lost 1 sanity")
  assert.ok(!sim.view().run.fixed.some((bug) => bug.key === "FND-9001"), "a bug that deployed itself is not a fix")
})

test("the blast damages nearby bugs and chains into another Deploying bug", () => {
  const { sim, fx, step, me, place, bugs } = scene()
  const at = me().position
  // A lights its fuse by the developer; next to it a small bug, and behind it a slow Deploying one still too far to light its own.
  place([
    [deploying("FND-9101"), { x: at.x + 130, y: at.y }],
    [plain("FND-9102"), { x: at.x + 170, y: at.y + 30 }],
    [deploying("FND-9103", "Lowest"), { x: at.x + 240, y: at.y }]
  ])
  step(5, () => fx.filter((e) => e.type === "deploy").length >= 2)
  const blasts = fx.filter((e) => e.type === "deploy")
  assert.equal(blasts.length, 2, "both deployed")
  assert.ok(blasts[1]!.frame - blasts[0]!.frame < 20, `the second went off ${blasts[1]!.frame - blasts[0]!.frame} frames after the first: a chain, not its own fuse`)
  step(0.1)
  assert.equal(bugs().length, 0, "the blast took the small bug with it")
  assert.ok(sim.view().run.fixed.some((bug) => bug.key === "FND-9102"), "a bug the blast kills is fixed")
})

test("a Deploying bug killed far away explodes harmlessly where it is", () => {
  const { sim, fx, step, me, place, shoot, bugs } = scene()
  const start = me()
  const far = { x: start.position.x + 600, y: start.position.y - 300 }
  place([[deploying("FND-9201", "Lowest"), far]])
  step(0.05)
  shoot(bugs()[0]!.position)
  step(0.5, () => fx.some((e) => e.type === "deploy"))
  const blast = fx.find((e) => e.type === "deploy")
  assert.ok(blast, "it still goes off")
  assert.ok(Math.hypot(blast.x - far.x, blast.y - far.y) < 30, "right where it was shot")
  assert.ok(!fx.some((e) => e.type === "fuse"), "no fuse: it never got close")
  assert.equal(me().hp, start.hp, "nobody was in the radius")
  assert.ok(sim.view().run.fixed.some((bug) => bug.key === "FND-9201"), "and it counts as a fix")
})

test("Deploying tickets live in Foundry's backlog and stay plain bugs before tier S4", () => {
  const deployingIn = (level: Level) => level.bugs.filter((bug) => traitOf(bug.status) === "deploying").length
  assert.deepEqual(levels.slice(0, 3).map(deployingIn), [0, 0, 0], "nothing deploys before Foundry")
  assert.ok(deployingIn(levels[3]!) >= 4, "Foundry has a few")

  const spawned = (level: Level) => {
    const { step, bugs } = scene({ ...level, bugs: [deploying(`${level.projects[0]}-9301`)] })
    step(4, () => bugs().length > 0)
    const bug = bugs()[0]
    assert.ok(bug, `${level.id} released the ticket`)
    return bug.trait
  }
  assert.equal(spawned(levels[2]!), "plain", "Keystone (tier S3) does not have it yet")
  assert.equal(spawned(levels[3]!), "deploying", "Foundry (tier S4) does")
})
