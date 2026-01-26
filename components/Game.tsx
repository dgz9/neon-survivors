'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { GameState, DEFAULT_CONFIG, Vector2 } from '@/types/game';
import {
  createInitialGameState,
  loadPlayerImage,
  startGame,
  updateGameState,
  renderGame,
  generateUpgrades,
  applyUpgrade,
} from '@/lib/gameEngine';
import { Upgrade } from '@/types/game';

interface GameProps {
  playerImageUrl: string;
  playerName: string;
  onGameOver: (score: number, wave: number, kills: number) => void;
  onBack: () => void;
}

export default function Game({ playerImageUrl, playerName, onGameOver, onBack }: GameProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const animationFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const inputRef = useRef<{ keys: Set<string>; mousePos: Vector2; mouseDown: boolean }>({
    keys: new Set(),
    mousePos: { x: 0, y: 0 },
    mouseDown: false,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [displayState, setDisplayState] = useState<{
    score: number;
    wave: number;
    health: number;
    maxHealth: number;
    level: number;
  } | null>(null);
  const [showUpgrades, setShowUpgrades] = useState(false);
  const [availableUpgrades, setAvailableUpgrades] = useState<Upgrade[]>([]);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: Math.floor(rect.width),
          height: Math.floor(rect.height),
        });
      }
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Initialize game
  const initGame = useCallback(async () => {
    setIsLoading(true);
    
    let state = createInitialGameState(playerImageUrl, dimensions.width, dimensions.height, DEFAULT_CONFIG);
    state = await loadPlayerImage(state);
    state = startGame(state);
    
    gameStateRef.current = state;
    setIsLoading(false);
  }, [playerImageUrl, dimensions]);

  useEffect(() => {
    if (dimensions.width > 0 && dimensions.height > 0) {
      initGame();
    }
  }, [initGame]);

  // Handle upgrade selection
  const handleUpgrade = useCallback((upgrade: Upgrade) => {
    if (gameStateRef.current) {
      gameStateRef.current = applyUpgrade(gameStateRef.current, upgrade);
      
      // Check if more level ups pending
      if (gameStateRef.current.pendingLevelUps > 0) {
        setAvailableUpgrades(gameStateRef.current.availableUpgrades);
      } else {
        setShowUpgrades(false);
        setAvailableUpgrades([]);
      }
    }
  }, []);

  // Handle input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      inputRef.current.keys.add(key);
      
      if (key === 'escape') {
        setIsPaused(p => !p);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      inputRef.current.keys.delete(e.key.toLowerCase());
    };

    const handleMouseMove = (e: MouseEvent) => {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        // Scale mouse position to account for CSS scaling of canvas
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        inputRef.current.mousePos = {
          x: (e.clientX - rect.left) * scaleX,
          y: (e.clientY - rect.top) * scaleY,
        };
      }
    };

    const handleMouseDown = () => {
      inputRef.current.mouseDown = true;
    };

    const handleMouseUp = () => {
      inputRef.current.mouseDown = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isLoading) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const gameLoop = (timestamp: number) => {
      if (!gameStateRef.current) {
        animationFrameRef.current = requestAnimationFrame(gameLoop);
        return;
      }

      const deltaTime = Math.min((timestamp - lastTimeRef.current) / 16.67, 3);
      lastTimeRef.current = timestamp;

      if (!isPaused && !showUpgrades && gameStateRef.current.isRunning) {
        gameStateRef.current = updateGameState(
          gameStateRef.current,
          deltaTime,
          dimensions.width,
          dimensions.height,
          inputRef.current,
          DEFAULT_CONFIG
        );

        // Update display state periodically
        if (Math.floor(timestamp) % 100 < 17) {
          setDisplayState({
            score: gameStateRef.current.score,
            wave: gameStateRef.current.wave,
            health: gameStateRef.current.player.health,
            maxHealth: gameStateRef.current.player.maxHealth,
            level: gameStateRef.current.player.level,
          });
        }

        // Check for pending level ups
        if (gameStateRef.current.pendingLevelUps > 0 && !showUpgrades) {
          setShowUpgrades(true);
          setAvailableUpgrades(gameStateRef.current.availableUpgrades);
        }
      }

      // Check game over
      if (gameStateRef.current.isGameOver) {
        onGameOver(
          gameStateRef.current.score,
          gameStateRef.current.wave,
          gameStateRef.current.player.kills
        );
        return;
      }

      renderGame(ctx, gameStateRef.current, dimensions.width, dimensions.height, timestamp);

      animationFrameRef.current = requestAnimationFrame(gameLoop);
    };

    lastTimeRef.current = performance.now();
    animationFrameRef.current = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isLoading, isPaused, showUpgrades, dimensions, onGameOver]);

  return (
    <div 
      ref={containerRef}
      className="fixed inset-0 bg-brutal-black flex flex-col"
    >
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-white/10 bg-brutal-dark/80 backdrop-blur-sm z-10">
        <button
          onClick={onBack}
          className="font-mono text-xs uppercase tracking-wider text-white/40 hover:text-electric-pink transition-colors"
        >
          {'<--'} EXIT
        </button>
        
        <div className="font-display text-xl">
          {isLoading ? (
            <span className="text-white/40">Loading...</span>
          ) : isPaused ? (
            <span className="text-electric-yellow">PAUSED</span>
          ) : (
            <span className="text-electric-pink glitch-text" data-text="SURVIVE">SURVIVE</span>
          )}
        </div>

        <button
          onClick={() => setIsPaused(p => !p)}
          disabled={isLoading}
          className="font-mono text-xs uppercase tracking-wider text-white/40 hover:text-electric-cyan transition-colors disabled:opacity-30"
        >
          {isPaused ? '▶ RESUME' : '|| PAUSE'}
        </button>
      </div>

      {/* Game canvas */}
      <div className="flex-1 relative overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-brutal-black z-20">
            <div className="text-center">
              <div className="font-display text-5xl text-electric-yellow mb-4 animate-pulse">
                {'//'}
              </div>
              <p className="font-mono text-xs uppercase tracking-wider text-white/60">
                Initializing arena...
              </p>
            </div>
          </div>
        )}

        {isPaused && !isLoading && !showUpgrades && (
          <div className="absolute inset-0 flex items-center justify-center bg-brutal-black/90 z-20">
            <div className="text-center">
              <div className="font-display text-6xl text-electric-yellow mb-4">||</div>
              <p className="font-mono text-xs uppercase tracking-wider text-white/60 mb-6">
                Game Paused
              </p>
              <div className="space-y-3">
                <button
                  onClick={() => setIsPaused(false)}
                  className="block w-48 mx-auto btn-brutal"
                >
                  Resume
                </button>
                <button
                  onClick={onBack}
                  className="block w-48 mx-auto btn-brutal-outline"
                >
                  Quit Game
                </button>
              </div>
            </div>
          </div>
        )}

        {showUpgrades && (
          <div className="absolute inset-0 flex items-center justify-center bg-brutal-black/95 z-30">
            <div className="text-center max-w-2xl w-full px-4">
              <div className="font-display text-4xl text-electric-cyan mb-2 glitch-text" data-text="LEVEL UP!">
                LEVEL UP!
              </div>
              <p className="font-mono text-sm text-white/60 mb-8">
                Level {displayState?.level || 1} — Choose an upgrade
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {availableUpgrades.map((upgrade) => (
                  <button
                    key={upgrade.id}
                    onClick={() => handleUpgrade(upgrade)}
                    className="group relative bg-brutal-dark border-2 border-white/20 hover:border-electric-cyan p-6 transition-all duration-200 hover:scale-105"
                    style={{ borderColor: `${upgrade.color}40` }}
                  >
                    <div 
                      className="absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity"
                      style={{ backgroundColor: upgrade.color }}
                    />
                    <div className="relative z-10">
                      <div className="text-4xl mb-3">{upgrade.icon}</div>
                      <div 
                        className="font-display text-xl mb-2"
                        style={{ color: upgrade.color }}
                      >
                        {upgrade.name}
                      </div>
                      <p className="font-mono text-xs text-white/60">
                        {upgrade.description}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <canvas
          ref={canvasRef}
          width={dimensions.width}
          height={dimensions.height}
          className="w-full h-full"
        />
      </div>

      {/* Controls hint */}
      <div className="h-10 flex items-center justify-center gap-8 px-4 border-t border-white/10 bg-brutal-dark/80 backdrop-blur-sm text-xs font-mono text-white/40">
        <span>WASD / Arrows to move</span>
        <span>Mouse to aim</span>
        <span>Auto-fire enabled</span>
        <span>ESC to pause</span>
      </div>
    </div>
  );
}
