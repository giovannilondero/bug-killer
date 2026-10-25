import assert from "node:assert/strict"
import { test } from "node:test"

import { bonusLevels } from "../src/content/levels.ts"
import { bestScore, bonusUnlocked, clearBonus, clearSprint, emptyProgress, endEndless, endlessBest, hardcoreBadge, loadProgress, unlockEverySprint, saveProgress, sprintsCleared, sprintUnlocked } from "../src/progress.ts"

test("progress saved by today's version loads unchanged", () => {
  const saved = JSON.stringify({ unlocked: 3, best: { glacier: 12400, sidequests: 8100, endless: 30500 } })
  const progress = loadProgress(saved)
  assert.equal(sprintUnlocked(progress, 0), true)
  assert.equal(sprintUnlocked(progress, 2), true)
  assert.equal(sprintUnlocked(progress, 3), false)
  assert.equal(sprintsCleared(progress), 2)
  assert.equal(bestScore(progress, "glacier"), 12400)
  assert.equal(bestScore(progress, "sidequests"), 8100)
  assert.equal(bestScore(progress, "keystone"), undefined)
  assert.equal(bestScore(progress, "endless"), 30500)
})

test("a browser with no or broken saved progress starts at the first sprint", () => {
  for (const saved of [null, "", "not json", "42", JSON.stringify({ unlocked: "lots", best: { glacier: "a lot" } })]) {
    const progress = loadProgress(saved)
    assert.equal(sprintUnlocked(progress, 0), true)
    assert.equal(sprintUnlocked(progress, 1), false)
    assert.equal(sprintsCleared(progress), 0)
    assert.equal(bestScore(progress, "glacier"), undefined)
  }
})

test("progress is saved in the format today's version reads", () => {
  const saved = JSON.stringify({ unlocked: 3, best: { glacier: 12400, endless: 30500 } })
  assert.deepEqual(JSON.parse(saveProgress(loadProgress(saved))), { unlocked: 3, best: { glacier: 12400, endless: 30500 } })
})

test("clearing a sprint solo unlocks the next one and keeps the best score", () => {
  const first = clearSprint(emptyProgress, 0, { score: 9000, solo: true })
  assert.equal(sprintUnlocked(first, 1), true)
  assert.equal(sprintUnlocked(first, 2), false)
  assert.equal(sprintsCleared(first), 1)
  assert.equal(bestScore(first, "glacier"), 9000)

  const worse = clearSprint(first, 0, { score: 4000, solo: true })
  assert.equal(bestScore(worse, "glacier"), 9000)
  const better = clearSprint(worse, 0, { score: 15000, solo: true })
  assert.equal(bestScore(better, "glacier"), 15000)
})

test("replaying an earlier sprint does not lock the later ones", () => {
  const far = loadProgress(JSON.stringify({ unlocked: 4, best: {} }))
  const replayed = clearSprint(far, 0, { score: 100, solo: true })
  assert.equal(sprintUnlocked(replayed, 3), true)
  assert.equal(sprintsCleared(replayed), 3)
})

test("a sprint cleared together unlocks the next one but records no best score", () => {
  const together = clearSprint(emptyProgress, 0, { score: 20000, solo: false })
  assert.equal(sprintUnlocked(together, 1), true)
  assert.equal(bestScore(together, "glacier"), undefined)
})

test("an Endless run sets a record only when it beats the best solo score", () => {
  const first = endEndless(emptyProgress, { score: 5000, solo: true })
  assert.equal(first.record, true)
  assert.equal(bestScore(first.progress, "endless"), 5000)

  const worse = endEndless(first.progress, { score: 3000, solo: true })
  assert.equal(worse.record, false)
  assert.equal(bestScore(worse.progress, "endless"), 5000)

  const together = endEndless(worse.progress, { score: 90000, solo: false })
  assert.equal(together.record, false)
  assert.equal(bestScore(together.progress, "endless"), 5000)
})

test("an Endless run unlocks no sprint", () => {
  const { progress } = endEndless(emptyProgress, { score: 5000, solo: true })
  assert.equal(sprintUnlocked(progress, 1), false)
})

test("the playtest shortcut unlocks every sprint and keeps the scores", () => {
  const progress = unlockEverySprint(loadProgress(JSON.stringify({ unlocked: 1, best: { endless: 700 } })))
  assert.equal(sprintUnlocked(progress, 3), true)
  assert.equal(bestScore(progress, "endless"), 700)
})

test("a sprint cleared in hardcore gets a badge, solo or together, and unlocks nothing extra", () => {
  const normal = clearSprint(emptyProgress, 0, { score: 9000, solo: true })
  assert.equal(hardcoreBadge(normal, "glacier"), false)

  const hardcore = clearSprint(normal, 0, { score: 4000, solo: true, hardcore: true })
  assert.equal(hardcoreBadge(hardcore, "glacier"), true)
  assert.equal(hardcoreBadge(hardcore, "sidequests"), false)
  assert.equal(sprintUnlocked(hardcore, 1), true)
  assert.equal(sprintUnlocked(hardcore, 2), false)
  assert.equal(bestScore(hardcore, "glacier"), 9000)

  const together = clearSprint(hardcore, 1, { score: 100, solo: false, hardcore: true })
  assert.equal(hardcoreBadge(together, "sidequests"), true)

  const saved = loadProgress(saveProgress(together))
  assert.equal(hardcoreBadge(saved, "glacier"), true)
  assert.equal(hardcoreBadge(saved, "sidequests"), true)
  assert.equal(hardcoreBadge(saved, "keystone"), false)
})

test("Endless keeps a separate hardcore record", () => {
  const normal = endEndless(emptyProgress, { score: 5000, solo: true })
  const hardcore = endEndless(normal.progress, { score: 1200, solo: true, hardcore: true })
  assert.equal(hardcore.record, true, "the first hardcore run is a record of its own")
  assert.equal(endlessBest(hardcore.progress, { hardcore: true }), 1200)
  assert.equal(endlessBest(hardcore.progress, { hardcore: false }), 5000)

  const better = endEndless(hardcore.progress, { score: 6000, solo: true, hardcore: true })
  assert.equal(endlessBest(better.progress, { hardcore: true }), 6000)
  assert.equal(endlessBest(better.progress, { hardcore: false }), 5000, "a hardcore run does not touch the normal record")

  const saved = loadProgress(saveProgress(better.progress))
  assert.equal(endlessBest(saved, { hardcore: true }), 6000)
  assert.equal(endlessBest(saved, { hardcore: false }), 5000)
})

test("progress saved by today's version has no badges and its Endless best is the normal record", () => {
  const progress = loadProgress(JSON.stringify({ unlocked: 3, best: { glacier: 12400, endless: 30500 } }))
  assert.equal(hardcoreBadge(progress, "glacier"), false)
  assert.equal(endlessBest(progress, { hardcore: false }), 30500)
  assert.equal(endlessBest(progress, { hardcore: true }), undefined)
  const broken = loadProgress(JSON.stringify({ unlocked: 2, best: {}, badges: "glacier" }))
  assert.equal(hardcoreBadge(broken, "glacier"), false)
  assert.equal(sprintUnlocked(broken, 1), true)
})

test("Hotdesk unlocks after sprint 3", () => {
  const hotdesk = bonusLevels.find((level) => level.id === "hotdesk")!
  assert.equal(bonusUnlocked(emptyProgress, hotdesk), false)
  assert.equal(bonusUnlocked(loadProgress(JSON.stringify({ unlocked: 3, best: {} })), hotdesk), false)
  const third = clearSprint(loadProgress(JSON.stringify({ unlocked: 3, best: {} })), 2, { score: 100, solo: true })
  assert.equal(bonusUnlocked(third, hotdesk), true)
})

test("clearing a bonus level keeps its best score and unlocks no sprint", () => {
  const hotdesk = bonusLevels.find((level) => level.id === "hotdesk")!
  const before = loadProgress(JSON.stringify({ unlocked: 4, best: {} }))
  const cleared = clearBonus(before, hotdesk, { score: 7000, solo: true })
  assert.equal(sprintUnlocked(cleared, 4), false)
  assert.equal(sprintsCleared(cleared), 3)
  assert.equal(bestScore(cleared, "hotdesk"), 7000)
  const together = clearBonus(cleared, hotdesk, { score: 90000, solo: false })
  assert.equal(bestScore(together, "hotdesk"), 7000)
  assert.equal(sprintsCleared(together), 3)
})

test("a bonus level cleared in hardcore gets a badge, solo or together, and still unlocks nothing", () => {
  const hotdesk = bonusLevels.find((level) => level.id === "hotdesk")!
  const before = loadProgress(JSON.stringify({ unlocked: 4, best: {} }))
  assert.equal(hardcoreBadge(clearBonus(before, hotdesk, { score: 7000, solo: true }), "hotdesk"), false)
  const together = clearBonus(before, hotdesk, { score: 90000, solo: false, hardcore: true })
  assert.equal(hardcoreBadge(together, "hotdesk"), true)
  assert.equal(bestScore(together, "hotdesk"), undefined)
  assert.equal(sprintsCleared(together), 3)
  const solo = clearBonus(before, hotdesk, { score: 7000, solo: true, hardcore: true })
  assert.equal(bestScore(solo, "hotdesk"), 7000)
  assert.equal(hardcoreBadge(loadProgress(saveProgress(solo)), "hotdesk"), true)
})
