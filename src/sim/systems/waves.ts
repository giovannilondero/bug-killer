import * as Random from "@typeonce/ritmo-math/Random"

import { arenaOf } from "../../content/arenas.ts"
import { DT, ENDLESS, PARTY, WAVE_INTERVAL } from "../constants.ts"
import { makeBoss, makeBug } from "../drafts.ts"
import { edgePoint } from "../math.ts"
import { BossRead, BugRead, PlayerRead, standing } from "../queries.ts"
import { Boss, Bug, Fx, Game, LevelSpec, Rng, Run, Tiers } from "../schema.ts"
import { ticketTypeAt, tierOf } from "../tiers.ts"

/**
 * The sprint's pacing: releases the level's backlog in waves, brings in the
 * boss when the backlog is empty, and decides when the level is cleared or
 * lost. In endless mode the backlog never empties: bugs are drawn at random,
 * a boss steps in every few waves, and each one beaten makes the next round
 * tougher. A bigger team gets bigger waves and a tougher boss; the run is
 * lost when every developer is down. Also runs the combo timer and the clocks.
 */
export const WavesSystem = Game.System(
  "BugKiller/Waves",
  {
    queries: { player: PlayerRead, bugs: BugRead, bosses: BossRead },
    resources: {
      level: Game.System.readResource(LevelSpec),
      run: Game.System.writeResource(Run),
      rng: Game.System.writeResource(Rng),
      tiers: Game.System.readResource(Tiers)
    },
    events: { fx: Game.System.writeEvent(Fx) },
    commands: Game.System.commands(Game.System.spawns(Bug, Boss))
  },
  ({ queries, resources, events, commands }) => {
    const level = resources.level.get()
    const arena = arenaOf(level)
    const run = { ...resources.run.get() }
    const team = queries.player.each()
    const up = standing(team)
    const extra = Math.max(0, team.length - 1)

    run.time += DT
    run.phaseTime += DT
    run.comboTimer = Math.max(0, run.comboTimer - DT)
    if (run.comboTimer === 0) {
      run.combo = 0
    }

    const setPhase = (phase: typeof run.phase) => {
      run.phase = phase
      run.phaseTime = 0
    }

    if (run.phase !== "dead" && run.phase !== "cleared" && team.length > 0 && up.length === 0) {
      setPhase("dead")
    }

    const aliveBugs = queries.bugs.each().length
    const random = Random.draw(resources.rng)

    const endless = level.endless
    if (run.phase === "waves") {
      run.waveTimer -= DT
      // Endless: the backlog is bottomless until the wave that calls the next boss.
      const backlogLeft = endless ? (run.wave < run.nextBossAt ? Infinity : 0) : level.bugs.length - run.nextBug
      const solo = endless ? Math.min(ENDLESS.maxWaveSize, level.waveSize + Math.floor(run.wave / 3)) : level.waveSize
      const waveSize = Math.round(solo * (1 + extra * PARTY.waveSizePerPlayer))
      const quiet = aliveBugs <= Math.floor(waveSize / 2)
      if (backlogLeft > 0 && (quiet || run.waveTimer <= 0) && run.time > 1.2) {
        const count = Math.min(waveSize, backlogLeft)
        const toughness = { hp: 1 + run.loop * ENDLESS.hpPerLoop, speed: Math.min(ENDLESS.maxSpeed, 1 + run.loop * ENDLESS.speedPerLoop) }
        // This wave plays at the tier it releases into: a ticket type it hasn't unlocked comes as a plain bug.
        const tier = tierOf(level, run.wave + 1)
        for (let i = 0; i < count; i++) {
          const seed = endless ? random.pick(level.bugs) : level.bugs[run.nextBug + i]
          if (!seed) {
            continue
          }
          // Away from one developer per bug, in turn, so nobody gets them all.
          const at = edgePoint(random, up[i % Math.max(1, up.length)] ?? null, arena)
          commands.spawn(makeBug({ ...seed, type: ticketTypeAt(seed.type, tier, resources.tiers.get()) }, at, { toughness }))
          events.fx.emit({ type: "spawn", x: at.x, y: at.y })
        }
        run.nextBug += count
        run.wave += 1
        run.waveTimer = endless ? Math.max(ENDLESS.minWaveInterval, WAVE_INTERVAL - run.wave * 0.4) : WAVE_INTERVAL
      }
      if (backlogLeft === 0 && aliveBugs === 0) {
        setPhase("boss")
        const at = { x: arena.width / 2, y: Math.min(360, arena.height * 0.3) }
        const boss = endless ? (endless.bosses[run.loop % endless.bosses.length] ?? level.boss) : level.boss
        commands.spawn(makeBoss(boss, at, (endless ? 1 + run.loop * ENDLESS.bossHpPerLoop : 1) * (1 + extra * PARTY.bossHpPerPlayer)))
        events.fx.emit({ type: "spawn", x: at.x, y: at.y })
      }
    } else if (run.phase === "boss") {
      if (queries.bosses.each().length === 0 && run.phaseTime > 0.5) {
        if (endless) {
          // Next round: the backlog refills, a little meaner.
          run.loop += 1
          run.nextBossAt = run.wave + endless.every
          run.waveTimer = 4
          setPhase("waves")
        } else {
          setPhase("cleared")
        }
      }
    }

    resources.run.set(run)
  }
)
