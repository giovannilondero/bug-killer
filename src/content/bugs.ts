/** Ticket priorities, lowest to highest. Every table below covers the whole set. */
export const priorities = ["Lowest", "Low", "Medium", "High", "Highest"] as const
export type Priority = (typeof priorities)[number]

/** One open bug in the (made-up) backlog. */
export interface BacklogBug {
  readonly key: string
  readonly summary: string
  readonly priority: Priority
  readonly status: string
  /** Bug when absent. */
  readonly type?: BacklogType
}

/**
 * What kind of ticket it is. A Story splits into sub-tasks when it is closed;
 * sub-tasks only ever come from a Story, never from the backlog.
 */
export const ticketTypes = ["bug", "story", "subtask"] as const
export type TicketType = (typeof ticketTypes)[number]
/** The types a backlog row may have. */
export type BacklogType = Exclude<TicketType, "subtask">

/** How a ticket's type scales its priority's stats. */
export interface TicketScale {
  readonly hp: number
  readonly speed: number
  readonly radius: number
  readonly points: number
}

export const ticketScales = {
  bug: { hp: 1, speed: 1, radius: 1, points: 1 },
  story: { hp: 1.5, speed: 0.9, radius: 1.2, points: 1.5 },
  subtask: { hp: 0.5, speed: 1.4, radius: 0.7, points: 0.5 }
} as const satisfies Record<TicketType, TicketScale>

/** Jira's own colours: a Story is a green bookmark, a sub-task a blue pair of boxes. */
export const ticketColors = { story: "#63ba3c", subtask: "#4bade8" } as const satisfies Record<Exclude<TicketType, "bug">, string>

/** How many sub-tasks a closed Story splits into. */
export const STORY_SUBTASKS = 2

/** A sub-task's key derives from its parent's: `KEY-123-1`, `KEY-123-2`. */
export const subtaskKey = (parent: string, index: number): string => `${parent}-${index + 1}`

/** How each priority fights. */
export interface BugKind {
  readonly label: string
  readonly hp: number
  readonly speed: number
  readonly radius: number
  readonly points: number
  readonly color: string
  /** Children spawned on death (a fix that causes regressions). */
  readonly splits: number
}

export const bugKinds = {
  Lowest: { label: "Lowest", hp: 1, speed: 55, radius: 13, points: 1, color: "#5ab0ff", splits: 0 },
  Low: { label: "Low", hp: 2, speed: 70, radius: 15, points: 2, color: "#58e6a0", splits: 0 },
  Medium: { label: "Medium", hp: 3, speed: 85, radius: 18, points: 3, color: "#ffd84a", splits: 0 },
  High: { label: "High", hp: 5, speed: 125, radius: 20, points: 5, color: "#ff9440", splits: 0 },
  Highest: { label: "Highest", hp: 12, speed: 70, radius: 30, points: 8, color: "#ff4d6d", splits: 3 }
} as const satisfies Record<Priority, BugKind>

/** Workflow statuses grouped by how the bug behaves in the arena. */
export type StatusTrait = "armored" | "reopens" | "jittery" | "deploying" | "plain"

const statusTraits: Partial<Record<string, StatusTrait>> = {
  "Blocked": "armored",
  "On hold": "armored",
  "Review blocked": "armored",
  "Ready for QA": "reopens",
  "Ready for UAT": "reopens",
  "Ready for review": "reopens",
  "Ready for release": "reopens",
  "In development": "jittery",
  "Deploying": "deploying"
}

export const traitOf = (status: string): StatusTrait => statusTraits[status] ?? "plain"

export const projectOf = (key: string): string => key.split("-")[0] ?? key
