/**
 * The run server's rooms, without the network: who is in which run, the
 * lobby, and the simulation each running room steps. The WebSocket layer
 * (`socket.ts`) feeds it messages and a clock; tests drive it directly.
 */
import { isLocale } from "../content/i18n.ts"
import type { Locale } from "../content/i18n.ts"
import { bonusLevels, endlessLevel, levelIds, levels } from "../content/levels.ts"
import type { Level, LevelId } from "../content/levels.ts"
import { cleanName, readClientMessage } from "../net/protocol.ts"
import type { ErrorCode, Member, RoomInfo, ServerMessage } from "../net/protocol.ts"
import { DT, PARTY } from "../sim/constants.ts"
import type { ChatValue, FxValue, InputValue } from "../sim/schema.ts"
import { createSimulation, idleInput } from "../sim/simulation.ts"

type Simulation = Extract<ReturnType<typeof createSimulation>, { ok: true }>["value"]

/** Frames go out every other step: 30 a second. */
const STEPS_PER_FRAME = 2
/** A running room nobody is connected to waits this long for someone to come back. */
const EMPTY_GRACE_SECONDS = 60
const MAX_STEPS_PER_ADVANCE = 5
/** Every run steps in one thread: past a handful, they would all lag together. */
export const MAX_ROOMS = 10
/** So that one address cannot hold every run, while an office still fits two teams. */
export const MAX_ROOMS_PER_ADDRESS = 2

const playable: ReadonlyArray<Level> = [...levels, endlessLevel, ...bonusLevels]
export const isLevelId = (id: unknown): id is LevelId => (levelIds as ReadonlyArray<unknown>).includes(id)
const levelOf = (id: LevelId): Level => playable.find((level) => level.id === id) ?? endlessLevel

/** One browser connection, as the rooms see it. */
export interface Peer {
  readonly send: (message: ServerMessage) => void
  /** Where the browser connects from, when the server knows it; without it only `maxRooms` applies. */
  readonly address?: string
}

interface Seat {
  slot: number
  name: string
  peer: Peer | null
}

interface Room {
  readonly code: string
  level: LevelId
  locale: Locale
  host: number
  seats: Array<Seat>
  sim: Simulation | null
  /** Each seat's latest input; a dash or bomb is kept until a step uses it. */
  inputs: Array<InputValue>
  fx: Array<FxValue>
  chat: Array<ChatValue>
  pending: number
  steps: number
  emptyFor: number
}

export interface RoomsOptions {
  /** Defaults to `Math.random`; tests pass a seeded one. */
  readonly random?: () => number
  /** Defaults to `MAX_ROOMS`. */
  readonly maxRooms?: number
  /** Defaults to `MAX_ROOMS_PER_ADDRESS`. */
  readonly maxRoomsPerAddress?: number
}

export const makeRooms = (options: RoomsOptions = {}) => {
  const random = options.random ?? Math.random
  const maxRooms = options.maxRooms ?? MAX_ROOMS
  const maxRoomsPerAddress = options.maxRoomsPerAddress ?? MAX_ROOMS_PER_ADDRESS
  const rooms = new Map<string, Room>()
  const where = new Map<Peer, { room: Room; slot: number }>()

  const info = (room: Room): RoomInfo => ({
    code: room.code,
    state: room.sim && !over(room) ? "playing" : "lobby",
    level: room.level,
    host: room.host,
    members: room.seats.map((seat): Member => ({ slot: seat.slot, name: seat.name, color: colorOf(seat.slot), connected: seat.peer !== null }))
  })

  const colorOf = (slot: number) => PARTY.colors[slot % PARTY.colors.length] ?? PARTY.colors[0]

  const over = (room: Room) => {
    const phase = room.sim?.view().run.phase
    return phase === "dead" || phase === "cleared"
  }

  const broadcast = (room: Room, message: (seat: Seat) => ServerMessage) => {
    for (const seat of room.seats) seat.peer?.send(message(seat))
  }

  const announce = (room: Room) => {
    const shared = info(room)
    broadcast(room, (seat) => ({ t: "room", room: shared, you: seat.slot }))
  }

  const fail = (peer: Peer, code: ErrorCode) => peer.send({ t: "error", code })

  const newCode = (): string => {
    for (;;) {
      const code = `RUN-${String(Math.floor(random() * 10000)).padStart(4, "0")}`
      if (!rooms.has(code)) return code
    }
  }

  const freeSlot = (room: Room): number | null => {
    for (let slot = 0; slot < PARTY.maxPlayers; slot++) {
      if (!room.seats.some((seat) => seat.slot === slot)) return slot
    }
    return null
  }

  /** Rooms where someone connected from `address` is seated. */
  const roomsFrom = (address: string) => {
    let count = 0
    for (const room of rooms.values()) if (room.seats.some((seat) => seat.peer?.address === address)) count += 1
    return count
  }

  const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "accent" }) === 0

  const seatPeer = (room: Room, seat: Seat, peer: Peer) => {
    seat.peer = peer
    where.set(peer, { room, slot: seat.slot })
  }

  const leave = (peer: Peer) => {
    const at = where.get(peer)
    if (!at) return
    where.delete(peer)
    const { room } = at
    const seat = room.seats.find((s) => s.slot === at.slot)
    if (!seat) return
    if (room.sim && !over(room)) {
      // Mid-run the seat stays: the developer stands still until they come back.
      seat.peer = null
      room.inputs[seat.slot] = { ...idleInput, aim: room.inputs[seat.slot]?.aim ?? idleInput.aim }
    } else {
      room.seats = room.seats.filter((s) => s !== seat)
    }
    const connected = room.seats.filter((s) => s.peer !== null)
    if (connected.length === 0 && !(room.sim && !over(room))) {
      rooms.delete(room.code)
      return
    }
    if (room.host === seat.slot) {
      room.host = (connected[0] ?? room.seats[0])?.slot ?? 0
    }
    announce(room)
  }

  const start = (room: Room, level: LevelId) => {
    // Whoever left between runs does not get a seat in the next one.
    room.seats = room.seats.filter((seat) => seat.peer !== null)
    room.level = level
    const party = room.seats.map((seat) => ({ slot: seat.slot, name: seat.name, color: colorOf(seat.slot) }))
    room.inputs = []
    for (const seat of room.seats) room.inputs[seat.slot] = idleInput
    room.fx = []
    room.chat = []
    const made = createSimulation({
      level: levelOf(level),
      seed: Math.floor(random() * 2 ** 31),
      locale: room.locale,
      party,
      inputs: { snapshot: () => room.inputs.map((input) => input ?? idleInput) },
      presentation: { fx: (event) => room.fx.push(event), chat: (event) => room.chat.push(event) }
    })
    if (!made.ok) {
      room.sim = null
      return
    }
    room.sim = made.value
    room.pending = 0
    room.steps = 0
    broadcast(room, (seat) => ({ t: "started", level, locale: room.locale, you: seat.slot }))
    announce(room)
    sendFrame(room)
  }

  const sendFrame = (room: Room) => {
    if (!room.sim) return
    const { level: _level, ...view } = room.sim.view()
    const fx = room.fx
    const chat = room.chat
    room.fx = []
    room.chat = []
    broadcast(room, () => ({ t: "frame", view, fx, chat }))
  }

  const receive = (peer: Peer, raw: string) => {
    const message = readClientMessage(raw, isLevelId, isLocale)
    if (!message) return
    const at = where.get(peer)
    switch (message.t) {
      case "create": {
        const name = cleanName(message.name)
        if (!name) return fail(peer, "badName")
        if (at) leave(peer)
        if (rooms.size >= maxRooms) return fail(peer, "busy")
        if (peer.address !== undefined && roomsFrom(peer.address) >= maxRoomsPerAddress) return fail(peer, "busy")
        const room: Room = {
          code: newCode(),
          level: message.level,
          locale: message.locale,
          host: 0,
          seats: [],
          sim: null,
          inputs: [],
          fx: [],
          chat: [],
          pending: 0,
          steps: 0,
          emptyFor: 0
        }
        rooms.set(room.code, room)
        const seat: Seat = { slot: 0, name, peer: null }
        room.seats.push(seat)
        seatPeer(room, seat, peer)
        announce(room)
        return
      }
      case "join": {
        const name = cleanName(message.name)
        if (!name) return fail(peer, "badName")
        const room = rooms.get(message.code)
        if (!room) return fail(peer, "notFound")
        if (at?.room === room) return
        const running = room.sim !== null && !over(room)
        const namesake = room.seats.find((seat) => sameName(seat.name, name))
        if (namesake && namesake.peer === null) {
          // Coming back to a seat left mid-run: same name, same developer.
          if (at) leave(peer)
          seatPeer(room, namesake, peer)
          announce(room)
          if (running) {
            peer.send({ t: "started", level: room.level, locale: room.locale, you: namesake.slot })
          }
          return
        }
        if (namesake) return fail(peer, "nameTaken")
        if (running) return fail(peer, "started")
        const slot = freeSlot(room)
        if (slot === null) return fail(peer, "full")
        if (at) leave(peer)
        const seat: Seat = { slot, name, peer: null }
        room.seats.push(seat)
        room.seats.sort((a, b) => a.slot - b.slot)
        seatPeer(room, seat, peer)
        announce(room)
        return
      }
      case "start": {
        if (!at) return
        if (at.room.host !== at.slot) return fail(peer, "notHost")
        if (at.room.sim && !over(at.room)) return
        start(at.room, message.level ?? at.room.level)
        return
      }
      case "input": {
        if (!at || !at.room.sim) return
        const previous = at.room.inputs[at.slot] ?? idleInput
        at.room.inputs[at.slot] = { ...message.input, dash: previous.dash || message.input.dash, bomb: previous.bomb || message.input.bomb }
        return
      }
      case "leave":
        leave(peer)
        return
      case "ping":
        // Only says the browser is still there: the socket layer keeps track of that.
        return
    }
  }

  /** Steps every running room by `seconds` of wall time, and sends the frames that are due. */
  const advance = (seconds: number) => {
    for (const room of rooms.values()) {
      if (!room.sim) continue
      const connected = room.seats.some((seat) => seat.peer !== null)
      room.emptyFor = connected ? 0 : room.emptyFor + seconds
      if (room.emptyFor > EMPTY_GRACE_SECONDS) {
        rooms.delete(room.code)
        continue
      }
      if (over(room)) continue
      room.pending = Math.min(room.pending + seconds, DT * MAX_STEPS_PER_ADVANCE)
      while (room.pending >= DT) {
        room.pending -= DT
        const stepped = room.sim.step()
        if (!stepped.ok) {
          console.error(`run ${room.code} failed`, stepped.error)
          room.sim = null
          announce(room)
          break
        }
        // A dash or a bomb is one press: used by this step, gone for the next.
        room.inputs = room.inputs.map((input) => input && { ...input, dash: false, bomb: false })
        room.steps += 1
        if (room.steps % STEPS_PER_FRAME === 0 || over(room)) sendFrame(room)
        if (over(room)) {
          // Back to the lobby: the host can start the next run from the results screen.
          announce(room)
          break
        }
      }
    }
  }

  return {
    receive,
    leave,
    advance,
    /** For tests and the server log. */
    count: () => rooms.size,
    room: (code: string) => {
      const room = rooms.get(code)
      return room ? info(room) : null
    }
  }
}

export type Rooms = ReturnType<typeof makeRooms>
