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
