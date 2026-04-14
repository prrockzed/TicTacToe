"use strict";
// Shared types for the Tic-Tac-Toe Nakama runtime.
// No ES module imports/exports — all declarations are global for outFile bundling.
var OpCode = {
    GAME_STATE: 1, // Server → Client : full game state
    MAKE_MOVE: 2, // Client → Server : { position: 0-8 }
    GAME_OVER: 3, // Server → Client : { winner, board }
    TIMER_UPDATE: 4, // Server → Client : { timeRemaining }
    PLAYER_JOINED: 5, // Server → Client : player info
    PLAYER_LEFT: 6, // Server → Client : player disconnected
};
var WIN_LINES = [
    [0, 1, 2], // top row
    [3, 4, 5], // middle row
    [6, 7, 8], // bottom row
    [0, 3, 6], // left column
    [1, 4, 7], // middle column
    [2, 5, 8], // right column
    [0, 4, 8], // diagonal top-left to bottom-right
    [2, 4, 6], // diagonal top-right to bottom-left
];
var TIMED_MODE_TURN_SECONDS = 30;
// Nakama Match Handler — server-authoritative Tic-Tac-Toe logic.
// The client only sends OpCode.MAKE_MOVE with a position (0-8).
// The server validates, applies, and broadcasts the canonical GameState.
// ─── Helpers ─────────────────────────────────────────────────────────────────
function createInitialState(gameMode) {
    return {
        board: [null, null, null, null, null, null, null, null, null],
        players: {},
        playerOrder: [],
        currentTurn: "",
        status: "waiting",
        winner: null,
        gameMode: gameMode,
        timerEnabled: gameMode === "timed",
        turnTimeRemaining: TIMED_MODE_TURN_SECONDS,
    };
}
function checkWinner(board) {
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
function isBoardFull(board) {
    for (var i = 0; i < board.length; i++) {
        if (board[i] === null)
            return false;
    }
    return true;
}
function getOpponentId(state, userId) {
    return state.playerOrder[0] === userId
        ? state.playerOrder[1]
        : state.playerOrder[0];
}
function broadcastState(dispatcher, state) {
    dispatcher.broadcastMessage(OpCode.GAME_STATE, JSON.stringify(state), null, // presences: null = broadcast to all
    null, // sender
    true // reliable
    );
}
// ─── matchInit ───────────────────────────────────────────────────────────────
var matchInit = function (ctx, logger, nk, params) {
    var gameMode = params["gameMode"] === "timed" ? "timed" : "classic";
    var state = createInitialState(gameMode);
    // Label is used by matchmaker and listing — encode gameMode into it
    var label = JSON.stringify({ gameMode: gameMode });
    logger.debug("Match initialised — mode: %s", gameMode);
    return {
        state: state,
        tickRate: 1, // 1 tick/second — enough for a turn-based game + timer countdown
        label: label,
    };
};
// ─── matchJoinAttempt ────────────────────────────────────────────────────────
var matchJoinAttempt = function (ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
    var gs = state;
    // Reject if match already has 2 players
    if (gs.playerOrder.length >= 2) {
        return { state: state, accept: false, rejectMessage: "Match is full" };
    }
    // Reject if game already started (reconnection not supported in this phase)
    if (gs.status === "finished") {
        return { state: state, accept: false, rejectMessage: "Match has ended" };
    }
    return { state: state, accept: true };
};
// ─── matchJoin ───────────────────────────────────────────────────────────────
var matchJoin = function (ctx, logger, nk, dispatcher, tick, state, presences) {
    var gs = state;
    for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        // Assign symbol: first player = X, second = O
        var symbol = gs.playerOrder.length === 0 ? "X" : "O";
        gs.players[p.userId] = {
            userId: p.userId,
            sessionId: p.sessionId,
            username: p.username,
            symbol: symbol,
        };
        gs.playerOrder.push(p.userId);
        logger.debug("Player joined: %s (%s)", p.username, symbol);
        // Notify the room that this player connected
        dispatcher.broadcastMessage(OpCode.PLAYER_JOINED, JSON.stringify({ userId: p.userId, username: p.username, symbol: symbol }), null, null, true);
    }
    // Start the game when the second player joins
    if (gs.playerOrder.length === 2) {
        gs.status = "playing";
        gs.currentTurn = gs.playerOrder[0]; // X goes first
        if (gs.timerEnabled) {
            gs.turnTimeRemaining = TIMED_MODE_TURN_SECONDS;
        }
        logger.info("Game started — %s vs %s", gs.playerOrder[0], gs.playerOrder[1]);
        broadcastState(dispatcher, gs);
    }
    return { state: gs };
};
// ─── matchLeave ──────────────────────────────────────────────────────────────
var matchLeave = function (ctx, logger, nk, dispatcher, tick, state, presences) {
    var gs = state;
    for (var i = 0; i < presences.length; i++) {
        var p = presences[i];
        logger.debug("Player left: %s", p.username);
        dispatcher.broadcastMessage(OpCode.PLAYER_LEFT, JSON.stringify({ userId: p.userId, username: p.username }), null, null, true);
        // If a game was in progress, the remaining player wins by forfeit
        if (gs.status === "playing" && gs.playerOrder.length === 2) {
            var winnerId = getOpponentId(gs, p.userId);
            gs.status = "finished";
            gs.winner = winnerId;
            dispatcher.broadcastMessage(OpCode.GAME_OVER, JSON.stringify({
                winner: winnerId,
                winnerSymbol: gs.players[winnerId]
                    ? gs.players[winnerId].symbol
                    : null,
                reason: "forfeit",
                board: gs.board,
            }), null, null, true);
            logger.info("Game over (forfeit) — winner: %s", gs.players[winnerId] ? gs.players[winnerId].username : winnerId);
        }
    }
    return { state: gs };
};
// ─── matchLoop ───────────────────────────────────────────────────────────────
var matchLoop = function (ctx, logger, nk, dispatcher, tick, state, messages) {
    var gs = state;
    // ── Terminate empty/finished matches after a grace period ──────────────────
    if (gs.status === "finished" || gs.playerOrder.length === 0) {
        return null; // returning null ends the match
    }
    // ── Timer countdown (timed mode only) ──────────────────────────────────────
    if (gs.status === "playing" && gs.timerEnabled) {
        gs.turnTimeRemaining -= 1; // tickRate = 1 tick/sec
        dispatcher.broadcastMessage(OpCode.TIMER_UPDATE, JSON.stringify({ timeRemaining: gs.turnTimeRemaining }), null, null, false // unreliable ok for frequent timer ticks
        );
        // Time's up — current player forfeits their turn (loses the match)
        if (gs.turnTimeRemaining <= 0) {
            var loserId = gs.currentTurn;
            var winnerId_1 = getOpponentId(gs, loserId);
            gs.status = "finished";
            gs.winner = winnerId_1;
            dispatcher.broadcastMessage(OpCode.GAME_OVER, JSON.stringify({
                winner: winnerId_1,
                winnerSymbol: gs.players[winnerId_1]
                    ? gs.players[winnerId_1].symbol
                    : null,
                reason: "timeout",
                board: gs.board,
            }), null, null, true);
            logger.info("Game over (timeout) — winner: %s", gs.players[winnerId_1] ? gs.players[winnerId_1].username : winnerId_1);
            return { state: gs };
        }
    }
    // ── Process incoming messages ───────────────────────────────────────────────
    for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
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
            logger.warn("Move rejected — not %s's turn (current: %s)", msg.sender.userId, gs.currentTurn);
            continue;
        }
        // ── Parse and validate position ───────────────────────────────────────────
        var moveData = void 0;
        try {
            moveData = JSON.parse(nk.binaryToString(msg.data));
        }
        catch (e) {
            logger.warn("Move rejected — invalid JSON from %s", msg.sender.userId);
            continue;
        }
        var pos = moveData.position;
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
        var playerInfo = gs.players[msg.sender.userId];
        gs.board[pos] = playerInfo.symbol;
        logger.debug("Move accepted — %s placed %s at position %d", playerInfo.username, playerInfo.symbol, pos);
        // ── Check win ─────────────────────────────────────────────────────────────
        var winningSymbol = checkWinner(gs.board);
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
            broadcastState(dispatcher, gs);
            dispatcher.broadcastMessage(OpCode.GAME_OVER, JSON.stringify({
                winner: winnerId,
                winnerSymbol: winningSymbol,
                reason: "win",
                board: gs.board,
            }), null, null, true);
            logger.info("Game over (win) — winner: %s (%s)", gs.players[winnerId] ? gs.players[winnerId].username : winnerId, winningSymbol);
            return { state: gs };
        }
        // ── Check draw ────────────────────────────────────────────────────────────
        if (isBoardFull(gs.board)) {
            gs.status = "finished";
            gs.winner = "draw";
            broadcastState(dispatcher, gs);
            dispatcher.broadcastMessage(OpCode.GAME_OVER, JSON.stringify({
                winner: null,
                winnerSymbol: null,
                reason: "draw",
                board: gs.board,
            }), null, null, true);
            logger.info("Game over (draw)");
            return { state: gs };
        }
        // ── Advance turn ──────────────────────────────────────────────────────────
        gs.currentTurn = getOpponentId(gs, msg.sender.userId);
        if (gs.timerEnabled) {
            gs.turnTimeRemaining = TIMED_MODE_TURN_SECONDS;
        }
        broadcastState(dispatcher, gs);
    }
    return { state: gs };
};
// ─── matchTerminate ──────────────────────────────────────────────────────────
var matchTerminate = function (ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
    logger.info("Match terminating — grace period: %ds", graceSeconds);
    return { state: state };
};
// ─── matchSignal ─────────────────────────────────────────────────────────────
var matchSignal = function (ctx, logger, nk, dispatcher, tick, state, data) {
    return { state: state };
};
// ─── Exported handler object (consumed by main.ts) ───────────────────────────
var matchHandler = {
    matchInit: matchInit,
    matchJoinAttempt: matchJoinAttempt,
    matchJoin: matchJoin,
    matchLeave: matchLeave,
    matchLoop: matchLoop,
    matchTerminate: matchTerminate,
    matchSignal: matchSignal,
};
// Nakama TypeScript Runtime — Entry Point
// The Nakama runtime discovers this function by its global name: InitModule.
var MODULE_NAME = "tictactoe";
function InitModule(ctx, logger, nk, initializer) {
    logger.info("Tic-Tac-Toe module initializing...");
    // Phase 2: Register the match handler
    initializer.registerMatch(MODULE_NAME, matchHandler);
    logger.info("Match handler registered: %s", MODULE_NAME);
    // Phase 3: Matchmaking hooks registered here
    // Phase 6: Leaderboard RPCs registered here
    logger.info("Tic-Tac-Toe module initialized.");
}
