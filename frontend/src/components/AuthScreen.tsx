import { useState } from "react";
import type { Session, Socket } from "@heroiclabs/nakama-js";
import { nakamaClient, nakamaSsl } from "../nakama";

interface Props {
  onLogin: (session: Session, socket: Socket) => void;
}

// Decorative mini board — gap approach so grid lines are always visible
function MiniBoard() {
  const cells: ("X" | "O" | null)[] = [
    "X", null, "O",
    null, "X", null,
    "O", null, "X",
  ];
  return (
    <div
      className="grid grid-cols-3 gap-[2px] rounded-xl overflow-hidden"
      style={{
        width: 120,
        height: 120,
        background: "rgba(255,255,255,0.12)",  // gap colour = visible grid lines
      }}
    >
      {cells.map((v, i) => (
        <div
          key={i}
          className="flex items-center justify-center"
          style={{ background: "#0d0d1a" }}
        >
          {v === "X" && (
            <span className="text-blue-400 font-black text-xl select-none">✕</span>
          )}
          {v === "O" && (
            <span className="text-rose-400 font-black text-xl select-none">○</span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function AuthScreen({ onLogin }: Props) {
  const [username, setUsername] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = username.trim();
    if (name.length < 2)  { setError("At least 2 characters required."); return; }
    if (name.length > 20) { setError("20 characters maximum.");           return; }

    setLoading(true);
    setError("");
    try {
      let deviceId = localStorage.getItem("nakama_device_id");
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        localStorage.setItem("nakama_device_id", deviceId);
      }
      const session = await nakamaClient.authenticateDevice(deviceId, true, name);
      localStorage.setItem("nakama_token",         session.token);
      localStorage.setItem("nakama_refresh_token", session.refresh_token ?? "");
      const socket = nakamaClient.createSocket(nakamaSsl, false);
      await socket.connect(session, false);
      onLogin(session, socket);
    } catch (err) {
      console.error("Login failed:", err);
      setError("Could not connect to the server. Is Nakama running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-16"
      style={{ background: "radial-gradient(ellipse at 50% -10%, #2d1b69 0%, #0d0d1a 55%)" }}
    >
      {/* ── Hero ─────────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-5 mb-10">
        <MiniBoard />
        <div className="text-center">
          <h1 className="text-4xl font-extrabold text-white tracking-tight">
            Tic-Tac-Toe
          </h1>
          <p className="text-indigo-400 text-sm mt-1 font-medium tracking-wide">
            Real-time multiplayer
          </p>
        </div>
      </div>

      {/* ── Card ─────────────────────────────────────────────── */}
      <div
        className="w-full max-w-xs rounded-2xl p-6"
        style={{
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07)",
        }}
      >
        <p className="text-gray-400 text-sm font-medium mb-4">Who are you?</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <input
            type="text"
            value={username}
            onChange={e => { setUsername(e.target.value); setError(""); }}
            placeholder="Enter nickname"
            maxLength={20}
            autoFocus
            autoComplete="off"
            disabled={loading}
            className="w-full rounded-xl px-4 py-3 text-sm text-white placeholder-gray-600
                       outline-none transition-all disabled:opacity-50"
            style={{
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
            onFocus={e => {
              e.currentTarget.style.borderColor = "rgba(99,102,241,0.8)";
              e.currentTarget.style.boxShadow   = "0 0 0 3px rgba(99,102,241,0.18)";
            }}
            onBlur={e => {
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
              e.currentTarget.style.boxShadow   = "none";
            }}
          />

          {error && (
            <p className="text-red-400 text-xs px-1">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading || username.trim().length < 2}
            className="w-full py-3 rounded-xl font-semibold text-sm text-white
                       transition-all active:scale-[0.97] disabled:opacity-40
                       disabled:cursor-not-allowed"
            style={{
              background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
              boxShadow: username.trim().length >= 2 && !loading
                ? "0 4px 20px rgba(99,102,241,0.45)"
                : "none",
            }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent
                                 rounded-full animate-spin" />
                Connecting…
              </span>
            ) : (
              "Continue →"
            )}
          </button>
        </form>
      </div>

      <p className="text-gray-700 text-xs mt-6 text-center">
        No account needed · Just pick a name
      </p>
    </div>
  );
}
