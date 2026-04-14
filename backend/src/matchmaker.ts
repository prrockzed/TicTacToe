// Nakama Matchmaking System
//
// Flows supported:
//  1. Auto-matchmaking  — client adds a ticket; when 2 players match,
//                         matchmakerMatched creates a match and returns its ID.
//  2. Create room       — rpcCreateRoom creates a named match, returns matchId.
//  3. List rooms        — rpcListRooms returns open matches (1 player waiting).

// ─── matchmakerMatched ────────────────────────────────────────────────────────
// Called by Nakama when the matchmaker finds exactly 2 compatible players.
// We create the authoritative match and return its ID so both clients join it.

const matchmakerMatched: nkruntime.MatchmakerMatchedFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  matches: nkruntime.MatchmakerResult[]
): string | void {
  // Expect exactly 2 players — validate before proceeding
  if (matches.length !== 2) {
    logger.error(
      "matchmakerMatched: expected 2 players, got %d — aborting",
      matches.length
    );
    return;
  }

  // Read gameMode from the first player's string properties
  // Both players submitted the same gameMode, so reading one is enough
  let gameMode: "classic" | "timed" = "classic";
  const props = matches[0].properties;
  if (props && props["gameMode"] === "timed") {
    gameMode = "timed";
  }

  // Create the authoritative match with gameMode as a param
  const matchId = nk.matchCreate(MODULE_NAME, { gameMode });

  logger.info(
    "Matchmaker paired %s vs %s — match %s (mode: %s)",
    matches[0].presence.username,
    matches[1].presence.username,
    matchId,
    gameMode
  );

  // Returning matchId tells Nakama to send it to both clients automatically
  return matchId;
};

// ─── RPC: createRoom ──────────────────────────────────────────────────────────
// Creates a named match and returns the matchId the client uses to join.
// Payload: { "gameMode": "classic" | "timed" }
// Response: { "matchId": "<id>" }

const rpcCreateRoom: nkruntime.RpcFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  let gameMode: "classic" | "timed" = "classic";

  if (payload && payload !== "") {
    try {
      const data: { gameMode?: string } = JSON.parse(payload);
      if (data.gameMode === "timed") {
        gameMode = "timed";
      }
    } catch (e) {
      logger.warn("createRoom: invalid JSON payload — defaulting to classic");
    }
  }

  const matchId = nk.matchCreate(MODULE_NAME, { gameMode });

  logger.info(
    "Room created: %s (mode: %s) by user: %s",
    matchId,
    gameMode,
    ctx.userId
  );

  return JSON.stringify({ matchId });
};

// ─── RPC: listRooms ───────────────────────────────────────────────────────────
// Returns open authoritative matches that have exactly 1 player (waiting for
// a second player). Clients can join any of these directly by matchId.
// Payload: optional { "gameMode": "classic" | "timed" } to filter by mode
// Response: { "rooms": [{ matchId, gameMode, players }] }

const rpcListRooms: nkruntime.RpcFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  let filterMode: string | null = null;

  if (payload && payload !== "") {
    try {
      const data: { gameMode?: string } = JSON.parse(payload);
      if (data.gameMode === "classic" || data.gameMode === "timed") {
        filterMode = data.gameMode;
      }
    } catch (e) {
      // No filter — return all modes
    }
  }

  // List authoritative matches with exactly 1 player (room creator waiting)
  const matches = nk.matchList(20, true, null, 1, 1, "*");

  const rooms: Array<{ matchId: string; gameMode: string; players: number }> = [];

  for (var i = 0; i < matches.length; i++) {
    var m = matches[i];
    var labelGameMode = "classic";

    if (m.label) {
      try {
        var parsed: { gameMode?: string } = JSON.parse(m.label);
        if (parsed.gameMode === "timed") {
          labelGameMode = "timed";
        }
      } catch (e) {
        // Malformed label — treat as classic
      }
    }

    // Apply gameMode filter if requested
    if (filterMode !== null && labelGameMode !== filterMode) {
      continue;
    }

    rooms.push({
      matchId: m.matchId,
      gameMode: labelGameMode,
      players: m.size,
    });
  }

  logger.debug("listRooms: returning %d open rooms", rooms.length);

  return JSON.stringify({ rooms });
};
