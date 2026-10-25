import * as Random from "@typeonce/ritmo-math/Random"
import { Ops } from "@typeonce/ritmo-math"

import { text } from "../../content/i18n.ts"
import { arenaOf } from "../../content/arenas.ts"
import { DT, TOBIA, RESURRECT, WALL_MARGIN } from "../constants.ts"
import { makeBug, makePickup } from "../drafts.ts"
import { centreOf, clampToArena } from "../math.ts"
import { BossRead, BugRead, PlayerRead, standing } from "../queries.ts"
import { Bug, Chat, Fx, Game, Interruptions, Language, LevelSpec, Pickup, Rng, Run } from "../schema.ts"

/**
 * Every so often a client swears a bug you fixed is not fixed at all: it
 * comes back from the release notes into the arena, tougher, while the
 * client laughs in the chat.
 */
export const ResurrectionSystem = Game.System(
  "BugKiller/Resurrection",
  {
    queries: { player: PlayerRead },
    resources: {
      level: Game.System.readResource(LevelSpec),
      language: Game.System.readResource(Language),
      run: Game.System.writeResource(Run),
      interruptions: Game.System.writeResource(Interruptions),
      rng: Game.System.writeResource(Rng)
    },
    events: { chat: Game.System.writeEvent(Chat), fx: Game.System.writeEvent(Fx) },
    commands: Game.System.commands(Game.System.spawns(Bug))
  },
  ({ queries, resources, events, commands }) => {
    const run = resources.run.get()
    if (run.phase !== "waves") {
      return
    }
    const state = { ...resources.interruptions.get() }
    state.resurrectIn -= DT
    if (state.resurrectIn > 0) {
      resources.interruptions.set(state)
      return
    }

    const level = resources.level.get()
    const arena = arenaOf(level)
    const random = Random.draw(resources.rng)
    // Only the level's own tickets come back: no regressions, scope creep, or bosses.
    const candidates = run.fixed.filter((fixed) => level.bugs.some((bug) => bug.key === fixed.key))
    const victim = random.pick(candidates)
    const seed = victim && level.bugs.find((bug) => bug.key === victim.key)
    const client = random.pick(level.clients.filter((id) => id !== "tobia"))
    if (!victim || !seed || !client) {
      // Nothing fixed yet: check again shortly.
      state.resurrectIn = 3
      resources.interruptions.set(state)
      return
    }

    // It rises in plain sight, close enough to see but not on top of you.
    const me = standing(queries.player.each())[0] ?? centreOf(arena)
    const angle = random.range(0, Math.PI * 2)
    const at = clampToArena({ x: me.x + Ops.cos(angle) * RESURRECT.distance, y: me.y + Ops.sin(angle) * RESURRECT.distance }, 60, arena)
    // As it was closed: a Story that played as a plain bug comes back as one.
    commands.spawn(makeBug({ ...seed, type: victim.type }, at, { resurrectedBy: client }))
    const index = run.fixed.findIndex((fixed) => fixed.key === victim.key)
    resources.run.set({ ...run, fixed: run.fixed.filter((_, i) => i !== index) })

    const strings = text[resources.language.get()]
    const person = strings.people[client]
    const line = person.voice(strings.resurrectLine(victim.key, person.laugh), (n) => random.integer(0, Math.max(1, n)))
    events.chat.emit({ type: "resurrect", client, text: line, key: victim.key })
    events.fx.emit({ type: "resurrect", x: at.x, y: at.y, key: victim.key, client })

    state.resurrections += 1
    state.resurrectIn = random.range(RESURRECT.min, RESURRECT.max)
    resources.interruptions.set(state)
  }
)

/**
 * Tobia, from the team, notices when you are slow (no fix for a while, or
 * the bugs piling up) and asks whether you are using the _strumenti_.
 * Then leaves them next to you: homing shots for a few seconds.
 */
export const TobiaSystem = Game.System(
  "BugKiller/Tobia",
  {
    queries: { player: PlayerRead, bugs: BugRead, bosses: BossRead },
    resources: {
      level: Game.System.readResource(LevelSpec),
      language: Game.System.readResource(Language),
      run: Game.System.readResource(Run),
      interruptions: Game.System.writeResource(Interruptions),
      rng: Game.System.writeResource(Rng)
    },
    events: { chat: Game.System.writeEvent(Chat) },
    commands: Game.System.commands(Game.System.spawns(Pickup))
  },
  ({ queries, resources, events, commands }) => {
    const run = resources.run.get()
    if (run.phase !== "waves" && run.phase !== "boss") {
      return
    }
    const state = { ...resources.interruptions.get() }
    state.tobiaIn = Math.max(0, state.tobiaIn - DT)

    const enemies = queries.bugs.each().length + queries.bosses.each().length
    const idle = enemies > 0 && run.time - run.lastProgressAt > TOBIA.idle
    const pileUp = queries.bugs.each().length >= resources.level.get().waveSize * TOBIA.pileUp
    const me = standing(queries.player.each())[0]

    if (state.tobiaIn === 0 && (idle || pileUp) && me) {
      const random = Random.draw(resources.rng)
      const arena = arenaOf(resources.level.get())
      const lines = text[resources.language.get()].tobiaLines
      events.chat.emit({ type: "nudge", client: "tobia", text: lines[state.tobiaLine % lines.length] ?? "" })
      const angle = random.range(0, Math.PI * 2)
      commands.spawn(makePickup("tools", clampToArena({ x: me.x + Ops.cos(angle) * 110, y: me.y + Ops.sin(angle) * 110 }, WALL_MARGIN, arena)))
      state.tobiaLine += 1
      state.tobiaIn = TOBIA.cooldown
    }
    resources.interruptions.set(state)
  }
)
