import assert from "node:assert/strict"
import { test } from "node:test"

import { isLocale } from "../src/content/i18n.ts"
import { readClientMessage } from "../src/net/protocol.ts"
import { isLevelId } from "../src/server/rooms.ts"

const read = (message: object) => readClientMessage(JSON.stringify(message), isLevelId, isLocale)

test("hardcore reads the same in a new run and at the start: kept when sent, left out when not", () => {
  assert.deepEqual(read({ t: "create", name: "Ada", level: "glacier", locale: "en" }), { t: "create", name: "Ada", level: "glacier", locale: "en" })
  assert.deepEqual(read({ t: "start" }), { t: "start" })
  for (const hardcore of [true, false]) {
    assert.equal((read({ t: "create", name: "Ada", level: "glacier", locale: "en", hardcore }) as { hardcore?: boolean }).hardcore, hardcore)
    assert.equal((read({ t: "start", hardcore }) as { hardcore?: boolean }).hardcore, hardcore)
  }
  assert.equal(read({ t: "create", name: "Ada", level: "glacier", locale: "en", hardcore: "yes" }), null)
  assert.equal(read({ t: "start", hardcore: "yes" }), null)
})

test("inputs come numbered, a few steps at a time; a page from before numbering still sends one", () => {
  const input = { move: { x: 1, y: 0 }, aim: { x: 5, y: 5 }, fire: true, dash: false, bomb: false, breakpoint: false }
  assert.deepEqual(read({ t: "input", inputs: [input, input], seq: 7 }), { t: "input", inputs: [input, input], seq: 7 })
  assert.deepEqual(read({ t: "input", input }), { t: "input", inputs: [input] })
  assert.equal(read({ t: "input", inputs: [], seq: 1 }), null)
  assert.equal(read({ t: "input", inputs: Array(9).fill(input), seq: 9 }), null)
  assert.equal(read({ t: "input", inputs: [input], seq: 1.5 }), null)
  assert.equal(read({ t: "input", inputs: [input, input], seq: 0 }), null, "two inputs need room for two numbers")
  assert.equal(read({ t: "input", inputs: [input, "nope"], seq: 3 }), null)
  assert.equal(read({ t: "input", inputs: [input] }), null)
})
