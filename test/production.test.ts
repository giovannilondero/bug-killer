import assert from "node:assert/strict"
import { test } from "node:test"

import { locales, text } from "../src/content/i18n.ts"
import { endlessLevel, levels } from "../src/content/levels.ts"
import type { Level } from "../src/content/levels.ts"
import { createSimulation, idleInput } from "../src/sim/simulation.ts"
import type { View } from "../src/sim/simulation.ts"
import { Boss, Bug, Game, Player, Position } from "../src/sim/schema.ts"
import type { BossValue, BugValue, InputValue, Vec } from "../src/sim/schema.ts"

const production = levels.find((level) => level.id === "production")!
const legacy = levels.find((level) => level.id === "legacy")!

/** A run of `level` with a hand on every knob: the developer can't be hurt, bosses and bugs can be set by hand. */
const scene = (level: Level, input: (view: View) => InputValue = () => idleInput, { parked = false } = {}) => {
  let current: View | null = null
  const made = createSimulation({ level, seed: 5, locale: "en", input: { snapshot: () => input(current!) }, presentation: { fx: () => undefined, chat: () => undefined } })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  current = sim.view()
  const Untouchable = Game.System("Test/Untouchable", { queries: { player: Game.Query({ selection: { player: Game.Query.write(Player) } }) } }, ({ queries }) => {
    for (const match of queries.player.each()) match.data.player.update((p) => ({ ...p, invulnerable: 999 }))
  })
  /** Rewrites every boss. */
  const setBoss = (change: (boss: BossValue) => Partial<BossValue>) => {
    const SetBoss = Game.System("Test/SetBoss", { queries: { bosses: Game.Query({ selection: { boss: Game.Query.write(Boss) } }) } }, ({ queries }) => {
      for (const match of queries.bosses.each()) match.data.boss.update((boss) => ({ ...boss, ...change(boss) }))
    })
    assert.ok(sim.runtime.tick(Game.Schedule(SetBoss)).ok)
    current = sim.view()
  }
  /** With `parked`, every dropped frame stops in a corner, out of the line of fire. */
  const park = () => {
    const Park = Game.System("Test/Park", { queries: { bugs: Game.Query({ selection: { bug: Game.Query.write(Bug), position: Game.Query.write(Position) } }) } }, ({ queries }) => {
      for (const match of queries.bugs.each()) {
        if (!isFrame(match.data.bug.get())) continue
        match.data.bug.update((bug) => ({ ...bug, speed: 0 }))
        match.data.position.set({ x: 60, y: 60 })
      }
    })
    assert.ok(sim.runtime.tick(Game.Schedule(Park)).ok)
  }
  /** Takes every dropped frame out of the arena, as if it had been closed. */
  const closeFrames = () => {
    const Close = Game.System(
      "Test/CloseFrames",
      { queries: { bugs: Game.Query({ selection: { bug: Game.Query.read(Bug) } }) }, commands: Game.System.commands(Game.System.despawns(Bug)) },
      ({ queries, commands }) => {
        for (const match of queries.bugs.each()) if (isFrame(match.data.bug.get())) commands.despawn(match.entity)
      }
    )
    assert.ok(sim.runtime.tick(Game.Schedule(Close, Game.Schedule.applyDeferred())).ok)
    current = sim.view()
  }
  /** Steps until `done` holds or the seconds run out. */
  const until = (done: (view: View) => boolean, seconds: number, each: (view: View) => void = () => undefined) => {
    for (let i = 0; i < seconds * 60 && !done(current!); i++) {
      assert.ok(sim.runtime.tick(Game.Schedule(Untouchable)).ok)
      if (parked) park()
      assert.ok(sim.step().ok)
      current = sim.view()
      each(current)
    }
    return current!
  }
  return { setBoss, closeFrames, until, view: () => current! }
}

const isFrame = (bug: Pick<BugValue, "key">) => bug.key.startsWith("FRAME-")
const frames = (view: View) => view.bugs.filter(isFrame)
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)

/** Stands its ground and shoots the boss. */
const gunner = (view: View): InputValue => {
  const boss = view.bosses[0]
  return boss ? { ...idleInput, aim: boss.position, fire: true } : idleInput
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

test("Stack overflow's new strings exist in every language", () => {
  for (const locale of locales) {
    const strings = text[locale]
    assert.ok(strings.taglines.production.length > 0)
    assert.ok(strings.bossPhase.frameDropped.length > 0)
    assert.match(strings.minions.frame(4), /4/)
    assert.match(strings.hud.depth(5), /5/)
  }
})

test("Endless rotates all 8 bosses, Stack overflow last", () => {
  assert.equal(endlessLevel.endless!.bosses.length, 8)
  assert.equal(endlessLevel.endless!.bosses[7]!.pattern, "stackOverflow")
  assert.ok(endlessLevel.bugs.some((bug) => bug.key.startsWith("PROD-")))
})

test("Stack overflow drops its top frame for each share of health lost, and takes no damage while a dropped frame is alive", () => {
  const { setBoss, closeFrames, until } = scene({ ...production, bugs: [] }, gunner, { parked: true })
  const tower = until((v) => v.bosses.length === 1 && v.bosses[0]!.shield === 0, 10).bosses[0]!
  assert.equal(tower.frames, 6, "a tower of 6 frames")

  // A sixth of its health gone: the top frame drops off.
  setBoss((boss) => ({ hp: Math.floor((boss.maxHp * 5) / 6) - 1 }))
  const dropped = until((v) => frames(v).length > 0, 2)
  assert.equal(frames(dropped).length, 1)
  assert.equal(dropped.bosses[0]!.frames, 5)
  const hp = dropped.bosses[0]!.hp

  // Shot at for 3 seconds while the frame is alive: everything bounces off.
  until(() => false, 3, (v) => {
    assert.equal(frames(v).length, 1, "the frame is still alive")
    assert.ok(v.bosses[0]!.shield > 0, "shielded")
    assert.equal(v.bosses[0]!.hp, hp, "no damage")
  })

  // The frame is closed: the shield drops and shots hurt again.
  closeFrames()
  const hurt = until((v) => v.bosses[0]!.hp < hp, 3)
  assert.ok(hurt.bosses[0]!.hp < hp, "takes damage again")
  assert.equal(hurt.bosses[0]!.frames, 5, "no frame dropped until the next share is lost")
})

test("a big hit drops every frame it is owed; the last frame is the boss itself", () => {
  const { setBoss, until } = scene({ ...production, bugs: [] })
  until((v) => v.bosses.length === 1, 10)
  setBoss((boss) => ({ hp: Math.floor(boss.maxHp / 2) }))
  const half = until((v) => frames(v).length >= 3, 2)
  assert.equal(frames(half).length, 3, "half the health, half the tower")
  assert.equal(half.bosses[0]!.frames, 3)
  setBoss(() => ({ hp: 1 }))
  const low = until((v) => frames(v).length >= 5, 2)
  assert.equal(frames(low).length, 5)
  assert.equal(low.bosses[0]!.frames, 1, "the boss is the frame at the bottom")
})

test("dropped frames chase the developers, faster as the tower gets shorter", () => {
  const speeds: Array<number> = []
  for (const share of [5, 3, 1]) {
    const { setBoss, until, view } = scene({ ...production, bugs: [] })
    until((v) => v.bosses.length === 1, 10)
    setBoss((boss) => ({ hp: Math.floor((boss.maxHp * share) / 6) }))
    until((v) => frames(v).length > 0, 2)
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
