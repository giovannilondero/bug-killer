/** Turns a plain message into a person's voice; `pick(n)` draws from the simulation's RNG. */
export type Voice = (text: string, pick: (n: number) => number) => string

/** Fabrizio reads the whole thread and adds his contribution, whatever it was about. */
export const plusOne: Voice = (_text, pick) => (pick(2) === 0 ? "+1" : "up")

/** Ugo writes in capitals whatever the language. */
export const shout: Voice = (text, pick) => text.toUpperCase().replace(/[.?]/g, "!!!") + "!".repeat(2 + pick(5))
