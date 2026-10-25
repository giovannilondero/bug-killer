import type { QueryMatch } from "@typeonce/ritmo/Query"

import { Body, Boss, Bug, Game, HostileShot, Pickup, Player, Position, Shot, Velocity } from "./schema.ts"

export const PlayerWrite = Game.Query({
  selection: {
    position: Game.Query.write(Position),
    velocity: Game.Query.write(Velocity),
    body: Game.Query.read(Body),
    player: Game.Query.write(Player)
  }
})

export const PlayerRead = Game.Query({
  selection: {
    position: Game.Query.read(Position),
    body: Game.Query.read(Body),
    player: Game.Query.read(Player)
  }
})

/** Developers still standing, lowest seat first: who bugs chase and where clients drop rewards. */
export const standing = (team: ReadonlyArray<QueryMatch<typeof Game.schema, typeof PlayerRead>>) =>
  team
    .filter((match) => match.data.player.get().hp > 0)
    .sort((a, b) => a.data.player.get().slot - b.data.player.get().slot)
    .map((match) => {
      const { x, y } = match.data.position.get()
      return { x, y }
    })

export const BugWrite = Game.Query({
  selection: {
    position: Game.Query.write(Position),
    velocity: Game.Query.write(Velocity),
    body: Game.Query.read(Body),
    bug: Game.Query.write(Bug)
  }
})

export const BugRead = Game.Query({
  selection: {
    position: Game.Query.read(Position),
    body: Game.Query.read(Body),
    bug: Game.Query.read(Bug)
  }
})

export const BossWrite = Game.Query({
  selection: {
    position: Game.Query.write(Position),
    velocity: Game.Query.write(Velocity),
    body: Game.Query.read(Body),
    boss: Game.Query.write(Boss)
  }
})

export const BossRead = Game.Query({
  selection: {
    position: Game.Query.read(Position),
    body: Game.Query.read(Body),
    boss: Game.Query.read(Boss)
  }
})

export const Moving = Game.Query({
  selection: {
    position: Game.Query.write(Position),
    velocity: Game.Query.read(Velocity)
  }
})

export const ShotWrite = Game.Query({
  selection: {
    position: Game.Query.read(Position),
    body: Game.Query.read(Body),
    shot: Game.Query.write(Shot)
  }
})

export const ShotRead = Game.Query({
  selection: {
    position: Game.Query.read(Position),
    velocity: Game.Query.read(Velocity),
    shot: Game.Query.read(Shot)
  }
})

export const HostileShotWrite = Game.Query({
  selection: {
    position: Game.Query.read(Position),
    body: Game.Query.read(Body),
    shot: Game.Query.write(HostileShot)
  }
})

export const HostileShotRead = Game.Query({
  selection: {
    position: Game.Query.read(Position),
    shot: Game.Query.read(HostileShot)
  }
})

export const PickupWrite = Game.Query({
  selection: {
    position: Game.Query.read(Position),
    body: Game.Query.read(Body),
    pickup: Game.Query.write(Pickup)
  }
})

export const PickupRead = Game.Query({
  selection: {
    position: Game.Query.read(Position),
    pickup: Game.Query.read(Pickup)
  }
})
