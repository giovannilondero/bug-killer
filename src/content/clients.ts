/**
 * The people who interrupt the sprint: the clients, and Tobia from the
 * team. First names only: they are archetypes, not people.
 */
export const clientIds = ["ugo", "ornella", "kevin", "samanta", "gualtiero", "tobia", "fabrizio"] as const
export type ClientId = (typeof clientIds)[number]

export const missionKinds = ["killCount", "killTarget", "noHit", "combo", "priorityHunt"] as const
export type MissionKind = (typeof missionKinds)[number]

/** Bonus calls: a Meet to sit through, or a Slack thread to read. */
export const callKinds = ["meet", "slack"] as const
export type CallKind = (typeof callKinds)[number]

export interface Client {
  readonly name: string
  readonly color: string
  /** How often each kind of mission comes from this client. */
  readonly missions: Partial<Record<MissionKind, number>>
  /** Seconds this client gives you, multiplied into every mission. */
  readonly patience: number
}

/** Who they are; what they say, in each language, lives in `text/`. */
export const clients = {
  ugo: { name: "Ugo", color: "#ff4d6d", missions: { killCount: 3, killTarget: 3, priorityHunt: 2 }, patience: 0.75 },
  ornella: { name: "Ornella", color: "#b48cff", missions: { noHit: 3, killTarget: 2 }, patience: 1.1 },
  kevin: { name: "Kevin", color: "#4ad2ff", missions: { combo: 3, killCount: 2 }, patience: 1 },
  samanta: { name: "Samanta", color: "#58e6a0", missions: { killCount: 2, priorityHunt: 3 }, patience: 1 },
  gualtiero: { name: "Gualtiero", color: "#ffd84a", missions: { noHit: 2, killTarget: 2, combo: 1 }, patience: 1.2 },
  // Not a client: Tobia never assigns missions, only checks how you work.
  tobia: { name: "Tobia", color: "#ff9f1c", missions: {}, patience: 1 },
  fabrizio: { name: "Fabrizio", color: "#9aa7b8", missions: { killTarget: 2, killCount: 2, combo: 1 }, patience: 1 }
} as const satisfies Record<ClientId, Client>
