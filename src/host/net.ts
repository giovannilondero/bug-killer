/**
 * The browser's side of a multiplayer run: the socket to the run server,
 * and the frames it sends, smoothed so that 30 updates a second draw like 60.
 */
import type { Level } from "../content/levels.ts"
import { KEEPALIVE_MS, SOCKET_PATH } from "../net/protocol.ts"
import type { ClientMessage, NetView, ServerMessage } from "../net/protocol.ts"
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

/** How far behind the newest frame the screen draws: enough to always have two frames to blend. */
const DELAY_MS = 50
const KEEP = 8

interface Timed {
  readonly at: number
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

export const makeFrames = () => {
  let frames: Array<Timed> = []
  return {
    push: (view: NetView, at = performance.now()) => {
      frames.push({ at, view })
      if (frames.length > KEEP) frames = frames.slice(-KEEP)
    },
    reset: () => {
      frames = []
    },
    latest: (): NetView | null => frames[frames.length - 1]?.view ?? null,
    /** The world as it was `DELAY_MS` ago, between the two frames around that moment, followed by `slot`'s developer. */
    sample: (level: Level, slot: number, now = performance.now()): View | null => {
      const last = frames[frames.length - 1]
      if (!last) return null
      const time = now - DELAY_MS
      let a = frames[0]!
      let b = last
      for (let i = frames.length - 1; i > 0; i--) {
        if (frames[i - 1]!.at <= time) {
          a = frames[i - 1]!
          b = frames[i]!
          break
        }
      }
      const k = b.at === a.at ? 1 : Math.max(0, Math.min(1, (time - a.at) / (b.at - a.at)))
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
