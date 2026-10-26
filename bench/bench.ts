// Renderer benchmark (dev only, `pnpm dev` then /bench/?renderer=canvas&bugs=150).
// Draws a crowded arena from a real simulation's view, with the bugs orbiting the player,
// and records how long each draw takes and how often frames arrive.
import { endlessLevel } from "../src/content/levels.ts"
import { createRenderer } from "../src/host/renderer.ts"
import { createSimulation, idleInput } from "../src/sim/simulation.ts"
import type { View } from "../src/sim/simulation.ts"

const params = new URLSearchParams(location.search)

// Seeded randomness, so two renderers (or two versions of one) draw the same frames.
let seed = 42
Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

// `?scene=boss-GLC-37`: draw one saved view still for a few frames, for screenshots.
const scene = params.get("scene")
if (scene) {
  const fixtures = (await (await fetch(new URL("./fixtures.json", import.meta.url))).json()) as Record<string, View>
  const still = fixtures[scene]
  if (!still) throw new Error(`no scene ${scene}: ${Object.keys(fixtures).join(", ")}`)
  const r = (await createRenderer(document.querySelector<HTMLCanvasElement>("#game")!)).renderer
  // The last frame aims at a bug, to show its tooltip.
  for (let i = 0; i < 40; i++) {
    const aimed = i === 39 && still.bugs[0] ? r.toScreen(still.bugs[0].position) : null
    r.draw(still, aimed ? { x: aimed.x + 6, y: aimed.y } : { x: innerWidth / 2, y: innerHeight / 2 }, 1 / 60)
  }
  Object.assign(window, { __ready: true })
  await new Promise(() => {})
}
const count = Number(params.get("bugs") ?? 150)
const frames = Number(params.get("frames") ?? 600)

let current: View | null = null
const made = createSimulation({
  level: endlessLevel,
  seed: 11,
  locale: "en",
  input: {
    snapshot: () => {
      const me = current?.player?.position
      return me ? { ...idleInput, move: { x: Math.sin(me.y / 90), y: Math.cos(me.x / 90) } } : idleInput
    }
  },
  presentation: { fx: () => {}, chat: () => {} }
})
if (!made.ok) throw new Error(JSON.stringify(made.error))
const sim = made.value
for (let i = 0; i < 60 * 12; i++) {
  current = sim.view()
  const r = sim.step()
  if (!r.ok) throw new Error(JSON.stringify(r.error))
}
const base = sim.view()
if (!base.player || base.bugs.length === 0) throw new Error("the warm-up left no player or no bugs")
const player = { ...base.player, position: { x: 900, y: 600 }, hp: base.player.maxHp }
const center = player.position
const templates = base.bugs
const bugs = Array.from({ length: count }, (_, i) => {
  const t = templates[i % templates.length]!
  return { ...t, key: `${t.key.split("-")[0]}-${100 + i}`, age: 1 + i * 0.13, hp: i % 3 === 0 ? t.maxHp / 2 : t.maxHp, resurrectedBy: i % 17 === 0 ? ("ugo" as const) : null }
})
const shots = Array.from({ length: 40 }, (_, i) => ({ id: templates[0]!.id, position: { ...center }, velocity: { x: Math.cos(i) * 900, y: Math.sin(i) * 900 }, homing: i % 5 === 0, owner: 0 }))
const view: View = { ...base, player, players: [player], bugs, shots, bosses: [], hostile: [] }

const renderer = (await createRenderer(document.querySelector<HTMLCanvasElement>("#game")!)).renderer
const draws: Array<number> = []
const intervals: Array<number> = []
let frame = 0
let last = performance.now()
let time = 0

const tick = (now: number) => {
  const dt = 1 / 60
  time += dt
  intervals.push(now - last)
  last = now
  for (const [i, bug] of bugs.entries()) {
    const ring = 120 + (i % 12) * 45
    const a = time * (0.4 + (i % 5) * 0.1) + i
    bug.position = { x: center.x + Math.cos(a) * ring, y: center.y + Math.sin(a) * ring * 0.8 }
    bug.age += dt
  }
  for (const [i, shot] of shots.entries()) {
    const d = ((time * 900 + i * 40) % 500)
    shot.position = { x: center.x + Math.cos(i) * d, y: center.y + Math.sin(i) * d }
  }
  if (frame % 6 === 0) {
    const bug = bugs[frame % bugs.length]!
    renderer.fx({ type: "kill", x: bug.position.x, y: bug.position.y, color: "#ffd84a", boss: false, key: bug.key, summary: frame % 12 === 0 ? bug.summary : "", points: 3 })
  }
  const start = performance.now()
  renderer.draw(view, { x: innerWidth * 0.6, y: innerHeight * 0.4 }, dt)
  draws.push(performance.now() - start)
  frame++
  if (frame < frames) requestAnimationFrame(tick)
  else done()
}

const stats = (xs: Array<number>) => {
  const s = [...xs].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]!
  return { median: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2), max: +at(1).toFixed(2) }
}

const done = () => {
  const warm = 60
  const result = {
    renderer: params.get("renderer") ?? "canvas",
    bugs: count,
    draw: stats(draws.slice(warm)),
    interval: stats(intervals.slice(warm)),
    fps: +(1000 / (intervals.slice(warm).reduce((a, b) => a + b, 0) / (intervals.length - warm))).toFixed(1)
  }
  Object.assign(window, { __bench: result })
  console.log(JSON.stringify(result))
}

requestAnimationFrame((now) => {
  last = now
  requestAnimationFrame(tick)
})
