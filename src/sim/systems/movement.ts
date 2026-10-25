import * as Random from "@typeonce/ritmo-math/Random"

import { arenaOf } from "../../content/arenas.ts"
import type { Arena } from "../../content/arenas.ts"
import { DT, HOMING } from "../constants.ts"
import { centreOf, clampToArena, nearest, normalize } from "../math.ts"
import { BossRead, BugRead, BugWrite, HostileShotWrite, Moving, PickupWrite, PlayerRead, ShotWrite, standing } from "../queries.ts"
import { Body, Game, HostileShot, LevelSpec, Pickup, Position, Rng, Run, Shot, Velocity } from "../schema.ts"
import { Ops } from "@typeonce/ritmo-math"

/** Bugs crawl toward the nearest developer still standing; each workflow status moves differently. */
export const BugBrainSystem = Game.System(
  "BugKiller/BugBrain",
  {
    queries: { player: PlayerRead, bugs: BugWrite },
    resources: {
      rng: Game.System.writeResource(Rng),
      run: Game.System.readResource(Run),
      level: Game.System.readResource(LevelSpec)
    }
  },
  ({ queries, resources }) => {
    const team = standing(queries.player.each())
    const centre = centreOf(arenaOf(resources.level.get()))
    const dead = resources.run.get().phase === "dead"
    const random = Random.draw(resources.rng)
    const bugs = queries.bugs.each()
    const positions = bugs.map((match) => match.data.position.get())

    bugs.forEach((match, index) => {
      const bug = match.data.bug.get()
      const position = positions[index]!
      const age = bug.age + DT
      const target = nearest(position, team) ?? centre
      const toPlayer = normalize({ x: target.x - position.x, y: target.y - position.y })
      // Once the developer is gone the bugs wander off: nobody is fixing them anyway.
      const heading = dead ? { x: -toPlayer.x, y: -toPlayer.y } : toPlayer
      const side = { x: -heading.y, y: heading.x }
      const wobble = Ops.sin(age * 5 + index) * 0.35
      let vx = heading.x + side.x * wobble
      let vy = heading.y + side.y * wobble

      if (bug.trait === "jittery" && Math.floor(age * 3) !== Math.floor(bug.age * 3)) {
        const jump = random.range(-1, 1) * 2.4
        vx += side.x * jump
        vy += side.y * jump
      }

      // Keep a little distance from neighbours so a swarm reads as individual tickets.
      const radius = match.data.body.get().radius
      for (let j = 0; j < positions.length; j++) {
        if (j === index) continue
        const other = positions[j]!
        const dx = position.x - other.x
        const dy = position.y - other.y
        const d2 = dx * dx + dy * dy
        const min = radius * 2.1
        if (d2 > 0 && d2 < min * min) {
          const d = Math.sqrt(d2)
          vx += (dx / d) * 0.8
          vy += (dy / d) * 0.8
        }
      }

      const direction = normalize({ x: vx, y: vy })
      const spawnIn = Math.min(1, age / 0.6)
      match.data.velocity.set({ x: direction.x * bug.speed * spawnIn, y: direction.y * bug.speed * spawnIn })
      match.data.bug.set({ ...bug, age, hitFlash: Math.max(0, bug.hitFlash - DT) })
    })
  }
)

/** Integrates every moving thing and keeps bodies inside the arena. */
export const IntegrateSystem = Game.System(
  "BugKiller/Integrate",
  {
    queries: {
      moving: Moving,
      contained: Game.Query({
        selection: { position: Game.Query.write(Position), body: Game.Query.read(Body) },
        without: [Shot, HostileShot, Pickup]
      })
    },
    resources: { level: Game.System.readResource(LevelSpec) }
  },
  ({ queries, resources }) => {
    const arena = arenaOf(resources.level.get())
    for (const match of queries.moving.each()) {
      const velocity = match.data.velocity.get()
      match.data.position.update((p) => ({ x: p.x + velocity.x * DT, y: p.y + velocity.y * DT }))
    }
    for (const match of queries.contained.each()) {
      const radius = match.data.body.get().radius
      match.data.position.update((p) => clampToArena(p, radius, arena))
    }
  }
)

const outside = (p: { x: number; y: number }, arena: Arena): boolean =>
  p.x < -40 || p.y < -40 || p.x > arena.width + 40 || p.y > arena.height + 40

/** Shots and pickups expire. */
export const LifetimeSystem = Game.System(
  "BugKiller/Lifetime",
  {
    queries: { shots: ShotWrite, hostile: HostileShotWrite, pickups: PickupWrite },
    resources: { level: Game.System.readResource(LevelSpec) },
    commands: Game.System.commands(Game.System.despawns(Shot, HostileShot, Pickup))
  },
  ({ queries, resources, commands }) => {
    const arena = arenaOf(resources.level.get())
    for (const match of queries.shots.each()) {
      const shot = match.data.shot.get()
      if (shot.life - DT <= 0 || outside(match.data.position.get(), arena)) {
        commands.despawn(match.entity)
      } else {
        match.data.shot.set({ ...shot, life: shot.life - DT })
      }
    }
    for (const match of queries.hostile.each()) {
      const shot = match.data.shot.get()
      if (shot.life - DT <= 0 || outside(match.data.position.get(), arena)) {
        commands.despawn(match.entity)
      } else {
        match.data.shot.set({ ...shot, life: shot.life - DT })
      }
    }
    for (const match of queries.pickups.each()) {
      const pickup = match.data.pickup.get()
      if (pickup.life - DT <= 0) {
        commands.despawn(match.entity)
      } else {
        match.data.pickup.set({ ...pickup, life: pickup.life - DT })
      }
    }
  }
)


/** Shots fired with the _strumenti_ bend toward the nearest bug in range. */
export const HomingSystem = Game.System(
  "BugKiller/Homing",
  {
    queries: {
      shots: Game.Query({
        selection: { position: Game.Query.read(Position), velocity: Game.Query.write(Velocity), shot: Game.Query.read(Shot) }
      }),
      bugs: BugRead,
      bosses: BossRead
    }
  },
  ({ queries }) => {
    const targets = [...queries.bugs.each(), ...queries.bosses.each()].map((match) => match.data.position.get())
    if (targets.length === 0) {
      return
    }
    for (const match of queries.shots.each()) {
      if (!match.data.shot.get().homing) continue
      const at = match.data.position.get()
      let nearest: { x: number; y: number } | null = null
      let best = HOMING.range ** 2
      for (const target of targets) {
        const d = (target.x - at.x) ** 2 + (target.y - at.y) ** 2
        if (d < best) {
          best = d
          nearest = target
        }
      }
      if (!nearest) continue
      const velocity = match.data.velocity.get()
      const speed = Ops.hypot(velocity.x, velocity.y)
      const heading = Ops.atan2(velocity.y, velocity.x)
      let turn = Ops.atan2(nearest.y - at.y, nearest.x - at.x) - heading
      while (turn > Math.PI) turn -= Math.PI * 2
      while (turn < -Math.PI) turn += Math.PI * 2
      const max = HOMING.turnRate * DT
      const next = heading + Math.max(-max, Math.min(max, turn))
      match.data.velocity.set({ x: Ops.cos(next) * speed, y: Ops.sin(next) * speed })
    }
  }
)
