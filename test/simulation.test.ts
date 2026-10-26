import assert from "node:assert/strict"
import { test } from "node:test"

import { endlessLevel, levels } from "../src/content/levels.ts"
import type { Locale } from "../src/content/i18n.ts"
import type { Level } from "../src/content/levels.ts"
import { createSimulation, idleInput } from "../src/sim/simulation.ts"
import type { View } from "../src/sim/simulation.ts"
import { makeBoss, makeBug, makePickup } from "../src/sim/drafts.ts"
import type { BugSeed } from "../src/sim/drafts.ts"
import { contentTiers, isUnlocked, tierOf } from "../src/sim/tiers.ts"
import { hasStatus } from "../src/sim/statuses.ts"
import type { StatusValue } from "../src/sim/statuses.ts"
import { Boss, Bug, Game, Pickup, pickupKinds } from "../src/sim/schema.ts"
import type { ChatValue, FxValue, InputValue, PickupKind, Vec } from "../src/sim/schema.ts"

/** How close the autopilot lets a bug come before it backs off. */
const strafeRange = 220

/** A bot that kites the nearest bug and shoots at it, and drops a Breakpoint when one gets close: the same intents a player sends. */
const autopilot = (view: () => View | null, tick: () => number) => ({
  snapshot: (): InputValue => {
    const v = view()
    if (!v?.player) return idleInput
    const me = v.player.position
    const targets = [...v.bugs, ...v.bosses].map((t) => t.position)
    let nearest = targets[0]
    let best = Infinity
    for (const t of targets) {
      const d = Math.hypot(t.x - me.x, t.y - me.y)
      if (d < best) {
        best = d
        nearest = t
      }
    }
    if (!nearest) return { ...idleInput, move: { x: Math.sin(tick() / 40), y: 0 } }
    const away = { x: me.x - nearest.x, y: me.y - nearest.y }
    const length = Math.hypot(away.x, away.y) || 1
    const strafe = best < strafeRange ? 1 : -0.4
    return {
      move: { x: (away.x / length) * strafe + (-away.y / length) * 0.6, y: (away.y / length) * strafe + (away.x / length) * 0.6 },
      aim: nearest,
      fire: true,
      dash: best < 60,
      bomb: v.bugs.length > 12,
      // Dropped as it starts to back off, one per spot: whatever chases it walks onto the trap.
      breakpoint: best < strafeRange && v.player.breakpoints > 0 && !v.breakpoints.some((b) => Math.hypot(b.position.x - me.x, b.position.y - me.y) < 200)
    }
  }
})

type Pilot = (view: () => View | null, tick: () => number) => { snapshot: () => InputValue }

/** The autopilot, but it answers calls: it walks to the Meet room or the nearest Slack message. */
const answeringPilot: Pilot = (view, tick) => {
  const base = autopilot(view, tick)
  return {
    snapshot: () => {
      const input = base.snapshot()
      const v = view()
      const call = v?.calls.active
      if (!v?.player || !call) return input
      const me = v.player.position
      const goal = call.kind === "meet"
        ? call.room
        : [...call.pings].sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0]
      if (!goal) return input
      const d = Math.hypot(goal.x - me.x, goal.y - me.y) || 1
      return d < 20 ? { ...input, move: { x: 0, y: 0 } } : { ...input, move: { x: (goal.x - me.x) / d, y: (goal.y - me.y) / d } }
    }
  }
}

const play = (level: Level, seconds: number, seed = 7, locale: Locale = "it", pilot: Pilot = autopilot) => {
  const fx: Array<FxValue> = []
  const chat: Array<ChatValue> = []
  let current: View | null = null
  let frame = 0
  const made = createSimulation({
    level,
    seed,
    locale,
    input: pilot(() => current, () => frame),
    presentation: { fx: (e) => fx.push(e), chat: (e) => chat.push(e) }
  })
  if (!made.ok) throw new Error(`the runtime does not start: ${JSON.stringify(made.error)}`)
  const sim = made.value
  current = sim.view()
  for (; frame < seconds * 60; frame++) {
    const ticked = sim.step()
    assert.ok(ticked.ok, `tick ${frame} fails: ${JSON.stringify(!ticked.ok && ticked.error)}`)
    const next = sim.view()
    current = next
    if (next.run.phase === "cleared" || next.run.phase === "dead") break
  }
  return { view: sim.view(), fx, chat, frames: frame }
}

test("bugs from the backlog spawn and get fixed", () => {
  const { view, fx } = play(levels[0]!, 40)
  assert.ok(view.run.fixed.length > 0, "at least one ticket is fixed")
  assert.ok(view.run.score > 0)
  assert.ok(fx.some((e) => e.type === "kill"))
  for (const fixed of view.run.fixed) {
    assert.match(fixed.key, /^GLC-|-REG|ESC-|CRASH-|NULL-/)
  }
})

test("a client shows up with a mission", () => {
  const { chat } = play(levels[3]!, 30)
  const first = chat.find((m) => m.type === "mission")
  if (!first) throw new Error("no client mission arrived")
  if (first.client === "ugo") {
    assert.equal(first.text, first.text.toUpperCase(), "Ugo writes in capitals")
    assert.match(first.text, /!!/)
  }
})

test("a client resurrects a fixed bug, laughing", () => {
  const { view, chat, fx } = play(levels[3]!, 60)
  const message = chat.find((m) => m.type === "resurrect")
  if (!message || message.type !== "resurrect") throw new Error("no bug was resurrected")
  assert.match(message.text, /fixato/i)
  assert.match(message.text, /ah|lol/i)
  assert.match(message.text, /lavora più duramente/i)
  assert.ok(fx.some((e) => e.type === "resurrect" && e.key === message.key))
  assert.ok(view.interruptions.resurrections >= 1)
})

test("Tobia asks about the strumenti when you are slow, and leaves them", () => {
  const fx: Array<FxValue> = []
  const chat: Array<ChatValue> = []
  // A developer who never shoots: the slowest possible.
  const made = createSimulation({ level: levels[0]!, seed: 3, locale: "it", input: { snapshot: () => idleInput }, presentation: { fx: (e) => fx.push(e), chat: (e) => chat.push(e) } })
  if (!made.ok) throw new Error("the runtime does not start")
  const sim = made.value
  let sawTools = false
  for (let frame = 0; frame < 30 * 60; frame++) {
    assert.ok(sim.step().ok)
    if (sim.view().pickups.some((p) => p.kind === "tools")) sawTools = true
  }
  const nudge = chat.find((m) => m.type === "nudge")
  if (!nudge) throw new Error("Tobia never wrote")
  assert.equal(nudge.client, "tobia")
  assert.match(nudge.text, /_strumenti_/)
  assert.ok(sawTools, "Tobia leaves the strumenti pickup")
})

test("clients write in English by default", () => {
  const fx: Array<FxValue> = []
  const chat: Array<ChatValue> = []
  const made = createSimulation({ level: levels[0]!, seed: 3, input: { snapshot: () => idleInput }, presentation: { fx: (e) => fx.push(e), chat: (e) => chat.push(e) } })
  if (!made.ok) throw new Error("the runtime does not start")
  for (let frame = 0; frame < 30 * 60; frame++) assert.ok(made.value.step().ok)
  const nudge = chat.find((m) => m.type === "nudge")
  if (!nudge) throw new Error("Tobia never wrote")
  assert.match(nudge.text, /_tools_/)
  const mission = chat.find((m) => m.type === "mission")
  if (!mission) throw new Error("no client mission arrived")
  assert.doesNotMatch(mission.text, /secondi|Buongiorno|Ciao|Guarda/)
})

test("an English run resurrects bugs in English", () => {
  const { chat } = play(levels[3]!, 60, 7, "en")
  const message = chat.find((m) => m.type === "resurrect")
  if (!message) throw new Error("no bug was resurrected")
  assert.match(message.text, /not fixed yet/i)
  assert.match(message.text, /work harder/i)
})

test("the same seed and input replay the same run", () => {
  const a = play(levels[1]!, 20, 42)
  const b = play(levels[1]!, 20, 42)
  assert.deepEqual(a.view.run, b.view.run)
})

test("every level can be finished by the autopilot or kills it fairly", () => {
  for (const level of levels) {
    const { view } = play(level, 420)
    assert.ok(view.run.phase === "cleared" || view.run.phase === "dead" || view.run.phase === "boss", `${level.id} ends in ${view.run.phase} after ${view.run.time.toFixed(0)}s, ${view.run.fixed.length} fixed`)
    console.log(`${level.id}: ${view.run.phase} at ${view.run.time.toFixed(0)}s, fixed ${view.run.fixed.length}/${level.bugs.length + 1}, missions ${view.run.missionsWon}/${view.run.missionsWon + view.run.missionsLost}, hits ${view.run.hitsTaken}`)
  }
})

test("a client calls on Meet or Slack, and answering pays a bonus", () => {
  const { view, chat, fx } = play(levels[2]!, 90, 7, "it", answeringPilot)
  const ring = chat.find((m) => m.type === "call")
  if (!ring || ring.type !== "call") throw new Error(`nobody called: ${view.run.phase} at ${view.run.time.toFixed(0)}s, calls ${JSON.stringify(view.calls)}`)
  assert.match(ring.text, ring.kind === "meet" ? /Meet/ : /Slack/)
  assert.ok(view.calls.answered >= 1, `answered ${view.calls.answered}, missed ${view.calls.missed}`)
  assert.ok(fx.some((e) => e.type === "callDone"))
})

test("an ignored call just runs out, and the client lets you know", () => {
  const { view, chat } = play(levels[2]!, 90)
  assert.ok(view.calls.missed >= 1, `missed ${view.calls.missed}, answered ${view.calls.answered}`)
  const ring = chat.findIndex((m) => m.type === "call")
  const reply = chat.slice(ring + 1).find((m) => m.type === "outcome" && m.client === chat[ring]!.client)
  assert.ok(reply && reply.type === "outcome" && !reply.success)
})

test("endless never runs out: after a boss the next round starts, tougher", () => {
  // A short loop: a boss every wave, and a boss that goes down fast.
  const quick = { ...endlessLevel, waveSize: 2, endless: { bosses: endlessLevel.endless!.bosses.map((b) => ({ ...b, hp: 4 })), every: 1 } }
  const { view } = play(quick, 120)
  assert.notEqual(view.run.phase, "cleared", "endless is never cleared")
  assert.ok(view.run.loop >= 1, `bosses beaten: ${view.run.loop}, phase ${view.run.phase} at ${view.run.time.toFixed(0)}s`)
  assert.ok(view.run.wave > 1)
})


// --- Playing together ---------------------------------------------------

const crew = (names: ReadonlyArray<string>) => names.map((name, slot) => ({ slot, name, color: `#00000${slot}` }))

/** What `slot` sees: the same view, following its own developer. */
const seat = (v: View | null, slot: number): View | null => v && { ...v, player: v.players.find((p) => p.slot === slot) ?? null }

/** The autopilot, but it runs to a teammate who is down and stands there until they are back. */
const rescuer = (slot: number): Pilot => (view, tick) => {
  const base = autopilot(() => seat(view(), slot), tick)
  return {
    snapshot: () => {
      const input = base.snapshot()
      const v = seat(view(), slot)
      const down = v?.players.find((p) => p.hp <= 0)
      if (!v?.player || !down) return input
      const me = v.player.position
      const d = Math.hypot(down.position.x - me.x, down.position.y - me.y) || 1
      return { ...input, move: d < 30 ? { x: 0, y: 0 } : { x: (down.position.x - me.x) / d, y: (down.position.y - me.y) / d }, bomb: true }
    }
  }
}

const idlePilot: Pilot = () => ({ snapshot: () => idleInput })

const playTogether = (level: Level, seconds: number, pilots: ReadonlyArray<Pilot>, seed = 7) => {
  const fx: Array<FxValue> = []
  const chat: Array<ChatValue> = []
  let current: View | null = null
  let frame = 0
  const seats = pilots.map((pilot, slot) => pilot(() => seat(current, slot), () => frame))
  const made = createSimulation({
    level,
    seed,
    locale: "it",
    party: crew(pilots.map((_, slot) => `dev${slot}`)),
    inputs: { snapshot: () => seats.map((s) => s.snapshot()) },
    presentation: { fx: (e) => fx.push(e), chat: (e) => chat.push(e) }
  })
  if (!made.ok) throw new Error(`the runtime does not start: ${JSON.stringify(made.error)}`)
  const sim = made.value
  current = sim.view()
  for (; frame < seconds * 60; frame++) {
    const ticked = sim.step()
    assert.ok(ticked.ok, `tick ${frame} fails: ${JSON.stringify(!ticked.ok && ticked.error)}`)
    current = sim.view()
    if (current.run.phase === "cleared" || current.run.phase === "dead") break
  }
  return { view: sim.view(), fx, chat, frames: frame }
}

test("three developers share the arena: a bigger backlog per wave, and everyone's points", () => {
  const { view, fx } = playTogether(levels[1]!, 25, [autopilot, autopilot, autopilot].map((pilot, slot) => (v: () => View | null, t: () => number) => pilot(() => seat(v(), slot), t)))
  assert.deepEqual(view.players.map((p) => p.name), ["dev0", "dev1", "dev2"])
  const spawnedFirstWave = fx.filter((e) => e.type === "spawn").length
  assert.ok(spawnedFirstWave >= Math.round(levels[1]!.waveSize * 2), `first waves spawned ${spawnedFirstWave}`)
  const scorers = view.players.filter((p) => p.points > 0)
  assert.ok(scorers.length >= 2, `points: ${view.players.map((p) => p.points).join(", ")}`)
  const shared = view.players.reduce((sum, p) => sum + p.fixed, 0)
  assert.ok(shared > 0)
})

test("a developer who burns out waits for a teammate, who brings them back", () => {
  const { view, fx } = playTogether(levels[0]!, 120, [rescuer(0), idlePilot])
  const down = fx.findIndex((e) => e.type === "down" && e.slot === 1)
  assert.ok(down >= 0, "the idle developer goes down")
  const revived = fx.findIndex((e) => e.type === "revived" && e.slot === 1)
  assert.ok(revived > down, `revived: ${revived}, phase ${view.run.phase} at ${view.run.time.toFixed(0)}s`)
})

test("the run is lost only when the whole team is down", () => {
  const { view, fx } = playTogether(levels[0]!, 120, [idlePilot, idlePilot])
  assert.equal(view.run.phase, "dead")
  assert.ok(view.players.every((p) => p.hp <= 0))
  assert.ok(fx.some((e) => e.type === "down"), "the first one down is announced")
})

// --- The AI turret ---------------------------------------------------------

test("the rare AI drop sets down a turret that fixes bugs on its own, and sometimes hallucinates", () => {
  const fx: Array<FxValue> = []
  const made = createSimulation({
    level: levels[1]!,
    seed: 3,
    locale: "it",
    input: { snapshot: () => idleInput },
    presentation: { fx: (e) => fx.push(e), chat: () => undefined }
  })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  // Drop one right under the developer, who then never moves or shoots.
  const at = sim.view().player!.position
  const Drop = Game.System("Test/Drop", { commands: Game.System.commands(Game.System.spawns(Pickup)) }, ({ commands }) => {
    commands.spawn(makePickup("ai", { x: at.x, y: at.y }))
  })
  assert.ok(sim.runtime.tick(Game.Schedule(Drop, Game.Schedule.applyDeferred())).ok)

  let sawTurret = false
  for (let frame = 0; frame < 14 * 60 && sim.view().run.phase === "waves"; frame++) {
    assert.ok(sim.step().ok)
    if (sim.view().turrets.length > 0) sawTurret = true
  }
  const view = sim.view()
  assert.ok(sawTurret, "the pickup became a turret")
  assert.ok(fx.some((e) => e.type === "turret"))
  assert.ok(view.run.fixed.length > 0, `fixed ${view.run.fixed.length} while standing still`)
  assert.ok(view.players[0]!.points > 0, "the turret's fixes count for whoever picked it up")
  assert.ok(fx.some((e) => e.type === "hallucination"), "it made something up at least once")
  assert.equal(view.turrets.length, 0, "and after its seconds it is gone")
})

// --- Arena size ------------------------------------------------------------

test("a level with a smaller arena keeps bugs, developers and placements inside it", () => {
  const arena = { width: 900, height: 640 }
  const small: Level = { ...levels[3]!, arena }
  const fx: Array<FxValue> = []
  let current: View | null = null
  let frame = 0
  const made = createSimulation({
    level: small,
    seed: 11,
    locale: "en",
    input: answeringPilot(() => current, () => frame),
    presentation: { fx: (e) => fx.push(e), chat: () => undefined }
  })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  current = sim.view()
  const inside = (what: string, p: { x: number; y: number }) =>
    assert.ok(p.x >= 0 && p.y >= 0 && p.x <= arena.width && p.y <= arena.height, `${what} at ${p.x.toFixed(0)},${p.y.toFixed(0)} on frame ${frame}`)
  let bugsSeen = 0
  for (; frame < 120 * 60; frame++) {
    assert.ok(sim.step().ok)
    current = sim.view()
    for (const p of current.players) inside("developer", p.position)
    for (const b of current.bugs) inside(`bug ${b.key}`, b.position)
    for (const b of current.bosses) inside(`boss ${b.key}`, b.position)
    for (const p of current.pickups) inside(`pickup ${p.kind}`, p.position)
    for (const t of current.turrets) inside("turret", t.position)
    const call = current.calls.active
    if (call) {
      inside("meeting room", call.room)
      for (const ping of call.pings) inside("slack ping", ping)
    }
    bugsSeen = Math.max(bugsSeen, current.bugs.length)
    if (current.run.phase === "cleared" || current.run.phase === "dead") break
  }
  assert.ok(bugsSeen > 0, "bugs spawned")
  for (const e of fx) if (e.type === "spawn" || e.type === "resurrect" || e.type === "teleport") inside(e.type, e)
})

// --- Content tiers ---------------------------------------------------------

/** Steps a run with the autopilot and hands every view to `see`. */
const watch = (options: Omit<Parameters<typeof createSimulation>[0], "presentation" | "input">, seconds: number, see: (view: View) => void) => {
  let current: View | null = null
  let frame = 0
  const made = createSimulation({ ...options, input: answeringPilot(() => current, () => frame), presentation: { fx: () => undefined, chat: () => undefined } })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  for (; frame < seconds * 60; frame++) {
    assert.ok(sim.step().ok)
    current = sim.view()
    see(current)
    if (current.run.phase === "cleared" || current.run.phase === "dead") break
  }
  return sim.view()
}

test("endless unlocks one content tier every 3 waves, all of it by wave 18", () => {
  // Small, quick waves and no bosses in the way, so a run reaches wave 18 in a few minutes.
  const quick = { ...endlessLevel, waveSize: 1, endless: { ...endlessLevel.endless!, every: 100 } }
  const tierAt = new Map<number, number>()
  const view = watch({ level: quick, seed: 5 }, 400, (v) => {
    if (!tierAt.has(v.run.wave)) tierAt.set(v.run.wave, v.tier)
  })
  assert.ok(view.run.wave >= 18, `only reached wave ${view.run.wave}`)
  // `run.wave` is the wave on the floor (it counts up as each wave is released): waves 1–3 play at tier 0, 16–18 at tier 5.
  assert.deepEqual(
    [0, 1, 3, 4, 6, 7, 9, 10, 13, 15, 16, 18].map((wave) => tierAt.get(wave)),
    [0, 0, 0, 1, 1, 2, 2, 3, 4, 4, 5, 5]
  )
})

test("the same seed and input replay the same endless run as it climbs the tiers", () => {
  const quick = { ...endlessLevel, waveSize: 1, endless: { ...endlessLevel.endless!, every: 100 } }
  const replay = () => {
    const tiers: Array<number> = []
    const view = watch({ level: quick, seed: 11 }, 120, (v) => tiers.push(v.tier))
    return { view, tiers }
  }
  const a = replay()
  const b = replay()
  assert.ok(a.view.tier >= 2, `only reached tier ${a.view.tier}`)
  assert.deepEqual(a.tiers, b.tiers)
  assert.deepEqual(a.view, b.view)
})

test("drops, mission rewards and call rewards never offer a pickup above the level's tier", () => {
  // Pretend every pickup but Revert arrives with sprint 2 (Tobia's tools are his own visit, not a drop or a reward).
  const kept = ["revert", "tools"]
  const tiers = { ...contentTiers, ...Object.fromEntries(pickupKinds.filter((kind) => !kept.includes(kind)).map((kind) => [kind, 1])) }
  const offered = (level: Level) => {
    const kinds = new Map<number, string>()
    const view = watch({ level, seed: 5, tiers }, 150, (v) => {
      for (const pickup of v.pickups) kinds.set(pickup.id, pickup.kind)
    })
    return { kinds: [...kinds.values()], view }
  }

  // Keystone wins several missions and calls on this seed; held at tier 0 it may only offer Revert.
  const held = offered({ ...levels[2]!, tier: 0 })
  const { run, calls } = held.view
  assert.equal(held.view.tier, 0, "a campaign level stays at its own tier")
  assert.ok(run.missionsWon >= 2 && calls.answered >= 2, `${run.phase} at ${run.time.toFixed(0)}s: missions won ${run.missionsWon}, calls answered ${calls.answered}`)
  assert.deepEqual(held.kinds.filter((kind) => !kept.includes(kind)), [])
  assert.ok(held.kinds.filter((kind) => kind === "revert").length >= 5, `reverts: ${held.kinds.join(", ")}`)

  const open = offered(levels[2]!)
  assert.equal(open.view.tier, 2)
  assert.ok(open.kinds.some((kind) => !kept.includes(kind)), "a level offers what its tier unlocks")
})

test("missions and calls can reward Flame war and a Breakpoint", () => {
  // Only those two are in at Keystone's tier, so every reward has to be one of them.
  const only = ["flameWar", "breakpoint"]
  const tiers = { ...contentTiers, ...Object.fromEntries(pickupKinds.map((kind) => [kind, only.includes(kind) ? 0 : 5])) }
  let current: View | null = null
  let frame = 0
  let won = 0
  const made = createSimulation({
    level: levels[2]!,
    seed: 5,
    tiers,
    input: answeringPilot(() => current, () => frame),
    presentation: { fx: () => undefined, chat: (e) => { if (e.type === "outcome" && e.success) won += 1 } }
  })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  const seen = new Set<number>()
  const rewards: Array<string> = []
  for (; frame < 150 * 60; frame++) {
    const before = won
    assert.ok(sim.step().ok)
    current = sim.view()
    const fresh = current.pickups.filter((pickup) => !seen.has(pickup.id))
    for (const pickup of fresh) seen.add(pickup.id)
    // A reward lands on the tick the client says thanks.
    if (won > before) rewards.push(...fresh.map((pickup) => pickup.kind))
    if (current.run.phase === "cleared" || current.run.phase === "dead") break
  }
  assert.ok(won >= 4, `only ${won} missions and calls won`)
  assert.ok(rewards.length >= won, `${won} won, rewarded ${rewards.join(", ")}`)
  assert.deepEqual(rewards.filter((kind) => !only.includes(kind)), [])
  assert.ok(only.every((kind) => rewards.includes(kind)), `rewarded ${rewards.join(", ")}`)
})

// --- Weapons ---------------------------------------------------------------

/**
 * A firing range: one developer who stands still and fires to the right only
 * when told, with pickups dropped right under them.
 */
const range = (level: Level = levels[1]!) => {
  const fx: Array<FxValue> = []
  let fire = false
  let aim = { x: 0, y: 0 }
  const made = createSimulation({
    level,
    seed: 3,
    locale: "en",
    input: { snapshot: () => ({ ...idleInput, fire, aim }) },
    presentation: { fx: (e) => fx.push(e), chat: () => undefined }
  })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  const at = sim.view().player!.position
  aim = { x: at.x + 400, y: at.y }
  const wait = (seconds: number) => {
    for (let frame = 0; frame < Math.round(seconds * 60); frame++) assert.ok(sim.step().ok)
  }
  const drop = (...kinds: Array<PickupKind>) => {
    const Drop = Game.System("Test/Drop", { commands: Game.System.commands(Game.System.spawns(Pickup)) }, ({ commands }) => {
      for (const kind of kinds) commands.spawn(makePickup(kind, { x: at.x, y: at.y }))
    })
    assert.ok(sim.runtime.tick(Game.Schedule(Drop, Game.Schedule.applyDeferred())).ok)
    wait(1 / 60)
  }
  /** Pulls the trigger for one update and returns the shots it fired. */
  const volley = () => {
    const before = new Set(sim.view().shots.map((shot) => shot.id))
    fire = true
    wait(1 / 60)
    fire = false
    return sim.view().shots.filter((shot) => !before.has(shot.id))
  }
  /** How many volleys `seconds` of holding the trigger fires. */
  const hold = (seconds: number) => {
    const from = fx.filter((e) => e.type === "shoot").length
    fire = true
    wait(seconds)
    fire = false
    return fx.filter((e) => e.type === "shoot").length - from
  }
  return { sim, fx, wait, drop, volley, hold }
}

test("Pair programming fires two parallel shots until its timer ends, then the basic gun is back", () => {
  const { sim, fx, wait, drop, volley } = range()
  assert.equal(volley().length, 1, "the basic gun fires one shot")
  wait(1)

  drop("pairProgramming")
  assert.equal(sim.view().player!.weapon.kind, "pairProgramming")
  const pair = volley()
  assert.equal(pair.length, 2, "two shots side by side")
  const [a, b] = pair
  assert.deepEqual(a!.velocity, b!.velocity, "flying the same way")
  assert.ok(Math.abs(a!.position.y - b!.position.y) >= 8, "a few pixels apart")
  assert.ok(fx.some((e) => e.type === "shoot" && e.weapon === "pairProgramming"), "with its own sound cue")

  wait(sim.view().player!.weapon.seconds + 0.1)
  assert.equal(sim.view().player!.weapon.kind, "gun", "the timer ran out")
  assert.equal(volley().length, 1, "back to one shot")
})

test("a new weapon pickup replaces the one in hand, with a full timer", () => {
  const { sim, wait, drop } = range()
  drop("pairProgramming")
  const full = sim.view().player!.weapon.seconds
  wait(5)
  assert.ok(sim.view().player!.weapon.seconds < full - 4)
  drop("pairProgramming")
  assert.equal(sim.view().player!.weapon.kind, "pairProgramming")
  assert.ok(sim.view().player!.weapon.seconds > full - 0.1, "the timer starts over")
})

test("Refactor and Tools upgrade Pair programming, and Hotfix speeds up any weapon", () => {
  const { wait, drop, volley, hold } = range()
  const basic = hold(2)
  wait(1)
  drop("pairProgramming")
  assert.equal(hold(2), basic, "Pair programming fires as often as the basic gun")
  wait(1)

  drop("refactor", "tools")
  const six = volley()
  assert.equal(six.length, 6, "two barrels times a three-way spread")
  assert.ok(six.every((shot) => shot.homing), "every shot homes in")
  assert.equal(new Set(six.map((shot) => `${shot.velocity.x.toFixed(3)},${shot.velocity.y.toFixed(3)}`)).size, 3, "three directions, two shots each")
  wait(1)

  drop("hotfix")
  assert.ok(hold(2) >= basic * 2, "Hotfix more than doubles the fire rate")
})

test("Pair programming arrives with Side Quests: never in Glacier, in Endless from its tier", () => {
  assert.equal(contentTiers.pairProgramming, 1)
  assert.ok(!isUnlocked("pairProgramming", levels[0]!.tier), "not in Glacier")
  assert.ok(isUnlocked("pairProgramming", levels[1]!.tier), "from Side Quests on")
  assert.ok(!isUnlocked("pairProgramming", tierOf(endlessLevel, 3)), "not in Endless's first waves")
  assert.ok(isUnlocked("pairProgramming", tierOf(endlessLevel, 4)))

  const seen = new Set<string>()
  watch({ level: levels[0]!, seed: 5 }, 240, (v) => {
    for (const pickup of v.pickups) seen.add(pickup.kind)
  })
  assert.ok(seen.size > 0, "Glacier drops something")
  assert.ok(!seen.has("pairProgramming"), `Glacier dropped ${[...seen].join(", ")}`)
})

// --- Statuses: Code freeze -------------------------------------------------

/**
 * One developer holding Code freeze (picked up on the spot), and a target
 * spawned to their right. The developer fires at it until the first hit,
 * then stands still; `track` follows the target every frame after that.
 */
const freezeScene = (target: { bug: BugSeed } | { boss: Level["boss"] }, waitBeforeFiring = 0) => {
  const fx: Array<FxValue> = []
  let aim: { x: number; y: number } | null = null
  let firing = false
  const made = createSimulation({
    level: levels[2]!,
    seed: 4,
    locale: "en",
    input: { snapshot: () => (firing && aim ? { ...idleInput, aim, fire: true } : idleInput) },
    presentation: { fx: (e) => fx.push(e), chat: () => undefined }
  })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  const me = sim.view().player!.position
  const Drop = Game.System("Test/Drop", { commands: Game.System.commands(Game.System.spawns(Pickup, Bug, Boss)) }, ({ commands }) => {
    commands.spawn(makePickup("codeFreeze", { x: me.x, y: me.y }))
    const at = { x: me.x + 260, y: me.y }
    if ("bug" in target) commands.spawn(makeBug(target.bug, at))
    else commands.spawn(makeBoss(target.boss, at))
  })
  assert.ok(sim.runtime.tick(Game.Schedule(Drop, Game.Schedule.applyDeferred())).ok)
  const find = () => [...sim.view().bugs, ...sim.view().bosses].find((t) => t.key === "FREEZE-1")
  for (let frame = 0; frame < 1 + waitBeforeFiring * 60; frame++) assert.ok(sim.step().ok)
  assert.ok(sim.view().player!.buffs.codeFreeze > 0, "the developer holds Code freeze")
  firing = true
  for (let frame = 0; frame < 120 && firing; frame++) {
    aim = find()?.position ?? null
    const before = fx.length
    assert.ok(sim.step().ok)
    if (fx.slice(before).some((e) => e.type === "hit")) firing = false
  }
  assert.equal(firing, false, "the shot landed")
  /** Where the target is after each of the next `seconds`, sampled every frame. */
  const track = (seconds: number) => {
    const path: Array<{ x: number; y: number }> = []
    for (let frame = 0; frame < seconds * 60; frame++) {
      assert.ok(sim.step().ok)
      const found = find()
      assert.ok(found, "the target is still alive")
      path.push({ ...found.position })
    }
    return path
  }
  return { sim, track, find }
}

test("Code freeze: a bug hit by a developer holding it stops for about 2 s, then moves again", () => {
  const { track } = freezeScene({ bug: { key: "FREEZE-1", summary: "Frozen", priority: "High", status: "Open" } })
  const path = track(3)
  const moved = (from: number, to: number) => Math.hypot(path[to]!.x - path[from]!.x, path[to]!.y - path[from]!.y)
  assert.ok(moved(0, 100) < 0.5, `moved ${moved(0, 100).toFixed(1)} px while frozen`)
  assert.ok(moved(140, 179) > 30, `moved only ${moved(140, 179).toFixed(1)} px once thawed`)
})

test("Code freeze: a boss is only slowed, never stopped", () => {
  // Wait out the boss's boot shield first: a shielded boss shrugs the hit off.
  const { track } = freezeScene({ boss: { ...levels[0]!.boss, key: "FREEZE-1" } }, 2.2)
  const path = track(4)
  const moved = (from: number, to: number) => Math.hypot(path[to]!.x - path[from]!.x, path[to]!.y - path[from]!.y)
  const slowed = moved(5, 95)
  const free = moved(145, 235)
  assert.ok(slowed > free * 0.3, `slowed ${slowed.toFixed(1)} px vs ${free.toFixed(1)} px free: it still moves`)
  assert.ok(slowed < free * 0.7, `slowed ${slowed.toFixed(1)} px vs ${free.toFixed(1)} px free: about half as fast`)
})

test("git reset --hard is not a weapon: under Code freeze and Memory leak it hurts a boss but applies nothing", () => {
  let bomb = false
  const made = createSimulation({ level: levels[3]!, seed: 4, input: { snapshot: () => ({ ...idleInput, bomb }) }, presentation: { fx: () => undefined, chat: () => undefined } })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  const me = sim.view().player!.position
  const Drop = Game.System("Test/Drop", { commands: Game.System.commands(Game.System.spawns(Pickup, Boss)) }, ({ commands }) => {
    commands.spawn(makePickup("codeFreeze", { x: me.x, y: me.y }))
    commands.spawn(makePickup("memoryLeak", { x: me.x, y: me.y }))
    commands.spawn(makeBoss({ ...levels[0]!.boss, key: "BOSS-1" }, { x: me.x + 400, y: me.y - 300 }))
  })
  assert.ok(sim.runtime.tick(Game.Schedule(Drop, Game.Schedule.applyDeferred())).ok)
  // Past the boss's boot shield.
  for (let frame = 0; frame < 2.5 * 60; frame++) assert.ok(sim.step().ok)
  const { buffs } = sim.view().player!
  assert.ok(buffs.codeFreeze > 0 && buffs.memoryLeak > 0, "the developer holds both")
  const hp = sim.view().bosses[0]!.hp
  bomb = true
  assert.ok(sim.step().ok)
  bomb = false
  const boss = sim.view().bosses[0]!
  assert.ok(boss.hp < hp, "the blast hurts the boss")
  assert.deepEqual(boss.statuses, [], "but neither freezes nor poisons it")
})

test("Code freeze arrives with sprint 3 (Keystone) and not before", () => {
  assert.equal(isUnlocked("codeFreeze", levels[1]!.tier), false)
  assert.equal(isUnlocked("codeFreeze", levels[2]!.tier), true)
})

// --- Ticket types ----------------------------------------------------------

/** A level with no backlog of its own: only the tickets a test drops in, 200 px above the autopilot. */
const dropIn = (tickets: ReadonlyArray<BugSeed>, level: Level = levels[1]!) => {
  let current: View | null = null
  let frame = 0
  const made = createSimulation({ level: { ...level, bugs: [] }, seed: 4, locale: "en", input: autopilot(() => current, () => frame), presentation: { fx: () => undefined, chat: () => undefined } })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  const me = sim.view().player!.position
  const Place = Game.System("Test/Place", { commands: Game.System.commands(Game.System.spawns(Bug)) }, ({ commands }) => {
    tickets.forEach((ticket, i) => commands.spawn(makeBug(ticket, { x: me.x + (i - (tickets.length - 1) / 2) * 120, y: me.y - 200 })))
  })
  assert.ok(sim.runtime.tick(Game.Schedule(Place, Game.Schedule.applyDeferred())).ok)
  current = sim.view()
  return {
    view: () => current!,
    /** Steps until `done` holds (or the seconds run out), handing every view to `see`. */
    until: (done: (view: View) => boolean, seconds = 30, see: (view: View) => void = () => undefined) => {
      for (const end = frame + seconds * 60; frame < end && !done(current!); frame++) {
        assert.ok(sim.step().ok)
        current = sim.view()
        see(current)
      }
      return current!
    }
  }
}

test("a closed Story splits into 2 smaller, faster sub-tasks keyed after it; the notes only count them", () => {
  const story: BugSeed = { key: "MEOW-900", summary: "As a cat I want a bigger box", priority: "Medium", status: "To Do", type: "story" }
  const shooting = dropIn([story])
  const before = shooting.view().bugs[0]!
  assert.equal(before.type, "story")

  const split = shooting.until((v) => !v.bugs.some((bug) => bug.key === story.key))
  const children = split.bugs.filter((bug) => bug.key.startsWith(`${story.key}-`))
  assert.deepEqual(children.map((bug) => bug.key).sort(), ["MEOW-900-1", "MEOW-900-2"])
  for (const child of children) {
    assert.equal(child.type, "subtask")
    assert.ok(child.radius < before.radius, `sub-task radius ${child.radius} vs ${before.radius}`)
    assert.ok(child.speed > before.speed, `sub-task speed ${child.speed} vs ${before.speed}`)
  }

  const done = shooting.until((v) => v.bugs.length === 0)
  assert.deepEqual(done.run.fixed.map((f) => [f.key, f.type]), [["MEOW-900", "story"]])
  assert.equal(done.run.subtasks, 2)
})

test("a Highest bug still leaves its 3 regressions, a Story its 2 sub-tasks", () => {
  const shooting = dropIn([
    { key: "QUIZ-901", summary: "Leaderboard shows negative scores", priority: "Highest", status: "To Do" },
    { key: "QUIZ-902", summary: "As a host I want timed rounds", priority: "High", status: "To Do", type: "story" }
  ])
  const keys = new Set<string>()
  const done = shooting.until((v) => v.bugs.length === 0, 60, (v) => v.bugs.forEach((bug) => keys.add(bug.key)))
  assert.equal(done.run.phase, "waves", "closed by the developer, not lost")
  assert.deepEqual([...keys].sort(), ["QUIZ-901", "QUIZ-901-REG1", "QUIZ-901-REG2", "QUIZ-901-REG3", "QUIZ-902", "QUIZ-902-1", "QUIZ-902-2"])
  assert.deepEqual(done.run.fixed.map((f) => f.key).sort(), ["QUIZ-901", "QUIZ-902"])
  assert.equal(done.run.subtasks, 2)
})

test("a Highest Story leaves both its 2 sub-tasks and the 3 regressions, and its sub-tasks leave none", () => {
  const shooting = dropIn([{ key: "QUIZ-911", summary: "As a host I want live scores", priority: "Highest", status: "To Do", type: "story" }])
  const keys = new Set<string>()
  const done = shooting.until((v) => v.bugs.length === 0, 60, (v) => v.bugs.forEach((bug) => keys.add(bug.key)))
  assert.equal(done.run.phase, "waves", "closed by the developer, not lost")
  assert.deepEqual([...keys].sort(), ["QUIZ-911", "QUIZ-911-1", "QUIZ-911-2", "QUIZ-911-REG1", "QUIZ-911-REG2", "QUIZ-911-REG3"])
  assert.equal(done.run.subtasks, 2)
})

test("Stories come with Side Quests: none in Glacier, none before their tier, in Endless from its second tier", () => {
  assert.ok(levels[0]!.bugs.every((bug) => (bug.type ?? "bug") === "bug"), "Glacier's backlog has no Stories")
  assert.ok(levels[1]!.bugs.some((bug) => bug.type === "story"), "Side Quests' backlog has some")

  /** The tier the run was at when each Story first showed up. */
  const stories = (options: Omit<Parameters<typeof createSimulation>[0], "presentation" | "input">, seconds: number) => {
    const seen = new Map<number, number>()
    watch(options, seconds, (v) => {
      for (const bug of v.bugs) if (bug.type === "story" && !seen.has(bug.id)) seen.set(bug.id, v.tier)
    })
    return [...seen.values()]
  }

  assert.ok(stories({ level: levels[1]!, seed: 5 }, 150).length > 0, "Side Quests releases Stories")
  assert.deepEqual(stories({ level: { ...levels[1]!, tier: 0 }, seed: 5 }, 150), [], "held at tier 0 its Stories are plain bugs")

  const quick = { ...endlessLevel, waveSize: 2, endless: { ...endlessLevel.endless!, every: 100 } }
  const endless = stories({ level: quick, seed: 5 }, 200)
  assert.ok(endless.length > 0, "Endless releases Stories once it gets there")
  assert.ok(endless.every((tier) => tier >= contentTiers.story), `tiers at first sight: ${endless.join(", ")}`)
})

// --- Statuses: Memory leak (poison) ------------------------------------------

/**
 * One developer holding Memory leak (picked up on the spot) in Foundry, and
 * the bugs given, crawling so slowly they never reach the developer. The
 * developer shoots `target` one shot at a time, each landing before the next,
 * until `hits` have landed, then stands still.
 */
const poisonScene = (spawned: ReadonlyArray<{ bug: BugSeed; dx: number; dy: number; hp?: number }>, target: string, hits: number) => {
  const fx: Array<FxValue> = []
  let aim: { x: number; y: number } | null = null
  let firing = false
  const made = createSimulation({
    level: levels[3]!,
    seed: 4,
    locale: "en",
    input: { snapshot: () => (firing && aim ? { ...idleInput, aim, fire: true } : idleInput) },
    presentation: { fx: (e) => fx.push(e), chat: () => undefined }
  })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  const me = sim.view().player!.position
  const Drop = Game.System("Test/Drop", { commands: Game.System.commands(Game.System.spawns(Pickup, Bug)) }, ({ commands }) => {
    commands.spawn(makePickup("memoryLeak", { x: me.x, y: me.y }))
    for (const { bug, dx, dy, hp } of spawned) commands.spawn(makeBug(bug, { x: me.x + dx, y: me.y + dy }, { toughness: { hp: hp ?? 1, speed: 0.001 } }))
  })
  assert.ok(sim.runtime.tick(Game.Schedule(Drop, Game.Schedule.applyDeferred())).ok)
  const find = (key: string) => sim.view().bugs.find((bug) => bug.key === key)
  assert.ok(sim.step().ok)
  assert.ok(sim.view().player!.buffs.memoryLeak > 0, "the developer holds Memory leak")
  for (let shot = 0; shot < hits; shot++) {
    // Fire until one shot is in the air, then wait for it to land.
    let landed = false
    for (let frame = 0; frame < 120 && !landed; frame++) {
      aim = find(target)?.position ?? null
      firing = !landed && sim.view().shots.length === 0 && frame < 30
      const before = fx.length
      assert.ok(sim.step().ok)
      landed = fx.slice(before).some((e) => e.type === "hit")
    }
    firing = false
    assert.ok(landed, `shot ${shot + 1} landed`)
  }
  const wait = (seconds: number) => {
    for (let frame = 0; frame < seconds * 60; frame++) assert.ok(sim.step().ok)
  }
  return { sim, find, wait }
}

const leaky = (key: string, priority: BugSeed["priority"] = "Medium"): BugSeed => ({ key, summary: "Leaky", priority, status: "Open" })

test("Memory leak: a poisoned bug keeps losing health after the hit, and repeated hits stack", () => {
  const lostOver = (hits: number) => {
    const { find, wait } = poisonScene([{ bug: leaky("LEAK-1"), dx: 260, dy: 0, hp: 20 }], "LEAK-1", hits)
    const start = find("LEAK-1")!.hp
    wait(2)
    const after = find("LEAK-1")
    assert.ok(after, "the bug is still alive")
    return start - after.hp
  }
  const once = lostOver(1)
  const thrice = lostOver(3)
  assert.ok(once > 0.5, `one hit: lost only ${once.toFixed(2)} hp over 2 s without being shot`)
  assert.ok(thrice > once * 2.5, `three hits: lost ${thrice.toFixed(2)} hp vs ${once.toFixed(2)} for one`)
})

test("Memory leak: a bug the poison finishes off counts as a fix for the developer who applied it", () => {
  const { sim, find, wait } = poisonScene([{ bug: leaky("LEAK-1"), dx: 260, dy: 0 }], "LEAK-1", 1)
  assert.ok(find("LEAK-1"), "one hit is not enough to fix it")
  assert.equal(sim.view().player!.fixed, 0)
  wait(6)
  assert.equal(find("LEAK-1"), undefined, "the poison fixed it")
  assert.equal(sim.view().player!.fixed, 1)
  assert.ok(sim.view().player!.points > 0)
  assert.ok(sim.view().run.fixed.some((bug) => bug.key === "LEAK-1"), "it is in the release notes")
})

test("Memory leak: when a poisoned bug dies, the leak passes to the nearest bug", () => {
  const { find, wait } = poisonScene([
    { bug: leaky("LEAK-1"), dx: 260, dy: 0 },
    { bug: leaky("LEAK-NEAR"), dx: 340, dy: 90, hp: 20 },
    { bug: leaky("LEAK-FAR"), dx: 340, dy: -400, hp: 20 }
  ], "LEAK-1", 1)
  const poisoned = (key: string) => find(key)!.statuses.some((status) => status.kind === "poison")
  assert.ok(poisoned("LEAK-1"))
  assert.ok(!poisoned("LEAK-NEAR") && !poisoned("LEAK-FAR"), "only the bug that was hit")
  const near = find("LEAK-NEAR")!.hp
  wait(6)
  assert.equal(find("LEAK-1"), undefined, "the poison fixed it")
  assert.ok(poisoned("LEAK-NEAR"), "the nearest bug caught the leak")
  assert.ok(!poisoned("LEAK-FAR"), "the far one did not")
  wait(1)
  assert.ok(find("LEAK-NEAR")!.hp < near, "and it hurts")
})

test("statuses hurt a boss in a reduced form: burn and poison deal half", () => {
  /** Health a boss loses in one second carrying `status`, nobody firing. */
  const lost = (status: StatusValue) => {
    const made = createSimulation({ level: levels[0]!, seed: 4, input: { snapshot: () => idleInput }, presentation: { fx: () => undefined, chat: () => undefined } })
    if (!made.ok) throw new Error(JSON.stringify(made.error))
    const sim = made.value
    const me = sim.view().player!.position
    const Spawn = Game.System("Test/Spawn", { commands: Game.System.commands(Game.System.spawns(Boss)) }, ({ commands }) => {
      commands.spawn(makeBoss({ ...levels[0]!.boss, key: "BOSS-1" }, { x: me.x + 400, y: me.y - 300 }))
    })
    assert.ok(sim.runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred())).ok)
    // Past the boss's boot shield, which shrugs everything off.
    for (let frame = 0; frame < 2.5 * 60; frame++) assert.ok(sim.step().ok)
    const Inflict = Game.System("Test/Inflict", { queries: { bosses: Game.Query({ selection: { boss: Game.Query.write(Boss) } }) } }, ({ queries }) => {
      for (const match of queries.bosses.each()) match.data.boss.update((boss) => ({ ...boss, statuses: [status] }))
    })
    assert.ok(sim.runtime.tick(Game.Schedule(Inflict)).ok)
    const before = sim.view().bosses[0]!.hp
    for (let frame = 0; frame < 60; frame++) assert.ok(sim.step().ok)
    return before - sim.view().bosses[0]!.hp
  }
  // On a bug: burn 2.5 hp/s, poison 0.4 hp/s per stack.
  const burn = lost({ kind: "burn", seconds: 3, by: 0, stacks: 1 })
  assert.ok(Math.abs(burn - 1.25) < 0.05, `burn took ${burn.toFixed(2)} hp in a second`)
  const poison = lost({ kind: "poison", seconds: 6, by: 0, stacks: 5 })
  assert.ok(Math.abs(poison - 1) < 0.05, `poison took ${poison.toFixed(2)} hp in a second`)
})

test("Memory leak arrives with sprint 4 (Foundry) and not before", () => {
  assert.equal(isUnlocked("memoryLeak", levels[2]!.tier), false)
  assert.equal(isUnlocked("memoryLeak", levels[3]!.tier), true)
})

// --- git push --force --------------------------------------------------------

/** Sets down practice targets that never move: tough Medium bugs, so one blast leaves them standing and readable. */
const dummies = (sim: ReturnType<typeof range>["sim"], ...spots: Array<Vec>) => {
  const Place = Game.System("Test/Place", { commands: Game.System.commands(Game.System.spawns(Bug)) }, ({ commands }) => {
    spots.forEach((at, i) => commands.spawn(makeBug({ key: `DUMMY-${i + 1}`, summary: "target practice", priority: "Medium", status: "Open" }, at, { toughness: { hp: 10, speed: 0 } })))
  })
  assert.ok(sim.runtime.tick(Game.Schedule(Place, Game.Schedule.applyDeferred())).ok)
  return (key: string) => sim.view().bugs.find((bug) => bug.key === key)
}

const blasts = (fx: ReadonlyArray<FxValue>) => fx.flatMap((e) => (e.type === "explosion" ? [e] : []))

test("a rocket fired at empty space explodes where the crosshair was, hurting the bugs around it", () => {
  const { sim, fx, wait, drop, volley } = range()
  const at = sim.view().player!.position
  drop("pushForce")
  assert.equal(sim.view().player!.weapon.kind, "pushForce")
  // One bug just off the aimed point, one well outside the blast.
  const bug = dummies(sim, { x: at.x + 400, y: at.y + 80 }, { x: at.x + 400, y: at.y + 300 })
  assert.equal(volley().length, 0, "no bullets: a rocket")
  assert.equal(sim.view().rockets.length, 1)
  wait(2)
  assert.equal(sim.view().rockets.length, 0, "it went off")
  const [blast, ...more] = blasts(fx)
  assert.ok(blast, "an explosion")
  assert.equal(more.length, 0, "just one")
  assert.ok(Math.abs(blast.x - (at.x + 400)) < 15 && Math.abs(blast.y - at.y) < 15, `at the aimed point, not at ${blast.x},${blast.y}`)
  assert.ok(bug("DUMMY-1")!.hp < bug("DUMMY-1")!.maxHp, "the bug next to it took damage")
  assert.equal(bug("DUMMY-2")!.hp, bug("DUMMY-2")!.maxHp, "the far one did not")
})

test("a rocket that meets a bug on the way explodes there, short of the crosshair", () => {
  const { sim, fx, wait, drop, volley } = range()
  const at = sim.view().player!.position
  drop("pushForce")
  const bug = dummies(sim, { x: at.x + 180, y: at.y })
  volley()
  wait(2)
  const [blast, ...more] = blasts(fx)
  assert.ok(blast, "an explosion")
  assert.equal(more.length, 0, "just one")
  assert.ok(blast.x < at.x + 180, `on the bug, not at the crosshair: ${blast.x - at.x} px out`)
  assert.ok(bug("DUMMY-1")!.hp < bug("DUMMY-1")!.maxHp)
})

test("a rocket's explosion never hurts a developer, not even the one standing in it", () => {
  const fx: Array<FxValue> = []
  let fire = false
  let aim = { x: 0, y: 0 }
  const made = createSimulation({
    level: levels[1]!,
    seed: 3,
    locale: "en",
    party: crew(["Ada", "Linus"]),
    inputs: { snapshot: () => [{ ...idleInput, fire, aim }, idleInput] },
    presentation: { fx: (e) => fx.push(e), chat: () => undefined }
  })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  const [ada, linus] = sim.view().players
  const Drop = Game.System("Test/Drop", { commands: Game.System.commands(Game.System.spawns(Pickup)) }, ({ commands }) => {
    commands.spawn(makePickup("pushForce", { ...ada!.position }))
  })
  assert.ok(sim.runtime.tick(Game.Schedule(Drop, Game.Schedule.applyDeferred())).ok)
  assert.ok(sim.step().ok)
  // Right on the teammate, a short way from the one firing: both stand in the blast.
  aim = { ...linus!.position }
  fire = true
  assert.ok(sim.step().ok)
  fire = false
  for (let frame = 0; frame < 60; frame++) assert.ok(sim.step().ok)

  assert.equal(blasts(fx).length, 1, "it went off")
  assert.ok(!fx.some((e) => e.type === "hurt"), "nobody got hurt")
  assert.deepEqual(sim.view().players.map((p) => p.hp), [ada!.maxHp, linus!.maxHp])
})

test("git push --force fires slowly; Hotfix speeds it up, Refactor and Tools leave it alone", () => {
  const { sim, wait, drop, hold } = range()
  const basic = hold(2)
  wait(1)
  drop("pushForce")
  const slow = hold(3)
  assert.ok(slow >= 2 && slow / 3 < basic / 2 / 3, `a few rockets (${slow} in 3 s), under a third of the gun's rate (${basic} in 2 s)`)
  wait(1)

  drop("refactor", "tools")
  const before = new Set(sim.view().rockets.map((rocket) => rocket.id))
  assert.equal(hold(1 / 60), 1)
  const fired = sim.view().rockets.filter((rocket) => !before.has(rocket.id))
  assert.equal(fired.length, 1, "still one rocket per pull, no spread")
  assert.equal(sim.view().shots.length, 0, "and no bullets")
  wait(1)

  drop("hotfix")
  assert.ok(hold(3) >= slow * 2, "Hotfix more than doubles its fire rate")
})

test("git push --force arrives with Sprint 5: a rare drop and a possible reward, never earlier", () => {
  assert.equal(contentTiers.pushForce, 4)
  for (const level of levels.slice(0, 4)) assert.ok(!isUnlocked("pushForce", level.tier), `not in ${level.id}`)
  assert.ok(isUnlocked("pushForce", levels[4]!.tier), "Sprint 5 has it")
  assert.ok(isUnlocked("pushForce", 4))
  assert.ok(!isUnlocked("pushForce", tierOf(endlessLevel, 1)), "not in Endless's first waves")
  assert.ok(isUnlocked("pushForce", endlessLevel.tier), "but Endless gets there")
})

test("under Code freeze a rocket's blast freezes every bug it reaches", () => {
  const { sim, wait, drop, volley } = range()
  const at = sim.view().player!.position
  drop("pushForce", "codeFreeze")
  const bug = dummies(sim, { x: at.x + 400, y: at.y + 80 }, { x: at.x + 400, y: at.y - 80 }, { x: at.x + 400, y: at.y + 300 })
  volley()
  wait(1.2)
  assert.ok(hasStatus(bug("DUMMY-1")!.statuses, "freeze") && hasStatus(bug("DUMMY-2")!.statuses, "freeze"), "both bugs in the blast are frozen")
  assert.ok(!hasStatus(bug("DUMMY-3")!.statuses, "freeze"), "the one out of reach is not")
})

test("under Memory leak a rocket's blast poisons every bug it reaches", () => {
  const { sim, wait, drop, volley } = range()
  const at = sim.view().player!.position
  drop("pushForce", "memoryLeak")
  const bug = dummies(sim, { x: at.x + 400, y: at.y + 80 }, { x: at.x + 400, y: at.y - 80 }, { x: at.x + 400, y: at.y + 300 })
  volley()
  wait(1.2)
  assert.ok(hasStatus(bug("DUMMY-1")!.statuses, "poison") && hasStatus(bug("DUMMY-2")!.statuses, "poison"), "both bugs in the blast are poisoned")
  assert.ok(!hasStatus(bug("DUMMY-3")!.statuses, "poison"), "the one out of reach is not")
})

// --- Weapons: Flame war, and This is fine 🔥 --------------------------------

/**
 * One developer holding Flame war (picked up on the spot), aiming right, and
 * `targets` spawned at offsets from them. `spray` holds the trigger for a few
 * updates; `find` reads a target back by key.
 */
const flameScene = (targets: ReadonlyArray<{ key: string; dx: number; dy: number; priority?: BugSeed["priority"]; hp?: number }>) => {
  const fx: Array<FxValue> = []
  let firing = false
  let aim = { x: 0, y: 0 }
  const made = createSimulation({
    level: levels[0]!,
    seed: 4,
    locale: "en",
    input: { snapshot: () => ({ ...idleInput, aim, fire: firing }) },
    presentation: { fx: (e) => fx.push(e), chat: () => undefined }
  })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  const me = { ...sim.view().player!.position }
  aim = { x: me.x + 400, y: me.y }
  const Drop = Game.System("Test/Drop", { commands: Game.System.commands(Game.System.spawns(Pickup, Bug)) }, ({ commands }) => {
    commands.spawn(makePickup("flameWar", { x: me.x, y: me.y }))
    for (const target of targets) {
      commands.spawn(makeBug(
        { key: target.key, summary: target.key, priority: target.priority ?? "Highest", status: "Open" },
        { x: me.x + target.dx, y: me.y + target.dy },
        { toughness: { hp: target.hp ?? 1, speed: 1 } }
      ))
    }
  })
  assert.ok(sim.runtime.tick(Game.Schedule(Drop, Game.Schedule.applyDeferred())).ok)
  assert.ok(sim.step().ok)
  assert.equal(sim.view().player!.weapon.kind, "flameWar", "the developer holds Flame war")
  const wait = (frames: number) => {
    for (let frame = 0; frame < frames; frame++) assert.ok(sim.step().ok)
  }
  const spray = (frames: number) => {
    firing = true
    wait(frames)
    firing = false
  }
  const find = (key: string) => sim.view().bugs.find((bug) => bug.key === key)
  return { sim, fx, wait, spray, find }
}

test("Flame war damages every bug inside its cone and none outside it", () => {
  const { fx, spray, find } = flameScene([
    { key: "IN-NEAR", dx: 80, dy: 0 },
    { key: "IN-FAR", dx: 170, dy: 0 },
    { key: "IN-SIDE", dx: 140, dy: 45 },
    { key: "OUT-BEHIND", dx: -120, dy: 0 },
    { key: "OUT-BEYOND", dx: 330, dy: 0 },
    { key: "OUT-WIDE", dx: 70, dy: 140 }
  ])
  spray(1)
  for (const key of ["IN-NEAR", "IN-FAR", "IN-SIDE"]) {
    const bug = find(key)!
    assert.ok(bug.hp < bug.maxHp, `${key} is inside the cone and got burnt`)
    assert.ok(bug.hp > bug.maxHp - 1, `${key}: one tick of flame is low damage`)
  }
  for (const key of ["OUT-BEHIND", "OUT-BEYOND", "OUT-WIDE"]) {
    const bug = find(key)!
    assert.equal(bug.hp, bug.maxHp, `${key} is outside the cone`)
    assert.equal(bug.statuses.length, 0, `${key} is not on fire`)
  }
  assert.ok(fx.some((e) => e.type === "shoot" && e.weapon === "flameWar"), "with its own sound cue")
  assert.ok(fx.some((e) => e.type === "flame"), "and flames to draw")
})

test("This is fine: a burning bug takes damage over time and sets the bugs it touches on fire", () => {
  // TOUCHING is outside the cone but right against BURNING.
  const { find, spray, wait } = flameScene([
    { key: "BURNING", dx: 150, dy: 40 },
    { key: "TOUCHING", dx: 150, dy: 95 }
  ])
  spray(1)
  assert.ok(find("BURNING")!.statuses.some((status) => status.kind === "burn"), "the flames set it on fire")
  const hp = find("BURNING")!.hp
  wait(60)
  const burning = find("BURNING")!
  assert.ok(burning.hp < hp - 1, `burnt ${(hp - burning.hp).toFixed(2)} hp in a second without being hit`)
  const touching = find("TOUCHING")!
  assert.ok(touching.statuses.some((status) => status.kind === "burn"), "the fire spread")
  assert.ok(touching.hp < touching.maxHp - 1, "and burns it too")
  wait(4 * 60)
  assert.ok(find("BURNING") === undefined || find("BURNING")!.statuses.length === 0, "after about 3 s the fire is out")
})

test("This is fine: bugs touching each other never re-light one another, the cluster burns out", () => {
  // Both inside the cone and touching, tough enough to outlive the fire.
  const { spray, find, wait } = flameScene([
    { key: "PAIR-A", dx: 120, dy: 0, hp: 40 },
    { key: "PAIR-B", dx: 120, dy: 50, hp: 40 }
  ])
  spray(1)
  const burning = () => ["PAIR-A", "PAIR-B"].some((key) => hasStatus(find(key)!.statuses, "burn"))
  assert.ok(burning(), "the flames set them on fire")
  let frames = 0
  for (; frames < 10 * 60 && burning(); frames++) wait(1)
  assert.ok(find("PAIR-A") && find("PAIR-B"), "both outlived the fire")
  assert.ok(frames <= 3.5 * 60, `still burning ${(frames / 60).toFixed(1)} s after the last flame`)
})

test("Flame war flashes the bugs it burns without a hit sound per puff: the burner sound covers it", () => {
  const { fx, spray } = flameScene([{ key: "IN-NEAR", dx: 80, dy: 0 }])
  spray(30)
  const hits = fx.flatMap((e) => (e.type === "hit" ? [e] : []))
  assert.ok(hits.length > 0, "the bug still flashes")
  assert.ok(hits.every((e) => e.quiet === true), "but none of the flashes plays the hit sound")
})

test("Flame war arrives with sprint 6 and not before", () => {
  assert.equal(contentTiers.flameWar, 5)
  for (const level of levels.slice(0, 5)) assert.ok(!isUnlocked("flameWar", level.tier), `not in ${level.id}`)
  assert.ok(isUnlocked("flameWar", levels[5]!.tier), "Sprint 6 has it")
  assert.ok(!isUnlocked("flameWar", tierOf(endlessLevel, 15)), "not in Endless before wave 16")
  assert.ok(isUnlocked("flameWar", tierOf(endlessLevel, 16)))
})

// --- Breakpoints -------------------------------------------------------------

/**
 * A party on Keystone (where Breakpoints arrive). Seat `placer` presses F once
 * on the first frame and nobody moves after that; then the bugs are spawned
 * to the right of the trap and walk onto it.
 */
const breakpointScene = (bugs: ReadonlyArray<{ seed: BugSeed; dx: number; dy: number }>, names: ReadonlyArray<string> = [""], placer = 0) => {
  const fx: Array<FxValue> = []
  let pressed = false
  const made = createSimulation({
    level: levels[2]!,
    seed: 4,
    locale: "en",
    party: names.map((name, slot) => ({ slot, name, color: "#3a6df0" })),
    inputs: {
      snapshot: () =>
        names.map((_, slot) => {
          const press = slot === placer && !pressed
          if (press) pressed = true
          return { ...idleInput, breakpoint: press }
        })
    },
    presentation: { fx: (e) => fx.push(e), chat: () => undefined }
  })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  const trap = { ...sim.view().players[placer]!.position }
  assert.ok(sim.step().ok)
  assert.equal(sim.view().breakpoints.length, 1, "the Breakpoint is down")
  assert.equal(sim.view().players[placer]!.breakpoints, 1, "one charge spent")
  const Spawn = Game.System("Test/Spawn", { commands: Game.System.commands(Game.System.spawns(Bug)) }, ({ commands }) => {
    for (const bug of bugs) commands.spawn(makeBug(bug.seed, { x: trap.x + bug.dx, y: trap.y + bug.dy }))
  })
  assert.ok(sim.runtime.tick(Game.Schedule(Spawn, Game.Schedule.applyDeferred())).ok)
  return { sim, fx, trap }
}

test("Breakpoint: a bug walking onto it sets it off, fixing the weak and freezing the survivors", () => {
  const { sim, fx } = breakpointScene([
    { seed: { key: "BP-1", summary: "Weak", priority: "Lowest", status: "Open" }, dx: 150, dy: -20 },
    { seed: { key: "BP-2", summary: "Tough", priority: "High", status: "Open" }, dx: 170, dy: 20 }
  ])
  for (let frame = 0; frame < 180 && sim.view().breakpoints.length > 0; frame++) assert.ok(sim.step().ok)
  assert.equal(sim.view().breakpoints.length, 0, "it went off")
  assert.ok(fx.some((e) => e.type === "breakpoint"), "with its own effect")
  const view = sim.view()
  assert.ok(view.run.fixed.some((f) => f.key === "BP-1"), "the Lowest bug is fixed")
  const tough = view.bugs.find((b) => b.key === "BP-2")
  assert.ok(tough, "the High bug survives")
  assert.ok(tough.hp < tough.maxHp, "but takes damage")
  assert.ok(tough.statuses.some((s) => s.kind === "freeze"), "and is frozen")
  const at = { ...tough.position }
  for (let frame = 0; frame < 60; frame++) assert.ok(sim.step().ok)
  const later = sim.view().bugs.find((b) => b.key === "BP-2")!.position
  assert.ok(Math.hypot(later.x - at.x, later.y - at.y) < 0.5, "it stays put while frozen")
})

test("Breakpoint: it never hurts a developer, and the points go to whoever set it", () => {
  const { sim } = breakpointScene(
    [{ seed: { key: "BP-1", summary: "Weak", priority: "Lowest", status: "Open" }, dx: 120, dy: 0 }],
    ["Ada", "Bob"],
    1
  )
  for (let frame = 0; frame < 180 && sim.view().breakpoints.length > 0; frame++) assert.ok(sim.step().ok)
  assert.equal(sim.view().breakpoints.length, 0, "it went off")
  const [ada, bob] = sim.view().players
  assert.equal(bob!.hp, bob!.maxHp, "standing on it hurts nobody")
  assert.equal(ada!.hp, ada!.maxHp)
  assert.equal(bob!.fixed, 1, "Bob set it: Bob fixed the bug")
  assert.ok(bob!.points > 0)
  assert.equal(ada!.points, 0, "Ada gets nothing for Bob's trap")
})

test("Breakpoint: two charges from sprint 3 (Keystone) on, none before, and a drop adds one", () => {
  assert.equal(isUnlocked("breakpoint", levels[1]!.tier), false)
  assert.equal(isUnlocked("breakpoint", levels[2]!.tier), true)

  const pressing = (level: Level) => {
    const made = createSimulation({
      level,
      seed: 4,
      input: { snapshot: () => ({ ...idleInput, breakpoint: true }) },
      presentation: { fx: () => undefined, chat: () => undefined }
    })
    if (!made.ok) throw new Error(JSON.stringify(made.error))
    return made.value
  }

  const early = pressing(levels[1]!)
  assert.equal(early.view().player!.breakpoints, 0, "Side Quests starts with none")
  for (let frame = 0; frame < 10; frame++) assert.ok(early.step().ok)
  assert.equal(early.view().breakpoints.length, 0, "pressing F does nothing before the tier")

  const sim = pressing(levels[2]!)
  assert.equal(sim.view().player!.breakpoints, 2, "Keystone starts with two")
  for (let frame = 0; frame < 10; frame++) assert.ok(sim.step().ok)
  assert.equal(sim.view().breakpoints.length, 2, "both placed, no more")
  assert.equal(sim.view().player!.breakpoints, 0)

  const me = sim.view().player!.position
  const Drop = Game.System("Test/Drop", { commands: Game.System.commands(Game.System.spawns(Pickup)) }, ({ commands }) => {
    commands.spawn(makePickup("breakpoint", { x: me.x, y: me.y }))
  })
  assert.ok(sim.runtime.tick(Game.Schedule(Drop, Game.Schedule.applyDeferred())).ok)
  for (let frame = 0; frame < 10; frame++) assert.ok(sim.step().ok)
  assert.equal(sim.view().breakpoints.length, 3, "the dropped charge is picked up and placed too")
})

test("Breakpoint: in Endless every developer gets the sprint's two once the tier brings them in", () => {
  const quick = { ...endlessLevel, waveSize: 1, endless: { ...endlessLevel.endless!, every: 100 } }
  const before: Array<number> = []
  let first: ReadonlyArray<number> | null = null
  watch({ level: quick, seed: 5, party: crew(["Ada", "Bob"]) }, 200, (v) => {
    if (v.tier < contentTiers.breakpoint) before.push(...v.players.map((p) => p.breakpoints))
    else first ??= v.players.map((p) => p.breakpoints)
  })
  assert.ok(before.length > 0 && before.every((n) => n === 0), "none before the tier")
  assert.deepEqual(first, [2, 2], "two each as soon as it arrives")
})

test("Breakpoint: the autopilot sets them down when bugs close in, and they go off", () => {
  const { fx } = play(levels[2]!, 90)
  assert.ok(fx.some((e) => e.type === "breakpointSet"), "it placed one")
  assert.ok(fx.some((e) => e.type === "breakpoint"), "and a bug walked onto it")
})
