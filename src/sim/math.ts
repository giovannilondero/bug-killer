import type * as Random from "@typeonce/ritmo-math/Random"

import type { Arena } from "../content/arenas.ts"
import { SPAWN_SAFE_DISTANCE } from "./constants.ts"
import type { Vec } from "./schema.ts"
import { inWall, outOfWalls } from "./walls.ts"
import { Ops } from "@typeonce/ritmo-math"

export const length = (v: Vec): number => Ops.hypot(v.x, v.y)

export const normalize = (v: Vec): Vec => {
  const l = length(v)
  return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l }
}

export const distanceSquared = (a: Vec, b: Vec): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2

export const overlaps = (a: Vec, ra: number, b: Vec, rb: number): boolean => distanceSquared(a, b) < (ra + rb) ** 2

export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const withinEdges = (p: Vec, radius: number, arena: Arena): Vec => ({
  x: clamp(p.x, radius, arena.width - radius),
  y: clamp(p.y, radius, arena.height - radius)
})

/**
 * The closest spot to `p` where a body of `radius` fits: inside the arena's
 * edges and out of its walls. Every placement and every move ends here.
 */
export const clampToArena = (p: Vec, radius: number, arena: Arena): Vec => {
  let at = withinEdges(p, radius, arena)
  // Walls stand well apart and away from the edges, so a couple of passes settle any body.
  for (let pass = 0; pass < 3 && inWall(arena, at, radius); pass++) {
    at = withinEdges(outOfWalls(arena, at, radius), radius, arena)
  }
  return at
}

export const angleTo = (from: Vec, to: Vec): number => Ops.atan2(to.y - from.y, to.x - from.x)

/** The point of `points` closest to `from`, or null when there is none. */
export const nearest = (from: Vec, points: ReadonlyArray<Vec>): Vec | null => {
  let best: Vec | null = null
  let bestDistance = Infinity
  for (const point of points) {
    const d = distanceSquared(from, point)
    if (d < bestDistance) {
      best = point
      bestDistance = d
    }
  }
  return best
}

/** How far from any wall a spawn on the edge stays: room for the biggest bug. */
const CLEARANCE = 40
/** How far from any wall an open point stays: room for a boss. */
const OPEN_CLEARANCE = 90

/** A point on the arena's edge, as far from `avoid` as a few tries allow. */
export const edgePoint = (random: Random.Random, avoid: Vec | null, arena: Arena): Vec => {
  let best: Vec = { x: 60, y: 60 }
  let bestDistance = -1
  for (let attempt = 0; attempt < 6; attempt++) {
    const side = random.integer(0, 4)
    const along = random.range(60, side % 2 === 0 ? arena.width - 60 : arena.height - 60)
    const point =
      side === 0 ? { x: along, y: 50 }
      : side === 1 ? { x: arena.width - 50, y: along }
      : side === 2 ? { x: along, y: arena.height - 50 }
      : { x: 50, y: along }
    if (inWall(arena, point, CLEARANCE)) continue
    const d = avoid === null ? Infinity : distanceSquared(point, avoid)
    if (d > SPAWN_SAFE_DISTANCE ** 2) {
      return point
    }
    if (d > bestDistance) {
      best = point
      bestDistance = d
    }
  }
  return clampToArena(best, CLEARANCE, arena)
}

/** The middle of the arena. */
export const centreOf = (arena: Arena): Vec => ({ x: arena.width / 2, y: arena.height / 2 })

/** A point inside the arena, clear of its walls by room for a boss, at least `minDistance` from `avoid`. */
export const openPoint = (random: Random.Random, avoid: Vec, minDistance: number, arena: Arena): Vec => {
  for (let attempt = 0; attempt < 12; attempt++) {
    const point = { x: random.range(140, arena.width - 140), y: random.range(140, arena.height - 140) }
    if (distanceSquared(point, avoid) > minDistance ** 2 && !inWall(arena, point, OPEN_CLEARANCE)) {
      return point
    }
  }
  return clampToArena({ x: arena.width - avoid.x, y: arena.height - avoid.y }, OPEN_CLEARANCE, arena)
}
