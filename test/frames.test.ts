import assert from "node:assert/strict"
import { test } from "node:test"

import { levels } from "../src/content/levels.ts"
import { makeFrames } from "../src/host/net.ts"
import type { NetView, ServerMessage } from "../src/net/protocol.ts"
import { makeRooms } from "../src/server/rooms.ts"
import { DT } from "../src/sim/constants.ts"

const level = levels[0]!
const STEP_MS = DT * 1000
const SAMPLE_MS = 1000 / 60

/** A real frame from a run, to move its developer around in. */
const aFrame = (): NetView => {
  const rooms = makeRooms({ random: () => 0.5 })
  let view: NetView | null = null
  const peer = { send: (message: ServerMessage) => message.t === "frame" && (view = message.view) }
  rooms.receive(peer, JSON.stringify({ t: "create", name: "Ada", level: level.id, locale: "en" }))
  rooms.receive(peer, JSON.stringify({ t: "start" }))
  assert.ok(view)
  return view
}

/** The developer walks one pixel per millisecond of server time: where they are drawn says which moment the screen shows. */
const at = (frame: NetView, ms: number): NetView => ({ ...frame, players: frame.players.map((p) => ({ ...p, position: { x: ms, y: 0 } })) })

const seeded = () => {
  let s = 7
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

/**
 * Plays `seconds` of frames, every other server step, arriving `latency` ms
 * later plus whatever `late` adds; samples the screen at 60 Hz and returns
 * where the developer was drawn at each, with when.
 */
const play = (seconds: number, latency: number, late: (frame: number) => number) => {
  const frame = aFrame()
  const frames = makeFrames()
  const arrivals: Array<{ at: number; step: number }> = []
  for (let step = 0; step * STEP_MS < seconds * 1000; step += 2) arrivals.push({ at: step * STEP_MS + latency + late(step / 2), step })
  // TCP keeps the order: a late frame holds back the ones behind it.
  for (let i = 1; i < arrivals.length; i++) arrivals[i]!.at = Math.max(arrivals[i]!.at, arrivals[i - 1]!.at)
  const drawn: Array<{ now: number; x: number }> = []
  let next = 0
  for (let now = latency; now < seconds * 1000; now += SAMPLE_MS) {
    while (next < arrivals.length && arrivals[next]!.at <= now) {
      const { at: arrived, step } = arrivals[next]!
      frames.push(at(frame, step * STEP_MS), step, arrived)
      next += 1
    }
    const view = frames.sample(level, 0, now)
    if (view?.player) drawn.push({ now, x: view.player.position.x })
  }
  return drawn
}

test("on a steady network the screen draws about one frame behind the newest", () => {
  const random = seeded()
  const drawn = play(5, 60, () => random() * 6)
  const settled = drawn.filter((d) => d.now > 2000)
  for (const { now, x } of settled) {
    const behind = now - 60 - x
    assert.ok(behind > 30 && behind < 50, `drawn ${behind.toFixed(1)} ms behind the server at ${now.toFixed(0)}`)
  }
})

test("a late frame now and then neither freezes the screen nor makes it jump", () => {
  const random = seeded()
  // As measured on the production server: most frames within a few ms, about one in sixty some 50 ms late.
  const drawn = play(10, 60, (frame) => (frame % 60 === 30 ? 50 : random() * 8))
  const settled = drawn.filter((d) => d.now > 3000)
  for (let i = 1; i < settled.length; i++) {
    const advance = settled[i]!.x - settled[i - 1]!.x
    assert.ok(advance > SAMPLE_MS * 0.85 && advance < SAMPLE_MS * 1.15, `moved ${advance.toFixed(1)} ms of server time in one screen frame at ${settled[i]!.now.toFixed(0)}`)
  }
})

test("a new run's clock starts over, and the buffer with it", () => {
  const frame = aFrame()
  const frames = makeFrames()
  for (let step = 0; step <= 600; step += 2) frames.push(at(frame, step * STEP_MS), step, step * STEP_MS + 60)
  frames.sample(level, 0, 600 * STEP_MS + 60)
  for (let step = 0; step <= 60; step += 2) frames.push(at(frame, step * STEP_MS + 1e6), step, 20000 + step * STEP_MS)
  const view = frames.sample(level, 0, 20000 + 60 * STEP_MS)
  assert.ok(view?.player && view.player.position.x > 1e6, "drawn from the new run")
})
