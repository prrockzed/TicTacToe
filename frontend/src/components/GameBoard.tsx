import type { Session, Socket } from "@heroiclabs/nakama-js";
import { useMatch } from "../hooks/useMatch";
import type { TimeControl } from "../types";

interface Props {
  session:     Session;
  socket:      Socket;
  matchId:     string;
  timeControl: TimeControl;
  onGameOver:  () => void;
}

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function getWinningCells(board: (string | null)[], symbol: "X" | "O" | null): Set<number> {
  if (!symbol) return new Set();
  for (const line of WIN_LINES) {
    if (board[line[0]] === symbol && board[line[1]] === symbol && board[line[2]] === symbol) {
      return new Set(line);
    }
  }
  return new Set();
}

const BG = "radial-gradient(ellipse at 50% 0%, #1e1040 0%, #0a0a12 60%)";

function formatClock(s: number): string {
  if (s >= 60) return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  return `${s}s`;
}

export default function GameBoard({ session, socket, matchId, timeControl: propTC, onGameOver }: Props) {
  const { gameState, gameOver, sendMove } = useMatch(socket, matchId);

  const myUserId   = session.user_id ?? "";
  const me         = gameState?.players[myUserId];
  const opponentId = gameState?.playerOrder.find(id => id !== myUserId);
  const opponent   = opponentId ? gameState?.players[opponentId] : undefined;
  const isMyTurn    = gameState?.status === "playing" && gameState.currentTurn === myUserId && !gameOver;
  const tc          = gameState?.timeControl ?? propTC;
  const isTimed     = tc !== "endless";
  const myTime      = isTimed ? (gameState?.playerTimes[myUserId] ?? 0) : null;
  const opTime      = isTimed && opponentId ? (gameState?.playerTimes[opponentId] ?? 0) : null;

  const displayBoard = gameOver ? gameOver.board : (gameState?.board ?? Array(9).fill(null));
  const winCells     = gameOver ? getWinningCells(displayBoard, gameOver.winnerSymbol) : new Set<number>();

  // Result copy
  let resultTitle = "";
  let resultSub   = "";
  if (gameOver) {
    if (gameOver.winner === null) {
      resultTitle = "It's a Draw";
      resultSub   = "No winner this time.";
    } else if (gameOver.winner === myUserId) {
      resultTitle = "You Win!";
      resultSub =
        gameOver.reason === "forfeit" ? "Opponent forfeited." :
        gameOver.reason === "timeout" ? "Opponent ran out of time." :
        "Well played!";
    } else {
      resultTitle = "You Lose";
      resultSub =
        gameOver.reason === "forfeit" ? "You forfeited." :
        gameOver.reason === "timeout" ? "You ran out of time." :
        "Better luck next time.";
    }
  }

  // ── Loading state ─────────────────────────────────────────────────────────
  if (!gameState) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4"
        style={{ background: BG }}
      >
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 text-sm">Waiting for game to start…</p>
      </div>
    );
  }

  // ── Game screen ───────────────────────────────────────────────────────────
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center p-4"
      style={{ background: BG }}
    >
      <div className="w-full max-w-sm flex flex-col gap-4">

        {/* Mode badge */}
        <div className="flex justify-center">
          <span
            className="text-xs font-semibold px-3 py-1 rounded-full"
            style={{
              background: isTimed ? "rgba(239,68,68,0.15)" : "rgba(99,102,241,0.15)",
              color:      isTimed ? "#fca5a5"              : "#a5b4fc",
              border:     `1px solid ${isTimed ? "rgba(239,68,68,0.3)" : "rgba(99,102,241,0.3)"}`,
            }}
          >
            {isTimed ? `${tc} per player` : "Endless"}
          </span>
        </div>

        {/* Player strip */}
        <div className="flex items-center justify-between px-1">
          <PlayerChip
            username={me?.username ?? "You"}
            symbol={me?.symbol ?? "X"}
            active={isMyTurn}
            align="left"
            timeRemaining={myTime}
          />
          <span className="text-gray-700 text-xs">vs</span>
          <PlayerChip
            username={opponent?.username ?? "Waiting…"}
            symbol={opponent?.symbol ?? "O"}
            active={!isMyTurn && gameState.status === "playing" && !gameOver}
            align="right"
            timeRemaining={opTime}
          />
        </div>

        {/* Board */}
        <div
          className="grid grid-cols-3 rounded-2xl overflow-hidden"
          style={{
            gap:              3,
            background:       "rgba(255,255,255,0.08)",
            boxShadow:        "0 8px 32px rgba(0,0,0,0.5)",
            gridTemplateRows: "repeat(3, 1fr)",
            aspectRatio:      "1",
          }}
        >
          {displayBoard.map((cell, i) => {
            const isWin     = winCells.has(i);
            const clickable = isMyTurn && !cell;
            return (
              <Cell
                key={i}
                value={cell as "X" | "O" | null}
                winning={isWin}
                clickable={clickable}
                onClick={() => clickable && sendMove(i)}
              />
            );
          })}
        </div>

        {/* Status line */}
        {!gameOver && (
          <p
            className="text-center text-sm"
            style={{ color: isMyTurn ? "#a5b4fc" : "#6b7280" }}
          >
            {gameState.status === "waiting"
              ? "Waiting for opponent to join…"
              : isMyTurn
              ? "Your turn"
              : "Opponent is thinking…"}
          </p>
        )}

        {/* Result card */}
        {gameOver && (
          <div
            className="rounded-2xl p-6 text-center"
            style={{
              background: "rgba(255,255,255,0.05)",
              border:     "1px solid rgba(255,255,255,0.1)",
              boxShadow:  "0 8px 32px rgba(0,0,0,0.5)",
            }}
          >
            <p className="text-2xl font-extrabold text-white mb-1">{resultTitle}</p>
            <p className="text-gray-500 text-sm mb-5">{resultSub}</p>
            <button
              onClick={onGameOver}
              className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all active:scale-[0.97]"
              style={{ background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)" }}
            >
              Back to Lobby
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Cell ──────────────────────────────────────────────────────────────────────

function Cell({
  value, winning, clickable, onClick,
}: {
  value:     "X" | "O" | null;
  winning:   boolean;
  clickable: boolean;
  onClick:   () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="flex items-center justify-center transition-colors"
      style={{
        background: winning ? "rgba(99,102,241,0.25)" : "#0d0d1a",
        cursor:     clickable ? "pointer" : "default",
      }}
      onMouseEnter={e => {
        if (clickable) (e.currentTarget as HTMLDivElement).style.background = "rgba(99,102,241,0.1)";
      }}
      onMouseLeave={e => {
        if (clickable) (e.currentTarget as HTMLDivElement).style.background = winning ? "rgba(99,102,241,0.25)" : "#0d0d1a";
      }}
    >
      {value === "X" && (
        <span
          className="font-black select-none"
          style={{
            fontSize: "clamp(1.75rem, 5vw, 2.5rem)",
            color: winning ? "#93c5fd" : "#3b82f6",
          }}
        >
          ✕
        </span>
      )}
      {value === "O" && (
        <span
          className="font-black select-none"
          style={{
            fontSize: "clamp(1.75rem, 5vw, 2.5rem)",
            color: winning ? "#fda4af" : "#f43f5e",
          }}
        >
          ○
        </span>
      )}
    </div>
  );
}

// ── PlayerChip ────────────────────────────────────────────────────────────────

function PlayerChip({
  username, symbol, active, align, timeRemaining,
}: {
  username:      string;
  symbol:        "X" | "O";
  active:        boolean;
  align:         "left" | "right";
  timeRemaining: number | null;
}) {
  const isX    = symbol === "X";
  const color  = isX ? "#3b82f6" : "#f43f5e";
  const glyph  = isX ? "✕" : "○";
  const label  = username.length > 10 ? username.slice(0, 10) + "…" : username;
  const urgent = timeRemaining !== null && timeRemaining <= 5;

  return (
    <div className={`flex flex-col gap-0.5 ${align === "right" ? "items-end" : "items-start"}`}>
      <div className={`flex items-center gap-1.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <span className="font-black text-base" style={{ color }}>{glyph}</span>
        <span
          className="text-sm font-semibold transition-colors"
          style={{ color: active ? "#f9fafb" : "#6b7280" }}
        >
          {label}
        </span>
      </div>

      {/* Clock — only shown in timed modes */}
      {timeRemaining !== null && (
        <span
          className="text-xs font-mono font-bold transition-colors"
          style={{ color: urgent ? "#ef4444" : active ? "#a5b4fc" : "#4b5563" }}
        >
          {formatClock(timeRemaining)}
        </span>
      )}

      {/* Turn indicator */}
      {active && (
        <div className={`flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
          <span className="text-indigo-400 text-xs">{align === "left" ? "your turn" : "their turn"}</span>
        </div>
      )}
    </div>
  );
}
