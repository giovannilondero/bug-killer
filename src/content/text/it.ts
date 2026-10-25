import type { Strings } from "../i18n.ts"
import { morePop, plusOne, shout } from "./voice.ts"

export const it: Strings = {
  tag: "it-IT",
  languageName: "Italiano",

  people: {
    ugo: { role: "Cliente (urgentissimo)", laugh: "AHAHAHAHAHAH", voice: shout },
    ornella: {
      role: "Responsabile Qualità",
      laugh: "Ah. Ah.",
      voice: (text) => `Buongiorno, come da mail precedente (rimasta senza risposta): ${text} Cordiali saluti.`
    },
    kevin: {
      role: "Product Owner",
      laugh: "ahahahah 😂😂",
      voice: (text, pick) => `Ciao! Ti ho mandato un vocale di ${4 + pick(9)} minuti, in sintesi: ${text} 👍`
    },
    samanta: {
      role: "Project Manager",
      laugh: "ahahah dai",
      voice: (text) => `Già che ci sei, una cosina veloce veloce: ${text} Dovrebbe essere un attimo, no?`
    },
    gualtiero: {
      role: "IT del cliente",
      laugh: "lol",
      voice: (text) => `Guarda che in staging funzionava eh. Comunque: ${text}`
    },
    tobia: { role: "Tech Lead", laugh: "ahah", voice: (text) => text },
    fabrizio: { role: "Stakeholder (in copia a tutto)", laugh: "+1", voice: plusOne },
    debora: { role: "Marketing", laugh: "ahah top ✨", voice: morePop("Si può fare un po' più pop? Per venerdì, idealmente ✨", "E un po' più pop, grazie. È per venerdì 🎨", "Bellissimo, deve solo essere più pop. Venerdì? 💥") }
  },

  tobiaLines: [
    "stai usando gli _strumenti_??",
    "ma gli _strumenti_ li hai provati?",
    "con gli _strumenti_ questo lo chiudevi in cinque minuti eh",
    "hai chiesto agli _strumenti_ prima di metterti a sparare a mano?",
    "ti lascio gli _strumenti_ qui, poi mi dici"
  ],
  resurrectLine: (key, laugh) => `Il ${key} non è ancora fixato. ${laugh} Lavora più duramente.`,
  outcomes: {
    ugo: {
      success: ["OK", "FINALMENTE", "VA BENE MA LA PROSSIMA VOLTA PIÙ VELOCE", "PERFETTO ORA NE HO UN'ALTRA"],
      failure: ["HO CHIAMATO IL TUO CAPO", "INACCETTABILE", "IL CLIENTE DEL MIO CLIENTE È FURIOSO", "APRO UN TICKET SUL TICKET"]
    },
    ornella: {
      success: ["Prendo atto. Lo segnalo nel verbale.", "Bene. Allego il documento firmato."],
      failure: ["Lo metto per iscritto.", "Metto in copia la direzione."]
    },
    kevin: {
      success: ["Top!! Lo mostro subito in demo 🚀", "Grande, aggiorno la roadmap"],
      failure: ["Mmh, ne parliamo alla retro 😅", "Ok, sposto tutto al prossimo sprint"]
    },
    samanta: {
      success: ["Perfetto! Allora già che ci siamo...", "Ottimo, metto il ticket in Done"],
      failure: ["Ok, ho aggiunto 3 bug al backlog per sicurezza", "Va beh, apro una change request"]
    },
    gualtiero: {
      success: ["Ah ok, adesso va. Era la cache comunque.", "Funziona. Strano però."],
      failure: ["Visto? Lo dicevo io.", "Da noi non si riproduce, sarà la vostra rete."]
    },
    tobia: {
      success: ["visto? con gli _strumenti_ è un attimo"],
      failure: ["ok ma la prossima volta usa gli _strumenti_"]
    },
    fabrizio: { success: ["+1"], failure: ["up"] },
    debora: {
      success: ["Top!! Ora si può fare il logo più grande? 💖", "Perfetto, lo posto subito su LinkedIn ✨"],
      failure: ["Mmh, non è abbastanza pop. Ne parliamo venerdì.", "Rimandiamo il lancio, di nuovo. E il font è ancora triste."]
    }
  },
  missions: {
    killCount: (goal, seconds) => `Mi servono ${goal} bug chiusi entro ${seconds} secondi.`,
    killTarget: (key, summary, seconds) => `Il ${key} ("${summary}") è bloccante. Chiudilo entro ${seconds} secondi.`,
    noHit: (seconds) => `Sto facendo una demo al cliente finale: non prendere colpi per ${seconds} secondi.`,
    combo: (goal) => `Voglio vedere ritmo: fai una combo da ${goal} bug di fila.`,
    priorityHunt: (goal, priority) => `Chiudi ${goal} bug con priorità ${priority}, il resto può aspettare.`
  },
  scopeCreep: [
    "Il bottone è troppo blu",
    "Si può fare il logo più grande?",
    "Non funziona (nessuno screenshot allegato)",
    "Urgente: vedi oggetto",
    "Su Internet Explorer non si vede bene",
    "Il cliente vuole l'export in Excel",
    "Aggiungere dark mode entro stasera",
    "La pagina è lenta (non specificato quale)",
    "Ripristinare la funzionalità che avevamo tolto su richiesta",
    "Mancano i dati (quali dati?)"
  ],
  regression: (key) => `Regressione introdotta dal fix di ${key}`,
  subtask: (summary) => `Sotto-task: ${summary}`,
  minions: { crash: "Crash report senza stack trace", null: "Cannot read properties of null" },
  calls: {
    meetTitles: [
      "Sync veloce (5 min)",
      "Allineamento sull'allineamento",
      "Call per capire i requisiti",
      "Daily (ma alle 17:30)",
      "Brainstorming, telecamere accese grazie",
      "Solo una domanda veloce"
    ],
    meetInvite: (title, seconds) => `📹 Hai cinque minuti? Sono nel Meet "${title}", entra nella stanza (${seconds}s)`,
    slackThreads: [
      ["ciao", "hai un attimo?", "…"],
      ["ehi", "domanda veloce", "📎 screenshot.png"],
      ["ci sei?", "pronto?", "no niente, risolto"],
      ["urgente!!", "anzi non urgente", "però veloce"],
      ["👀", "hai visto la mail?", "anche l'altra"]
    ],
    slackInvite: (seconds) => `💬 Ti ho scritto su Slack, vai a leggere (${seconds}s)`,
    outcomes: {
      meet: {
        answered: ["Ottima call, facciamone un'altra domani.", "Perfetto, mando io il verbale."],
        missed: ["Ok, te la registro.", "Abbiamo iniziato senza di te."]
      },
      slack: {
        answered: ["Grazie della risposta veloce!", "Visualizzato ✔✔"],
        missed: ["Va bene, scrivo al tuo capo allora.", "Ti ho mandato anche una mail."]
      }
    },
    kinds: { meet: "📹 Meet", slack: "💬 Slack" },
    bonus: "CALL BONUS",
    meetProgress: (seconds, goal) => `in riunione ${seconds}/${goal}s`,
    slackProgress: (read, goal) => `letti ${read}/${goal}`,
    room: "MEET",
    answered: (points) => `+${points} call risposta`
  },
  bossPhase: {
    dispenserRestart: "timeout... si riparte",
    otp: "Inserisci il codice OTP",
    conflict: "CONFLITTO: nostri contro loro",
    halfResolved: "un lato risolto, manca l'altro",
    threadDown: "un thread giù: chiudi l'altro, svelto",
    faster: "GOTO 10: un altro giro, più veloce",
    restarted: "race persa: il thread è ripartito"
  },

  traits: {
    armored: "BLOCCATO: dimezza i danni",
    reopens: "IN QA: può riaprirsi",
    jittery: "IN SVILUPPO: si muove a scatti",
    deploying: "IN DEPLOY: si ferma accanto a te ed esplode",
    plain: ""
  },
  ticketTypes: {
    bug: { label: "Bug", hint: "" },
    story: { label: "Story", hint: "STORY: si divide in 2 sotto-task" },
    subtask: { label: "Sotto-task", hint: "SOTTO-TASK: piccolo e veloce" },
    epic: { label: "Epic", hint: "EPIC: un nido di sotto-task, l'ondata aspetta che sia chiusa" }
  },
  taglines: {
    glacier: "Si parte col freddo: tutto in Ready for QA, niente è davvero finito.",
    sidequests: "Sette progetti piccoli, sette clienti grandi.",
    keystone: "Permessi, SSO e CVE. Qualcuno ha detto 2FA?",
    foundry: "Il backlog più grande. Ugo è online.",
    monorepo: "Un solo repo per tutto, e tutti dentro. Fabrizio mette +1.",
    microservices: "Quaranta servizi, un bug in ognuno. Debora lo vuole più pop entro venerdì.",
    legacy: "Schermo verde, COBOL e un loop che nessuno osa toccare. Più dura che mai.",
    endless: "Tutti i bug di tutti i progetti, per sempre. Quanto resisti?"
  },
  pickups: {
    hotfix: { label: "Hotfix", hint: "fuoco rapido" },
    refactor: { label: "Refactor", hint: "colpi multipli" },
    coffee: { label: "Caffè", hint: "velocità" },
    unitTest: { label: "Test verdi", hint: "invulnerabile" },
    revert: { label: "git reset", hint: "+1 bomba" },
    pizza: { label: "Pizza", hint: "+2 sanità" },
    tools: { label: "Strumenti", hint: "colpi a ricerca" },
    ai: { label: "AI", hint: "torretta automatica" },
    pairProgramming: { label: "Pair programming", hint: "due colpi alla volta" },
    codeFreeze: { label: "Code freeze", hint: "i colpi congelano" },
    memoryLeak: { label: "Memory leak", hint: "i colpi avvelenano" },
    pushForce: { label: "git push --force", hint: "un razzo: boom dove miri" },
    flameWar: { label: "Flame war", hint: "un cono di fuoco: this is fine 🔥" },
    breakpoint: { label: "Breakpoint", hint: "+1 trappola" }
  },
  floorCode: [
    "console.log('qui ci arriva?')",
    "// non toccare, funziona",
    "throw new Error('impossibile')",
    "// FIXME: Ugo dice urgente"
  ],
  hud: {
    sanity: "SANITÀ MENTALE",
    backlog: (open, wave) => `BACKLOG: ${open} bug aperti · ondata ${wave}`,
    hints: [
      "WASD / frecce  muoviti",
      "Mouse          mira e spara (tieni premuto)",
      "Spazio         dash",
      "Q / tasto dx   git reset --hard",
      "F / rotellina  breakpoint",
      "P / Esc        pausa    ·    M  audio"
    ],
    breakpoints: "BREAKPOINT  [F]",
    breakpointHit: "BREAKPOINT RAGGIUNTO",
    touchHints: ["pollice sinistro   muoviti", "pollice destro     mira e spara", "tienilo fermo      spara al bug più vicino"],
    bossFixed: "BOSS FIXATO",
    movedToDone: (key) => `${key} spostato in Done`,
    reopenedSub: (key) => `${key} non passa la QA`,
    deployed: "DEPLOYATO",
    deployedSub: "dritto in produzione",
    resurrected: (key) => `🧟 ${key} RESUSCITATO`,
    resurrectedSub: (name) => `${name} dice che non è fixato`,
    testsPassing: "✓ test verdi",
    booting: "⏳ riavvio...",
    factor: "FATTORE 2/2",
    sides: { ours: "<<<<<<< nostri", theirs: ">>>>>>> loro" },
    threads: { main: "thread: main", worker: "thread: worker" },
    lap: (lap) => `GIRO ${lap}`,
    restarting: (seconds) => `⟳ riavvio tra ${seconds.toFixed(1)}s`,
    startBanner: "Chiudi il backlog prima che arrivi il cliente",
    audioOn: "🔊 AUDIO ON",
    audioOff: "🔇 AUDIO OFF",
    endless: (wave, bossIn) => `ENDLESS · ondata ${wave} · ${bossIn > 0 ? `boss tra ${bossIn} ondate` : "boss in arrivo"}`,
    nextRound: (round) => `ROUND ${round}`,
    nextRoundSub: "Il backlog si riempie. Più cattivo.",
    burnout: "BURNOUT",
    hallucination: "🤖 allucinazione",
    youAreDown: "Burnout: serve un collega vicino a te",
    teammateDown: (name) => `🔥 ${name} è in burnout`,
    teammateDownSub: "stagli vicino per rimetterlo in piedi",
    revived: (name) => `${name} è tornato`
  },
  chat: {
    channel: "#clienti-urgenti",
    members: (n) => `${n} membri`,
    mission: "MISSIONE",
    kinds: {
      killCount: "Chiudi N bug",
      killTarget: "Ticket bloccante",
      noHit: "Demo in corso",
      combo: "Combo",
      priorityHunt: "Caccia per priorità"
    },
    noHit: (progress, goal) => `🙈 nessun colpo: ${progress}/${goal}s`,
    combo: (progress, goal) => `⚡ miglior combo ${progress}/${goal}`,
    killCount: (progress, goal) => `🐞 ${progress}/${goal} bug chiusi`
  },
  menu: {
    subtitle: "Il backlog non si chiude da solo.",
    openBugs: (n) => `${n} bug aperti · un boss`,
    locked: "🔒 chiudi lo sprint precedente",
    best: (score) => `record ${score} SP`,
    fresh: "nuovo",
    controls: "WASD muoviti · mouse mira e spara · Spazio dash · Q <code>git reset --hard</code> · F breakpoint · P pausa · M audio",
    touchControls: "Pollice sinistro muoviti · pollice destro mira e spara (fermo: colpisce il bug più vicino) · DASH · ⏪ <code>git reset --hard</code> · 🔴 breakpoint",
    disclaimer: "Ogni somiglianza con clienti reali è puramente intenzionale.",
    language: "Lingua",
    endless: (every) => `∞ tutti i bug aperti · un boss ogni ${every} ondate`,
    campaign: "Campagna",
    campaignProgress: (cleared, total) => `${cleared}/${total} sprint chiusi`,
    extras: "Altre modalità"
  },
  intro: { clientsOnline: "clienti online", start: "Clicca o premi un tasto per iniziare", startTouch: "Tocca per iniziare" },
  touch: {
    dash: "DASH",
    breakpoint: "Breakpoint",
    rotate: "Gira il telefono in orizzontale: il backlog è largo.",
    fullscreen: "Schermo intero",
    homeScreen: "Per giocare a schermo intero: Condividi → Aggiungi alla schermata Home."
  },
  pause: {
    title: "☕ Pausa caffè",
    body: "Il backlog ti aspetta. I clienti no.",
    resume: "Riprendi",
    restart: "Ricomincia sprint",
    menu: "Menu"
  },
  stats: {
    points: "story points",
    closed: "ticket chiusi",
    bestCombo: "combo massima",
    missions: "missioni clienti",
    breakdowns: "crisi di nervi",
    calls: "call risposte"
  },
  notes: {
    title: "📦 Release notes",
    scopeCreep: (n) => (n === 1 ? `+ 1 richiesta extra dei clienti gestita "al volo"` : `+ ${n} richieste extra dei clienti gestite "al volo"`),
    subtasks: (n) => `+ ${n} sotto-task`,
    resurrections: (n) => (n === 1 ? `🧟 1 bug "non ancora fixato" secondo i clienti (e rifixato)` : `🧟 ${n} bug "non ancora fixati" secondo i clienti (e rifixati)`)
  },
  cleared: {
    allTitle: "🏆 INBOX ZERO",
    allBody: "Hai chiuso tutti gli sprint. Il board è vuoto per la prima volta nella storia.",
    ugoFinal: "GRAZIE MILLE!!!! ORA PERÒ AVREI UNA PICCOLA RICHIESTA PER LUNEDÌ MATTINA!!!!!!",
    title: "✅ Sprint chiuso!",
    body: (name) => `${name} è in produzione. Per ora.`,
    next: "Sprint successivo →",
    copy: "📋 Copia release notes",
    copied: "✔ Copiate",
    replay: "Rigioca"
  },
  dead: {
    lines: [
      "Sei andato in burnout.",
      "Hai chiuso il portatile e sei andato a fare il contadino.",
      "Il bug ha vinto. Il cliente ha chiamato il tuo capo.",
      "Ti hanno messo in reperibilità per sempre."
    ],
    stillOpen: "Bug ancora aperti:",
    bossStillThere: (key) => `il boss <b>${key}</b> è ancora lì`,
    endless: (waves, bosses) => `Hai resistito ${waves} ondate e risolto ${bosses} boss.`,
    record: "🏅 Nuovo record!",
    retry: "Riprova"
  },
  errors: { runtime: "Il runtime non parte", crashed: "Il gioco è crashato (ironico)", reload: "Ricarica" },
  multi: {
    menuButton: "👥 Gioca in squadra",
    cardTagline: "Fino a 4 sviluppatori sullo stesso backlog, ognuno col suo nome.",
    cardMeta: "crea una run o entra con un codice",
    title: "👥 Gioca in squadra",
    body: "Fino a 4 sviluppatori sullo stesso backlog. Crea una run e condividi il codice, oppure entra in quella di un collega.",
    name: "Il tuo nome",
    namePlaceholder: "come ti vede il team",
    level: "Sprint",
    create: "Crea una run",
    code: "Codice della run",
    join: "Entra",
    back: "Indietro",
    lobby: (code) => `Run ${code}`,
    share: "Manda il link ai colleghi, o dettagli il codice.",
    copyLink: "📋 Copia link",
    copied: "✔ Copiato",
    host: "host",
    you: "tu",
    offline: "offline",
    start: "Inizia lo sprint",
    waiting: (host) => `In attesa che ${host} inizi…`,
    leave: "Esci dalla run",
    team: "Team",
    playAgain: "Rigioca",
    connecting: "Connessione…",
    lost: "Connessione alla run persa.",
    unreachable: "Il server delle run non risponde: riprova più tardi.",
    pauseBody: "La run continua senza di te: i bug non fanno pause.",
    errors: {
      notFound: "Nessuna run con questo codice.",
      full: "Questa run è piena (4 sviluppatori).",
      started: "Questa run è già iniziata: aspetta la prossima.",
      nameTaken: "Qualcuno in questa run ha già questo nome.",
      badName: "Prima scegli un nome.",
      badLevel: "Questo sprint non esiste.",
      notHost: "Solo l'host può iniziare.",
      busy: "Troppe run aperte in questo momento: riprova tra poco, o gioca da solo."
    }
  }
}
