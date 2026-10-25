import assert from "node:assert/strict"
import { test } from "node:test"

import { endlessLevel, levels } from "../src/content/levels.ts"
import type { Locale } from "../src/content/i18n.ts"
import type { Level } from "../src/content/levels.ts"
import { createSimulation, idleInput } from "../src/sim/simulation.ts"
import type { View } from "../src/sim/simulation.ts"
import { makePickup } from "../src/sim/drafts.ts"
import { PlayerWrite } from "../src/sim/queries.ts"
import { Game, Pickup } from "../src/sim/schema.ts"
import type { ChatValue, FxValue, InputValue } from "../src/sim/schema.ts"

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

// --- Hardcore ----------------------------------------------------------------

/** Keeps the given seats from being hurt: a run long enough to see what drops, or to revive someone. */
const shield = (slots: ReadonlyArray<number>) =>
  Game.Schedule(Game.System("Test/Shield", { queries: { player: PlayerWrite } }, ({ queries }) => {
    for (const { data } of queries.player.each()) {
      const state = data.player.get()
      if (slots.includes(state.slot)) data.player.set({ ...state, invulnerable: 1 })
    }
  }))

/** A run where `shielded` seats cannot be hurt, watching every frame. */
const watch = (level: Level, seconds: number, pilots: ReadonlyArray<Pilot>, options: { hardcore: boolean; shielded: ReadonlyArray<number>; seed?: number }, onFrame: (v: View) => void) => {
  let current: View | null = null
  let frame = 0
  const seats = pilots.map((pilot, slot) => pilot(() => seat(current, slot), () => frame))
  const made = createSimulation({
    level,
    seed: options.seed ?? 7,
    locale: "en",
    hardcore: options.hardcore,
    party: crew(pilots.map((_, slot) => `dev${slot}`)),
    inputs: { snapshot: () => seats.map((s) => s.snapshot()) },
    presentation: { fx: () => undefined, chat: () => undefined }
  })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  const protect = shield(options.shielded)
  current = sim.view()
  for (; frame < seconds * 60; frame++) {
    assert.ok(sim.runtime.tick(protect).ok)
    assert.ok(sim.step().ok)
    current = sim.view()
    onFrame(current)
    if (current.run.phase === "cleared" || current.run.phase === "dead") break
  }
  return sim.view()
}

test("in hardcore a developer has one sanity, and one hit ends a solo run", () => {
  for (const level of [levels[0]!, endlessLevel]) {
    const view = watch(level, 120, [idlePilot], { hardcore: true, shielded: [] }, () => undefined)
    assert.equal(view.hardcore, true)
    assert.equal(view.players[0]!.maxHp, 1)
    assert.equal(view.run.phase, "dead", `${level.id} ends`)
    assert.equal(view.run.hitsTaken, 1, `${level.id}: one hit is enough`)
  }
  const normal = watch(levels[0]!, 5, [idlePilot], { hardcore: false, shielded: [] }, () => undefined)
  assert.equal(normal.hardcore, false)
  assert.equal(normal.players[0]!.maxHp, 6)
})

test("Pizza never drops in hardcore, from bugs, missions or calls; the other power-ups still do", () => {
  const seen = (hardcore: boolean) => {
    const kinds = new Set<string>()
    for (const seed of [1, 2, 3]) {
      watch(levels[1]!, 180, [answeringPilot], { hardcore, shielded: [0], seed }, (v) => {
        for (const pickup of v.pickups) kinds.add(pickup.kind)
      })
    }
    return kinds
  }
  const normal = seen(false)
  assert.ok(normal.has("pizza"), `the same runs drop Pizza without hardcore: ${[...normal].join(", ")}`)
  const hardcore = seen(true)
  assert.equal(hardcore.has("pizza"), false)
  assert.ok(hardcore.has("unitTest"), `Green tests still drop: ${[...hardcore].join(", ")}`)
})

test("in hardcore a revived teammate comes back with 1 sanity", () => {
  const revivedWith: Array<number> = []
  let down = false
  watch(levels[0]!, 120, [rescuer(0), idlePilot], { hardcore: true, shielded: [0] }, (v) => {
    const hp = v.players[1]!.hp
    if (hp <= 0) down = true
    else if (down) {
      revivedWith.push(hp)
      down = false
    }
  })
  assert.ok(revivedWith.length > 0, "the idle developer goes down and is revived")
  assert.deepEqual([...new Set(revivedWith)], [1])
})
