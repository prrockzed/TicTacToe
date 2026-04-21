// Leaderboard + per-player stats for Tic-Tac-Toe.
// Uses Nakama Storage for W/D/L counts and Nakama Leaderboard for total points.
// Win = 2 pts, Draw = 1 pt, Loss = 0 pts.
// All declarations are global — no ES module exports (outFile bundling).

type GameResult = "win" | "draw" | "loss";

const STATS_COLLECTION = "player_stats";
const STATS_KEY        = "stats";

// Called from InitModule to ensure the leaderboard exists before any match runs.
function initLeaderboard(nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
  try {
    nk.leaderboardCreate(
      LEADERBOARD_ID,
      true,                               // authoritative — only server writes
      nkruntime.SortOrder.DESCENDING,     // higher score = better rank
      nkruntime.Operator.INCREMENTAL,     // each write increments the score
      null,                               // no automatic reset (lifetime leaderboard)
      null,                               // no metadata
      true                                // enable rank tracking
    );
    logger.info("Leaderboard ready: %s", LEADERBOARD_ID);
  } catch (e) {
    logger.debug("Leaderboard init skipped (likely already exists): %s", e);
  }
}

// Record a game result for a player.
// Increments the W/D/L count in Nakama Storage and adds points to the leaderboard.
function recordResult(
  nk: nkruntime.Nakama,
  logger: nkruntime.Logger,
  userId: string,
  username: string,
  result: GameResult
): void {
  try {
    // ── Read current stats from storage ──────────────────────────────────────
    var reads: nkruntime.StorageReadRequest[] = [
      { collection: STATS_COLLECTION, key: STATS_KEY, userId: userId },
    ];
    var objects = nk.storageRead(reads);
    var stats = { wins: 0, draws: 0, losses: 0 };
    if (objects.length > 0 && objects[0].value) {
      var stored = objects[0].value as { wins?: number; draws?: number; losses?: number };
      stats.wins   = stored.wins   || 0;
      stats.draws  = stored.draws  || 0;
      stats.losses = stored.losses || 0;
    }

    // ── Increment the right counter ───────────────────────────────────────────
    if (result === "win")       stats.wins   += 1;
    else if (result === "draw") stats.draws  += 1;
    else                        stats.losses += 1;

    // ── Write updated stats back to storage ───────────────────────────────────
    var writes: nkruntime.StorageWriteRequest[] = [{
      collection:      STATS_COLLECTION,
      key:             STATS_KEY,
      userId:          userId,
      value:           stats,
      permissionRead:  2,   // public read
      permissionWrite: 0,   // server-only write
    }];
    nk.storageWrite(writes);

    // ── Add points to leaderboard (INCREMENTAL) ───────────────────────────────
    // Win = 2 pts, Draw = 1 pt, Loss = 0 pts
    // Always write (even 0) so every player who has played appears on the leaderboard.
    var points = result === "win" ? 2 : result === "draw" ? 1 : 0;
    nk.leaderboardRecordWrite(LEADERBOARD_ID, userId, username, points, 0, undefined);

    logger.debug("Result recorded: %s (%s) — %s, +%d pts", username, userId, result, points);
  } catch (e) {
    logger.warn("Failed to record result for %s: %s", username, e);
  }
}

// RPC: getLeaderboard
// Returns the global top-10 with W/D/L stats and the caller's own record.
const rpcGetLeaderboard: nkruntime.RpcFunction = function (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  _payload: string
): string {
  try {
    // ── Fetch leaderboard records ─────────────────────────────────────────────
    var result = nk.leaderboardRecordsList(
      LEADERBOARD_ID,
      ctx.userId ? [ctx.userId] : undefined,
      10,
      undefined,
      0
    );

    var records   = result.records      ?? [];
    var ownerRecs = result.ownerRecords ?? [];

    // ── Collect all userIds to batch-read storage stats ───────────────────────
    var allIds: string[] = [];
    for (var i = 0; i < records.length; i++) {
      allIds.push(records[i].ownerId);
    }
    if (ctx.userId) {
      var found = false;
      for (var m = 0; m < allIds.length; m++) {
        if (allIds[m] === ctx.userId) { found = true; break; }
      }
      if (!found) allIds.push(ctx.userId);
    }

    // ── Batch-read W/D/L stats from storage ───────────────────────────────────
    var statsMap: { [uid: string]: { wins: number; draws: number; losses: number } } = {};
    if (allIds.length > 0) {
      var readReqs: nkruntime.StorageReadRequest[] = [];
      for (var j = 0; j < allIds.length; j++) {
        readReqs.push({ collection: STATS_COLLECTION, key: STATS_KEY, userId: allIds[j] });
      }
      var storageObjs = nk.storageRead(readReqs);
      for (var k = 0; k < storageObjs.length; k++) {
        var obj = storageObjs[k];
        var v   = obj.value as { wins?: number; draws?: number; losses?: number };
        statsMap[obj.userId] = {
          wins:   v.wins   || 0,
          draws:  v.draws  || 0,
          losses: v.losses || 0,
        };
      }
    }

    // ── Attach W/D/L stats to a leaderboard record ────────────────────────────
    var withStats = function(r: any) {
      var s = statsMap[r.ownerId] || { wins: 0, draws: 0, losses: 0 };
      return {
        ownerId:  r.ownerId,
        username: r.username,
        score:    r.score,
        rank:     r.rank,
        wins:     s.wins,
        draws:    s.draws,
        losses:   s.losses,
      };
    }

    return JSON.stringify({
      records:   records.map(withStats),
      ownRecord: ownerRecs.length > 0 ? withStats(ownerRecs[0]) : null,
    });
  } catch (e) {
    logger.error("rpcGetLeaderboard error: %s", e);
    return JSON.stringify({ records: [], ownRecord: null });
  }
};
