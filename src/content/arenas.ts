/** A wall on the floor: a rectangle, from its top-left corner. */
export interface Wall {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * The floor a level is played on. Everything that spawns, moves or is
 * placed stays inside it, and the camera and the minimap frame it. Walls
 * stop developers, bugs and every projectile, and nothing is placed in one.
 */
export interface Arena {
  readonly width: number
  readonly height: number
  readonly walls?: ReadonlyArray<Wall>
}

/** An L of cubicle partitions: a `long` run along x and one along y, meeting at (`x`, `y`). */
const cubicle = (x: number, y: number, long: { readonly x: number; readonly y: number }): ReadonlyArray<Wall> => [
  { x: long.x > 0 ? x - 20 : x + long.x, y: y - 20, width: Math.abs(long.x) + 20, height: 40 },
  { x: x - 20, y: long.y > 0 ? y - 20 : y + long.y, width: 40, height: Math.abs(long.y) + 20 }
]

export const arenas = {
  /** The open floor every sprint is played on. */
  normal: { width: 1800, height: 1200 },
  /** A cramped floor, about half the normal one: nowhere to run. */
  small: { width: 1200, height: 800 },
  /** The normal floor, cut up by cubicle partitions and a desk in the middle. */
  walls: {
    width: 1800,
    height: 1200,
    walls: [
      ...cubicle(340, 280, { x: 340, y: 220 }),
      ...cubicle(1460, 280, { x: -340, y: 220 }),
      ...cubicle(340, 920, { x: 340, y: -220 }),
      ...cubicle(1460, 920, { x: -340, y: -220 }),
      { x: 760, y: 540, width: 280, height: 40 }
    ]
  }
} as const satisfies Record<string, Arena>

/** The arena a level is played on: the normal one unless the level says otherwise. */
export const arenaOf = (level: { readonly arena?: Arena }): Arena => level.arena ?? arenas.normal

export type ArenaId = keyof typeof arenas
