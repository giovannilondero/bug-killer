import assert from "node:assert/strict"
import { test } from "node:test"

import { locales, text } from "../src/content/i18n.ts"
import { endlessArenas, endlessIn, endlessLevel, levels } from "../src/content/levels.ts"
import type { Level } from "../src/content/levels.ts"
import { idleInput } from "../src/sim/simulation.ts"
import type { View } from "../src/sim/simulation.ts"
import type { Vec } from "../src/sim/schema.ts"
import { dist, nearest, scene, shooter } from "./scene.ts"

const production = levels.find((level) => level.id === "production")!
const legacy = levels.find((level) => level.id === "legacy")!
const microservices = levels.find((level) => level.id === "microservices")!

const isFrame = (bug: { readonly key: string }) => bug.key.startsWith("FRAME-")
const frames = (view: View) => view.bugs.filter(isFrame)

/** Production with an empty backlog and a Stack overflow of `hp`. */
const fight = (hp: number) => ({ ...production, bugs: [], boss: { ...production.boss, hp } })

/** How far `at` is from the segment between `from` and `to`. */
const offLine = (at: Vec, from: Vec, to: Vec) => {
  const length = dist(from, to) || 1
  const along = Math.max(0, Math.min(1, ((at.x - from.x) * (to.x - from.x) + (at.y - from.y) * (to.y - from.y)) / (length * length)))
  return dist(at, { x: from.x + (to.x - from.x) * along, y: from.y + (to.y - from.y) * along })
}

/**
 * A Stack overflow of `hp` hit once, past its boot shield, by a git push --force
 * rocket: the frames that one hit owes have dropped.
 */
const rocketed = (hp: number) => {
  let firing = false
  const run = scene(fight(hp), { input: (v) => (firing && v.bosses[0] ? { ...idleInput, aim: v.bosses[0].position, fire: true } : idleInput) })
  run.drop("pushForce")
  run.until((v) => v.bosses.length === 1 && v.bosses[0]!.shield === 0 && v.player!.weapon.kind === "pushForce", 10)
  firing = true
  run.until((v) => v.rockets.length > 0, 1)
  firing = false
  run.until((v) => frames(v).length > 0, 3)
  return run
}

test("Production is the 8th and last sprint, right after Legacy, and the hardest", () => {
  assert.equal(levels.indexOf(production), 7)
  assert.equal(levels.length, 8, "the last sprint")
  assert.equal(levels[6]!.id, "legacy")
  assert.equal(production.sprint, "Sprint 8")
  assert.equal(production.name, "Production")
  assert.deepEqual(production.projects, ["PROD"])
  assert.equal(production.tier, 5, "everything is unlocked")
  assert.ok(production.bugs.length >= 28 && production.bugs.length <= 34, `${production.bugs.length} tickets`)
  assert.ok(production.bugs.every((bug) => bug.key.startsWith("PROD-")))
  const epics = production.bugs.filter((bug) => bug.type === "epic")
  assert.ok(epics.length >= 1, "some Epics")
  assert.ok(production.bugs.some((bug) => bug.type === "story"), "some Stories")
  for (const epic of epics) assert.notEqual(epic.status, "Deploying", `${epic.key}: an Epic never deploys`)
  assert.equal(production.boss.pattern, "stackOverflow")
  // Harder than sprint 7: bigger waves, clients more often, a tougher boss.
  assert.ok(production.waveSize > legacy.waveSize)
  assert.ok(production.clientEvery < legacy.clientEvery)
  assert.ok(production.boss.hp > legacy.boss.hp)
})

test("Legacy's and Production's tickets are tougher than the same ticket in Microservices", () => {
  /** The health one of Microservices' Highest bugs comes in with, released in `level`. */
  const health = (level: Level) => {
    const ticket = microservices.bugs.find((bug) => bug.priority === "Highest" && (bug.type ?? "bug") === "bug")!
    const { until } = scene({ ...level, bugs: [ticket] })
    return until((v) => v.bugs.length > 0, 5).bugs[0]!.maxHp
  }
  const msvc = health(microservices)
  assert.ok(health(legacy) > msvc, `Legacy ${health(legacy)}, Microservices ${msvc}`)
  assert.ok(health(production) > health(legacy), `Production ${health(production)}, Legacy ${health(legacy)}`)
})

test("Stack overflow's new strings exist in every language", () => {
  for (const locale of locales) {
    const strings = text[locale]
    assert.ok(strings.taglines.production.length > 0)
    assert.ok(strings.bossPhase.frameDropped.length > 0)
    assert.match(strings.minions.frame(4), /4/)
    assert.match(strings.hud.depth(5), /5/)
  }
})

test("Endless rotates all 8 bosses, Stack overflow last, in every arena", () => {
  assert.equal(endlessLevel.endless!.bosses.length, 8)
  assert.equal(endlessLevel.endless!.bosses[7]!.pattern, "stackOverflow")
  for (const { id } of endlessArenas) assert.deepEqual(endlessIn(id).endless!.bosses, levels.map((level) => level.boss), id)
  assert.ok(endlessLevel.bugs.some((bug) => bug.key.startsWith("PROD-")))
})

test("Stack overflow drops its top frame for each share of health lost, and takes no damage while a dropped frame is alive", () => {
  /** Level with the tower, far to its left, so a frame coming down from the top stays clear of the line of fire for a while. */
  const post = { x: 100, y: 360 }
  let prey: "boss" | "frame" = "boss"
  let fired = 0
  const { until } = scene(fight(60), {
    input: (v) => {
      const me = v.player!.position
      const boss = v.bosses[0]
      if (dist(me, post) > 8) return { ...idleInput, move: { x: post.x - me.x, y: post.y - me.y } }
      if (!boss) return idleInput
      if (prey === "frame") return shooter((view) => nearest(frames(view), me))(v)
      // Holds fire while a frame is in the way, so every shot fired reaches the tower.
      if (frames(v).some((frame) => offLine(frame.position, me, boss.position) < frame.radius + 12)) return idleInput
      fired += 1
      return { ...idleInput, aim: boss.position, fire: true }
    }
  })
  const tower = until((v) => v.bosses.length === 1, 10).bosses[0]!
  assert.equal(tower.frames, 6, "a tower of 6 frames")

  // A sixth of its health gone: the top frame drops off.
  const dropped = until((v) => frames(v).length > 0, 20)
  assert.equal(frames(dropped).length, 1)
  assert.equal(dropped.bosses[0]!.frames, 5)
  const hp = dropped.bosses[0]!.hp

  // Shot at for 3 seconds while the frame is alive: everything bounces off.
  fired = 0
  until(() => false, 3, (v) => {
    assert.equal(frames(v).length, 1, "the frame is still alive")
    assert.ok(v.bosses[0]!.shield > 0, "shielded")
    assert.equal(v.bosses[0]!.hp, hp, "no damage")
  })
  assert.ok(fired > 60, `fired on ${fired} ticks of 180`)

  // The frame is closed: the shield drops and shots hurt again.
  prey = "frame"
  until((v) => frames(v).length === 0, 10)
  prey = "boss"
  const hurt = until((v) => v.bosses[0]!.hp < hp, 3)
  assert.ok(hurt.bosses[0]!.hp < hp, "takes damage again")
  assert.equal(hurt.bosses[0]!.frames, 5, "no frame dropped until the next share is lost")
})

test("a big hit drops every frame it is owed; the last frame is the boss itself", () => {
  // A rocket takes 6: half of 12, and all but 1 of 7.
  const half = rocketed(12).view()
  assert.equal(frames(half).length, 3, "half the health, half the tower")
  assert.equal(half.bosses[0]!.frames, 3)
  const low = rocketed(7).view()
  assert.equal(low.bosses[0]!.hp, 1)
  assert.equal(frames(low).length, 5)
  assert.equal(low.bosses[0]!.frames, 1, "the boss is the frame at the bottom")
})

test("dropped frames chase the developers, faster as the tower gets shorter", () => {
  const speeds: Array<number> = []
  // A rocket takes 6: down to 5, 3 and 1 sixths of the health.
  for (const hp of [36, 12, 7]) {
    const { until, view } = rocketed(hp)
    // The last frame dropped, from the shortest tower: the lowest left on the stack.
    const top = frames(view()).sort((a, b) => a.key.localeCompare(b.key))[0]!
    speeds.push(top.speed)
    // It comes for the developer.
    const near = (v: View) => dist(frames(v).find((f) => f.key === top.key)!.position, v.player!.position)
    const before = near(view())
    assert.ok(near(until(() => false, 1.5)) < before - 50, "it chases")
  }
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i]! > speeds[i - 1]!, `frame speeds ${speeds.join(", ")}`)
})
