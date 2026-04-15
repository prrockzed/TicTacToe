// Leaderboard system for Tic-Tac-Toe.
// Uses Nakama's built-in leaderboard API to track wins per player.
// All declarations are global — no ES module exports (outFile bundling).

// Called from InitModule to ensure the leaderboard exists before any match runs.
function initLeaderboard(nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
  try {
    nk.leaderboardCreate(
      LEADERBOARD_ID,
      true,                               // authoritative — only server writes
      nkruntime.SortOrder.DESCENDING,     // higher wins = better rank
      nkruntime.Operator.INCREMENTAL,     // each write increments the score
      null,                               // no automatic reset (lifetime leaderboard)
      null,                               // no metadata
      true                                // enable rank tracking
    );
    logger.info("Leaderboard ready: %s", LEADERBOARD_ID);
  } catch (e) {
    // Nakama will throw if the leaderboard already exists with the same config.
    // This is safe to ignore on server restarts.
    logger.debug("Leaderboard init skipped (likely already exists): %s", e);
  }
}

// Increment the win count for a player. Called by the match handler after every win.
function recordWin(
  nk: nkruntime.Nakama,
  logger: nkruntime.Logger,
  userId: string,
  username: string
): void {
  try {
    nk.leaderboardRecordWrite(LEADERBOARD_ID, userId, username, 1, 0, undefined);
    logger.debug("Win recorded: %s (%s)", username, userId);
  } catch (e) {
    logger.warn("Failed to record win for %s: %s", username, e);
  }
}

// RPC: getLeaderboard
// Returns the global top-10 and the caller's own record (even if outside top 10).
const rpcGetLeaderboard: nkruntime.RpcFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  _payload: string
): string {
  try {
    // Single call: top-10 records + caller's own record in ownerRecords
    const result = nk.leaderboardRecordsList(
      LEADERBOARD_ID,
      ctx.userId ? [ctx.userId] : undefined,
      10,
      undefined,
      0
    );

    return JSON.stringify({
      records:   result.records    ?? [],
      ownRecord: (result.ownerRecords && result.ownerRecords.length > 0)
                   ? result.ownerRecords[0]
                   : null,
    });
  } catch (e) {
    logger.error("rpcGetLeaderboard error: %s", e);
    return JSON.stringify({ records: [], ownRecord: null });
  }
};
