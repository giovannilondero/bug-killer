import assert from "node:assert/strict"
import { test } from "node:test"

import { clients } from "../src/content/clients.ts"
import { locales, text } from "../src/content/i18n.ts"
import { endlessLevel, levels } from "../src/content/levels.ts"
import type { RaceThread } from "../src/content/levels.ts"
import { contentTiers } from "../src/sim/tiers.ts"
import { nearest, scene, shooter } from "./scene.ts"

const microservices = levels.find((level) => level.id === "microservices")!

/** Microservices with an empty backlog and twins weak enough to fix in a few seconds. */
const fight = { ...microservices, bugs: [], boss: { ...microservices.boss, hp: 16 } }

/** Shoots the twin running `prey`, or the nearest boss when `prey` is "any"; holds fire on `null`. */
const hunter = (prey: () => RaceThread | "any" | null) =>
  shooter((view) => {
    const wanted = prey()
    if (wanted === null) return null
    return nearest(view.bosses.filter((boss) => wanted === "any" || boss.thread === wanted), view.player!.position)
  })

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
  const { until, view } = scene(fight, { input: hunter(() => prey) })
  const twins = until((v) => v.bosses.length === 2, 10).bosses
  assert.deepEqual(twins.map((b) => b.thread).sort(), ["main", "worker"])
  for (const twin of twins) assert.equal(twin.key, microservices.boss.key)

  // Only main goes down: worker is left running, and main comes back.
  prey = "main"
  const alone = until((v) => v.bosses.length === 1, 20)
  assert.equal(alone.bosses[0]!.thread, "worker")
  prey = null
  const counting = until((v) => v.bosses[0]!.revive > 0, 1)
  const back = until((v) => v.bosses.length === 2, counting.bosses[0]!.revive + 1)
  assert.equal(back.bosses.length, 2, "the dead twin came back")
  const main = back.bosses.find((b) => b.thread === "main")!
  assert.equal(main.hp, main.maxHp, "at full health")
  assert.equal(back.run.phase, "boss")
  assert.ok(!back.run.fixed.some((fixed) => fixed.key === microservices.boss.key), "not fixed")

  // Both down, one right after the other: the race is fixed.
  prey = "any"
  const done = until((v) => v.run.phase === "cleared", 20)
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

test("Endless rotates Race condition sixth", () => {
  assert.equal(endlessLevel.endless!.bosses[5]!.pattern, "raceCondition")
  assert.ok(endlessLevel.clients.includes("debora"))
  assert.ok(endlessLevel.bugs.some((bug) => bug.key.startsWith("MSVC-")))
})
