import assert from "node:assert/strict"
import { test } from "node:test"

import { arenaOf } from "../src/content/arenas.ts"
import { clients } from "../src/content/clients.ts"
import { locales, text } from "../src/content/i18n.ts"
import { endlessLevel, levels } from "../src/content/levels.ts"
import type { Level } from "../src/content/levels.ts"
import { idleInput } from "../src/sim/simulation.ts"
import { contentTiers } from "../src/sim/tiers.ts"
import { gunner, nearest, scene, shooter } from "./scene.ts"

const monorepo = levels.find((level) => level.id === "monorepo")!

/** Monorepo with an empty backlog and a boss weak enough to fight in a few seconds. */
const fight = { ...monorepo, bugs: [], boss: { ...monorepo.boss, hp: 40 } }

test("Monorepo is the 5th sprint, right after Foundry, and brings in Epics and git push --force", () => {
  assert.equal(levels.indexOf(monorepo), 4)
  assert.equal(levels[3]!.id, "foundry")
  assert.equal(monorepo.sprint, "Sprint 5")
  assert.deepEqual(monorepo.projects, ["MONO"])
  assert.equal(monorepo.tier, 4)
  assert.equal(contentTiers.epic, monorepo.tier)
  assert.equal(contentTiers.pushForce, monorepo.tier)
  assert.ok(monorepo.bugs.length >= 28 && monorepo.bugs.length <= 34, `${monorepo.bugs.length} tickets`)
  assert.ok(monorepo.bugs.every((bug) => bug.key.startsWith("MONO-")))
  const epics = monorepo.bugs.filter((bug) => bug.type === "epic")
  assert.ok(epics.length >= 1, "some Epics")
  assert.ok(monorepo.bugs.some((bug) => bug.type === "story"), "some Stories")
  for (const epic of [...epics, ...endlessLevel.bugs.filter((bug) => bug.type === "epic")]) {
    assert.notEqual(epic.status, "Deploying", `${epic.key}: an Epic never deploys`)
  }
  assert.equal(monorepo.boss.pattern, "mergeConflict")
  assert.ok(monorepo.clients.includes("fabrizio"))
})

test("Merge conflict splits into ours and theirs at half health; the level clears only when both halves are fixed", () => {
  let prey: ((side: string | null) => boolean) | null = () => true
  const { until, view } = scene(fight, { input: shooter((v) => (prey ? nearest(v.bosses.filter((b) => prey!(b.side)), v.player!.position) : null)) })
  const whole = until((v) => v.bosses.length === 1, 10).bosses[0]!
  assert.equal(whole.side, null)

  const split = until((v) => v.bosses.length === 2, 20)
  assert.deepEqual(split.bosses.map((b) => b.side).sort(), ["ours", "theirs"])
  for (const half of split.bosses) assert.equal(half.key, monorepo.boss.key)
  assert.ok(split.bosses.every((half) => half.maxHp === Math.ceil(fight.boss.hp / 2)), "each half has half the health")
  assert.equal(split.run.phase, "boss")

  // Ours goes first: theirs is still a conflict.
  prey = (side) => side === "ours"
  const one = until((v) => v.bosses.length === 1, 20)
  assert.equal(one.bosses[0]!.side, "theirs")
  prey = null
  const later = until(() => false, 2)
  assert.equal(later.run.phase, "boss", "one half left: not cleared")
  assert.ok(!later.run.fixed.some((fixed) => fixed.key === monorepo.boss.key), "not in the release notes yet")

  prey = () => true
  const done = until((v) => v.run.phase === "cleared", 20)
  assert.equal(done.run.phase, "cleared")
  assert.equal(view().run.fixed.filter((fixed) => fixed.key === monorepo.boss.key).length, 1, "the conflict is listed once")
})

test("ours and theirs move and fire in mirror across the arena's middle", () => {
  let firing = true
  const { until } = scene(fight, { input: (v) => (firing ? gunner(v) : idleInput) })
  until((v) => v.bosses.length === 2, 20)
  firing = false
  // Left alone for a while, the halves settle into their mirrored orbits.
  const settled = until(() => false, 4)
  const ours = settled.bosses.find((b) => b.side === "ours")!
  const theirs = settled.bosses.find((b) => b.side === "theirs")!
  const arena = arenaOf(monorepo)
  assert.ok(Math.abs(ours.position.x + theirs.position.x - arena.width) < 30, `x ${ours.position.x.toFixed(0)} / ${theirs.position.x.toFixed(0)}`)
  assert.ok(Math.abs(ours.position.y - theirs.position.y) < 30, `y ${ours.position.y.toFixed(0)} / ${theirs.position.y.toFixed(0)}`)
  const mirrored = (side: string) => settled.hostile.filter((shot) => shot.text === side)
  assert.ok(mirrored("<<<<<<<").length > 0 && mirrored(">>>>>>>").length > 0, "both halves fire")
})

test("Fabrizio only ever answers +1 and up, in every language", () => {
  assert.ok(clients.fabrizio)
  for (const locale of locales) {
    const strings = text[locale]
    const person = strings.people.fabrizio
    assert.ok(person.role.length > 0)
    for (let n = 0; n < 6; n++) {
      assert.match(person.voice("Close MONO-17 within 30 seconds.", () => n), /^(\+1|up)$/)
    }
    assert.match(person.laugh, /^(\+1|up)$/)
    for (const line of [...strings.outcomes.fabrizio.success, ...strings.outcomes.fabrizio.failure]) assert.match(line, /^(\+1|up)$/)
  }
})

test("Fabrizio assigns missions in Monorepo, and they read +1 or up", () => {
  const { until, chat } = scene({ ...monorepo, clients: ["fabrizio"] })
  until(() => chat.some((m) => m.type === "mission"), 60)
  const mission = chat.find((m) => m.type === "mission")
  assert.ok(mission && mission.client === "fabrizio")
  assert.match(mission.text, /^(\+1|up)$/)
})

test("Endless rotates every sprint's boss in campaign order, then starts over", () => {
  assert.deepEqual(endlessLevel.endless!.bosses.map((b) => b.key), levels.map((l) => l.boss.key))
  assert.ok(endlessLevel.clients.includes("fabrizio"), "Fabrizio joins Endless's clients")
  assert.ok(endlessLevel.bugs.some((bug) => bug.key.startsWith("MONO-")), "and Monorepo's tickets its pool")

  // One round a wave, a bug a wave, and bosses that go down in a shot or two.
  const quick: Level = {
    ...endlessLevel,
    waveSize: 1,
    bugs: endlessLevel.bugs.filter((bug) => bug.priority === "Low" && (bug.type ?? "bug") === "bug").slice(0, 1),
    endless: { ...endlessLevel.endless!, every: 1, bosses: endlessLevel.endless!.bosses.map((boss) => ({ ...boss, hp: 1 })) }
  }
  const { until } = scene(quick, { input: shooter((v) => nearest([...v.bosses, ...v.bugs], v.player!.position), { keepAway: 160 }) })
  const seen: Array<string> = []
  until(() => seen.length > levels.length, 240, (v) => {
    const boss = v.bosses[0]
    if (boss && seen.at(-1) !== boss.key) seen.push(boss.key)
  })
  assert.deepEqual(seen, [...levels.map((l) => l.boss.key), levels[0]!.boss.key])
  assert.ok(levels.length >= 5)
})
