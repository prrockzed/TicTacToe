// Shared types for the Tic-Tac-Toe Nakama runtime.
// No ES module imports/exports — all declarations are global for outFile bundling.

interface PlayerInfo {
  userId: string;
  sessionId: string;
  username: string;
  symbol: "X" | "O";
}

interface GameState {
  board: (string | null)[];       // 9 cells indexed 0-8: null | "X" | "O"
  players: { [userId: string]: PlayerInfo };
  playerOrder: string[];          // [userId_X, userId_O]
  currentTurn: string;            // userId whose turn it is
  status: "waiting" | "playing" | "finished";
  winner: string | null;          // userId | "draw" | null
  gameMode: "classic" | "timed";
  timerEnabled: boolean;
  turnTimeRemaining: number;      // seconds remaining for current turn (timed mode)
}

const OpCode = {
  GAME_STATE:    1,  // Server → Client : full game state
  MAKE_MOVE:     2,  // Client → Server : { position: 0-8 }
  GAME_OVER:     3,  // Server → Client : { winner, board }
  TIMER_UPDATE:  4,  // Server → Client : { timeRemaining }
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
  [0, 4, 8], // diagonal top-left to bottom-right
  [2, 4, 6], // diagonal top-right to bottom-left
];

const TIMED_MODE_TURN_SECONDS = 30;

// Module name used to register the match handler — shared across all files
const MODULE_NAME = "tictactoe";

// RPC function IDs — registered in InitModule and called by the frontend
const RPC_CREATE_ROOM = "createRoom";
const RPC_LIST_ROOMS  = "listRooms";
