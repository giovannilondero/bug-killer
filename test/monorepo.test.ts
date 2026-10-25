import assert from "node:assert/strict"
import { test } from "node:test"

import { arenaOf } from "../src/content/arenas.ts"
import { clients } from "../src/content/clients.ts"
import { locales, text } from "../src/content/i18n.ts"
import { endlessLevel, levels } from "../src/content/levels.ts"
import type { Level } from "../src/content/levels.ts"
import { createSimulation, idleInput } from "../src/sim/simulation.ts"
import type { View } from "../src/sim/simulation.ts"
import { Boss, Bug, Game, Player } from "../src/sim/schema.ts"
import type { BossValue, ChatValue, InputValue, Vec } from "../src/sim/schema.ts"
import { contentTiers } from "../src/sim/tiers.ts"

const monorepo = levels.find((level) => level.id === "monorepo")!

/** A run of `level` with a hand on every knob: the developer can't be hurt, and bosses can be set by hand. */
const scene = (level: Level, input: (view: View) => InputValue = () => idleInput) => {
  let current: View | null = null
  const chat: Array<ChatValue> = []
  const made = createSimulation({
    level,
    seed: 5,
    locale: "en",
    input: { snapshot: () => input(current!) },
    presentation: { fx: () => undefined, chat: (e) => chat.push(e) }
  })
  if (!made.ok) throw new Error(JSON.stringify(made.error))
  const sim = made.value
  current = sim.view()
  const refresh = () => {
    current = sim.view()
  }
  const Untouchable = Game.System("Test/Untouchable", { queries: { player: Game.Query({ selection: { player: Game.Query.write(Player) } }) } }, ({ queries }) => {
    for (const match of queries.player.each()) match.data.player.update((p) => ({ ...p, invulnerable: 999 }))
  })
  assert.ok(sim.runtime.tick(Game.Schedule(Untouchable)).ok)
  /** Rewrites every boss `pick` chooses. */
  const setBoss = (pick: (boss: BossValue) => boolean, change: (boss: BossValue) => Partial<BossValue>) => {
    const SetBoss = Game.System("Test/SetBoss", { queries: { bosses: Game.Query({ selection: { boss: Game.Query.write(Boss) } }) } }, ({ queries }) => {
      for (const match of queries.bosses.each()) if (pick(match.data.boss.get())) match.data.boss.update((boss) => ({ ...boss, ...change(boss) }))
    })
    assert.ok(sim.runtime.tick(Game.Schedule(SetBoss)).ok)
    refresh()
  }
  /** Takes every ticket and boss out of the arena, as if they had been closed. */
  const closeAll = () => {
    const CloseAll = Game.System(
      "Test/CloseAll",
      {
        queries: { bugs: Game.Query({ selection: { bug: Game.Query.read(Bug) } }), bosses: Game.Query({ selection: { boss: Game.Query.read(Boss) } }) },
        commands: Game.System.commands(Game.System.despawns(Bug, Boss))
      },
      ({ queries, commands }) => {
        for (const match of queries.bugs.each()) commands.despawn(match.entity)
        for (const match of queries.bosses.each()) commands.despawn(match.entity)
      }
    )
    assert.ok(sim.runtime.tick(Game.Schedule(CloseAll, Game.Schedule.applyDeferred())).ok)
    refresh()
  }
  /** Steps until `done` holds or the seconds run out. */
  const until = (done: (view: View) => boolean, seconds: number, each: (view: View) => void = () => undefined) => {
    for (let i = 0; i < seconds * 60 && !done(current!); i++) {
      assert.ok(sim.step().ok)
      current = sim.view()
      each(current)
    }
    return current!
  }
  return { setBoss, closeAll, until, view: () => current!, chat }
}

/** Stands its ground and shoots the nearest boss. */
const gunner = (view: View): InputValue => {
  const me = view.player!.position
  const target = [...view.bosses].sort((a, b) => dist(a.position, me) - dist(b.position, me))[0]
  return target ? { ...idleInput, aim: target.position, fire: true } : idleInput
}
const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y)

test("Monorepo is the 5th sprint, right after Foundry, and brings in Epics and git push --force", () => {
  assert.equal(levels.indexOf(monorepo), 4)
  assert.equal(levels[3]!.id, "foundry")
  assert.equal(monorepo.sprint, "Sprint 5")
  assert.deepEqual(monorepo.projects, ["MONO"])
  assert.equal(monorepo.tier, 4)
  assert.equal(contentTiers.epic, monorepo.tier)
  assert.equal(contentTiers.pushForce, monorepo.tier)
  assert.ok(monorepo.bugs.length >= 28 && monorepo.bugs.length <= 34, `${monorepo.bugs.length} tickets`)
  assert.ok(monorepo.bugs.every((bug) => bug.key.startsWith("MONO-")))
  const epics = monorepo.bugs.filter((bug) => bug.type === "epic")
  assert.ok(epics.length >= 1, "some Epics")
  assert.ok(monorepo.bugs.some((bug) => bug.type === "story"), "some Stories")
  for (const epic of [...epics, ...endlessLevel.bugs.filter((bug) => bug.type === "epic")]) {
    assert.notEqual(epic.status, "Deploying", `${epic.key}: an Epic never deploys`)
  }
  assert.equal(monorepo.boss.pattern, "mergeConflict")
  assert.ok(monorepo.clients.includes("fabrizio"))
})

test("Merge conflict splits into ours and theirs at half health; the level clears only when both halves are fixed", () => {
  const { setBoss, until, view } = scene({ ...monorepo, bugs: [] }, gunner)
  const whole = until((v) => v.bosses.length === 1 && v.bosses[0]!.shield === 0, 10).bosses[0]!
  assert.equal(whole.side, null)
  setBoss(() => true, (boss) => ({ hp: Math.floor(boss.maxHp / 2) + 2 }))

  const split = until((v) => v.bosses.length === 2, 10)
  assert.deepEqual(split.bosses.map((b) => b.side).sort(), ["ours", "theirs"])
  for (const half of split.bosses) assert.equal(half.key, monorepo.boss.key)
  assert.equal(split.run.phase, "boss")

  // Ours goes first: theirs is still a conflict.
  setBoss((boss) => boss.side === "ours", () => ({ hp: 1, shield: 0 }))
  const one = until((v) => v.bosses.length === 1, 10)
  assert.equal(one.bosses[0]!.side, "theirs")
  const later = until(() => false, 2)
  assert.equal(later.run.phase, "boss", "one half left: not cleared")
  assert.ok(!later.run.fixed.some((fixed) => fixed.key === monorepo.boss.key), "not in the release notes yet")

  setBoss(() => true, () => ({ hp: 1, shield: 0 }))
  const done = until((v) => v.run.phase === "cleared", 10)
  assert.equal(done.run.phase, "cleared")
  assert.equal(view().run.fixed.filter((fixed) => fixed.key === monorepo.boss.key).length, 1, "the conflict is listed once")
})

test("ours and theirs move and fire in mirror across the arena's middle", () => {
  const { setBoss, until } = scene({ ...monorepo, bugs: [] }, gunner)
  until((v) => v.bosses.length === 1 && v.bosses[0]!.shield === 0, 10)
  setBoss(() => true, (boss) => ({ hp: Math.floor(boss.maxHp / 2) + 1 }))
  until((v) => v.bosses.length === 2, 10)
  // Left alone for a while, the halves settle into their mirrored orbits.
  const settled = until(() => false, 4)
  const ours = settled.bosses.find((b) => b.side === "ours")!
  const theirs = settled.bosses.find((b) => b.side === "theirs")!
  const arena = arenaOf(monorepo)
  assert.ok(Math.abs(ours.position.x + theirs.position.x - arena.width) < 30, `x ${ours.position.x.toFixed(0)} / ${theirs.position.x.toFixed(0)}`)
  assert.ok(Math.abs(ours.position.y - theirs.position.y) < 30, `y ${ours.position.y.toFixed(0)} / ${theirs.position.y.toFixed(0)}`)
  const mirrored = (side: string) => settled.hostile.filter((shot) => shot.text === side)
  assert.ok(mirrored("<<<<<<<").length > 0 && mirrored(">>>>>>>").length > 0, "both halves fire")
})

test("Fabrizio only ever answers +1 and up, in every language", () => {
  assert.ok(clients.fabrizio)
  for (const locale of locales) {
    const strings = text[locale]
    const person = strings.people.fabrizio
    assert.ok(person.role.length > 0)
    for (let n = 0; n < 6; n++) {
      assert.match(person.voice("Close MONO-17 within 30 seconds.", () => n), /^(\+1|up)$/)
    }
    assert.match(person.laugh, /^(\+1|up)$/)
    for (const line of [...strings.outcomes.fabrizio.success, ...strings.outcomes.fabrizio.failure]) assert.match(line, /^(\+1|up)$/)
  }
})

test("Fabrizio assigns missions in Monorepo, and they read +1 or up", () => {
  const { until, chat } = scene({ ...monorepo, clients: ["fabrizio"] })
  until(() => chat.some((m) => m.type === "mission"), 60)
  const mission = chat.find((m) => m.type === "mission")
  assert.ok(mission && mission.client === "fabrizio")
  assert.match(mission.text, /^(\+1|up)$/)
})

test("Endless rotates every sprint's boss in campaign order, then starts over", () => {
  assert.deepEqual(endlessLevel.endless!.bosses.map((b) => b.key), levels.map((l) => l.boss.key))
  assert.ok(endlessLevel.clients.includes("fabrizio"), "Fabrizio joins Endless's clients")
  assert.ok(endlessLevel.bugs.some((bug) => bug.key.startsWith("MONO-")), "and Monorepo's tickets its pool")

  const quick: Level = { ...endlessLevel, waveSize: 1, endless: { ...endlessLevel.endless!, every: 1 } }
  const { closeAll, until, view } = scene(quick)
  const seen: Array<string> = []
  for (let i = 0; i < 60 * 60 && seen.length <= levels.length; i++) {
    until(() => false, 1 / 60)
    const boss = view().bosses[0]
    if (boss && seen.at(-1) !== boss.key) seen.push(boss.key)
    closeAll()
  }
  assert.deepEqual(seen, [...levels.map((l) => l.boss.key), levels[0]!.boss.key])
  assert.ok(levels.length >= 5)
})
