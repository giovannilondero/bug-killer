/**
 * This browser's own bullets, drawn on its own clock. They leave the barrel
 * of the predicted developer on the step the trigger is pulled; when the
 * server's bullet shows up in a frame it takes over, drawn exactly where the
 * one it replaces was, and stays that far ahead of the frames. On screen a
 * bullet stops at the first bug or wall it touches, a little before the
 * server says so; the server still decides what it hits.
 */
import { makeEntityId } from "@typeonce/ritmo/Entity"

import type { Arena } from "../content/arenas.ts"
import { SHOT } from "../sim/constants.ts"
import type { Vec } from "../sim/schema.ts"
import type { View } from "../sim/simulation.ts"
import { inWall } from "../sim/walls.ts"
import type { OwnBullet } from "./predict.ts"

type Shot = View["shots"][number]

/** A bullet fired here that no frame has shown by then, the server never fired: the developer was knocked down, or a step got dropped. */
const HANDOVER_MS = 600
/** How close in direction (the cosine) a server bullet must be to take over from one fired here. */
const SAME_WAY = 0.99

interface Local extends OwnBullet {
  /** Negative, so that it never meets an id from the server. */
  readonly id: Shot["id"]
  readonly born: number
  hidden: boolean
}

interface Handed {
  /** From where the frames have the bullet to where this screen draws it. */
  readonly offset: Vec
  readonly pierce: number
  hidden: boolean
}

const unit = (v: Vec): Vec => {
  const length = Math.hypot(v.x, v.y) || 1
  return { x: v.x / length, y: v.y / length }
}

export const makeOwnShots = () => {
  let local: Array<Local> = []
  let nextId = -1
  const handed = new Map<number, Handed>()

  const flown = (bullet: Local, now: number): Vec => {
    const seconds = (now - bullet.born) / 1000
    return { x: bullet.at.x + bullet.velocity.x * seconds, y: bullet.at.y + bullet.velocity.y * seconds }
  }

  return {
    reset: () => {
      local = []
      handed.clear()
    },
    fire: (bullets: ReadonlyArray<OwnBullet>, now = performance.now()) => {
      for (const bullet of bullets) {
        const id: Shot["id"] = makeEntityId(nextId--)
        local.push({ ...bullet, id, born: now, hidden: false })
      }
    },
    /** `view`'s shots, with `you`'s drawn on this screen's clock. */
    draw: (view: View, you: number, arena: Arena, now = performance.now()): Array<Shot> => {
      const targets = [...view.bugs, ...view.bosses]
      const stopped = (at: Vec, pierce: number) =>
        inWall(arena, at) || (pierce === 0 && targets.some((t) => (t.position.x - at.x) ** 2 + (t.position.y - at.y) ** 2 <= (t.radius + SHOT.radius) ** 2))
      local = local.filter((bullet) => now - bullet.born < Math.min(HANDOVER_MS, bullet.life * 1000))

      const shots: Array<Shot> = []
      const seen = new Set<number>()
      for (const shot of view.shots) {
        if (shot.owner !== you) {
          shots.push(shot)
          continue
        }
        seen.add(shot.id)
        let hand = handed.get(shot.id)
        if (!hand) {
          // The oldest bullet fired here the same way takes it: the server fires them in the same order.
          const way = unit(shot.velocity)
          const index = local.findIndex((bullet) => {
            const mine = unit(bullet.velocity)
            return mine.x * way.x + mine.y * way.y > SAME_WAY
          })
          const bullet = local[index]
          if (bullet) {
            local.splice(index, 1)
            const at = flown(bullet, now)
            hand = { offset: { x: at.x - shot.position.x, y: at.y - shot.position.y }, pierce: bullet.pierce, hidden: bullet.hidden }
          } else {
            // Fired before this screen could know: drawn as the frames have it, and left to the server to stop.
            hand = { offset: { x: 0, y: 0 }, pierce: Infinity, hidden: false }
          }
          handed.set(shot.id, hand)
        }
        const position = { x: shot.position.x + hand.offset.x, y: shot.position.y + hand.offset.y }
        if (!hand.hidden && hand.pierce !== Infinity && stopped(position, hand.pierce)) hand.hidden = true
        if (!hand.hidden) shots.push({ ...shot, position })
      }
      for (const id of handed.keys()) if (!seen.has(id)) handed.delete(id)

      for (const bullet of local) {
        const position = flown(bullet, now)
        if (!bullet.hidden && stopped(position, bullet.pierce)) bullet.hidden = true
        if (!bullet.hidden) shots.push({ id: bullet.id, position, velocity: bullet.velocity, homing: bullet.homing, owner: you })
      }
      return shots
    }
  }
}
