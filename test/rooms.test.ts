import assert from "node:assert/strict"
import { test } from "node:test"

import { arenas } from "../src/content/arenas.ts"
import type { ServerMessage } from "../src/net/protocol.ts"
import { makeRooms } from "../src/server/rooms.ts"
import type { Peer } from "../src/server/rooms.ts"

/** A browser that keeps everything the server sent it. */
const browser = (address?: string) => {
  const inbox: Array<ServerMessage> = []
  const peer: Peer = { send: (message) => inbox.push(message), ...(address === undefined ? {} : { address }) }
  const last = <T extends ServerMessage["t"]>(t: T) => [...inbox].reverse().find((m): m is Extract<ServerMessage, { t: T }> => m.t === t)
  return { peer, inbox, last }
}

const seeded = () => {
  let s = 1
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

const send = (rooms: ReturnType<typeof makeRooms>, who: { peer: Peer }, message: object) => rooms.receive(who.peer, JSON.stringify(message))

test("a run is created with a code, and teammates join it with their own names", () => {
  const rooms = makeRooms({ random: seeded() })
  const ada = browser()
  const bob = browser()
  send(rooms, ada, { t: "create", name: "  Ada   Lovelace ", level: "glacier", locale: "it" })
  const created = ada.last("room")
  assert.ok(created)
  assert.match(created.room.code, /^RUN-\d{4}$/)
  assert.equal(created.you, 0)
  assert.equal(created.room.members[0]?.name, "Ada Lovelace")

  send(rooms, bob, { t: "join", code: created.room.code.toLowerCase(), name: "Bob" })
  const joined = bob.last("room")
  assert.equal(joined?.you, 1)
  assert.deepEqual(ada.last("room")?.room.members.map((m) => m.name), ["Ada Lovelace", "Bob"])
})

test("names are checked: empty or already taken in the run is refused", () => {
  const rooms = makeRooms({ random: seeded() })
  const ada = browser()
  send(rooms, ada, { t: "create", name: "Ada", level: "glacier", locale: "it" })
  const code = ada.last("room")!.room.code
  const twin = browser()
  send(rooms, twin, { t: "join", code, name: "ada" })
  assert.equal(twin.last("error")?.code, "nameTaken")
  const blank = browser()
  send(rooms, blank, { t: "join", code, name: " \u0000 " })
  assert.equal(blank.last("error")?.code, "badName")
  const lost = browser()
  send(rooms, lost, { t: "join", code: code === "RUN-1234" ? "RUN-4321" : "RUN-1234", name: "Lost" })
  assert.equal(lost.last("error")?.code, "notFound")
})

test("only the host starts; then everyone gets frames and drives their own developer", () => {
  const rooms = makeRooms({ random: seeded() })
  const ada = browser()
  const bob = browser()
  send(rooms, ada, { t: "create", name: "Ada", level: "glacier", locale: "en" })
  const code = ada.last("room")!.room.code
  send(rooms, bob, { t: "join", code, name: "Bob" })
  send(rooms, bob, { t: "start" })
  assert.equal(bob.last("error")?.code, "notHost")

  send(rooms, ada, { t: "start" })
  assert.equal(bob.last("started")?.you, 1)
  assert.equal(rooms.room(code)?.state, "playing")
  const first = bob.last("frame")!.view
  const before = first.players.find((p) => p.slot === 1)!.position
  const adaStart = first.players.find((p) => p.slot === 0)!.position

  for (let i = 0; i < 60; i++) {
    send(rooms, bob, { t: "input", input: { move: { x: 1, y: 0 }, aim: { x: 0, y: 0 }, fire: false, dash: false, bomb: false } })
    rooms.advance(1 / 60)
  }
  const frame = bob.last("frame")!
  const after = frame.view.players.find((p) => p.slot === 1)!.position
  const adaNow = frame.view.players.find((p) => p.slot === 0)!.position
  assert.ok(after.x > before.x + 150, `Bob moved from ${before.x} to ${after.x}`)
  assert.equal(adaNow.x, adaStart.x, "Ada sent nothing, and stayed put")
  assert.ok(!("level" in frame.view), "the level travels as its id, not in every frame")
})

test("bad input is bounded, not trusted", () => {
  const rooms = makeRooms({ random: seeded() })
  const ada = browser()
  send(rooms, ada, { t: "create", name: "Ada", level: "glacier", locale: "en" })
  send(rooms, ada, { t: "start" })
  const start = ada.last("frame")!.view.players[0]!.position
  for (let i = 0; i < 30; i++) {
    send(rooms, ada, { t: "input", input: { move: { x: 1e9, y: "x" }, aim: null, fire: "yes", dash: 1, bomb: false } })
    rooms.advance(1 / 60)
  }
  const now = ada.last("frame")!.view.players[0]!.position
  assert.ok(now.x - start.x < 300, `moved ${now.x - start.x} in half a second`)
  rooms.receive(ada.peer, "{not json")
  rooms.receive(ada.peer, JSON.stringify({ t: "start", level: "../etc/passwd" }))
})

test("whoever drops mid-run keeps their seat and gets it back with the same name", () => {
  const rooms = makeRooms({ random: seeded() })
  const ada = browser()
  const bob = browser()
  send(rooms, ada, { t: "create", name: "Ada", level: "glacier", locale: "en" })
  const code = ada.last("room")!.room.code
  send(rooms, bob, { t: "join", code, name: "Bob" })
  send(rooms, ada, { t: "start" })
  rooms.leave(bob.peer)
  assert.equal(ada.last("room")?.room.members.find((m) => m.name === "Bob")?.connected, false)

  const stranger = browser()
  send(rooms, stranger, { t: "join", code, name: "Carla" })
  assert.equal(stranger.last("error")?.code, "started")

  const back = browser()
  send(rooms, back, { t: "join", code, name: "Bob" })
  assert.equal(back.last("started")?.you, 1)
  assert.equal(ada.last("room")?.room.members.find((m) => m.name === "Bob")?.connected, true)
})

test("the host leaving hands the run to the next teammate; an empty lobby closes", () => {
  const rooms = makeRooms({ random: seeded() })
  const ada = browser()
  const bob = browser()
  send(rooms, ada, { t: "create", name: "Ada", level: "glacier", locale: "en" })
  const code = ada.last("room")!.room.code
  send(rooms, bob, { t: "join", code, name: "Bob" })
  send(rooms, ada, { t: "leave" })
  assert.equal(bob.last("room")?.room.host, 1)
  send(rooms, bob, { t: "leave" })
  assert.equal(rooms.count(), 0)
})

test("four seats at most", () => {
  const rooms = makeRooms({ random: seeded() })
  const host = browser()
  send(rooms, host, { t: "create", name: "Dev0", level: "glacier", locale: "en" })
  const code = host.last("room")!.room.code
  for (const name of ["Dev1", "Dev2", "Dev3"]) send(rooms, browser(), { t: "join", code, name })
  const fifth = browser()
  send(rooms, fifth, { t: "join", code, name: "Dev4" })
  assert.equal(fifth.last("error")?.code, "full")
})

test("past the most runs the server holds, a new one is refused until one closes", () => {
  const rooms = makeRooms({ random: seeded(), maxRooms: 2 })
  const ada = browser()
  const bob = browser()
  send(rooms, ada, { t: "create", name: "Ada", level: "glacier", locale: "en" })
  send(rooms, bob, { t: "create", name: "Bob", level: "glacier", locale: "en" })
  const late = browser()
  send(rooms, late, { t: "create", name: "Late", level: "glacier", locale: "en" })
  assert.equal(late.last("error")?.code, "busy")
  assert.equal(rooms.count(), 2)
  // Joining a run that exists is still fine.
  send(rooms, late, { t: "join", code: ada.last("room")!.room.code, name: "Late" })
  assert.equal(late.last("room")?.room.members.length, 2)
  send(rooms, bob, { t: "leave" })
  const later = browser()
  send(rooms, later, { t: "create", name: "Later", level: "glacier", locale: "en" })
  assert.ok(later.last("room"))
})

test("one address holds only a couple of runs; others are not affected", () => {
  const rooms = makeRooms({ random: seeded(), maxRoomsPerAddress: 2 })
  for (const name of ["A", "B"]) send(rooms, browser("203.0.113.7"), { t: "create", name, level: "glacier", locale: "en" })
  const third = browser("203.0.113.7")
  send(rooms, third, { t: "create", name: "C", level: "glacier", locale: "en" })
  assert.equal(third.last("error")?.code, "busy")
  const elsewhere = browser("198.51.100.1")
  send(rooms, elsewhere, { t: "create", name: "D", level: "glacier", locale: "en" })
  assert.ok(elsewhere.last("room"))
})

test("when the run ends the room goes back to the lobby, and the host starts the next one", () => {
  const rooms = makeRooms({ random: seeded() })
  const ada = browser()
  send(rooms, ada, { t: "create", name: "Ada", level: "glacier", locale: "en" })
  send(rooms, ada, { t: "start" })
  // Standing still, the developer burns out within a minute or so.
  for (let i = 0; i < 60 * 120 && ada.last("frame")!.view.run.phase !== "dead"; i++) rooms.advance(1 / 60)
  assert.equal(ada.last("frame")!.view.run.phase, "dead")
  assert.equal(ada.last("room")?.room.state, "lobby")
  send(rooms, ada, { t: "start", level: "sidequests" })
  assert.equal(ada.last("started")?.level, "sidequests")
  assert.equal(ada.last("frame")!.view.run.phase, "waves")
})

test("the host sets hardcore in the lobby, and it reaches every teammate's run", () => {
  const rooms = makeRooms({ random: seeded() })
  const ada = browser()
  const bob = browser()
  send(rooms, ada, { t: "create", name: "Ada", level: "glacier", locale: "en", hardcore: true })
  const code = ada.last("room")!.room.code
  send(rooms, bob, { t: "join", code, name: "Bob" })
  assert.equal(bob.last("room")?.room.hardcore, true, "teammates see it in the lobby")
  send(rooms, ada, { t: "start" })
  for (const who of [ada, bob]) {
    const view = who.last("frame")!.view
    assert.equal(view.hardcore, true)
    assert.deepEqual(view.players.map((p) => p.maxHp), [1, 1])
  }

  // Back in the lobby the host may turn it off for the next run; a teammate cannot.
  for (let i = 0; i < 60 * 120 && ada.last("frame")!.view.run.phase !== "dead"; i++) rooms.advance(1 / 60)
  assert.equal(ada.last("room")?.room.state, "lobby")
  send(rooms, bob, { t: "start", hardcore: false })
  assert.equal(bob.last("error")?.code, "notHost")
  send(rooms, ada, { t: "start", hardcore: false })
  assert.equal(bob.last("room")?.room.hardcore, false)
  assert.equal(bob.last("frame")!.view.hardcore, false)
  assert.deepEqual(bob.last("frame")!.view.players.map((p) => p.maxHp), [6, 6])
})

test("a run is not hardcore unless the host says so, and only a real true counts", () => {
  const rooms = makeRooms({ random: seeded() })
  const ada = browser()
  send(rooms, ada, { t: "create", name: "Ada", level: "glacier", locale: "en" })
  assert.equal(ada.last("room")?.room.hardcore, false)
  const cara = browser()
  send(rooms, cara, { t: "create", name: "Cara", level: "glacier", locale: "en", hardcore: "yes" })
  assert.equal(cara.last("room"), undefined, "a malformed flag is refused")
  send(rooms, ada, { t: "start", hardcore: 1 })
  assert.equal(ada.last("started"), undefined, "a malformed flag is refused")
})

test("the host can pick a bonus level in the lobby, and everyone plays it", () => {
  const rooms = makeRooms({ random: seeded() })
  const ada = browser()
  const bob = browser()
  send(rooms, ada, { t: "create", name: "Ada", level: "glacier", locale: "en" })
  send(rooms, bob, { t: "join", code: ada.last("room")!.room.code, name: "Bob" })
  send(rooms, ada, { t: "start", level: "hotdesk" })
  assert.equal(ada.last("started")?.level, "hotdesk")
  assert.equal(bob.last("started")?.level, "hotdesk")
  assert.equal(bob.last("room")?.room.level, "hotdesk")
  rooms.advance(1 / 30)
  const players = bob.last("frame")!.view.players
  assert.equal(players.length, 2)
  // The team starts near the middle of the small arena, not of the normal one.
  for (const p of players) {
    assert.ok(Math.abs(p.position.x - arenas.small.width / 2) < 200 && Math.abs(p.position.y - arenas.small.height / 2) < 200, JSON.stringify(p.position))
  }
})

test("the host picks Endless's arena, and the whole team plays in it", () => {
  const rooms = makeRooms({ random: seeded() })
  const ada = browser()
  const bob = browser()
  send(rooms, ada, { t: "create", name: "Ada", level: "endless", locale: "en", arena: "small" })
  const code = ada.last("room")!.room.code
  send(rooms, bob, { t: "join", code, name: "Bob" })
  assert.equal(bob.last("room")?.room.arena, "small", "teammates see it in the lobby")
  send(rooms, bob, { t: "start", arena: "normal" })
  assert.equal(bob.last("error")?.code, "notHost", "a teammate cannot pick it")
  send(rooms, ada, { t: "start" })
  for (const who of [ada, bob]) assert.equal(who.last("started")?.arena, "small")
  rooms.advance(1 / 30)
  for (const p of bob.last("frame")!.view.players) {
    assert.ok(Math.abs(p.position.x - arenas.small.width / 2) < 200 && Math.abs(p.position.y - arenas.small.height / 2) < 200, JSON.stringify(p.position))
  }
})

test("an arena Endless doesn't offer is refused, and a sprint is always played in its own", () => {
  const rooms = makeRooms({ random: seeded() })
  const cara = browser()
  send(rooms, cara, { t: "create", name: "Cara", level: "endless", locale: "en", arena: "moon" })
  assert.equal(cara.last("room"), undefined, "an unknown arena is refused")
  const ada = browser()
  send(rooms, ada, { t: "create", name: "Ada", level: "glacier", locale: "en" })
  assert.equal(ada.last("room")?.room.arena, "normal", "the normal arena unless the host says otherwise")
  send(rooms, ada, { t: "start", arena: 3 })
  assert.equal(ada.last("started"), undefined, "a malformed arena is refused")
  send(rooms, ada, { t: "start", arena: "small" })
  rooms.advance(1 / 30)
  // Glacier keeps the normal floor: the team starts in its middle.
  const [p] = ada.last("frame")!.view.players
  assert.ok(Math.abs(p!.position.x - arenas.normal.width / 2) < 200, JSON.stringify(p!.position))
})
