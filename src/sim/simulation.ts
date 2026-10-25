/**
 * One level of Bug Killer without a browser: the schedules, the runtime
 * factory, and the read-only view the renderer draws from.
 *
 * Tests, the browser, and the multiplayer server build it the same way;
 * only the party, the input source, and the presentation sink differ.
 */
import { InputCapture } from "@typeonce/ritmo-browser"
import * as Random from "@typeonce/ritmo-math/Random"
import * as Result from "@typeonce/ritmo/Result"

import { defaultLocale } from "../content/i18n.ts"
import type { Locale } from "../content/i18n.ts"
import { arenaOf, arenas } from "../content/arenas.ts"
import type { Level } from "../content/levels.ts"
import { CALLS, FIRST_CLIENT_DELAY, TOBIA, PARTY, RESURRECT, WAVE_INTERVAL } from "./constants.ts"
import { makePlayer } from "./drafts.ts"
import { BossRead, BugRead, HostileShotRead, PickupRead, PlayerRead, ShotRead } from "./queries.ts"
import { Calls, Chat, Fx, Game, Input, InputSource, Interruptions, Language, LevelSpec, Missions, Party, Player, Position, Presentation, Run, Turret } from "./schema.ts"
import { contentTiers, tierOf } from "./tiers.ts"
import type { TierTable } from "./tiers.ts"
import type { CallsValue, ChatValue, FxValue, InputValue, InputsValue, InterruptionsValue, MissionsValue, RunValue, TeammateValue } from "./schema.ts"
import { BossBrainSystem } from "./systems/boss.ts"
import { CallSystem } from "./systems/calls.ts"
import { CombatSystem } from "./systems/combat.ts"
import { EpicSystem } from "./systems/epics.ts"
import { MissionDirectorSystem } from "./systems/missions.ts"
import { TobiaSystem, ResurrectionSystem } from "./systems/interruptions.ts"
import { BugBrainSystem, HomingSystem, IntegrateSystem, LifetimeSystem } from "./systems/movement.ts"
import { PlayerControlSystem } from "./systems/player.ts"
import { TurretSystem } from "./systems/turret.ts"
import { WavesSystem } from "./systems/waves.ts"

const CaptureInputSystem = InputCapture.system(Game, {
  name: "BugKiller/CaptureInput",
  source: InputSource,
  resource: Input
})

/** One developer per seat, side by side below the centre. */
const SetupSystem = Game.System(
  "BugKiller/Setup",
  {
    resources: { party: Game.System.readResource(Party), level: Game.System.readResource(LevelSpec) },
    commands: Game.System.commands(Game.System.spawns(Player))
  },
  ({ resources, commands }) => {
    const party = resources.party.get()
    const arena = arenaOf(resources.level.get())
    party.forEach((teammate, i) => {
      commands.spawn(makePlayer({ x: arena.width / 2 + (i - (party.length - 1) / 2) * 90, y: arena.height / 2 + 150 }, { ...teammate }))
    })
  }
)

/** Hands this tick's effects and chat messages to the host. */
const PresentSystem = Game.System(
  "BugKiller/Present",
  {
    events: { fx: Game.System.readEvent(Fx), chat: Game.System.readEvent(Chat) },
    services: { presentation: Game.System.service(Presentation) }
  },
  ({ events, services }) => {
    for (const event of events.fx.all()) services.presentation.fx(event)
    for (const event of events.chat.all()) services.presentation.chat(event)
  }
)

export const setupSchedule = Game.Schedule(SetupSystem, Game.Schedule.applyDeferred())

export const updateSchedule = Game.Schedule(
  CaptureInputSystem,
  PlayerControlSystem,
  TurretSystem,
  WavesSystem,
  BugBrainSystem,
  EpicSystem,
  BossBrainSystem,
  HomingSystem,
  IntegrateSystem,
  LifetimeSystem,
  CombatSystem,
  MissionDirectorSystem,
  CallSystem,
  ResurrectionSystem,
  TobiaSystem,
  PresentSystem,
  Game.Schedule.applyDeferred()
)

/** Everything the renderer and the HUD need, as plain data. */
export const ViewInspector = Game.Inspector(
  "BugKiller/View",
  {
    queries: {
      player: PlayerRead,
      bugs: BugRead,
      bosses: BossRead,
      shots: ShotRead,
      hostile: HostileShotRead,
      pickups: PickupRead,
      turrets: Game.Query({ selection: { position: Game.Query.read(Position), turret: Game.Query.read(Turret) } })
    },
    resources: {
      run: Game.System.readResource(Run),
      missions: Game.System.readResource(Missions),
      interruptions: Game.System.readResource(Interruptions),
      calls: Game.System.readResource(Calls),
      level: Game.System.readResource(LevelSpec),
      language: Game.System.readResource(Language)
    }
  },
  ({ queries, resources }) => {
    const players = queries.player.each()
      .map((m) => ({ position: m.data.position.get(), ...m.data.player.get() }))
      .sort((a, b) => a.slot - b.slot)
    return {
      players,
      /** The developer this screen follows: the first seat here; the multiplayer client picks its own. */
      player: players[0] ?? null,
      bugs: queries.bugs.each().map((m) => ({ id: m.entity.id, position: m.data.position.get(), radius: m.data.body.get().radius, ...m.data.bug.get() })),
      bosses: queries.bosses.each().map((m) => ({ id: m.entity.id, position: m.data.position.get(), radius: m.data.body.get().radius, ...m.data.boss.get() })),
      shots: queries.shots.each().map((m) => ({ id: m.entity.id, position: m.data.position.get(), velocity: m.data.velocity.get(), homing: m.data.shot.get().homing })),
      hostile: queries.hostile.each().map((m) => ({ id: m.entity.id, position: m.data.position.get(), text: m.data.shot.get().text })),
      turrets: queries.turrets.each().map((m) => ({ id: m.entity.id, position: m.data.position.get(), ...m.data.turret.get() })),
      pickups: queries.pickups.each().map((m) => ({ id: m.entity.id, position: m.data.position.get(), ...m.data.pickup.get() })),
      run: resources.run.get(),
      /** The highest content tier on offer right now. */
      tier: tierOf(resources.level.get(), resources.run.get().wave),
      missions: resources.missions.get(),
      interruptions: resources.interruptions.get(),
      calls: resources.calls.get(),
      level: resources.level.get(),
      language: resources.language.get()
    }
  }
)

export type View = ReturnType<typeof ViewInspector.read>

export interface PresentationSink {
  readonly fx: (event: FxValue) => void
  readonly chat: (event: ChatValue) => void
}

export const idleInput: InputValue = { move: { x: 0, y: 0 }, aim: { x: arenas.normal.width / 2, y: 0 }, fire: false, dash: false, bomb: false }

/** Playing alone: one seat, no name over the head. */
export const soloParty: Array<TeammateValue> = [{ slot: 0, name: "", color: PARTY.colors[0] }]

/** The world a level starts from. */
export const initialResources = (
  level: Level,
  seed: number,
  locale: Locale = defaultLocale,
  party: Array<TeammateValue> = soloParty,
  tiers: TierTable = contentTiers
) => {
  const run: RunValue = {
    time: 0,
    phase: "waves",
    score: 0,
    combo: 0,
    comboTimer: 0,
    bestCombo: 0,
    nextBug: 0,
    waveTimer: WAVE_INTERVAL,
    wave: 0,
    escalations: 0,
    hitsTaken: 0,
    fixed: [],
    subtasks: 0,
    missionsWon: 0,
    missionsLost: 0,
    phaseTime: 0,
    lastProgressAt: 0,
    loop: 0,
    nextBossAt: level.endless?.every ?? 0
  }
  const missions: MissionsValue = { active: null, nextIn: FIRST_CLIENT_DELAY, turn: 0 }
  const interruptions: InterruptionsValue = { resurrectIn: RESURRECT.first, tobiaIn: TOBIA.firstCooldown, tobiaLine: 0, resurrections: 0 }
  const calls: CallsValue = { active: null, nextIn: CALLS.first, answered: 0, missed: 0 }
  const input: InputsValue = party.map(() => idleInput)
  return { Input: input, Party: party.map((teammate) => ({ ...teammate })), LevelSpec: level, Language: locale, Tiers: tiers, Rng: Random.seed(seed), Run: run, Missions: missions, Interruptions: interruptions, Calls: calls }
}

export interface SimulationOptions {
  readonly level: Level
  readonly seed: number
  readonly locale?: Locale
  /** Who plays: one developer by default. */
  readonly party?: Array<TeammateValue>
  /** Every seat's input by slot; `input` is the shorthand for one developer. */
  readonly inputs?: { snapshot: () => InputsValue }
  readonly input?: { snapshot: () => InputValue }
  readonly presentation: PresentationSink
  /** Tests only: a different content-tier table, to gate a pickup that is tier 0 in the game. */
  readonly tiers?: TierTable
}

export const createSimulation = (options: SimulationOptions) => {
  const single = options.input
  const inputs = options.inputs ?? { snapshot: (): InputsValue => [single ? single.snapshot() : idleInput] }
  const made = Game.Runtime.make({
    services: Game.Runtime.services(
      Game.Runtime.service(InputSource, inputs),
      Game.Runtime.service(Presentation, options.presentation)
    ),
    resources: initialResources(options.level, options.seed, options.locale, options.party, options.tiers)
  })
  if (!made.ok) {
    return Result.failure(made.error)
  }
  const runtime = made.value
  const setup = runtime.tick(setupSchedule)
  if (!setup.ok) {
    return Result.failure(setup.error)
  }
  return Result.success({
    runtime,
    step: () => runtime.tick(updateSchedule),
    view: () => runtime.inspect(ViewInspector)
  })
}
