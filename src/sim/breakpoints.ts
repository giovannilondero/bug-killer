import type { Arena } from "../content/arenas.ts"
import { BREAKPOINT } from "./constants.ts"
import { clampToArena } from "./math.ts"
import type { Vec } from "./schema.ts"

/**
 * Where a Breakpoint dropped at `at` lands, or null if it cannot go there.
 * Every placement goes through here, so whatever the floor forbids is
 * decided in one place.
 */
export const breakpointSpot = (at: Vec, arena: Arena): Vec | null => clampToArena(at, BREAKPOINT.radius, arena)
