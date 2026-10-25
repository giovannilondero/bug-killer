import { makeMusic } from "./music.ts"
import type { Music, Track } from "./music.ts"
import type { WeaponKind } from "../sim/weapons.ts"

/** Tiny WebAudio synth: every sound is a few oscillators, no assets. */
export const makeAudio = () => {
  let context: AudioContext | null = null
  let master: GainNode | null = null
  let music: Music | null = null
  // The track the screen asks for: browsers only allow sound after a tap or key, so it may wait.
  let wanted: Track | null = null
  let muted = localStorage.getItem("bugkiller:muted") === "1"
  let lastShot = 0

  const ensure = (): AudioContext | null => {
    if (!context) {
      context = new AudioContext()
      master = context.createGain()
      master.gain.value = muted ? 0 : 0.35
      master.connect(context.destination)
      music = makeMusic(context, master)
    }
    if (context.state === "suspended") void context.resume()
    return context
  }

  const tone = (freq: number, duration: number, options: { type?: OscillatorType; volume?: number; slide?: number; delay?: number } = {}) => {
    const ctx = ensure()
    if (!ctx || !master || muted) return
    const start = ctx.currentTime + (options.delay ?? 0)
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = options.type ?? "square"
    osc.frequency.setValueAtTime(freq, start)
    if (options.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * options.slide), start + duration)
    gain.gain.setValueAtTime(options.volume ?? 0.2, start)
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration)
    osc.connect(gain).connect(master)
    osc.start(start)
    osc.stop(start + duration + 0.02)
  }

  const noise = (duration: number, volume: number, filterFrom = 2000, filterTo = 200) => {
    const ctx = ensure()
    if (!ctx || !master || muted) return
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const source = ctx.createBufferSource()
    source.buffer = buffer
    const filter = ctx.createBiquadFilter()
    filter.type = "lowpass"
    filter.frequency.setValueAtTime(filterFrom, ctx.currentTime)
    filter.frequency.exponentialRampToValueAtTime(filterTo, ctx.currentTime + duration)
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(volume, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    source.connect(filter).connect(gain).connect(master)
    source.start()
  }

  return {
    /** Call from a tap or key press: starts sound, and any music waiting for it. */
    unlock: () => {
      ensure()
      if (wanted) music?.play(wanted)
    },
    toggleMute: () => {
      muted = !muted
      localStorage.setItem("bugkiller:muted", muted ? "1" : "0")
      if (master) master.gain.value = muted ? 0 : 0.35
      return muted
    },
    isMuted: () => muted,
    /** The background loop for what is on screen; `null` stops it, keeping its place. */
    music: (track: Track | null) => {
      wanted = track
      if (!track) music?.stop()
      else if (context) music?.play(track)
    },
    /** A fresh run starts the music from the top. */
    rewindMusic: () => music?.rewind(),
    shoot: (weapon: WeaponKind = "gun") => {
      const now = performance.now()
      if (now - lastShot < 50) return
      lastShot = now
      if (weapon === "flameWar") {
        // A gas burner roaring: filtered noise with a low rumble under it.
        noise(0.14, 0.06, 1600, 300)
        tone(90, 0.12, { type: "sawtooth", volume: 0.025, slide: 0.8 })
      } else if (weapon === "pairProgramming") {
        // Two keyboards at once: the same blip, a fifth apart.
        tone(740, 0.05, { type: "square", volume: 0.035, slide: 0.5 })
        tone(1110, 0.05, { type: "square", volume: 0.03, slide: 0.5, delay: 0.015 })
      } else if (weapon === "pushForce") {
        // A rocket leaving: a rising whoosh over a low thump.
        noise(0.35, 0.18, 500, 2600)
        tone(120, 0.2, { type: "sawtooth", volume: 0.1, slide: 2.2 })
      } else {
        tone(880, 0.05, { type: "square", volume: 0.04, slide: 0.5 })
      }
    },
    hit: () => tone(220, 0.04, { type: "triangle", volume: 0.08, slide: 0.7 }),
    kill: (combo: number) => {
      const base = 330 * Math.pow(2, Math.min(combo, 24) / 12)
      tone(base, 0.09, { type: "square", volume: 0.09 })
      tone(base * 1.5, 0.12, { type: "triangle", volume: 0.08, delay: 0.05 })
    },
    hurt: () => {
      noise(0.25, 0.4, 1200, 100)
      tone(140, 0.3, { type: "sawtooth", volume: 0.15, slide: 0.4 })
    },
    pickup: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.1, { type: "triangle", volume: 0.1, delay: i * 0.05 })),
    /** The turret booting up: a rising modem chirp. */
    turret: () => [440, 880, 660, 1320].forEach((f, i) => tone(f, 0.08, { type: "square", volume: 0.06, delay: i * 0.06 })),
    /** A confident wrong answer: a wobbly descending blip. */
    hallucination: () => tone(900, 0.25, { type: "sine", volume: 0.08, slide: 0.4 }),
    bomb: () => {
      noise(0.9, 0.6, 3000, 60)
      tone(90, 0.8, { type: "sawtooth", volume: 0.25, slide: 0.3 })
    },
    /** A rocket going off: shorter and drier than git reset --hard. */
    explosion: () => {
      noise(0.55, 0.45, 2400, 70)
      tone(70, 0.45, { type: "sawtooth", volume: 0.18, slide: 0.35 })
    },
    dash: () => noise(0.12, 0.12, 4000, 800),
    reopen: () => [400, 300, 200].forEach((f, i) => tone(f, 0.12, { type: "sawtooth", volume: 0.08, delay: i * 0.08 })),
    chat: (angry: boolean) => {
      const notes = angry ? [988, 988, 988] : [784, 1175]
      notes.forEach((f, i) => tone(f, 0.12, { type: angry ? "square" : "sine", volume: angry ? 0.12 : 0.15, delay: i * (angry ? 0.09 : 0.12) }))
    },
    success: () => [523, 659, 784].forEach((f, i) => tone(f, 0.18, { type: "sine", volume: 0.15, delay: i * 0.08 })),
    failure: () => [392, 330, 262].forEach((f, i) => tone(f, 0.2, { type: "sawtooth", volume: 0.08, delay: i * 0.12 })),
    boss: () => {
      tone(55, 1.4, { type: "sawtooth", volume: 0.25, slide: 1.5 })
      tone(82, 1.4, { type: "square", volume: 0.1, slide: 1.5, delay: 0.2 })
    },
    bossDown: () => {
      noise(1.6, 0.5, 4000, 50)
      ;[262, 330, 392, 523, 659, 784].forEach((f, i) => tone(f, 0.25, { type: "triangle", volume: 0.12, delay: 0.3 + i * 0.09 }))
    },
    /** "Ah ah ah": three falling squawks, louder for Ugo. */
    laugh: (loud: boolean) => {
      ;[520, 470, 420, 380].forEach((f, i) => {
        tone(f, 0.11, { type: "sawtooth", volume: loud ? 0.14 : 0.08, slide: 0.8, delay: i * 0.13 })
      })
    },
    /** A chat ping from a colleague: softer than a client's. */
    nudge: () => [660, 990].forEach((f, i) => tone(f, 0.15, { type: "sine", volume: 0.12, delay: i * 0.1 })),
    teleport: () => tone(1200, 0.15, { type: "sine", volume: 0.08, slide: 0.2 }),
    /** A call coming in: the Meet ringtone, or Slack's knock-knock. */
    ring: (kind: "meet" | "slack") => {
      if (kind === "meet") [0, 0.5].forEach((at) => [659, 880].forEach((f, i) => tone(f, 0.16, { type: "sine", volume: 0.14, delay: at + i * 0.17 })))
      else [0, 0.13].forEach((at) => tone(520, 0.07, { type: "triangle", volume: 0.16, slide: 0.7, delay: at }))
    },
    /** A Slack message read. */
    ping: () => tone(1320, 0.08, { type: "sine", volume: 0.1, slide: 1.2 })
  }
}

export type Audio = ReturnType<typeof makeAudio>
