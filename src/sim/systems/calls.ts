import * as Random from "@typeonce/ritmo-math/Random"
import { Ops } from "@typeonce/ritmo-math"

import { text } from "../../content/i18n.ts"
import { arenaOf } from "../../content/arenas.ts"
import type { Arena } from "../../content/arenas.ts"
import { CALLS, DT } from "../constants.ts"
import { makePickup } from "../drafts.ts"
import { clamp, distanceSquared } from "../math.ts"
import { PlayerRead, standing } from "../queries.ts"
import { callKinds } from "../../content/clients.ts"
import { Calls, Chat, Fx, Game, Language, LevelSpec, Pickup, Rng, Run, Tiers } from "../schema.ts"
import type { CallValue, PickupKind, Vec } from "../schema.ts"
import { tierOf, unlocked } from "../tiers.ts"

const rewards: ReadonlyArray<PickupKind> = ["hotfix", "refactor", "coffee", "unitTest", "revert", "pizza", "pairProgramming", "codeFreeze"]

const MARGIN = 140

/** A point in the arena between `near` and `far` from the player, away from the walls. */
const somewhere = (random: Random.Random, arena: Arena, from: Vec, near: number, far: number): Vec => {
  const angle = random.range(0, Math.PI * 2)
  const distance = random.range(near, far)
  return {
    x: clamp(from.x + Ops.cos(angle) * distance, MARGIN, arena.width - MARGIN),
    y: clamp(from.y + Ops.sin(angle) * distance, MARGIN, arena.height - MARGIN)
  }
}

/**
 * Bonus calls. Every so often a client starts a Meet ("got five minutes?")
 * or writes on Slack: stand in the meeting room long enough, or go read
 * every message, before they give up. Answering pays story points and a
 * power-up; ignoring them costs nothing, unlike a mission. With a team,
 * whoever is closest answers.
 */
export const CallSystem = Game.System(
  "BugKiller/Calls",
  {
    queries: { player: PlayerRead },
    resources: {
      level: Game.System.readResource(LevelSpec),
      language: Game.System.readResource(Language),
      tiers: Game.System.readResource(Tiers),
      run: Game.System.writeResource(Run),
      calls: Game.System.writeResource(Calls),
      rng: Game.System.writeResource(Rng)
    },
    events: { chat: Game.System.writeEvent(Chat), fx: Game.System.writeEvent(Fx) },
    commands: Game.System.commands(Game.System.spawns(Pickup))
  },
  ({ queries, resources, events, commands }) => {
    const run = resources.run.get()
    if (run.phase !== "waves" && run.phase !== "boss") {
      return
    }
    const team = standing(queries.player.each())
    const lead = team[0]
    if (!lead) {
      return
    }
    // Rooms and messages appear around the first developer still standing.
    let me = lead
    const state = { ...resources.calls.get() }
    const arena = arenaOf(resources.level.get())
    const random = Random.draw(resources.rng)
    const strings = text[resources.language.get()]
    const say = (client: CallValue["client"], line: string) => strings.people[client].voice(line, (n) => random.integer(0, Math.max(1, n)))

    if (state.active === null) {
      state.nextIn -= DT
      // Clients book meetings during the boss fight too: they always do.
      const client = state.nextIn <= 0 ? random.pick(resources.level.get().clients.filter((id) => id !== "tobia")) : undefined
      if (client) {
        const kind = random.pick(callKinds) ?? "meet"
        let call: CallValue
        if (kind === "meet") {
          const title = random.pick(strings.calls.meetTitles) ?? ""
          call = {
            kind,
            client,
            title,
            room: somewhere(random, arena, me, 320, 620),
            radius: CALLS.meet.radius,
            pings: [],
            progress: 0,
            goal: CALLS.meet.goal,
            timeLeft: CALLS.meet.duration,
            duration: CALLS.meet.duration
          }
          events.chat.emit({ type: "call", kind, client, text: say(client, strings.calls.meetInvite(title, CALLS.meet.duration)) })
        } else {
          const thread = random.pick(strings.calls.slackThreads) ?? []
          const pings = thread.slice(0, CALLS.slack.pings).map((line) => ({ ...somewhere(random, arena, me, 240, 600), text: line }))
          call = {
            kind,
            client,
            title: thread[0] ?? "",
            room: me,
            radius: 0,
            pings,
            progress: 0,
            goal: pings.length,
            timeLeft: CALLS.slack.duration,
            duration: CALLS.slack.duration
          }
          events.chat.emit({ type: "call", kind, client, text: say(client, strings.calls.slackInvite(CALLS.slack.duration)) })
        }
        state.active = call
      }
    } else {
      const call = { ...state.active, pings: [...state.active.pings] }
      call.timeLeft -= DT
      if (call.kind === "meet") {
        const inside = team.find((at) => distanceSquared(at, call.room) <= call.radius ** 2)
        if (inside) {
          me = inside
          call.progress = Math.min(call.goal, call.progress + DT)
        }
      } else {
        call.pings = call.pings.filter((ping) => {
          const reader = team.find((at) => distanceSquared(at, ping) <= CALLS.slack.reach ** 2)
          if (!reader) return true
          me = reader
          call.progress += 1
          events.fx.emit({ type: "ping", x: ping.x, y: ping.y, text: ping.text })
          return false
        })
      }

      const lines = strings.calls.outcomes[call.kind]
      if (call.progress >= call.goal) {
        const points = call.kind === "meet" ? CALLS.meet.points : CALLS.slack.points
        state.answered += 1
        resources.run.set({ ...run, score: run.score + points })
        events.chat.emit({ type: "outcome", client: call.client, text: say(call.client, random.pick(lines.answered) ?? "ok"), success: true })
        events.fx.emit({ type: "callDone", x: me.x, y: me.y, kind: call.kind, points })
        const angle = random.range(0, Math.PI * 2)
        const reward = random.pick(unlocked(rewards, tierOf(resources.level.get(), run.wave), resources.tiers.get()))
        if (reward) commands.spawn(makePickup(reward, {
          x: clamp(me.x + Ops.cos(angle) * 90, 40, arena.width - 40),
          y: clamp(me.y + Ops.sin(angle) * 90, 40, arena.height - 40)
        }))
        state.active = null
        state.nextIn = random.range(CALLS.min, CALLS.max)
      } else if (call.timeLeft <= 0) {
        state.missed += 1
        events.chat.emit({ type: "outcome", client: call.client, text: say(call.client, random.pick(lines.missed) ?? "..."), success: false })
        state.active = null
        state.nextIn = random.range(CALLS.min, CALLS.max)
      } else {
        state.active = call
      }
    }
    resources.calls.set(state)
  }
)
