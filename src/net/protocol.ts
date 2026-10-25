/**
 * What the browser and the run server say to each other over the WebSocket.
 *
 * The server runs the simulation; browsers send their input and draw the
 * frames it sends back. Everything here is plain JSON, and everything a
 * browser sends is checked before the server uses it.
 */
import type { ArenaId } from "../content/arenas.ts"
import type { Locale } from "../content/i18n.ts"
import { isEndlessArena } from "../content/levels.ts"
import type { LevelId } from "../content/levels.ts"
import type { ChatValue, FxValue, InputValue } from "../sim/schema.ts"
import type { View } from "../sim/simulation.ts"

export const SOCKET_PATH = "/runs"
export const NAME_MAX = 16
/** The longest message a browser may send; an input is well under it. */
export const MESSAGE_MAX = 4096
/**
 * How often a browser says it is still there. A run server that cannot ping
 * (the Durable Object in `src/server/worker.ts`) drops whoever goes quiet.
 */
export const KEEPALIVE_MS = 20000

/** A run's code: easy to read out loud, and it looks like a ticket. */
export const codePattern = /^RUN-\d{4}$/

export type RoomState = "lobby" | "playing"

export interface Member {
  readonly slot: number
  readonly name: string
  readonly color: string
  readonly connected: boolean
}

export interface RoomInfo {
  readonly code: string
  readonly state: RoomState
  readonly level: LevelId
  /** The host's choice for the next run: one sanity and no Pizza, for the whole team. */
  readonly hardcore: boolean
  /** Endless's arena, the host's pick: only an Endless run is played in it. */
  readonly arena: ArenaId
  readonly host: number
  readonly members: ReadonlyArray<Member>
}

/** The world as the server last stepped it; the level travels as its id. */
export type NetView = Omit<View, "level">

/** `busy`: the server already holds as many runs, or connections, as it takes. */
export type ErrorCode = "notFound" | "full" | "started" | "nameTaken" | "badName" | "badLevel" | "notHost" | "busy"

export type ClientMessage =
  | { readonly t: "create"; readonly name: string; readonly level: LevelId; readonly locale: Locale; readonly hardcore?: boolean; readonly arena?: ArenaId }
  | { readonly t: "join"; readonly code: string; readonly name: string }
  | { readonly t: "start"; readonly level?: LevelId; readonly hardcore?: boolean; readonly arena?: ArenaId }
  /** The host changing the level, hardcore or Endless's arena in the lobby: every teammate sees it before the run. */
  | { readonly t: "settings"; readonly level?: LevelId; readonly hardcore?: boolean; readonly arena?: ArenaId }
  | { readonly t: "input"; readonly input: InputValue }
  | { readonly t: "leave" }
  | { readonly t: "ping" }

export type ServerMessage =
  | { readonly t: "room"; readonly room: RoomInfo; readonly you: number }
  | { readonly t: "started"; readonly level: LevelId; readonly arena: ArenaId; readonly locale: Locale; readonly you: number }
  | { readonly t: "frame"; readonly view: NetView; readonly fx: ReadonlyArray<FxValue>; readonly chat: ReadonlyArray<ChatValue> }
  | { readonly t: "error"; readonly code: ErrorCode }

/** Trims and squeezes a chosen name; null when nothing printable is left. */
export const cleanName = (raw: unknown): string | null => {
  if (typeof raw !== "string") return null
  // Control characters out, runs of spaces squeezed.
  const name = raw.replace(/\p{C}/gu, "").replace(/\s+/g, " ").trim()
  if (name.length === 0) return null
  return [...name].slice(0, NAME_MAX).join("")
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

const finite = (value: unknown, limit: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(-limit, Math.min(limit, value)) : 0

/** An optional flag: absent, or a real boolean. */
const isFlag = (value: unknown): value is boolean | undefined => value === undefined || typeof value === "boolean"

/** An optional Endless arena: absent, or one Endless offers. */
const isArena = (value: unknown): value is ArenaId | undefined => value === undefined || isEndlessArena(value)

const vec = (value: unknown, limit: number) => (isObject(value) ? { x: finite(value.x, limit), y: finite(value.y, limit) } : { x: 0, y: 0 })

/** A browser's input, with every number bounded and every flag a boolean. */
export const readInput = (value: unknown): InputValue | null => {
  if (!isObject(value)) return null
  return {
    move: vec(value.move, 1.5),
    aim: vec(value.aim, 10000),
    fire: value.fire === true,
    dash: value.dash === true,
    bomb: value.bomb === true,
    breakpoint: value.breakpoint === true
  }
}

/** Parses one message from a browser; null for anything malformed. */
export const readClientMessage = (raw: string, isLevel: (id: unknown) => id is LevelId, isLocale: (code: unknown) => code is Locale): ClientMessage | null => {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isObject(data)) return null
  switch (data.t) {
    case "create":
      if (typeof data.name !== "string" || !isLevel(data.level) || !isLocale(data.locale) || !isFlag(data.hardcore) || !isArena(data.arena)) return null
      return {
        t: "create",
        name: data.name,
        level: data.level,
        locale: data.locale,
        ...(data.hardcore === undefined ? {} : { hardcore: data.hardcore }),
        ...(data.arena === undefined ? {} : { arena: data.arena })
      }
    case "join":
      if (typeof data.name !== "string" || typeof data.code !== "string") return null
      return { t: "join", name: data.name, code: data.code.trim().toUpperCase() }
    case "start":
      if ((data.level !== undefined && !isLevel(data.level)) || !isFlag(data.hardcore) || !isArena(data.arena)) return null
      return {
        t: "start",
        ...(data.level === undefined ? {} : { level: data.level }),
        ...(data.hardcore === undefined ? {} : { hardcore: data.hardcore }),
        ...(data.arena === undefined ? {} : { arena: data.arena })
      }
    case "settings":
      if ((data.level !== undefined && !isLevel(data.level)) || !isFlag(data.hardcore) || !isArena(data.arena)) return null
      return {
        t: "settings",
        ...(data.level === undefined ? {} : { level: data.level }),
        ...(data.hardcore === undefined ? {} : { hardcore: data.hardcore }),
        ...(data.arena === undefined ? {} : { arena: data.arena })
      }
    case "input": {
      const input = readInput(data.input)
      return input && { t: "input", input }
    }
    case "leave":
      return { t: "leave" }
    case "ping":
      return { t: "ping" }
    default:
      return null
  }
}
