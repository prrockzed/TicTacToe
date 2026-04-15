import { useEffect, useState, useCallback } from "react";
import type { Socket } from "@heroiclabs/nakama-js";
import { OpCode } from "../types";
import type { GameState, GameOverPayload } from "../types";

export interface UseMatchResult {
  gameState: GameState | null;
  gameOver:  GameOverPayload | null;
  sendMove:  (position: number) => void;
}

export function useMatch(socket: Socket, matchId: string): UseMatchResult {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [gameOver,  setGameOver]  = useState<GameOverPayload | null>(null);

  const sendMove = useCallback(
    (position: number) => {
      socket.sendMatchState(matchId, OpCode.MAKE_MOVE, JSON.stringify({ position }));
    },
    [socket, matchId]
  );

  useEffect(() => {
    socket.onmatchdata = (data) => {
      let parsed: unknown;
      try {
        const raw = data.data;
        const text =
          raw instanceof Uint8Array
            ? new TextDecoder().decode(raw)
            : typeof raw === "string"
            ? raw
            : JSON.stringify(raw);
        parsed = JSON.parse(text);
      } catch {
        return;
      }

      switch (data.op_code) {
        case OpCode.GAME_STATE:
          setGameState(parsed as GameState);
          break;

        case OpCode.GAME_OVER:
          setGameOver(parsed as GameOverPayload);
          setGameState(prev =>
            prev
              ? { ...prev, board: (parsed as GameOverPayload).board, status: "finished" }
              : prev
          );
          break;

        case OpCode.TIMER_UPDATE: {
          // Server sends { timeRemaining: number }
          const t = (parsed as { timeRemaining: number }).timeRemaining;
          setGameState(prev =>
            prev ? { ...prev, turnTimeRemaining: t } : prev
          );
          break;
        }
      }
    };

    return () => {
      socket.onmatchdata = () => {};
    };
  }, [socket]);

  return { gameState, gameOver, sendMove };
}
