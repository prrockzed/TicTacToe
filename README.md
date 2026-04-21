# Tic-Tac-Toe — Real-Time Multiplayer

A production-ready, real-time multiplayer Tic-Tac-Toe game built with a **server-authoritative architecture** using Nakama as the backend game server.

## Live Demo

| Service | URL |
|---|---|
| **Frontend** | https://tictactoe-pr.vercel.app/ |
| **Nakama API** | https://tictactoe-nakama-8o08.onrender.com |
| **Healthcheck** | https://tictactoe-nakama-8o08.onrender.com/healthcheck |

> The backend runs on Render's free tier and may take **30–60 seconds** to wake up after a period of inactivity. Open the healthcheck URL first if the game doesn't connect immediately.

---

## Features

- **Real-time multiplayer** — two players connected over WebSocket, moves reflected instantly on both screens
- **Server-authoritative logic** — all game state lives on the server; clients cannot cheat by sending invalid moves
- **Three ways to play**
  - Auto-matchmaking — get paired with a random online player
  - Create a room — generate a room code and share it with a friend
  - Join by code — paste a friend's room code to join their game
- **Timer-based modes** — choose 10s / 30s / 1m total time per player (chess-style) or Endless; players are only matched with others on the same time control
- **Chess-style clocks** — each player's clock only ticks on their own turn; running out of time forfeits the game
- **Resign** — players can voluntarily resign mid-game with a confirmation step
- **Leaderboard** — global win rankings, top-10 displayed with gold/silver/bronze highlights; your own rank shown even if outside top-10
- **Live server stats** — lobby footer shows active games, waiting rooms, and players online in real-time
- **Session persistence** — JWT stored in localStorage; refreshing the page restores your session without re-logging in
- **Responsive UI** — works on mobile and desktop

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4 |
| Backend | Nakama 3.22.0 (server-authoritative game server) |
| Database | PostgreSQL 16 |
| Real-time | Nakama WebSocket (`@heroiclabs/nakama-js`) |
| Frontend hosting | Vercel |
| Backend hosting | Render (Docker) |
| Database hosting | Neon (serverless PostgreSQL) |

---

## Architecture

### Overview

```
Browser (React)
    │
    │  HTTPS + WSS
    ▼
Render Proxy (TLS termination)
    │
    │  HTTP + WS (port 7350)
    ▼
Nakama Server
    ├── HTTP API   (/v2/...)         — auth, RPCs
    ├── WebSocket  (/ws)             — real-time match events
    └── Match Handler (TypeScript)  — authoritative game logic
            │
            │  SQL
            ▼
        PostgreSQL (Neon)
            └── accounts, sessions, leaderboard records
```

### Server-Authoritative Game Logic

All game state is owned by the server. The client **never** modifies local game state directly — it only sends a move (cell index 0–8) and waits for the server to broadcast the new canonical state.

```
Client A          Nakama matchLoop         Client B
   │                     │                    │
   │── MAKE_MOVE(pos) ──►│                    │
   │                     │ validate move       │
   │                     │ apply to board      │
   │                     │ check win/draw      │
   │◄── GAME_STATE ──────│──── GAME_STATE ───►│
```

Guards enforced server-side:
- Move rejected if it is not the sender's turn
- Move rejected if the target cell is already occupied
- Move rejected if the game is not in `playing` status
- Move rejected if position is outside 0–8

### Match Lifecycle

```
matchInit        — create empty board, assign time control, set tick rate to 1/sec
matchJoinAttempt — reject if match full (≥2 players) or already finished
matchJoin        — assign X/O symbols, start game when 2nd player joins, init clocks
matchLoop        — tick clocks, process moves, check win/draw/timeout, broadcast state
matchLeave       — opponent wins by forfeit if game was in progress
matchTerminate   — graceful shutdown
```

### Matchmaking

Three flows are supported:

| Flow | Mechanism |
|---|---|
| Auto-matchmaking | `socket.addMatchmaker` with `timeControl` property → Nakama `matchmakerMatched` hook → `nk.matchCreate` → both clients receive the match ID |
| Create a room | `createRoom` RPC → server creates match with `timeControl` label → returns `matchId` |
| Join a room | Client calls `socket.joinMatch(matchId)` directly |

Players are only auto-matched with others on the **same time control**. The matchmaker query uses `+properties.timeControl:<value>` to enforce this.

### Time Controls

| Mode | Total time per player | Clock behaviour |
|---|---|---|
| `10s` | 10 seconds | Only the current player's clock ticks |
| `30s` | 30 seconds | Only the current player's clock ticks |
| `1m` | 60 seconds | Only the current player's clock ticks |
| `endless` | No limit | Clocks not shown |

Running out of time triggers an automatic forfeit — the opponent wins.

### Leaderboard

Wins are recorded using Nakama's native leaderboard API (`nk.leaderboardRecordWrite`) with `INCREMENTAL` operator (each win adds 1). The leaderboard is initialised once at server startup via `initLeaderboard`. A win is recorded in three cases: normal win, opponent timeout, opponent forfeit/resign.

---

## Local Development Setup

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Node.js](https://nodejs.org/) 18+

### 1. Clone the repository

```bash
git clone https://github.com/your-username/TicTacToe.git
cd TicTacToe
```

### 2. Start the backend (Nakama + PostgreSQL)

```bash
docker compose up
```

This starts:
- PostgreSQL 16 on `localhost:5432`
- Nakama 3.22.0 on `localhost:7350` (HTTP API + WebSocket)
- Nakama admin console on `localhost:7351`

Nakama automatically runs DB migrations on first start. Wait until you see:

```
nakama  | {"level":"info","msg":"Startup done"}
```

### 3. Compile the backend TypeScript

In a separate terminal:

```bash
cd backend
npm install
npm run build        # one-off compile
# or
npm run watch        # recompile on every save
```

The compiled output is `backend/build/index.js`. Nakama loads this automatically — **restart Nakama after recompiling** to pick up changes:

```bash
docker compose restart nakama
```

### 4. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173`.

The `frontend/.env.local` file points to your local Nakama instance:

```
VITE_NAKAMA_HOST=localhost
VITE_NAKAMA_PORT=7350
VITE_NAKAMA_USE_SSL=false
```

### 5. Test locally

Open two browser tabs (or one normal + one private window) at `http://localhost:5173`, log in with different usernames, and start a game.

---

## Deployment

### Stack

| Component | Provider |
|---|---|
| Nakama backend | [Render](https://render.com) — Docker web service (free tier) |
| PostgreSQL | [Neon](https://neon.tech) — serverless Postgres (free tier) |
| Frontend | [Vercel](https://vercel.com) — static hosting (free tier) |

### Backend deployment (Render + Neon)

**1. Create a PostgreSQL database on Neon**

Sign up at neon.tech → New Project → copy the connection string:
```
postgresql://user:pass@host.neon.tech/dbname?sslmode=require
```

**2. Deploy to Render**

- New Web Service → connect GitHub repo
- Language: **Docker**
- Root Directory: `backend`
- Build/Start Command: leave blank (Dockerfile handles everything)
- Environment Variables:
  - `DATABASE_URL` — paste your Neon connection string
  - `PORT` — `7350`

Render builds the Docker image, runs `entrypoint.sh` which migrates the database then starts Nakama.

**3. Redeploying after backend code changes**

```bash
cd backend
npm run build                  # recompile TypeScript
git add build/index.js
git commit -m "Rebuild backend"
git push origin main           # Render auto-deploys on push
```

### Frontend deployment (Vercel)

- New Project → connect GitHub repo
- Root Directory: `frontend`
- Framework: Vite (auto-detected)
- Environment Variables:
  - `VITE_NAKAMA_HOST` — `your-render-service.onrender.com` (no `https://`)
  - `VITE_NAKAMA_PORT` — `443`
  - `VITE_NAKAMA_USE_SSL` — `true`

Vercel auto-deploys on every push to `main`.

> **Important:** Vite bakes environment variables into the JS bundle at build time. If you update env vars in the Vercel dashboard, trigger a fresh redeploy with "Use existing build cache" **unchecked**.

---

## API Reference

### WebSocket OpCodes

| Code | Name | Direction | Payload |
|---|---|---|---|
| `1` | `GAME_STATE` | Server → Client | Full `GameState` object |
| `2` | `MAKE_MOVE` | Client → Server | `{ position: 0–8 }` |
| `3` | `GAME_OVER` | Server → Client | `{ winner, winnerSymbol, reason, board }` |
| `5` | `PLAYER_JOINED` | Server → Client | `{ userId, username, symbol }` |
| `6` | `PLAYER_LEFT` | Server → Client | `{ userId, username }` |
| `7` | `RESIGN` | Client → Server | `{}` |

**GAME_OVER reasons:** `"win"` `"draw"` `"forfeit"` `"timeout"` `"resign"`

### RPC Functions

| RPC ID | Request | Response |
|---|---|---|
| `createRoom` | `{ timeControl: "10s"\|"30s"\|"1m"\|"endless" }` | `{ matchId: string }` |
| `listRooms` | `{}` or `{ timeControl }` | `{ rooms: Room[] }` |
| `getLeaderboard` | `{}` | `{ records: Record[], ownRecord: Record\|null }` |
| `getStats` | `{}` | `{ activeGames, waitingRooms, playersOnline }` |

### GameState object

```typescript
interface GameState {
  board:       (string | null)[]           // 9 cells: null | "X" | "O"
  players:     { [userId]: PlayerInfo }
  playerOrder: string[]                    // [userId_X, userId_O]
  currentTurn: string                      // userId whose turn it is
  status:      "waiting"|"playing"|"finished"
  winner:      string | null               // userId or null
  timeControl: "10s"|"30s"|"1m"|"endless"
  playerTimes: { [userId]: number }        // seconds remaining (empty for endless)
}
```

### Nakama configuration

| Parameter | Local | Production |
|---|---|---|
| HTTP API + WebSocket port | `7350` | `7350` (Render routes 443 → 7350) |
| Admin console port | `7351` | Not exposed |
| Tick rate | 1 tick/second | 1 tick/second |
| Session expiry | 24 hours | 24 hours |
| Config file | `backend/local.yml` | `backend/production.yml` |

---

## How to Test Multiplayer

### Two players, one device

1. Open the app in a normal browser window — log in as `player1`
2. Open a **private/incognito window** — log in as `player2`
3. Both use **Find Match** with the same time control → they get paired automatically
4. Or: `player1` uses **Create Room** → copies the room code → `player2` uses **Join Room** and pastes it

### Two simultaneous games (concurrent support)

1. Open 4 tabs (2 normal + 2 private, or use two different browsers)
2. Log in with 4 different usernames
3. Start Game A: tabs 1 + 2 match each other
4. Start Game B: tabs 3 + 4 match each other
5. The lobby footer shows **"2 games live"** while both run independently
6. Play both to completion — moves in Game A do not affect Game B

### Testing game outcomes

| Scenario | How to trigger |
|---|---|
| Normal win | Get three in a row |
| Draw | Fill the board with no winner |
| Timeout | Choose `10s` mode and don't move for 10 seconds |
| Forfeit | Close the browser tab mid-game (other player wins) |
| Resign | Click **Resign** → **Yes, resign** during a game |

---

## Project Structure

```
TicTacToe/
├── backend/
│   ├── src/
│   │   ├── types.ts        — shared types, constants, OpCodes
│   │   ├── match.ts        — authoritative match handler
│   │   ├── matchmaker.ts   — matchmaking hook + room RPCs + stats RPC
│   │   ├── leaderboard.ts  — leaderboard init + record write + fetch RPC
│   │   └── main.ts         — InitModule entry point, registers everything
│   ├── build/
│   │   └── index.js        — compiled output loaded by Nakama
│   ├── Dockerfile          — production Docker image
│   ├── entrypoint.sh       — runs DB migration then starts Nakama
│   ├── production.yml      — Nakama config for Render
│   ├── local.yml           — Nakama config for local Docker
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── AuthScreen.tsx   — login / device auth
│   │   │   ├── Lobby.tsx        — matchmaking, room management, leaderboard
│   │   │   ├── GameBoard.tsx    — real-time game UI, clocks, resign
│   │   │   └── Leaderboard.tsx  — global rankings display
│   │   ├── hooks/
│   │   │   └── useMatch.ts      — WebSocket state hook
│   │   ├── nakama.ts            — Nakama client singleton
│   │   ├── types.ts             — shared frontend types
│   │   └── App.tsx              — screen state machine
│   ├── .env.local               — local dev environment variables
│   └── vite.config.ts
└── docker-compose.yml           — local Nakama + PostgreSQL
```
