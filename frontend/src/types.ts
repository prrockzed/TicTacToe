// Shared frontend types — mirrors the backend GameState structure

export type TimeControl = "10s" | "30s" | "1m" | "endless";
export type Screen      = "auth" | "lobby" | "game";

export interface PlayerInfo {
  userId:   string;
  username: string;
  symbol:   "X" | "O";
}

export interface GameState {
  board:        (string | null)[];
  players:      { [userId: string]: PlayerInfo };
  playerOrder:  string[];
  currentTurn:  string;
  status:       "waiting" | "playing" | "finished";
  winner:       string | null;
  timeControl:  TimeControl;
  playerTimes:  { [userId: string]: number };  // seconds remaining per player
}

export interface GameOverPayload {
  winner:       string | null;            // userId | null (draw)
  winnerSymbol: "X" | "O" | null;
  reason:       "win" | "draw" | "forfeit" | "timeout";
  board:        (string | null)[];
}

// Must match the server-side OpCode constants in backend/src/types.ts
export const OpCode = {
  GAME_STATE:    1,
  MAKE_MOVE:     2,
  GAME_OVER:     3,
  TIMER_UPDATE:  4,
  PLAYER_JOINED: 5,
  PLAYER_LEFT:   6,
} as const;
