// Nakama Match Handler — server-authoritative Tic-Tac-Toe logic.
// The client only sends OpCode.MAKE_MOVE with a position (0-8).
// The server validates, applies, and broadcasts the canonical GameState.

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createInitialState(timeControl: string): GameState {
  return {
    board: [null, null, null, null, null, null, null, null, null],
    players: {},
    playerOrder: [],
    currentTurn: "",
    status: "waiting",
    winner: null,
    timeControl: timeControl as TimeControl,
    playerTimes: {},
  };
}

function checkWinner(board: (string | null)[]): string | null {
  for (var i = 0; i < WIN_LINES.length; i++) {
    var line = WIN_LINES[i];
    var a = board[line[0]];
    var b = board[line[1]];
    var c = board[line[2]];
    if (a !== null && a === b && b === c) {
      return a; // returns "X" or "O"
    }
  }
  return null;
}

function isBoardFull(board: (string | null)[]): boolean {
  for (var i = 0; i < board.length; i++) {
    if (board[i] === null) return false;
  }
  return true;
}

function getOpponentId(state: GameState, userId: string): string {
  return state.playerOrder[0] === userId
    ? state.playerOrder[1]
    : state.playerOrder[0];
}

function broadcastState(
  dispatcher: nkruntime.MatchDispatcher,
  state: GameState
): void {
  dispatcher.broadcastMessage(
    OpCode.GAME_STATE,
    JSON.stringify(state),
    null,   // presences: null = broadcast to all
    null,   // sender
    true    // reliable
  );
}

// ─── matchInit ───────────────────────────────────────────────────────────────

const matchInit: nkruntime.MatchInitFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  params: { [key: string]: string }
): { state: nkruntime.MatchState; tickRate: number; label: string } {
  const tc = params["timeControl"];
  const timeControl: TimeControl =
    (tc === "10s" || tc === "30s" || tc === "1m") ? tc : "endless";

  const state: GameState = createInitialState(timeControl);

  // Label is used by matchmaker and listing — encode timeControl into it
  const label = JSON.stringify({ timeControl });

  logger.debug("Match initialised — timeControl: %s", timeControl);

  return {
    state,
    tickRate: 1,   // 1 tick/second — enough for a turn-based game + timer countdown
    label,
  };
};

// ─── matchJoinAttempt ────────────────────────────────────────────────────────

const matchJoinAttempt: nkruntime.MatchJoinAttemptFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  presence: nkruntime.Presence,
  metadata: { [key: string]: any }
): { state: nkruntime.MatchState; accept: boolean; rejectMessage?: string } {
  const gs = state as GameState;

  // Reject if match already has 2 players
  if (gs.playerOrder.length >= 2) {
    return { state, accept: false, rejectMessage: "Match is full" };
  }

  // Reject if game already started (reconnection not supported in this phase)
  if (gs.status === "finished") {
    return { state, accept: false, rejectMessage: "Match has ended" };
  }

  return { state, accept: true };
};

// ─── matchJoin ───────────────────────────────────────────────────────────────

const matchJoin: nkruntime.MatchJoinFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  presences: nkruntime.Presence[]
): { state: nkruntime.MatchState } | null {
  const gs = state as GameState;

  for (var i = 0; i < presences.length; i++) {
    const p = presences[i];

    // Assign symbol: first player = X, second = O
    const symbol: "X" | "O" = gs.playerOrder.length === 0 ? "X" : "O";

    gs.players[p.userId] = {
      userId: p.userId,
      sessionId: p.sessionId,
      username: p.username,
      symbol,
    };
    gs.playerOrder.push(p.userId);

    logger.debug("Player joined: %s (%s)", p.username, symbol);

    // Notify the room that this player connected
    dispatcher.broadcastMessage(
      OpCode.PLAYER_JOINED,
      JSON.stringify({ userId: p.userId, username: p.username, symbol }),
      null,
      null,
      true
    );
  }

  // Start the game when the second player joins
  if (gs.playerOrder.length === 2) {
    gs.status = "playing";
    gs.currentTurn = gs.playerOrder[0]; // X goes first

    // Initialise per-player clocks
    const seconds = getTimeControlSeconds(gs.timeControl);
    if (seconds > 0) {
      gs.playerTimes[gs.playerOrder[0]] = seconds;
      gs.playerTimes[gs.playerOrder[1]] = seconds;
    }

    logger.info("Game started — %s vs %s (timeControl: %s)", gs.playerOrder[0], gs.playerOrder[1], gs.timeControl);
    broadcastState(dispatcher, gs);
  }

  return { state: gs };
};

// ─── matchLeave ──────────────────────────────────────────────────────────────

const matchLeave: nkruntime.MatchLeaveFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  presences: nkruntime.Presence[]
): { state: nkruntime.MatchState } | null {
  const gs = state as GameState;

  for (var i = 0; i < presences.length; i++) {
    const p = presences[i];
    logger.debug("Player left: %s", p.username);

    dispatcher.broadcastMessage(
      OpCode.PLAYER_LEFT,
      JSON.stringify({ userId: p.userId, username: p.username }),
      null,
      null,
      true
    );

    // If a game was in progress, the remaining player wins by forfeit
    if (gs.status === "playing" && gs.playerOrder.length === 2) {
      const winnerId = getOpponentId(gs, p.userId);
      gs.status = "finished";
      gs.winner = winnerId;

      var forfeitWinner = gs.players[winnerId];
      if (forfeitWinner) {
        recordWin(nk, logger, winnerId, forfeitWinner.username);
      }

      dispatcher.broadcastMessage(
        OpCode.GAME_OVER,
        JSON.stringify({
          winner: winnerId,
          winnerSymbol: gs.players[winnerId]
            ? gs.players[winnerId].symbol
            : null,
          reason: "forfeit",
          board: gs.board,
        }),
        null,
        null,
        true
      );

      logger.info(
        "Game over (forfeit) — winner: %s",
        gs.players[winnerId] ? gs.players[winnerId].username : winnerId
      );
    }
  }

  return { state: gs };
};

// ─── matchLoop ───────────────────────────────────────────────────────────────

const matchLoop: nkruntime.MatchLoopFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  messages: nkruntime.MatchMessage[]
): { state: nkruntime.MatchState } | null {
  const gs = state as GameState;

  // ── Terminate empty/finished matches after a grace period ──────────────────
  if (gs.status === "finished" || gs.playerOrder.length === 0) {
    return null; // returning null ends the match
  }

  // ── Per-player clock (timed modes only) ────────────────────────────────────
  if (gs.status === "playing" && gs.timeControl !== "endless") {
    // Decrement only the current player's total time
    if (gs.playerTimes[gs.currentTurn] !== undefined) {
      gs.playerTimes[gs.currentTurn] -= 1;

      if (gs.playerTimes[gs.currentTurn] <= 0) {
        gs.playerTimes[gs.currentTurn] = 0;

        const loserId  = gs.currentTurn;
        const winnerId = getOpponentId(gs, loserId);
        gs.status = "finished";
        gs.winner = winnerId;

        var timeoutWinner = gs.players[winnerId];
        if (timeoutWinner) {
          recordWin(nk, logger, winnerId, timeoutWinner.username);
        }

        dispatcher.broadcastMessage(
          OpCode.GAME_OVER,
          JSON.stringify({
            winner:       winnerId,
            winnerSymbol: gs.players[winnerId] ? gs.players[winnerId].symbol : null,
            reason:       "timeout",
            board:        gs.board,
          }),
          null, null, true
        );

        logger.info("Game over (timeout) — winner: %s", gs.players[winnerId] ? gs.players[winnerId].username : winnerId);
        return { state: gs };
      }
    }
  }

  // ── Process incoming messages ───────────────────────────────────────────────
  for (var i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.opCode !== OpCode.MAKE_MOVE) {
      continue; // ignore unknown opcodes
    }

    // ── Guard: game must be in progress ──────────────────────────────────────
    if (gs.status !== "playing") {
      logger.warn("Move rejected — game not in progress (status: %s)", gs.status);
      continue;
    }

    // ── Guard: must be the sender's turn ─────────────────────────────────────
    if (msg.sender.userId !== gs.currentTurn) {
      logger.warn(
        "Move rejected — not %s's turn (current: %s)",
        msg.sender.userId,
        gs.currentTurn
      );
      continue;
    }

    // ── Parse and validate position ───────────────────────────────────────────
    let moveData: { position: number };
    try {
      moveData = JSON.parse(nk.binaryToString(msg.data));
    } catch (e) {
      logger.warn("Move rejected — invalid JSON from %s", msg.sender.userId);
      continue;
    }

    const pos = moveData.position;

    if (typeof pos !== "number" || pos < 0 || pos > 8 || pos !== Math.floor(pos)) {
      logger.warn("Move rejected — invalid position %s", pos);
      continue;
    }

    // ── Guard: cell must be empty ─────────────────────────────────────────────
    if (gs.board[pos] !== null) {
      logger.warn("Move rejected — cell %d already occupied", pos);
      continue;
    }

    // ── Apply move ────────────────────────────────────────────────────────────
    const playerInfo = gs.players[msg.sender.userId];
    gs.board[pos] = playerInfo.symbol;

    logger.debug(
      "Move accepted — %s placed %s at position %d",
      playerInfo.username,
      playerInfo.symbol,
      pos
    );

    // ── Check win ─────────────────────────────────────────────────────────────
    const winningSymbol = checkWinner(gs.board);
    if (winningSymbol !== null) {
      // Find who owns this symbol
      var winnerId = "";
      var playerIds = Object.keys(gs.players);
      for (var j = 0; j < playerIds.length; j++) {
        if (gs.players[playerIds[j]].symbol === winningSymbol) {
          winnerId = playerIds[j];
          break;
        }
      }

      gs.status = "finished";
      gs.winner = winnerId;

      var matchWinner = gs.players[winnerId];
      if (matchWinner) {
        recordWin(nk, logger, winnerId, matchWinner.username);
      }

      broadcastState(dispatcher, gs);

      dispatcher.broadcastMessage(
        OpCode.GAME_OVER,
        JSON.stringify({
          winner: winnerId,
          winnerSymbol: winningSymbol,
          reason: "win",
          board: gs.board,
        }),
        null,
        null,
        true
      );

      logger.info(
        "Game over (win) — winner: %s (%s)",
        gs.players[winnerId] ? gs.players[winnerId].username : winnerId,
        winningSymbol
      );
      return { state: gs };
    }

    // ── Check draw ────────────────────────────────────────────────────────────
    if (isBoardFull(gs.board)) {
      gs.status = "finished";
      gs.winner = "draw";

      broadcastState(dispatcher, gs);

      dispatcher.broadcastMessage(
        OpCode.GAME_OVER,
        JSON.stringify({
          winner: null,
          winnerSymbol: null,
          reason: "draw",
          board: gs.board,
        }),
        null,
        null,
        true
      );

      logger.info("Game over (draw)");
      return { state: gs };
    }

    // ── Advance turn ──────────────────────────────────────────────────────────
    gs.currentTurn = getOpponentId(gs, msg.sender.userId);
  }

  // Broadcast state every tick so late-mounting clients (GameBoard) always
  // receive the current state within 1 second of joining.
  if (gs.status === "playing") {
    broadcastState(dispatcher, gs);
  }

  return { state: gs };
};

// ─── matchTerminate ──────────────────────────────────────────────────────────

const matchTerminate: nkruntime.MatchTerminateFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  graceSeconds: number
): { state: nkruntime.MatchState } | null {
  logger.info("Match terminating — grace period: %ds", graceSeconds);
  return { state };
};

// ─── matchSignal ─────────────────────────────────────────────────────────────

const matchSignal: nkruntime.MatchSignalFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  dispatcher: nkruntime.MatchDispatcher,
  tick: number,
  state: nkruntime.MatchState,
  data: string
): { state: nkruntime.MatchState; data?: string } | null {
  return { state };
};

// ─── Exported handler object (consumed by main.ts) ───────────────────────────

const matchHandler: nkruntime.MatchHandler = {
  matchInit,
  matchJoinAttempt,
  matchJoin,
  matchLeave,
  matchLoop,
  matchTerminate,
  matchSignal,
};
