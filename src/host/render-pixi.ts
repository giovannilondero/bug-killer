// The Pixi (WebGL) renderer. It draws exactly what the Canvas renderer draws, from the same `View`:
// every shape is painted once with the shared Canvas 2D painters (`paint.ts`) into a texture,
// glow included, and each frame only places sprites. The Canvas renderer re-rasterises every
// shape and blur every frame, which is where its time went.
import { Application, CanvasSource, Container, Graphics, Sprite, Texture } from "pixi.js"

import { arenaOf } from "../content/arenas.ts"
import { ticketsOf } from "../content/levels.ts"
import type { Arena } from "../content/arenas.ts"
import { bugKinds } from "../content/bugs.ts"
import { clients } from "../content/clients.ts"
import { comboMultiplier } from "../sim/systems/combat.ts"
import { BUFF_SECONDS, PARTY, PLAYER, TURRET } from "../sim/constants.ts"
import type { FxValue, PickupKind, Vec } from "../sim/schema.ts"
import type { View } from "../sim/simulation.ts"
import { formatNumber, locale, t } from "./language.ts"
import { floorKey, MONO, paintBug, paintFloor, paintHeart, paintHostile, paintLabel, paintPickup, paintPing, paintPlayer, paintTooltip, pickupIcons, pickupInfo, SANS, shade, tooltipHeight, TOOLTIP_WIDTH, truncate } from "./paint.ts"
import type { BugLook, TooltipBug } from "./paint.ts"
import type { Camera, Renderer } from "./render.ts"
import { touchMode } from "./touch.ts"

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  color: string
  size: number
}

interface Floater {
  x: number
  y: number
  life: number
  max: number
  text: string
  sub: string
  color: string
  big: boolean
}

/** A painted texture and where its local origin sits in it, as a sprite anchor. */
interface Baked {
  readonly texture: Texture
  readonly ax: number
  readonly ay: number
}

/** The painted area around the local origin, in CSS pixels or world units. */
interface Box {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

const around = (half: number, halfY = half): Box => ({ left: -half, top: -halfY, right: half, bottom: halfY })

/** Textures painted on demand, keyed by what they show and at which resolution; unused ones are freed. */
const makeBakery = () => {
  const cache = new Map<string, { baked: Baked; used: number }>()
  const scratch = document.createElement("canvas").getContext("2d")!
  let frame = 0

  const bake = (key: string, res: number, box: Box, paint: (g: CanvasRenderingContext2D) => void): Baked => {
    const id = `${res}|${key}`
    const hit = cache.get(id)
    if (hit) {
      hit.used = frame
      return hit.baked
    }
    const c = document.createElement("canvas")
    c.width = Math.max(1, Math.ceil((box.right - box.left) * res))
    c.height = Math.max(1, Math.ceil((box.bottom - box.top) * res))
    const g = c.getContext("2d")!
    g.scale(res, res)
    g.translate(-box.left, -box.top)
    // The Canvas renderer leaves round caps on after its first frame: everything is drawn with them.
    g.lineCap = "round"
    paint(g)
    const texture = new Texture({ source: new CanvasSource({ resource: c, resolution: res }) })
    const baked = { texture, ax: -box.left / (c.width / res), ay: -box.top / (c.height / res) }
    cache.set(id, { baked, used: frame })
    return baked
  }

  /** Text as `fillText` draws it: `align` around x, the baseline on the origin. */
  const text = (res: number, str: string, font: string, color: string, align: CanvasTextAlign = "center"): Baked => {
    scratch.font = font
    scratch.textAlign = align
    const m = scratch.measureText(str)
    const box = { left: -m.actualBoundingBoxLeft - 4, top: -m.actualBoundingBoxAscent - 4, right: m.actualBoundingBoxRight + 4, bottom: m.actualBoundingBoxDescent + 4 }
    return bake(`text|${font}|${color}|${align}|${str}`, res, box, (g) => {
      g.font = font
      g.textAlign = align
      g.fillStyle = color
      g.fillText(str, 0, 0)
    })
  }

  const width = (font: string, str: string) => {
    scratch.font = font
    return scratch.measureText(str).width
  }

  /** Once a second, frees what nothing has drawn for ten. */
  const sweep = () => {
    frame++
    if (frame % 60 !== 0) return
    for (const [id, entry] of cache) {
      if (frame - entry.used > 600) {
        entry.baked.texture.destroy(true)
        cache.delete(id)
      }
    }
  }

  return { bake, text, width, sweep }
}

interface Place {
  rotation?: number
  scale?: number
  sx?: number
  sy?: number
  alpha?: number
  tint?: string | number
}

/**
 * Immediate-mode drawing over a retained scene: each frame takes sprites and graphics from a pool
 * in draw order, so the code reads like the Canvas renderer while Pixi batches the result.
 */
const makeLayer = (parent: Container) => {
  const root = new Container()
  parent.addChild(root)
  let i = 0

  const take = <T extends Sprite | Graphics>(make: () => T, is: (o: unknown) => boolean): T => {
    let o = root.children[i]
    if (!o || !is(o)) {
      o = make()
      root.addChildAt(o, i)
    }
    i++
    o.visible = true
    return o as T
  }

  const sprite = (baked: Baked, x: number, y: number, place: Place = {}) => {
    const s = take(() => new Sprite(), (o) => o instanceof Sprite)
    s.texture = baked.texture
    s.anchor.set(baked.ax, baked.ay)
    s.position.set(x, y)
    s.rotation = place.rotation ?? 0
    s.scale.set(place.sx ?? place.scale ?? 1, place.sy ?? place.scale ?? 1)
    s.alpha = place.alpha ?? 1
    s.tint = place.tint ?? 0xffffff
    return s
  }

  const white: Baked = { texture: Texture.WHITE, ax: 0, ay: 0 }
  /** A filled rectangle: a white pixel, stretched and tinted. */
  const rect = (x: number, y: number, w: number, h: number, color: string | number, alpha = 1) => {
    if (w <= 0 || h <= 0) return
    sprite(white, x, y, { sx: w / Texture.WHITE.width, sy: h / Texture.WHITE.height, tint: color, alpha })
  }

  const graphics = (alpha = 1) => {
    const g = take(() => new Graphics(), (o) => o instanceof Graphics)
    g.clear()
    g.alpha = alpha
    return g
  }

  const begin = () => {
    i = 0
  }

  const end = () => {
    const children = root.children
    for (let j = i; j < children.length; j++) {
      const c = children[j]!
      if (!c.visible) continue
      c.visible = false
      if (c instanceof Sprite) c.texture = Texture.EMPTY
      else if (c instanceof Graphics) c.clear()
    }
    // A crowd that has gone: keep some slack, free the rest.
    if (children.length > i + 400) {
      for (const c of root.removeChildren(i + 200)) c.destroy()
    }
  }

  return { sprite, rect, graphics, begin, end }
}

type Layer = ReturnType<typeof makeLayer>

const TAU = Math.PI * 2

/** An arc as its own path: Pixi would otherwise join it to the previous point with a line. */
const arc = (g: Graphics, x: number, y: number, r: number, from: number, to: number) =>
  g.moveTo(x + Math.cos(from) * r, y + Math.sin(from) * r).arc(x, y, r, from, to)

export const makePixiRenderer = async (canvas: HTMLCanvasElement): Promise<Renderer> => {
  let dpr = Math.min(window.devicePixelRatio || 1, 2)
  const app = new Application()
  await app.init({
    canvas,
    width: Math.max(1, canvas.clientWidth),
    height: Math.max(1, canvas.clientHeight),
    resolution: dpr,
    autoDensity: false,
    antialias: true,
    background: "#05060a",
    preference: "webgl",
    autoStart: false,
    sharedTicker: false
  })
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2)
    app.renderer.resize(Math.max(1, canvas.clientWidth), Math.max(1, canvas.clientHeight), dpr)
  }
  window.addEventListener("resize", resize)

  const bakery = makeBakery()
  const world = new Container()
  const floorSprite = new Sprite()
  world.addChild(floorSprite)
  const W = makeLayer(world)
  const screen = new Container()
  const S = makeLayer(screen)
  app.stage.addChild(world, screen)

  const camera: Camera = { x: 0, y: 0, scale: 1 }
  const particles: Array<Particle> = []
  const floaters: Array<Floater> = []
  let shake = 0
  let flash = 0
  let floorLevel = ""
  let banner: { title: string; subtitle: string; color: string; life: number; max: number } | null = null
  let time = 0
  const trail: Array<{ x: number; y: number; life: number }> = []
  /** Texture resolution for the world: the screen's, times the camera's zoom, in quarter steps. */
  let wres = dpr

  const toWorld = (screen: Vec): Vec => ({ x: camera.x + screen.x / camera.scale, y: camera.y + screen.y / camera.scale })
  const toScreen = (world: Vec): Vec => ({ x: (world.x - camera.x) * camera.scale, y: (world.y - camera.y) * camera.scale })

  const burst = (x: number, y: number, color: string, count: number, speed: number, size = 3) => {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2
      const s = speed * (0.3 + Math.random())
      const life = 0.3 + Math.random() * 0.5
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: size * (0.5 + Math.random()) })
    }
  }

  const fx = (event: FxValue) => {
    switch (event.type) {
      case "kill":
        burst(event.x, event.y, event.color, event.boss ? 120 : 22, event.boss ? 520 : 240, event.boss ? 6 : 3)
        burst(event.x, event.y, "#ffffff", event.boss ? 40 : 6, 160, 2)
        if (event.summary) {
          floaters.push({ x: event.x, y: event.y - 20, life: event.boss ? 3 : 1.6, max: event.boss ? 3 : 1.6, text: `✔ ${event.key}`, sub: event.summary, color: event.color, big: event.boss })
        }
        floaters.push({ x: event.x + 24, y: event.y + 6, life: 0.9, max: 0.9, text: `+${event.points}`, sub: "", color: "#ffffff", big: false })
        shake = Math.max(shake, event.boss ? 26 : 4)
        if (event.boss) {
          flash = 1
          banner = { title: t().hud.bossFixed, subtitle: t().hud.movedToDone(event.key), color: event.color, life: 3, max: 3 }
        }
        break
      case "hit":
        burst(event.x, event.y, event.color, 4, 120, 2)
        break
      case "hurt":
        shake = Math.max(shake, 14)
        flash = Math.max(flash, 0.5)
        burst(event.x, event.y, "#ff4d6d", 18, 260, 3)
        break
      case "bomb":
        shake = Math.max(shake, 22)
        flash = 0.9
        for (let i = 0; i < 80; i++) {
          const a = (i / 80) * Math.PI * 2
          particles.push({ x: event.x, y: event.y, vx: Math.cos(a) * 900, vy: Math.sin(a) * 900, life: 0.5, max: 0.5, color: "#ffffff", size: 4 })
        }
        floaters.push({ x: event.x, y: event.y - 40, life: 1.4, max: 1.4, text: "git reset --hard", sub: "", color: "#ffffff", big: true })
        break
      case "pickup": {
        const info = pickupInfo(event.kind)
        floaters.push({ x: event.x, y: event.y - 20, life: 1.3, max: 1.3, text: `${info.icon} ${info.label}`, sub: info.hint, color: "#9dffb0", big: false })
        burst(event.x, event.y, "#9dffb0", 16, 200, 3)
        break
      }
      case "reopen":
        floaters.push({ x: event.x, y: event.y - 24, life: 1.6, max: 1.6, text: "REOPENED", sub: t().hud.reopenedSub(event.key), color: "#ff4d6d", big: false })
        burst(event.x, event.y, "#ff4d6d", 14, 180, 3)
        break
      case "resurrect":
        floaters.push({ x: event.x, y: event.y - 30, life: 2.6, max: 2.6, text: t().hud.resurrected(event.key), sub: t().hud.resurrectedSub(clients[event.client].name), color: "#9dff6b", big: true })
        burst(event.x, event.y, "#9dff6b", 40, 260, 4)
        shake = Math.max(shake, 8)
        break
      case "dash":
        burst(event.x, event.y, "#7fdcff", 10, 140, 2)
        break
      case "spawn":
        burst(event.x, event.y, "#ffffff", 8, 90, 2)
        break
      case "teleport":
        burst(event.x, event.y, "#c6ff6b", 30, 300, 3)
        break
      case "bossPhase":
        floaters.push({ x: event.x, y: event.y - 80, life: 2, max: 2, text: event.text, sub: "", color: "#ffffff", big: true })
        shake = Math.max(shake, 10)
        break
      case "ping":
        floaters.push({ x: event.x, y: event.y - 20, life: 1.2, max: 1.2, text: `✔✔ ${event.text}`, sub: "", color: "#7fb8ff", big: false })
        burst(event.x, event.y, "#7fb8ff", 14, 180, 3)
        break
      case "callDone":
        floaters.push({ x: event.x, y: event.y - 50, life: 2, max: 2, text: t().calls.answered(event.points), sub: t().calls.kinds[event.kind], color: "#ffd84a", big: true })
        burst(event.x, event.y, "#ffd84a", 36, 280, 4)
        break
      case "down":
        floaters.push({ x: event.x, y: event.y - 40, life: 2.4, max: 2.4, text: t().hud.teammateDown(event.name), sub: t().hud.teammateDownSub, color: "#ff9440", big: true })
        burst(event.x, event.y, "#ff9440", 30, 220, 4)
        break
      case "revived":
        floaters.push({ x: event.x, y: event.y - 40, life: 2, max: 2, text: t().hud.revived(event.name), sub: "", color: "#9dffb0", big: true })
        burst(event.x, event.y, "#9dffb0", 30, 260, 4)
        break
      case "turret":
        // The pickup already says what it is: the turret just powers up.
        burst(event.x, event.y, "#7fdcff", 26, 220, 3)
        break
      case "hallucination":
        floaters.push({ x: event.x, y: event.y - 30, life: 1.2, max: 1.2, text: t().hud.hallucination, sub: "", color: "#c792ff", big: false })
        break
      case "shoot":
        break
    }
  }

  const showBanner = (title: string, subtitle: string, color: string, seconds = 3) => {
    banner = { title, subtitle, color, life: seconds, max: seconds }
  }

  // --- Drawing helpers ----------------------------------------------------

  const text = (L: Layer, res: number, str: string, font: string, color: string, x: number, y: number, align: CanvasTextAlign = "center", alpha = 1) => {
    if (str) L.sprite(bakery.text(res, str, font, color, align), x, y, { alpha })
  }

  const label = (L: Layer, res: number, str: string, x: number, y: number, color: string, size = 11, border?: string, alpha = 1) => {
    const w = bakery.width(`bold ${size}px ${MONO}`, str) + 8
    const box = { left: -w / 2 - 2, top: -size - 2, right: w / 2 + 2, bottom: 7 }
    L.sprite(bakery.bake(`label|${str}|${color}|${size}|${border ?? ""}`, res, box, (g) => paintLabel(g, str, 0, 0, color, size, border)), x, y, { alpha })
  }

  const disc = (L: Layer, res: number, x: number, y: number, r: number, color: string, alpha = 1) => {
    L.sprite(bakery.bake(`disc|${r}`, res, around(r + 1), (g) => {
      g.fillStyle = "#ffffff"
      g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill()
    }), x, y, { tint: color, alpha })
  }

  /** The bug's legs and antennae loop every 2π/6 seconds: baked in that many frames, glow and all. */
  const bugFrame = (r: number, color: string, age: number, options: BugLook) => {
    const period = TAU / 6
    const frames = options.boss ? 12 : 24
    const k = Math.floor((((age % period) + period) % period) / period * frames) % frames
    const blur = options.boss ? 30 : 12
    const half = Math.max(r * 1.45 + 4, r + blur * 1.6)
    const look = `${options.flash > 0 ? "f" : ""}${options.reopened ? "r" : ""}${options.trait === "armored" ? "a" : ""}${options.boss ? "b" : ""}`
    return bakery.bake(`bug|${color}|${r}|${look}|${k}`, wres, around(half), (g) => paintBug(g, r, color, (k * period) / frames, options))
  }

  /** `full` is the radius the frames are baked at; `r` the one drawn, smaller while the bug spawns in. */
  const drawBug = (x: number, y: number, r: number, full: number, color: string, heading: number, age: number, options: BugLook, alpha: number) => {
    let body = alpha
    if (options.trait === "jittery" && Math.sin(age * 40) > 0.6) {
      // Glitchy RGB split for bugs that are "In development".
      const ellipse = bakery.bake(`ellipse|${r}`, wres, around(r + 2), (g) => {
        g.fillStyle = "#ffffff"
        g.beginPath(); g.ellipse(0, 0, r * 0.8, r * 0.6, 0, 0, TAU); g.fill()
      })
      W.sprite(ellipse, x - 3, y, { rotation: heading, alpha: 0.5, tint: "#ff00ff" })
      W.sprite(ellipse, x + 3, y, { rotation: heading, alpha: 0.5, tint: "#00ffff" })
      // The Canvas renderer resets the alpha to 1 here, spawn-in fade or not.
      body = 1
    }
    W.sprite(bugFrame(full, color, age, options), x, y, { rotation: heading, scale: r / full, alpha: body })
    if (options.trait === "armored") {
      const size = Math.round(full * 0.7)
      W.sprite(bakery.text(wres, "🔒", `${size}px ${SANS}`, "#ffffff"), x, y + r * 0.25, { scale: r / full, alpha })
    }
    if (options.trait === "reopens") {
      const arc = bakery.bake(`reopens|${full}`, wres, around(full * 1.35 + 3), (g) => {
        g.strokeStyle = "rgba(255,255,255,0.35)"
        g.lineWidth = 1.5
        g.setLineDash([3, 5])
        g.beginPath(); g.arc(0, 0, full * 1.35, 0, Math.PI * 1.6); g.stroke()
      })
      W.sprite(arc, x, y, { rotation: age * 2, scale: r / full, alpha })
    }
  }

  /** A developer in burnout: lying down, greyed out, with the revive filling up around them. */
  const drawDown = (view: NonNullable<View["player"]>) => {
    const { x, y } = view.position
    W.sprite(bakery.bake("down", wres, around(30), (g) => {
      g.globalAlpha = 0.55
      g.fillStyle = "#6b7280"
      g.beginPath(); g.ellipse(0, 0, PLAYER.radius * 1.2, PLAYER.radius * 0.8, 0.3, 0, TAU); g.fill()
      g.fillStyle = "#f2c9a0"
      g.beginPath(); g.arc(12, -4, 7, 0, TAU); g.fill()
    }), x, y)
    text(W, wres, "🔥", `18px ${SANS}`, "#f2c9a0", x, y - 24 + Math.sin(time * 6) * 2)
    const g = W.graphics()
    g.circle(x, y, PARTY.reviveRadius).stroke({ width: 4, color: 0xffffff, alpha: 0.15 })
    if (view.revive > 0) {
      arc(g, x, y, PARTY.reviveRadius, -Math.PI / 2, -Math.PI / 2 + (view.revive / PARTY.reviveSeconds) * TAU).stroke({ width: 4, color: "#9dffb0", cap: "round" })
    }
    label(W, wres, `${t().hud.burnout} · ${view.name}`, x, y + PLAYER.radius + 22, "#ff9440", 10)
  }

  const drawPlayer = (view: NonNullable<View["player"]>, named: boolean) => {
    if (view.hp <= 0 && named) {
      drawDown(view)
      return
    }
    const { x, y } = view.position
    const aim = Math.atan2(view.aim.y - y, view.aim.x - x)
    const blinking = view.invulnerable > 0 && view.buffs.unitTest <= 0 && Math.floor(time * 20) % 2 === 0
    if (view.dashTime > 0 || view.buffs.coffee > 0) trail.push({ x, y, life: 0.25 })
    for (const t of trail) disc(W, wres, t.x, t.y, PLAYER.radius, "#7fdcff", (t.life / 0.25) * 0.35)
    const alpha = blinking ? 0.35 : 1
    W.sprite(bakery.bake("playerShadow", wres, around(24), (g) => {
      g.fillStyle = "rgba(0,0,0,0.35)"
      g.beginPath(); g.ellipse(3, 6, 18, 12, 0, 0, TAU); g.fill()
    }), x, y, { alpha })
    const hotfix = view.buffs.hotfix > 0
    W.sprite(bakery.bake(`player|${view.color}|${hotfix}`, wres, { left: -20, top: -24, right: 54, bottom: 24 }, (g) => paintPlayer(g, view.color, hotfix)), x, y, { rotation: aim, alpha })
    if (view.buffs.unitTest > 0) {
      W.sprite(bakery.bake("unitTest", wres, around(58), (g) => {
        g.strokeStyle = "#58e6a0"
        g.lineWidth = 3
        g.shadowColor = "#58e6a0"
        g.shadowBlur = 16
        g.beginPath()
        for (let i = 0; i <= 6; i++) {
          const a = (i / 6) * TAU
          if (i === 0) g.moveTo(Math.cos(a) * 30, Math.sin(a) * 30); else g.lineTo(Math.cos(a) * 30, Math.sin(a) * 30)
        }
        g.stroke()
      }), x, y, { rotation: time })
      text(W, wres, t().hud.testsPassing, `bold 11px ${MONO}`, "#58e6a0", x, y - 38)
    }
    if (named) label(W, wres, view.name, x, y - PLAYER.radius - 14, view.color, 10)
  }

  /** The bonus call in the arena: the Meet room to stand in, or the Slack messages to go read. */
  const drawCall = (view: View) => {
    const call = view.calls.active
    if (!call) return
    const color = clients[call.client].color
    const fading = call.timeLeft < 4 && Math.floor(time * 6) % 2 === 0
    const alpha = fading ? 0.45 : 1
    if (call.kind === "meet") {
      const { x, y } = call.room
      const r = call.radius
      const inside = view.player !== null && (view.player.position.x - x) ** 2 + (view.player.position.y - y) ** 2 <= r * r
      W.sprite(bakery.bake(`meetRoom|${color}|${r}`, wres, around(r + 1), (g) => {
        const glow = g.createRadialGradient(0, 0, r * 0.2, 0, 0, r)
        glow.addColorStop(0, shade(color, -0.55))
        glow.addColorStop(1, shade(color, -0.75))
        g.fillStyle = glow
        g.beginPath(); g.arc(0, 0, r, 0, TAU); g.fill()
      }), x, y, { alpha: alpha * (inside ? 0.75 : 0.5) })
      W.sprite(bakery.bake(`meetRing|${color}|${r}|${inside}`, wres, around(r + 44), (g) => {
        g.strokeStyle = color
        g.lineWidth = 3
        g.shadowColor = color
        g.shadowBlur = inside ? 24 : 12
        g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke()
      }), x, y, { alpha })
      const dashed = r + 10
      W.sprite(bakery.bake(`meetDash|${color}|${dashed}`, wres, around(dashed + 3), (g) => {
        g.strokeStyle = color
        g.lineWidth = 2
        g.setLineDash([10, 8])
        g.beginPath(); g.arc(0, 0, dashed, 0, TAU); g.stroke()
      }), x, y, { rotation: time * 0.6, scale: (dashed + Math.sin(time * 4) * 3) / dashed, alpha })
      // How long you have sat in the meeting.
      if (call.progress > 0) {
        arc(W.graphics(alpha), x, y, r - 8, -Math.PI / 2, -Math.PI / 2 + (call.progress / call.goal) * TAU).stroke({ width: 7, color: "#ffd84a", cap: "round" })
      }
      text(W, wres, "📹", `34px ${SANS}`, "#ffffff", x, y + 12 + Math.sin(time * 3) * 3, "center", alpha)
      label(W, wres, `${t().calls.room} · ${clients[call.client].name}`, x, y - r - 14, color, 12, undefined, alpha)
      label(W, wres, truncate(call.title, 40), x, y + r + 22, "#e8ecf4", 11, undefined, alpha)
    } else {
      for (const [i, ping] of call.pings.entries()) {
        const bob = Math.sin(time * 4 + i * 2) * 4
        const half = bakery.width(`bold 12px ${SANS}`, ping.text) / 2 + 20
        const baked = bakery.bake(`ping|${ping.text}|${color}`, wres, { left: -half - 24, top: -40, right: half + 24, bottom: 40 }, (g) => paintPing(g, ping.text, color))
        W.sprite(baked, ping.x, ping.y + bob, { alpha })
      }
    }
  }

  const drawBoss = (boss: View["bosses"][number]) => {
    const { x, y } = boss.position
    const heading = Math.atan2(boss.position.y - (boss.position.y - 1), 0) + Math.sin(boss.age) * 0.2 + Math.PI / 2
    if (boss.pattern === "crash" && Math.sin(time * 30) > 0.7) {
      drawBug(x + Math.random() * 10 - 5, y, boss.radius, boss.radius, "#ff00ff", heading, boss.age, { flash: 0, trait: "plain", reopened: false, boss: true }, 0.4)
    }
    drawBug(x, y, boss.radius, boss.radius, boss.color, heading, boss.age, { flash: boss.hitFlash, trait: "plain", reopened: true, boss: true }, 1)
    if (boss.shield > 0) {
      const r = boss.radius * 1.35
      W.sprite(bakery.bake(`shield|${r}`, wres, around(r + 34), (g) => {
        g.strokeStyle = "rgba(255,255,255,0.8)"
        g.lineWidth = 4
        g.shadowColor = "#ffffff"
        g.shadowBlur = 20
        g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke()
      }), x, y)
      text(W, wres, boss.pattern === "twoFactor" ? "🔐 OTP ******" : t().hud.booting, `bold 14px ${MONO}`, "#ffffff", x, y - boss.radius * 1.5)
    }
    if (boss.pattern === "undefined") {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + time * 0.8
        text(W, wres, i % 2 ? "null" : "undefined", `bold 13px ${MONO}`, "rgba(255,122,89,0.8)", x + Math.cos(a) * boss.radius * 1.6, y + Math.sin(a) * boss.radius * 1.6)
      }
    }
    if (boss.pattern === "twoFactor" && boss.phase === 2) {
      text(W, wres, t().hud.factor, `bold 13px ${MONO}`, "#c79bff", x, y + boss.radius * 1.6)
    }
    text(W, wres, boss.key, `bold 14px ${MONO}`, "#ffffff", x, y - boss.radius - 14)
  }

  // --- Frame ------------------------------------------------------------

  const draw = (view: View, cursor: Vec, dt: number) => {
    time += dt
    if (floorLevel !== floorKey(view.level)) {
      const previous = floorSprite.texture
      floorSprite.texture = new Texture({ source: new CanvasSource({ resource: paintFloor(view.level), resolution: 1 }) })
      if (previous !== Texture.EMPTY) previous.destroy(true)
      floorLevel = floorKey(view.level)
    }
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (app.renderer.width !== width || app.renderer.height !== height) resize()
    camera.scale = Math.max(0.5, Math.min(1.2, Math.min(width / 1150, height / 760)))
    wres = Math.ceil(dpr * camera.scale * 4) / 4
    const sres = dpr
    const viewW = width / camera.scale
    const viewH = height / camera.scale
    const arena = arenaOf(view.level)
    const focus = view.player?.position ?? { x: arena.width / 2, y: arena.height / 2 }
    const targetX = viewW >= arena.width ? (arena.width - viewW) / 2 : Math.max(0, Math.min(arena.width - viewW, focus.x - viewW / 2))
    const targetY = viewH >= arena.height ? (arena.height - viewH) / 2 : Math.max(0, Math.min(arena.height - viewH, focus.y - viewH / 2))
    camera.x += (targetX - camera.x) * Math.min(1, dt * 8)
    camera.y += (targetY - camera.y) * Math.min(1, dt * 8)

    shake = Math.max(0, shake - dt * 60)
    flash = Math.max(0, flash - dt * 2.5)
    const sx = (Math.random() - 0.5) * shake
    const sy = (Math.random() - 0.5) * shake

    world.scale.set(camera.scale)
    world.position.set(-camera.x * camera.scale + sx, -camera.y * camera.scale + sy)
    W.begin()
    S.begin()

    const accent = view.level.theme.accent
    const mission = view.missions.active

    drawCall(view)

    // AI turrets: a little tripod with a barrel tracking its target, and a ring for the time left.
    for (const turret of view.turrets) {
      const { x, y } = turret.position
      const ending = turret.life < 2.5 && Math.floor(time * 8) % 2 === 0
      const alpha = ending ? 0.5 : 1
      const g = W.graphics(alpha)
      g.circle(x, y, TURRET.radius + 8).stroke({ width: 3, color: "#7fdcff", alpha: 0.25 })
      arc(g, x, y, TURRET.radius + 8, -Math.PI / 2, -Math.PI / 2 + (turret.life / TURRET.seconds) * TAU).stroke({ width: 3, color: "#7fdcff", cap: "round" })
      W.sprite(bakery.bake("turretLegs", wres, around(24), (g) => {
        g.strokeStyle = "#2b2f3a"
        g.lineWidth = 4
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * TAU + Math.PI / 2
          g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 20, Math.sin(a) * 20); g.stroke()
        }
      }), x, y, { alpha })
      W.sprite(bakery.bake("turretBarrel", wres, { left: -2, top: -20, right: 46, bottom: 20 }, (g) => {
        g.fillStyle = "#3a4152"
        g.fillRect(4, -4, 22, 8)
        g.fillStyle = "#7fdcff"
        g.shadowColor = "#7fdcff"
        g.shadowBlur = 10
        g.fillRect(22, -3, 5, 6)
      }), x, y, { rotation: turret.aim, alpha })
      W.sprite(bakery.bake("turretCore", wres, around(38), (g) => {
        g.fillStyle = "#1b2030"
        g.strokeStyle = "#7fdcff"
        g.lineWidth = 2
        g.shadowColor = "#7fdcff"
        g.shadowBlur = 14
        g.beginPath(); g.arc(0, 0, 12, 0, TAU); g.fill(); g.stroke()
        g.shadowBlur = 0
        g.font = `bold 9px ${MONO}`
        g.textAlign = "center"
        g.fillStyle = "#7fdcff"
        g.fillText("AI", 0, 3)
      }), x, y, { alpha })
    }

    // Pickups
    for (const pickup of view.pickups) {
      const { x, y } = pickup.position
      const bob = Math.sin(time * 4 + x) * 3
      const fading = pickup.life < 3 && Math.floor(time * 8) % 2 === 0
      if (fading) continue
      W.sprite(bakePickup(pickup.kind), x, y + bob)
    }

    // Bugs
    const aimWorld = toWorld(cursor)
    let hovered: View["bugs"][number] | null = null
    let hoveredDistance = 70 ** 2
    for (const bug of view.bugs) {
      const d = (aimWorld.x - bug.position.x) ** 2 + (aimWorld.y - bug.position.y) ** 2
      if (d < hoveredDistance) {
        hovered = bug
        hoveredDistance = d
      }
    }
    // On a phone the aimed bug's name grows into a chip with its priority and trait, instead of the tooltip.
    const chip = touchMode() ? hovered : null
    for (const bug of view.bugs) {
      const { x, y } = bug.position
      const heading = view.player ? Math.atan2(view.player.position.y - y, view.player.position.x - x) : 0
      const appear = Math.min(1, bug.age / 0.4)
      if (bug.resurrectedBy) {
        // A zombie ticket: a sickly green aura and the client's colour around it.
        const r = bug.radius
        W.sprite(bakery.bake(`zombieAura|${r}`, wres, around(r * 2), (g) => {
          const glow = g.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 2)
          glow.addColorStop(0, "rgba(157,255,107,0.35)")
          glow.addColorStop(1, "rgba(157,255,107,0)")
          g.fillStyle = glow
          g.beginPath(); g.arc(0, 0, r * 2, 0, TAU); g.fill()
        }), x, y, { alpha: appear })
        const client = clients[bug.resurrectedBy].color
        W.sprite(bakery.bake(`zombieRing|${client}|${r}`, wres, around(r * 1.45 + 3), (g) => {
          g.strokeStyle = client
          g.lineWidth = 2
          g.setLineDash([2, 6])
          g.beginPath(); g.arc(0, 0, r * 1.45, 0, TAU); g.stroke()
        }), x, y, { rotation: -time * 3, alpha: appear })
      }
      const color = bug.resurrectedBy ? "#9dff6b" : bugKinds[bug.priority].color
      drawBug(x, y, bug.radius * (0.4 + appear * 0.6), bug.radius, color, heading, bug.age, { flash: bug.hitFlash, trait: bug.trait, reopened: bug.reopened || bug.resurrectedBy !== null }, appear)
      const isTarget = mission?.kind === "killTarget" && mission.target === bug.key
      if (isTarget) {
        const pulse = bug.radius * 1.6 + Math.sin(time * 8) * 4
        const g = W.graphics()
        g.circle(x, y, pulse).stroke({ width: 3, color: "#ff2040" })
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * TAU + time
          g.moveTo(x + Math.cos(a) * pulse, y + Math.sin(a) * pulse).lineTo(x + Math.cos(a) * (pulse + 10), y + Math.sin(a) * (pulse + 10))
        }
        g.stroke({ width: 3, color: "#ff2040", cap: "round" })
      }
      const name = bug.resurrectedBy ? `🧟 ${bug.key}` : bug.reopened ? `${bug.key} ↺` : bug.key
      if (bug === chip) {
        const trait = t().traits[bug.trait].split(":")[0]
        label(W, wres, [name, bug.priority, trait].filter(Boolean).join(" · "), x, y - bug.radius - 10, bugKinds[bug.priority].color, 16, bugKinds[bug.priority].color)
      } else {
        label(W, wres, name, x, y - bug.radius - 10, isTarget ? "#ff6b81" : bug.resurrectedBy ? "#9dff6b" : bug.reopened ? "#ff6b81" : "#e8ecf4")
      }
      if (bug.hp < bug.maxHp) {
        const w = bug.radius * 2
        W.rect(x - w / 2, y + bug.radius + 6, w, 4, 0x000000, 0.6)
        W.rect(x - w / 2, y + bug.radius + 6, w * Math.max(0, bug.hp / bug.maxHp), 4, bugKinds[bug.priority].color)
      }
    }

    for (const boss of view.bosses) drawBoss(boss)

    // Shots
    for (const shot of view.shots) {
      const { x, y } = shot.position
      const color = shot.homing ? "#ffb347" : view.player && view.player.buffs.hotfix > 0 ? "#ffb070" : "#a8f0ff"
      W.sprite(bakery.bake(`shot|${color}`, wres, { left: -40, top: -22, right: 22, bottom: 22 }, (g) => {
        g.strokeStyle = color
        g.shadowColor = color
        g.shadowBlur = 10
        g.lineWidth = 5
        g.beginPath(); g.moveTo(-16, 0); g.lineTo(0, 0); g.stroke()
      }), x, y, { rotation: Math.atan2(shot.velocity.y, shot.velocity.x) })
    }

    for (const shot of view.hostile) {
      const { x, y } = shot.position
      const half = shot.text.length <= 2 ? 20 : bakery.width(`bold 11px ${MONO}`, shot.text) / 2 + 22
      W.sprite(bakery.bake(`hostile|${shot.text}`, wres, around(half, 28), (g) => paintHostile(g, shot.text)), x, y)
    }

    // Teammates first, then whoever this screen follows on top.
    const named = view.players.length > 1
    for (const teammate of view.players) {
      if (teammate.slot !== view.player?.slot) drawPlayer(teammate, named)
    }
    if (view.player) drawPlayer(view.player, named)

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!
      p.life -= dt
      if (p.life <= 0) {
        particles.splice(i, 1)
        continue
      }
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vx *= 0.92
      p.vy *= 0.92
      W.rect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size, p.color, p.life / p.max)
    }
    for (let i = trail.length - 1; i >= 0; i--) {
      trail[i]!.life -= dt
      if (trail[i]!.life <= 0) trail.splice(i, 1)
    }

    // Floating texts
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i]!
      f.life -= dt
      if (f.life <= 0) {
        floaters.splice(i, 1)
        continue
      }
      const k = f.life / f.max
      const alpha = Math.min(1, k * 2)
      const y = f.y - (1 - k) * 40
      const font = `bold ${f.big ? 22 : 13}px ${MONO}`
      const half = bakery.width(font, f.text) / 2 + 6
      const size = f.big ? 22 : 13
      W.sprite(bakery.bake(`floater|${f.text}|${f.color}|${f.big}`, wres, { left: -half, top: -size - 6, right: half + 2, bottom: 10 }, (g) => {
        g.textAlign = "center"
        g.font = font
        g.fillStyle = "#000"
        g.fillText(f.text, 1, 1)
        g.fillStyle = f.color
        g.fillText(f.text, 0, 0)
      }), f.x, y, { alpha })
      // On a phone the small popups keep only their headline: the ticket summary covers the arena.
      if (f.sub && (f.big || !touchMode())) {
        text(W, wres, truncate(f.sub, f.big ? 70 : 46), `${f.big ? 14 : 11}px ${SANS}`, "#d8dee9", f.x, y + (f.big ? 22 : 15), "center", alpha)
      }
    }

    // --- Screen space ---------------------------------------------------

    if (flash > 0) S.rect(0, 0, width, height, 0xffffff, flash * 0.35)
    if (view.player && view.player.hp <= 0 && view.players.length > 1 && view.run.phase !== "dead") {
      S.rect(0, 0, width, height, "#14161e", 0.45)
      text(S, sres, t().hud.youAreDown, `bold 16px ${MONO}`, "#ff9440", width / 2, height * 0.68)
    } else if (view.player && view.player.hp <= 2 && view.run.phase !== "dead") {
      // Baked at its strongest edge, then faded to the pulse: the gradient's alpha scales linearly.
      const vignette = bakery.bake(`vignette|${width}|${height}`, 0.5, { left: 0, top: 0, right: width, bottom: height }, (g) => {
        const v = g.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.3, width / 2, height / 2, Math.max(width, height) * 0.7)
        v.addColorStop(0, "rgba(255,0,40,0)")
        v.addColorStop(1, "rgba(255,0,40,0.35)")
        g.fillStyle = v
        g.fillRect(0, 0, width, height)
      })
      S.sprite(vignette, 0, 0, { alpha: (0.25 + Math.sin(time * 5) * 0.1) / 0.35 })
    }

    // Arrows toward an off-screen mission target, and toward the call.
    const pointAt = (world: Vec, color: string, str: string, textColor: string) => {
      const sxT = (world.x - camera.x) * camera.scale
      const syT = (world.y - camera.y) * camera.scale
      if (sxT >= 0 && syT >= 0 && sxT <= width && syT <= height) return
      const cx = width / 2
      const cy = height / 2
      const a = Math.atan2(syT - cy, sxT - cx)
      const ex = Math.max(40, Math.min(width - 40, cx + Math.cos(a) * width))
      const ey = Math.max(90, Math.min(height - 40, cy + Math.sin(a) * height))
      S.sprite(bakery.bake(`arrow|${color}`, sres, { left: -12, top: -14, right: 20, bottom: 14 }, (g) => {
        g.fillStyle = color
        g.beginPath(); g.moveTo(18, 0); g.lineTo(-10, -12); g.lineTo(-10, 12); g.closePath(); g.fill()
      }), ex, ey, { rotation: a })
      label(S, sres, str, ex, ey + 28, textColor, 11)
    }
    if (mission?.kind === "killTarget") {
      const target = view.bugs.find((b) => b.key === mission.target)
      if (target) pointAt(target.position, "#ff2040", target.key, "#ff6b81")
    }
    for (const teammate of view.players) {
      if (teammate.hp <= 0 && teammate.slot !== view.player?.slot && view.run.phase !== "dead") pointAt(teammate.position, "#ff9440", `🔥 ${teammate.name}`, "#ffb070")
    }
    const call = view.calls.active
    if (call?.kind === "meet") pointAt(call.room, clients[call.client].color, t().calls.kinds.meet, "#e8ecf4")
    if (call?.kind === "slack" && view.player) {
      const me = view.player.position
      const nearest = [...call.pings].sort((a, b) => (a.x - me.x) ** 2 + (a.y - me.y) ** 2 - ((b.x - me.x) ** 2 + (b.y - me.y) ** 2))[0]
      if (nearest) pointAt(nearest, "#7fb8ff", t().calls.kinds.slack, "#e8ecf4")
    }

    // Ticket tooltip: read the ticket you are aiming at (desktop; a phone has the chip).
    if (hovered && !chip) {
      const hx = (hovered.position.x - camera.x) * camera.scale
      const hy = (hovered.position.y - camera.y) * camera.scale
      const boxW = TOOLTIP_WIDTH
      const boxH = tooltipHeight(hovered)
      const bx = Math.min(width - boxW - 10, hx + 30)
      const by = Math.max(110, Math.min(height - boxH - 10, hy - boxH / 2))
      S.sprite(bakeTooltip(hovered, bugKinds[hovered.priority].color, boxH), bx, by)
    }

    S.sprite(bakery.bake("hudShade", sres, { left: 0, top: 0, right: 4, bottom: 120 }, (g) => {
      const shadow = g.createLinearGradient(0, 0, 0, 120)
      shadow.addColorStop(0, "rgba(5,6,10,0.75)")
      shadow.addColorStop(1, "rgba(5,6,10,0)")
      g.fillStyle = shadow
      g.fillRect(0, 0, 4, 120)
    }), 0, 0, { sx: width / 4 })
    drawMinimap(view, width, height, viewW, viewH)
    drawHud(view, width, height, accent)

    if (banner) {
      banner.life -= dt
      const k = banner.life / banner.max
      if (banner.life <= 0) banner = null
      else {
        const alpha = Math.min(1, k * 4, (1 - k) * 8)
        S.rect(0, height * 0.32, width, 110, 0x000000, 0.65 * alpha)
        text(S, sres, banner.title, `900 44px ${SANS}`, banner.color, width / 2, height * 0.32 + 55, "center", alpha)
        text(S, sres, truncate(banner.subtitle, 90), `16px ${MONO}`, "#e8ecf4", width / 2, height * 0.32 + 85, "center", alpha)
      }
    }

    // Crosshair
    if (view.run.phase !== "dead" && view.run.phase !== "cleared") {
      const color = hovered ? bugKinds[hovered.priority].color : "#ffffff"
      S.sprite(bakery.bake(`crosshair|${color}`, sres, around(19), (g) => {
        g.strokeStyle = color
        g.lineWidth = 2
        g.beginPath(); g.arc(0, 0, 10, 0, TAU); g.stroke()
        g.beginPath()
        g.moveTo(-16, 0); g.lineTo(-5, 0)
        g.moveTo(5, 0); g.lineTo(16, 0)
        g.moveTo(0, -16); g.lineTo(0, -5)
        g.moveTo(0, 5); g.lineTo(0, 16)
        g.stroke()
      }), cursor.x, cursor.y)
    }

    W.end()
    S.end()
    bakery.sweep()
    app.render()
  }

  const bakePickup = (kind: PickupKind) => {
    const info = pickupInfo(kind)
    const half = Math.max(40, bakery.width(`bold 10px ${MONO}`, info.label) / 2 + 6)
    return bakery.bake(`pickup|${kind}|${info.label}`, wres, { left: -half, top: -40, right: half, bottom: 38 }, (g) => paintPickup(g, kind))
  }

  const bakeTooltip = (bug: TooltipBug, color: string, boxH: number) =>
    bakery.bake(`tooltip|${bug.key}|${bug.priority}|${bug.trait}|${locale()}|${bug.summary}`, dpr, { left: -2, top: -2, right: TOOLTIP_WIDTH + 2, bottom: boxH + 2 }, (g) => paintTooltip(g, bug, color))

  const drawHud = (view: View, width: number, height: number, accent: string) => {
    const res = dpr
    const run = view.run
    const player = view.player
    // Top-left: sprint and sanity.
    text(S, res, `${view.level.sprint.toUpperCase()} · ${view.level.name.toUpperCase()}`, `bold 12px ${MONO}`, accent, 20, 28, "left")
    if (player) {
      text(S, res, t().hud.sanity, `11px ${MONO}`, "#9aa4b8", 20, 50, "left")
      for (let i = 0; i < player.maxHp; i++) {
        const color = i < player.hp ? "#ff4d6d" : "rgba(255,255,255,0.15)"
        S.sprite(bakery.bake(`heart|${color}`, res, { left: -6, top: -4, right: 24, bottom: 19 }, (g) => paintHeart(g, 0, 0, color)), 20 + i * 24, 58)
      }
      // Hardcore: said right of the single heart, in its colour.
      if (view.hardcore) text(S, res, `☠ ${t().hardcore.hud}`, `bold 11px ${MONO}`, "#ff4d6d", 26 + player.maxHp * 24, 71, "left")
      text(S, res, "GIT RESET --HARD  [Q]", `11px ${MONO}`, "#9aa4b8", 20, 100, "left")
      for (let i = 0; i < player.bombs; i++) text(S, res, "⏪", `16px ${SANS}`, "#9aa4b8", 20 + i * 24, 122, "left")
      let row = 0
      for (const kind of ["tools", "hotfix", "refactor", "coffee", "unitTest"] as const) {
        const left = player.buffs[kind]
        if (left <= 0) continue
        const y = 142 + row * 22
        text(S, res, pickupIcons[kind], `14px ${SANS}`, "#ffffff", 20, y + 4, "left")
        S.rect(44, y - 6, 100, 8, 0xffffff, 0.15)
        S.rect(44, y - 6, 100 * (left / BUFF_SECONDS[kind]), 8, "#9dffb0")
        row++
      }
    }

    // Top-right: story points and combo.
    text(S, res, "STORY POINTS", `11px ${MONO}`, "#9aa4b8", width - 20, 28, "right")
    text(S, res, formatNumber(run.score), `900 30px ${SANS}`, "#ffffff", width - 20, 60, "right")
    if (run.combo >= 2) {
      const color = run.combo >= 10 ? "#ffd84a" : accent
      text(S, res, `COMBO ×${run.combo}  (${comboMultiplier(run.combo)}x)`, `bold 15px ${MONO}`, color, width - 20, 84, "right")
      S.rect(width - 160, 92, 140, 4, 0xffffff, 0.15)
      S.rect(width - 160, 92, 140 * (run.comboTimer / 2.6), 4, color)
    }

    /** A rounded progress bar, its fill rounded the way `roundRect` clamps the corners. */
    const bar = (x: number, y: number, w: number, h: number, r: number, fill: number, color: string) => {
      const g = S.graphics()
      g.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2)).fill({ color: 0xffffff, alpha: 0.12 })
      const f = Math.max(0, w * fill)
      if (f > 0) g.roundRect(x, y, f, h, Math.min(r, h / 2, f / 2)).fill({ color })
    }

    // Top-centre: backlog or boss.
    const boss = view.bosses[0]
    if (boss) {
      const w = Math.min(560, width - 420)
      const x = width / 2 - w / 2
      text(S, res, `☠ ${boss.key}`, `bold 13px ${MONO}`, boss.color, width / 2, 24)
      text(S, res, truncate(boss.title, 80), `12px ${SANS}`, "#d8dee9", width / 2, 42)
      bar(x, 52, w, 12, 6, boss.hp / boss.maxHp, boss.shield > 0 ? "#ffffff" : boss.color)
    } else if (run.phase === "waves" && view.level.endless) {
      // Endless: no backlog to empty, only the next boss getting closer.
      const every = view.level.endless.every
      const bossIn = Math.max(0, run.nextBossAt - run.wave)
      const w = Math.min(360, width - 460)
      text(S, res, t().hud.endless(run.wave, bossIn), `bold 12px ${MONO}`, "#e8ecf4", width / 2, 28)
      bar(width / 2 - w / 2, 38, w, 8, 4, Math.min(1, (every - bossIn) / every), accent)
    } else if (run.phase === "waves") {
      const total = ticketsOf(view.level)
      const released = Math.min(total, run.nextBug)
      const open = total - released + view.bugs.length
      const w = Math.min(360, width - 460)
      text(S, res, t().hud.backlog(open, run.wave), `bold 12px ${MONO}`, "#e8ecf4", width / 2, 28)
      bar(width / 2 - w / 2, 38, w, 8, 4, Math.max(0, 1 - open / Math.max(1, total)), accent)
    }

    if (run.time < 9 && run.phase === "waves") {
      const alpha = Math.min(1, (9 - run.time) / 2)
      const hints = touchMode() ? t().hud.touchHints : t().hud.hints
      hints.forEach((hint, i) => text(S, res, hint, `12px ${MONO}`, "#9aa4b8", 20, height - 20 - (hints.length - 1 - i) * 18, "left", alpha))
    }
  }

  /** Bottom-centre, where the eye reaches it on a wide screen and between the two thumbs on a phone. */
  const minimapRect = (width: number, height: number, arena: Arena) => {
    const w = Math.round(Math.max(105, Math.min(180, width * 0.14)))
    const h = Math.round((w * arena.height) / arena.width)
    return { x: Math.round(width / 2 - w / 2), y: height - h - 10, w, h }
  }

  /** The whole arena at a glance: bugs, bosses, power-ups, the call to answer, and what the camera sees. */
  const drawMinimap = (view: View, width: number, height: number, viewW: number, viewH: number) => {
    if (!view.player || (view.run.phase !== "waves" && view.run.phase !== "boss")) return
    const arena = arenaOf(view.level)
    const res = dpr
    const { x, y, w, h } = minimapRect(width, height, arena)
    const k = w / arena.width
    const at = (p: Vec) => ({ x: x + p.x * k, y: y + p.y * k })
    const dot = (p: Vec, r: number, color: string, alpha: number) => {
      const m = at(p)
      disc(S, res, m.x, m.y, r, color, alpha)
    }

    S.sprite(bakery.bake(`minimap|${w}|${h}`, res, { left: -1, top: -1, right: w + 1, bottom: h + 1 }, (g) => {
      g.globalAlpha = 0.9
      g.fillStyle = "rgba(10,12,20,0.78)"
      g.strokeStyle = "rgba(255,255,255,0.18)"
      g.lineWidth = 1
      g.beginPath(); g.roundRect(0, 0, w, h, 6)
      g.fill(); g.stroke()
    }), x, y)

    // What is on screen right now, clipped to the map: only the edges that fall inside it.
    const left = x + camera.x * k
    const top = y + camera.y * k
    const right = left + viewW * k
    const bottom = top + viewH * k
    const clampX = (v: number) => Math.max(x, Math.min(x + w, v))
    const clampY = (v: number) => Math.max(y, Math.min(y + h, v))
    const frame = S.graphics(0.9)
    if (top >= y && top <= y + h) frame.moveTo(clampX(left), top).lineTo(clampX(right), top)
    if (bottom >= y && bottom <= y + h) frame.moveTo(clampX(left), bottom).lineTo(clampX(right), bottom)
    if (left >= x && left <= x + w) frame.moveTo(left, clampY(top)).lineTo(left, clampY(bottom))
    if (right >= x && right <= x + w) frame.moveTo(right, clampY(top)).lineTo(right, clampY(bottom))
    frame.stroke({ width: 1, color: 0xffffff, alpha: 0.35 })

    const call = view.calls.active
    if (call) {
      const blink = call.timeLeft < 4 && Math.floor(time * 6) % 2 === 0
      const alpha = blink ? 0.4 : 0.9
      if (call.kind === "meet") {
        const room = at(call.room)
        S.graphics(alpha).circle(room.x, room.y, Math.max(4, call.radius * k)).stroke({ width: 1.5, color: clients[call.client].color })
      } else {
        for (const ping of call.pings) dot(ping, 2.5, "#7fb8ff", alpha)
      }
    }

    for (const pickup of view.pickups) {
      const m = at(pickup.position)
      S.rect(m.x - 2, m.y - 2, 4, 4, "#9dffb0", 0.9)
    }
    if (view.turrets.length > 0) {
      const g = S.graphics(0.9)
      for (const turret of view.turrets) {
        const m = at(turret.position)
        g.rect(m.x - 3, m.y - 3, 6, 6)
      }
      g.stroke({ width: 1.5, color: "#7fdcff" })
    }
    const mission = view.missions.active
    for (const bug of view.bugs) {
      const target = mission?.kind === "killTarget" && mission.target === bug.key
      dot(bug.position, target ? 3 : 1.8, target ? "#ff2040" : bug.resurrectedBy ? "#9dff6b" : bugKinds[bug.priority].color, 0.9)
      if (target && Math.floor(time * 4) % 2 === 0) {
        const m = at(bug.position)
        S.graphics(0.9).circle(m.x, m.y, 6).stroke({ width: 1, color: "#ff2040" })
      }
    }
    for (const boss of view.bosses) dot(boss.position, 5, boss.color, 0.9)

    for (const teammate of view.players) {
      if (teammate.slot === view.player.slot) continue
      dot(teammate.position, 3, teammate.hp > 0 ? teammate.color : "#ff9440", 1)
    }
    dot(view.player.position, 3.5, "#ffffff", 1)
    dot(view.player.position, 2, view.player.color, 1)
  }

  return { draw, fx, toWorld, toScreen, showBanner, camera, clientColor: (id: keyof typeof clients) => clients[id].color }
}
