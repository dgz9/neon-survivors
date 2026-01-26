'use client';

import { useState, useEffect, useRef } from 'react';
import { LeaderboardEntry } from '@/types/game';

interface GameOverProps {
  score: number;
  wave: number;
  kills: number;
  playerName: string;
  onPlayAgain: () => void;
  onBackToMenu: () => void;
}

export default function GameOver({
  score,
  wave,
  kills,
  playerName,
  onPlayAgain,
  onBackToMenu,
}: GameOverProps) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [playerRank, setPlayerRank] = useState<number | null>(null);
  const hasSubmittedRef = useRef(false);

  // Load leaderboard on mount
  useEffect(() => {
    loadLeaderboard();
  }, []);

  const loadLeaderboard = async () => {
    try {
      const res = await fetch('/api/leaderboard');
      if (res.ok) {
        const data = await res.json();
        setLeaderboard(data.entries || []);
      }
    } catch (error) {
      console.error('Failed to load leaderboard:', error);
    }
  };

  const submitScore = async () => {
    // Use ref to prevent double submission (React StrictMode calls effects twice)
    if (hasSubmittedRef.current || isSubmitting) return;
    hasSubmittedRef.current = true;
    
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/leaderboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: playerName,
          score,
          wave,
          kills,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setPlayerRank(data.rank);
        loadLeaderboard();
      }
    } catch (error) {
      console.error('Failed to submit score:', error);
      hasSubmittedRef.current = false; // Allow retry on error
    } finally {
      setIsSubmitting(false);
    }
  };

  // Auto-submit on mount
  useEffect(() => {
    submitScore();
  }, []);

  return (
    <div className="fixed inset-0 bg-brutal-black/95 flex items-center justify-center p-4 z-50">
      <div className="w-full max-w-lg">
        {/* Game Over Header */}
        <div className="text-center mb-8">
          <div className="font-display text-6xl sm:text-8xl text-electric-pink mb-2 glitch-text" data-text="GAME OVER">
            GAME OVER
          </div>
          <div className="h-[2px] bg-gradient-to-r from-transparent via-electric-pink to-transparent" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="text-center p-4 border border-white/10 bg-brutal-dark">
            <div className="font-display text-3xl text-electric-cyan">{Math.floor(score).toLocaleString()}</div>
            <div className="font-mono text-xs text-white/40 uppercase tracking-wider mt-1">Score</div>
          </div>
          <div className="text-center p-4 border border-white/10 bg-brutal-dark">
            <div className="font-display text-3xl text-electric-yellow">{wave}</div>
            <div className="font-mono text-xs text-white/40 uppercase tracking-wider mt-1">Wave</div>
          </div>
          <div className="text-center p-4 border border-white/10 bg-brutal-dark">
            <div className="font-display text-3xl text-electric-pink">{kills}</div>
            <div className="font-mono text-xs text-white/40 uppercase tracking-wider mt-1">Kills</div>
          </div>
        </div>

        {/* Rank display */}
        {playerRank && (
          <div className="text-center mb-6">
            <span className="font-mono text-sm text-white/60">Your rank: </span>
            <span className="font-display text-2xl text-electric-yellow">#{playerRank}</span>
          </div>
        )}

        {/* Leaderboard */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-electric-cyan font-display text-xl">⚡</span>
            <span className="font-mono text-xs text-white/40 uppercase tracking-wider">Top Survivors</span>
            <div className="h-[1px] flex-1 bg-white/10" />
          </div>

          <div className="border border-white/10 bg-brutal-dark max-h-60 overflow-y-auto">
            {leaderboard.length === 0 ? (
              <div className="p-4 text-center font-mono text-xs text-white/40">
                No scores yet. Be the first!
              </div>
            ) : (
              leaderboard.slice(0, 10).map((entry, index) => (
                <div
                  key={entry.id}
                  className={`flex items-center gap-4 p-3 border-b border-white/5 last:border-b-0 ${
                    entry.name === playerName && entry.score === score
                      ? 'bg-electric-cyan/10'
                      : ''
                  }`}
                >
                  <span className={`font-display text-lg w-8 ${
                    index === 0 ? 'text-electric-yellow' :
                    index === 1 ? 'text-white/60' :
                    index === 2 ? 'text-orange-400' :
                    'text-white/30'
                  }`}>
                    {index + 1}
                  </span>
                  <span className="font-mono text-sm text-white flex-1 truncate">
                    {entry.name}
                  </span>
                  <span className="font-mono text-xs text-white/40">
                    W{entry.wave}
                  </span>
                  <span className="font-display text-lg text-electric-cyan w-24 text-right">
                    {entry.score.toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-4">
          <button
            onClick={onPlayAgain}
            className="flex-1 py-4 font-display text-lg uppercase tracking-wider bg-electric-cyan text-brutal-black hover:bg-white transition-colors"
          >
            Play Again
          </button>
          <button
            onClick={onBackToMenu}
            className="flex-1 py-4 font-display text-lg uppercase tracking-wider border-2 border-white/20 text-white/60 hover:border-white hover:text-white transition-colors"
          >
            Menu
          </button>
        </div>
      </div>
    </div>
  );
}
