import { Touch } from "@typeonce/ritmo-browser"

import type { Vec } from "../sim/schema.ts"
import { fullscreenSupported, isFullscreen, onFullscreenChange } from "./fullscreen.ts"
import { t } from "./language.ts"

const STICK_RADIUS = 56
const DEADZONE = 0.18

// Touch mode starts on coarse-pointer devices, or the first time a finger touches the page.
let touch = matchMedia("(pointer: coarse)").matches
const listeners = new Set<() => void>()
document.body.classList.toggle("touch", touch)
window.addEventListener(
  "pointerdown",
  (event) => {
    if (touch || event.pointerType !== "touch") return
    touch = true
    document.body.classList.add("touch")
    for (const listener of listeners) listener()
  },
  { capture: true }
)

// iOS Safari can leave the page scrolled by its bar height after a rotation or when its bars
// collapse: the fixed layers then draw higher than where they take taps. Keep it at the origin.
const pin = () => {
  if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0)
}
window.addEventListener("scroll", pin, { passive: true })
window.visualViewport?.addEventListener("resize", pin)
window.addEventListener("orientationchange", () => window.setTimeout(pin, 300))

export const touchMode = (): boolean => touch
export const onTouchMode = (listener: () => void) => listeners.add(listener)

export interface TouchSnapshot {
  readonly move: Vec
  /** Unit direction of the right stick; `null` when it is held still (fire at the nearest bug). */
  readonly aim: Vec | null
  readonly fire: boolean
  readonly dash: boolean
  readonly bomb: boolean
}

const el = (tag: string, className: string, text = ""): HTMLElement => {
  const node = document.createElement(tag)
  node.className = className
  node.textContent = text
  return node
}

/** A stick drawn where its thumb landed inside its zone, from the controls' view. */
const stickNode = (zone: HTMLElement) => {
  const base = el("div", "stick")
  const knob = el("div", "knob")
  base.append(knob)
  zone.append(base)
  return (stick: Touch.StickView | null, layout: Touch.StickZone | null) => {
    base.classList.toggle("held", stick !== null)
    if (stick === null || layout === null) {
      knob.style.transform = ""
      return
    }
    base.style.left = `${stick.origin.x - layout.region.left}px`
    base.style.top = `${stick.origin.y - layout.region.top}px`
    knob.style.transform = `translate(${stick.knob.x - stick.origin.x}px, ${stick.knob.y - stick.origin.y}px)`
  }
}

/** A button that latches a press until the next simulation tick reads it. */
const latch = (button: HTMLElement) => {
  let pressed = false
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault()
    event.stopPropagation()
    pressed = true
    button.classList.add("down")
  })
  for (const type of ["pointerup", "pointercancel", "pointerleave"] as const) {
    button.addEventListener(type, () => button.classList.remove("down"))
  }
  return () => {
    const was = pressed
    pressed = false
    return was
  }
}

/**
 * Twin-stick controls: left thumb moves, right thumb aims and fires
 * (held still, it fires at the nearest bug), plus dash and `git reset`.
 */
export const makeTouchControls = (root: HTMLElement, actions: { pause: () => void; mute: () => void; fullscreen: () => void }) => {
  root.replaceChildren()
  const left = el("div", "stick-zone left")
  const right = el("div", "stick-zone right")
  const dashButton = el("button", "touch-btn dash")
  const bombButton = el("button", "touch-btn bomb", "⏪")
  const bar = el("div", "touch-bar")
  const pauseButton = el("button", "touch-small", "⏸")
  const muteButton = el("button", "touch-small", "🔊")
  bar.append(pauseButton, muteButton)
  if (fullscreenSupported()) {
    const fullscreenButton = el("button", "touch-small", "⛶")
    const label = () => {
      fullscreenButton.classList.toggle("active", isFullscreen())
      fullscreenButton.setAttribute("aria-label", t().touch.fullscreen)
    }
    label()
    onFullscreenChange(label)
    fullscreenButton.addEventListener("click", actions.fullscreen)
    bar.append(fullscreenButton)
  }
  root.append(left, right, dashButton, bombButton, bar)

  // A zone's rect relative to the overlay: the CSS stays where the sticks live.
  const regionOf = (zone: HTMLElement): Touch.Rect => {
    const box = zone.getBoundingClientRect()
    const origin = root.getBoundingClientRect()
    return { left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height }
  }
  // The raw tilt (dead zone 0): `snapshot` applies `DEADZONE` itself. A hidden overlay has no sticks,
  // so a thumb held when the game pauses lets go. Any pointer drives them, as the zones always did.
  const sticks = Touch.actions(
    root,
    window,
    () => ({
      sticks: {
        move: root.hidden ? null : { region: regionOf(left), radius: STICK_RADIUS, deadZone: 0 },
        aim: root.hidden ? null : { region: regionOf(right), radius: STICK_RADIUS, deadZone: 0 }
      },
      buttons: {}
    }),
    { pointerTypes: ["touch", "pen", "mouse"] }
  )
  const drawMove = stickNode(left)
  const drawAim = stickNode(right)
  const draw = () => {
    const view = sticks.view()
    drawMove(view.sticks.move, view.layout.sticks.move)
    drawAim(view.sticks.aim, view.layout.sticks.aim)
  }
  const dash = latch(dashButton)
  const bomb = latch(bombButton)
  // The bar sits over the right zone: its taps are not the aim stick.
  bar.addEventListener("pointerdown", (event) => event.stopPropagation())
  pauseButton.addEventListener("click", actions.pause)
  muteButton.addEventListener("click", actions.mute)

  return {
    snapshot: (): TouchSnapshot => {
      const { move: m, aim: a } = sticks.snapshot().vectors
      draw()
      const magnitude = Math.hypot(a.x, a.y)
      return {
        move: Math.hypot(m.x, m.y) < DEADZONE ? { x: 0, y: 0 } : { x: m.x, y: m.y },
        aim: magnitude < DEADZONE ? null : { x: a.x / magnitude, y: a.y / magnitude },
        fire: a.active,
        dash: dash(),
        bomb: bomb()
      }
    },
    setVisible: (visible: boolean) => {
      root.hidden = !visible
      if (!visible) {
        // Read the layout now: the sticks a hidden overlay has none of let go of their thumbs.
        sticks.snapshot()
        draw()
      }
      dashButton.textContent = t().touch.dash
      dashButton.setAttribute("aria-label", t().touch.dash)
      bombButton.setAttribute("aria-label", "git reset --hard")
    },
    setMuted: (muted: boolean) => {
      muteButton.textContent = muted ? "🔇" : "🔊"
    }
  }
}

export type TouchControls = ReturnType<typeof makeTouchControls>
