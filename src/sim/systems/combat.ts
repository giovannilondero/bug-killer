import * as Random from "@typeonce/ritmo-math/Random"

import { arenaOf } from "../../content/arenas.ts"
import { STORY_SUBTASKS, bugKinds, subtaskKey, ticketScales } from "../../content/bugs.ts"
import { text } from "../../content/i18n.ts"
import { BOMB_RADIUS, BREAKPOINT, BUFF_SECONDS, COMBO_WINDOW, DEPLOY, DT, PLAYER, ROCKET } from "../constants.ts"
import { bossRules } from "../bosses.ts"
import { makeBug, makePickup, makeTurret, spawnBoss } from "../drafts.ts"
import { clampToArena, distanceSquared, nearest, overlaps } from "../math.ts"
import { BossWrite, BugWrite, HostileShotWrite, PickupWrite, PlayerWrite, ShotWrite } from "../queries.ts"
import {
  BombBlast,
  Body,
  Boss,
  Breakpoint,
  Bug,
  BugFixed,
  FlameBurst,
  Fx,
  Game,
  HostileShot,
  Language,
  LevelSpec,
  Pickup,
  PlayerHurt,
  Position,
  Rng,
  Rocket,
  Run,
  Shot,
  Tiers,
  Turret,
  Velocity,
  pickupKinds
} from "../schema.ts"
import type { BugValue, PickupKind, PlayerValue, RunValue, Vec } from "../schema.ts"
import { applyStatus, catchStatus, hasStatus, inflictedBy, spreads, statusKinds, tickStatuses } from "../statuses.ts"
import type { StatusKind, StatusValue } from "../statuses.ts"
import { isUnlocked, tierOf } from "../tiers.ts"
import { FLAME, inCone, isWeapon, pickUp } from "../weapons.ts"
import { Ops } from "@typeonce/ritmo-math"

const REOPEN_CHANCE = 0.4
const BOSS_POINTS = 120

export const comboMultiplier = (combo: number): number => Math.min(4, 1 + Math.floor(combo / 5) * 0.5)

const dropChance = { Lowest: 0.05, Low: 0.07, Medium: 0.09, High: 0.2, Highest: 1 } as const satisfies Record<BugValue["priority"], number>

/** Pickups that drop from bugs; reverts and pizza are rarer, the AI turret rarest, and only Tobia hands out the _strumenti_. */
const dropWeights = { hotfix: 3, refactor: 3, coffee: 2, unitTest: 2, revert: 1, pizza: 1.5, tools: 0, ai: 0.5, pairProgramming: 1, codeFreeze: 2, memoryLeak: 2, pushForce: 0.4, flameWar: 1, breakpoint: 1 } as const satisfies Record<PickupKind, number>

/**
 * How a hit lands: the statuses it applies (Code freeze from the hitter's
 * buffs, or whatever the weapon itself carries), whether it is a status
 * ticking, which flashes nothing and applies nothing new, and whether it
 * flashes without the hit sound.
 */
interface Hit {
  readonly inflict?: ReadonlyArray<StatusKind>
  readonly overTime?: boolean
  readonly quiet?: boolean
}

/** The hit fx for `hit`: none for a status ticking, silent for a quiet one. */
const hitFx = (at: Vec, color: string, hit: Hit) =>
  hit.quiet ? { type: "hit" as const, x: at.x, y: at.y, color, quiet: true } : { type: "hit" as const, x: at.x, y: at.y, color }

const inflictAll = (statuses: ReadonlyArray<StatusValue>, hit: Hit, by: number): Array<StatusValue> =>
  (hit.inflict ?? []).reduce<Array<StatusValue>>((next, kind) => applyStatus(next, kind, by), [...statuses])

/**
 * Every collision in the arena: shots fix bugs, bugs and their projectiles
 * hurt the developers, pickups apply, and `git reset --hard` clears the
 * screen. Story points go to the team's score and to whoever fixed it.
 */
export const CombatSystem = Game.System(
  "BugKiller/Combat",
  {
    queries: {
      player: PlayerWrite,
      bugs: BugWrite,
      bosses: BossWrite,
      shots: ShotWrite,
      hostile: HostileShotWrite,
      pickups: PickupWrite,
      rockets: Game.Query({
        selection: { position: Game.Query.read(Position), velocity: Game.Query.read(Velocity), body: Game.Query.read(Body), rocket: Game.Query.read(Rocket) }
      }),
      breakpoints: Game.Query({ selection: { position: Game.Query.read(Position), breakpoint: Game.Query.read(Breakpoint) } })
    },
    resources: {
      run: Game.System.writeResource(Run),
      rng: Game.System.writeResource(Rng),
      language: Game.System.readResource(Language),
      level: Game.System.readResource(LevelSpec),
      tiers: Game.System.readResource(Tiers)
    },
    events: {
      bombs: Game.System.readEvent(BombBlast),
      flames: Game.System.readEvent(FlameBurst),
      fx: Game.System.writeEvent(Fx),
      fixed: Game.System.writeEvent(BugFixed),
      hurt: Game.System.writeEvent(PlayerHurt)
    },
    commands: Game.System.commands(
      Game.System.spawns(Bug, Boss, Pickup, Turret),
      Game.System.despawns(Bug, Boss, Shot, HostileShot, Pickup, Rocket, Breakpoint)
    )
  },
  ({ queries, resources, events, commands }) => {
    const run: RunValue = { ...resources.run.get(), fixed: [...resources.run.get().fixed] }
    const random = Random.draw(resources.rng)
    const strings = text[resources.language.get()]
    const arena = arenaOf(resources.level.get())
    const gone = new Set<number>()
    // Where Deploying bugs went off this tick: developers in the radius lose sanity below.
    const blasts: Array<Vec> = []
    const playing = run.phase === "waves" || run.phase === "boss"

    const bugs = queries.bugs.each()
    const bosses = queries.bosses.each()
    const team = queries.player.each()
    // Each developer's state, changed here and written back once at the end.
    const states = new Map<number, PlayerValue>(team.map((match) => [match.data.player.get().slot, { ...match.data.player.get() }]))
    const credit = (slot: number, points: number, fixed: number) => {
      const state = states.get(slot)
      if (state) states.set(slot, { ...state, points: state.points + points, fixed: state.fixed + fixed })
    }

    const fixBug = (match: (typeof bugs)[number], bug: BugValue, at: Vec, by: number) => {
      gone.add(match.entity.id)
      commands.despawn(match.entity)
      const kind = bugKinds[bug.priority]
      const points = Math.round(kind.points * ticketScales[bug.type].points * 10 * comboMultiplier(run.combo))
      run.score += points
      run.combo += 1
      run.bestCombo = Math.max(run.bestCombo, run.combo)
      run.comboTimer = COMBO_WINDOW
      run.lastProgressAt = run.time
      credit(by, points, 0)

      // Memory leak: the poison moves on to the nearest bug, still owned by whoever applied it.
      const leak = bug.statuses.find((status) => status.kind === "poison")
      if (leak) {
        const left = bugs.filter((other) => !gone.has(other.entity.id))
        const spots = left.map((other) => other.data.position.get())
        const spot = nearest(at, spots)
        const heir = spot && left[spots.indexOf(spot)]
        if (heir) {
          const value = heir.data.bug.get()
          heir.data.bug.set({ ...value, statuses: applyStatus(value.statuses, "poison", leak.by) })
        }
      }

      if (bug.trait === "reopens" && !bug.reopened && random.next() < REOPEN_CHANCE) {
        // QA says no: the ticket comes straight back.
        commands.spawn(makeBug({ ...bug, status: "Open" }, at, { reopened: true }))
        events.fx.emit({ type: "reopen", x: at.x, y: at.y, key: bug.key })
        events.fx.emit({ type: "kill", x: at.x, y: at.y, color: kind.color, key: bug.key, summary: "", points, boss: false })
        return
      }

      events.fx.emit({ type: "kill", x: at.x, y: at.y, color: kind.color, key: bug.key, summary: bug.summary, points, boss: false })
      events.fixed.emit({ key: bug.key, priority: bug.priority })
      credit(by, 0, 1)
      if (bug.type === "subtask") {
        run.subtasks += 1
      } else if (!bug.key.includes("-REG")) {
        run.fixed.push({ key: bug.key, summary: bug.summary, priority: bug.priority, type: bug.type })
      }

      if (bug.type === "story") {
        // A Story is closed by closing its sub-tasks: smaller, faster pieces of the same work.
        for (let i = 0; i < STORY_SUBTASKS; i++) {
          const angle = (i / STORY_SUBTASKS) * Math.PI * 2
          commands.spawn(makeBug(
            { key: subtaskKey(bug.key, i), summary: strings.subtask(bug.summary), priority: bug.priority, status: "Open", type: "subtask" },
            { x: at.x + Ops.cos(angle) * 24, y: at.y + Ops.sin(angle) * 24 }
          ))
        }
      } else if (kind.splits > 0 && !bug.regression && bug.type === "bug") {
        for (let i = 0; i < kind.splits; i++) {
          const angle = (i / kind.splits) * Math.PI * 2
          commands.spawn(makeBug(
            { key: `${bug.key}-REG${i + 1}`, summary: strings.regression(bug.key), priority: "Low", status: "Open" },
            { x: at.x + Ops.cos(angle) * 30, y: at.y + Ops.sin(angle) * 30 },
            { regression: true }
          ))
        }
      }

      if (bug.trait === "deploying") deploy(at, by)

      if (random.next() < dropChance[bug.priority]) {
        // Only what the level has unlocked so far can drop.
        const tier = tierOf(resources.level.get(), run.wave)
        const kindDropped = random.weighted(pickupKinds, (k) => (isUnlocked(k, tier, resources.tiers.get()) ? dropWeights[k] : 0))
        if (kindDropped) commands.spawn(makePickup(kindDropped, at))
      }
    }

    /** The statuses a developer's hits apply right now, whatever the weapon. */
    const hitBy = (slot: number): Hit => {
      const state = states.get(slot)
      return state ? { inflict: inflictedBy(state.buffs) } : {}
    }

    const damageBug = (match: (typeof bugs)[number], damage: number, by: number, hit: Hit = {}): void => {
      const bug = match.data.bug.get()
      const at = match.data.position.get()
      const dealt = bug.trait === "armored" ? damage * 0.5 : damage
      const hp = bug.hp - dealt
      const next: BugValue = { ...bug, hp, hitFlash: hit.overTime ? bug.hitFlash : 0.1, statuses: inflictAll(bug.statuses, hit, by) }
      match.data.bug.set(next)
      if (!hit.overTime) events.fx.emit(hitFx(at, bugKinds[bug.priority].color, hit))
      if (hp <= 0) {
        fixBug(match, next, at, by)
      }
    }

    /** A Deploying bug goes off: it hurts the bugs around it and lights any other Deploying bug's fuse. */
    const deploy = (at: Vec, by: number): void => {
      blasts.push(at)
      events.fx.emit({ type: "deploy", x: at.x, y: at.y })
      for (const other of bugs) {
        if (gone.has(other.entity.id) || distanceSquared(other.data.position.get(), at) >= DEPLOY.radius ** 2) continue
        damageBug(other, DEPLOY.damage, by)
        const left = other.data.bug.get()
        if (!gone.has(other.entity.id) && left.trait === "deploying" && (left.fuse === null || left.fuse > DEPLOY.chainFuse)) {
          other.data.bug.set({ ...left, fuse: DEPLOY.chainFuse })
        }
      }
    }

    // Deploying bugs whose fuse ran out go to production by themselves: nobody gets the fix.
    for (const match of bugs) {
      const bug = match.data.bug.get()
      if (gone.has(match.entity.id) || bug.trait !== "deploying" || bug.fuse === null || bug.fuse > 0) continue
      gone.add(match.entity.id)
      commands.despawn(match.entity)
      deploy(match.data.position.get(), -1)
    }

    const damageBoss = (match: (typeof bosses)[number], damage: number, by: number, hit: Hit = {}): void => {
      const boss = match.data.boss.get()
      const at = match.data.position.get()
      if (boss.shield > 0) {
        if (!hit.overTime) events.fx.emit(hitFx(at, "#ffffff", hit))
        return
      }
      const hp = boss.hp - damage
      run.lastProgressAt = run.time
      if (!hit.overTime) events.fx.emit(hitFx(at, boss.color, hit))
      // Some bosses change shape instead of taking the hit: a second phase, or a split.
      const turn = bossRules[boss.pattern].turn(boss, hp, match.data.body.get().radius)
      if (turn) {
        gone.add(match.entity.id)
        commands.despawn(match.entity)
        for (const shape of turn.into) {
          commands.spawn(spawnBoss(shape.boss, clampToArena({ x: at.x + shape.offset.x, y: at.y + shape.offset.y }, shape.radius, arena), shape.radius))
        }
        events.fx.emit({ type: "bossPhase", x: at.x, y: at.y, text: strings.bossPhase[turn.announce] })
        return
      }
      if (hp > 0) {
        match.data.boss.set({ ...boss, hp, hitFlash: hit.overTime ? boss.hitFlash : 0.08, statuses: inflictAll(boss.statuses, hit, by) })
        return
      }
      gone.add(match.entity.id)
      commands.despawn(match.entity)
      const bossPoints = Math.round(BOSS_POINTS * 10 * comboMultiplier(run.combo))
      run.score += bossPoints
      // Part of a boss that split: the ticket is fixed only with its last piece.
      const rest = bosses.some((other) => !gone.has(other.entity.id) && other.data.boss.get().key === boss.key)
      if (rest) {
        credit(by, bossPoints, 0)
        events.fx.emit({ type: "kill", x: at.x, y: at.y, color: boss.color, key: boss.key, summary: strings.bossPhase[bossRules[boss.pattern].piece ?? "halfResolved"], points: BOSS_POINTS * 10, boss: false })
        return
      }
      credit(by, bossPoints, 1)
      run.fixed.push({ key: boss.key, summary: boss.title, priority: "Highest", type: "bug" })
      events.fixed.emit({ key: boss.key, priority: "Highest" })
      events.fx.emit({ type: "kill", x: at.x, y: at.y, color: boss.color, key: boss.key, summary: boss.title, points: BOSS_POINTS * 10, boss: true })
      // The boss's projectiles die with it.
      for (const shot of queries.hostile.each()) {
        if (!gone.has(shot.entity.id)) {
          gone.add(shot.entity.id)
          commands.despawn(shot.entity)
        }
      }
    }

    // Statuses wear off; the ones that hurt do it for whoever applied them.
    for (const match of bugs) {
      const ticked = tickStatuses(match.data.bug.get().statuses, DT, false)
      match.data.bug.set({ ...match.data.bug.get(), statuses: ticked.statuses })
      for (const damage of ticked.damage) {
        if (!gone.has(match.entity.id)) damageBug(match, damage.amount, damage.by, { overTime: true })
      }
    }
    // This is fine 🔥: a status that spreads catches on to the bugs touching one that carries it, for the same developer,
    // with only the time the carrier has left: touching bugs never re-light one another.
    for (const kind of statusKinds.filter((k) => spreads(k))) {
      const carriers = bugs.filter((match) => !gone.has(match.entity.id) && hasStatus(match.data.bug.get().statuses, kind))
      for (const match of bugs) {
        const bug = match.data.bug.get()
        if (gone.has(match.entity.id) || hasStatus(bug.statuses, kind)) continue
        const at = match.data.position.get()
        const radius = match.data.body.get().radius
        const source = carriers.find((other) => overlaps(at, radius, other.data.position.get(), other.data.body.get().radius))
        const from = source?.data.bug.get().statuses.find((status) => status.kind === kind)
        if (from) match.data.bug.set({ ...bug, statuses: catchStatus(bug.statuses, from) })
      }
    }
    for (const match of bosses) {
      const ticked = tickStatuses(match.data.boss.get().statuses, DT, true)
      match.data.boss.set({ ...match.data.boss.get(), statuses: ticked.statuses })
      for (const damage of ticked.damage) {
        if (!gone.has(match.entity.id)) damageBoss(match, damage.amount, damage.by, { overTime: true })
      }
    }

    /**
     * Area damage: every bug and boss the blast reaches takes `damage`,
     * credited to `by` and landing as `hit`. Developers are never caught in
     * it, whoever's it is.
     */
    const explode = (at: Vec, radius: number, damage: number, by: number, hit: Hit = {}): void => {
      events.fx.emit({ type: "explosion", x: at.x, y: at.y, radius })
      for (const match of bugs) {
        if (!gone.has(match.entity.id) && overlaps(at, radius, match.data.position.get(), match.data.body.get().radius)) {
          damageBug(match, damage, by, hit)
        }
      }
      for (const match of bosses) {
        if (!gone.has(match.entity.id) && overlaps(at, radius, match.data.position.get(), match.data.body.get().radius)) {
          damageBoss(match, damage, by, hit)
        }
      }
    }

    // git reset --hard: not a weapon, so the hitter's statuses stay out of it.
    for (const blast of events.bombs.all()) {
      for (const match of bugs) {
        if (!gone.has(match.entity.id) && distanceSquared(match.data.position.get(), blast) < BOMB_RADIUS ** 2) {
          damageBug(match, 99, blast.slot)
        }
      }
      for (const match of bosses) {
        if (!gone.has(match.entity.id)) damageBoss(match, 18, blast.slot)
      }
      for (const shot of queries.hostile.each()) {
        if (!gone.has(shot.entity.id)) {
          gone.add(shot.entity.id)
          commands.despawn(shot.entity)
        }
      }
    }

    // Flame war: every bug and boss inside the cone gets a little damage and catches fire.
    for (const flame of events.flames.all()) {
      // The burner's own sound covers every puff: the bugs flash without a hit sound each.
      const hit: Hit = { inflict: [...(hitBy(flame.owner).inflict ?? []), "burn"], quiet: true }
      for (const match of bugs) {
        if (!gone.has(match.entity.id) && inCone(flame, match.data.position.get())) damageBug(match, FLAME.damage, flame.owner, hit)
      }
      for (const match of bosses) {
        if (!gone.has(match.entity.id) && inCone(flame, match.data.position.get())) damageBoss(match, FLAME.damage, flame.owner, hit)
      }
    }

    // git push --force: a rocket goes off on the first bug or boss it touches, or where it was aimed.
    for (const rocket of queries.rockets.each()) {
      const at = rocket.data.position.get()
      const radius = rocket.data.body.get().radius
      const velocity = rocket.data.velocity.get()
      const { target, owner } = rocket.data.rocket.get()
      const touches = (match: (typeof bugs)[number] | (typeof bosses)[number]) =>
        !gone.has(match.entity.id) && overlaps(at, radius, match.data.position.get(), match.data.body.get().radius)
      const hit = bugs.some(touches) || bosses.some(touches)
      // Past the aimed point once the way left to go points backward.
      const arrived = (target.x - at.x) * velocity.x + (target.y - at.y) * velocity.y <= 0
      if (!hit && !arrived) continue
      gone.add(rocket.entity.id)
      commands.despawn(rocket.entity)
      explode(hit ? at : target, ROCKET.blastRadius, ROCKET.damage, owner, hitBy(owner))
    }

    // A Breakpoint goes off when a bug or a boss comes close, for whoever set it, and freezes what it does not fix.
    for (const trap of queries.breakpoints.each()) {
      const at = trap.data.position.get()
      const near = (match: (typeof bugs)[number] | (typeof bosses)[number]) =>
        !gone.has(match.entity.id) && overlaps(at, BREAKPOINT.trigger, match.data.position.get(), match.data.body.get().radius)
      if (!bugs.some(near) && !bosses.some(near)) continue
      commands.despawn(trap.entity)
      events.fx.emit({ type: "breakpoint", x: at.x, y: at.y })
      explode(at, BREAKPOINT.blast, BREAKPOINT.damage, trap.data.breakpoint.get().owner, { inflict: ["freeze"] })
    }

    // Shots against bugs and bosses.
    for (const shot of queries.shots.each()) {
      if (gone.has(shot.entity.id)) continue
      const at = shot.data.position.get()
      const radius = shot.data.body.get().radius
      let state = shot.data.shot.get()
      const hit = (damage: () => void) => {
        damage()
        if (state.pierce > 0) {
          state = { ...state, pierce: state.pierce - 1 }
          shot.data.shot.set(state)
        } else {
          gone.add(shot.entity.id)
          commands.despawn(shot.entity)
        }
      }
      for (const match of bugs) {
        if (gone.has(shot.entity.id)) break
        if (gone.has(match.entity.id)) continue
        if (overlaps(at, radius, match.data.position.get(), match.data.body.get().radius)) {
          hit(() => damageBug(match, state.damage, state.owner, hitBy(state.owner)))
        }
      }
      for (const match of bosses) {
        if (gone.has(shot.entity.id)) break
        if (gone.has(match.entity.id)) continue
        if (overlaps(at, radius, match.data.position.get(), match.data.body.get().radius)) {
          hit(() => damageBoss(match, state.damage, state.owner, hitBy(state.owner)))
        }
      }
    }

    // Everything that hurts a developer, and what they pick up.
    for (const { data } of playing ? team : []) {
      let player = states.get(data.player.get().slot) ?? data.player.get()
      if (player.hp <= 0) continue
      const at = data.position.get()
      const radius = data.body.get().radius

      const hurt = (from: Vec): boolean => {
        if (player.invulnerable > 0 || player.buffs.unitTest > 0 || player.hp <= 0) return false
        player = { ...player, hp: player.hp - 1, invulnerable: PLAYER.hurtInvulnerability }
        run.combo = 0
        run.comboTimer = 0
        run.hitsTaken += 1
        events.hurt.emit({ damage: 1, slot: player.slot })
        events.fx.emit({ type: "hurt", x: at.x, y: at.y })
        if (player.hp <= 0 && team.length > 1) {
          events.fx.emit({ type: "down", x: at.x, y: at.y, slot: player.slot, name: player.name })
        }
        const push = Math.sqrt(distanceSquared(at, from)) || 1
        data.position.set(clampToArena({ x: at.x + ((at.x - from.x) / push) * 26, y: at.y + ((at.y - from.y) / push) * 26 }, radius, arena))
        return true
      }

      for (const blast of blasts) {
        if (overlaps(at, radius, blast, DEPLOY.radius)) hurt(blast)
      }
      for (const match of bugs) {
        if (!gone.has(match.entity.id) && overlaps(at, radius * 0.8, match.data.position.get(), match.data.body.get().radius * 0.8)) {
          hurt(match.data.position.get())
        }
      }
      for (const match of bosses) {
        if (!gone.has(match.entity.id) && overlaps(at, radius * 0.8, match.data.position.get(), match.data.body.get().radius * 0.85)) {
          hurt(match.data.position.get())
        }
      }
      for (const shot of queries.hostile.each()) {
        if (gone.has(shot.entity.id)) continue
        const shotAt = shot.data.position.get()
        if (overlaps(at, radius * 0.7, shotAt, shot.data.body.get().radius)) {
          if (hurt(shotAt) || player.buffs.unitTest > 0) {
            gone.add(shot.entity.id)
            commands.despawn(shot.entity)
          }
        }
      }

      for (const pickup of queries.pickups.each()) {
        if (gone.has(pickup.entity.id)) continue
        const pickupAt = pickup.data.position.get()
        if (!overlaps(at, radius + 10, pickupAt, pickup.data.body.get().radius)) continue
        const kind = pickup.data.pickup.get().kind
        gone.add(pickup.entity.id)
        commands.despawn(pickup.entity)
        events.fx.emit({ type: "pickup", x: pickupAt.x, y: pickupAt.y, kind })
        if (kind === "ai") {
          // Set down where it was found, working for whoever picked it up.
          commands.spawn(makeTurret(pickupAt, player.slot))
          events.fx.emit({ type: "turret", x: pickupAt.x, y: pickupAt.y })
        } else if (kind === "revert") {
          player = { ...player, bombs: Math.min(5, player.bombs + 1) }
        } else if (kind === "breakpoint") {
          player = { ...player, breakpoints: Math.min(BREAKPOINT.max, player.breakpoints + 1) }
        } else if (kind === "pizza") {
          player = { ...player, hp: Math.min(player.maxHp, player.hp + 2) }
        } else if (isWeapon(kind)) {
          // A new weapon replaces the one in hand, with a full timer.
          player = { ...player, weapon: pickUp(kind) }
        } else {
          player = { ...player, buffs: { ...player.buffs, [kind]: BUFF_SECONDS[kind] } }
        }
      }

      states.set(player.slot, player)
    }

    for (const { data } of team) {
      const state = states.get(data.player.get().slot)
      if (state) data.player.set(state)
    }
    resources.run.set(run)
  }
)
