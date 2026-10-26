import assert from "node:assert/strict"
import { test } from "node:test"

import { arenaOf, arenas } from "../src/content/arenas.ts"
import type { Arena, Wall } from "../src/content/arenas.ts"
import { bonusLevels, endlessArenas, levels } from "../src/content/levels.ts"
import type { Level } from "../src/content/levels.ts"
import { stackTop } from "../src/sim/bosses.ts"
import { BREAKPOINT, PLAYER, TURRET } from "../src/sim/constants.ts"
import { clampToArena } from "../src/sim/math.ts"
import { makeBug, makeHostileShot, makePickup } from "../src/sim/drafts.ts"
import { createSimulation, idleInput } from "../src/sim/simulation.ts"
import type { View } from "../src/sim/simulation.ts"
import { Bug, Game, HostileShot, Pickup } from "../src/sim/schema.ts"
import type { FxValue, InputValue, PickupKind, Vec } from "../src/sim/schema.ts"
import { FLAME } from "../src/sim/weapons.ts"
import { gunner, scene as fightScene } from "./scene.ts"

/** Whether a circle of `radius` at `p` overlaps `wall`, by more than a hair. */
const overlapsWall = (wall: Wall, p: Vec, radius: number): boolean => {
  const dx = p.x - Math.min(wall.x + wall.width, Math.max(wall.x, p.x))
  const dy = p.y - Math.min(wall.y + wall.height, Math.max(wall.y, p.y))
  const inside = p.x > wall.x && p.x < wall.x + wall.width && p.y > wall.y && p.y < wall.y + wall.height
  return inside || dx * dx + dy * dy < (radius - 0.5) ** 2
}
const inAnyWall = (arena: Arena, p: Vec, radius: number) => (arena.walls ?? []).some((wall) => overlapsWall(wall, p, radius))

/**
 * One developer at the normal arena's starting spot (900, 750) and a single
 * wall: `x` from 1100 to 1140, `y` from 400 to 1100, between the developer
 * and anything placed to the east. No bug comes in but those a test places.
 */
const wallAt = (x = 1100): Wall => ({ x, y: 400, width: 40, height: 700 })

const scene = (wall: Wall = wallAt()) => {
  // Waves of no bugs, so the backlog never empties and the boss never comes; and no client asks for anything, so no escalation either.
  const level: Level = { ...levels[0]!, arena: { ...arenas.normal, walls: [wall] }, waveSize: 0, clientEvery: 9999 }
  const fx: Array<FxValue> = []
  let input: InputValue = { ...idleInput }
  const made = createSimulation({ level, seed: 2, locale: "en", input: { snapshot: () => input }, presentation: { fx: (e) => fx.push(e), chat: () => undefined } })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  const me = { ...sim.view().player!.position }
  assert.deepEqual(me, { x: 900, y: 750 })
  const spawn = (bugs: ReadonlyArray<{ key: string; at: Vec; hp?: number; speed?: number }>, pickups: ReadonlyArray<PickupKind> = [], hostile: ReadonlyArray<{ at: Vec; angle: number }> = []) => {
    const Place = Game.System("Test/Place", { commands: Game.System.commands(Game.System.spawns(Bug, Pickup, HostileShot)) }, ({ commands }) => {
      for (const bug of bugs) {
        commands.spawn(makeBug({ key: bug.key, summary: bug.key, priority: "Medium", status: "Open" }, bug.at, { toughness: { hp: bug.hp ?? 10, speed: bug.speed ?? 0 } }))
      }
      for (const kind of pickups) commands.spawn(makePickup(kind, me))
      for (const shot of hostile) commands.spawn(makeHostileShot(shot.at, shot.angle, 300, "500"))
    })
    assert.ok(sim.runtime.tick(Game.Schedule(Place, Game.Schedule.applyDeferred())).ok)
  }
  const run = (seconds: number, each: (view: View) => void = () => undefined) => {
    for (let frame = 0; frame < Math.round(seconds * 60); frame++) {
      assert.ok(sim.step().ok)
      each(sim.view())
    }
  }
  const bug = (key: string) => sim.view().bugs.find((b) => b.key === key)
  return {
    sim,
    fx,
    me,
    wall,
    spawn,
    run,
    bug,
    set: (next: Partial<InputValue>) => {
      input = { ...idleInput, ...next }
    }
  }
}

test("shots stop at a wall: the bug behind it is never hit", () => {
  const { spawn, run, set, bug, wall } = scene()
  spawn([{ key: "HIDDEN-1", at: { x: 1300, y: 750 } }])
  set({ fire: true, aim: { x: 1300, y: 750 } })
  let fired = 0
  run(1.5, (view) => {
    fired = Math.max(fired, view.shots.length)
    for (const shot of view.shots) assert.ok(shot.position.x < wall.x + wall.width, `a shot got through at ${shot.position.x.toFixed(0)}`)
  })
  assert.ok(fired > 0, "the developer fired")
  assert.equal(bug("HIDDEN-1")!.hp, bug("HIDDEN-1")!.maxHp)
})

test("hostile shots stop at a wall: the developer behind it is never hit", () => {
  const { sim, spawn, run, wall } = scene()
  spawn([], [], [-60, -20, 0, 20, 60].map((dy) => ({ at: { x: 1300, y: 750 + dy }, angle: Math.PI })))
  assert.equal(sim.view().hostile.length, 5)
  run(3, (view) => {
    for (const shot of view.hostile) assert.ok(shot.position.x > wall.x, `a hostile shot got through at ${shot.position.x.toFixed(0)}`)
  })
  assert.equal(sim.view().hostile.length, 0, "they are gone")
  assert.equal(sim.view().player!.hp, sim.view().player!.maxHp)
})

test("a rocket explodes against a wall, and the blast does not reach behind it", () => {
  const { fx, spawn, run, set, bug, wall } = scene()
  spawn([{ key: "HIDDEN-1", at: { x: 1190, y: 750 } }], ["pushForce"])
  run(2 / 60)
  set({ fire: true, aim: { x: 1190, y: 750 } })
  run(1 / 60)
  set({ aim: { x: 1190, y: 750 } })
  run(2)
  const blast = fx.find((e) => e.type === "explosion")
  assert.ok(blast && blast.type === "explosion", "it went off")
  assert.ok(blast.x <= wall.x, `against the wall, not past it: ${blast.x.toFixed(0)}`)
  assert.equal(bug("HIDDEN-1")!.hp, bug("HIDDEN-1")!.maxHp, "the bug just behind the wall is untouched")
})

test("git reset --hard does not reach behind a wall", () => {
  const { spawn, run, set, bug } = scene()
  spawn([{ key: "OPEN-1", at: { x: 700, y: 750 } }, { key: "HIDDEN-1", at: { x: 1250, y: 750 } }])
  set({ bomb: true })
  run(1 / 60)
  set({})
  run(0.5)
  assert.equal(bug("OPEN-1"), undefined, "the bug in the open is fixed")
  assert.equal(bug("HIDDEN-1")!.hp, bug("HIDDEN-1")!.maxHp, "the one behind the wall is untouched")
})

test("Flame war does not burn through a wall, and its flame stops there", () => {
  const { fx, spawn, run, set, bug, wall } = scene(wallAt(1000))
  // In front of the wall, and just behind it: both well inside the cone's reach.
  spawn([{ key: "OPEN-1", at: { x: 970, y: 750 } }, { key: "HIDDEN-1", at: { x: 1080, y: 750 } }], ["flameWar"])
  run(2 / 60)
  set({ fire: true, aim: { x: 1300, y: 750 } })
  run(0.5)
  assert.ok(bug("OPEN-1")!.hp < bug("OPEN-1")!.maxHp, "the bug in front burns")
  assert.equal(bug("HIDDEN-1")!.hp, bug("HIDDEN-1")!.maxHp, "the bug behind the wall does not")
  const flame = fx.find((e) => e.type === "flame")
  assert.ok(flame && flame.type === "flame")
  assert.ok(flame.range < FLAME.range && flame.x + flame.range <= wall.x + 1, `the flame is drawn up to the wall: ${flame.range.toFixed(0)}`)
})

test("a developer cannot walk through a wall", () => {
  const { sim, run, set, wall } = scene()
  set({ move: { x: 1, y: 0 }, dash: true })
  run(3, (view) => {
    const p = view.player!.position
    assert.ok(p.x <= wall.x - PLAYER.radius + 0.5, `the developer is in the wall at ${p.x.toFixed(1)}`)
  })
  assert.ok(sim.view().player!.position.x > wall.x - PLAYER.radius - 2, "and stands against it")
})

test("a bug chasing a developer behind a wall gets around it", () => {
  const { sim, spawn, run, bug } = scene()
  spawn([{ key: "CHASER-1", at: { x: 1400, y: 750 }, hp: 99, speed: 1 }])
  let closest = Infinity
  run(15, () => {
    const b = bug("CHASER-1")
    const me = sim.view().player!.position
    if (b) closest = Math.min(closest, Math.hypot(b.position.x - me.x, b.position.y - me.y))
  })
  assert.ok(closest < 60, `it got no closer than ${closest.toFixed(0)} px`)
})

test("nothing is ever spawned, teleported or placed inside a wall", () => {
  const cubicles = bonusLevels.find((level) => level.id === "cubicles")!
  // A short draw, so the crash boss comes and teleports around the cubicles.
  const quick: Level = { ...cubicles, bonus: { ...cubicles.bonus!, tickets: 14 } }
  const arena = arenaOf(quick)
  assert.ok((arena.walls ?? []).length > 0, "Cubicles has walls")
  let teleports = 0
  for (let seed = 1; seed <= 12; seed++) {
    const fx: Array<FxValue> = []
    let current: View | null = null
    let frame = 0
    const made = createSimulation({ level: quick, seed, locale: "en", input: wanderer(() => current, () => frame), presentation: { fx: (e) => fx.push(e), chat: () => undefined } })
    if (!made.ok) throw new Error(JSON.stringify(made.error))
    const sim = made.value
    current = sim.view()
    const free = (what: string, p: Vec, radius: number) =>
      assert.ok(!inAnyWall(arena, p, radius), `seed ${seed}, frame ${frame}: ${what} at ${p.x.toFixed(0)},${p.y.toFixed(0)} is in a wall`)
    for (; frame < 150 * 60; frame++) {
      assert.ok(sim.step().ok)
      const v = sim.view()
      current = v
      for (const p of v.players) free("developer", p.position, PLAYER.radius)
      for (const b of v.bugs) free(`bug ${b.key}`, b.position, b.radius)
      for (const b of v.bosses) free(`boss ${b.key}`, b.position, b.radius)
      for (const p of v.pickups) free(`pickup ${p.kind}`, p.position, 16)
      for (const t of v.turrets) free("turret", t.position, TURRET.radius)
      for (const b of v.breakpoints) free("breakpoint", b.position, BREAKPOINT.radius)
      const call = v.calls.active
      if (call) {
        free("meeting room", call.room, PLAYER.radius)
        for (const ping of call.pings) free("slack ping", ping, PLAYER.radius)
      }
      if (v.run.phase === "cleared" || v.run.phase === "dead") break
    }
    for (const e of fx) if (e.type === "spawn" || e.type === "resurrect" || e.type === "teleport") free(e.type, e, 0)
    teleports += fx.filter((e) => e.type === "teleport").length
  }
  assert.ok(teleports > 0, "the crash boss teleported at least once")
})

test("the Stack overflow's frames never drop inside a wall, even when its tower stands in one", () => {
  const production = levels.find((level) => level.id === "production")!
  // Production's boss, in Cubicles' arena, with nothing else to fight.
  const fight: Level = { ...production, bugs: [], arena: arenas.walls }
  const arena = arenaOf(fight)
  let dropped = 0
  for (let seed = 1; seed <= 6; seed++) {
    let current: View | null = null
    let frame = 0
    const made = createSimulation({ level: fight, seed, locale: "en", input: wanderer(() => current, () => frame), presentation: { fx: () => undefined, chat: () => undefined } })
    if (!made.ok) throw new Error(JSON.stringify(made.error))
    const sim = made.value
    current = sim.view()
    const seen = new Set<string>()
    for (; frame < 120 * 60 && current.run.phase !== "cleared" && current.run.phase !== "dead"; frame++) {
      assert.ok(sim.step().ok)
      current = sim.view()
      for (const bug of current.bugs) {
        if (!bug.key.startsWith("FRAME-") || seen.has(bug.key)) continue
        seen.add(bug.key)
        dropped++
        assert.ok(!inAnyWall(arena, bug.position, bug.radius), `seed ${seed}, frame ${frame}: ${bug.key} at ${bug.position.x.toFixed(0)},${bug.position.y.toFixed(0)} is in a wall`)
      }
    }
  }
  assert.ok(dropped >= 6, `${dropped} frames dropped`)

  // A wall right over the tower, and a weak boss shot from below: the frame on top drops into the wall.
  const covered: Level = { ...production, bugs: [], boss: { ...production.boss, hp: 6 }, arena: { ...arenas.normal, walls: [{ x: 860, y: 265, width: 80, height: 40 }] } }
  const run = fightScene(covered, { input: gunner })
  let before = run.view()
  run.until((v) => v.bugs.some((bug) => bug.key.startsWith("FRAME-")), 10, (v) => {
    if (!v.bugs.some((bug) => bug.key.startsWith("FRAME-"))) before = v
  })
  const tower = before.bosses[0]!
  const frames = run.view().bugs.filter((bug) => bug.key.startsWith("FRAME-"))
  assert.ok(frames.length > 0, "a frame dropped")
  assert.ok(inAnyWall(arenaOf(covered), stackTop(tower.position, tower.radius, tower.frames), 20), "the top of the tower stood in the wall")
  for (const bug of frames) assert.ok(!inAnyWall(arenaOf(covered), bug.position, bug.radius), `${bug.key} at ${bug.position.x.toFixed(0)},${bug.position.y.toFixed(0)} is in a wall`)
})

/** Kites and shoots, drifting about so it goes everywhere, sets Breakpoints now and then, and walks to calls. */
const wanderer = (view: () => View | null, tick: () => number) => ({
  snapshot: (): InputValue => {
    const v = view()
    if (!v?.player) return idleInput
    const me = v.player.position
    const targets = [...v.bugs, ...v.bosses].map((t) => t.position)
    const nearest = targets.sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0]
    const call = v.calls.active
    const goal = call ? (call.kind === "meet" ? call.room : call.pings[0]) : undefined
    const wobble = { x: Math.sin(tick() / 50), y: Math.cos(tick() / 70) }
    const move = goal ? { x: goal.x - me.x, y: goal.y - me.y } : nearest ? { x: me.x - nearest.x + wobble.x * 200, y: me.y - nearest.y + wobble.y * 200 } : wobble
    const length = Math.hypot(move.x, move.y) || 1
    return {
      move: { x: move.x / length, y: move.y / length },
      aim: nearest ?? { x: me.x + 1, y: me.y },
      fire: nearest !== undefined,
      dash: false,
      bomb: v.bugs.length > 10,
      breakpoint: v.player.breakpoints > 0 && tick() % 300 === 0
    }
  }
})

test("Cubicles is the normal floor with walls, ends with the crash boss, and its arena is in the Endless picker", () => {
  const cubicles = bonusLevels.find((level) => level.id === "cubicles")!
  assert.equal(cubicles.boss.key, "QUIZ-276")
  assert.equal(cubicles.bonus!.after, 5)
  assert.equal(arenaOf(cubicles), arenas.walls)
  assert.ok(endlessArenas.some((arena) => arena.id === "walls" && arena.unlockedBy === "cubicles"))
})

test("whatever spot a body is put at, it ends up clear of every wall and inside the arena", () => {
  for (const [id, arena] of Object.entries(arenas) as Array<[string, Arena]>) {
    const walls = arena.walls ?? []
    // A grid over the floor, plus the inside, the corners and the middle of every wall: where two walls meet, the corner of an L.
    const spots: Array<Vec> = []
    for (let x = 0; x <= arena.width; x += 15) for (let y = 0; y <= arena.height; y += 15) spots.push({ x, y })
    for (const wall of walls) {
      for (const fx of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1]) for (const fy of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1]) spots.push({ x: wall.x + wall.width * fx, y: wall.y + wall.height * fy })
    }
    // Up to bodies bigger than any the game has, where the passes alone leave some in a wall.
    for (const radius of [PLAYER.radius, 40, 90, 130]) {
      for (const spot of spots) {
        const at = clampToArena(spot, radius, arena)
        const where = `${id}: (${spot.x}, ${spot.y}) r${radius} → (${at.x.toFixed(1)}, ${at.y.toFixed(1)})`
        assert.ok(!inAnyWall(arena, at, radius), `${where} is in a wall`)
        assert.ok(at.x >= radius && at.x <= arena.width - radius && at.y >= radius && at.y <= arena.height - radius, `${where} is off the floor`)
      }
    }
  }
})
