import assert from "node:assert/strict"
import { test } from "node:test"

import { clients } from "../src/content/clients.ts"
import { locales, text } from "../src/content/i18n.ts"
import { endlessLevel, levels } from "../src/content/levels.ts"
import type { Level, RaceThread } from "../src/content/levels.ts"
import { RACE } from "../src/sim/constants.ts"
import { createSimulation, idleInput } from "../src/sim/simulation.ts"
import type { View } from "../src/sim/simulation.ts"
import { Boss, Game, Player } from "../src/sim/schema.ts"
import type { BossValue, ChatValue, InputValue, Vec } from "../src/sim/schema.ts"
import { contentTiers } from "../src/sim/tiers.ts"

const microservices = levels.find((level) => level.id === "microservices")!

/** A run of `level` where the developer can't be hurt, and bosses can be set by hand. */
const scene = (level: Level, input: (view: View) => InputValue = () => idleInput) => {
  let current: View | null = null
  const chat: Array<ChatValue> = []
  const made = createSimulation({
    level,
    seed: 5,
    locale: "en",
    input: { snapshot: () => input(current!) },
    presentation: { fx: () => undefined, chat: (e) => chat.push(e) }
  })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  current = sim.view()
  const Untouchable = Game.System("Test/Untouchable", { queries: { player: Game.Query({ selection: { player: Game.Query.write(Player) } }) } }, ({ queries }) => {
    for (const match of queries.player.each()) match.data.player.update((p) => ({ ...p, invulnerable: 999 }))
  })
  assert.ok(sim.runtime.tick(Game.Schedule(Untouchable)).ok)
  /** Rewrites every boss `pick` chooses. */
  const setBoss = (pick: (boss: BossValue) => boolean, change: (boss: BossValue) => Partial<BossValue>) => {
    const SetBoss = Game.System("Test/SetBoss", { queries: { bosses: Game.Query({ selection: { boss: Game.Query.write(Boss) } }) } }, ({ queries }) => {
      for (const match of queries.bosses.each()) if (pick(match.data.boss.get())) match.data.boss.update((boss) => ({ ...boss, ...change(boss) }))
    })
    assert.ok(sim.runtime.tick(Game.Schedule(SetBoss)).ok)
    current = sim.view()
  }
  /** Steps until `done` holds or the seconds run out. */
  const until = (done: (view: View) => boolean, seconds: number) => {
    for (let i = 0; i < seconds * 60 && !done(current!); i++) {
      assert.ok(sim.step().ok)
      current = sim.view()
    }
    return current!
  }
  return { setBoss, until, view: () => current!, chat }
}

const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)

/** Shoots the twin running `prey`, or the nearest boss when `prey` is "any"; holds fire on `null`. */
const hunter = (prey: () => RaceThread | "any" | null) => (view: View): InputValue => {
  const wanted = prey()
  if (wanted === null) return idleInput
  const me = view.player!.position
  const target = [...view.bosses]
    .filter((boss) => wanted === "any" || boss.thread === wanted)
    .sort((a, b) => dist(a.position, me) - dist(b.position, me))[0]
  return target ? { ...idleInput, aim: target.position, fire: true } : idleInput
}

test("Microservices is the 6th sprint, right after Monorepo, and brings in Flame war", () => {
  assert.equal(levels.indexOf(microservices), 5)
  assert.equal(levels[4]!.id, "monorepo")
  assert.equal(microservices.sprint, "Sprint 6")
  assert.deepEqual(microservices.projects, ["MSVC"])
  assert.equal(microservices.tier, 5)
  assert.equal(contentTiers.flameWar, microservices.tier)
  assert.ok(microservices.bugs.length >= 28 && microservices.bugs.length <= 34, `${microservices.bugs.length} tickets`)
  assert.ok(microservices.bugs.every((bug) => bug.key.startsWith("MSVC-")))
  const epics = microservices.bugs.filter((bug) => bug.type === "epic")
  assert.ok(epics.length >= 1, "some Epics")
  assert.ok(microservices.bugs.some((bug) => bug.type === "story"), "some Stories")
  for (const epic of epics) assert.notEqual(epic.status, "Deploying", `${epic.key}: an Epic never deploys`)
  assert.equal(microservices.boss.pattern, "raceCondition")
  assert.ok(microservices.clients.includes("debora"))
})

test("Race condition: a twin killed alone comes back; both killed within the window clear the level", () => {
  let prey: RaceThread | "any" | null = null
  const { setBoss, until, view } = scene({ ...microservices, bugs: [] }, hunter(() => prey))
  const twins = until((v) => v.bosses.length === 2 && v.bosses.every((b) => b.shield === 0), 10).bosses
  assert.deepEqual(twins.map((b) => b.thread).sort(), ["main", "worker"])
  for (const twin of twins) assert.equal(twin.key, microservices.boss.key)

  // Only main goes down: worker is left running, and main comes back.
  setBoss((boss) => boss.thread === "main", () => ({ hp: 1 }))
  prey = "main"
  const alone = until((v) => v.bosses.length === 1, 10)
  assert.equal(alone.bosses[0]!.thread, "worker")
  prey = null
  const back = until((v) => v.bosses.length === 2, RACE.window + 1)
  assert.equal(back.bosses.length, 2, "the dead twin came back")
  const main = back.bosses.find((b) => b.thread === "main")!
  assert.equal(main.hp, main.maxHp, "at full health")
  assert.equal(back.run.phase, "boss")
  assert.ok(!back.run.fixed.some((fixed) => fixed.key === microservices.boss.key), "not fixed")

  // Both down, one right after the other: the race is fixed.
  until((v) => v.bosses.every((b) => b.shield === 0), 10)
  setBoss(() => true, () => ({ hp: 1 }))
  prey = "any"
  const done = until((v) => v.run.phase === "cleared", RACE.window)
  assert.equal(done.run.phase, "cleared")
  assert.equal(view().run.fixed.filter((fixed) => fixed.key === microservices.boss.key).length, 1, "the race is listed once")
})

test("Debora from marketing wants it more pop by Friday, in every language", () => {
  assert.ok(clients.debora)
  for (const locale of locales) {
    const strings = text[locale]
    const person = strings.people.debora
    assert.ok(person.role.length > 0)
    assert.ok(person.laugh.length > 0)
    const line = person.voice("Close MSVC-17 within 30 seconds.", () => 0)
    assert.match(line, /MSVC-17/)
    assert.match(line, /pop/i)
    assert.ok(strings.outcomes.debora.success.length > 0 && strings.outcomes.debora.failure.length > 0)
    assert.ok(strings.taglines.microservices.length > 0)
  }
})

test("Debora assigns missions in Microservices", () => {
  const { until, chat } = scene({ ...microservices, clients: ["debora"] })
  until(() => chat.some((m) => m.type === "mission"), 60)
  const mission = chat.find((m) => m.type === "mission")
  assert.ok(mission && mission.client === "debora")
  assert.match(mission.text, /pop/i)
})

test("Endless rotates 6 bosses, Race condition last", () => {
  assert.equal(endlessLevel.endless!.bosses.length, 6)
  assert.equal(endlessLevel.endless!.bosses[5]!.pattern, "raceCondition")
  assert.ok(endlessLevel.clients.includes("debora"))
  assert.ok(endlessLevel.bugs.some((bug) => bug.key.startsWith("MSVC-")))
})
