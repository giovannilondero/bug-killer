/**
 * The floor a level is played on. Everything that spawns, moves or is
 * placed stays inside it, and the camera and the minimap frame it.
 */
export interface Arena {
  readonly width: number
  readonly height: number
}

export const arenas = {
  /** The open floor every sprint is played on. */
  normal: { width: 1800, height: 1200 },
  /** A cramped floor, about half the normal one: nowhere to run. */
  small: { width: 1200, height: 800 }
} as const satisfies Record<string, Arena>

/** The arena a level is played on: the normal one unless the level says otherwise. */
export const arenaOf = (level: { readonly arena?: Arena }): Arena => level.arena ?? arenas.normal
