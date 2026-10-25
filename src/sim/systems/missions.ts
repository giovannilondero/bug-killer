import * as Random from "@typeonce/ritmo-math/Random"

import { priorities } from "../../content/bugs.ts"
import type { Priority } from "../../content/bugs.ts"
import { clients, missionKinds } from "../../content/clients.ts"
import type { Client, ClientId, MissionKind } from "../../content/clients.ts"
import { text } from "../../content/i18n.ts"
import type { Strings } from "../../content/i18n.ts"
import { arenaOf } from "../../content/arenas.ts"
import { DT } from "../constants.ts"
import { makeBug, makePickup } from "../drafts.ts"
import { centreOf, clamp, edgePoint } from "../math.ts"
import { BugRead, PlayerRead, standing } from "../queries.ts"
import { Bug, BugFixed, Chat, Fx, Game, Language, LevelSpec, Missions, Pickup, PlayerHurt, Rng, Run, Tiers } from "../schema.ts"
import type { BugValue, MissionValue, PickupKind } from "../schema.ts"
import { tierOf, unlocked } from "../tiers.ts"
import { Ops } from "@typeonce/ritmo-math"

const MISSION_POINTS = 400
const ESCALATION_BUGS = 3

const rewards: ReadonlyArray<PickupKind> = ["hotfix", "refactor", "coffee", "unitTest", "revert", "pizza", "pairProgramming", "pushForce"]

const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

const rank = (priority: Priority): number => priorities.indexOf(priority)

interface Draft {
  readonly kind: MissionKind
  /** The request, given the seconds this client actually allows. */
  readonly text: (seconds: number) => string
  readonly goal: number
  readonly duration: number
  readonly target: string | null
  readonly priority: Priority | null
}

/** Builds one mission from what is in the arena right now; `null` when it cannot be offered. */
const draftMission = (kind: MissionKind, bugs: ReadonlyArray<BugValue>, random: Random.Random, say: Strings["missions"]): Draft | null => {
  switch (kind) {
    case "killCount": {
      const goal = random.integer(4, 8)
      const duration = 14 + goal * 2
      return { kind, goal, duration, target: null, priority: null, text: (seconds) => say.killCount(goal, seconds) }
    }
    case "killTarget": {
      const candidates = bugs.filter((bug) => !bug.regression)
      if (candidates.length === 0) return null
      const worst = Math.max(...candidates.map((bug) => rank(bug.priority)))
      const bug = random.pick(candidates.filter((b) => rank(b.priority) === worst))
      if (!bug) return null
      return {
        kind,
        goal: 1,
        duration: 16,
        target: bug.key,
        priority: null,
        text: (seconds) => say.killTarget(bug.key, truncate(bug.summary, 60), seconds)
      }
    }
    case "noHit": {
      const goal = random.integer(10, 16)
      return { kind, goal, duration: goal, target: null, priority: null, text: say.noHit }
    }
    case "combo": {
      const goal = random.integer(6, 11)
      return { kind, goal, duration: 24, target: null, priority: null, text: () => say.combo(goal) }
    }
    case "priorityHunt": {
      const counts = new Map<Priority, number>()
      for (const bug of bugs) counts.set(bug.priority, (counts.get(bug.priority) ?? 0) + 1)
      const priority = [...counts.keys()].sort((a, b) => rank(b) - rank(a))[0]
      if (!priority) return null
      const goal = Math.min(3, counts.get(priority) ?? 1)
      return {
        kind,
        goal,
        duration: 22,
        target: null,
        priority,
        text: () => say.priorityHunt(goal, priority)
      }
    }
  }
}

/**
 * The clients. Every so often one of the level's clients writes in the chat
 * with a mission; finishing it pays story points and a power-up, failing it
 * adds scope creep to the arena.
 */
export const MissionDirectorSystem = Game.System(
  "BugKiller/MissionDirector",
  {
    queries: { player: PlayerRead, bugs: BugRead },
    resources: {
      level: Game.System.readResource(LevelSpec),
      language: Game.System.readResource(Language),
      tiers: Game.System.readResource(Tiers),
      missions: Game.System.writeResource(Missions),
      run: Game.System.writeResource(Run),
      rng: Game.System.writeResource(Rng)
    },
    events: {
      fixed: Game.System.readEvent(BugFixed),
      hurt: Game.System.readEvent(PlayerHurt),
      chat: Game.System.writeEvent(Chat),
      fx: Game.System.writeEvent(Fx)
    },
    commands: Game.System.commands(Game.System.spawns(Bug, Pickup))
  },
  ({ queries, resources, events, commands }) => {
    const fixed = events.fixed.all()
    const hurt = events.hurt.all()
    const run = { ...resources.run.get() }
    if (run.phase !== "waves" && run.phase !== "boss") {
      return
    }
    const level = resources.level.get()
    const arena = arenaOf(level)
    const state = { ...resources.missions.get() }
    const random = Random.draw(resources.rng)
    const pickInt = (n: number) => random.integer(0, Math.max(1, n))
    const strings = text[resources.language.get()]
    const say = (client: ClientId, line: string) => strings.people[client].voice(line, pickInt)
    const playerAt = standing(queries.player.each())[0] ?? centreOf(arena)
    const bugs = queries.bugs.each().map((match) => match.data.bug.get())

    if (state.active === null) {
      state.nextIn -= DT
      if (state.nextIn <= 0) {
        const client = level.clients[state.turn % level.clients.length] ?? "ugo"
        const profile: Client = clients[client]
        state.turn += 1
        // During the boss there are no tickets to count: every client wants a clean demo instead.
        const preferred: MissionKind = run.phase === "boss"
          ? "noHit"
          : random.weighted(missionKinds, (kind) => profile.missions[kind] ?? 0) ?? "killCount"
        const draft = draftMission(preferred, bugs, random, strings.missions) ?? draftMission("killCount", bugs, random, strings.missions)
        if (draft) {
          const duration = Math.round(draft.duration * (draft.kind === "noHit" ? 1 : profile.patience))
          const mission: MissionValue = {
            client,
            kind: draft.kind,
            text: say(client, draft.text(duration)),
            goal: draft.goal,
            progress: 0,
            timeLeft: duration,
            duration,
            target: draft.target,
            priority: draft.priority
          }
          state.active = mission
          events.chat.emit({ type: "mission", client, text: mission.text })
        }
      }
    } else {
      const mission = { ...state.active }
      mission.timeLeft -= DT
      let failed = false
      switch (mission.kind) {
        case "killCount":
          mission.progress += fixed.length
          break
        case "killTarget":
          if (fixed.some((event) => event.key === mission.target)) mission.progress = 1
          else if (!bugs.some((bug) => bug.key === mission.target)) {
            // Fixed by someone else (a bomb counts as yours, a reopen keeps it alive).
            mission.progress = 1
          }
          break
        case "priorityHunt":
          mission.progress += fixed.filter((event) => event.priority === mission.priority).length
          break
        case "combo":
          mission.progress = Math.max(mission.progress, run.combo)
          break
        case "noHit":
          if (hurt.length > 0) failed = true
          else mission.progress = Math.min(mission.goal, mission.progress + DT)
          break
      }

      const won = mission.kind === "noHit" ? !failed && mission.timeLeft <= 0 : mission.progress >= mission.goal
      if (!won && (failed || mission.timeLeft <= 0)) {
        run.missionsLost += 1
        run.escalations += 1
        const line = random.pick(strings.outcomes[mission.client].failure) ?? "..."
        events.chat.emit({ type: "outcome", client: mission.client, text: say(mission.client, line), success: false })
        for (let i = 0; i < ESCALATION_BUGS; i++) {
          const at = edgePoint(random, playerAt, arena)
          const summary = random.pick(strings.scopeCreep) ?? ""
          commands.spawn(makeBug({ key: `ESC-${run.escalations}${i + 1}`, summary, priority: i === 0 ? "High" : "Medium", status: "Open" }, at))
          events.fx.emit({ type: "spawn", x: at.x, y: at.y })
        }
        state.active = null
        state.nextIn = level.clientEvery
      } else if (won) {
        run.missionsWon += 1
        run.score += MISSION_POINTS
        const line = random.pick(strings.outcomes[mission.client].success) ?? "ok"
        events.chat.emit({ type: "outcome", client: mission.client, text: say(mission.client, line), success: true })
        const reward = random.pick(unlocked(rewards, tierOf(level, run.wave), resources.tiers.get()))
        const angle = random.range(0, Math.PI * 2)
        if (reward) commands.spawn(makePickup(reward, {
          x: clamp(playerAt.x + Ops.cos(angle) * 90, 40, arena.width - 40),
          y: clamp(playerAt.y + Ops.sin(angle) * 90, 40, arena.height - 40)
        }))
        state.active = null
        state.nextIn = level.clientEvery
      } else {
        state.active = mission
      }
    }

    resources.missions.set(state)
    resources.run.set(run)
  }
)
