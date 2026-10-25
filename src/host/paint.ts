// Canvas 2D painters shared by the renderers: the Canvas renderer draws with them every frame,
// the Pixi renderer bakes them into textures once. Each paints in its own local coordinates.
import { arenaOf } from "../content/arenas.ts"
import type { Priority, StatusTrait } from "../content/bugs.ts"
import type { Level } from "../content/levels.ts"
import { PLAYER } from "../sim/constants.ts"
import type { PickupKind } from "../sim/schema.ts"
import { locale, t } from "./language.ts"

export const MONO = `"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace`
export const SANS = `"Inter", ui-sans-serif, system-ui, -apple-system, sans-serif`

export const pickupIcons = {
  hotfix: "🔥",
  refactor: "🔀",
  coffee: "☕",
  unitTest: "🛡️",
  revert: "⏪",
  pizza: "🍕",
  tools: "🤖",
  ai: "🧠",
  pairProgramming: "👥",
  codeFreeze: "❄️",
  memoryLeak: "🧪",
  pushForce: "🚀"
} as const satisfies Record<PickupKind, string>

export const pickupInfo = (kind: PickupKind) => ({ icon: pickupIcons[kind], ...t().pickups[kind] })

const codeLines = [
  "if (user == null) return;",
  "// TODO: fix before release",
  "catch (e) { /* ignore */ }",
  "const id = order?.id ?? order.id",
  "await sleep(5000) // race condition",
  "SELECT * FROM machines;",
  "git push --force",
  "z-index: 99999 !important;",
  "setTimeout(fix, 0)",
  "return undefined as any",
  "npm install --legacy-peer-deps",
  "rm -rf node_modules && npm i",
  "it.skip('works on staging')",
  "@ts-ignore",
  "while (true) { retry() }",
  "date.getTimezoneOffset() // ???"
]

/** The arena floor, grid and faded code included, at one pixel per world unit. */
export const paintFloor = (level: Level): HTMLCanvasElement => {
  const arena = arenaOf(level)
  const c = document.createElement("canvas")
  c.width = arena.width
  c.height = arena.height
  const g = c.getContext("2d")!
  g.fillStyle = level.theme.background
  g.fillRect(0, 0, arena.width, arena.height)
  g.strokeStyle = level.theme.grid
  g.lineWidth = 1
  for (let x = 0; x <= arena.width; x += 60) {
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, arena.height); g.stroke()
  }
  for (let y = 0; y <= arena.height; y += 60) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(arena.width, y); g.stroke()
  }
  // Faded code on the floor: the codebase you are standing on.
  g.font = `16px ${MONO}`
  g.fillStyle = level.theme.grid
  let seed = level.id.length * 97
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 90; i++) {
    g.globalAlpha = 0.35 + rand() * 0.35
    const lines = [...codeLines, ...t().floorCode]
    const line = lines[Math.floor(rand() * lines.length)] ?? ""
    g.fillText(`${String(Math.floor(rand() * 900) + 10).padStart(4, " ")}  ${line}`, rand() * (arena.width - 300), 30 + rand() * (arena.height - 40))
  }
  g.globalAlpha = 1
  g.strokeStyle = level.theme.accent
  g.lineWidth = 4
  g.shadowColor = level.theme.accent
  g.shadowBlur = 20
  g.strokeRect(2, 2, arena.width - 4, arena.height - 4)
  return c
}

/** Which floor a level has, in its arena and the current language, to know when to repaint it. */
export const floorKey = (level: Level) => {
  const arena = arenaOf(level)
  return `${level.id}:${arena.width}x${arena.height}:${locale()}`
}

export interface BugLook {
  flash: number
  trait: StatusTrait
  reopened: boolean
  boss?: boolean
  /** Code freeze: iced over, legs still. */
  frozen?: boolean
  /** Memory leak: oozing green, with bubbles. */
  poisoned?: boolean
}

/** A bug facing +x, centred on the origin: legs, antennae, glowing body, spots, eyes, armour. */
export const paintBug = (ctx: CanvasRenderingContext2D, r: number, color: string, time: number, options: BugLook) => {
  const t = options.frozen ? 0 : time
  const legSwing = Math.sin(t * 18) * 0.35
  ctx.strokeStyle = shade(color, -0.25)
  ctx.lineWidth = Math.max(2, r * 0.12)
  ctx.lineCap = "round"
  for (let i = -1; i <= 1; i++) {
    for (const side of [-1, 1]) {
      const swing = (i % 2 === 0 ? legSwing : -legSwing) * side
      ctx.beginPath()
      ctx.moveTo(i * r * 0.4, side * r * 0.3)
      ctx.lineTo(i * r * 0.5 + Math.cos(swing) * r * 0.2, side * (r * 0.95 + Math.sin(swing) * r * 0.15))
      ctx.lineTo(i * r * 0.7 + r * 0.15, side * r * 1.2)
      ctx.stroke()
    }
  }
  // Antennae
  ctx.lineWidth = Math.max(1.5, r * 0.07)
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(r * 0.75, side * r * 0.15)
    ctx.quadraticCurveTo(r * 1.2, side * r * 0.3, r * 1.35, side * (r * 0.55 + Math.sin(t * 6) * r * 0.08))
    ctx.stroke()
  }
  // Abdomen and head
  ctx.shadowColor = color
  ctx.shadowBlur = options.boss ? 30 : 12
  ctx.fillStyle = options.flash > 0 ? "#ffffff" : color
  ctx.beginPath(); ctx.ellipse(-r * 0.15, 0, r * 0.85, r * 0.68, 0, 0, Math.PI * 2); ctx.fill()
  ctx.shadowBlur = 0
  ctx.fillStyle = options.flash > 0 ? "#ffffff" : shade(color, -0.35)
  ctx.beginPath(); ctx.arc(r * 0.68, 0, r * 0.36, 0, Math.PI * 2); ctx.fill()
  // Wing split and spots
  ctx.strokeStyle = shade(color, -0.5)
  ctx.lineWidth = Math.max(1.5, r * 0.06)
  ctx.beginPath(); ctx.moveTo(r * 0.45, 0); ctx.lineTo(-r * 0.95, 0); ctx.stroke()
  ctx.fillStyle = shade(color, -0.45)
  for (const [sx, sy] of [[-0.45, 0.32], [-0.1, -0.35], [0.15, 0.3], [-0.6, -0.25]] as const) {
    ctx.beginPath(); ctx.arc(sx * r, sy * r, r * 0.11, 0, Math.PI * 2); ctx.fill()
  }
  // Eyes
  ctx.fillStyle = options.reopened ? "#ff2040" : "#ffffff"
  ctx.beginPath(); ctx.arc(r * 0.85, -r * 0.14, r * 0.1, 0, Math.PI * 2); ctx.arc(r * 0.85, r * 0.14, r * 0.1, 0, Math.PI * 2); ctx.fill()
  if (options.trait === "armored") {
    ctx.strokeStyle = "#c8d0dc"
    ctx.lineWidth = 3
    ctx.setLineDash([6, 4])
    ctx.beginPath(); ctx.ellipse(-r * 0.15, 0, r * 0.95, r * 0.8, 0, 0, Math.PI * 2); ctx.stroke()
    ctx.setLineDash([])
  }
  if (options.frozen) {
    // A block of ice over the whole bug, with a few frost glints.
    ctx.fillStyle = "rgba(170, 225, 255, 0.55)"
    ctx.beginPath(); ctx.ellipse(0, 0, r * 1.15, r * 0.95, 0, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = "rgba(235, 250, 255, 0.9)"
    ctx.lineWidth = Math.max(1.5, r * 0.08)
    ctx.stroke()
    ctx.lineWidth = Math.max(1, r * 0.05)
    for (const [gx, gy] of [[-0.5, -0.4], [0.35, 0.35], [0.6, -0.5]] as const) {
      const s = r * 0.16
      ctx.beginPath()
      ctx.moveTo(gx * r - s, gy * r); ctx.lineTo(gx * r + s, gy * r)
      ctx.moveTo(gx * r, gy * r - s); ctx.lineTo(gx * r, gy * r + s)
      ctx.stroke()
    }
  }
  if (options.poisoned) {
    // A green ooze over the shell and a few bubbles rising off it.
    ctx.fillStyle = "rgba(120, 255, 90, 0.3)"
    ctx.beginPath(); ctx.ellipse(-r * 0.15, 0, r * 0.95, r * 0.8, 0, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = "rgba(150, 255, 110, 0.85)"
    for (const [bx, by, br] of [[-0.6, -0.75, 0.14], [0.1, -0.95, 0.1], [-0.25, 0.85, 0.12]] as const) {
      ctx.beginPath(); ctx.arc(bx * r, by * r, Math.max(1.5, br * r), 0, Math.PI * 2); ctx.fill()
    }
  }
}

/** A developer aiming along +x, centred on the origin: laptop-gun, hoodie in their colour, head and headphones. */
export const paintPlayer = (ctx: CanvasRenderingContext2D, color: string, hotfix: boolean) => {
  // Laptop-gun
  ctx.fillStyle = "#2b2f3a"
  ctx.fillRect(8, -5, 22, 10)
  ctx.fillStyle = hotfix ? "#ff9440" : "#7fdcff"
  ctx.shadowColor = ctx.fillStyle
  ctx.shadowBlur = 12
  ctx.fillRect(26, -3, 6, 6)
  ctx.shadowBlur = 0
  // Hoodie, in the developer's colour.
  ctx.fillStyle = color
  ctx.beginPath(); ctx.arc(0, 0, PLAYER.radius, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = shade(color, -0.2)
  ctx.beginPath(); ctx.arc(-4, 0, PLAYER.radius * 0.75, Math.PI * 0.5, Math.PI * 1.5); ctx.fill()
  // Head and headphones
  ctx.fillStyle = "#f2c9a0"
  ctx.beginPath(); ctx.arc(2, 0, 8, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = "#3b2a20"
  ctx.beginPath(); ctx.arc(0, 0, 8.5, Math.PI * 0.55, Math.PI * 1.45); ctx.fill()
  ctx.strokeStyle = "#111"
  ctx.lineWidth = 3
  ctx.beginPath(); ctx.arc(1, 0, 10, -Math.PI * 0.5, Math.PI * 0.5, true); ctx.stroke()
  ctx.fillStyle = "#ff4d6d"
  ctx.fillRect(-2, -12, 6, 5); ctx.fillRect(-2, 7, 6, 5)
}

/** A power-up box centred on the origin, its icon and its name below. */
export const paintPickup = (ctx: CanvasRenderingContext2D, kind: PickupKind) => {
  ctx.fillStyle = "rgba(157,255,176,0.15)"
  ctx.strokeStyle = "#9dffb0"
  ctx.lineWidth = 2
  ctx.shadowColor = "#9dffb0"
  ctx.shadowBlur = 14
  roundRect(ctx, -17, -17, 34, 34, 8)
  ctx.fill(); ctx.stroke()
  ctx.shadowBlur = 0
  ctx.font = `20px ${SANS}`
  ctx.textAlign = "center"
  ctx.fillText(pickupInfo(kind).icon, 0, 7)
  ctx.font = `bold 10px ${MONO}`
  ctx.fillStyle = "#9dffb0"
  ctx.fillText(pickupInfo(kind).label, 0, 32)
}

/** A Slack message bubble whose tail tip sits 25 below the origin. */
export const paintPing = (ctx: CanvasRenderingContext2D, text: string, color: string) => {
  ctx.font = `bold 12px ${SANS}`
  ctx.textAlign = "left"
  const w = ctx.measureText(text).width + 40
  const left = -w / 2
  ctx.shadowColor = "#7fb8ff"
  ctx.shadowBlur = 14
  ctx.fillStyle = "rgba(20,28,48,0.95)"
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  roundRect(ctx, left, -16, w, 32, 10)
  ctx.fill(); ctx.stroke()
  ctx.shadowBlur = 0
  ctx.beginPath(); ctx.moveTo(-6, 16); ctx.lineTo(0, 25); ctx.lineTo(6, 16); ctx.closePath()
  ctx.fillStyle = color; ctx.fill()
  ctx.font = `14px ${SANS}`
  ctx.fillText("💬", left + 8, 5)
  ctx.font = `bold 12px ${SANS}`
  ctx.fillStyle = "#e8ecf4"
  ctx.fillText(text, left + 30, 4)
}

/** The `git push --force` rocket, nose on the origin pointing right, its flame and smoke trailing to the left (to x = -60). */
export const paintRocket = (ctx: CanvasRenderingContext2D) => {
  // Smoke first, fading out behind.
  for (let i = 0; i < 5; i++) {
    ctx.globalAlpha = 0.32 - i * 0.06
    ctx.fillStyle = "#9aa4b8"
    ctx.beginPath(); ctx.arc(-24 - i * 8, 0, 4 + i * 1.4, 0, Math.PI * 2); ctx.fill()
  }
  ctx.globalAlpha = 1
  ctx.shadowColor = "#ff9440"
  ctx.shadowBlur = 14
  ctx.fillStyle = "#ffd84a"
  ctx.beginPath(); ctx.moveTo(-14, -4); ctx.lineTo(-26, 0); ctx.lineTo(-14, 4); ctx.closePath(); ctx.fill()
  ctx.fillStyle = "#ff9440"
  ctx.beginPath(); ctx.moveTo(-14, -2.5); ctx.lineTo(-20, 0); ctx.lineTo(-14, 2.5); ctx.closePath(); ctx.fill()
  ctx.shadowBlur = 0
  // Fins, body, nose.
  ctx.fillStyle = "#ff4d6d"
  ctx.beginPath(); ctx.moveTo(-14, -9); ctx.lineTo(-6, -4); ctx.lineTo(-6, 4); ctx.lineTo(-14, 9); ctx.closePath(); ctx.fill()
  ctx.fillStyle = "#e8ecf4"
  roundRect(ctx, -15, -4.5, 13, 9, 3)
  ctx.fill()
  ctx.fillStyle = "#ff4d6d"
  ctx.beginPath(); ctx.moveTo(-3, -4.5); ctx.lineTo(4, 0); ctx.lineTo(-3, 4.5); ctx.closePath(); ctx.fill()
}

/** Where a rocket will go off if nothing gets in the way, centred on the origin: the blast's reach and a cross. */
export const paintRocketTarget = (ctx: CanvasRenderingContext2D, radius: number) => {
  ctx.strokeStyle = "rgba(255,148,64,0.35)"
  ctx.lineWidth = 2
  ctx.setLineDash([10, 8])
  ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.stroke()
  ctx.setLineDash([])
  ctx.strokeStyle = "rgba(255,148,64,0.8)"
  ctx.beginPath(); ctx.moveTo(-7, -7); ctx.lineTo(7, 7); ctx.moveTo(7, -7); ctx.lineTo(-7, 7); ctx.stroke()
}

/** A boss's text projectile centred on the origin: an emoji, or a red pill around the words. */
export const paintHostile = (ctx: CanvasRenderingContext2D, text: string) => {
  if (text.length <= 2) {
    ctx.font = `18px ${SANS}`
    ctx.textAlign = "center"
    ctx.fillText(text, 0, 6)
    return
  }
  ctx.font = `bold 11px ${MONO}`
  const w = ctx.measureText(text).width + 10
  ctx.fillStyle = "#2a0a12"
  ctx.strokeStyle = "#ff4d6d"
  ctx.lineWidth = 1.5
  ctx.shadowColor = "#ff4d6d"
  ctx.shadowBlur = 10
  roundRect(ctx, -w / 2, -9, w, 18, 9)
  ctx.fill(); ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fillStyle = "#ffb3c0"
  ctx.textAlign = "center"
  ctx.fillText(text, 0, 4)
}

/** A name tag: centred on x, the text's baseline on y, on a dark rounded box. */
export const paintLabel = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, size = 11, border?: string) => {
  ctx.font = `bold ${size}px ${MONO}`
  ctx.textAlign = "center"
  const w = ctx.measureText(text).width + 8
  ctx.fillStyle = "rgba(0,0,0,0.6)"
  roundRect(ctx, x - w / 2, y - size, w, size + 5, 4)
  ctx.fill()
  if (border) {
    ctx.strokeStyle = border
    ctx.lineWidth = 1
    ctx.stroke()
  }
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
}

export interface TooltipBug {
  key: string
  priority: Priority
  summary: string
  trait: StatusTrait
}

export const TOOLTIP_WIDTH = 300

export const tooltipHeight = (bug: TooltipBug) => 44 + wrap(bug.summary, 44).length * 16 + (t().traits[bug.trait] ? 16 : 0)

/** The ticket you are aiming at, with its top-left corner on the origin. */
export const paintTooltip = (ctx: CanvasRenderingContext2D, bug: TooltipBug, color: string) => {
  const lines = wrap(bug.summary, 44)
  const trait = t().traits[bug.trait]
  ctx.fillStyle = "rgba(10,12,20,0.92)"
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  roundRect(ctx, 0, 0, TOOLTIP_WIDTH, tooltipHeight(bug), 8)
  ctx.fill(); ctx.stroke()
  ctx.textAlign = "left"
  ctx.font = `bold 12px ${MONO}`
  ctx.fillStyle = color
  ctx.fillText(`${bug.key}  ·  ${bug.priority}`, 12, 20)
  ctx.font = `13px ${SANS}`
  ctx.fillStyle = "#e8ecf4"
  lines.forEach((line, i) => ctx.fillText(line, 12, 40 + i * 16))
  if (trait) {
    ctx.font = `bold 10px ${MONO}`
    ctx.fillStyle = "#9aa4b8"
    ctx.fillText(trait, 12, 40 + lines.length * 16 + 4)
  }
}

export const paintHeart = (ctx: CanvasRenderingContext2D, x: number, y: number, color: string) => {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(x + 9, y + 16)
  ctx.bezierCurveTo(x - 4, y + 7, x + 1, y - 2, x + 9, y + 4)
  ctx.bezierCurveTo(x + 17, y - 2, x + 22, y + 7, x + 9, y + 16)
  ctx.fill()
}

export const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath()
  ctx.roundRect(x, y, Math.max(0, w), h, Math.min(r, h / 2, Math.max(0, w) / 2))
}

export const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

export const wrap = (text: string, width: number): Array<string> => {
  const words = text.split(" ")
  const lines: Array<string> = []
  let line = ""
  for (const word of words) {
    if ((line + " " + word).trim().length > width) {
      if (line) lines.push(line)
      line = word
    } else {
      line = (line + " " + word).trim()
    }
  }
  if (line) lines.push(line)
  return lines.slice(0, 4)
}

export const shade = (hex: string, amount: number): string => {
  const n = parseInt(hex.slice(1), 16)
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(c + (amount < 0 ? c * amount : (255 - c) * amount))))
  const r = f((n >> 16) & 255)
  const g = f((n >> 8) & 255)
  const b = f(n & 255)
  return `rgb(${r},${g},${b})`
}
