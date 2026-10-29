# Ritmo 0.19 netcode vs our authoritative snapshots on a free-plan Durable Object

Research for #47. Researched 2026-10-29 against `@typeonce/ritmo-netcode@0.19.1`, `@typeonce/ritmo@0.19.1` and `@typeonce/ritmo-browser@0.19.1` (packed from npm and read, not run), the upstream repo `typeonce-dev/ritmo` at `main`, and Cloudflare's Durable Objects docs.

## Short answer

Ritmo's netcode is **peer-simulated rollback (or lockstep) over a dumb relay**, not server-authoritative snapshots. Every browser runs the whole simulation; the server only forwards text. It *can* run with the Durable Object as seat 0 (a server peer that owns saves and resyncs), but that is still "every client simulates", not what we have now. As shipped it sends **one input message per fixed step, plus pings, pongs and checksums: about 78 incoming DO messages per second per player at 4 players**, against our 30. That is 2.6x the free-plan budget we use today, unless we write our own batching `NetworkLink`, which the contract allows. Our sim also does not compile against it today: no component or resource has a schema, and `Presentation` is a service with side effects. **Recommendation: not now.** Keep the hand-rolled model. Revisit only if we want whole-world prediction, for example bug hits that feel instant, and are ready to pay for a schema migration, a 0.14 to 0.19 upgrade, cross-browser determinism proofs and a batching link.

## 1. Transport and server role Ritmo assumes

- **Netcode is a separate package**: `@typeonce/ritmo-netcode`, first published at 0.13.0 on 2026-10-24 and released in lockstep with core ever since (npm `versions`; README: "Released together with `@typeonce/ritmo` … always with the same version"). We do not depend on it today. `package.json` has only `ritmo`, `ritmo-browser` and `ritmo-math` at `^0.14.0`.
- **The transport is anything that moves strings.** `NetworkLink` has three methods: `send(message: string)`, `receive(): string[]` and `status()` (`src/NetworkLink.ts`). "The package carries no server and opens no connection: a `NetworkLink` wraps one the game made" (README). It ships `WebSocketNetworkLink` ("a WebSocket to a relay server that forwards every message to the other peers"), `WebRtcNetworkLink` (unordered, no retransmits, peer to peer) and `MemoryNetworkLink` for tests.
- **The server role is a relay.** Upstream's only server is a test relay that sends every message from a client to every other client (`integration/netcode/test/websocket.test.ts`: "A relay: every message from one client goes to every other one"). It has no rooms, auth or simulation.
- **Authority sits with seat 0, a peer.** "Seat 0 hosts: once every seat has said hello, it saves its world and every peer, seat 0 too, restores that save at the same tick" (`Netcode.ts` module doc). Seat 0 also answers `resync()`. Peers compare `runtime.checksum()` every `checksumEvery` ticks (30 by default), and a mismatch is `Desynced`.
- **Modes.** `Netcode.rollback` runs at once on guessed input (`predict`, which repeats the last input by default) and rewinds through the runtime's checkpoints when real input disagrees. `Netcode.lockstep` waits for every seat. The core skill playbook says: "client prediction against a server is rollback with the server as seat 0" (`skills/ritmo/playbooks/netcode.md`).
- **Wire format.** Protocol `version = 2` uses JSON text messages: `hello`, `sync` (a full world save), `resync`, `inputs`, `sum`, `ping`, `pong` and `hidden` (`src/internal/wire.ts`). Inputs are re-sent from the last tick every peer acknowledged, up to 64 per message (`maxInputsPerMessage`), so lost or merged messages are tolerated: "may lose some: sessions repeat what was not acknowledged" (`NetworkLink.ts`).

## 2. Can it run server-authoritative inside one Durable Object?

There are two ways to fit it in the DO. Neither is authoritative in the sense we use today.

**A. DO as a plain relay (the shape upstream assumes).** `rooms.ts` keeps the lobby and codes. During a run the DO only forwards each socket's text to the other sockets of the room. That is cheap in CPU, and the DO could use the WebSocket Hibernation API. But authority moves to a browser: seat 0 is the host's tab, its world is the save everyone restores, and "Seat 0 is never played around … while seat 0 is hidden, the others wait for it" (README, Hidden tabs). If the host's phone locks, the run stalls for everyone. Hits and kills are decided on every peer from inputs alone. Cheating is limited to the inputs a peer sends, plus a malicious seat 0 save. That matters little in casual co-op, but it is a real change from "the server decides what it hits" (`src/host/own-shots.ts` header).

**B. DO as seat 0 (the server-peer variant).** The DO runs a Ritmo runtime and a `Netcode.rollback` session as seat 0, which is an extra seat with `idle` input, so 4 players means 5 seats. It needs one custom `NetworkLink` per socket in the room, or one link that fans out. Everything it needs is injectable: `FixedLoop` takes any `TickSource` (`FixedLoop.source(subscribe)` in core `src/FixedLoop.ts`), `HostClock.standard` is `Date.now()` (core `src/HostClock.ts`), and the link is three methods. This keeps saves, resyncs and the "who waits for whom" anchor on the server. Each browser still runs the full sim and decides hits locally. The server only *detects* disagreement through checksums and resyncs everyone to its world. Cost: the DO runs the sim *with rollbacks*. Each `advance` rewinds at most once, to the earliest wrong tick, and re-runs up to `maxRollback` ticks (8 by default), plus a checkpoint every tick (`src/internal/session.ts`, `correct()` and `runUpTo`). Today `MAX_ROOMS = 10` runs share one thread in one DO (`src/server/rooms.ts`). Rollback could multiply that CPU several times. This is **unmeasured**.

So **yes, it can run in one DO**, but "server-authoritative" in our sense (only the server simulates, clients draw) is not what Ritmo netcode does. Variant B is the closest equivalent.

## 3. Messages per second per player vs the free-plan budget

**What a session sends.** `advance()` calls `sendAll()` once per fixed step (`session.ts`), and that is the only cadence. Each call broadcasts to every link:

| Message | Rate per peer | Source |
|---|---|---|
| `inputs` | every step: **60/s** at our 60 Hz step | `sendAll()`, `broadcast(inputsMessage())` |
| `ping` | every 250 ms: 4/s | `pingEveryMS = 250` |
| `pong` | one per ping received from each other seat: 4 x (N-1)/s | `case "ping": broadcast({ k: "pong", … })` |
| `sum` | every `checksumEvery` = 30 ticks: 2/s | `checksumEvery ?? 30` |

Over a relay with one link per peer, a peer at N = 4 sends 60 + 4 + 12 + 2 = **~78 messages/s**. Each one is an *incoming* message for the DO. Today a browser sends inputs every other step, **30/s** (`INPUTS_MAX`, `ClientMessage` "input" in `src/net/protocol.ts`). In variant B the DO's own messages are outgoing and are not billed.

**The budget (Cloudflare pricing page).** The Free plan allows "100,000 / day" requests, and "Daily free limits reset at 00:00 UTC". Requests "Includes HTTP requests, RPC sessions, WebSocket messages, and alarm invocations". Footnote 2: "There is no charge for outgoing WebSocket messages, nor for incoming WebSocket protocol pings. For compute requests billing-only, a 20:1 ratio is applied to incoming WebSocket messages." Duration is "13,000 GB-s / day" at a billed 128 MB, which is about 28.9 h of DO wall time per day. `accept()` (our `worker.ts`) bills duration "for the entire time the WebSocket is connected".

**Unknown:** the page does not say whether the 20:1 ratio also applies to the Free plan's 100,000/day. The footnote is attached to the Requests row, which has a Free column, but its wording is "for compute requests billing-only". Both cases:

| Model | Incoming msgs/s/player | Player-hours/day without 20:1 (100k msgs) | With 20:1 (2M msgs) | 4-player run-hours/day (with 20:1) |
|---|---|---|---|---|
| Today | 30 | 0.9 | 18.5 | 4.6 |
| Ritmo as shipped, N = 4 | ~78 | 0.36 | 7.1 | 1.8 |
| Ritmo + batching link (flush every 2 steps) | ~30 | 0.9 | 18.5 | 4.6 |

**Mitigation that fits the contract.** `NetworkLink` is ours to implement. A `send` that buffers and flushes every 2 steps as one WebSocket frame (a JSON array of the session's strings), with `receive` splitting it, brings us back to about 30/s. The protocol is order- and loss-tolerant, and inputs are re-sent until acknowledged, so batching is safe. The cost is up to one extra step (16.7 ms) on input delivery. Lowering the sim step to 30 Hz would also halve the rate, but it changes game feel and `DT`, so we rule it out.

## 4. Behaviour at 4 players and ~63 ms RTT

Derived from the source plus our measurements (memory: WebSocket RTT ~63 ms from Italy, 1–5% of frames 50–100 ms late). It has **not** been simulated with our game.

- **Peer-to-peer latency doubles through the relay.** Browser to DO to browser is about two client-to-edge legs, so roughly 63 ms one way between two Italian players. Ritmo pings go through the relay, so `status().roundTripMS` would read about 126 ms.
- **Input delay.** The default `inputDelay` is 2 ticks (33 ms). `adaptiveDelay` targets `ceil(roundTripMS / 2 / stepMS)` = ceil(126 / 2 / 16.7) = **4 ticks (67 ms)**, after 4 consecutive measurements 250 ms apart (`delay.ts`, README "Input delay"). At 4 ticks there are few rollbacks but the controls lag about 67 ms, which is worse than today's own-developer prediction (#41), where our own inputs apply at once. At 2 ticks, remote input arrives about 2 ticks late, plus 1 tick with batching, so every remote input *change* triggers a 2–3 tick rollback.
- **Rollback window.** The confirmed tick is the minimum over all 3 remote seats, so the worst link governs. A 50–100 ms spike adds 3–6 ticks. With batching that puts the confirmed tick about 6–9 ticks behind, against the default `maxRollback: 8`. Past that, `advance` returns `Stalled` and **drops that frame's local input** ("feed it state … rather than one-frame edges"). Our dash, bomb and Breakpoint are edges, today kept until a step uses them (`withPresses` in `rooms.ts`). We would want `maxRollback` 12–16 and `checkpoints` at least that (`RollbackOptions.maxRollback`: "The runtime must keep at least this many checkpoints"). 0.19.0 fixed exactly this case: "4 seats, `maxRollback: 12`, `checkpoints: 12`: lost at frame 25" (netcode `CHANGELOG.md`).
- **Pacing.** `rate()` slows a peer that runs ahead, down to 0.9x (`slowestRate`), so the 4 clocks converge without the server clock and jitter buffer of #40.
- **What players see.** Remote developers and every bug are drawn from the local sim, predicted on repeat-last-input, with no 30 Hz interpolation delay. Mispredictions snap after a rollback. Ritmo gives no smoothing for that; the host would have to add it. Kills and hits can show and then be withdrawn: `session.events(…)` hands out `predicted` / `withdrawn` / `confirmed` so that sounds play once.
- **Hidden tabs.** The default `timeoutMS` is 5000, so without the `hidden` option a phone that locks ends the run with `Disconnected` after 5 s, against our 90 s `SILENT_MS`. With `hidden: { then: "resync-on-return" }`, the others play on. A hidden seat 0 still stalls everyone, so in variant A that is the host player.
- **Client CPU.** Every phone runs the full sim plus re-runs of rollbacks plus a checkpoint every tick. Today a browser only steps its own developer. This is **unmeasured** for our Endless world sizes. Upstream benchmarks only a toy game with 2 peers (`packages/netcode/bench/netcode.bench.ts`).

## 5. What it would replace in our code

| File | Today | With Ritmo netcode |
|---|---|---|
| `src/host/net.ts` | socket, 30 Hz frame jitter buffer on the server clock, entity blending | Keep `connect()` and the lobby messages. The jitter buffer and `blend` go away (there are no frames). Draw the local runtime with `FixedLoop`'s `alpha`. |
| `src/host/predict.ts` | replays unacknowledged inputs for our own developer, fades corrections | Removed: the whole world is predicted. The fade-on-correction idea comes back as render smoothing after a rollback. |
| `src/host/own-shots.ts` | our own bullets drawn early, then handed over to server bullets | Removed: bullets are local sim entities. Muzzle flash and sound move to `session.events(...).predicted/withdrawn/confirmed`. |
| `src/sim/motion.ts`, `src/sim/trigger.ts` | `steer`/`glide`/`bulletsOf` shared so the browser can replay them | They stay as plain sim code. Sharing them for prediction is no longer needed. |
| `src/server/rooms.ts` | `createSimulation` per room, per-seat input queues (`QUEUE_MAX`), seq/ack, 30 Hz `frame` broadcast | Lobby, codes and limits stay. The run part becomes a relay (variant A) or a seat-0 session with a server `NetworkLink` (variant B). `protocol.ts` swaps `input`/`frame` for an envelope carrying session text. |
| `src/server/worker.ts` | 60 Hz `setInterval`, `accept()` | Variant A: no ticker needed, and Hibernation becomes possible, though a 78 or 30 msg/s match never idles. Variant B: the ticker drives a `FixedLoop`. |

Required changes to the sim before any of this compiles. Each is enforced by Ritmo types:

1. **Saveable world.** `Netcode.rollback/lockstep/syncTest` take `runtime & ValidateSaveable<S>`, and `Snapshot.Gate` turns each unsaveable descriptor into an error like `"BugKiller/Position needs a schema"` (core `src/Snapshot.ts`). In `src/sim/schema.ts`, all 12 components (`Position` … `Breakpoint`) and the resources (`Party`, `LevelSpec`, `Language`, `Hardcore`, `Tiers`, `Run`, `Missions`, `Interruptions`, `Calls`) are plain `Descriptor.Component`/`Resource`. Only `Rng` is `ConstructedResource`.
2. **Rewindable schedule.** `Checkpoint.ValidateRewindable` rejects any service that is not a `snapshot()` source, plain data or `Checkpoint.rewindable` (core `src/Checkpoint.ts`). `Presentation { fx, chat }` is a service with side effects and has to become events.
3. **Input through `Netcode.seats(codec, …)`** (a Standard Schema for `InputValue`) instead of our `InputSource`.
4. **Determinism across browsers.** It looks promising: `src/sim` has no `Math.random`, `Date.now`, `performance.now` or `Math.sin/cos/atan2/hypot`, and uses `ritmo-math` `Ops` and the seeded `Rng`. But the playbook requires proving it with `Netcode.syncTest`, a fuzzed `MemoryNetworkLink` match, and `ritmo-devtools verify … --engines node,chromium,webkit,firefox` in CI.
5. **Upgrade 0.14 to 0.19.1** across `ritmo`, `ritmo-browser`, `ritmo-math`, `ritmo-devtools` and the oxlint plugin.

## Unknowns to settle before deciding

- Whether the 20:1 incoming-message ratio applies to the Free plan's 100,000 requests/day. The docs don't say; check the DO analytics or the "requests" counter on the dashboard after a measured session.
- The cost of a checkpoint per tick and of 2–8-tick re-runs for our worlds (Endless late game), on a phone and in the DO. `syncTest` with `rewind: 12` over a recorded Endless run would measure it.
- Whether anything in our sim breaks determinism across engines, for example iteration order over `Map`/`Set` built from unsorted data. Only `ritmo-devtools verify` will tell.
- API stability: netcode is 6 days old with 7 releases (0.13.0 on 2026-10-24 to 0.19.1 on 2026-10-29, npm `time`), and the wire protocol is already at version 2.

## Sources

- `@typeonce/ritmo-netcode@0.19.1` (npm tarball): `README.md`, `CHANGELOG.md`, `src/Netcode.ts`, `src/NetworkLink.ts`, `src/WebSocketNetworkLink.ts`, `src/WebRtcNetworkLink.ts`, `src/internal/session.ts`, `src/internal/wire.ts`, `src/internal/delay.ts`
- `@typeonce/ritmo@0.19.1` (npm tarball): `skills/ritmo/playbooks/netcode.md`, `src/Snapshot.ts`, `src/Checkpoint.ts`, `src/FixedLoop.ts`, `src/HostClock.ts`
- https://github.com/typeonce-dev/ritmo: `integration/netcode/test/websocket.test.ts`, `packages/netcode/bench/netcode.bench.ts`
- https://developers.cloudflare.com/durable-objects/platform/pricing/ (requests and duration rows, footnotes 1–5)
- https://developers.cloudflare.com/durable-objects/platform/limits/ (1,000 req/s soft limit per object, 32 MiB received message size, CPU reset per message)
- This repo: `src/server/worker.ts`, `src/server/rooms.ts`, `src/net/protocol.ts`, `src/host/net.ts`, `src/host/predict.ts`, `src/host/own-shots.ts`, `src/sim/schema.ts`
