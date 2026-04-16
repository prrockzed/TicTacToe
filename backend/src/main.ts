// Nakama TypeScript Runtime — Entry Point
// The Nakama runtime discovers this function by its global name: InitModule.

function InitModule(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer
): Error | void {
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
