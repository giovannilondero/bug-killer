# Can Sound lab and Music lab reproduce Bugkiller's 8-bit sound?

Research for #48. Researched on 2026-10-29 against `@typeonce/ritmo-tools` 0.19.1, `@typeonce/ritmo` 0.19.1 (bundled skills), `howler` 2.2.4 and `@pixi/sound` 6.0.1, all unpacked with `npm pack`. I also rendered six of our SFX and the in-game loop with the real CLI and encoded them with ffmpeg (see [Experiment](#experiment)).

## Short answer

- **SFX: yes, closely.** Sound lab's `tone` and `noise` layers use the same building blocks as `src/host/audio.ts`: Web Audio–style exponential frequency and gain ramps, RBJ biquad filters with `q` in dB like `BiquadFilterNode`, and square/saw/triangle/sine waves. Every sound in `audio.ts` converts to a recipe one-to-one. Two small differences need correcting (decay floor and attack, below). What we lose is parameters at play time: `kill(combo)` changes pitch per combo, so it needs one file per pitch or Howler `rate`, which changes length as well as pitch.
- **Music: close, not identical.** Music lab has `chipLead` (a 25% pulse with light vibrato) and `chipBass` (a 4-bit stepped triangle). It has no 12.5% or 50% pulse and no NES-style noise kit, so our arpeggio (12.5%), the calm lead (50%) and the noise drums all become the 25% lead or the clean `drums` kit. I transcribed the `sprint` loop and it renders clean (`music check`: verdict clean, 12.63 s, peak −7.9 dBFS) as a seamless-loop WAV plus MIDI.
- **Cost.** Today the audio costs 0 bytes of assets. With Ritmo it would be about **0.6 MB per format** (≈130–170 KB of SFX plus ≈450–470 KB for three loops), Howler (≈8 KB gzip), and a render-and-encode step for every new or changed sound.
- **Boss "speed-up".** In our code the boss music is a separate song (`boss`, D minor, 168 bpm), not the `sprint` loop played faster. With files it becomes a switch between two looping Howls, which works well. Speeding up one file with Howler `rate` would also raise its pitch (details below).

## What we have today (counted in the code)

- `src/host/audio.ts`: **25 sound methods**, which come to **30 distinct sounds** once the variants are counted (`shoot` × 4 weapons, `chat` angry/calm, `ring` meet/slack). Two of them are parameterised at runtime: `kill(combo)` (pitch rises a semitone per combo, up to 24) and `laugh(loud)` (volume only). The noise uses `Math.random()`, so it differs slightly on every play. `shoot` has a hard-coded 50 ms minimum gap, which is the same idea as Ritmo's `interval`. There is no ducking anywhere, so nothing in the code corresponds to `heavy`.
- `src/host/music.ts`: **3 tracks**, not 2:
  - `menu`: 92 bpm, 8 bars, ≈20.9 s
  - `sprint`: 152 bpm, 8 bars, 12.63 s
  - `boss`: 168 bpm, 4 bars, ≈5.7 s

  They are played by a lookahead step sequencer. The voices are a lead (25% pulse, or 50% when calm), an arpeggio (12.5% pulse), a triangle bass and noise/sine drums. `src/main.ts:182-183` picks `menu`, `sprint` or `boss` by game phase. `stop()` keeps the step position, so pause resumes where it left off, and `rewind()` restarts a run from the top. Mute sets the master gain to 0.

## Sound lab: can it make our SFX?

Source: `tools/package/README.md` § Sound lab, `dist/sound/core/recipe.d.ts`, `dist/sound/core/render.js`, `dist/sound/core/wav.js`.

| Ours (`audio.ts`) | Sound lab | Match |
| --- | --- | --- |
| `tone(freq, dur, {type, volume, slide, delay})`: `OscillatorNode`, `exponentialRampToValueAtTime` on frequency and gain | `tone` layer: `wave`, `from`, `to`, `duration`, `gain`, `delay`, `attack`; `ramp()` is "as Web Audio's `exponentialRampToValueAtTime`" | Same model. `slide` becomes `to = max(30, from·slide)` |
| `noise(dur, vol, from, to)`: white noise → lowpass (default Q = 1) with exponential cutoff glide | `noise` layer: `filter: "lowpass"`, `from`, `to`, `q` (dB for lowpass, "as Web Audio's BiquadFilterNode") | Same, with `q: 1` |
| Square/saw from `OscillatorNode` (band-limited) | Naive waves with PolyBLEP correction | Practically the same |
| Gain jumps to `volume` at t = 0 | `attack` minimum 0.5 ms (default 6 ms for tone, 4 ms for noise; `recipe.js` l.79/91) | Set `attack: 0.0005`. Slightly softer onset, arguably better (no click) |
| Gain decays to **0.001** absolute | Envelope decays to **0.0001** absolute (`FLOOR`) | **Differs.** A quiet sound like `shoot` (0.04 → 0.001, 1.6 decades) dies over 2.6 decades in the same time, so it sounds shorter. Multiply `duration` by about log(gain/0.0001)/log(gain/0.001) to match (for `shoot`, 0.05 s → ≈0.08 s) |
| `Math.random()` noise, different on every play | Seeded noise, the same bits on every play | Small loss of variety. You could render 2–3 takes and pick one at random |
| `kill(combo)`, `laugh(loud)`, `chat(angry)`, `ring(kind)`, `shoot(weapon)` | One recipe = one file | Variants become separate recipes. `kill` needs up to 25 files, or Howler `rate(2^(c/12))`, which also shortens it (up to ×4 at combo 24) |

Extras we do not have today: `swish`, `crunch`, `metal` and `click` layers, `reverb` (a convolution room), the `tune` sliders, `sound vary --toward heavier` takes, and `sound check` loudness comparison by kind.

Output (from `render.js` and `wav.js`): **mono 16-bit PCM WAV at 44.1 kHz**, trimmed at −80 dBFS, with the bank's `master` applied. The CLI and the review page only write WAV. Encoding to OGG/MP3 is our job, as the guidelines say (`sintesi-stack-web.md` § Audio step 3).

## Music lab: can it make our loops?

Source: README § Music lab, `dist/music/core/instruments.js` l.20-21 and 312-335, `dist/music/core/render.js`.

- **Format fit.** A song is `tempo`, `key`, `bars`, and tracks of `{at, length, pitch, velocity}` in beats. Our 16th-note grids, holds and arpeggios translate mechanically. I wrote a 40-line script that converted `sprint` from `music.ts`.
- **Timbres:**
  - `chipLead`: "pulse wave, a quarter wide, with a light vibrato". It matches our 25% lead, apart from vibrato we do not have.
  - `chipBass`: "stepped triangle … sixteen steps, as the old console's 4-bit wave". This is more NES-like than our smooth `"triangle"`.
  - **Missing:** a 12.5% pulse (our arpeggio), a 50% pulse (the menu lead), and a noise-channel drum kit. The `drums` kit is a clean synthesized kit: kick 160→48 Hz sine sweep (ours is 160→40), snare = 260→185 Hz tone plus highpass noise (ours is highpass noise only), hat = 9 kHz noise burst (ours is a 7 kHz highpass). It is in the same family but sounds less "NES". The duty cycle and vibrato are hard-coded, with no field to change them.
- **Tempo** is one number per song (`song.d.ts`), with no tempo changes inside a song. That fits us, because each of our tracks has a fixed bpm.
- **Seamless loop.** `loop` is true by default. The WAV is exactly one pass long, and "what rings past its end … [is] folded back over its start" (`render.js` header and l.178-184). Verified: `sprint` came out at 12.63 s, exactly 32 beats at 152 bpm.
- **Output:** a **stereo 16-bit 44.1 kHz WAV**, a MIDI file, and with `--stems` one WAV per track. The review page also downloads MIDI and WAV. There is no OGG/MP3 output.
- **Stems** would let us layer tracks (for example bring the drums in for the boss), but every stem is full length and stereo, so each one costs as much as the full mix (table below).

## Experiment

These ran in `/tmp`, not in the repo, with `npx @typeonce/ritmo-tools@0.19.1`. I converted `shoot` (gun), `kill` (combo 0), `hurt`, `pickup`, `bomb` and `bossDown` into a bank (`master: 0.35`, our master gain). `sound check` gave **verdict clean**, with no clipping or late start. `sound render` wrote the WAVs. I transcribed `sprint` into a 4-track song (chipLead lead, chipLead arpeggio, chipBass, drums). `music check` gave clean; `music render --stems` wrote the WAV, the MIDI and 4 stems. I then encoded everything with ffmpeg 8 (libopus in Ogg, libmp3lame). This build of ffmpeg has no libvorbis, so I measured Ogg **Opus** rather than Ogg Vorbis.

| File | WAV | Ogg Opus 64k | Ogg Opus 48k | MP3 96k | MP3 128k |
| --- | ---: | ---: | ---: | ---: | ---: |
| shoot | 3.7 KB | 1.0 KB | 0.5 KB | 1.3 KB | 1.7 KB |
| kill | 13.3 KB | 1.9 KB | 1.0 KB | 2.6 KB | 3.4 KB |
| hurt | 21.6 KB | 3.6 KB | 1.3 KB | 3.8 KB | 5.1 KB |
| pickup | 20.7 KB | 3.3 KB | 1.5 KB | 3.5 KB | 4.6 KB |
| bomb | 60.6 KB | 7.1 KB | 3.5 KB | 9.1 KB | 12.2 KB |
| bossDown | 95.2 KB | 8.4 KB | 5.9 KB | 13.8 KB | 18.4 KB |
| **sprint loop** (12.63 s, stereo) | 2.23 MB | **144 KB** | 115 KB | **152 KB** | 203 KB |
| each stem (same length) | 2.23 MB | 95–202 KB | 78–155 KB | 152 KB | 203 KB |

### Estimate for the whole game

These are extrapolated from the measurements above, so treat them as a ballpark:

- **SFX, 30 sounds:** about 4.2 KB per sound in Opus 64k and 5.7 KB in MP3 96k, so **≈130 KB Opus / ≈170 KB MP3**. A pitched `kill` per combo level adds about 24 × 2 KB.
- **Music, 3 loops (≈39 s in total):**
  - `menu`: ≈240 KB Opus / ≈250 KB MP3
  - `sprint`: 144 / 152 KB (measured)
  - `boss`: ≈65 / ≈69 KB

  That is **≈450 KB Opus / ≈470 KB MP3**. The renders are stereo but our mix is centred, so downmixing to mono (`-ac 1`) should roughly halve this. I have not measured the mono size.
- **Per browser:** Howler loads only the first format the browser can play, so each player downloads **≈0.6 MB**. The repo stores both formats (≈1.2 MB). That compares with **0 bytes** of audio today.
- **Howler itself:** `howler.core.min.js` is 26.9 KB, 7.9 KB gzip.

## Playing it with Howler / @pixi/sound

Sources: `howler` 2.2.4 `README.md` (Options, Methods, Mobile/Chrome Playback, Format Recommendations) and `src/howler.core.js`. `@pixi/sound` 6.0.1 `lib/Sound.d.ts` and `lib/webaudio/WebAudioInstance.d.ts`.

- **Seamless looping.**
  - In the default Web Audio mode, Howler sets `AudioBufferSourceNode.loop = true` with `loopStart`/`loopEnd` (`howler.core.js` l.1471-1474 and l.2151-2154). The loop is sample-accurate on the decoded buffer, so Music lab's one-pass WAV loops without a seam.
  - With `html5: true` (streaming) the loop is driven by timers and seeking, and can leave a gap. Keep the default Web Audio mode for the loops, which are small.
  - **Unknown:** MP3 adds encoder padding, and I did not verify whether every browser's `decodeAudioData` strips it. If it doesn't, the MP3 fallback would have a small gap at the loop point. Ogg Opus has exact pre-skip and granule positions, so it should not. A sprite with `[offset, duration, true]` can trim the padding if needed.
- **Tempo and rate.**
  - Howler `rate(r)` (0.5–4.0) sets `bufferSource.playbackRate` (`howler.core.js` l.1557). An `AudioBufferSourceNode` has no pitch preservation, so **rate changes tempo and pitch together**: 152 → 168 bpm would be +1.7 semitones.
  - In `html5` mode it sets the media element's `playbackRate`. Browsers keep the pitch there (`preservesPitch`, on by default), at the cost of time-stretch artefacts.
  - `@pixi/sound` `speed` is also a playback rate. I found no `preservesPitch` in its WebAudio code, so it changes pitch too.
  - **What we actually need:** keep our three separate songs as three looping `Howl`s and switch between them: `stop()` the old one, `play()` the new one from the top. Pause and resume then map to `pause()` and `play(id)`, which keep `seek`, the same as our `stop()`/`play()`. Mute maps to `Howler.mute(bool)`.
- **Sprites.** `sprite: { name: [offsetMs, durationMs, loop?] }` packs all the SFX into one file and one request, with a fresh voice for every `play()` and a pool of 5 by default. The README points to `audiosprite` for building them. A sprite would also hold 25 pitched `kill` variants cheaply.
- **Autoplay.**
  - `Howler.autoUnlock` (true by default) plays an empty buffer on the first `touchend` or click to unlock audio.
  - If `play()` fails before unlock it fires `playerror`, and the README's pattern retries it on `unlock`.
  - This replaces our `unlock()` and the `wanted` track logic.
  - Watch out for `Howler.autoSuspend` (true by default), which suspends the context after 30 s of silence.
- **Formats.** The Howler README recommends `webm` first with an `mp3` fallback. Our measured Opus files would ship as `.webm` or `.ogg` plus `.mp3`. **Unknown:** I did not check the exact Safari versions that support Ogg-contained Opus. Opus in WebM is the safer first choice there, per Howler's recommendation.

## How `heavy` and `interval` are meant to be honoured

They are fields on the recipe and nothing in the WAV. The skill says: "`sound render <bank> -o <dir>` writes WAV files … the game plays the files, and its own audio code carries a recipe's `heavy` (duck the others for a moment) and `interval` (the least time between two plays)" (`skills/ritmo-sounds/SKILL.md`, Rules). `recipe.d.ts` says the same: "the game's mixer reads this".

The tools do not say how long or how deep the duck should be; that is up to the game. With Howler the mixer would look like this:

- **Loading:** at build time, read the bank JSON (or a small `{name: {heavy, interval}}` table generated from it) next to the sprite.
- **`interval`:** keep `lastPlayed[name]` and skip `play` when `now - lastPlayed < interval * 1000`. This is exactly what `shoot` already does with 50 ms.
- **`heavy`:** when a heavy sound plays, `fade()` the SFX Howl and the music Howl down (for example to 40% over 30 ms) and back up over its duration. Note that Howler's group `fade` applies to every voice of a Howl, including the heavy sound itself if it is in the same sprite. Either keep the heavy sounds in their own Howl, or fade `Howler.masterGain` minus a separate gain for the heavy sounds. It is easier to put two `GainNode`s on `Howler.ctx`.

Today nothing ducks, so `heavy` is new behaviour (for example `bomb`, `bossDown`, `hurt`), not a port.

## Workflow cost: a new sound

| Step | Function in `audio.ts` today | Sound lab |
| --- | --- | --- |
| Author | 1–5 lines of TS, parameters at runtime | A JSON recipe of similar size in the bank |
| Check | Play the game and listen | `sound check` (loudness against similar sounds, clipping, end clicks), then `sound vary` takes |
| Review | Ad hoc | `sound review` page: listen, pick a take, tune sliders, approve, then `sound notes` |
| Ship | Nothing: the code is the sound | `sound render` → ffmpeg to 2 formats → rebuild the sprite and JSON → commit the binaries (≈5–15 KB each) |
| Wire up | Call `audio.foo()` | Call `sfx.play("foo")`, and the mixer applies `heavy`/`interval` |
| Variants and parameters | Free (`combo`, `angry`, `loud`) | One recipe and file per variant, or pitch through rate |

It is cheap only if the render, encode and sprite steps are one `pnpm` script. Otherwise every change is manual. The real gains are the human review loop (takes, sliders, approval) and consistent loudness. Sound lab's renderer is plain TS that "plays the same in Node and the browser" (`render.d.ts` / README § Code). That means a recipe could in principle be **synthesized at runtime** from the bank JSON instead of shipping WAVs, keeping 0 asset bytes. The package documents no public import path for this, though: `dist/sound/core/render.js` is internal, and the guideline says "the game imports nothing from this package". It would mean copying or vendoring that renderer. **Unknown / not offered upstream.**

## Unknowns and caveats

- **Nobody listened.** I cannot hear the renders. The parity claims come from reading the renderer's maths against `audio.ts` and from `sound check` / `music check` measurements. A person should A/B the WAVs in `sound review` / `music review` against the game.
- The `ritmo.typeonce.dev/tools/sound/` and `/tools/music/` pages are client-side apps; the fetched HTML carries only the title. I relied on the package README and the 0.19.1 CHANGELOG, which say these pages are the same review pages with a demo bank or song.
- MP3 loop gaplessness under `decodeAudioData`, and Ogg Opus support on older Safari, were not verified.
- The sizes for `menu`, `boss`, the whole SFX set and mono downmixes are extrapolations from the six SFX and the one loop I measured.
- I measured Ogg Opus, not Ogg Vorbis, because this ffmpeg has no libvorbis.

## Sources

- `@typeonce/ritmo-tools@0.19.1` (`npm pack`): `README.md` (§ Sound lab, § Music lab), `CHANGELOG.md` (0.19.0, 0.19.1), `dist/sound/core/{recipe.d.ts,recipe.js,render.js,wav.js}`, `dist/music/core/{instruments.js,render.js,song.d.ts,audio.js}`, CLI `sound --help`, `music render --help`.
- `@typeonce/ritmo@0.19.1`: `skills/ritmo-sounds/SKILL.md`, `skills/ritmo-music/SKILL.md`.
- `howler@2.2.4`: `README.md`, `src/howler.core.js` (l.1471-1474, 1540-1565, 2140-2156), `dist/howler.core.min.js`.
- `@pixi/sound@6.0.1`: `lib/Sound.d.ts`, `lib/webaudio/WebAudioInstance.d.ts`.
- https://ritmo.typeonce.dev/tools/sound/, https://ritmo.typeonce.dev/tools/music/ (only the titles are readable without JS).
- `~/personal/game-dev-guidelines/sintesi-stack-web.md` § Audio, § Ritmo tools.
- This repo: `src/host/audio.ts`, `src/host/music.ts`, `src/main.ts:182-183`.
