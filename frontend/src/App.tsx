import { useState, useEffect } from "react";
import type { Session, Socket } from "@heroiclabs/nakama-js";
import { Session as NakamaSession } from "@heroiclabs/nakama-js";
import { nakamaClient, nakamaSsl } from "./nakama";
import AuthScreen from "./components/AuthScreen";
import Lobby from "./components/Lobby";
import GameBoard from "./components/GameBoard";
import type { TimeControl, Screen } from "./types";
import "./index.css";

interface AppState {
  session:     Session | null;
  socket:      Socket  | null;
  matchId:     string  | null;
  timeControl: TimeControl;
}

const INITIAL_STATE: AppState = {
  session:     null,
  socket:      null,
  matchId:     null,
  timeControl: "endless",
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
        setAppState({ session, socket, matchId: null, timeControl: "endless" });
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
    setAppState({ session, socket, matchId: null, timeControl: "endless" });
    setScreen("lobby");
  };

  const handleMatchFound = (matchId: string, timeControl: TimeControl) => {
    setAppState(prev => ({ ...prev, matchId, timeControl }));
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

  if (screen === "game" && appState.session && appState.socket && appState.matchId) {
    return (
      <GameBoard
        session={appState.session}
        socket={appState.socket}
        matchId={appState.matchId}
        timeControl={appState.timeControl}
        onGameOver={handleGameOver}
      />
    );
  }

  return null;
}
