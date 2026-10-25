import * as Random from "@typeonce/ritmo-math/Random"

import { text } from "../../content/i18n.ts"
import { arenaOf } from "../../content/arenas.ts"
import { bossRules, toward } from "../bosses.ts"
import { DT } from "../constants.ts"
import { makeBug, makeHostileShot } from "../drafts.ts"
import { angleTo, nearest } from "../math.ts"
import { BossWrite, BugRead, PlayerRead, standing } from "../queries.ts"
import { Bug, Fx, Game, HostileShot, Language, LevelSpec, Rng } from "../schema.ts"
import type { BossValue } from "../schema.ts"
import { speedFactor } from "../statuses.ts"

/**
 * Runs every boss's fight, one tick at a time; how each pattern fights lives
 * in `bossRules`. Bosses only fight while somebody is standing.
 */
export const BossBrainSystem = Game.System(
  "BugKiller/BossBrain",
  {
    queries: { player: PlayerRead, bosses: BossWrite, bugs: BugRead },
    resources: { rng: Game.System.writeResource(Rng), language: Game.System.readResource(Language), level: Game.System.readResource(LevelSpec) },
    events: { fx: Game.System.writeEvent(Fx) },
    commands: Game.System.commands(Game.System.spawns(HostileShot, Bug))
  },
  ({ queries, resources, events, commands }) => {
    const team = standing(queries.player.each())
    const arena = arenaOf(resources.level.get())
    if (team.length === 0) {
      return
    }
    const random = Random.draw(resources.rng)
    const strings = text[resources.language.get()]
    const minions = queries.bugs.each().length

    const bosses = queries.bosses.each()
    for (const match of bosses) {
      const position = match.data.position.get()
      const target = nearest(position, team) ?? team[0]!
      const boss: BossValue = { ...match.data.boss.get() }
      // Code freeze slows a boss, its attacks included, but never stops it.
      const slow = speedFactor(boss.statuses, true)
      boss.age += DT
      boss.timer -= DT * slow
      boss.shield = Math.max(0, boss.shield - DT)
      boss.hitFlash = Math.max(0, boss.hitFlash - DT)
      const fire = (angle: number, speed: number) => commands.spawn(makeHostileShot(position, angle, speed, boss.shotText))
      const velocity = bossRules[boss.pattern].fight({
        boss,
        position,
        target,
        aim: angleTo(position, target),
        rage: 1 - boss.hp / boss.maxHp,
        arena,
        random,
        strings,
        minions,
        kin: bosses.filter((other) => other !== match && other.data.boss.get().key === boss.key).length,
        fire,
        ring: (count, speed, offset) => {
          for (let i = 0; i < count; i++) fire(offset + (i / count) * Math.PI * 2, speed)
        },
        chase: (speed) => toward(position, target, speed),
        steer: (goal, speed) => toward(position, goal, speed),
        teleport: (to) => {
          events.fx.emit({ type: "teleport", x: position.x, y: position.y })
          match.data.position.set(to)
          events.fx.emit({ type: "teleport", x: to.x, y: to.y })
        },
        spawnMinion: (seed, at) => commands.spawn(makeBug(seed, at)),
        announce: (line) => events.fx.emit({ type: "bossPhase", x: position.x, y: position.y, text: line })
      })

      match.data.velocity.set({ x: velocity.x * slow, y: velocity.y * slow })
      match.data.boss.set(boss)
    }
  }
)
