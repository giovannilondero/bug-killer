import * as Random from "@typeonce/ritmo/Random"
import { Ops } from "@typeonce/ritmo"

import { arenaOf } from "../../content/arenas.ts"
import { DT, TURRET } from "../constants.ts"
import { makeShot } from "../drafts.ts"
import { angleTo, nearest } from "../math.ts"
import { BossRead, BugRead } from "../queries.ts"
import { Fx, Game, LevelSpec, Position, Rng, Run, Shot, Turret } from "../schema.ts"
import { blocked } from "../walls.ts"

/**
 * The "AI" turret: turns toward the nearest bug or boss in range and in sight, and keeps
 * shooting until it runs out. Every few seconds it hallucinates a target
 * and fires at nothing, with full confidence.
 */
export const TurretSystem = Game.System(
  "BugKiller/Turret",
  {
    queries: {
      turrets: Game.Query({ selection: { position: Game.Query.read(Position), turret: Game.Query.write(Turret) } }),
      bugs: BugRead,
      bosses: BossRead
    },
    resources: { run: Game.System.readResource(Run), rng: Game.System.writeResource(Rng), level: Game.System.readResource(LevelSpec) },
    events: { fx: Game.System.writeEvent(Fx) },
    commands: Game.System.commands(Game.System.spawns(Shot), Game.System.despawns(Turret))
  },
  ({ queries, resources, events, commands }) => {
    const phase = resources.run.get().phase
    if (phase !== "waves" && phase !== "boss") {
      return
    }
    const turrets = queries.turrets.each()
    if (turrets.length === 0) {
      return
    }
    const targets = [...queries.bugs.each(), ...queries.bosses.each()].map((match) => match.data.position.get())
    const random = Random.draw(resources.rng)
    const arena = arenaOf(resources.level.get())

    for (const match of turrets) {
      const at = match.data.position.get()
      const turret = { ...match.data.turret.get() }
      turret.life -= DT
      if (turret.life <= 0) {
        commands.despawn(match.entity)
        continue
      }
      turret.cooldown = Math.max(0, turret.cooldown - DT)
      turret.hallucinateIn -= DT

      const muzzle = (angle: number) => ({ x: at.x + Ops.cos(angle) * 20, y: at.y + Ops.sin(angle) * 20 })
      const fire = (angle: number) => {
        commands.spawn(makeShot(muzzle(angle), { x: Ops.cos(angle), y: Ops.sin(angle) }, 0, false, turret.owner))
        events.fx.emit({ type: "shoot", ...muzzle(angle), weapon: "gun" })
        turret.cooldown = TURRET.cooldown
      }

      // It only sees what no wall hides.
      const target = nearest(at, targets.filter((spot) => !blocked(arena, at, spot)))
      const inRange = target !== null && (target.x - at.x) ** 2 + (target.y - at.y) ** 2 <= TURRET.range ** 2
      if (turret.hallucinateIn <= 0 && turret.cooldown === 0) {
        turret.aim = random.range(0, Math.PI * 2)
        turret.hallucinateIn = random.range(TURRET.hallucinateMin, TURRET.hallucinateMax)
        fire(turret.aim)
        events.fx.emit({ type: "hallucination", x: at.x, y: at.y })
      } else if (target && inRange) {
        turret.aim = angleTo(at, target)
        if (turret.cooldown === 0) fire(turret.aim)
      }
      match.data.turret.set(turret)
    }
  }
)
