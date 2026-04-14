// Nakama TypeScript Runtime — Entry Point
// The Nakama runtime discovers this function by its global name: InitModule.

const MODULE_NAME = "tictactoe";

function InitModule(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer
): Error | void {
  logger.info("Tic-Tac-Toe module initializing...");

  // Phase 2: Register the match handler
  initializer.registerMatch(MODULE_NAME, matchHandler);
  logger.info("Match handler registered: %s", MODULE_NAME);

  // Phase 3: Matchmaking hooks registered here
  // Phase 6: Leaderboard RPCs registered here

  logger.info("Tic-Tac-Toe module initialized.");
}
