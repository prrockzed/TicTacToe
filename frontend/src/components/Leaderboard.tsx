import { useEffect, useState } from "react";
import type { Session } from "@heroiclabs/nakama-js";
import { nakamaClient } from "../nakama";

interface Props {
  session: Session;
}

interface LeaderboardEntry {
  ownerId:  string;
  username: string;
  score:    number;   // total wins
  rank:     number;
}

interface LeaderboardData {
  records:   LeaderboardEntry[];
  ownRecord: LeaderboardEntry | null;
}

export default function Leaderboard({ session }: Props) {
  const [data,    setData]    = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");

    nakamaClient
      .rpc(session, "getLeaderboard", {})
      .then(resp => setData(resp.payload as LeaderboardData))
      .catch(err => {
        console.error("getLeaderboard:", err);
        setError("Failed to load rankings.");
      })
      .finally(() => setLoading(false));
  }, [session]);

  const myId        = session.user_id ?? "";
  const myInTop10   = data?.records.some(r => r.ownerId === myId) ?? false;
  const showOwnRow  = !myInTop10 && !!data?.ownRecord;

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center py-8 gap-3">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 text-sm">Loading rankings…</p>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <p className="text-center text-red-400 text-sm py-6">{error}</p>
    );
  }

  // ── Empty ─────────────────────────────────────────────────────────────────
  if (!data || data.records.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-gray-500 text-sm">No games played yet.</p>
        <p className="text-gray-700 text-xs mt-1">Win a match to appear here!</p>
      </div>
    );
  }

  // ── Table ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="flex items-center px-3 pb-1">
        <span className="w-8 text-gray-700 text-xs text-center">#</span>
        <span className="flex-1 text-gray-700 text-xs uppercase tracking-widest pl-2">Player</span>
        <span className="text-gray-700 text-xs uppercase tracking-widest">Wins</span>
      </div>

      {/* Top 10 rows */}
      {data.records.map(record => {
        const isMe = record.ownerId === myId;
        return (
          <Row key={record.ownerId} record={record} isMe={isMe} />
        );
      })}

      {/* Separator + caller's row if outside top 10 */}
      {showOwnRow && (
        <>
          <div className="flex items-center gap-2 py-1 px-3">
            <div className="flex-1 border-t border-dashed border-white/10" />
            <span className="text-gray-700 text-xs">you</span>
            <div className="flex-1 border-t border-dashed border-white/10" />
          </div>
          <Row record={data.ownRecord!} isMe={true} />
        </>
      )}

      {/* No record yet */}
      {!myInTop10 && !showOwnRow && (
        <p className="text-center text-gray-700 text-xs pt-3">
          Win a game to appear on the board!
        </p>
      )}
    </div>
  );
}

// ── Row sub-component ─────────────────────────────────────────────────────────

function Row({ record, isMe }: { record: LeaderboardEntry; isMe: boolean }) {
  const rankColor =
    record.rank === 1 ? "#fbbf24" :
    record.rank === 2 ? "#9ca3af" :
    record.rank === 3 ? "#d97706" :
    "#4b5563";

  return (
    <div
      className="flex items-center px-3 py-2 rounded-xl transition-colors"
      style={isMe ? {
        background: "rgba(99,102,241,0.12)",
        border:     "1px solid rgba(99,102,241,0.3)",
      } : {
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <span className="w-8 text-center font-bold text-sm" style={{ color: rankColor }}>
        {record.rank}
      </span>
      <span
        className="flex-1 text-sm font-medium pl-2 truncate"
        style={{ color: isMe ? "#a5b4fc" : "#d1d5db" }}
      >
        {record.username}
        {isMe && <span className="text-xs text-indigo-500 ml-1.5">(you)</span>}
      </span>
      <span className="text-sm font-bold" style={{ color: isMe ? "#a5b4fc" : "#9ca3af" }}>
        {record.score}
      </span>
    </div>
  );
}
