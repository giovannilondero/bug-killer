import * as Random from "@typeonce/ritmo-math/Random"

import { text } from "../../content/i18n.ts"
import { arenaOf, arenas } from "../../content/arenas.ts"
import { DT } from "../constants.ts"
import { makeBug, makeHostileShot } from "../drafts.ts"
import type { BugSeed } from "../drafts.ts"
import { angleTo, clamp, nearest, normalize, openPoint } from "../math.ts"
import { BossWrite, BugRead, PlayerRead, standing } from "../queries.ts"
import { Bug, Fx, Game, HostileShot, Language, LevelSpec, Rng } from "../schema.ts"
import type { BossValue, Vec } from "../schema.ts"
import { Ops } from "@typeonce/ritmo-math"

const minion = (key: string, summary: string, priority: BugSeed["priority"]): BugSeed => ({ key, summary, priority, status: "Open" })

/**
 * Each boss is one of the level's worst tickets, and fights like it:
 * the dispenser that never stops, the app that crashes and restarts
 * somewhere else, the login that wants a second factor, and the
 * `undefined` that is everywhere.
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

    for (const match of queries.bosses.each()) {
      const position = match.data.position.get()
      const target = nearest(position, team) ?? team[0]!
      const boss: BossValue = { ...match.data.boss.get() }
      boss.age += DT
      boss.timer -= DT
      boss.shield = Math.max(0, boss.shield - DT)
      boss.hitFlash = Math.max(0, boss.hitFlash - DT)
      const rage = 1 - boss.hp / boss.maxHp
      const aim = angleTo(position, target)
      const fire = (angle: number, speed: number) => commands.spawn(makeHostileShot(position, angle, speed, boss.shotText))
      const ring = (count: number, speed: number, offset: number) => {
        for (let i = 0; i < count; i++) fire(offset + (i / count) * Math.PI * 2, speed)
      }
      const chase = (speed: number): Vec => {
        const d = normalize({ x: target.x - position.x, y: target.y - position.y })
        return { x: d.x * speed, y: d.y * speed }
      }
      let velocity: Vec = { x: 0, y: 0 }

      switch (boss.pattern) {
        case "dispenser": {
          // Pours for a few seconds, then stops "for timeout".
          velocity = chase(35 + rage * 40)
          const pouring = boss.volley % 2 === 0
          if (pouring && boss.timer > 0 && Math.floor(boss.age * 14) !== Math.floor((boss.age - DT) * 14)) {
            const spin = boss.age * (1.6 + rage)
            fire(spin, 210)
            fire(spin + Math.PI, 210)
            if (rage > 0.5) fire(spin + Math.PI / 2, 190)
          }
          if (boss.timer <= 0) {
            boss.volley += 1
            boss.timer = pouring ? 1.6 : 3.2
            if (!pouring) {
              events.fx.emit({ type: "bossPhase", x: position.x, y: position.y, text: strings.bossPhase.dispenserRestart })
            }
          }
          break
        }
        case "crash": {
          velocity = chase(60)
          if (boss.timer <= 0) {
            const to = openPoint(random, target, 320, arena)
            events.fx.emit({ type: "teleport", x: position.x, y: position.y })
            match.data.position.set(to)
            events.fx.emit({ type: "teleport", x: to.x, y: to.y })
            boss.volley += 1
            boss.timer = 2.6 - rage
            // Restarting, it sprays crash reports all around.
            ring(12 + Math.round(rage * 8), 230, random.range(0, Math.PI))
            if (boss.volley % 2 === 0 && minions < 8) {
              for (let i = 0; i < 2; i++) {
                commands.spawn(makeBug(minion(`CRASH-${boss.volley}${i}`, strings.minions.crash, "Low"), { x: to.x + (i ? 50 : -50), y: to.y }))
              }
            }
            velocity = { x: 0, y: 0 }
          }
          break
        }
        case "twoFactor": {
          // Circles the arena centre, wide as the arena; phase two is the second factor, faster and angrier.
          const t = boss.age * (boss.phase === 1 ? 0.5 : 0.8)
          const goal = {
            x: arena.width / 2 + Ops.cos(t) * 420 * (arena.width / arenas.normal.width),
            y: arena.height / 2 + Ops.sin(t) * 260 * (arena.height / arenas.normal.height)
          }
          const d = normalize({ x: goal.x - position.x, y: goal.y - position.y })
          const speed = boss.phase === 1 ? 160 : 215
          velocity = { x: d.x * speed, y: d.y * speed }
          if (boss.timer <= 0) {
            const shots = boss.phase === 1 ? 3 : 5
            for (let i = 0; i < shots; i++) fire(aim + (i - (shots - 1) / 2) * 0.16, boss.phase === 1 ? 260 : 320)
            boss.volley += 1
            if (boss.phase === 2 && boss.volley % 3 === 0) ring(14, 200, aim)
            boss.timer = boss.phase === 1 ? 1.1 : 0.75
          }
          break
        }
        case "undefined": {
          velocity = chase(50 + rage * 50)
          if (boss.timer <= 0) {
            boss.volley += 1
            const step = boss.volley % 3
            if (step === 0) {
              ring(16 + Math.round(rage * 10), 200, boss.age)
            } else if (step === 1) {
              for (let i = -2; i <= 2; i++) fire(aim + i * 0.12, 300)
            } else if (minions < 10) {
              for (let i = 0; i < 3; i++) {
                const angle = (i / 3) * Math.PI * 2 + boss.age
                commands.spawn(makeBug(
                  minion(`NULL-${boss.volley}${i}`, strings.minions.null, rage > 0.5 ? "High" : "Medium"),
                  { x: clamp(position.x + Ops.cos(angle) * 90, 40, arena.width - 40), y: clamp(position.y + Ops.sin(angle) * 90, 40, arena.height - 40) }
                ))
              }
            } else {
              ring(10, 260, aim)
            }
            boss.timer = 1.5 - rage * 0.6
          }
          break
        }
      }

      match.data.velocity.set(velocity)
      match.data.boss.set(boss)
    }
  }
)
