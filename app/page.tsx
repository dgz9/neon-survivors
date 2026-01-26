'use client';

import { useState, useCallback } from 'react';
import AvatarSelector from '@/components/AvatarSelector';
import Game from '@/components/Game';
import GameOver from '@/components/GameOver';

type GamePhase = 'menu' | 'playing' | 'gameover';

export default function Home() {
  const [phase, setPhase] = useState<GamePhase>('menu');
  const [playerImageUrl, setPlayerImageUrl] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [gameStats, setGameStats] = useState<{
    score: number;
    wave: number;
    kills: number;
    stats?: {
      totalDamageDealt: number;
      totalDamageTaken: number;
      survivalTime: number;
      peakMultiplier: number;
      weaponLevels: { type: string; level: number }[];
    };
  }>({ score: 0, wave: 1, kills: 0 });
  const [selectedArena, setSelectedArena] = useState<'void' | 'grid' | 'cyber' | 'neon'>('grid');

  const handleStartGame = useCallback((imageUrl: string, name: string) => {
    setPlayerImageUrl(imageUrl);
    setPlayerName(name);
    setPhase('playing');
  }, []);

  const handleGameOver = useCallback((score: number, wave: number, kills: number, stats?: {
    totalDamageDealt: number;
    totalDamageTaken: number;
    survivalTime: number;
    peakMultiplier: number;
    weaponLevels: { type: string; level: number }[];
  }) => {
    setGameStats({ score, wave, kills, stats });
    setPhase('gameover');
  }, []);

  const handlePlayAgain = useCallback(() => {
    setPhase('playing');
  }, []);

  const handleBackToMenu = useCallback(() => {
    setPhase('menu');
    setPlayerImageUrl('');
  }, []);

  return (
    <div className="min-h-screen bg-brutal-black text-white">
      {phase === 'menu' && (
        <div className="flex flex-col items-center justify-start p-4 sm:p-8 min-h-screen">
          {/* Header */}
          <header className="text-center mb-8 sm:mb-16 mt-8 sm:mt-12 relative z-10 w-full max-w-4xl">
            {/* Top accent line */}
            <div className="flex items-center gap-4 mb-6 sm:mb-8">
              <div className="h-[2px] flex-1 bg-gradient-to-r from-transparent via-electric-yellow/50 to-transparent" />
              <span className="text-[10px] sm:text-xs font-mono text-electric-yellow/60 tracking-[0.3em] uppercase">
                Survival Arena v1.0
              </span>
              <div className="h-[2px] flex-1 bg-gradient-to-r from-transparent via-electric-yellow/50 to-transparent" />
            </div>

            {/* Main title */}
            <div className="relative">
              <h1 className="brutal-title glitch-text" data-text="NEON SURVIVORS">
                NEON SURVIVORS
              </h1>

              {/* Subtitle with slashes */}
              <div className="flex items-center justify-center gap-3 mt-4 sm:mt-6">
                <span className="text-electric-pink font-mono text-lg sm:text-xl">{'//'}</span>
                <p className="font-mono text-xs sm:text-sm tracking-[0.2em] uppercase text-white/70">
                  Survive <span className="text-electric-cyan">.</span> Evolve <span className="text-electric-cyan">.</span> Dominate
                </p>
                <span className="text-electric-pink font-mono text-lg sm:text-xl">{'//'}</span>
              </div>
            </div>

            {/* Corner decorations */}
            <div className="absolute top-0 left-0 w-8 h-8 border-l-2 border-t-2 border-electric-yellow/30" />
            <div className="absolute top-0 right-0 w-8 h-8 border-r-2 border-t-2 border-electric-yellow/30" />
          </header>

          {/* Avatar selector */}
          <AvatarSelector onSelect={handleStartGame} />

          {/* Arena Selection */}
          <div className="w-full max-w-2xl mt-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-electric-pink font-display text-2xl">◆</span>
              <div className="h-[1px] flex-1 bg-white/10" />
              <span className="font-mono text-xs text-white/40 uppercase tracking-wider">Select Arena</span>
            </div>
            
            <div className="grid grid-cols-4 gap-3">
              {[
                { id: 'void', name: 'Void', desc: 'Empty space', color: 'white' },
                { id: 'grid', name: 'Grid', desc: 'Classic neon', color: 'yellow' },
                { id: 'cyber', name: 'Cyber', desc: 'Hex pattern', color: 'cyan' },
                { id: 'neon', name: 'Neon', desc: 'Radial waves', color: 'pink' },
              ].map((arena) => (
                <button
                  key={arena.id}
                  onClick={() => setSelectedArena(arena.id as typeof selectedArena)}
                  className={`p-3 border-2 transition-all ${
                    selectedArena === arena.id
                      ? `border-electric-${arena.color} bg-electric-${arena.color}/10`
                      : 'border-white/20 hover:border-white/40'
                  }`}
                >
                  <div className={`font-mono text-sm ${selectedArena === arena.id ? `text-electric-${arena.color}` : 'text-white/80'}`}>
                    {arena.name}
                  </div>
                  <div className="font-mono text-[10px] text-white/40">{arena.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* How to play */}
          <div className="w-full max-w-2xl mt-12 mb-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-electric-cyan font-display text-2xl">?</span>
              <div className="h-[1px] flex-1 bg-white/10" />
              <span className="font-mono text-xs text-white/40 uppercase tracking-wider">How To Play</span>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div className="p-4 border border-white/10 bg-brutal-dark">
                <div className="text-2xl mb-2">⌨️</div>
                <div className="font-mono text-xs text-white/60">WASD / Arrows</div>
                <div className="font-mono text-[10px] text-white/30">Move</div>
              </div>
              <div className="p-4 border border-white/10 bg-brutal-dark">
                <div className="text-2xl mb-2">🖱️</div>
                <div className="font-mono text-xs text-white/60">Mouse</div>
                <div className="font-mono text-[10px] text-white/30">Aim</div>
              </div>
              <div className="p-4 border border-white/10 bg-brutal-dark">
                <div className="text-2xl mb-2">⚡</div>
                <div className="font-mono text-xs text-white/60">Auto-Fire</div>
                <div className="font-mono text-[10px] text-white/30">Shoot enemies</div>
              </div>
              <div className="p-4 border border-white/10 bg-brutal-dark">
                <div className="text-2xl mb-2">💎</div>
                <div className="font-mono text-xs text-white/60">Collect XP</div>
                <div className="font-mono text-[10px] text-white/30">Level up</div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <footer className="mt-auto pb-8 relative z-10 w-full max-w-2xl">
            <div className="h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent mb-6" />

            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono">
              <div className="text-white/30 uppercase tracking-wider">
                <span className="text-electric-yellow">{'//'}</span> Built for chaos
              </div>

              <div className="flex items-center gap-6">
                <a
                  href="https://x.com/david_zelaznog"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/40 hover:text-electric-cyan transition-colors uppercase tracking-wider"
                >
                  @david_zelaznog
                </a>
              </div>
            </div>
          </footer>
        </div>
      )}

      {phase === 'playing' && (
        <Game
          playerImageUrl={playerImageUrl}
          playerName={playerName}
          arena={selectedArena}
          onGameOver={handleGameOver}
          onBack={handleBackToMenu}
        />
      )}

      {phase === 'gameover' && (
        <GameOver
          score={gameStats.score}
          wave={gameStats.wave}
          kills={gameStats.kills}
          playerName={playerName}
          onPlayAgain={handlePlayAgain}
          onBackToMenu={handleBackToMenu}
          stats={gameStats.stats}
        />
      )}
    </div>
  );
}
