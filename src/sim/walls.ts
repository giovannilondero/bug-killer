import type { Arena, Wall } from "../content/arenas.ts"
import type { Vec } from "./schema.ts"

/**
 * Walls: what stops a body, a projectile or a blast. Every question the
 * simulation asks about them is answered here, from the arena alone.
 */
const wallsOf = (arena: Arena): ReadonlyArray<Wall> => arena.walls ?? []

const within = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/** Whether a circle of `radius` at `p` overlaps `wall`; a point (radius 0) only counts inside it. */
const touches = (wall: Wall, p: Vec, radius: number): boolean => {
  const dx = p.x - within(p.x, wall.x, wall.x + wall.width)
  const dy = p.y - within(p.y, wall.y, wall.y + wall.height)
  return radius > 0 ? dx * dx + dy * dy < radius * radius : p.x > wall.x && p.x < wall.x + wall.width && p.y > wall.y && p.y < wall.y + wall.height
}

/** Whether a circle of `radius` at `p` overlaps any wall of the arena. */
export const inWall = (arena: Arena, p: Vec, radius = 0): boolean => wallsOf(arena).some((wall) => touches(wall, p, radius))

/** The circle at `p` moved the shortest way out of `wall`, until it just touches it. */
const pushOut = (wall: Wall, p: Vec, radius: number): Vec => {
  const cx = within(p.x, wall.x, wall.x + wall.width)
  const cy = within(p.y, wall.y, wall.y + wall.height)
  const dx = p.x - cx
  const dy = p.y - cy
  if (dx !== 0 || dy !== 0) {
    const d = Math.sqrt(dx * dx + dy * dy)
    return { x: cx + (dx / d) * radius, y: cy + (dy / d) * radius }
  }
  // The centre is inside: out through the nearest side.
  const exits = [
    { d: p.x - wall.x, to: { x: wall.x - radius, y: p.y } },
    { d: wall.x + wall.width - p.x, to: { x: wall.x + wall.width + radius, y: p.y } },
    { d: p.y - wall.y, to: { x: p.x, y: wall.y - radius } },
    { d: wall.y + wall.height - p.y, to: { x: p.x, y: wall.y + wall.height + radius } }
  ]
  return exits.reduce((best, exit) => (exit.d < best.d ? exit : best)).to
}

/** A circle of `radius` at `p` moved out of every wall it overlaps; the arena's edges are the caller's. */
export const outOfWalls = (arena: Arena, p: Vec, radius: number): Vec => {
  let at = p
  for (const wall of wallsOf(arena)) {
    if (touches(wall, at, radius)) at = pushOut(wall, at, radius)
  }
  return at
}

/**
 * Where the segment from `a` to `b` first meets `wall` grown by `pad` on
 * every side, as a fraction of the way (0 at `a`, 1 at `b`), or null.
 */
const entry = (wall: Wall, a: Vec, b: Vec, pad: number): number | null => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  let from = 0
  let to = 1
  const sides: ReadonlyArray<readonly [number, number]> = [
    [-dx, a.x - (wall.x - pad)],
    [dx, wall.x + wall.width + pad - a.x],
    [-dy, a.y - (wall.y - pad)],
    [dy, wall.y + wall.height + pad - a.y]
  ]
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q <= 0) return null
      continue
    }
    const t = q / p
    if (p < 0) from = Math.max(from, t)
    else to = Math.min(to, t)
    if (from >= to) return null
  }
  return from
}

/** How far along the way from `a` to `b` (0 to 1) the first wall stands, or null when the way is clear. */
export const firstWall = (arena: Arena, a: Vec, b: Vec, pad = 0): number | null => {
  let first: number | null = null
  for (const wall of wallsOf(arena)) {
    const t = entry(wall, a, b, pad)
    if (t !== null && (first === null || t < first)) first = t
  }
  return first
}

/** Whether a wall stands between `a` and `b`: nothing passes, not a shot, not a flame, not a blast. */
export const blocked = (arena: Arena, a: Vec, b: Vec, pad = 0): boolean => firstWall(arena, a, b, pad) !== null

const span = (a: Vec, b: Vec): number => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)

/**
 * Where a body of `radius` at `from` should head to reach `to`: straight
 * there when nothing is in the way, otherwise round the corner of a wall
 * that it can walk to and that leaves the shortest way on. Deterministic,
 * and one corner at a time: a body that gets there picks the next.
 */
export const detour = (arena: Arena, from: Vec, to: Vec, radius: number): Vec => {
  const walls = wallsOf(arena)
  // A body sliding along a wall touches it: a hair less than its size keeps that from counting as blocked.
  const pad = Math.max(0, radius - 1)
  if (walls.length === 0 || !blocked(arena, from, to, pad)) return to
  const clearance = radius + 6
  let best: Vec | null = null
  let bestCost = 0
  for (const wall of walls) {
    for (const corner of [
      { x: wall.x - clearance, y: wall.y - clearance },
      { x: wall.x + wall.width + clearance, y: wall.y - clearance },
      { x: wall.x - clearance, y: wall.y + wall.height + clearance },
      { x: wall.x + wall.width + clearance, y: wall.y + wall.height + clearance }
    ]) {
      const there = span(from, corner)
      if (there < 4 || inWall(arena, corner, radius) || blocked(arena, from, corner, pad)) continue
      // A corner that still has a wall between it and the goal costs extra: another corner will be needed.
      const on = span(corner, to)
      const cost = there + (blocked(arena, corner, to, pad) ? on * 1.5 + 200 : on)
      if (best === null || cost < bestCost) {
        best = corner
        bestCost = cost
      }
    }
  }
  return best ?? to
}
