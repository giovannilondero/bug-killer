import assert from "node:assert/strict"
import { test } from "node:test"

import { bestScore, clearSprint, emptyProgress, endEndless, loadProgress, unlockEverySprint, saveProgress, sprintsCleared, sprintUnlocked } from "../src/progress.ts"

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
