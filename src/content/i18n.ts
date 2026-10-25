import type { Priority, StatusTrait, TicketType } from "./bugs.ts"
import type { CallKind, ClientId, MissionKind } from "./clients.ts"
import type { ConflictSide, LevelId, RaceThread } from "./levels.ts"
import type { Voice } from "./text/voice.ts"
import { en } from "./text/en.ts"
import { it } from "./text/it.ts"

/** The languages the game speaks. Ticket summaries stay as they are written in the backlog. */
export const locales = ["en", "it"] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = "en"

export const isLocale = (value: unknown): value is Locale => (locales as ReadonlyArray<unknown>).includes(value)

type Pickups = "hotfix" | "refactor" | "coffee" | "unitTest" | "revert" | "pizza" | "tools" | "ai" | "pairProgramming" | "codeFreeze" | "memoryLeak" | "pushForce" | "flameWar" | "breakpoint"

/** Every word the game shows, in one language. */
export interface Strings {
  /** BCP 47 tag for numbers and clock times. */
  readonly tag: string
  readonly languageName: string

  // --- What the simulation writes ------------------------------------------
  readonly people: Record<ClientId, { readonly role: string; readonly laugh: string; readonly voice: Voice }>
  /** Tobia's nudges; `_x_` is italics in the chat. */
  readonly tobiaLines: ReadonlyArray<string>
  readonly resurrectLine: (key: string, laugh: string) => string
  readonly outcomes: Record<ClientId, { readonly success: ReadonlyArray<string>; readonly failure: ReadonlyArray<string> }>
  readonly missions: {
    readonly killCount: (goal: number, seconds: number) => string
    readonly killTarget: (key: string, summary: string, seconds: number) => string
    readonly noHit: (seconds: number) => string
    readonly combo: (goal: number) => string
    readonly priorityHunt: (goal: number, priority: Priority) => string
  }
  /** What clients add to the backlog when a mission fails. */
  readonly scopeCreep: ReadonlyArray<string>
  readonly regression: (key: string) => string
  /** The summary of one of a Story's sub-tasks. */
  readonly subtask: (summary: string) => string
  readonly minions: {
    readonly crash: string
    readonly null: string
    /** A frame that dropped off a stack overflow's tower, `depth` frames up the stack. */
    readonly frame: (depth: number) => string
  }
  readonly calls: {
    readonly meetTitles: ReadonlyArray<string>
    readonly meetInvite: (title: string, seconds: number) => string
    /** Each thread is the messages floating in the arena, read in any order. */
    readonly slackThreads: ReadonlyArray<ReadonlyArray<string>>
    readonly slackInvite: (seconds: number) => string
    readonly outcomes: Record<CallKind, { readonly answered: ReadonlyArray<string>; readonly missed: ReadonlyArray<string> }>
    readonly kinds: Record<CallKind, string>
    readonly bonus: string
    readonly meetProgress: (seconds: number, goal: number) => string
    readonly slackProgress: (read: number, goal: number) => string
    readonly room: string
    readonly answered: (points: number) => string
  }
  readonly bossPhase: {
    readonly dispenserRestart: string
    readonly otp: string
    /** A merge conflict splits in two. */
    readonly conflict: string
    /** One half of a merge conflict is fixed, the other is still there. */
    readonly halfResolved: string
    /** One twin of a race condition is fixed: the other has to follow, fast. */
    readonly threadDown: string
    /** The twin left running restarted the one that was fixed. */
    readonly restarted: string
    /** An infinite loop starts another lap, faster. */
    readonly faster: string
    /** A stack overflow drops its top frame, and shields itself while the frame runs. */
    readonly frameDropped: string
  }

  // --- What the host draws --------------------------------------------------
  readonly traits: Record<StatusTrait, string>
  /** The ticket type in the tooltip, and what it does (empty for a plain bug). */
  readonly ticketTypes: Record<TicketType, { readonly label: string; readonly hint: string }>
  readonly taglines: Record<LevelId, string>
  readonly pickups: Record<Pickups, { readonly label: string; readonly hint: string }>
  /** Code scrawled on the arena floor. */
  readonly floorCode: ReadonlyArray<string>
  readonly hud: {
    readonly sanity: string
    readonly backlog: (open: number, wave: number) => string
    readonly hints: ReadonlyArray<string>
    readonly touchHints: ReadonlyArray<string>
    /** Label over the Breakpoint count, next to the git reset one. */
    readonly breakpoints: string
    /** Floats where a Breakpoint goes off. */
    readonly breakpointHit: string
    readonly bossFixed: string
    readonly movedToDone: (key: string) => string
    readonly reopenedSub: (key: string) => string
    readonly deployed: string
    readonly deployedSub: string
    readonly resurrected: (key: string) => string
    readonly resurrectedSub: (name: string) => string
    readonly testsPassing: string
    readonly booting: string
    readonly factor: string
    /** Under each half of a merge conflict. */
    readonly sides: Record<ConflictSide, string>
    /** Under each twin of a race condition. */
    readonly threads: Record<RaceThread, string>
    /** Over the spot where a fixed twin comes back, with the seconds left. */
    readonly restarting: (seconds: number) => string
    /** Under an infinite loop: the lap it is running. */
    readonly lap: (lap: number) => string
    /** Under a stack overflow: how many frames its tower has left. */
    readonly depth: (frames: number) => string
    readonly startBanner: string
    readonly audioOn: string
    readonly audioOff: string
    readonly endless: (wave: number, bossIn: number) => string
    readonly nextRound: (round: number) => string
    readonly nextRoundSub: string
    readonly burnout: string
    readonly hallucination: string
    readonly youAreDown: string
    readonly teammateDown: (name: string) => string
    readonly teammateDownSub: string
    readonly revived: (name: string) => string
  }
  readonly chat: {
    readonly channel: string
    readonly members: (n: number) => string
    readonly mission: string
    readonly kinds: Record<MissionKind, string>
    readonly noHit: (progress: number, goal: number) => string
    readonly combo: (progress: number, goal: number) => string
    readonly killCount: (progress: number, goal: number) => string
  }
  readonly menu: {
    readonly subtitle: string
    readonly openBugs: (n: number) => string
    readonly locked: string
    readonly best: (score: string) => string
    readonly fresh: string
    readonly controls: string
    readonly touchControls: string
    readonly disclaimer: string
    readonly language: string
    readonly endless: (every: number) => string
    readonly campaign: string
    readonly campaignProgress: (cleared: number, total: number) => string
    readonly extras: string
  }
  readonly intro: { readonly clientsOnline: string; readonly start: string; readonly startTouch: string }
  readonly touch: { readonly dash: string; readonly breakpoint: string; readonly rotate: string; readonly fullscreen: string; readonly homeScreen: string }
  readonly pause: { readonly title: string; readonly body: string; readonly resume: string; readonly restart: string; readonly menu: string }
  readonly stats: { readonly points: string; readonly closed: string; readonly bestCombo: string; readonly missions: string; readonly breakdowns: string; readonly calls: string }
  readonly notes: {
    readonly title: string
    readonly scopeCreep: (n: number) => string
    readonly resurrections: (n: number) => string
    readonly subtasks: (n: number) => string
  }
  readonly cleared: {
    readonly allTitle: string
    readonly allBody: string
    readonly ugoFinal: string
    readonly title: string
    readonly body: (name: string) => string
    readonly next: string
    readonly copy: string
    readonly copied: string
    readonly replay: string
  }
  readonly dead: {
    readonly lines: ReadonlyArray<string>
    readonly stillOpen: string
    readonly bossStillThere: (key: string) => string
    readonly endless: (waves: number, bosses: number) => string
    readonly record: string
    readonly retry: string
  }
  readonly errors: { readonly runtime: string; readonly crashed: string; readonly reload: string }
  readonly multi: {
    readonly menuButton: string
    readonly cardTagline: string
    readonly cardMeta: string
    readonly title: string
    readonly body: string
    readonly name: string
    readonly namePlaceholder: string
    readonly level: string
    readonly create: string
    readonly code: string
    readonly join: string
    readonly back: string
    readonly lobby: (code: string) => string
    readonly share: string
    readonly copyLink: string
    readonly copied: string
    readonly host: string
    readonly you: string
    readonly offline: string
    readonly start: string
    readonly waiting: (host: string) => string
    readonly leave: string
    readonly team: string
    readonly playAgain: string
    readonly connecting: string
    readonly lost: string
    /** The run server never answered: down, or out of its daily quota. */
    readonly unreachable: string
    readonly pauseBody: string
    readonly errors: Record<"notFound" | "full" | "started" | "nameTaken" | "badName" | "badLevel" | "notHost" | "busy", string>
  }
}

export const text: Record<Locale, Strings> = { en, it }
