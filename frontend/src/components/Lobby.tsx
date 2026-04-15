import { useState, useEffect, useCallback } from "react";
import type { Session, Socket } from "@heroiclabs/nakama-js";
import { nakamaClient } from "../nakama";
import { OpCode, type GameMode } from "../types";
import Leaderboard from "./Leaderboard";

interface Props {
  session:      Session;
  socket:       Socket;
  onMatchFound: (matchId: string, gameMode: GameMode) => void;
  onLogout:     () => void;
}

type Tab         = "find" | "create" | "join" | "ranks";
type LobbyStatus = "idle" | "searching" | "waiting";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ModeSelector({
  value,
  onChange,
}: {
  value: GameMode;
  onChange: (m: GameMode) => void;
}) {
  return (
    <div className="mb-5">
      <p className="text-gray-500 text-xs uppercase tracking-widest mb-2">Game Mode</p>
      <div className="flex gap-2">
        {(["classic", "timed"] as GameMode[]).map(mode => (
          <button
            key={mode}
            onClick={() => onChange(mode)}
            className={`
              flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors
              ${value === mode
                ? "bg-indigo-600 text-white"
                : "bg-gray-800 text-gray-400 hover:text-white"}
            `}
          >
            {mode === "classic" ? "Classic" : "Timed (30s)"}
          </button>
        ))}
      </div>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center py-4 gap-3">
      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-gray-300 text-sm">{label}</p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Lobby({ session, socket, onMatchFound, onLogout }: Props) {
  const [tab,          setTab]         = useState<Tab>("find");
  const [gameMode,     setGameMode]    = useState<GameMode>("classic");
  const [status,       setStatus]      = useState<LobbyStatus>("idle");
  const [error,        setError]       = useState("");
  const [ticket,       setTicket]      = useState<string | null>(null);
  const [waitMatchId,  setWaitMatchId] = useState<string | null>(null); // room creator waits here
  const [roomCode,     setRoomCode]    = useState("");  // created room's code (matchId)
  const [joinCode,     setJoinCode]    = useState("");  // code the user types to join
  const [copied,       setCopied]      = useState(false);

  // ── Stable callback so effects don't re-register on every render ─────────
  const handleMatchFound = useCallback(
    (matchId: string, mode: GameMode) => onMatchFound(matchId, mode),
    [onMatchFound]
  );

  // ── Matchmaker matched — fired when auto-matchmaking succeeds ─────────────
  useEffect(() => {
    socket.onmatchmakermatched = async (matched) => {
      const matchId = matched.match_id ?? "";
      if (!matchId) {
        setError("Matched but received no match ID. Please try again.");
        setStatus("idle");
        return;
      }
      const props = matched.self?.string_properties ?? {};
      const mode: GameMode = props["gameMode"] === "timed" ? "timed" : "classic";

      try {
        await socket.joinMatch(matchId);
        handleMatchFound(matchId, mode);
      } catch (err) {
        console.error("joinMatch after matchmaker:", err);
        setError("Failed to join the matched game. Please try again.");
        setStatus("idle");
      }
    };

    return () => { socket.onmatchmakermatched = () => {}; };
  }, [socket, handleMatchFound]);

  // ── Match data while waiting in a created room ────────────────────────────
  // GAME_STATE (opcode 1) is broadcast by the server when both players have joined.
  useEffect(() => {
    if (status !== "waiting" || !waitMatchId) return;

    socket.onmatchdata = (data) => {
      if (data.op_code === OpCode.GAME_STATE) {
        handleMatchFound(waitMatchId, gameMode);
      }
    };

    return () => { socket.onmatchdata = () => {}; };
  }, [status, waitMatchId, gameMode, socket, handleMatchFound]);

  // ── Tab switch helpers ────────────────────────────────────────────────────
  const switchTab = (t: Tab) => {
    if (status !== "idle") return; // don't switch while in a flow
    setTab(t);
    setError("");
  };

  // ─── Find Random Match ────────────────────────────────────────────────────

  const handleFindMatch = async () => {
    setStatus("searching");
    setError("");
    try {
      const result = await socket.addMatchmaker("*", 2, 2, { gameMode }, {});
      setTicket(result.ticket);
    } catch (err) {
      console.error("addMatchmaker:", err);
      setError("Failed to start matchmaking. Please try again.");
      setStatus("idle");
    }
  };

  const handleCancelSearch = async () => {
    if (ticket) {
      try { await socket.removeMatchmaker(ticket); } catch { /* ignored */ }
    }
    setTicket(null);
    setStatus("idle");
  };

  // ─── Create Room ──────────────────────────────────────────────────────────

  const handleCreateRoom = async () => {
    setStatus("searching");
    setError("");
    try {
      const resp = await nakamaClient.rpc(session, "createRoom", { gameMode });
      // resp.payload is already a parsed object (nakama-js deserialises the JSON)
      const { matchId } = resp.payload as { matchId: string };
      if (!matchId) throw new Error("No matchId returned from createRoom RPC");

      await socket.joinMatch(matchId);
      setRoomCode(matchId);
      setWaitMatchId(matchId);
      setStatus("waiting");
    } catch (err) {
      console.error("createRoom:", err);
      setError("Failed to create room. Please try again.");
      setStatus("idle");
    }
  };

  const handleLeaveRoom = async () => {
    if (waitMatchId) {
      try { await socket.leaveMatch(waitMatchId); } catch { /* ignored */ }
    }
    setWaitMatchId(null);
    setRoomCode("");
    setStatus("idle");
    socket.onmatchdata = () => {};
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard not available */ }
  };

  // ─── Join Room ────────────────────────────────────────────────────────────

  const handleJoinRoom = async () => {
    const code = joinCode.trim();
    if (!code) return;
    setStatus("searching");
    setError("");
    try {
      await socket.joinMatch(code);
      // gameMode is unknown here — Phase 5 GameBoard will read it from GAME_STATE
      handleMatchFound(code, "classic");
    } catch (err) {
      console.error("joinMatch:", err);
      setError("Could not join room. Check the code and try again.");
      setStatus("idle");
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const busy = status !== "idle";

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "radial-gradient(ellipse at 50% 0%, #1e1040 0%, #0a0a12 60%)" }}
    >
      <div className="w-full max-w-sm">

        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-white leading-none">Tic-Tac-Toe</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Hello,{" "}
              <span className="text-gray-300 font-medium">{session.username}</span>
            </p>
          </div>
          <button
            onClick={onLogout}
            disabled={busy}
            className="text-gray-600 hover:text-gray-400 text-xs transition-colors disabled:opacity-0"
          >
            Logout
          </button>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >

          {/* Tabs */}
          <div className="flex border-b border-white/[0.07]">
            {(
              [
                ["find",   "Find Match"],
                ["create", "Create Room"],
                ["join",   "Join Room"],
                ["ranks",  "Rankings"],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button
                key={t}
                onClick={() => switchTab(t)}
                disabled={busy}
                className={`
                  flex-1 py-3 text-xs font-semibold uppercase tracking-wider transition-colors
                  ${tab === t
                    ? "text-white border-b-2 border-indigo-500 -mb-px"
                    : "text-gray-500 hover:text-gray-300"}
                  disabled:pointer-events-none
                `}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="p-5">

            {/* Error message */}
            {error && (
              <div className="mb-4 px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}>
                <p className="text-red-400 text-xs">{error}</p>
              </div>
            )}

            {/* ── FIND MATCH ── */}
            {tab === "find" && (
              <>
                {status === "idle" && (
                  <>
                    <ModeSelector value={gameMode} onChange={setGameMode} />
                    <button
                      onClick={handleFindMatch}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 text-white
                                 font-semibold py-3 rounded-xl transition-colors text-sm"
                    >
                      Find Random Match
                    </button>
                  </>
                )}

                {status === "searching" && (
                  <div className="text-center space-y-4">
                    <Spinner label="Finding a random player…" />
                    <p className="text-gray-600 text-xs">It usually takes about 20 seconds</p>
                    <button
                      onClick={handleCancelSearch}
                      className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300
                                 font-medium py-3 rounded-xl transition-colors text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── CREATE ROOM ── */}
            {tab === "create" && (
              <>
                {status === "idle" && (
                  <>
                    <ModeSelector value={gameMode} onChange={setGameMode} />
                    <button
                      onClick={handleCreateRoom}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 text-white
                                 font-semibold py-3 rounded-xl transition-colors text-sm"
                    >
                      Create Room
                    </button>
                  </>
                )}

                {(status === "searching") && tab === "create" && (
                  <Spinner label="Creating room…" />
                )}

                {status === "waiting" && (
                  <div className="space-y-4">
                    <div>
                      <p className="text-gray-500 text-xs uppercase tracking-widest mb-2">
                        Room Code
                      </p>
                      <button
                        onClick={handleCopyCode}
                        className="w-full bg-gray-800 hover:bg-gray-700 rounded-xl px-4 py-3
                                   font-mono text-white text-xs text-left break-all
                                   transition-colors border border-gray-700"
                        title="Click to copy"
                      >
                        {roomCode}
                      </button>
                      <p className="text-gray-600 text-xs mt-1 text-center">
                        {copied ? "✓ Copied!" : "Click to copy · Share with a friend"}
                      </p>
                    </div>

                    <Spinner label="Waiting for opponent…" />

                    <button
                      onClick={handleLeaveRoom}
                      className="w-full bg-gray-800 hover:bg-gray-700 text-gray-400
                                 font-medium py-3 rounded-xl transition-colors text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── JOIN ROOM ── */}
            {tab === "join" && (
              <div className="space-y-3">
                <input
                  type="text"
                  value={joinCode}
                  onChange={e => { setJoinCode(e.target.value); setError(""); }}
                  onKeyDown={e => e.key === "Enter" && handleJoinRoom()}
                  placeholder="Paste room code here"
                  disabled={status === "searching"}
                  autoComplete="off"
                  className="
                    w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3
                    text-white placeholder-gray-500 text-xs font-mono
                    focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500
                    disabled:opacity-50 transition-colors
                  "
                />
                <button
                  onClick={handleJoinRoom}
                  disabled={!joinCode.trim() || status === "searching"}
                  className="
                    w-full bg-indigo-600 hover:bg-indigo-500
                    disabled:opacity-40 disabled:cursor-not-allowed
                    text-white font-semibold py-3 rounded-xl transition-colors text-sm
                  "
                >
                  {status === "searching" ? "Joining…" : "Join Room"}
                </button>
              </div>
            )}

            {/* ── RANKINGS ── */}
            {tab === "ranks" && (
              <Leaderboard session={session} />
            )}

          </div>
        </div>

        {/* Footer hint */}
        <p className="text-center text-gray-700 text-xs mt-5">
          Open two tabs to test multiplayer locally
        </p>

      </div>
    </div>
  );
}
