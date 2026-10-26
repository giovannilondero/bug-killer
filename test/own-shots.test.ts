import assert from "node:assert/strict"
import { test } from "node:test"

import { makeEntityId } from "@typeonce/ritmo/Entity"

import { arenaOf } from "../src/content/arenas.ts"
import { levels } from "../src/content/levels.ts"
import { makeOwnShots } from "../src/host/own-shots.ts"
import type { OwnBullet } from "../src/host/predict.ts"
import type { ServerMessage } from "../src/net/protocol.ts"
import { makeRooms } from "../src/server/rooms.ts"
import type { View } from "../src/sim/simulation.ts"

const level = levels[0]!
const arena = arenaOf(level)

/** A real view of a run a few seconds in, with at least one bug on the floor. */
const aView = (): View => {
  const rooms = makeRooms({ random: () => 0.5 })
  let frame: Extract<ServerMessage, { t: "frame" }> | null = null
  const peer = { send: (message: ServerMessage) => message.t === "frame" && (frame = message) }
  rooms.receive(peer, JSON.stringify({ t: "create", name: "Ada", level: level.id, locale: "en" }))
  rooms.receive(peer, JSON.stringify({ t: "start" }))
  for (let i = 0; i < 600 && !(frame as Extract<ServerMessage, { t: "frame" }> | null)?.view.bugs.length; i++) rooms.advance(1 / 60)
  assert.ok(frame)
  const { view } = frame as Extract<ServerMessage, { t: "frame" }>
  assert.ok(view.bugs.length > 0)
  return { ...view, level }
}

/** The view with no shots in it but `shots`, and no bugs unless asked. */
const withShots = (view: View, shots: View["shots"], bugs: View["bugs"] = []): View => ({ ...view, shots, bugs, bosses: [] })

type Shot = View["shots"][number]
const shot = (id: number, position: { x: number; y: number }, velocity: { x: number; y: number }, owner: number): Shot => {
  const entity: Shot["id"] = makeEntityId(id)
  return { id: entity, position, velocity, homing: false, owner }
}

const bullet = (at: { x: number; y: number }, pierce = 0): OwnBullet => ({ at, velocity: { x: 820, y: 0 }, life: 0.85, homing: false, pierce })

test("a bullet fired here leaves the barrel at once and flies on this screen's clock", () => {
  const view = aView()
  const own = makeOwnShots()
  own.fire([bullet({ x: 300, y: 400 })], 1000)
  const [now] = own.draw(withShots(view, []), 0, arena, 1000)
  assert.deepEqual(now?.position, { x: 300, y: 400 })
  const [later] = own.draw(withShots(view, []), 0, arena, 1100)
  assert.ok(Math.abs(later!.position.x - 382) < 1e-9, `at ${later!.position.x}`)
})

test("when the server's bullet arrives it takes over where this one was, and stays as far ahead", () => {
  const view = aView()
  const own = makeOwnShots()
  own.fire([bullet({ x: 300, y: 400 })], 1000)
  // The frames show the server's bullet 150 ms behind, just fired from the same barrel.
  const server = shot(7, { x: 300, y: 400 }, { x: 820, y: 0 }, 0)
  const handed = own.draw(withShots(view, [server]), 0, arena, 1150)
  assert.equal(handed.length, 1, "one bullet, not two")
  assert.ok(Math.abs(handed[0]!.position.x - (300 + 820 * 0.15)) < 1e-9, `drawn at ${handed[0]!.position.x}`)
  const on = own.draw(withShots(view, [{ ...server, position: { x: 341, y: 400 } }]), 0, arena, 1200)
  assert.ok(Math.abs(on[0]!.position.x - (341 + 820 * 0.15)) < 1e-9, "the same lead as the frames move on")
})

test("other developers' bullets are drawn as the frames have them", () => {
  const view = aView()
  const own = makeOwnShots()
  const theirs = shot(7, { x: 10, y: 20 }, { x: 0, y: 820 }, 1)
  assert.deepEqual(own.draw(withShots(view, [theirs]), 0, arena, 0), [theirs])
})

test("on screen a bullet stops at the first bug it touches, unless Refactor lets it through", () => {
  const view = aView()
  const bug = view.bugs[0]!
  const own = makeOwnShots()
  const start = { x: bug.position.x - bug.radius - 100, y: bug.position.y }
  own.fire([bullet(start), bullet({ x: start.x, y: start.y }, 1)], 0)
  const bugs = [bug]
  assert.equal(own.draw(withShots(view, [], bugs), 0, arena, 0).length, 2)
  // 150 ms later both have reached the bug: the plain one stops, the piercing one goes on.
  const after = own.draw(withShots(view, [], bugs), 0, arena, 150)
  assert.equal(after.length, 1)
  assert.equal(own.draw(withShots(view, [], bugs), 0, arena, 300).length, 1, "and the stopped one stays stopped")
})

test("a bullet the server never fires fades once it should have shown up", () => {
  const view = aView()
  const own = makeOwnShots()
  own.fire([bullet({ x: 300, y: 200 })], 0)
  assert.equal(own.draw(withShots(view, []), 0, arena, 500).length, 1)
  assert.equal(own.draw(withShots(view, []), 0, arena, 700).length, 0)
})
