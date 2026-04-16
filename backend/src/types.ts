// Shared types for the Tic-Tac-Toe Nakama runtime.
// No ES module imports/exports — all declarations are global for outFile bundling.

type TimeControl = "10s" | "30s" | "1m" | "endless";

// Returns total seconds for a given time control. 0 = no limit.
function getTimeControlSeconds(tc: string): number {
  if (tc === "10s") return 10;
  if (tc === "30s") return 30;
  if (tc === "1m")  return 60;
  return 0; // endless
}

interface PlayerInfo {
  userId:    string;
  sessionId: string;
  username:  string;
  symbol:    "X" | "O";
}

interface GameState {
  board:        (string | null)[];        // 9 cells indexed 0-8: null | "X" | "O"
  players:      { [userId: string]: PlayerInfo };
  playerOrder:  string[];                 // [userId_X, userId_O]
  currentTurn:  string;                   // userId whose turn it is
  status:       "waiting" | "playing" | "finished";
  winner:       string | null;            // userId | null
  timeControl:  TimeControl;
  playerTimes:  { [userId: string]: number }; // seconds remaining per player (empty for endless)
}

const OpCode = {
  GAME_STATE:    1,  // Server → Client : full game state
  MAKE_MOVE:     2,  // Client → Server : { position: 0-8 }
  GAME_OVER:     3,  // Server → Client : { winner, winnerSymbol, reason, board }
  TIMER_UPDATE:  4,  // reserved
  PLAYER_JOINED: 5,  // Server → Client : player info
  PLAYER_LEFT:   6,  // Server → Client : player disconnected
} as const;

const WIN_LINES: number[][] = [
  [0, 1, 2], // top row
  [3, 4, 5], // middle row
  [6, 7, 8], // bottom row
  [0, 3, 6], // left column
  [1, 4, 7], // middle column
  [2, 5, 8], // right column
  [0, 4, 8], // diagonal ↘
  [2, 4, 6], // diagonal ↙
];

// Module name used to register the match handler — shared across all files
const MODULE_NAME = "tictactoe";

// RPC function IDs — registered in InitModule and called by the frontend
const RPC_CREATE_ROOM     = "createRoom";
const RPC_LIST_ROOMS      = "listRooms";
const RPC_GET_LEADERBOARD = "getLeaderboard";

// Leaderboard
const LEADERBOARD_ID = "tictactoe_wins";
