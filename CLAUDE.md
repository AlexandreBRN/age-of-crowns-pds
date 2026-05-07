# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Run server with ts-node (no build step) — http://localhost:4000
npm run build    # tsc → dist/
npm start        # Run compiled JS from dist/main.js
```

There is no test runner, lint, or formatter configured. The TypeScript compiler (`tsc`) with `strict: true` is the only static check.

The server listens on `process.env.PORT ?? 4000`. Open two browser tabs at the URL to start a match (the game requires exactly 2 players to begin ticking).

## Architecture

This is a 2-player real-time strategy game (Age of Empires style) running entirely in-memory on a single Node.js process. The server is **authoritative** — clients send commands over WebSocket, the server simulates ticks, and the server broadcasts full state snapshots back. There is no client-side prediction.

### Hexagonal layout under [src/](src/)

- [src/core/domain/](src/core/domain/) — entities ([GameSession](src/core/domain/entities/GameSession.ts), [Villager](src/core/domain/entities/Villager.ts), [TownCenter](src/core/domain/entities/TownCenter.ts), [PlayerBuilding](src/core/domain/entities/PlayerBuilding.ts), [ResourceNode](src/core/domain/entities/ResourceNode.ts)), value objects, and DTOs ([GameStateSnapshot](src/core/domain/types/GameStateSnapshot.ts)). No I/O. Pure simulation.
- [src/core/application/](src/core/application/) — use cases (one per inbound command) and `ports/in` and `ports/out` interfaces. The session repository and event publisher are accessed only through ports.
- [src/adapters/in/websocket/WebSocketAdapter.ts](src/adapters/in/websocket/WebSocketAdapter.ts) — translates WebSocket JSON messages → use case calls.
- [src/adapters/out/](src/adapters/out/) — `InMemorySessionRepository` (creates the single default session at boot via `MapGeneratorService`) and `WebSocketEventPublisher` (broadcasts to a `ClientRegistry: Map<sessionId, Set<WebSocket>>`).
- [src/infrastructure/server/](src/infrastructure/server/) — `HttpServer` (express, serves [public/](public/) and `/assets`) and `WebSocketServer` (wraps `ws`).
- [src/main.ts](src/main.ts) — composition root. Manual DI; no container.

### The tick loop is the heart of the simulation

[GameLoopService](src/core/application/services/GameLoopService.ts) runs `setInterval` at **250ms** (4 ticks/sec) only while 2 players are connected. Each tick calls `GameSession.advanceTick()` then publishes a full state snapshot.

[`GameSession.advanceTick()`](src/core/domain/entities/GameSession.ts) processes phases in a fixed order: movement → construction → combat → auto-attack-acquire → resource gathering (every 4 ticks) → building generation (every 8 ticks) → training → cleanup of dead/destroyed entities. **Order matters** — e.g. cleanup happens last so attackers can damage targets that die the same tick. When adding a new tick-driven mechanic, slot it intentionally rather than appending.

### Single hardcoded session

There is exactly one `GameSession` with id `'default-session'`, created by [InMemorySessionRepository](src/adapters/out/persistence/InMemorySessionRepository.ts) at boot. `addPlayer` throws when 2 players exist. Spawn locations are hardcoded for player-index 0 (top-left, anchor 2,2) and player-index 1 (bottom-right, anchor 54,54) — these correspond to the corner-clear zones in [MapGeneratorService](src/core/application/services/MapGeneratorService.ts).

### Server↔client config duplication

Building and unit definitions exist on **both** sides:
- Server: `BUILDING_CONFIGS` in [PlayerBuilding.ts](src/core/domain/entities/PlayerBuilding.ts), `UNIT_CONFIGS` in [Villager.ts](src/core/domain/entities/Villager.ts).
- Client: `BUILDING_DEFS` and `UNIT_DEFS` in [public/game.js](public/game.js).

If you change costs, sizes, HP, or train times on the server, **update the client mirror in `public/game.js`** or the UI will lie about costs and the build placement ghost will be the wrong size. Server is the source of truth for validation; client values are display-only.

### WebSocket message shapes

Inbound (client → server) messages dispatch in [WebSocketAdapter.handleMessage](src/adapters/in/websocket/WebSocketAdapter.ts):
- `join` — must come first. Subsequent commands without an established `playerId` are rejected with `{ type: 'error', ... }`.
- `move_villager`, `gather_resource`, `train_villager`, `attack_target`, `place_building`.

Note that `attack_target` bypasses the use-case layer and calls `sessionRepository.findDefault().commandVillagerAttack` directly — there is no `IAttackTargetUseCase` port. If you add new commands, prefer the use-case path.

Outbound (server → client):
- `game_joined` (one-time, includes full `mapTiles` + `initialSnapshot`).
- `state_update` (every tick, full snapshot — no diffs).
- `opponent_joined` / `opponent_left` notifications.
- `error` for invalid commands.

### Client (browser)

[public/game.js](public/game.js) is a single ~1500-line file with no build step or framework. It owns: canvas rendering, input handling (mouse, WASD camera, building placement ghost), fog of war (computed client-side from own units' vision radius — server sends full state; the client hides it), minimap, and sprite GIFs from [src/assets/aldeao/](src/assets/aldeao/). Note `runnig_right.gif` is misspelled in the asset filename and the client preserves the typo.

## Conventions

- User-facing strings (errors, labels) are **Portuguese**. Keep new error messages in Portuguese to match.
- Domain entities use `_underscorePrivate` fields with public getters; commands are imperative methods (`commandMove`, `commandAttack`) that mutate state. They do not return events — the snapshot diff is implicit via the next tick broadcast.
- Use cases throw plain `Error` for invalid commands; the WebSocket adapter catches and converts to `{ type: 'error', message }`. Don't introduce a richer error type unless the client needs to discriminate.
