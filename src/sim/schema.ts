import { Descriptor, Schema } from "@typeonce/ritmo"
import * as Random from "@typeonce/ritmo-math/Random"

import type { Priority, StatusTrait } from "../content/bugs.ts"
import type { CallKind, ClientId, MissionKind } from "../content/clients.ts"
import type { Locale } from "../content/i18n.ts"
import type { BossPattern, Level } from "../content/levels.ts"

export type Vec = { x: number; y: number }

// --- Components ---------------------------------------------------------

export const Position = Descriptor.Component<Vec>()("BugKiller/Position")
export const Velocity = Descriptor.Component<Vec>()("BugKiller/Velocity")
export const Body = Descriptor.Component<{ radius: number }>()("BugKiller/Body")

export interface PlayerValue {
  /** Seat in the party: index into the input array and the roster. */
  slot: number
  name: string
  color: string
  /** At 0 the developer is down (burnout) until a teammate stands close for long enough. */
  hp: number
  maxHp: number
  /** Seconds of invulnerability left after a hit or a dash. */
  invulnerable: number
  fireCooldown: number
  dashCooldown: number
  dashTime: number
  dashDirection: Vec
  aim: Vec
  bombs: number
  /** Seconds left on each power-up. */
  buffs: Record<PickupKind, number>
  /** While down: seconds a teammate has spent reviving. */
  revive: number
  /** This developer's share of the run, for the party's leaderboard. */
  points: number
  fixed: number
}
export const Player = Descriptor.Component<PlayerValue>()("BugKiller/Player")

export interface BugValue {
  key: string
  summary: string
  priority: Priority
  trait: StatusTrait
  hp: number
  maxHp: number
  speed: number
  /** Seconds since spawn: drives wobble, jitter, and the spawn-in animation. */
  age: number
  hitFlash: number
  reopened: boolean
  /** The client who swore it is not fixed and brought it back. */
  resurrectedBy: ClientId | null
  /** A regression spawned by a Highest bug's death. */
  regression: boolean
}
export const Bug = Descriptor.Component<BugValue>()("BugKiller/Bug")

export interface BossValue {
  key: string
  title: string
  pattern: BossPattern
  shotText: string
  color: string
  hp: number
  maxHp: number
  /** Second life of the two-factor boss. */
  phase: 1 | 2
  shield: number
  timer: number
  volley: number
  hitFlash: number
  age: number
}
export const Boss = Descriptor.Component<BossValue>()("BugKiller/Boss")

/** `homing` shots, fired while using the _strumenti_, steer toward the nearest bug. */
export const Shot = Descriptor.Component<{ damage: number; life: number; pierce: number; homing: boolean; owner: number }>()("BugKiller/Shot")
export const HostileShot = Descriptor.Component<{ damage: number; life: number; text: string }>()("BugKiller/HostileShot")

export const pickupKinds = ["hotfix", "refactor", "coffee", "unitTest", "revert", "pizza", "tools", "ai"] as const
export type PickupKind = (typeof pickupKinds)[number]
export const Pickup = Descriptor.Component<{ kind: PickupKind; life: number }>()("BugKiller/Pickup")

/**
 * The rare "AI" drop: a turret that shoots the nearest bug on its own for a
 * few seconds, for whoever picked it up. Now and then it hallucinates and
 * fires at nothing.
 */
export interface TurretValue {
  owner: number
  life: number
  cooldown: number
  /** Where the barrel points, in radians. */
  aim: number
  hallucinateIn: number
}
export const Turret = Descriptor.Component<TurretValue>()("BugKiller/Turret")

// --- Resources ----------------------------------------------------------

/** One fixed update's input, in world coordinates. The host builds it. */
export interface InputValue {
  move: Vec
  aim: Vec
  fire: boolean
  dash: boolean
  bomb: boolean
}
/** Every developer's input this update, by slot; a missing slot stands still. */
export type InputsValue = Array<InputValue>
export const InputSource = Descriptor.Service<{ snapshot: () => InputsValue }>()("BugKiller/InputSource")
export const Input = Descriptor.TransientResource<InputsValue>()("BugKiller/Input")

/** Who plays this run: one seat each, fixed when the run starts. */
export interface TeammateValue {
  slot: number
  name: string
  color: string
}
export const Party = Descriptor.Resource<Array<TeammateValue>>()("BugKiller/Party")

export const LevelSpec = Descriptor.Resource<Level>()("BugKiller/Level")
/** The language clients write in, fixed for the whole level. */
export const Language = Descriptor.Resource<Locale>()("BugKiller/Language")
export const Rng = Descriptor.ConstructedResource(Random.codec)("BugKiller/Rng")

export type Phase = "waves" | "boss" | "cleared" | "dead"

export interface RunValue {
  time: number
  phase: Phase
  score: number
  combo: number
  comboTimer: number
  bestCombo: number
  /** Index of the next bug in the level's backlog to release. */
  nextBug: number
  waveTimer: number
  wave: number
  /** Extra bugs added by failed missions ("scope creep"). */
  escalations: number
  hitsTaken: number
  fixed: Array<{ key: string; summary: string; priority: Priority }>
  missionsWon: number
  missionsLost: number
  /** Seconds since the phase changed: the host times banners with it. */
  phaseTime: number
  /** `time` of the last fix or boss hit: how Tobia knows you are slow. */
  lastProgressAt: number
  /** Endless mode: bosses beaten so far, and the wave that calls in the next one. */
  loop: number
  nextBossAt: number
}
export const Run = Descriptor.Resource<RunValue>()("BugKiller/Run")

export interface MissionValue {
  client: ClientId
  kind: MissionKind
  text: string
  goal: number
  progress: number
  timeLeft: number
  duration: number
  /** Ticket the client wants dead, for `killTarget`. */
  target: string | null
  priority: Priority | null
}
export interface MissionsValue {
  active: MissionValue | null
  nextIn: number
  /** Index into the level's client rotation. */
  turn: number
}
export const Missions = Descriptor.Resource<MissionsValue>()("BugKiller/Missions")

/** Unscheduled visits: clients resurrecting fixed bugs, and Tobia checking on you. */
export interface InterruptionsValue {
  resurrectIn: number
  /** Seconds before Tobia may write again. */
  tobiaIn: number
  tobiaLine: number
  resurrections: number
}
export const Interruptions = Descriptor.Resource<InterruptionsValue>()("BugKiller/Interruptions")

/**
 * Bonus calls: a client starts a Meet (stand in the meeting room for a few
 * seconds) or writes on Slack (go read the messages). Answering pays;
 * ignoring them costs nothing but the client's mood.
 */
export interface CallValue {
  kind: CallKind
  client: ClientId
  /** The meeting's title, or the Slack thread's first line. */
  title: string
  /** Meet: the meeting room. */
  room: Vec
  radius: number
  /** Slack: the messages still unread, where they float in the arena. */
  pings: Array<Vec & { text: string }>
  /** Meet: seconds spent in the room; Slack: messages read. */
  progress: number
  goal: number
  timeLeft: number
  duration: number
}
export interface CallsValue {
  active: CallValue | null
  nextIn: number
  answered: number
  missed: number
}
export const Calls = Descriptor.Resource<CallsValue>()("BugKiller/Calls")

// --- Events -------------------------------------------------------------

export type FxValue =
  | { type: "kill"; x: number; y: number; color: string; key: string; summary: string; points: number; boss: boolean }
  | { type: "hit"; x: number; y: number; color: string }
  | { type: "shoot"; x: number; y: number }
  | { type: "hurt"; x: number; y: number }
  | { type: "pickup"; x: number; y: number; kind: PickupKind }
  | { type: "reopen"; x: number; y: number; key: string }
  | { type: "bomb"; x: number; y: number }
  | { type: "dash"; x: number; y: number }
  | { type: "spawn"; x: number; y: number }
  | { type: "bossPhase"; x: number; y: number; text: string }
  | { type: "teleport"; x: number; y: number }
  | { type: "resurrect"; x: number; y: number; key: string; client: ClientId }
  | { type: "ping"; x: number; y: number; text: string }
  | { type: "callDone"; x: number; y: number; kind: CallKind; points: number }
  | { type: "down"; x: number; y: number; slot: number; name: string }
  | { type: "revived"; x: number; y: number; slot: number; name: string }
  | { type: "turret"; x: number; y: number }
  | { type: "hallucination"; x: number; y: number }
export const Fx = Descriptor.Event<FxValue>()("BugKiller/Fx")

export type ChatValue =
  | { type: "mission"; client: ClientId; text: string }
  | { type: "outcome"; client: ClientId; text: string; success: boolean }
  | { type: "resurrect"; client: ClientId; text: string; key: string }
  | { type: "nudge"; client: ClientId; text: string }
  | { type: "call"; client: ClientId; text: string; kind: CallKind }
export const Chat = Descriptor.Event<ChatValue>()("BugKiller/Chat")

/** A bug killed by the player, read by the mission system. */
export const BugFixed = Descriptor.Event<{ key: string; priority: Priority }>()("BugKiller/BugFixed")
export const PlayerHurt = Descriptor.Event<{ damage: number; slot: number }>()("BugKiller/PlayerHurt")
/** `git reset --hard`: a developer's screen-clearing bomb. */
export const BombBlast = Descriptor.Event<Vec & { slot: number }>()("BugKiller/BombBlast")

/**
 * Where effects and chat leave the simulation: particles, sounds, and the
 * client chat panel. The host implements it; tests pass a recorder.
 */
export const Presentation = Descriptor.Service<{
  fx: (event: FxValue) => void
  chat: (event: ChatValue) => void
}>()("BugKiller/Presentation")

export const Game = Schema.bind(
  Schema.fragment({
    components: { Position, Velocity, Body, Player, Bug, Boss, Shot, HostileShot, Pickup, Turret },
    requires: [
      Schema.requires(Player, Position, Velocity, Body),
      Schema.requires(Bug, Position, Velocity, Body),
      Schema.requires(Boss, Position, Velocity, Body),
      Schema.requires(Shot, Position, Velocity, Body),
      Schema.requires(HostileShot, Position, Velocity, Body),
      Schema.requires(Pickup, Position, Body),
      Schema.requires(Turret, Position, Body)
    ],
    resources: { Input, Party, LevelSpec, Language, Rng, Run, Missions, Interruptions, Calls },
    events: { Fx, Chat, BugFixed, PlayerHurt, BombBlast }
  })
)
