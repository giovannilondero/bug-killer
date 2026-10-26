/**
 * The browser's own developer, drawn where its input has already taken them:
 * the run server's last word on them, plus every step of input the server
 * has not stepped yet, replayed with the server's own `steer` and `glide`.
 * When the server disagrees (a bug's knockback, a step it had to repeat),
 * the gap fades instead of jumping.
 */
import { arenaOf } from "../content/arenas.ts"
import type { Arena } from "../content/arenas.ts"
import type { Level } from "../content/levels.ts"
import type { NetView } from "../net/protocol.ts"
import { DT } from "../sim/constants.ts"
import { glide, steer } from "../sim/motion.ts"
import type { Motion } from "../sim/motion.ts"
import type { InputValue, Phase, Vec } from "../sim/schema.ts"

type Developer = NetView["players"][number]

/** Steps of input kept for replay: two seconds, far more than any server takes to step them. */
const HISTORY = 120
/** How fast a correction fades: most of it within a tenth of a second. */
const SETTLE = 20
/** A correction this large is a teleport (a new run, a revive), not a nudge: no point gliding there. */
const SNAP = 120

interface Predicted {
  readonly position: Vec
  readonly motion: Motion
  /** Coffee left: it makes the developer faster until it runs out. */
  readonly coffee: number
}

export const makePrediction = () => {
  let arena: Arena | null = null
  let seq = -1
  let history: Array<{ readonly seq: number; readonly input: InputValue }> = []
  /** The crosshair as of this browser's last step: it follows the mouse here, not a round trip later. */
  let aim: Vec | null = null
  /** The server's last word: may this developer move at all, and from where. */
  let confirmed: { readonly developer: Developer; readonly phase: Phase } | null = null
  let predicted: Predicted | null = null
  /** What the screen still owes the last correction: drawn on top of the prediction, fading. */
  let error: Vec = { x: 0, y: 0 }
  let drawnAt = 0

  const free = () => confirmed !== null && confirmed.developer.hp > 0 && confirmed.phase !== "dead" && confirmed.phase !== "cleared"

  const advance = (from: Predicted, input: InputValue): Predicted => {
    if (!arena || !free()) return from
    const coffee = Math.max(0, from.coffee - DT)
    const steered = steer(from.motion, from.position, input, coffee > 0)
    return { position: glide(from.position, steered.velocity, arena), motion: steered.motion, coffee }
  }

  return {
    /** A new run, or the same one joined again: nothing predicted yet. */
    reset: (level: Level) => {
      arena = arenaOf(level)
      history = []
      confirmed = null
      predicted = null
      aim = null
      error = { x: 0, y: 0 }
    },
    /** One step of this browser's input: numbered for the server, and applied here right away. */
    record: (input: InputValue): number => {
      seq += 1
      aim = input.aim
      history.push({ seq, input })
      if (history.length > HISTORY) history = history.slice(-HISTORY)
      if (predicted) predicted = advance(predicted, input)
      return seq
    },
    /** A frame: where the server has the developer after stepping input `ack`; everything after it is replayed. */
    confirm: (developer: Developer | undefined, phase: Phase, ack: number) => {
      if (!developer) {
        confirmed = null
        predicted = null
        return
      }
      confirmed = { developer, phase }
      history = history.filter((entry) => entry.seq > ack)
      let next: Predicted = { position: developer.position, motion: developer, coffee: developer.buffs.coffee }
      for (const { input } of history) next = advance(next, input)
      if (predicted) {
        // The screen showed `predicted + error`; it keeps showing that, and the gap fades from there.
        error = { x: predicted.position.x + error.x - next.position.x, y: predicted.position.y + error.y - next.position.y }
        if (Math.hypot(error.x, error.y) > SNAP) error = { x: 0, y: 0 }
      }
      predicted = next
    },
    /** Where to draw the developer now, and the crosshair they aim at; null when there is nothing to predict. */
    draw: (now = performance.now()): { readonly position: Vec; readonly aim: Vec } | null => {
      const elapsed = Math.max(0, now - drawnAt) / 1000
      drawnAt = now
      if (!predicted || !confirmed) return null
      const fade = Math.exp(-SETTLE * elapsed)
      error = { x: error.x * fade, y: error.y * fade }
      return { position: { x: predicted.position.x + error.x, y: predicted.position.y + error.y }, aim: aim ?? confirmed.developer.aim }
    }
  }
}
