import { Keyboard, Pointer } from "@typeonce/ritmo-browser"

import type { InputValue, Vec } from "../sim/schema.ts"
import type { TouchControls } from "./touch.ts"
import { touchMode } from "./touch.ts"

export const keyBindings = {
  up: ["ArrowUp", Keyboard.code("KeyW")],
  down: ["ArrowDown", Keyboard.code("KeyS")],
  left: ["ArrowLeft", Keyboard.code("KeyA")],
  right: ["ArrowRight", Keyboard.code("KeyD")],
  dash: [" ", "Shift"],
  bomb: [Keyboard.code("KeyQ"), Keyboard.code("KeyE")],
  fire: [Keyboard.code("KeyJ")]
} as const

/** Typing a name or a run code is not a shortcut: M, P and Escape typed into a form field stay in the field. (Ritmo's `Keyboard` already leaves form fields alone for movement.) */
export const typing = (event: Event) => {
  const target = event.target
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

/** Aim assist for thumbs: how far, and how wide a cone around the stick, a target may be. */
const ASSIST_RANGE = 700
const ASSIST_CONE = Math.cos((28 * Math.PI) / 180)
const FREE_AIM = 260

export interface Camera {
  readonly toWorld: (screen: Vec) => Vec
  readonly toScreen: (world: Vec) => Vec
}

/** Where the developer is and what is worth shooting, read from the last rendered view. */
export interface Arena {
  readonly player: () => Vec | null
  readonly targets: () => ReadonlyArray<Vec>
}

/** With a stick direction, the target closest to that line; without one, the nearest target. */
const assist = (me: Vec, direction: Vec | null, targets: ReadonlyArray<Vec>): Vec | null => {
  let best: Vec | null = null
  let bestScore = Infinity
  for (const target of targets) {
    const dx = target.x - me.x
    const dy = target.y - me.y
    const distance = Math.hypot(dx, dy)
    if (distance === 0 || distance > ASSIST_RANGE) continue
    let score = distance
    if (direction) {
      const alignment = (dx * direction.x + dy * direction.y) / distance
      if (alignment < ASSIST_CONE) continue
      score = distance * (2 - alignment) * (2 - alignment)
    }
    if (score < bestScore) {
      bestScore = score
      best = target
    }
  }
  return best
}

/**
 * Keyboard, mouse, and the touch sticks merged into the simulation's intent,
 * with the cursor converted to world coordinates through the camera the
 * renderer last used.
 */
export const makeInput = (canvas: HTMLCanvasElement, camera: Camera, touch: TouchControls, arena: Arena) => {
  const keys = Keyboard.actions(window, keyBindings)
  const pointer = Pointer.actions(canvas, window, {})
  // A snapshot starts a new press window, so the renderer reads the cursor from the last one.
  let cursor: Vec = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 3 }
  let lastDirection: Vec = { x: 0, y: -1 }

  const snapshotTouch = (keyboard: InputValue): InputValue => {
    const sticks = touch.snapshot()
    const me = arena.player()
    if (sticks.aim) lastDirection = sticks.aim
    else if (!sticks.fire && Math.hypot(sticks.move.x, sticks.move.y) > 0) {
      const length = Math.hypot(sticks.move.x, sticks.move.y)
      lastDirection = { x: sticks.move.x / length, y: sticks.move.y / length }
    }
    let aim = keyboard.aim
    if (me) {
      const locked = sticks.fire ? assist(me, sticks.aim, arena.targets()) : null
      aim = locked ?? { x: me.x + lastDirection.x * FREE_AIM, y: me.y + lastDirection.y * FREE_AIM }
      cursor = camera.toScreen(aim)
    }
    return {
      move: { x: keyboard.move.x + sticks.move.x, y: keyboard.move.y + sticks.move.y },
      aim,
      fire: keyboard.fire || sticks.fire,
      dash: keyboard.dash || sticks.dash,
      bomb: keyboard.bomb || sticks.bomb
    }
  }

  return {
    snapshot: (): InputValue => {
      const k = keys.snapshot().actions
      const p = pointer.snapshot()
      const keyboard: InputValue = {
        move: {
          x: (k.right.held ? 1 : 0) - (k.left.held ? 1 : 0),
          y: (k.down.held ? 1 : 0) - (k.up.held ? 1 : 0)
        },
        aim: camera.toWorld(p.position),
        fire: p.buttons.primary.held || k.fire.held,
        dash: k.dash.pressed,
        bomb: k.bomb.pressed || p.buttons.secondary.pressed
      }
      if (touchMode()) return snapshotTouch(keyboard)
      cursor = p.position
      return keyboard
    },
    cursor: (): Vec => cursor,
    dispose: () => {
      keys.dispose()
      pointer.dispose()
    }
  }
}

export type GameInput = ReturnType<typeof makeInput>
