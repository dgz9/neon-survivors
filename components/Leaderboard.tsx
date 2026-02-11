'use client';

import { useState, useEffect } from 'react';
import { X, Trophy, RefreshCw } from 'lucide-react';

interface LeaderboardEntry {
  id: string;
  name: string;
  score: number;
  wave: number;
  kills: number;
  timestamp: number;
}

interface LeaderboardProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Leaderboard({ isOpen, onClose }: LeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadLeaderboard = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/leaderboard');
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
      }
    } catch (error) {
      console.error('Failed to load leaderboard:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadLeaderboard();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-brutal-black/95 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-brutal-dark border-2 border-electric-yellow/30">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Trophy className="w-6 h-6 text-electric-yellow" />
            <h2 className="font-menu text-2xl text-electric-yellow">LEADERBOARD</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadLeaderboard}
              className="p-2 text-white/40 hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-white/40 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="inline-block w-8 h-8 border-2 border-electric-cyan border-t-transparent rounded-full animate-spin" />
              <p className="mt-4 font-mono text-sm text-white/40">Loading scores...</p>
            </div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-center">
              <p className="font-mono text-sm text-white/40">No scores yet. Be the first!</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-white/5 sticky top-0">
                <tr className="text-left font-mono text-xs text-white/40 uppercase">
                  <th className="p-3 w-12">#</th>
                  <th className="p-3">Player</th>
                  <th className="p-3 text-center">Wave</th>
                  <th className="p-3 text-center">Kills</th>
                  <th className="p-3 text-right">Score</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr
                    key={entry.id}
                    className={`border-b border-white/5 ${
                      index < 3 ? 'bg-white/5' : ''
                    }`}
                  >
                    <td className="p-3">
                      <span className={`font-menu text-lg ${
                        index === 0 ? 'text-electric-yellow' :
                        index === 1 ? 'text-white/60' :
                        index === 2 ? 'text-electric-orange' :
                        'text-white/30'
                      }`}>
                        {index + 1}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-sm text-white truncate max-w-[120px]">
                      {entry.name}
                    </td>
                    <td className="p-3 text-center font-mono text-sm text-electric-pink">
                      {entry.wave}
                    </td>
                    <td className="p-3 text-center font-mono text-sm text-white/60">
                      {entry.kills}
                    </td>
                    <td className="p-3 text-right font-menu text-lg text-electric-cyan">
                      {entry.score.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 text-center">
          <p className="font-mono text-xs text-white/30">
            Top 100 survivors • Updated in real-time
          </p>
        </div>
      </div>
    </div>
  );
}
