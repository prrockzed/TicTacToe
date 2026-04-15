import { useState, useEffect } from "react";
import type { Session, Socket } from "@heroiclabs/nakama-js";
import { Session as NakamaSession } from "@heroiclabs/nakama-js";
import { nakamaClient, nakamaSsl } from "./nakama";
import AuthScreen from "./components/AuthScreen";
import Lobby from "./components/Lobby";
import type { GameMode, Screen } from "./types";
import "./index.css";

interface AppState {
  session:  Session | null;
  socket:   Socket  | null;
  matchId:  string  | null;
  gameMode: GameMode;
}

const INITIAL_STATE: AppState = {
  session:  null,
  socket:   null,
  matchId:  null,
  gameMode: "classic",
};

export default function App() {
  const [screen,   setScreen]   = useState<Screen>("auth");
  const [appState, setAppState] = useState<AppState>(INITIAL_STATE);
  const [resuming, setResuming] = useState(true); // true while checking stored session

  // ── Try to restore session from localStorage on mount ────────────────────
  useEffect(() => {
    const token        = localStorage.getItem("nakama_token");
    const refreshToken = localStorage.getItem("nakama_refresh_token");

    if (!token || !refreshToken) {
      setResuming(false);
      return;
    }

    let session: Session;
    try {
      session = NakamaSession.restore(token, refreshToken);
      if (session.isexpired(Date.now() / 1000)) {
        throw new Error("Session expired");
      }
    } catch {
      localStorage.removeItem("nakama_token");
      localStorage.removeItem("nakama_refresh_token");
      setResuming(false);
      return;
    }

    // Session is valid — reconnect the socket automatically
    const socket = nakamaClient.createSocket(nakamaSsl, false);
    socket
      .connect(session, false)
      .then(() => {
        setAppState({ session, socket, matchId: null, gameMode: "classic" });
        setScreen("lobby");
      })
      .catch(() => {
        // Nakama might be offline — fall back to auth screen
        localStorage.removeItem("nakama_token");
        localStorage.removeItem("nakama_refresh_token");
      })
      .finally(() => setResuming(false));
  }, []);

  // ── Callbacks ─────────────────────────────────────────────────────────────

  const handleLogin = (session: Session, socket: Socket) => {
    setAppState({ session, socket, matchId: null, gameMode: "classic" });
    setScreen("lobby");
  };

  const handleMatchFound = (matchId: string, gameMode: GameMode) => {
    setAppState(prev => ({ ...prev, matchId, gameMode }));
    setScreen("game");
  };

  const handleLogout = () => {
    if (appState.socket) {
      try { appState.socket.disconnect(false); } catch { /* ignored */ }
    }
    localStorage.removeItem("nakama_token");
    localStorage.removeItem("nakama_refresh_token");
    setAppState(INITIAL_STATE);
    setScreen("auth");
  };

  const handleGameOver = () => {
    setAppState(prev => ({ ...prev, matchId: null }));
    setScreen("lobby");
  };

  // ── Loading splash while checking stored session ──────────────────────────
  if (resuming) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── Screens ───────────────────────────────────────────────────────────────

  if (screen === "auth") {
    return <AuthScreen onLogin={handleLogin} />;
  }

  if (screen === "lobby") {
    return (
      <Lobby
        session={appState.session!}
        socket={appState.socket!}
        onMatchFound={handleMatchFound}
        onLogout={handleLogout}
      />
    );
  }

  if (screen === "game") {
    // Phase 5 replaces this placeholder with the full GameBoard component
    return (
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center max-w-sm w-full">
          <div className="text-4xl mb-4 select-none">✕ ○</div>
          <h2 className="text-xl font-bold mb-1">Game Starting…</h2>
          <p className="text-gray-500 text-xs mb-6">
            Mode: <span className="text-gray-300">{appState.gameMode}</span>
          </p>
          <p className="text-gray-600 text-xs break-all font-mono mb-6">
            {appState.matchId}
          </p>
          <button
            onClick={handleGameOver}
            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300
                       font-medium py-2 rounded-xl transition-colors text-sm"
          >
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  return null;
}
