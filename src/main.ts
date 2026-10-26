import { BrowserTickSource } from "@typeonce/ritmo-browser"
import * as FixedLoop from "@typeonce/ritmo/FixedLoop"
import * as Result from "@typeonce/ritmo/Result"

import { bugKinds, ticketColors } from "./content/bugs.ts"
import { clients } from "./content/clients.ts"
import { locales } from "./content/i18n.ts"
import { endlessLevel, levels } from "./content/levels.ts"
import type { Level, LevelId } from "./content/levels.ts"
import { makeAudio } from "./host/audio.ts"
import { makeChat } from "./host/chat.ts"
import { enterFullscreen, fullscreenSupported, standalone, toggleFullscreen } from "./host/fullscreen.ts"
import { makeInput, typing } from "./host/input.ts"
import { formatNumber, locale, setLocale, t } from "./host/language.ts"
import { connect, makeFrames } from "./host/net.ts"
import type { Connection } from "./host/net.ts"
import { createRenderer } from "./host/renderer.ts"
import { makeTouchControls, onTouchMode, touchMode } from "./host/touch.ts"
import { codePattern, NAME_MAX } from "./net/protocol.ts"
import type { ErrorCode, RoomInfo, ServerMessage } from "./net/protocol.ts"
import { bestScore, clearSprint, endEndless, loadProgress, saveProgress, sprintsCleared, sprintUnlocked, unlockEverySprint } from "./progress.ts"
import type { Progress } from "./progress.ts"
import { minionPrefixes } from "./sim/bosses.ts"
import { PARTY, STEP } from "./sim/constants.ts"
import { makePickup } from "./sim/drafts.ts"
import { Game, Pickup } from "./sim/schema.ts"
import type { FxValue, InputValue, Phase, PickupKind } from "./sim/schema.ts"
import { createSimulation, idleInput } from "./sim/simulation.ts"
import type { View } from "./sim/simulation.ts"
import "./style.css"

type Simulation = Extract<ReturnType<typeof createSimulation>, { ok: true }>["value"]

const readProgress = () => loadProgress(localStorage.getItem("bugkiller:progress"))
const writeProgress = (p: Progress) => localStorage.setItem("bugkiller:progress", saveProgress(p))

const overlay = document.querySelector<HTMLElement>("#overlay")!
const chatRoot = document.querySelector<HTMLElement>("#chat")!
const touchRoot = document.querySelector<HTMLElement>("#touch")!
const rotateText = document.querySelector<HTMLElement>("#rotate-text")!

const { renderer, canvas } = await createRenderer(document.querySelector<HTMLCanvasElement>("#game")!)
const audio = makeAudio()
const toggleMute = () => {
  const muted = audio.toggleMute()
  touch.setMuted(muted)
  renderer.showBanner(muted ? t().hud.audioOff : t().hud.audioOn, "", "#ffffff", 0.8)
}
const touch = makeTouchControls(touchRoot, {
  pause: () => {
    if (mode === "playing") showPause()
  },
  mute: () => toggleMute(),
  fullscreen: () => void toggleFullscreen()
})
const input = makeInput(canvas, renderer, touch, {
  player: () => view?.player?.position ?? null,
  targets: () => (view ? [...view.bugs, ...view.bosses].map((target) => target.position) : [])
})
let progress = readProgress()

/** The sprints, then endless: menu buttons and restarts index into this. */
const playable = [...levels, endlessLevel]

let sim: Simulation | null = null
let view: View | null = null
let levelIndex = 0

/** A multiplayer run: the server steps the world, this browser sends input and draws its frames. */
interface Remote {
  readonly connection: Connection
  readonly frames: ReturnType<typeof makeFrames>
  room: RoomInfo | null
  you: number
  level: Level
  running: boolean
}
let remote: Remote | null = null
/** Input goes to the run server every other step, 30 times a second: half the messages, same feel. */
const INPUT_EVERY = 2
let inputSteps = 0
/** Snapshots taken since the last message: a dash, bomb or Breakpoint pressed in between rides along with the next one. */
let unsent: InputValue | null = null
const levelById = (id: LevelId): Level => playable.find((level) => level.id === id) ?? endlessLevel

/** "lobby" is every multiplayer screen before a run: the join form and the room. */
type Mode = "menu" | "lobby" | "intro" | "playing" | "paused" | "over"
let mode: Mode = "menu"
/** Every screen change goes through here: the touch sticks only exist while playing. */
const setMode = (next: Mode) => {
  mode = next
  document.body.dataset.mode = next
  rotateText.textContent = t().touch.rotate
  touch.setVisible(next === "playing" && touchMode())
  syncMusic()
}
let lastPhase: Phase = "waves"
let phaseShownAt = 0

/** Something calm on the menu, the loop while a sprint is played (faster for the boss), silence elsewhere. */
const syncMusic = () => {
  const phase = view?.run.phase
  if (mode === "menu" || mode === "lobby") return audio.music("menu")
  audio.music(mode !== "playing" ? null : phase === "boss" ? "boss" : phase === "waves" ? "sprint" : null)
}

const playFx = (event: FxValue) => {
  renderer.fx(event)
  switch (event.type) {
    case "shoot": audio.shoot(event.weapon); break
    case "hit": if (!event.quiet) audio.hit(); break
    case "kill":
      if (event.boss) audio.bossDown()
      else audio.kill(view?.run.combo ?? 0)
      break
    case "hurt": audio.hurt(); break
    case "pickup": audio.pickup(); break
    case "turret": audio.turret(); break
    case "hallucination": audio.hallucination(); break
    case "bomb": audio.bomb(); break
    case "explosion": audio.explosion(); break
    case "dash": audio.dash(); break
    case "breakpointSet": audio.breakpointSet(); break
    case "breakpoint": audio.breakpoint(); break
    case "reopen": audio.reopen(); break
    case "fuse": audio.fuse(); break
    case "deploy": audio.deploy(); break
    case "teleport": audio.teleport(); break
    case "resurrect": break
    case "bossPhase": audio.boss(); break
    case "spawn": break
    case "ping": audio.ping(); break
    case "callDone": break
  }
}

const chat = makeChat(chatRoot, (event) => {
  switch (event.type) {
    case "mission": audio.chat(event.client === "ugo"); break
    case "outcome": if (event.success) audio.success(); else audio.failure(); break
    case "resurrect": audio.laugh(event.client === "ugo"); break
    case "nudge": audio.nudge(); break
    case "call": audio.ring(event.kind); break
  }
})

// --- Screens --------------------------------------------------------------

const html = (strings: TemplateStringsArray, ...values: Array<unknown>) =>
  strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i]) : ""), "")

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const show = (content: string, className = "") => {
  overlay.className = `overlay ${className}`
  overlay.innerHTML = content
  overlay.hidden = false
}
const hide = () => {
  overlay.hidden = true
  overlay.innerHTML = ""
}

const avatars = (ids: ReadonlyArray<keyof typeof clients>) =>
  [...new Set(ids)].map((id) => html`<span class="avatar" style="background:${clients[id].color}" title="${clients[id].name}">${clients[id].name[0]}</span>`).join("")

const showTitle = () => {
  setMode("menu")
  chatRoot.hidden = true
  const cards = levels.map((level, i) => {
    const locked = !sprintUnlocked(progress, i)
    const best = bestScore(progress, level.id)
    // No project names or ticket keys here: the menu is what ends up in screenshots.
    return html`
      <button class="level ${locked ? "locked" : ""}" data-level="${i}" ${locked ? "disabled" : ""} style="--accent:${level.theme.accent}">
        <span class="level-name">${level.sprint}</span>
        <span class="level-tagline">${escape(t().taglines[level.id])}</span>
        <span class="level-meta">${t().menu.openBugs(level.bugs.length)}</span>
        <span class="level-clients">${avatars(level.clients)}</span>
        <span class="level-best">${locked ? t().menu.locked : best ? t().menu.best(formatNumber(best)) : t().menu.fresh}</span>
      </button>`
  }).join("")
  const endlessBest = bestScore(progress, endlessLevel.id)
  const endlessCard = html`
    <button class="level endless" data-level="${levels.length}" style="--accent:${endlessLevel.theme.accent}">
      <span class="level-name">∞ ${endlessLevel.name}</span>
      <span class="level-tagline">${escape(t().taglines.endless)}</span>
      <span class="level-meta">${t().menu.endless(endlessLevel.endless?.every ?? 0)}</span>
      <span class="level-clients">${avatars(endlessLevel.clients)}</span>
      <span class="level-best">${endlessBest ? t().menu.best(formatNumber(endlessBest)) : t().menu.fresh}</span>
    </button>`
  const multiCard = html`
    <button class="level together" data-multi style="--accent:#7fdcff">
      <span class="level-name">${t().multi.menuButton}</span>
      <span class="level-tagline">${escape(t().multi.cardTagline)}</span>
      <span class="level-meta">${t().multi.cardMeta}</span>
      <span class="level-clients">${PARTY.colors.map((color) => html`<span class="avatar" style="background:${color}"></span>`).join("")}</span>
    </button>`
  // Saved progress, not the `?tutti` shortcut: how far this browser really got.
  const cleared = sprintsCleared(readProgress())
  show(html`
    <div class="title">
      <div class="logo" data-text="BUG KILLER">BUG KILLER</div>
      <p class="subtitle">${t().menu.subtitle}</p>
      <section class="group">
        <h3 class="group-title"><span>${t().menu.campaign}</span><span class="group-progress">${t().menu.campaignProgress(cleared, levels.length)}</span></h3>
        <div class="levels">${cards}</div>
      </section>
      <section class="group">
        <h3 class="group-title"><span>${t().menu.extras}</span></h3>
        <div class="levels extras">${endlessCard}${multiCard}</div>
      </section>
      <div class="legend">
        ${Object.entries(bugKinds).map(([p, k]) => html`<span><i style="background:${k.color}"></i>${p}</span>`).join("")}
      </div>
      <p class="fineprint">
        <span data-controls>${touchMode() ? t().menu.touchControls : t().menu.controls}</span><br/>
        ${t().menu.disclaimer}
      </p>
      ${touchMode() && !fullscreenSupported() && !standalone() ? html`<p class="fineprint home-hint">📲 ${t().touch.homeScreen}</p>` : ""}
      <div class="languages" role="group" aria-label="${t().menu.language}">
        ${locales.map((code) => html`<button data-lang="${code}" class="${code === locale() ? "active" : ""}" aria-pressed="${code === locale()}" title="${t().languageName}">${code.toUpperCase()}</button>`).join("")}
      </div>
    </div>`, "menu")
  overlay.querySelectorAll<HTMLButtonElement>("[data-lang]").forEach((button) =>
    button.addEventListener("click", () => {
      const code = locales.find((l) => l === button.dataset.lang)
      if (code && code !== locale()) {
        setLocale(code)
        showTitle()
      }
    })
  )
  overlay.querySelectorAll<HTMLButtonElement>("[data-level]").forEach((button) =>
    button.addEventListener("click", () => {
      audio.unlock()
      startLevel(Number(button.dataset.level))
    })
  )
  overlay.querySelector<HTMLButtonElement>("[data-multi]")?.addEventListener("click", () => showMulti())
}

// --- Playing together -----------------------------------------------------

const loadName = () => localStorage.getItem("bugkiller:name") ?? ""
const saveName = (name: string) => localStorage.setItem("bugkiller:name", name)

/** The sprints this browser has unlocked, and endless: what a host may pick. */
const levelOptions = (selected: LevelId) =>
  playable
    .filter((level, i) => level.endless !== undefined || sprintUnlocked(progress, i))
    .map((level) => html`<option value="${level.id}" ${level.id === selected ? "selected" : ""}>${level.endless ? "∞" : escape(level.sprint)} · ${escape(level.name)}</option>`)
    .join("")

const shareLink = (code: string) => `${location.origin}${location.pathname}?run=${code}`

/** Keeps the address bar on the run, so a reload or a copied URL comes back to it. */
const markRun = (code: string | null) => {
  const url = new URL(location.href)
  if (code) url.searchParams.set("run", code)
  else url.searchParams.delete("run")
  history.replaceState(null, "", url)
}

const onServer = (message: ServerMessage) => {
  const r = remote
  if (!r) return
  switch (message.t) {
    case "room":
      r.room = message.room
      r.you = message.you
      markRun(message.room.code)
      if (mode === "lobby") showLobby()
      else if (mode === "over") fillOverActions()
      break
    case "started":
      r.you = message.you
      r.level = levelById(message.level)
      r.running = true
      r.frames.reset()
      levelIndex = playable.indexOf(r.level)
      view = null
      lastPhase = "waves"
      chat.reset()
      chatRoot.hidden = false
      hide()
      setMode("playing")
      audio.rewindMusic()
      renderer.showBanner(`${r.level.sprint.toUpperCase()}: ${r.level.name.toUpperCase()}`, t().hud.startBanner, r.level.theme.accent, 2.4)
      break
    case "frame":
      r.frames.push(message.view)
      for (const event of message.fx) playFx(event)
      for (const event of message.chat) chat.push(event)
      break
    case "error":
      if (mode === "lobby" && !r.room) showMulti(message.code)
      else showLobbyError(message.code)
      break
  }
}

const openRemote = (): Remote => {
  if (remote) return remote
  const opened: Remote = {
    connection: connect({
      message: onServer,
      closed: () => {
        if (remote !== opened) return
        remote = null
        markRun(null)
        if (mode === "menu") return
        if (mode === "lobby" && !opened.room) {
          // Still on the form: a busy or unreachable server is said there, not on a screen of its own.
          const line = overlay.querySelector(".multi-error")
          if (line && !line.textContent) line.textContent = t().multi.unreachable
          return
        }
        setMode("over")
        chatRoot.hidden = true
        show(html`<div class="panel"><h2 class="lose">📡 ${t().multi.lost}</h2><div class="actions"><button data-act="menu" class="primary">${t().pause.menu}</button></div></div>`)
        bindActions()
      }
    }),
    frames: makeFrames(),
    room: null,
    you: 0,
    level: playable[0] ?? endlessLevel,
    running: false
  }
  remote = opened
  return opened
}

const leaveRemote = () => {
  if (!remote) return
  remote.connection.send({ t: "leave" })
  remote.connection.close()
  remote = null
  markRun(null)
}

/** Choose a name, then create a run or join one by its code. */
const showMulti = (error?: ErrorCode, code = new URLSearchParams(location.search).get("run") ?? "") => {
  setMode("lobby")
  chatRoot.hidden = true
  const name = (overlay.querySelector<HTMLInputElement>("[name=name]")?.value ?? loadName()).trim()
  show(html`
    <form class="panel multi" novalidate>
      <h2>${t().multi.title}</h2>
      <p>${t().multi.body}</p>
      <label class="field"><span>${t().multi.name}</span>
        <input name="name" maxlength="${NAME_MAX}" autocomplete="nickname" placeholder="${escape(t().multi.namePlaceholder)}" value="${escape(name)}" required /></label>
      <div class="multi-choices">
        <div class="multi-box">
          <label class="field"><span>${t().multi.level}</span><select name="level">${levelOptions(playable[Math.min(levelIndex, playable.length - 1)]?.id ?? "glacier")}</select></label>
          <button type="button" class="primary" data-create>${t().multi.create}</button>
        </div>
        <div class="multi-box">
          <label class="field"><span>${t().multi.code}</span>
            <input name="code" placeholder="RUN-0000" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${escape(code)}" /></label>
          <button type="button" data-join>${t().multi.join}</button>
        </div>
      </div>
      <p class="multi-error" role="alert">${error ? t().multi.errors[error] : ""}</p>
      <div class="actions"><button type="button" data-back>${t().multi.back}</button></div>
    </form>`, "menu")
  const form = overlay.querySelector<HTMLFormElement>("form")!
  const field = (key: string) => form.querySelector<HTMLInputElement>(`[name=${key}]`)!
  const fail = (code: ErrorCode) => {
    form.querySelector(".multi-error")!.textContent = t().multi.errors[code]
  }
  const chosenName = (): string | null => {
    const value = field("name").value.trim()
    if (!value) {
      fail("badName")
      field("name").focus()
      return null
    }
    saveName(value)
    // A new try: whatever went wrong last time is no longer news.
    form.querySelector(".multi-error")!.textContent = ""
    return value
  }
  const join = () => {
    const name = chosenName()
    const runCode = field("code").value.trim().toUpperCase()
    if (!name) return
    if (!codePattern.test(runCode)) return fail("notFound")
    audio.unlock()
    openRemote().connection.send({ t: "join", code: runCode, name })
  }
  form.querySelector("[data-create]")!.addEventListener("click", () => {
    const name = chosenName()
    if (!name) return
    audio.unlock()
    const level = form.querySelector<HTMLSelectElement>("[name=level]")!.value
    openRemote().connection.send({ t: "create", name, level: playable.find((l) => l.id === level)?.id ?? "glacier", locale: locale() })
  })
  form.querySelector("[data-join]")!.addEventListener("click", join)
  // Two text fields and no submit button: the browser would not send the form on Enter by itself.
  form.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return
    event.preventDefault()
    if (field("code").value.trim()) join()
    else field("code").focus()
  })
  form.querySelector("[data-back]")!.addEventListener("click", () => {
    leaveRemote()
    showTitle()
  })
  ;(code && !name ? field("name") : code ? form.querySelector<HTMLButtonElement>("[data-join]")! : field("name")).focus()
}

const members = (room: RoomInfo, you: number) =>
  room.members.map((member) => html`
    <li class="${member.connected ? "" : "offline"}">
      <i style="background:${member.color}"></i>
      <b>${escape(member.name)}</b>
      ${member.slot === room.host ? html`<span class="tag">${t().multi.host}</span>` : ""}
      ${member.slot === you ? html`<span class="tag you">${t().multi.you}</span>` : ""}
      ${member.connected ? "" : html`<span class="tag">${t().multi.offline}</span>`}
    </li>`).join("")

/** The room before a run: who is in, the link to share, and the host's start button. */
const showLobby = () => {
  const r = remote
  if (!r?.room) return showMulti()
  setMode("lobby")
  chatRoot.hidden = true
  const room = r.room
  const isHost = room.host === r.you
  const host = room.members.find((m) => m.slot === room.host)?.name ?? ""
  const level = levelById(room.level)
  show(html`
    <div class="panel multi lobby" style="--accent:${level.theme.accent}">
      <h2>${t().multi.lobby(room.code)}</h2>
      <p>${t().multi.share}</p>
      <div class="share"><code>${escape(shareLink(room.code))}</code><button data-copy>${t().multi.copyLink}</button></div>
      <ul class="members">${members(room, r.you)}</ul>
      ${isHost
        ? html`<label class="field"><span>${t().multi.level}</span><select name="level">${levelOptions(room.level)}</select></label>`
        : html`<p class="lobby-level"><b>${level.endless ? "∞" : escape(level.sprint)} · ${escape(level.name)}</b> — ${escape(t().taglines[level.id])}</p>
          <p class="waiting">${escape(t().multi.waiting(host))}</p>`}
      <p class="multi-error" role="alert"></p>
      <div class="actions">
        ${isHost ? html`<button class="primary" data-start>${t().multi.start}</button>` : ""}
        <button data-leave>${t().multi.leave}</button>
      </div>
    </div>`, "menu")
  overlay.querySelector<HTMLButtonElement>("[data-copy]")?.addEventListener("click", (event) => {
    const button = event.currentTarget as HTMLButtonElement
    void navigator.clipboard.writeText(shareLink(room.code)).then(() => {
      button.textContent = t().multi.copied
    })
  })
  overlay.querySelector<HTMLButtonElement>("[data-start]")?.addEventListener("click", () => {
    audio.unlock()
    const chosen = overlay.querySelector<HTMLSelectElement>("[name=level]")?.value
    const level = playable.find((l) => l.id === chosen)?.id ?? room.level
    r.connection.send({ t: "start", level })
  })
  overlay.querySelector<HTMLButtonElement>("[data-leave]")?.addEventListener("click", () => {
    leaveRemote()
    showTitle()
  })
}

const showLobbyError = (code: ErrorCode) => {
  const line = overlay.querySelector(".multi-error")
  if (line) line.textContent = t().multi.errors[code]
}

/** The team's results: everyone's points and fixes, best first. */
const team = (v: View) => {
  if (v.players.length < 2) return ""
  const rows = [...v.players]
    .sort((a, b) => b.points - a.points)
    .map((p) => html`<li><i style="background:${p.color}"></i><b>${escape(p.name)}</b><span>${formatNumber(p.points)} SP · ${p.fixed} ✔</span></li>`)
    .join("")
  return html`<div class="team"><div class="notes-title">${t().multi.team}</div><ol>${rows}</ol></div>`
}

/** Under a multiplayer result: the host starts the next run, everyone else waits for them. */
const fillOverActions = () => {
  const box = overlay.querySelector<HTMLElement>("[data-over-actions]")
  const r = remote
  if (!box || !r?.room || !view) return
  const isHost = r.room.host === r.you
  const host = r.room.members.find((m) => m.slot === r.room?.host)?.name ?? ""
  const next = view.run.phase === "cleared" && levelIndex < levels.length - 1 ? playable[levelIndex + 1] : undefined
  box.innerHTML = html`
    ${isHost && next ? html`<button data-act="mnext" class="primary">${t().cleared.next}</button>` : ""}
    ${isHost ? html`<button data-act="mstart" class="${next ? "" : "primary"}">${t().multi.playAgain}</button>` : html`<p class="waiting">${escape(t().multi.waiting(host))}</p>`}
    ${view.run.phase === "cleared" ? html`<button data-act="copy">${t().cleared.copy}</button>` : ""}
    <button data-act="leave">${t().multi.leave}</button>`
  bindActions()
}

const startLevel = (index: number) => {
  const level = playable[index]
  if (!level) return showTitle()
  leaveRemote()
  levelIndex = index
  // Phones play fullscreen and landscape where the browser allows it; this runs inside the tap.
  if (touchMode()) void enterFullscreen()
  chat.reset()
  const created = createSimulation({
    level,
    locale: locale(),
    seed: (Date.now() ^ (index * 7919)) >>> 0,
    input,
    presentation: { fx: playFx, chat: (event) => chat.push(event) }
  })
  if (!created.ok) {
    show(html`<div class="panel"><h2>${t().errors.runtime}</h2><pre>${escape(JSON.stringify(created.error, null, 2))}</pre></div>`)
    return
  }
  sim = created.value
  view = sim.view()
  lastPhase = "waves"
  audio.rewindMusic()
  chatRoot.hidden = false
  setMode("intro")
  show(html`
    <div class="intro" style="--accent:${level.theme.accent}">
      <div class="intro-sprint">${level.sprint}</div>
      <div class="intro-name">${level.name}</div>
      <div class="intro-tagline">${escape(t().taglines[level.id])}</div>
      <div class="intro-meta">${level.endless ? t().menu.endless(level.endless.every) : t().menu.openBugs(level.bugs.length)} · ${t().intro.clientsOnline} ${avatars(level.clients)}</div>
      <div class="intro-go">${touchMode() ? t().intro.startTouch : t().intro.start}</div>
    </div>`, "intro-overlay")
  const begin = () => {
    window.removeEventListener("keydown", begin)
    overlay.removeEventListener("click", begin)
    if (mode !== "intro") return
    hide()
    setMode("playing")
    renderer.showBanner(`${level.sprint.toUpperCase()}: ${level.name.toUpperCase()}`, t().hud.startBanner, level.theme.accent, 2.4)
  }
  window.setTimeout(() => {
    window.addEventListener("keydown", begin)
    overlay.addEventListener("click", begin)
  }, 400)
}

const showPause = () => {
  setMode("paused")
  if (remote) {
    // The run goes on: stand still rather than keep running into the bugs.
    remote.connection.send({ t: "input", input: { ...idleInput, aim: view?.player?.aim ?? idleInput.aim } })
    show(html`
      <div class="panel">
        <h2>${t().pause.title}</h2>
        <p>${t().multi.pauseBody}</p>
        <div class="actions">
          <button data-act="resume" class="primary">${t().pause.resume}</button>
          <button data-act="leave">${t().multi.leave}</button>
        </div>
      </div>`)
    bindActions()
    return
  }
  show(html`
    <div class="panel">
      <h2>${t().pause.title}</h2>
      <p>${t().pause.body}</p>
      <div class="actions">
        <button data-act="resume" class="primary">${t().pause.resume}</button>
        <button data-act="restart">${t().pause.restart}</button>
        <button data-act="menu">${t().pause.menu}</button>
      </div>
    </div>`)
  bindActions()
}

const stats = (v: View) => html`
  <div class="stats">
    <div><b>${formatNumber(v.run.score)}</b><span>${t().stats.points}</span></div>
    <div><b>${v.run.fixed.length}</b><span>${t().stats.closed}</span></div>
    <div><b>×${v.run.bestCombo}</b><span>${t().stats.bestCombo}</span></div>
    <div><b>${v.run.missionsWon}/${v.run.missionsWon + v.run.missionsLost}</b><span>${t().stats.missions}</span></div>
    <div><b>${v.calls.answered}/${v.calls.answered + v.calls.missed}</b><span>${t().stats.calls}</span></div>
    <div><b>${v.run.hitsTaken}</b><span>${t().stats.breakdowns}</span></div>
  </div>
  ${team(v)}`

/** Whether a fixed ticket goes in the release notes: not scope creep, nor a boss's minion. */
const noteworthy = (f: { readonly key: string }) => !["ESC-", ...minionPrefixes].some((prefix) => f.key.startsWith(prefix))

const releaseNotes = (v: View) => {
  const items = v.run.fixed
    .filter(noteworthy)
    .map((f) => html`<li><b style="color:${bugKinds[f.priority].color}">${f.key}</b>${f.type === "bug" ? "" : html`<em class="notes-type" style="color:${ticketColors[f.type]}">${escape(t().ticketTypes[f.type].label)}</em>`} ${escape(f.summary)}</li>`)
    .join("")
  const creep = v.run.fixed.filter((f) => f.key.startsWith("ESC-"))
  return html`
    <div class="notes">
      <div class="notes-title">${t().notes.title} · ${escape(v.level.name)} v${levelIndex + 1}.${v.run.wave}.${v.run.fixed.length}</div>
      <ul>${items}</ul>
      ${v.run.subtasks ? html`<div class="notes-creep">${escape(t().notes.subtasks(v.run.subtasks))}</div>` : ""}
      ${creep.length ? html`<div class="notes-creep">${escape(t().notes.scopeCreep(creep.length))}</div>` : ""}
      ${v.interruptions.resurrections ? html`<div class="notes-creep">${escape(t().notes.resurrections(v.interruptions.resurrections))}</div>` : ""}
    </div>`
}

const markdownNotes = (v: View) =>
  [`## Release notes — ${v.level.name}`, "", ...v.run.fixed.filter(noteworthy).map((f) => `- **${f.key}**${f.type === "bug" ? "" : ` _${t().ticketTypes[f.type].label}_`} ${f.summary}`), ...(v.run.subtasks ? ["", t().notes.subtasks(v.run.subtasks)] : [])].join("\n")

const showCleared = (v: View) => {
  setMode("over")
  // A sprint cleared together unlocks the next one here too; best scores stay solo.
  progress = clearSprint(progress, levelIndex, { score: v.run.score, solo: !remote })
  writeProgress(progress)
  const last = levelIndex === levels.length - 1
  show(html`
    <div class="panel wide">
      ${last
        ? html`<h2 class="win">${t().cleared.allTitle}</h2>
          <p>${t().cleared.allBody}</p>
          <div class="final-msg"><span class="avatar" style="background:${clients.ugo.color}">${clients.ugo.name[0]}</span><div><b style="color:${clients.ugo.color}">Ugo</b><p>${t().cleared.ugoFinal}</p></div></div>`
        : html`<h2 class="win">${t().cleared.title}</h2><p>${escape(t().cleared.body(v.level.name))}</p>`}
      ${stats(v)}
      ${releaseNotes(v)}
      ${remote
        ? html`<div class="actions" data-over-actions></div>`
        : html`<div class="actions">
          ${last ? "" : html`<button data-act="next" class="primary">${t().cleared.next}</button>`}
          <button data-act="copy">${t().cleared.copy}</button>
          <button data-act="restart">${t().cleared.replay}</button>
          <button data-act="menu">${t().pause.menu}</button>
        </div>`}
    </div>`)
  bindActions()
  fillOverActions()
}

const showDead = (v: View) => {
  setMode("over")
  // Endless only ends here, so this is where its best score is kept.
  const ended = v.level.endless !== undefined ? endEndless(progress, { score: v.run.score, solo: !remote }) : undefined
  const record = ended?.record ?? false
  if (ended && record) {
    progress = ended.progress
    writeProgress(progress)
  }
  const summary = v.level.endless
    ? html`${escape(t().dead.endless(v.run.wave, v.run.loop))}${record ? html` <b>${t().dead.record}</b>` : ""}`
    : html`${t().dead.stillOpen} <b>${v.level.bugs.length - Math.min(v.level.bugs.length, v.run.nextBug) + v.bugs.length}</b>${v.bosses[0] ? html` · ${t().dead.bossStillThere(v.bosses[0].key)}` : ""}`
  show(html`
    <div class="panel">
      <h2 class="lose">💀 ${t().dead.lines[Math.floor(Math.random() * t().dead.lines.length)]}</h2>
      <p>${summary}</p>
      ${stats(v)}
      ${remote
        ? html`<div class="actions" data-over-actions></div>`
        : html`<div class="actions">
          <button data-act="restart" class="primary">${t().dead.retry}</button>
          <button data-act="menu">${t().pause.menu}</button>
        </div>`}
    </div>`)
  bindActions()
  fillOverActions()
}

const bindActions = () => {
  overlay.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((button) =>
    button.addEventListener("click", () => {
      audio.unlock()
      switch (button.dataset.act) {
        case "resume":
          hide()
          setMode("playing")
          break
        case "restart":
          startLevel(levelIndex)
          break
        case "next":
          startLevel(levelIndex + 1)
          break
        case "menu":
        case "leave":
          leaveRemote()
          sim = null
          view = null
          chat.reset()
          showTitle()
          break
        case "mstart":
          remote?.connection.send({ t: "start", level: remote.level.id })
          break
        case "mnext": {
          const next = playable[levelIndex + 1]
          if (next) remote?.connection.send({ t: "start", level: next.id })
          break
        }
        case "reload":
          location.reload()
          break
        case "copy":
          if (view) {
            void navigator.clipboard.writeText(markdownNotes(view)).then(() => {
              button.textContent = t().cleared.copied
            })
          }
          break
      }
    })
  )
}

window.addEventListener("keydown", (event) => {
  if (typing(event)) return
  if (event.key === "m" || event.key === "M") toggleMute()
  if (event.key === "p" || event.key === "P" || event.key === "Escape") {
    if (mode === "playing") showPause()
    else if (mode === "paused") {
      hide()
      setMode("playing")
    }
  }
})
// The first tap or key anywhere is allowed to start sound: the menu music begins there.
for (const type of ["click", "touchend", "keydown"] as const) {
  window.addEventListener(type, () => audio.unlock(), { capture: true, once: true })
}
window.addEventListener("blur", () => {
  if (mode === "playing") showPause()
})
// Turning the phone upright mid-sprint pauses: the arena does not fit.
const portrait = matchMedia("(orientation: portrait)")
portrait.addEventListener("change", () => {
  if (portrait.matches && touchMode() && mode === "playing") showPause()
})
// Only swap the text: re-rendering the menu would swallow the tap that switched modes.
onTouchMode(() => {
  const controls = overlay.querySelector<HTMLElement>("[data-controls]")
  if (controls) controls.innerHTML = t().menu.touchControls
  setMode(mode)
})

// --- Loop -----------------------------------------------------------------

const loop = FixedLoop.start({
  source: BrowserTickSource.make(window),
  step: STEP,
  maxFrameSeconds: 0.25,
  maxStepsPerFrame: 5,
  update: () => {
    if (remote) {
      // Multiplayer: the server steps the world; this browser only says what its developer does.
      if (remote.running && mode === "playing") {
        // Every step still snapshots, so the cursor keeps following the mouse at 60 Hz.
        const latest = input.snapshot()
        unsent = unsent
          ? { ...latest, dash: unsent.dash || latest.dash, bomb: unsent.bomb || latest.bomb, breakpoint: unsent.breakpoint || latest.breakpoint }
          : latest
        inputSteps += 1
        if (inputSteps % INPUT_EVERY === 0) {
          remote.connection.send({ t: "input", input: unsent })
          unsent = null
        }
      }
      return Result.success(undefined)
    }
    if (!sim || mode !== "playing") return Result.success(undefined)
    return sim.step()
  },
  render: (frame) => {
    if (remote) {
      if (!remote.running) return
      view = remote.frames.sample(remote.level, remote.you) ?? view
    } else if (sim) {
      view = sim.view()
    } else {
      return
    }
    if (!view) return
    const phase = view.run.phase
    if (phase !== lastPhase) {
      const previous = lastPhase
      lastPhase = phase
      phaseShownAt = performance.now()
      syncMusic()
      if (phase === "boss") {
        // Endless rotates bosses: name the one that actually showed up.
        const boss = view.bosses[0] ?? view.level.boss
        renderer.showBanner(`⚠ BOSS: ${boss.key}`, boss.title, boss.color, 3.5)
        audio.boss()
      } else if (previous === "boss" && phase === "waves") {
        renderer.showBanner(t().hud.nextRound(view.run.loop + 1), t().hud.nextRoundSub, view.level.theme.accent, 2.6)
      }
    }
    if (mode === "playing" && (phase === "dead" || phase === "cleared") && performance.now() - phaseShownAt > (phase === "dead" ? 1400 : 2600)) {
      if (phase === "dead") showDead(view)
      else showCleared(view)
    }
    chat.update(view.missions, view.calls)
    renderer.draw(view, input.cursor(), mode === "playing" ? frame.elapsedSeconds : Math.min(frame.elapsedSeconds, 0.016))
  },
  onFailure: (failure) => {
    console.error(failure)
    show(html`<div class="panel"><h2>${t().errors.crashed}</h2><pre>${escape(JSON.stringify(failure, null, 2))}</pre><div class="actions"><button data-act="reload">${t().errors.reload}</button></div></div>`)
    bindActions()
  }
})

if (!loop.ok) console.error(loop.error)

// `?tutti` unlocks every sprint for this session, for demos and playtests.
if (new URLSearchParams(location.search).has("tutti")) {
  progress = unlockEverySprint(progress)
}

if (import.meta.env.DEV) {
  // Lets a scripted playtest read the world and aim like a player.
  // `drop("ai")` drops a power-up at the developer's feet in a solo run, to try it without waiting for luck.
  const drop = (kind: PickupKind) => {
    const at = view?.player?.position
    if (!sim || !at) return
    const Drop = Game.System("Dev/Drop", { commands: Game.System.commands(Game.System.spawns(Pickup)) }, ({ commands }) => {
      commands.spawn(makePickup(kind, { x: at.x + 60, y: at.y }))
    })
    const ran = sim.runtime.tick(Game.Schedule(Drop, Game.Schedule.applyDeferred()))
    if (!ran.ok) console.error(ran.error)
  }
  Object.assign(window, {
    __bugKiller: { view: () => view, camera: renderer.camera, drop }
  })
}

// A shared link (`?run=RUN-1234`) opens straight on the join form.
if (new URLSearchParams(location.search).has("run")) showMulti()
else showTitle()
