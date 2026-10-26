/**
 * The browser's side of a multiplayer run: the socket to the run server,
 * and the frames it sends, smoothed so that 30 updates a second draw like 60
 * even when the network delivers them unevenly.
 */
import type { Level } from "../content/levels.ts"
import { KEEPALIVE_MS, SOCKET_PATH } from "../net/protocol.ts"
import type { ClientMessage, NetView, ServerMessage } from "../net/protocol.ts"
import { DT } from "../sim/constants.ts"
import type { Vec } from "../sim/schema.ts"
import type { View } from "../sim/simulation.ts"

export interface Connection {
  readonly send: (message: ClientMessage) => void
  readonly close: () => void
}

/** Opens the socket on the same host that served the page (the dev server or production). */
export const connect = (handlers: { readonly message: (message: ServerMessage) => void; readonly closed: () => void }): Connection => {
  const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${SOCKET_PATH}`)
  const queue: Array<string> = []
  let closing = false
  socket.addEventListener("open", () => {
    for (const data of queue.splice(0)) socket.send(data)
  })
  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return
    try {
      handlers.message(JSON.parse(event.data) as ServerMessage)
    } catch (error) {
      console.error("bad message from the run server", error)
    }
  })
  const send = (message: ClientMessage) => {
    const data = JSON.stringify(message)
    if (socket.readyState === WebSocket.OPEN) socket.send(data)
    else if (socket.readyState === WebSocket.CONNECTING) queue.push(data)
  }
  // Between inputs (in the lobby, on the results screen) the server would not hear from this browser otherwise.
  const keepalive = setInterval(() => send({ t: "ping" }), KEEPALIVE_MS)
  socket.addEventListener("close", () => {
    clearInterval(keepalive)
    if (!closing) handlers.closed()
  })
  return {
    send,
    close: () => {
      closing = true
      socket.close()
    }
  }
}

/** Frames leave the server every other step: this far apart on its clock. */
const FRAME_MS = 2 * DT * 1000
/** The recent frames the buffer learns the network from: ten seconds of them. */
const WINDOW = 300
/** The buffer waits for all but the latest 1% of frames: past that, each late frame would cost every other one more delay. */
const LATE_SHARE = 0.01
/** Never closer to the newest frame than one frame and a margin, never further than a quarter second. */
const MIN_DELAY_MS = FRAME_MS + 5
const MAX_DELAY_MS = 250
/** How fast the drawn moment may slide toward where it should be: the screen runs at most 10% slow or fast, it never jumps. */
const DRIFT = 0.1
/** Further off than this (the first frame, a long stall), the screen just catches up. */
const SNAP_MS = 500
/** Enough frames to cover the longest delay. */
const KEEP = 16

interface Timed {
  /** When the server stepped this frame, on its clock. */
  readonly server: number
  readonly view: NetView
}

const lerp = (a: Vec, b: Vec, k: number): Vec => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k })

/** Every entity in `next` moved part of the way from where it was in `previous`; new ones appear where they are. */
const blend = <T extends { readonly position: Vec }>(previous: ReadonlyArray<T>, next: ReadonlyArray<T>, key: (item: T) => number, k: number): Array<T> => {
  const before = new Map(previous.map((item) => [key(item), item.position]))
  return next.map((item) => {
    const from = before.get(key(item))
    return from ? { ...item, position: lerp(from, item.position, k) } : item
  })
}

/**
 * A jitter buffer: frames are placed on the server's clock, and the screen
 * draws a little behind the newest one, as far behind as late frames need.
 * Placing them on arrival instead would turn every late frame into a freeze
 * and then a jump.
 */
export const makeFrames = () => {
  let frames: Array<Timed> = []
  /** For each recent frame, when it arrived minus when the server stepped it: the network's delay plus the two clocks' offset. */
  let offsets: Array<number> = []
  /** Local time minus this is the server moment the screen should draw. */
  let target = 0
  /** The same for the moment the screen does draw: it slides toward `target`. */
  let behind: number | null = null
  let sampledAt = 0
  return {
    push: (view: NetView, step: number, at = performance.now()) => {
      const server = step * DT * 1000
      // A step back is a new run's clock.
      if (server < (frames[frames.length - 1]?.server ?? 0)) {
        frames = []
        offsets = []
        behind = null
      }
      frames.push({ server, view })
      if (frames.length > KEEP) frames = frames.slice(-KEEP)
      offsets.push(at - server)
      if (offsets.length > WINDOW) offsets = offsets.slice(-WINDOW)
      // The quickest frame sets the base; how much later the slow ones came sets the delay.
      const sorted = [...offsets].sort((a, b) => a - b)
      const base = sorted[0]!
      const late = sorted[sorted.length - 1 - Math.floor(sorted.length * LATE_SHARE)]! - base
      target = base + Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, FRAME_MS + late))
    },
    reset: () => {
      frames = []
      offsets = []
      behind = null
    },
    latest: (): NetView | null => frames[frames.length - 1]?.view ?? null,
    /** The world at the moment the buffer draws, between the two frames around it, followed by `slot`'s developer. */
    sample: (level: Level, slot: number, now = performance.now()): View | null => {
      const last = frames[frames.length - 1]
      if (!last) return null
      const elapsed = now - sampledAt
      sampledAt = now
      if (behind === null || Math.abs(target - behind) > SNAP_MS) behind = target
      else behind += Math.max(-DRIFT * elapsed, Math.min(DRIFT * elapsed, target - behind))
      const time = now - behind
      let a = frames[0]!
      let b = last
      for (let i = frames.length - 1; i > 0; i--) {
        if (frames[i - 1]!.server <= time) {
          a = frames[i - 1]!
          b = frames[i]!
          break
        }
      }
      const k = b.server === a.server ? 1 : Math.max(0, Math.min(1, (time - a.server) / (b.server - a.server)))
      const next = b.view
      const players = blend(a.view.players, next.players, (p) => p.slot, k)
      return {
        ...next,
        level,
        players,
        player: players.find((p) => p.slot === slot) ?? null,
        bugs: blend(a.view.bugs, next.bugs, (e) => e.id, k),
        bosses: blend(a.view.bosses, next.bosses, (e) => e.id, k),
        shots: blend(a.view.shots, next.shots, (e) => e.id, k),
        hostile: blend(a.view.hostile, next.hostile, (e) => e.id, k),
        pickups: blend(a.view.pickups, next.pickups, (e) => e.id, k),
        rockets: blend(a.view.rockets, next.rockets, (e) => e.id, k)
      }
    }
  }
}
