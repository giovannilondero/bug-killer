/**
 * The browser's own developer, drawn where its input has already taken them:
 * the run server's last word on them, plus every step of input the server
 * has not stepped yet, replayed with the server's own `steer`, `glide`,
 * `wearOff` and `pull`. When the server disagrees (a bug's knockback, a step
 * it had to repeat), the gap fades instead of jumping. A step taken here for
 * the first time also says what it fired, so the screen shows it at once.
 */
import { arenaOf } from "../content/arenas.ts"
import type { Arena } from "../content/arenas.ts"
import type { Level } from "../content/levels.ts"
import type { NetView } from "../net/protocol.ts"
import { SHOT } from "../sim/constants.ts"
import { glide, steer } from "../sim/motion.ts"
import type { Motion } from "../sim/motion.ts"
import type { FxValue, InputValue, Phase, Vec } from "../sim/schema.ts"
import { bulletsOf, flameOf, pull, wearOff } from "../sim/trigger.ts"
import type { Buffs } from "../sim/trigger.ts"
import type { WeaponValue } from "../sim/weapons.ts"

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
  readonly fireCooldown: number
  readonly weapon: WeaponValue
  readonly buffs: Buffs
}

/** A bullet this browser's developer just fired, as the server will fire it. */
export interface OwnBullet {
  readonly at: Vec
  readonly velocity: Vec
  readonly life: number
  readonly homing: boolean
  /** Bugs it goes through before stopping: Refactor's. */
  readonly pierce: number
}

/** What one step did that the screen shows at once: the developer's own sounds and puffs, and the bullets leaving the barrel. */
export interface Fired {
  readonly fx: ReadonlyArray<FxValue>
  readonly bullets: ReadonlyArray<OwnBullet>
}

const nothing: Fired = { fx: [], bullets: [] }

const fromServer = (developer: Developer): Predicted => ({
  position: developer.position,
  motion: developer,
  fireCooldown: developer.fireCooldown,
  weapon: developer.weapon,
  buffs: developer.buffs
})

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

  const advance = (from: Predicted, input: InputValue): { readonly next: Predicted; readonly fired: Fired } => {
    if (!arena || !confirmed || !free()) return { next: from, fired: nothing }
    const slot = confirmed.developer.slot
    const { buffs, weapon } = wearOff(from.buffs, from.weapon)
    const steered = steer(from.motion, from.position, input, buffs.coffee > 0)
    const { fireCooldown, trigger } = pull(from.fireCooldown, weapon.kind, buffs, from.position, input)
    const next = { position: glide(from.position, steered.velocity, arena), motion: steered.motion, fireCooldown, weapon, buffs }
    const fx: Array<FxValue> = []
    if (steered.dashed) fx.push({ type: "dash", x: from.position.x, y: from.position.y, slot })
    if (!trigger) return { next, fired: { fx, bullets: [] } }
    fx.push({ type: "shoot", x: trigger.muzzle.x, y: trigger.muzzle.y, weapon: weapon.kind, slot })
    if (weapon.kind === "flameWar") fx.push(flameOf(trigger, arena, slot).fx)
    const bullets = bulletsOf(trigger).map(({ at, direction }) => ({
      at,
      velocity: { x: direction.x * SHOT.speed, y: direction.y * SHOT.speed },
      life: trigger.tools ? SHOT.life * 1.4 : SHOT.life,
      homing: trigger.tools,
      pierce: trigger.refactor ? 1 : 0
    }))
    return { next, fired: { fx, bullets } }
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
    /** One step of this browser's input: numbered for the server, applied here right away, and what it fired. */
    record: (input: InputValue): { readonly seq: number; readonly fired: Fired } => {
      seq += 1
      aim = input.aim
      history.push({ seq, input })
      if (history.length > HISTORY) history = history.slice(-HISTORY)
      if (!predicted) return { seq, fired: nothing }
      const { next, fired } = advance(predicted, input)
      predicted = next
      return { seq, fired }
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
      // Replayed steps were shown when first taken: what they fire is not shown again.
      let next = fromServer(developer)
      for (const { input } of history) next = advance(next, input).next
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
