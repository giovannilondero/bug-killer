import * as Random from "@typeonce/ritmo-math/Random"
import { Ops } from "@typeonce/ritmo-math"

import { arenaOf } from "../../content/arenas.ts"
import { subtaskKey } from "../../content/bugs.ts"
import { text } from "../../content/i18n.ts"
import { DT, EPIC } from "../constants.ts"
import { makeBug } from "../drafts.ts"
import { clampToArena } from "../math.ts"
import { BugWrite } from "../queries.ts"
import { Bug, Fx, Game, Language, LevelSpec, Rng, Run } from "../schema.ts"
import { speedFactor } from "../statuses.ts"

/** Turns between one sub-task and the next around the nest, so they don't pile up on one side. */
const GOLDEN_ANGLE = 2.39996

/**
 * Epics are nests: they never move, and every few seconds each one releases a
 * small sub-task while fewer than a handful of its own are alive. Being open,
 * an Epic (like any ticket) holds the wave until it is closed. A frozen Epic
 * releases nothing.
 */
export const EpicSystem = Game.System(
  "BugKiller/Epics",
  {
    queries: { bugs: BugWrite },
    resources: {
      run: Game.System.readResource(Run),
      level: Game.System.readResource(LevelSpec),
      language: Game.System.readResource(Language),
      rng: Game.System.writeResource(Rng)
    },
    events: { fx: Game.System.writeEvent(Fx) },
    commands: Game.System.commands(Game.System.spawns(Bug))
  },
  ({ queries, resources, events, commands }) => {
    const phase = resources.run.get().phase
    if (phase === "dead" || phase === "cleared") {
      return
    }
    const bugs = queries.bugs.each()
    const values = bugs.map((match) => match.data.bug.get())
    if (!values.some((bug) => bug.nest !== null)) {
      return
    }
    const arena = arenaOf(resources.level.get())
    const strings = text[resources.language.get()]
    const random = Random.draw(resources.rng)

    bugs.forEach((match, index) => {
      const epic = values[index]!
      if (epic.nest === null || speedFactor(epic.statuses, false) === 0) {
        return
      }
      let { next, released } = epic.nest
      next -= DT
      if (next <= 0) {
        next += EPIC.every
        const alive = values.filter((bug) => bug.parent === epic.key).length
        if (alive < EPIC.brood) {
          const angle = released * GOLDEN_ANGLE
          const distance = match.data.body.get().radius + EPIC.ring
          const centre = match.data.position.get()
          const at = clampToArena({ x: centre.x + Ops.cos(angle) * distance, y: centre.y + Ops.sin(angle) * distance }, EPIC.ring, arena)
          const priority = random.pick(EPIC.priorities) ?? "Lowest"
          commands.spawn(makeBug(
            { key: subtaskKey(epic.key, released), summary: strings.subtask(epic.summary), priority, status: "Open", type: "subtask" },
            at,
            { parent: epic.key }
          ))
          events.fx.emit({ type: "spawn", x: at.x, y: at.y })
          released += 1
        }
      }
      match.data.bug.set({ ...epic, nest: { next, released } })
    })
  }
)
