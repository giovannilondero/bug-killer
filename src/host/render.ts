import { arenaOf } from "../content/arenas.ts"
import { ticketsOf } from "../content/levels.ts"
import type { Arena } from "../content/arenas.ts"
import { bugKinds } from "../content/bugs.ts"
import { clients } from "../content/clients.ts"
import type { BossPattern } from "../content/levels.ts"
import { comboMultiplier } from "../sim/systems/combat.ts"
import { lapOf, otherThread, raceSpot } from "../sim/bosses.ts"
import { BREAKPOINT, BUFF_SECONDS, DEPLOY, PARTY, PLAYER, ROCKET, TURRET } from "../sim/constants.ts"
import { isUnlocked } from "../sim/tiers.ts"
import { hasStatus } from "../sim/statuses.ts"
import { WEAPONS } from "../sim/weapons.ts"
import type { FxValue, Vec } from "../sim/schema.ts"
import type { View } from "../sim/simulation.ts"
import { formatNumber, t } from "./language.ts"
import { bossHealth, conflictMarkerColors, conflictMarkers, floorKey, fuseBlink, fuseProgress, MONO, paintBreakpoint, paintBug, paintFloor, paintFuseRing, paintHeart, paintHostile, paintLabel, paintNest, paintPickup, paintPing, paintPlayer, paintCircuit, paintRestartGhost, paintRocket, paintRocketTarget, paintMinimapWalls, paintStack, paintTooltip, pickupIcons, pickupInfo, roundRect, SANS, shade, shieldLabel, tooltipHeight, TOOLTIP_WIDTH, truncate } from "./paint.ts"
import type { BugLook } from "./paint.ts"
import { touchMode } from "./touch.ts"

type ViewBoss = View["bosses"][number]

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  color: string
  size: number
  text?: string
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

export interface Camera {
  x: number
  y: number
  scale: number
}

export const makeRenderer = (canvas: HTMLCanvasElement) => {
  const ctx = canvas.getContext("2d")!
  const camera: Camera = { x: 0, y: 0, scale: 1 }
  const particles: Array<Particle> = []
  const floaters: Array<Floater> = []
  let shake = 0
  let flash = 0
  let floor: HTMLCanvasElement | null = null
  let floorLevel = ""
  let banner: { title: string; subtitle: string; color: string; life: number; max: number } | null = null
  let time = 0
  const trail: Array<{ x: number; y: number; life: number }> = []

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.floor(canvas.clientWidth * dpr)
    canvas.height = Math.floor(canvas.clientHeight * dpr)
  }
  resize()
  window.addEventListener("resize", resize)

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

  /** A wisp of smoke left behind a rocket each frame. */
  const puff = (at: Vec, velocity: Vec) => {
    const len = Math.hypot(velocity.x, velocity.y) || 1
    const life = 0.35 + Math.random() * 0.25
    particles.push({ x: at.x - (velocity.x / len) * 26, y: at.y - (velocity.y / len) * 26, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, life, max: life, color: "#9aa4b8", size: 4 })
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
      case "fuse":
        burst(event.x, event.y, "#ff5a3c", 10, 140, 2)
        break
      case "deploy":
        shake = Math.max(shake, 14)
        flash = Math.max(flash, 0.35)
        burst(event.x, event.y, "#ffb347", 46, DEPLOY.radius * 3.2, 4)
        burst(event.x, event.y, "#ff5a3c", 24, DEPLOY.radius * 2, 3)
        floaters.push({ x: event.x, y: event.y - 30, life: 1.4, max: 1.4, text: t().hud.deployed, sub: t().hud.deployedSub, color: "#ffb347", big: false })
        break
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
      case "breakpointSet":
        burst(event.x, event.y, "#ff4d6d", 10, 120, 2)
        break
      case "breakpoint":
        // Execution paused: an icy ring (the blast itself comes as an explosion), and everything caught in it stops.
        for (let i = 0; i < 40; i++) {
          const a = (i / 40) * Math.PI * 2
          particles.push({ x: event.x, y: event.y, vx: Math.cos(a) * 420, vy: Math.sin(a) * 420, life: 0.4, max: 0.4, color: "#9be7ff", size: 3 })
        }
        floaters.push({ x: event.x, y: event.y - 30, life: 1.3, max: 1.3, text: t().hud.breakpointHit, sub: "", color: "#9be7ff", big: false })
        break
      case "flame":
        // A puff of fire fanning out along the cone, yellow at the core, red at the edges.
        for (let i = 0; i < 8; i++) {
          const a = event.angle + (Math.random() * 2 - 1) * event.spread
          // Particles slow down by 8% a frame, so they travel about a fifth of their speed.
          const s = (event.range / 0.21) * (0.35 + Math.random() * 0.65)
          const life = 0.25 + Math.random() * 0.15
          const color = ["#fff3a0", "#ffd84a", "#ff9440", "#ff4d2d"][Math.floor(Math.random() * 4)]!
          particles.push({ x: event.x, y: event.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: 5 + Math.random() * 5 })
        }
        break
      case "explosion":
        shake = Math.max(shake, 12)
        flash = Math.max(flash, 0.25)
        burst(event.x, event.y, "#ff9440", 40, event.radius * 3, 5)
        burst(event.x, event.y, "#ffd84a", 24, event.radius * 2, 4)
        burst(event.x, event.y, "#ffffff", 10, event.radius, 3)
        break
      case "shoot":
        break
    }
  }

  const showBanner = (title: string, subtitle: string, color: string, seconds = 3) => {
    banner = { title, subtitle, color, life: seconds, max: seconds }
  }

  // --- Drawing helpers ----------------------------------------------------

  const drawBug = (x: number, y: number, r: number, color: string, heading: number, t: number, look: BugLook) => {
    const lit = fuseProgress(look.fuse)
    const options = lit !== null && fuseBlink(lit, t) ? { ...look, flash: 1 } : look
    if (lit !== null) {
      // The blast radius, and a ring closing in on the bug as the fuse burns down.
      ctx.save()
      ctx.translate(x, y)
      ctx.globalAlpha = 0.45 + lit * 0.5
      paintFuseRing(ctx, DEPLOY.radius)
      ctx.globalAlpha = 0.8
      ctx.scale(1 - lit, 1 - lit)
      paintFuseRing(ctx, DEPLOY.radius)
      ctx.restore()
    }
    ctx.save()
    ctx.translate(x, y)
    if (options.trait === "jittery" && Math.sin(t * 40) > 0.6) {
      // Glitchy RGB split for bugs that are "In development".
      ctx.globalAlpha = 0.5
      ctx.fillStyle = "#ff00ff"
      ctx.beginPath(); ctx.ellipse(-3, 0, r * 0.8, r * 0.6, heading, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = "#00ffff"
      ctx.beginPath(); ctx.ellipse(3, 0, r * 0.8, r * 0.6, heading, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = 1
    }
    ctx.rotate(heading)
    paintBug(ctx, r, color, t, options)
    ctx.restore()
    if (options.burning) {
      ctx.font = `${Math.round(r * 0.9)}px ${SANS}`
      ctx.textAlign = "center"
      ctx.fillText("🔥", x, y - r * 0.7 + Math.sin(t * 20) * 2)
    }
    if (options.trait === "armored") {
      ctx.font = `${Math.round(r * 0.7)}px ${SANS}`
      ctx.textAlign = "center"
      ctx.fillText("🔒", x, y + r * 0.25)
    }
    if (options.trait === "reopens") {
      ctx.strokeStyle = "rgba(255,255,255,0.35)"
      ctx.lineWidth = 1.5
      ctx.setLineDash([3, 5])
      ctx.beginPath(); ctx.arc(x, y, r * 1.35, t * 2, t * 2 + Math.PI * 1.6); ctx.stroke()
      ctx.setLineDash([])
    }
    if (options.trait === "deploying") {
      ctx.font = `${Math.round(r * 0.7)}px ${SANS}`
      ctx.textAlign = "center"
      ctx.fillText("🚀", x, y + r * 0.25)
    }
  }

  /** A developer in burnout: lying down, greyed out, with the revive filling up around them. */
  const drawDown = (view: NonNullable<View["player"]>) => {
    const { x, y } = view.position
    ctx.save()
    ctx.globalAlpha = 0.55
    ctx.fillStyle = "#6b7280"
    ctx.beginPath(); ctx.ellipse(x, y, PLAYER.radius * 1.2, PLAYER.radius * 0.8, 0.3, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = "#f2c9a0"
    ctx.beginPath(); ctx.arc(x + 12, y - 4, 7, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = 1
    ctx.font = `18px ${SANS}`
    ctx.textAlign = "center"
    ctx.fillText("🔥", x, y - 24 + Math.sin(time * 6) * 2)
    ctx.strokeStyle = "rgba(255,255,255,0.15)"
    ctx.lineWidth = 4
    ctx.beginPath(); ctx.arc(x, y, PARTY.reviveRadius, 0, Math.PI * 2); ctx.stroke()
    if (view.revive > 0) {
      ctx.strokeStyle = "#9dffb0"
      ctx.beginPath(); ctx.arc(x, y, PARTY.reviveRadius, -Math.PI / 2, -Math.PI / 2 + (view.revive / PARTY.reviveSeconds) * Math.PI * 2); ctx.stroke()
    }
    ctx.restore()
    label(`${t().hud.burnout} · ${view.name}`, x, y + PLAYER.radius + 22, "#ff9440", 10)
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
    for (const t of trail) {
      ctx.globalAlpha = (t.life / 0.25) * 0.35
      ctx.fillStyle = "#7fdcff"
      ctx.beginPath(); ctx.arc(t.x, t.y, PLAYER.radius, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = blinking ? 0.35 : 1
    ctx.save()
    ctx.translate(x, y)
    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)"
    ctx.beginPath(); ctx.ellipse(3, 6, 18, 12, 0, 0, Math.PI * 2); ctx.fill()
    ctx.rotate(aim)
    paintPlayer(ctx, view.color, view.buffs.hotfix > 0)
    ctx.restore()
    ctx.globalAlpha = 1
    if (view.buffs.unitTest > 0) {
      ctx.strokeStyle = "#58e6a0"
      ctx.lineWidth = 3
      ctx.shadowColor = "#58e6a0"
      ctx.shadowBlur = 16
      ctx.beginPath()
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2 + time
        const px = x + Math.cos(a) * 30
        const py = y + Math.sin(a) * 30
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
      }
      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.font = `bold 11px ${MONO}`
      ctx.fillStyle = "#58e6a0"
      ctx.textAlign = "center"
      ctx.fillText(t().hud.testsPassing, x, y - 38)
    }
    if (named) label(view.name, x, y - PLAYER.radius - 14, view.color, 10)
  }

  /** The bonus call in the arena: the Meet room to stand in, or the Slack messages to go read. */
  const drawCall = (view: View) => {
    const call = view.calls.active
    if (!call) return
    const color = clients[call.client].color
    const fading = call.timeLeft < 4 && Math.floor(time * 6) % 2 === 0
    ctx.globalAlpha = fading ? 0.45 : 1
    if (call.kind === "meet") {
      const { x, y } = call.room
      const r = call.radius
      const inside = view.player !== null && (view.player.position.x - x) ** 2 + (view.player.position.y - y) ** 2 <= r * r
      const glow = ctx.createRadialGradient(x, y, r * 0.2, x, y, r)
      glow.addColorStop(0, shade(color, -0.55))
      glow.addColorStop(1, shade(color, -0.75))
      ctx.globalAlpha *= inside ? 0.75 : 0.5
      ctx.fillStyle = glow
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
      ctx.globalAlpha = fading ? 0.45 : 1
      ctx.strokeStyle = color
      ctx.lineWidth = 3
      ctx.shadowColor = color
      ctx.shadowBlur = inside ? 24 : 12
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke()
      ctx.shadowBlur = 0
      ctx.lineWidth = 2
      ctx.setLineDash([10, 8])
      ctx.beginPath(); ctx.arc(x, y, r + 10 + Math.sin(time * 4) * 3, time * 0.6, time * 0.6 + Math.PI * 2); ctx.stroke()
      ctx.setLineDash([])
      // How long you have sat in the meeting.
      ctx.lineWidth = 7
      ctx.strokeStyle = "#ffd84a"
      ctx.beginPath(); ctx.arc(x, y, r - 8, -Math.PI / 2, -Math.PI / 2 + (call.progress / call.goal) * Math.PI * 2); ctx.stroke()
      ctx.font = `34px ${SANS}`
      ctx.textAlign = "center"
      ctx.fillText("📹", x, y + 12 + Math.sin(time * 3) * 3)
      label(`${t().calls.room} · ${clients[call.client].name}`, x, y - r - 14, color, 12)
      label(truncate(call.title, 40), x, y + r + 22, "#e8ecf4", 11)
    } else {
      for (const [i, ping] of call.pings.entries()) {
        const bob = Math.sin(time * 4 + i * 2) * 4
        ctx.save()
        ctx.translate(ping.x, ping.y + bob)
        paintPing(ctx, ping.text, color)
        ctx.restore()
      }
    }
    ctx.globalAlpha = 1
  }

  /** What each boss pattern adds to the plain boss: drawn under it, or over it. */
  const bossMarks: Record<BossPattern, { readonly under?: (boss: ViewBoss, heading: number, arena: Arena) => void; readonly over?: (boss: ViewBoss, arena: Arena) => void }> = {
    dispenser: {},
    crash: {
      // Glitches now and then, a ghost of the restart.
      under: (boss, heading) => {
        if (Math.sin(time * 30) <= 0.7) return
        ctx.save()
        ctx.globalAlpha = 0.4
        ctx.translate(Math.random() * 10 - 5, 0)
        drawBug(boss.position.x, boss.position.y, boss.radius, "#ff00ff", heading, boss.age, { flash: 0, trait: "plain", reopened: false, boss: true })
        ctx.restore()
      }
    },
    twoFactor: {
      over: (boss) => {
        if (boss.phase !== 2) return
        ctx.font = `bold 13px ${MONO}`
        ctx.fillStyle = "#c79bff"
        ctx.textAlign = "center"
        ctx.fillText(t().hud.factor, boss.position.x, boss.position.y + boss.radius * 1.6)
      }
    },
    undefined: {
      over: (boss) => {
        ctx.font = `bold 13px ${MONO}`
        ctx.fillStyle = "rgba(255,122,89,0.8)"
        ctx.textAlign = "center"
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + time * 0.8
          ctx.fillText(i % 2 ? "null" : "undefined", boss.position.x + Math.cos(a) * boss.radius * 1.6, boss.position.y + Math.sin(a) * boss.radius * 1.6)
        }
      }
    },
    mergeConflict: {
      over: (boss) => {
        ctx.font = `bold 13px ${MONO}`
        ctx.textAlign = "center"
        if (boss.side) {
          ctx.fillStyle = boss.color
          ctx.fillText(t().hud.sides[boss.side], boss.position.x, boss.position.y + boss.radius * 1.6)
          return
        }
        // Whole, the conflict markers circle it.
        for (const [i, marker] of conflictMarkers.entries()) {
          const a = (i / conflictMarkers.length) * Math.PI * 2 - time * 0.6
          ctx.fillStyle = conflictMarkerColors[i]!
          ctx.fillText(marker, boss.position.x + Math.cos(a) * boss.radius * 1.6, boss.position.y + Math.sin(a) * boss.radius * 1.6)
        }
      }
    },
    raceCondition: {
      over: (boss, arena) => {
        if (!boss.thread) return
        ctx.font = `bold 13px ${MONO}`
        ctx.textAlign = "center"
        ctx.fillStyle = boss.color
        ctx.fillText(t().hud.threads[boss.thread], boss.position.x, boss.position.y + boss.radius * 1.6)
        if (boss.revive <= 0) return
        // Its twin was fixed: a ghost where it restarts, and the seconds left to stop it.
        const spot = raceSpot(arena, boss.age, otherThread(boss.thread))
        ctx.save()
        ctx.translate(spot.x, spot.y)
        ctx.rotate(time * 1.5)
        paintRestartGhost(ctx, boss.radius, "#ffffff")
        ctx.restore()
        ctx.font = `bold 14px ${MONO}`
        ctx.fillStyle = Math.sin(time * 12) > 0 ? "#ffffff" : boss.color
        ctx.fillText(t().hud.restarting(boss.revive), spot.x, spot.y + 5)
      }
    },
    infiniteLoop: {
      // The circuit it runs, and the lap it is on.
      under: (boss, _heading, arena) => paintCircuit(ctx, arena, boss.color),
      over: (boss) => {
        ctx.font = `bold 13px ${MONO}`
        ctx.textAlign = "center"
        ctx.fillStyle = boss.color
        ctx.fillText(t().hud.lap(lapOf(boss.course) + 1), boss.position.x, boss.position.y + boss.radius * 1.6)
      }
    },
    stackOverflow: {
      // The frames still stacked on it, and how deep the stack is.
      under: (boss) => {
        ctx.save()
        ctx.translate(boss.position.x, boss.position.y)
        paintStack(ctx, boss.radius, boss.frames, boss.color)
        ctx.restore()
      },
      over: (boss) => {
        ctx.font = `bold 13px ${MONO}`
        ctx.textAlign = "center"
        ctx.fillStyle = boss.color
        ctx.fillText(t().hud.depth(boss.frames), boss.position.x, boss.position.y + boss.radius * 1.6)
      }
    }
  }

  const drawBoss = (boss: ViewBoss, arena: Arena) => {
    const { x, y } = boss.position
    const heading = Math.atan2(boss.position.y - (boss.position.y - 1), 0) + Math.sin(boss.age) * 0.2 + Math.PI / 2
    const marks = bossMarks[boss.pattern]
    marks.under?.(boss, heading, arena)
    drawBug(x, y, boss.radius, boss.color, heading, boss.age, { flash: boss.hitFlash, trait: "plain", reopened: true, boss: true, frozen: hasStatus(boss.statuses, "freeze"), poisoned: hasStatus(boss.statuses, "poison"), burning: hasStatus(boss.statuses, "burn") })
    if (boss.shield > 0) {
      ctx.strokeStyle = "rgba(255,255,255,0.8)"
      ctx.lineWidth = 4
      ctx.shadowColor = "#ffffff"
      ctx.shadowBlur = 20
      ctx.beginPath(); ctx.arc(x, y, boss.radius * 1.35, 0, Math.PI * 2); ctx.stroke()
      ctx.shadowBlur = 0
      ctx.font = `bold 14px ${MONO}`
      ctx.fillStyle = "#ffffff"
      ctx.textAlign = "center"
      ctx.fillText(shieldLabel(boss), x, y - boss.radius * 1.5)
    }
    marks.over?.(boss, arena)
    ctx.font = `bold 14px ${MONO}`
    ctx.fillStyle = "#ffffff"
    ctx.textAlign = "center"
    ctx.fillText(boss.key, x, y - boss.radius - 14)
  }

  const label = (text: string, x: number, y: number, color: string, size = 11, border?: string) => paintLabel(ctx, text, x, y, color, size, border)

  // --- Frame ------------------------------------------------------------

  const draw = (view: View, cursor: Vec, dt: number) => {
    time += dt
    if (floorLevel !== floorKey(view.level)) {
      floor = paintFloor(view.level)
      floorLevel = floorKey(view.level)
    }
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const dpr = canvas.width / Math.max(1, width)
    camera.scale = Math.max(0.5, Math.min(1.2, Math.min(width / 1150, height / 760)))
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

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = "#05060a"
    ctx.fillRect(0, 0, width, height)
    ctx.setTransform(dpr * camera.scale, 0, 0, dpr * camera.scale, (-camera.x * camera.scale + sx) * dpr, (-camera.y * camera.scale + sy) * dpr)
    if (floor) ctx.drawImage(floor, 0, 0)

    const accent = view.level.theme.accent
    const mission = view.missions.active

    drawCall(view)

    // AI turrets: a little tripod with a barrel tracking its target, and a ring for the time left.
    for (const turret of view.turrets) {
      const { x, y } = turret.position
      const ending = turret.life < 2.5 && Math.floor(time * 8) % 2 === 0
      ctx.globalAlpha = ending ? 0.5 : 1
      ctx.strokeStyle = "rgba(127,220,255,0.25)"
      ctx.lineWidth = 3
      ctx.beginPath(); ctx.arc(x, y, TURRET.radius + 8, 0, Math.PI * 2); ctx.stroke()
      ctx.strokeStyle = "#7fdcff"
      ctx.beginPath(); ctx.arc(x, y, TURRET.radius + 8, -Math.PI / 2, -Math.PI / 2 + (turret.life / TURRET.seconds) * Math.PI * 2); ctx.stroke()
      ctx.strokeStyle = "#2b2f3a"
      ctx.lineWidth = 4
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + Math.PI / 2
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 20, y + Math.sin(a) * 20); ctx.stroke()
      }
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate(turret.aim)
      ctx.fillStyle = "#3a4152"
      ctx.fillRect(4, -4, 22, 8)
      ctx.fillStyle = "#7fdcff"
      ctx.shadowColor = "#7fdcff"
      ctx.shadowBlur = 10
      ctx.fillRect(22, -3, 5, 6)
      ctx.restore()
      ctx.fillStyle = "#1b2030"
      ctx.strokeStyle = "#7fdcff"
      ctx.lineWidth = 2
      ctx.shadowColor = "#7fdcff"
      ctx.shadowBlur = 14
      ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
      ctx.shadowBlur = 0
      ctx.font = `bold 9px ${MONO}`
      ctx.textAlign = "center"
      ctx.fillStyle = "#7fdcff"
      ctx.fillText("AI", x, y + 3)
      ctx.globalAlpha = 1
    }

    // Breakpoints: the editor's red dot, and the reach that sets it off, breathing.
    for (const trap of view.breakpoints) {
      const { x, y } = trap.position
      ctx.globalAlpha = 0.2 + 0.15 * Math.sin(time * 4)
      ctx.strokeStyle = "#ff4d6d"
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(x, y, BREAKPOINT.trigger, 0, Math.PI * 2); ctx.stroke()
      ctx.globalAlpha = 1
      ctx.save()
      ctx.translate(x, y)
      paintBreakpoint(ctx, view.players.find((p) => p.slot === trap.owner)?.color ?? "#ffffff")
      ctx.restore()
    }

    // Pickups
    for (const pickup of view.pickups) {
      const { x, y } = pickup.position
      const bob = Math.sin(time * 4 + x) * 3
      const fading = pickup.life < 3 && Math.floor(time * 8) % 2 === 0
      if (fading) continue
      ctx.save()
      ctx.translate(x, y + bob)
      paintPickup(ctx, pickup.kind)
      ctx.restore()
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
      ctx.globalAlpha = appear
      if (bug.type === "epic") {
        // An Epic sits in its nest.
        ctx.save()
        ctx.translate(x, y)
        paintNest(ctx, bug.radius)
        ctx.restore()
      }
      if (bug.resurrectedBy) {
        // A zombie ticket: a sickly green aura and the client's colour around it.
        const glow = ctx.createRadialGradient(x, y, bug.radius * 0.5, x, y, bug.radius * 2)
        glow.addColorStop(0, "rgba(157,255,107,0.35)")
        glow.addColorStop(1, "rgba(157,255,107,0)")
        ctx.fillStyle = glow
        ctx.beginPath(); ctx.arc(x, y, bug.radius * 2, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = clients[bug.resurrectedBy].color
        ctx.lineWidth = 2
        ctx.setLineDash([2, 6])
        ctx.beginPath(); ctx.arc(x, y, bug.radius * 1.45, -time * 3, -time * 3 + Math.PI * 2); ctx.stroke()
        ctx.setLineDash([])
      }
      drawBug(x, y, bug.radius * (0.4 + appear * 0.6), bug.resurrectedBy ? "#9dff6b" : bugKinds[bug.priority].color, heading, bug.age, { flash: bug.hitFlash, trait: bug.trait, reopened: bug.reopened || bug.resurrectedBy !== null, frozen: hasStatus(bug.statuses, "freeze"), poisoned: hasStatus(bug.statuses, "poison"), burning: hasStatus(bug.statuses, "burn"), type: bug.type, fuse: bug.fuse })
      ctx.globalAlpha = 1
      const isTarget = mission?.kind === "killTarget" && mission.target === bug.key
      if (isTarget) {
        ctx.strokeStyle = "#ff2040"
        ctx.lineWidth = 3
        const pulse = bug.radius * 1.6 + Math.sin(time * 8) * 4
        ctx.beginPath(); ctx.arc(x, y, pulse, 0, Math.PI * 2); ctx.stroke()
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + time
          ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * pulse, y + Math.sin(a) * pulse); ctx.lineTo(x + Math.cos(a) * (pulse + 10), y + Math.sin(a) * (pulse + 10)); ctx.stroke()
        }
      }
      const name = bug.resurrectedBy ? `🧟 ${bug.key}` : bug.reopened ? `${bug.key} ↺` : bug.key
      if (bug === chip) {
        const trait = t().traits[bug.trait].split(":")[0]
        label([name, bug.type === "bug" ? "" : t().ticketTypes[bug.type].label, bug.priority, trait].filter(Boolean).join(" · "), x, y - bug.radius - 10, bugKinds[bug.priority].color, 16, bugKinds[bug.priority].color)
      } else {
        label(name, x, y - bug.radius - 10, isTarget ? "#ff6b81" : bug.resurrectedBy ? "#9dff6b" : bug.reopened ? "#ff6b81" : "#e8ecf4")
      }
      if (bug.hp < bug.maxHp) {
        const w = bug.radius * 2
        ctx.fillStyle = "rgba(0,0,0,0.6)"
        ctx.fillRect(x - w / 2, y + bug.radius + 6, w, 4)
        ctx.fillStyle = bugKinds[bug.priority].color
        ctx.fillRect(x - w / 2, y + bug.radius + 6, w * Math.max(0, bug.hp / bug.maxHp), 4)
      }
    }

    for (const boss of view.bosses) drawBoss(boss, arena)

    // Shots
    ctx.lineCap = "round"
    for (const shot of view.shots) {
      const { x, y } = shot.position
      const len = Math.hypot(shot.velocity.x, shot.velocity.y) || 1
      const tx = (shot.velocity.x / len) * 16
      const ty = (shot.velocity.y / len) * 16
      ctx.strokeStyle = shot.homing ? "#ffb347" : view.player && view.player.buffs.hotfix > 0 ? "#ffb070" : "#a8f0ff"
      ctx.shadowColor = ctx.strokeStyle
      ctx.shadowBlur = 10
      ctx.lineWidth = 5
      ctx.beginPath(); ctx.moveTo(x - tx, y - ty); ctx.lineTo(x, y); ctx.stroke()
    }
    ctx.shadowBlur = 0

    // Rockets: where each will go off, then the rocket with its smoke.
    for (const rocket of view.rockets) {
      ctx.save()
      ctx.translate(rocket.target.x, rocket.target.y)
      paintRocketTarget(ctx, ROCKET.blastRadius)
      ctx.restore()
      ctx.save()
      ctx.translate(rocket.position.x, rocket.position.y)
      ctx.rotate(Math.atan2(rocket.velocity.y, rocket.velocity.x))
      paintRocket(ctx)
      ctx.restore()
      puff(rocket.position, rocket.velocity)
    }

    for (const shot of view.hostile) {
      const { x, y } = shot.position
      ctx.save()
      ctx.translate(x, y)
      paintHostile(ctx, shot.text)
      ctx.restore()
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
      ctx.globalAlpha = p.life / p.max
      ctx.fillStyle = p.color
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
    }
    ctx.globalAlpha = 1
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
      ctx.globalAlpha = Math.min(1, k * 2)
      const y = f.y - (1 - k) * 40
      ctx.textAlign = "center"
      ctx.font = `bold ${f.big ? 22 : 13}px ${MONO}`
      ctx.fillStyle = "#000"
      ctx.fillText(f.text, f.x + 1, y + 1)
      ctx.fillStyle = f.color
      ctx.fillText(f.text, f.x, y)
      // On a phone the small popups keep only their headline: the ticket summary covers the arena.
      if (f.sub && (f.big || !touchMode())) {
        ctx.font = `${f.big ? 14 : 11}px ${SANS}`
        ctx.fillStyle = "#d8dee9"
        ctx.fillText(truncate(f.sub, f.big ? 70 : 46), f.x, y + (f.big ? 22 : 15))
      }
    }
    ctx.globalAlpha = 1

    // --- Screen space ---------------------------------------------------
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.35})`
      ctx.fillRect(0, 0, width, height)
    }
    if (view.player && view.player.hp <= 0 && view.players.length > 1 && view.run.phase !== "dead") {
      ctx.fillStyle = "rgba(20,22,30,0.45)"
      ctx.fillRect(0, 0, width, height)
      ctx.textAlign = "center"
      ctx.font = `bold 16px ${MONO}`
      ctx.fillStyle = "#ff9440"
      ctx.fillText(t().hud.youAreDown, width / 2, height * 0.68)
    } else if (view.player && view.player.hp <= 2 && view.run.phase !== "dead") {
      const g = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.3, width / 2, height / 2, Math.max(width, height) * 0.7)
      g.addColorStop(0, "rgba(255,0,40,0)")
      g.addColorStop(1, `rgba(255,0,40,${0.25 + Math.sin(time * 5) * 0.1})`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, width, height)
    }

    // Arrows toward an off-screen mission target, and toward the call.
    const pointAt = (world: Vec, color: string, text: string, textColor: string) => {
      const sxT = (world.x - camera.x) * camera.scale
      const syT = (world.y - camera.y) * camera.scale
      if (sxT >= 0 && syT >= 0 && sxT <= width && syT <= height) return
      const cx = width / 2
      const cy = height / 2
      const a = Math.atan2(syT - cy, sxT - cx)
      const ex = Math.max(40, Math.min(width - 40, cx + Math.cos(a) * width))
      const ey = Math.max(90, Math.min(height - 40, cy + Math.sin(a) * height))
      ctx.save()
      ctx.translate(ex, ey)
      ctx.rotate(a)
      ctx.fillStyle = color
      ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-10, -12); ctx.lineTo(-10, 12); ctx.closePath(); ctx.fill()
      ctx.restore()
      label(text, ex, ey + 28, textColor, 11)
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
      ctx.save()
      ctx.translate(bx, by)
      paintTooltip(ctx, hovered, bugKinds[hovered.priority].color)
      ctx.restore()
    }

    const hudShade = ctx.createLinearGradient(0, 0, 0, 120)
    hudShade.addColorStop(0, "rgba(5,6,10,0.75)")
    hudShade.addColorStop(1, "rgba(5,6,10,0)")
    ctx.fillStyle = hudShade
    ctx.fillRect(0, 0, width, 120)
    drawMinimap(view, width, height, viewW, viewH)
    drawHud(view, width, height, accent)

    if (banner) {
      banner.life -= dt
      const k = banner.life / banner.max
      if (banner.life <= 0) banner = null
      else {
        const alpha = Math.min(1, k * 4, (1 - k) * 8)
        ctx.globalAlpha = alpha
        ctx.fillStyle = "rgba(0,0,0,0.65)"
        ctx.fillRect(0, height * 0.32, width, 110)
        ctx.textAlign = "center"
        ctx.font = `900 44px ${SANS}`
        ctx.fillStyle = banner.color
        ctx.fillText(banner.title, width / 2, height * 0.32 + 55)
        ctx.font = `16px ${MONO}`
        ctx.fillStyle = "#e8ecf4"
        ctx.fillText(truncate(banner.subtitle, 90), width / 2, height * 0.32 + 85)
        ctx.globalAlpha = 1
      }
    }

    // Crosshair
    if (view.run.phase !== "dead" && view.run.phase !== "cleared") {
      ctx.strokeStyle = hovered ? bugKinds[hovered.priority].color : "#ffffff"
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(cursor.x, cursor.y, 10, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cursor.x - 16, cursor.y); ctx.lineTo(cursor.x - 5, cursor.y)
      ctx.moveTo(cursor.x + 5, cursor.y); ctx.lineTo(cursor.x + 16, cursor.y)
      ctx.moveTo(cursor.x, cursor.y - 16); ctx.lineTo(cursor.x, cursor.y - 5)
      ctx.moveTo(cursor.x, cursor.y + 5); ctx.lineTo(cursor.x, cursor.y + 16)
      ctx.stroke()
    }
  }

  const drawHud = (view: View, width: number, height: number, accent: string) => {
    const run = view.run
    const player = view.player
    ctx.textAlign = "left"
    // Top-left: sprint and sanity.
    ctx.font = `bold 12px ${MONO}`
    ctx.fillStyle = accent
    ctx.fillText(`${view.level.sprint.toUpperCase()} · ${view.level.name.toUpperCase()}`, 20, 28)
    if (player) {
      ctx.font = `11px ${MONO}`
      ctx.fillStyle = "#9aa4b8"
      ctx.fillText(t().hud.sanity, 20, 50)
      for (let i = 0; i < player.maxHp; i++) {
        paintHeart(ctx, 20 + i * 24, 58, i < player.hp ? "#ff4d6d" : "rgba(255,255,255,0.15)")
      }
      if (view.hardcore) {
        // Hardcore: said right of the single heart, in its colour.
        ctx.font = `bold 11px ${MONO}`
        ctx.fillStyle = "#ff4d6d"
        ctx.fillText(`☠ ${t().hardcore.hud}`, 26 + player.maxHp * 24, 71)
      }
      ctx.font = `11px ${MONO}`
      ctx.fillStyle = "#9aa4b8"
      ctx.textAlign = "left"
      ctx.fillText("GIT RESET --HARD  [Q]", 20, 100)
      for (let i = 0; i < player.bombs; i++) {
        ctx.font = `16px ${SANS}`
        ctx.fillText("⏪", 20 + i * 24, 122)
      }
      if (isUnlocked("breakpoint", view.tier)) {
        ctx.font = `11px ${MONO}`
        ctx.fillText(t().hud.breakpoints, 210, 100)
        ctx.font = `16px ${SANS}`
        for (let i = 0; i < player.breakpoints; i++) ctx.fillText(pickupIcons.breakpoint, 210 + i * 24, 122)
      }
      let row = 0
      const weapon = player.weapon
      if (weapon.kind !== "gun") {
        // The weapon in hand: its icon, how long it lasts, and its name.
        const y = 142
        ctx.font = `14px ${SANS}`
        ctx.fillStyle = "#ffffff"
        ctx.fillText(pickupIcons[weapon.kind], 20, y + 4)
        ctx.fillStyle = "rgba(255,255,255,0.15)"
        ctx.fillRect(44, y - 6, 100, 8)
        ctx.fillStyle = "#ffd84a"
        ctx.fillRect(44, y - 6, 100 * (weapon.seconds / WEAPONS[weapon.kind].seconds), 8)
        ctx.font = `bold 11px ${MONO}`
        ctx.fillText(`${t().pickups[weapon.kind].label.toUpperCase()}  ${Math.ceil(weapon.seconds)}s`, 152, y + 2)
        row++
      }
      for (const kind of ["tools", "hotfix", "refactor", "coffee", "unitTest", "codeFreeze", "memoryLeak"] as const) {
        const left = player.buffs[kind]
        if (left <= 0) continue
        const y = 142 + row * 22
        ctx.font = `14px ${SANS}`
        ctx.fillStyle = "#ffffff"
        ctx.fillText(pickupIcons[kind], 20, y + 4)
        ctx.fillStyle = "rgba(255,255,255,0.15)"
        ctx.fillRect(44, y - 6, 100, 8)
        ctx.fillStyle = "#9dffb0"
        ctx.fillRect(44, y - 6, 100 * (left / BUFF_SECONDS[kind]), 8)
        row++
      }
    }

    // Top-right: story points and combo.
    ctx.textAlign = "right"
    ctx.font = `11px ${MONO}`
    ctx.fillStyle = "#9aa4b8"
    ctx.fillText("STORY POINTS", width - 20, 28)
    ctx.font = `900 30px ${SANS}`
    ctx.fillStyle = "#ffffff"
    ctx.fillText(formatNumber(run.score), width - 20, 60)
    if (run.combo >= 2) {
      ctx.font = `bold 15px ${MONO}`
      ctx.fillStyle = run.combo >= 10 ? "#ffd84a" : accent
      ctx.fillText(`COMBO ×${run.combo}  (${comboMultiplier(run.combo)}x)`, width - 20, 84)
      ctx.fillStyle = "rgba(255,255,255,0.15)"
      ctx.fillRect(width - 160, 92, 140, 4)
      ctx.fillStyle = run.combo >= 10 ? "#ffd84a" : accent
      ctx.fillRect(width - 160, 92, 140 * (run.comboTimer / 2.6), 4)
    }

    // Top-centre: backlog or boss.
    ctx.textAlign = "center"
    const boss = view.bosses[0]
    if (boss) {
      const health = bossHealth(view.bosses, boss.key)
      const w = Math.min(560, width - 420)
      const x = width / 2 - w / 2
      ctx.font = `bold 13px ${MONO}`
      ctx.fillStyle = boss.color
      ctx.fillText(`☠ ${boss.key}`, width / 2, 24)
      ctx.font = `12px ${SANS}`
      ctx.fillStyle = "#d8dee9"
      ctx.fillText(truncate(boss.title, 80), width / 2, 42)
      ctx.fillStyle = "rgba(255,255,255,0.12)"
      roundRect(ctx, x, 52, w, 12, 6); ctx.fill()
      ctx.fillStyle = health.shielded ? "#ffffff" : boss.color
      roundRect(ctx, x, 52, Math.max(0, w * health.left), 12, 6); ctx.fill()
    } else if (run.phase === "waves" && view.level.endless) {
      // Endless: no backlog to empty, only the next boss getting closer.
      const every = view.level.endless.every
      const bossIn = Math.max(0, run.nextBossAt - run.wave)
      const w = Math.min(360, width - 460)
      const x = width / 2 - w / 2
      ctx.font = `bold 12px ${MONO}`
      ctx.fillStyle = "#e8ecf4"
      ctx.fillText(t().hud.endless(run.wave, bossIn), width / 2, 28)
      ctx.fillStyle = "rgba(255,255,255,0.12)"
      roundRect(ctx, x, 38, w, 8, 4); ctx.fill()
      ctx.fillStyle = accent
      roundRect(ctx, x, 38, w * Math.min(1, (every - bossIn) / every), 8, 4); ctx.fill()
    } else if (run.phase === "waves") {
      const total = ticketsOf(view.level)
      const released = Math.min(total, run.nextBug)
      const open = total - released + view.bugs.length
      const w = Math.min(360, width - 460)
      const x = width / 2 - w / 2
      ctx.font = `bold 12px ${MONO}`
      ctx.fillStyle = "#e8ecf4"
      ctx.fillText(t().hud.backlog(open, run.wave), width / 2, 28)
      ctx.fillStyle = "rgba(255,255,255,0.12)"
      roundRect(ctx, x, 38, w, 8, 4); ctx.fill()
      ctx.fillStyle = accent
      roundRect(ctx, x, 38, w * Math.max(0, 1 - open / Math.max(1, total)), 8, 4); ctx.fill()
    }

    if (run.time < 9 && run.phase === "waves") {
      ctx.globalAlpha = Math.min(1, (9 - run.time) / 2)
      ctx.textAlign = "left"
      ctx.font = `12px ${MONO}`
      ctx.fillStyle = "#9aa4b8"
      const hints = touchMode() ? t().hud.touchHints : t().hud.hints
      hints.forEach((hint, i) => ctx.fillText(hint, 20, height - 20 - (hints.length - 1 - i) * 18))
      ctx.globalAlpha = 1
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
    const { x, y, w, h } = minimapRect(width, height, arena)
    const k = w / arena.width
    const at = (p: Vec) => ({ x: x + p.x * k, y: y + p.y * k })
    const dot = (p: Vec, r: number, color: string) => {
      const m = at(p)
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(m.x, m.y, r, 0, Math.PI * 2); ctx.fill()
    }

    ctx.save()
    ctx.globalAlpha = 0.9
    ctx.fillStyle = "rgba(10,12,20,0.78)"
    ctx.strokeStyle = "rgba(255,255,255,0.18)"
    ctx.lineWidth = 1
    roundRect(ctx, x, y, w, h, 6)
    ctx.fill(); ctx.stroke()
    ctx.clip()
    ctx.save()
    ctx.translate(x, y)
    paintMinimapWalls(ctx, arena, k)
    ctx.restore()

    // What is on screen right now.
    ctx.strokeStyle = "rgba(255,255,255,0.35)"
    ctx.strokeRect(x + camera.x * k, y + camera.y * k, viewW * k, viewH * k)

    const call = view.calls.active
    if (call) {
      const blink = call.timeLeft < 4 && Math.floor(time * 6) % 2 === 0
      ctx.globalAlpha = blink ? 0.4 : 0.9
      if (call.kind === "meet") {
        const room = at(call.room)
        ctx.strokeStyle = clients[call.client].color
        ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.arc(room.x, room.y, Math.max(4, call.radius * k), 0, Math.PI * 2); ctx.stroke()
      } else {
        for (const ping of call.pings) dot(ping, 2.5, "#7fb8ff")
      }
      ctx.globalAlpha = 0.9
    }

    for (const pickup of view.pickups) {
      const m = at(pickup.position)
      ctx.fillStyle = "#9dffb0"
      ctx.fillRect(m.x - 2, m.y - 2, 4, 4)
    }
    for (const turret of view.turrets) {
      const m = at(turret.position)
      ctx.strokeStyle = "#7fdcff"
      ctx.lineWidth = 1.5
      ctx.strokeRect(m.x - 3, m.y - 3, 6, 6)
    }
    const mission = view.missions.active
    for (const bug of view.bugs) {
      const target = mission?.kind === "killTarget" && mission.target === bug.key
      dot(bug.position, target ? 3 : 1.8, target ? "#ff2040" : bug.resurrectedBy ? "#9dff6b" : bugKinds[bug.priority].color)
      if (target && Math.floor(time * 4) % 2 === 0) {
        const m = at(bug.position)
        ctx.strokeStyle = "#ff2040"
        ctx.lineWidth = 1
        ctx.beginPath(); ctx.arc(m.x, m.y, 6, 0, Math.PI * 2); ctx.stroke()
      }
    }
    for (const boss of view.bosses) dot(boss.position, 5, boss.color)

    ctx.globalAlpha = 1
    for (const teammate of view.players) {
      if (teammate.slot === view.player.slot) continue
      dot(teammate.position, 3, teammate.hp > 0 ? teammate.color : "#ff9440")
    }
    dot(view.player.position, 3.5, "#ffffff")
    dot(view.player.position, 2, view.player.color)
    ctx.restore()
  }

  return { draw, fx, toWorld, toScreen, showBanner, camera, clientColor: (id: keyof typeof clients) => clients[id].color }
}

export type Renderer = ReturnType<typeof makeRenderer>
