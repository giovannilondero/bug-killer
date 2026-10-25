/** Ticket priorities, lowest to highest. Every table below covers the whole set. */
export const priorities = ["Lowest", "Low", "Medium", "High", "Highest"] as const
export type Priority = (typeof priorities)[number]

/** One open bug in the (made-up) backlog. */
export interface BacklogBug {
  readonly key: string
  readonly summary: string
  readonly priority: Priority
  readonly status: string
}

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
