import { bugKinds, ticketScales, traitOf } from "../content/bugs.ts"
import type { Priority, TicketType } from "../content/bugs.ts"
import type { Boss as BossContent } from "../content/levels.ts"
import type { ClientId } from "../content/clients.ts"
import { HOSTILE_SHOT, PLAYER, RESURRECT, SHOT, TURRET } from "./constants.ts"
import { Body, Boss, Bug, Game, HostileShot, Pickup, Player, Position, Shot, Turret, Velocity } from "./schema.ts"
import type { PickupKind, TeammateValue, Vec } from "./schema.ts"
import { basicGun } from "./weapons.ts"
import { Ops } from "@typeonce/ritmo-math"

export const makePlayer = (at: Vec, teammate: TeammateValue) =>
  Game.Command.spawn(
    Game.Command.entry(Position, at),
    Game.Command.entry(Velocity, { x: 0, y: 0 }),
    Game.Command.entry(Body, { radius: PLAYER.radius }),
    Game.Command.entry(Player, {
      slot: teammate.slot,
      name: teammate.name,
      color: teammate.color,
      hp: PLAYER.maxHp,
      maxHp: PLAYER.maxHp,
      invulnerable: 1.5,
      fireCooldown: 0,
      dashCooldown: 0,
      dashTime: 0,
      dashDirection: { x: 1, y: 0 },
      aim: { x: at.x + 100, y: at.y },
      bombs: PLAYER.bombs,
      weapon: basicGun,
      buffs: { hotfix: 0, refactor: 0, coffee: 0, unitTest: 0, revert: 0, pizza: 0, tools: 0, ai: 0, pairProgramming: 0, codeFreeze: 0 },
      revive: 0,
      points: 0,
      fixed: 0
    })
  )

export interface BugSeed {
  readonly key: string
  readonly summary: string
  readonly priority: Priority
  readonly status: string
  /** Bug when absent. */
  readonly type?: TicketType
}

export const makeBug = (
  seed: BugSeed,
  at: Vec,
  options: { reopened?: boolean; regression?: boolean; resurrectedBy?: ClientId; toughness?: { hp: number; speed: number }; deploys?: boolean } = {}
) => {
  const kind = bugKinds[seed.priority]
  const type = seed.type ?? "bug"
  const scale = ticketScales[type]
  const reopened = options.reopened ?? false
  const resurrectedBy = options.resurrectedBy ?? null
  // A resurrected bug comes back angrier than it left.
  const toughness = options.toughness ?? { hp: 1, speed: 1 }
  const hp = Math.ceil((resurrectedBy ? kind.hp * RESURRECT.hpFactor : reopened ? kind.hp * 0.6 : kind.hp) * toughness.hp * scale.hp)
  const speed = kind.speed * (resurrectedBy ? RESURRECT.speedFactor : reopened ? 1.25 : 1) * toughness.speed * scale.speed
  const status = traitOf(seed.status)
  // Before its tier a Deploying ticket is just a bug.
  const trait = status === "deploying" && options.deploys === false ? "plain" : status
  return Game.Command.spawn(
    Game.Command.entry(Position, at),
    Game.Command.entry(Velocity, { x: 0, y: 0 }),
    Game.Command.entry(Body, { radius: Math.round(kind.radius * scale.radius) }),
    Game.Command.entry(Bug, {
      key: seed.key,
      summary: seed.summary,
      priority: seed.priority,
      // A reopened or resurrected bug has already been through QA once: it stays dead next time.
      trait: reopened || resurrectedBy ? "plain" : trait,
      hp,
      maxHp: hp,
      speed,
      age: 0,
      hitFlash: 0,
      reopened,
      resurrectedBy,
      regression: options.regression ?? false,
      statuses: [],
      type,
      fuse: null
    })
  )
}

export const makeBoss = (boss: BossContent, at: Vec, hpFactor = 1) =>
  Game.Command.spawn(
    Game.Command.entry(Position, at),
    Game.Command.entry(Velocity, { x: 0, y: 0 }),
    Game.Command.entry(Body, { radius: boss.radius }),
    Game.Command.entry(Boss, {
      key: boss.key,
      title: boss.title,
      pattern: boss.pattern,
      shotText: boss.shotText,
      color: boss.color,
      hp: Math.round(boss.hp * hpFactor),
      maxHp: Math.round(boss.hp * hpFactor),
      phase: 1,
      shield: 2,
      timer: 1.5,
      volley: 0,
      hitFlash: 0,
      age: 0,
      statuses: []
    })
  )

export const makeShot = (at: Vec, direction: Vec, pierce: number, homing: boolean, owner: number) =>
  Game.Command.spawn(
    Game.Command.entry(Position, at),
    Game.Command.entry(Velocity, { x: direction.x * SHOT.speed, y: direction.y * SHOT.speed }),
    Game.Command.entry(Body, { radius: SHOT.radius }),
    Game.Command.entry(Shot, { damage: SHOT.damage, life: homing ? SHOT.life * 1.4 : SHOT.life, pierce, homing, owner })
  )

export const makeHostileShot = (at: Vec, angle: number, speed: number, text: string) =>
  Game.Command.spawn(
    Game.Command.entry(Position, at),
    Game.Command.entry(Velocity, { x: Ops.cos(angle) * speed, y: Ops.sin(angle) * speed }),
    Game.Command.entry(Body, { radius: HOSTILE_SHOT.radius }),
    Game.Command.entry(HostileShot, { damage: 1, life: HOSTILE_SHOT.life, text })
  )

export const makePickup = (kind: PickupKind, at: Vec) =>
  Game.Command.spawn(
    Game.Command.entry(Position, at),
    Game.Command.entry(Body, { radius: 16 }),
    Game.Command.entry(Pickup, { kind, life: 12 })
  )

export const makeTurret = (at: Vec, owner: number) =>
  Game.Command.spawn(
    Game.Command.entry(Position, at),
    Game.Command.entry(Body, { radius: TURRET.radius }),
    Game.Command.entry(Turret, { owner, life: TURRET.seconds, cooldown: 0.4, aim: -Math.PI / 2, hallucinateIn: TURRET.hallucinateMax })
  )
