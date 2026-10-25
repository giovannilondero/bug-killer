import assert from "node:assert/strict"
import { test } from "node:test"

import { endlessLevel, levels } from "../src/content/levels.ts"
import type { Locale } from "../src/content/i18n.ts"
import type { Level } from "../src/content/levels.ts"
import { createSimulation, idleInput } from "../src/sim/simulation.ts"
import type { View } from "../src/sim/simulation.ts"
import { makePickup } from "../src/sim/drafts.ts"
import { contentTiers, isUnlocked, tierOf } from "../src/sim/tiers.ts"
import { Game, Pickup, pickupKinds } from "../src/sim/schema.ts"
import type { ChatValue, FxValue, InputValue, PickupKind } from "../src/sim/schema.ts"

/** A bot that kites the nearest bug and shoots at it: the same intents a player sends. */
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
    const strafe = best < 220 ? 1 : -0.4
    return {
      move: { x: (away.x / length) * strafe + (-away.y / length) * 0.6, y: (away.y / length) * strafe + (away.x / length) * 0.6 },
      aim: nearest,
      fire: true,
      dash: best < 60,
      bomb: v.bugs.length > 12
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
