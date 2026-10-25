import assert from "node:assert/strict"
import { test } from "node:test"

import { locales, text } from "../src/content/i18n.ts"
import { endlessLevel, levels } from "../src/content/levels.ts"

const production = levels.find((level) => level.id === "production")!
const legacy = levels.find((level) => level.id === "legacy")!

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
