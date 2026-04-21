"use strict";
// Shared types for the Tic-Tac-Toe Nakama runtime.
// No ES module imports/exports — all declarations are global for outFile bundling.
// Returns total seconds for a given time control. 0 = no limit.
function getTimeControlSeconds(tc) {
    if (tc === "10s")
        return 10;
    if (tc === "30s")
        return 30;
    if (tc === "1m")
        return 60;
    return 0; // endless
}
var OpCode = {
    GAME_STATE: 1, // Server → Client : full game state
    MAKE_MOVE: 2, // Client → Server : { position: 0-8 }
    GAME_OVER: 3, // Server → Client : { winner, winnerSymbol, reason, board }
    TIMER_UPDATE: 4, // reserved
    PLAYER_JOINED: 5, // Server → Client : player info
    PLAYER_LEFT: 6, // Server → Client : player disconnected
    RESIGN: 7, // Client → Server : player voluntarily resigns
};
var WIN_LINES = [
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
var MODULE_NAME = "tictactoe";
// RPC function IDs — registered in InitModule and called by the frontend
var RPC_CREATE_ROOM = "createRoom";
var RPC_LIST_ROOMS = "listRooms";
var RPC_GET_LEADERBOARD = "getLeaderboard";
var RPC_GET_STATS = "getStats";
// Leaderboard
var LEADERBOARD_ID = "tictactoe_wins";
// Leaderboard + per-player stats for Tic-Tac-Toe.
// Uses Nakama Storage for W/D/L counts and Nakama Leaderboard for total points.
// Win = 2 pts, Draw = 1 pt, Loss = 0 pts.
// All declarations are global — no ES module exports (outFile bundling).
var STATS_COLLECTION = "player_stats";
var STATS_KEY = "stats";
// Called from InitModule to ensure the leaderboard exists before any match runs.
function initLeaderboard(nk, logger) {
    try {
        nk.leaderboardCreate(LEADERBOARD_ID, true, // authoritative — only server writes
        "descending" /* nkruntime.SortOrder.DESCENDING */, // higher score = better rank
        "increment" /* nkruntime.Operator.INCREMENTAL */, // each write increments the score
        null, // no automatic reset (lifetime leaderboard)
        null, // no metadata
        true // enable rank tracking
        );
        logger.info("Leaderboard ready: %s", LEADERBOARD_ID);
    }
    catch (e) {
        logger.debug("Leaderboard init skipped (likely already exists): %s", e);
    }
}
// Record a game result for a player.
// Increments the W/D/L count in Nakama Storage and adds points to the leaderboard.
function recordResult(nk, logger, userId, username, result) {
    try {
        // ── Read current stats from storage ──────────────────────────────────────
        var reads = [
            { collection: STATS_COLLECTION, key: STATS_KEY, userId: userId },
        ];
        var objects = nk.storageRead(reads);
        var stats = { wins: 0, draws: 0, losses: 0 };
        if (objects.length > 0 && objects[0].value) {
            var stored = objects[0].value;
            stats.wins = stored.wins || 0;
            stats.draws = stored.draws || 0;
            stats.losses = stored.losses || 0;
        }
        // ── Increment the right counter ───────────────────────────────────────────
        if (result === "win")
            stats.wins += 1;
        else if (result === "draw")
            stats.draws += 1;
        else
            stats.losses += 1;
        // ── Write updated stats back to storage ───────────────────────────────────
        var writes = [{
                collection: STATS_COLLECTION,
                key: STATS_KEY,
                userId: userId,
                value: stats,
                permissionRead: 2, // public read
                permissionWrite: 0, // server-only write
            }];
        nk.storageWrite(writes);
        // ── Add points to leaderboard (INCREMENTAL) ───────────────────────────────
        // Win = 2 pts, Draw = 1 pt, Loss = 0 pts
        // Always write (even 0) so every player who has played appears on the leaderboard.
        var points = result === "win" ? 2 : result === "draw" ? 1 : 0;
        nk.leaderboardRecordWrite(LEADERBOARD_ID, userId, username, points, 0, undefined);
        logger.debug("Result recorded: %s (%s) — %s, +%d pts", username, userId, result, points);
    }
    catch (e) {
        logger.warn("Failed to record result for %s: %s", username, e);
    }
}
// RPC: getLeaderboard
// Returns the global top-10 with W/D/L stats and the caller's own record.
var rpcGetLeaderboard = function (ctx, logger, nk, _payload) {
    var _a, _b;
    try {
        // ── Fetch leaderboard records ─────────────────────────────────────────────
        var result = nk.leaderboardRecordsList(LEADERBOARD_ID, ctx.userId ? [ctx.userId] : undefined, 10, undefined, 0);
        var records = (_a = result.records) !== null && _a !== void 0 ? _a : [];
        var ownerRecs = (_b = result.ownerRecords) !== null && _b !== void 0 ? _b : [];
        // ── Collect all userIds to batch-read storage stats ───────────────────────
        var allIds = [];
        for (var i = 0; i < records.length; i++) {
            allIds.push(records[i].ownerId);
        }
        if (ctx.userId) {
            var found = false;
            for (var m = 0; m < allIds.length; m++) {
                if (allIds[m] === ctx.userId) {
                    found = true;
                    break;
                }
            }
            if (!found)
                allIds.push(ctx.userId);
        }
        // ── Batch-read W/D/L stats from storage ───────────────────────────────────
        var statsMap = {};
        if (allIds.length > 0) {
            var readReqs = [];
            for (var j = 0; j < allIds.length; j++) {
                readReqs.push({ collection: STATS_COLLECTION, key: STATS_KEY, userId: allIds[j] });
            }
            var storageObjs = nk.storageRead(readReqs);
            for (var k = 0; k < storageObjs.length; k++) {
                var obj = storageObjs[k];
                var v = obj.value;
                statsMap[obj.userId] = {
                    wins: v.wins || 0,
                    draws: v.draws || 0,
                    losses: v.losses || 0,
                };
            }
        }
        // ── Attach W/D/L stats to a leaderboard record ────────────────────────────
        var withStats = function (r) {
            var s = statsMap[r.ownerId] || { wins: 0, draws: 0, losses: 0 };
            return {
                ownerId: r.ownerId,
                username: r.username,
                score: r.score,
                rank: r.rank,
                wins: s.wins,
                draws: s.draws,
                losses: s.losses,
            };
        };
        return JSON.stringify({
            records: records.map(withStats),
            ownRecord: ownerRecs.length > 0 ? withStats(ownerRecs[0]) : null,
        });
    }
    catch (e) {
        logger.error("rpcGetLeaderboard error: %s", e);
        return JSON.stringify({ records: [], ownRecord: null });
    }
};
// Nakama Match Handler — server-authoritative Tic-Tac-Toe logic.
// The client only sends OpCode.MAKE_MOVE with a position (0-8).
// The server validates, applies, and broadcasts the canonical GameState.
// ─── Helpers ─────────────────────────────────────────────────────────────────
function createInitialState(timeControl) {
    return {
        board: [null, null, null, null, null, null, null, null, null],
        players: {},
        playerOrder: [],
        currentTurn: "",
        status: "waiting",
        winner: null,
        timeControl: timeControl,
        playerTimes: {},
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
    var tc = params["timeControl"];
    var timeControl = (tc === "10s" || tc === "30s" || tc === "1m") ? tc : "endless";
    var state = createInitialState(timeControl);
    // Label is used by matchmaker and listing — encode timeControl into it
    var label = JSON.stringify({ timeControl: timeControl });
    logger.debug("Match initialised — timeControl: %s", timeControl);
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
        // Initialise per-player clocks
        var seconds = getTimeControlSeconds(gs.timeControl);
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
            var forfeitWinner = gs.players[winnerId];
            if (forfeitWinner) {
                recordResult(nk, logger, winnerId, forfeitWinner.username, "win");
            }
            var forfeitLoser = gs.players[p.userId];
            if (forfeitLoser) {
                recordResult(nk, logger, p.userId, forfeitLoser.username, "loss");
            }
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
    // ── Per-player clock (timed modes only) ────────────────────────────────────
    if (gs.status === "playing" && gs.timeControl !== "endless") {
        // Decrement only the current player's total time
        if (gs.playerTimes[gs.currentTurn] !== undefined) {
            gs.playerTimes[gs.currentTurn] -= 1;
            if (gs.playerTimes[gs.currentTurn] <= 0) {
                gs.playerTimes[gs.currentTurn] = 0;
                var loserId = gs.currentTurn;
                var winnerId_1 = getOpponentId(gs, loserId);
                gs.status = "finished";
                gs.winner = winnerId_1;
                var timeoutWinner = gs.players[winnerId_1];
                if (timeoutWinner) {
                    recordResult(nk, logger, winnerId_1, timeoutWinner.username, "win");
                }
                var timeoutLoser = gs.players[loserId];
                if (timeoutLoser) {
                    recordResult(nk, logger, loserId, timeoutLoser.username, "loss");
                }
                dispatcher.broadcastMessage(OpCode.GAME_OVER, JSON.stringify({
                    winner: winnerId_1,
                    winnerSymbol: gs.players[winnerId_1] ? gs.players[winnerId_1].symbol : null,
                    reason: "timeout",
                    board: gs.board,
                }), null, null, true);
                logger.info("Game over (timeout) — winner: %s", gs.players[winnerId_1] ? gs.players[winnerId_1].username : winnerId_1);
                return { state: gs };
            }
        }
    }
    // ── Process incoming messages ───────────────────────────────────────────────
    for (var i = 0; i < messages.length; i++) {
        var msg = messages[i];
        // ── Handle resign ────────────────────────────────────────────────────────
        if (msg.opCode === OpCode.RESIGN) {
            if (gs.status !== "playing")
                continue;
            var loserId = msg.sender.userId;
            var winnerId_2 = getOpponentId(gs, loserId);
            gs.status = "finished";
            gs.winner = winnerId_2;
            var resignWinner = gs.players[winnerId_2];
            if (resignWinner) {
                recordResult(nk, logger, winnerId_2, resignWinner.username, "win");
            }
            var resignLoser = gs.players[loserId];
            if (resignLoser) {
                recordResult(nk, logger, loserId, resignLoser.username, "loss");
            }
            dispatcher.broadcastMessage(OpCode.GAME_OVER, JSON.stringify({
                winner: winnerId_2,
                winnerSymbol: gs.players[winnerId_2] ? gs.players[winnerId_2].symbol : null,
                reason: "resign",
                board: gs.board,
            }), null, null, true);
            logger.info("Game over (resign) — %s resigned, winner: %s", gs.players[loserId] ? gs.players[loserId].username : loserId, gs.players[winnerId_2] ? gs.players[winnerId_2].username : winnerId_2);
            return { state: gs };
        }
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
            var matchLoserId = getOpponentId(gs, winnerId);
            var matchWinner = gs.players[winnerId];
            if (matchWinner) {
                recordResult(nk, logger, winnerId, matchWinner.username, "win");
            }
            var matchLoser = gs.players[matchLoserId];
            if (matchLoser) {
                recordResult(nk, logger, matchLoserId, matchLoser.username, "loss");
            }
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
            for (var d = 0; d < gs.playerOrder.length; d++) {
                var drawPlayerId = gs.playerOrder[d];
                var drawPlayer = gs.players[drawPlayerId];
                if (drawPlayer) {
                    recordResult(nk, logger, drawPlayerId, drawPlayer.username, "draw");
                }
            }
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
    }
    // Broadcast state every tick so late-mounting clients (GameBoard) always
    // receive the current state within 1 second of joining.
    if (gs.status === "playing") {
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
// Nakama Matchmaking System
//
// Flows supported:
//  1. Auto-matchmaking  — client adds a ticket; when 2 players with the same
//                         timeControl match, matchmakerMatched creates the match.
//  2. Create room       — rpcCreateRoom creates a named match, returns matchId.
//  3. List rooms        — rpcListRooms returns open matches (1 player waiting).
// ─── matchmakerMatched ────────────────────────────────────────────────────────
var matchmakerMatched = function (ctx, logger, nk, matches) {
    if (matches.length !== 2) {
        logger.error("matchmakerMatched: expected 2 players, got %d — aborting", matches.length);
        return;
    }
    // Both players submitted the same timeControl (enforced by query), so read from first
    var props = matches[0].properties;
    var tc = props ? props["timeControl"] : undefined;
    var timeControl = (tc === "10s" || tc === "30s" || tc === "1m") ? tc : "endless";
    var matchId = nk.matchCreate(MODULE_NAME, { timeControl: timeControl });
    logger.info("Matchmaker paired %s vs %s — match %s (timeControl: %s)", matches[0].presence.username, matches[1].presence.username, matchId, timeControl);
    return matchId;
};
// ─── RPC: createRoom ──────────────────────────────────────────────────────────
// Payload:  { "timeControl": "10s" | "30s" | "1m" | "endless" }
// Response: { "matchId": "<id>" }
var rpcCreateRoom = function (ctx, logger, nk, payload) {
    var timeControl = "endless";
    if (payload && payload !== "") {
        try {
            var data = JSON.parse(payload);
            var tc = data.timeControl;
            if (tc === "10s" || tc === "30s" || tc === "1m" || tc === "endless") {
                timeControl = tc;
            }
        }
        catch (e) {
            logger.warn("createRoom: invalid JSON payload — defaulting to endless");
        }
    }
    var matchId = nk.matchCreate(MODULE_NAME, { timeControl: timeControl });
    logger.info("Room created: %s (timeControl: %s) by user: %s", matchId, timeControl, ctx.userId);
    return JSON.stringify({ matchId: matchId });
};
// ─── RPC: listRooms ───────────────────────────────────────────────────────────
// Payload:  optional { "timeControl": "10s" | "30s" | "1m" | "endless" }
// Response: { "rooms": [{ matchId, timeControl, players }] }
var rpcListRooms = function (ctx, logger, nk, payload) {
    var filterTimeControl = null;
    if (payload && payload !== "") {
        try {
            var data = JSON.parse(payload);
            if (data.timeControl)
                filterTimeControl = data.timeControl;
        }
        catch (e) {
            // No filter — return all
        }
    }
    var matches = nk.matchList(20, true, null, 1, 1, "*");
    var rooms = [];
    for (var i = 0; i < matches.length; i++) {
        var m = matches[i];
        var labelTimeControl = "endless";
        if (m.label) {
            try {
                var parsed = JSON.parse(m.label);
                if (parsed.timeControl)
                    labelTimeControl = parsed.timeControl;
            }
            catch (e) {
                // Malformed label
            }
        }
        if (filterTimeControl !== null && labelTimeControl !== filterTimeControl) {
            continue;
        }
        rooms.push({ matchId: m.matchId, timeControl: labelTimeControl, players: m.size });
    }
    logger.debug("listRooms: returning %d open rooms", rooms.length);
    return JSON.stringify({ rooms: rooms });
};
// ─── RPC: getStats ────────────────────────────────────────────────────────────
// Payload:  (none)
// Response: { "activeGames": N, "waitingRooms": N, "playersOnline": N }
var rpcGetStats = function (ctx, logger, nk, _payload) {
    var activeMatches = nk.matchList(100, true, null, 2, 2, "*");
    var waitingMatches = nk.matchList(100, true, null, 1, 1, "*");
    var activeGames = activeMatches.length;
    var waitingRooms = waitingMatches.length;
    var playersOnline = activeGames * 2 + waitingRooms;
    logger.debug("getStats: %d active games, %d waiting rooms", activeGames, waitingRooms);
    return JSON.stringify({ activeGames: activeGames, waitingRooms: waitingRooms, playersOnline: playersOnline });
};
// Nakama TypeScript Runtime — Entry Point
// The Nakama runtime discovers this function by its global name: InitModule.
function InitModule(ctx, logger, nk, initializer) {
    logger.info("Tic-Tac-Toe module initializing...");
    // Phase 2: Register the server-authoritative match handler
    initializer.registerMatch(MODULE_NAME, matchHandler);
    logger.info("Match handler registered: %s", MODULE_NAME);
    // Phase 3: Register matchmaking hook and room RPCs
    initializer.registerMatchmakerMatched(matchmakerMatched);
    logger.info("Matchmaker hook registered");
    initializer.registerRpc(RPC_CREATE_ROOM, rpcCreateRoom);
    logger.info("RPC registered: %s", RPC_CREATE_ROOM);
    initializer.registerRpc(RPC_LIST_ROOMS, rpcListRooms);
    logger.info("RPC registered: %s", RPC_LIST_ROOMS);
    // Phase 6: Leaderboard
    initLeaderboard(nk, logger);
    initializer.registerRpc(RPC_GET_LEADERBOARD, rpcGetLeaderboard);
    logger.info("RPC registered: %s", RPC_GET_LEADERBOARD);
    // Phase 8: Server stats RPC
    initializer.registerRpc(RPC_GET_STATS, rpcGetStats);
    logger.info("RPC registered: %s", RPC_GET_STATS);
    logger.info("Tic-Tac-Toe module initialized.");
}
