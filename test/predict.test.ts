import assert from "node:assert/strict"
import { test } from "node:test"

import { levels } from "../src/content/levels.ts"
import { makePrediction } from "../src/host/predict.ts"
import type { ServerMessage } from "../src/net/protocol.ts"
import { makeRooms } from "../src/server/rooms.ts"
import { idleInput } from "../src/sim/simulation.ts"
import type { InputValue, Vec } from "../src/sim/schema.ts"

const level = levels[0]!
const STEP_MS = 1000 / 60

type Frame = Extract<ServerMessage, { t: "frame" }>

/** What the developer does on step `i`: right, a dash, then up and left on a diagonal, then still. */
const script = (i: number): InputValue => ({
  ...idleInput,
  move: i < 40 ? { x: 1, y: 0 } : i < 80 ? { x: -0.7, y: -0.7 } : { x: 0, y: 0 },
  dash: i === 25 || i === 60
})

/**
 * One browser and the run server, `latency` steps apart each way: the
 * browser predicts, sends two steps to a message as `main.ts` does, and
 * confirms every frame that reaches it.
 */
const play = (latency: number, steps: number) => {
  const rooms = makeRooms({ random: () => 0.5 })
  const toBrowser: Array<{ at: number; frame: Frame }> = []
  let now = 0
  const peer = { send: (message: ServerMessage) => message.t === "frame" && toBrowser.push({ at: now + latency, frame: message }) }
  rooms.receive(peer, JSON.stringify({ t: "create", name: "Ada", level: level.id, locale: "en" }))
  rooms.receive(peer, JSON.stringify({ t: "start" }))

  const prediction = makePrediction()
  prediction.reset(level)
  const toServer: Array<{ at: number; message: string }> = []
  let unsent: Array<InputValue> = []
  /** Where the screen drew the developer right after each numbered step of input. */
  const drawnAfter = new Map<number, Vec>()
  /** For every frame: the step it confirmed, and where the server had the developer. */
  const confirmed: Array<{ ack: number; server: Vec }> = []

  for (now = 0; now < steps; now++) {
    for (const { message } of toServer.filter((m) => m.at === now)) rooms.receive(peer, message)
    rooms.advance(1 / 60)
    for (const { frame } of toBrowser.filter((m) => m.at === now)) {
      const developer = frame.view.players.find((p) => p.slot === 0)
      prediction.confirm(developer, frame.view.run.phase, frame.ack)
      if (developer && frame.ack >= 0) confirmed.push({ ack: frame.ack, server: developer.position })
    }
    const input = script(now)
    const seq = prediction.record(input)
    unsent.push(input)
    // Before the first frame there is nothing to predict from.
    const drawn = prediction.draw(now * STEP_MS)
    if (drawn) drawnAfter.set(seq, drawn.position)
    if (unsent.length === 2) {
      toServer.push({ at: now + latency, message: JSON.stringify({ t: "input", inputs: unsent, seq }) })
      unsent = []
    }
  }
  return { drawnAfter, confirmed }
}

test("the server puts the developer exactly where this browser predicted, step by step", () => {
  const { drawnAfter, confirmed } = play(5, 120)
  assert.ok(confirmed.length > 40, `${confirmed.length} frames confirmed`)
  for (const { ack, server } of confirmed) {
    const drawn = drawnAfter.get(ack)
    if (!drawn) continue
    assert.ok(Math.hypot(drawn.x - server.x, drawn.y - server.y) < 1e-9, `step ${ack}: drawn at ${drawn.x},${drawn.y}, the server says ${server.x},${server.y}`)
  }
})

test("when the server disagrees, the developer glides to it instead of jumping", () => {
  const rooms = makeRooms({ random: () => 0.5 })
  let frame: Frame | null = null
  const peer = { send: (message: ServerMessage) => message.t === "frame" && (frame = message) }
  rooms.receive(peer, JSON.stringify({ t: "create", name: "Ada", level: level.id, locale: "en" }))
  rooms.receive(peer, JSON.stringify({ t: "start" }))
  assert.ok(frame)
  const { view } = frame as Frame
  const developer = view.players[0]!
  const prediction = makePrediction()
  prediction.reset(level)
  prediction.confirm(developer, view.run.phase, -1)
  const before = prediction.draw(0)!.position
  // A bug knocks the developer 30 pixels sideways.
  prediction.confirm({ ...developer, position: { x: developer.position.x + 30, y: developer.position.y } }, view.run.phase, -1)
  assert.deepEqual(prediction.draw(0)!.position, before, "no jump on the frame itself")
  const soon = prediction.draw(50)!.position.x - before.x
  const later = prediction.draw(300)!.position.x - before.x
  assert.ok(soon > 10 && soon < 30, `${soon.toFixed(1)} px of 30 after 50 ms`)
  assert.ok(later > 29.9, `${later.toFixed(1)} px of 30 after 300 ms`)
  // Further than a nudge is a teleport: straight there.
  prediction.confirm({ ...developer, position: { x: developer.position.x + 400, y: developer.position.y } }, view.run.phase, -1)
  assert.equal(prediction.draw(300)!.position.x, developer.position.x + 400)
})
