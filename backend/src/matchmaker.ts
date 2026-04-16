// Nakama Matchmaking System
//
// Flows supported:
//  1. Auto-matchmaking  — client adds a ticket; when 2 players with the same
//                         timeControl match, matchmakerMatched creates the match.
//  2. Create room       — rpcCreateRoom creates a named match, returns matchId.
//  3. List rooms        — rpcListRooms returns open matches (1 player waiting).

// ─── matchmakerMatched ────────────────────────────────────────────────────────

const matchmakerMatched: nkruntime.MatchmakerMatchedFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  matches: nkruntime.MatchmakerResult[]
): string | void {
  if (matches.length !== 2) {
    logger.error("matchmakerMatched: expected 2 players, got %d — aborting", matches.length);
    return;
  }

  // Both players submitted the same timeControl (enforced by query), so read from first
  const props = matches[0].properties;
  const tc    = props ? props["timeControl"] : undefined;
  const timeControl: TimeControl =
    (tc === "10s" || tc === "30s" || tc === "1m") ? tc : "endless";

  const matchId = nk.matchCreate(MODULE_NAME, { timeControl });

  logger.info(
    "Matchmaker paired %s vs %s — match %s (timeControl: %s)",
    matches[0].presence.username,
    matches[1].presence.username,
    matchId,
    timeControl
  );

  return matchId;
};

// ─── RPC: createRoom ──────────────────────────────────────────────────────────
// Payload:  { "timeControl": "10s" | "30s" | "1m" | "endless" }
// Response: { "matchId": "<id>" }

const rpcCreateRoom: nkruntime.RpcFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  let timeControl: TimeControl = "endless";

  if (payload && payload !== "") {
    try {
      const data: { timeControl?: string } = JSON.parse(payload);
      const tc = data.timeControl;
      if (tc === "10s" || tc === "30s" || tc === "1m" || tc === "endless") {
        timeControl = tc;
      }
    } catch (e) {
      logger.warn("createRoom: invalid JSON payload — defaulting to endless");
    }
  }

  const matchId = nk.matchCreate(MODULE_NAME, { timeControl });

  logger.info("Room created: %s (timeControl: %s) by user: %s", matchId, timeControl, ctx.userId);

  return JSON.stringify({ matchId });
};

// ─── RPC: listRooms ───────────────────────────────────────────────────────────
// Payload:  optional { "timeControl": "10s" | "30s" | "1m" | "endless" }
// Response: { "rooms": [{ matchId, timeControl, players }] }

const rpcListRooms: nkruntime.RpcFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  let filterTimeControl: string | null = null;

  if (payload && payload !== "") {
    try {
      const data: { timeControl?: string } = JSON.parse(payload);
      if (data.timeControl) filterTimeControl = data.timeControl;
    } catch (e) {
      // No filter — return all
    }
  }

  const matches = nk.matchList(20, true, null, 1, 1, "*");

  const rooms: Array<{ matchId: string; timeControl: string; players: number }> = [];

  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    var labelTimeControl = "endless";

    if (m.label) {
      try {
        var parsed: { timeControl?: string } = JSON.parse(m.label);
        if (parsed.timeControl) labelTimeControl = parsed.timeControl;
      } catch (e) {
        // Malformed label
      }
    }

    if (filterTimeControl !== null && labelTimeControl !== filterTimeControl) {
      continue;
    }

    rooms.push({ matchId: m.matchId, timeControl: labelTimeControl, players: m.size });
  }

  logger.debug("listRooms: returning %d open rooms", rooms.length);
  return JSON.stringify({ rooms });
};

// ─── RPC: getStats ────────────────────────────────────────────────────────────
// Payload:  (none)
// Response: { "activeGames": N, "waitingRooms": N, "playersOnline": N }

const rpcGetStats: nkruntime.RpcFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  _payload: string
): string {
  const activeMatches  = nk.matchList(100, true, null, 2, 2, "*");
  const waitingMatches = nk.matchList(100, true, null, 1, 1, "*");

  const activeGames  = activeMatches.length;
  const waitingRooms = waitingMatches.length;
  const playersOnline = activeGames * 2 + waitingRooms;

  logger.debug("getStats: %d active games, %d waiting rooms", activeGames, waitingRooms);

  return JSON.stringify({ activeGames, waitingRooms, playersOnline });
};
