import type { Strings } from "../i18n.ts"
import { morePop, plusOne, shout } from "./voice.ts"

export const en: Strings = {
  tag: "en-US",
  languageName: "English",

  people: {
    ugo: { role: "Client (super urgent)", laugh: "HAHAHAHAHAHA", voice: shout },
    ornella: {
      role: "Head of Quality",
      laugh: "Ha. Ha.",
      voice: (text) => `Good morning, following up on my previous email (still unanswered): ${text} Kind regards.`
    },
    kevin: {
      role: "Product Owner",
      laugh: "hahahaha 😂😂",
      voice: (text, pick) => `Hi! Sent you a ${4 + pick(9)}-minute voice note, TL;DR: ${text} 👍`
    },
    samanta: {
      role: "Project Manager",
      laugh: "hahah come on",
      voice: (text) => `While you're at it, one tiny quick thing: ${text} Should only take a sec, right?`
    },
    gualtiero: {
      role: "Client's IT",
      laugh: "lol",
      voice: (text) => `It worked on staging, you know. Anyway: ${text}`
    },
    tobia: { role: "Tech Lead", laugh: "haha", voice: (text) => text },
    fabrizio: { role: "Stakeholder (cc'd on everything)", laugh: "+1", voice: plusOne },
    debora: { role: "Marketing", laugh: "ahah love it ✨", voice: morePop("Can we make it a bit more pop? By Friday, ideally ✨", "And a bit more pop, please. It's for Friday 🎨", "Love it, just needs to pop more. Friday? 💥") }
  },

  tobiaLines: [
    "are you using the _tools_??",
    "have you tried the _tools_ though?",
    "with the _tools_ you'd have closed this in five minutes",
    "did you ask the _tools_ before shooting by hand?",
    "leaving the _tools_ here, let me know"
  ],
  resurrectLine: (key, laugh) => `${key} is not fixed yet. ${laugh} Work harder.`,
  outcomes: {
    ugo: {
      success: ["OK", "FINALLY", "FINE BUT FASTER NEXT TIME", "PERFECT NOW I HAVE ANOTHER ONE"],
      failure: ["I CALLED YOUR BOSS", "UNACCEPTABLE", "MY CLIENT'S CLIENT IS FURIOUS", "OPENING A TICKET ABOUT THE TICKET"]
    },
    ornella: {
      success: ["Noted. I will mention it in the minutes.", "Good. Attaching the signed document."],
      failure: ["I am putting this in writing.", "Copying management."]
    },
    kevin: {
      success: ["Awesome!! Showing it in the demo right now 🚀", "Great, updating the roadmap"],
      failure: ["Hmm, let's discuss it at the retro 😅", "Ok, moving everything to next sprint"]
    },
    samanta: {
      success: ["Perfect! So, while we're at it...", "Great, moving the ticket to Done"],
      failure: ["Ok, added 3 bugs to the backlog just in case", "Oh well, opening a change request"]
    },
    gualtiero: {
      success: ["Ah ok, it works now. It was the cache anyway.", "Works. Weird though."],
      failure: ["See? Told you.", "Can't reproduce it here, must be your network."]
    },
    tobia: {
      success: ["see? with the _tools_ it's a breeze"],
      failure: ["ok but next time use the _tools_"]
    },
    fabrizio: { success: ["+1"], failure: ["up"] },
    debora: {
      success: ["Love it!! Now can we make the logo bigger? 💖", "Perfect, posting it on LinkedIn right now ✨"],
      failure: ["Hmm, it doesn't pop. We'll talk on Friday.", "Moving the launch, again. And the font is still sad."]
    }
  },
  missions: {
    killCount: (goal, seconds) => `I need ${goal} bugs closed within ${seconds} seconds.`,
    killTarget: (key, summary, seconds) => `${key} ("${summary}") is a blocker. Close it within ${seconds} seconds.`,
    noHit: (seconds) => `I'm demoing to the end client: don't take a hit for ${seconds} seconds.`,
    combo: (goal) => `Show me some rhythm: a combo of ${goal} bugs in a row.`,
    priorityHunt: (goal, priority) => `Close ${goal} ${priority} priority bugs, everything else can wait.`
  },
  scopeCreep: [
    "The button is too blue",
    "Can we make the logo bigger?",
    "It doesn't work (no screenshot attached)",
    "Urgent: see subject",
    "Looks off on Internet Explorer",
    "The client wants an Excel export",
    "Add dark mode by tonight",
    "The page is slow (which page? unspecified)",
    "Bring back the feature we removed on request",
    "Data is missing (which data?)"
  ],
  regression: (key) => `Regression introduced by the fix for ${key}`,
  subtask: (summary) => `Sub-task: ${summary}`,
  minions: { crash: "Crash report without a stack trace", null: "Cannot read properties of null", frame: (depth) => `at recurse (index.js:${depth})` },
  calls: {
    meetTitles: [
      "Quick sync (5 min)",
      "Alignment on the alignment",
      "Call to understand the requirements",
      "Daily (but at 5:30 pm)",
      "Brainstorming, cameras on please",
      "Just one quick question"
    ],
    meetInvite: (title, seconds) => `📹 Got five minutes? I'm in the Meet "${title}", join the room (${seconds}s)`,
    slackThreads: [
      ["hi", "got a sec?", "…"],
      ["hey", "quick question", "📎 screenshot.png"],
      ["you there?", "hello?", "nvm, solved"],
      ["urgent!!", "actually not urgent", "but quick"],
      ["👀", "did you see my email?", "the other one too"]
    ],
    slackInvite: (seconds) => `💬 I wrote you on Slack, go read it (${seconds}s)`,
    outcomes: {
      meet: {
        answered: ["Great call, let's do another one tomorrow.", "Perfect, I'll send the minutes."],
        missed: ["Ok, I'll record it for you.", "We started without you."]
      },
      slack: {
        answered: ["Thanks for the quick reply!", "Seen ✔✔"],
        missed: ["Fine, I'll write to your boss then.", "Sent you an email too."]
      }
    },
    kinds: { meet: "📹 Meet", slack: "💬 Slack" },
    bonus: "BONUS CALL",
    meetProgress: (seconds, goal) => `in the meeting ${seconds}/${goal}s`,
    slackProgress: (read, goal) => `read ${read}/${goal}`,
    room: "MEET",
    answered: (points) => `+${points} call answered`
  },
  bossPhase: {
    dispenserRestart: "timeout... restarting",
    otp: "Enter your OTP code",
    conflict: "CONFLICT: ours vs theirs",
    halfResolved: "one side resolved, one to go",
    threadDown: "one thread down: fix the other, fast",
    faster: "GOTO 10: one more lap, faster",
    frameDropped: "a frame popped off the stack: catch it first",
    restarted: "race lost: the thread restarted"
  },

  traits: {
    armored: "BLOCKED: takes half damage",
    reopens: "IN QA: may reopen",
    jittery: "IN DEVELOPMENT: moves erratically",
    deploying: "DEPLOYING: stops next to you and blows up",
    plain: ""
  },
  ticketTypes: {
    bug: { label: "Bug", hint: "" },
    story: { label: "Story", hint: "STORY: splits into 2 sub-tasks" },
    subtask: { label: "Sub-task", hint: "SUB-TASK: small and fast" },
    epic: { label: "Epic", hint: "EPIC: a nest of sub-tasks, the wave waits until it is closed" }
  },
  taglines: {
    glacier: "A cold start: everything is Ready for QA, nothing is really done.",
    sidequests: "Seven small projects, seven big clients.",
    keystone: "Permissions, SSO and CVEs. Did somebody say 2FA?",
    foundry: "The biggest backlog. Ugo is online.",
    monorepo: "One repo for everything, and everyone on it. Fabrizio says +1.",
    microservices: "Forty services, one bug in each. Debora wants it more pop by Friday.",
    legacy: "A green screen, COBOL and a loop nobody dares to touch. Harder than ever.",
    production: "It's live, it's Friday, and the stack is overflowing. The last sprint, and the hardest.",
    endless: "Every bug from every project, forever. How long can you last?",
    hotdesk: "No assigned desks and no elbow room. The 2FA boss has booked the meeting room.",
    cubicles: "An open space cut into cubicles: walls stop your shots and theirs. The crash boss reboots behind every one."
  },
  pickups: {
    hotfix: { label: "Hotfix", hint: "rapid fire" },
    refactor: { label: "Refactor", hint: "spread shot" },
    coffee: { label: "Coffee", hint: "speed" },
    unitTest: { label: "Green tests", hint: "invulnerable" },
    revert: { label: "git reset", hint: "+1 bomb" },
    pizza: { label: "Pizza", hint: "+2 sanity" },
    tools: { label: "Tools", hint: "homing shots" },
    ai: { label: "AI", hint: "auto turret" },
    pairProgramming: { label: "Pair programming", hint: "two shots at once" },
    codeFreeze: { label: "Code freeze", hint: "hits freeze" },
    memoryLeak: { label: "Memory leak", hint: "hits poison" },
    pushForce: { label: "git push --force", hint: "a rocket: boom where you aim" },
    flameWar: { label: "Flame war", hint: "a cone of fire: this is fine 🔥" },
    breakpoint: { label: "Breakpoint", hint: "+1 trap" }
  },
  floorCode: [
    "console.log('does it get here?')",
    "// don't touch, it works",
    "throw new Error('impossible')",
    "// FIXME: Ugo says urgent"
  ],
  hud: {
    sanity: "SANITY",
    backlog: (open, wave) => `BACKLOG: ${open} open bugs · wave ${wave}`,
    hints: [
      "WASD / arrows  move",
      "Mouse          aim and shoot (hold)",
      "Space          dash",
      "Q / right btn  git reset --hard",
      "F / middle btn breakpoint",
      "P / Esc        pause    ·    M  audio"
    ],
    breakpoints: "BREAKPOINTS  [F]",
    breakpointHit: "BREAKPOINT HIT",
    touchHints: ["left thumb    move", "right thumb   aim and shoot", "hold it still shoots the nearest bug"],
    bossFixed: "BOSS FIXED",
    movedToDone: (key) => `${key} moved to Done`,
    reopenedSub: (key) => `${key} failed QA`,
    deployed: "DEPLOYED",
    deployedSub: "straight to production",
    resurrected: (key) => `🧟 ${key} RESURRECTED`,
    resurrectedSub: (name) => `${name} says it's not fixed`,
    testsPassing: "✓ tests passing",
    booting: "⏳ booting...",
    factor: "FACTOR 2/2",
    sides: { ours: "<<<<<<< ours", theirs: ">>>>>>> theirs" },
    threads: { main: "thread: main", worker: "thread: worker" },
    lap: (lap) => `LAP ${lap}`,
    depth: (frames) => `STACK DEPTH ${frames}`,
    stackGuard: "🧱 close the dropped frames first",
    restarting: (seconds) => `⟳ restarting in ${seconds.toFixed(1)}s`,
    startBanner: "Close the backlog before the client shows up",
    audioOn: "🔊 AUDIO ON",
    audioOff: "🔇 AUDIO OFF",
    endless: (wave, bossIn) => `ENDLESS · wave ${wave} · ${bossIn > 0 ? `boss in ${bossIn} waves` : "boss incoming"}`,
    nextRound: (round) => `ROUND ${round}`,
    nextRoundSub: "The backlog refills. Meaner.",
    burnout: "BURNOUT",
    hallucination: "🤖 hallucination",
    youAreDown: "Burnout: a teammate has to stand next to you",
    teammateDown: (name) => `🔥 ${name} burned out`,
    teammateDownSub: "stand next to them to bring them back",
    revived: (name) => `${name} is back`
  },
  chat: {
    channel: "#urgent-clients",
    members: (n) => `${n} members`,
    mission: "MISSION",
    kinds: {
      killCount: "Close N bugs",
      killTarget: "Blocker ticket",
      noHit: "Live demo",
      combo: "Combo",
      priorityHunt: "Priority hunt"
    },
    noHit: (progress, goal) => `🙈 no hits: ${progress}/${goal}s`,
    combo: (progress, goal) => `⚡ best combo ${progress}/${goal}`,
    killCount: (progress, goal) => `🐞 ${progress}/${goal} bugs closed`
  },
  menu: {
    subtitle: "The backlog won't close itself.",
    openBugs: (n) => `${n} open bugs · one boss`,
    locked: "🔒 close the previous sprint",
    best: (score) => `best ${score} SP`,
    fresh: "new",
    controls: "WASD move · mouse aim and shoot · Space dash · Q <code>git reset --hard</code> · F breakpoint · P pause · M audio",
    touchControls: "Left thumb move · right thumb aim and shoot (held still: hits the nearest bug) · DASH · ⏪ <code>git reset --hard</code> · 🔴 breakpoint",
    disclaimer: "Any resemblance to real clients is entirely intentional.",
    language: "Language",
    endless: (every) => `∞ every open bug · a boss every ${every} waves`,
    campaign: "Campaign",
    campaignProgress: (cleared, total) => `${cleared}/${total} sprints closed`,
    extras: "More modes",
    bonus: "Bonus levels",
    bonusTag: "BONUS",
    bonusMeta: (tickets) => `${tickets} tickets from every project · one boss`,
    bonusLocked: (sprint) => `🔒 close sprint ${sprint}`
  },
  intro: { clientsOnline: "clients online", start: "Click or press any key to start", startTouch: "Tap to start" },
  touch: {
    dash: "DASH",
    breakpoint: "Breakpoint",
    rotate: "Turn your phone sideways: the backlog is wide.",
    fullscreen: "Fullscreen",
    homeScreen: "To play fullscreen: Share → Add to Home Screen."
  },
  pause: {
    title: "☕ Coffee break",
    body: "The backlog will wait. The clients won't.",
    resume: "Resume",
    restart: "Restart sprint",
    menu: "Menu"
  },
  stats: {
    points: "story points",
    closed: "tickets closed",
    bestCombo: "best combo",
    missions: "client missions",
    breakdowns: "nervous breakdowns",
    calls: "calls answered"
  },
  notes: {
    title: "📦 Release notes",
    scopeCreep: (n) => `+ ${n} extra client ${n === 1 ? "request" : "requests"} handled "on the fly"`,
    subtasks: (n) => `+ ${n} ${n === 1 ? "sub-task" : "sub-tasks"}`,
    resurrections: (n) => `🧟 ${n} ${n === 1 ? "bug" : "bugs"} "not fixed yet" according to the clients (and fixed again)`
  },
  cleared: {
    allTitle: "🏆 INBOX ZERO",
    allBody: "You closed every sprint. The board is empty for the first time in history.",
    ugoFinal: "THANK YOU SO MUCH!!!! NOW I HAVE A SMALL REQUEST FOR MONDAY MORNING!!!!!!",
    title: "✅ Sprint closed!",
    body: (name) => `${name} is in production. For now.`,
    next: "Next sprint →",
    copy: "📋 Copy release notes",
    copied: "✔ Copied",
    replay: "Play again"
  },
  dead: {
    lines: [
      "You burned out.",
      "You shut the laptop and became a farmer.",
      "The bug won. The client called your boss.",
      "You're on call. Forever."
    ],
    stillOpen: "Bugs still open:",
    bossStillThere: (key) => `boss <b>${key}</b> is still there`,
    endless: (waves, bosses) => `You lasted ${waves} waves and fixed ${bosses} bosses.`,
    record: "🏅 New record!",
    retry: "Try again"
  },
  errors: { runtime: "The runtime won't start", crashed: "The game crashed (ironic)", reload: "Reload" },
  multi: {
    menuButton: "👥 Play together",
    cardTagline: "Up to 4 developers on the same backlog, each with their own name.",
    cardMeta: "create a run or join one with a code",
    title: "👥 Play together",
    body: "Up to 4 developers on the same backlog. Create a run and share the code, or join a teammate's.",
    name: "Your name",
    namePlaceholder: "how the team sees you",
    level: "Sprint",
    create: "Create a run",
    code: "Run code",
    join: "Join",
    back: "Back",
    lobby: (code) => `Run ${code}`,
    share: "Send your teammates the link, or read them the code.",
    copyLink: "📋 Copy link",
    copied: "✔ Copied",
    host: "host",
    you: "you",
    offline: "offline",
    start: "Start the sprint",
    waiting: (host) => `Waiting for ${host} to start…`,
    leave: "Leave the run",
    team: "Team",
    playAgain: "Play again",
    connecting: "Connecting…",
    lost: "Connection to the run lost.",
    unreachable: "The run server is not answering: try again later.",
    pauseBody: "The run goes on without you: the bugs don't take breaks.",
    errors: {
      notFound: "No run with that code.",
      full: "That run is full (4 developers).",
      started: "That run has already started: wait for the next one.",
      nameTaken: "Somebody in that run already has that name.",
      badName: "Pick a name first.",
      badLevel: "That sprint doesn't exist.",
      notHost: "Only the host can start.",
      busy: "Too many runs open right now: try again in a bit, or play solo."
    }
  },
  hardcore: {
    name: "Hardcore",
    rules: "1 sanity · no Pizza · back on your feet with 1",
    on: "on",
    off: "off",
    hud: "HARDCORE",
    badge: "Cleared in hardcore",
    run: "☠ Hardcore run"
  },
  arena: {
    label: "Arena",
    names: { normal: "Normal", small: "Small", walls: "Walls" },
    locked: (bonus) => `🔒 opens with ${bonus}`
  }
}
