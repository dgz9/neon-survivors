'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { GameState, DEFAULT_CONFIG, Vector2, ArenaType, Upgrade } from '@/types/game';
import {
  createInitialGameState,
  loadPlayerImage,
  startGame,
  updateGameState,
  applyUpgrade,
} from '@/lib/gameEngine';
import {
  playHit,
  playExplosion,
  playLevelUp,
  playDamage,
  playWaveComplete,
  playWeaponFire,
  playWeaponImpact,
  playStreak,
  playNearMiss,
  playEventStart,
  setMuted,
  isMuted,
  startMatchMusic,
  stopMatchMusic,
} from '@/lib/audio';
import { checkAchievements, AchievementStats } from '@/lib/achievements';
import { GameScene } from './three/GameScene';
import { TextParticles } from './three/TextParticles';
import { PowerupSprites } from './three/PowerupSprites';
import { HUD } from './three/HUD';

interface GameOverStats {
  totalDamageDealt: number;
  totalDamageTaken: number;
  survivalTime: number;
  peakMultiplier: number;
  weaponLevels: { type: string; level: number }[];
  newAchievements?: { id: string; name: string; icon: string; description: string }[];
}

interface GameProps {
  playerImageUrl: string;
  playerName: string;
  arena?: ArenaType;
  onGameOver: (score: number, wave: number, kills: number, stats?: GameOverStats) => void;
  onBack: () => void;
}

export default function Game({ playerImageUrl, playerName, arena = 'grid', onGameOver, onBack }: GameProps) {
  const gameAreaRef = useRef<HTMLDivElement>(null);
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
    experience: number;
    experienceToLevel: number;
    speedBonus: number;
    magnetBonus: number;
    multiplier: number;
    killStreak: number;
    nearMissCount: number;
    activeEvent?: string;
    eventAnnounceTime?: number;
    weapons: { type: string; level: number }[];
    activeBuffs: { type: string; remainingMs: number }[];
    waveAnnounceTime?: number;
    gameTime: number;
  } | null>(null);
  const [showUpgrades, setShowUpgrades] = useState(false);
  const [availableUpgrades, setAvailableUpgrades] = useState<Upgrade[]>([]);
  const [showPowerupLegend, setShowPowerupLegend] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => !isMuted());
  const [playerImage, setPlayerImage] = useState<HTMLImageElement | null>(null);

  const gamepadIndexRef = useRef<number | null>(null);
  const lastPausePress = useRef<number>(0);
  const lastWaveRef = useRef<number>(1);
  const lastHealthRef = useRef<number>(100);
  const lastKillsRef = useRef<number>(0);
  const lastWeaponFireRef = useRef<Record<string, number>>({});
  const lastNearMissRef = useRef<number>(0);
  const lastEventRef = useRef<string | undefined>(undefined);
  const lastStreakRef = useRef<number>(0);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      if (gameAreaRef.current) {
        const rect = gameAreaRef.current.getBoundingClientRect();
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
    state = { ...state, arena };
    state = await loadPlayerImage(state);
    state = startGame(state);

    setPlayerImage(state.player.image);
    gameStateRef.current = state;
    setIsLoading(false);
  }, [playerImageUrl, dimensions, arena]);

  useEffect(() => {
    if (dimensions.width > 0 && dimensions.height > 0) {
      initGame();
    }
  }, [initGame, dimensions.width, dimensions.height]);

  useEffect(() => {
    setSoundEnabled(!isMuted());
  }, []);

  useEffect(() => {
    if (isLoading) return;
    startMatchMusic();
    return () => stopMatchMusic();
  }, [isLoading]);

  // Handle upgrade selection
  const handleUpgrade = useCallback((upgrade: Upgrade) => {
    if (gameStateRef.current) {
      gameStateRef.current = applyUpgrade(gameStateRef.current, upgrade);

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
      const el = gameAreaRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        inputRef.current.mousePos = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
      }
    };

    const handleMouseDown = () => {
      inputRef.current.mouseDown = true;
    };

    const handleMouseUp = () => {
      inputRef.current.mouseDown = false;
    };

    const handleGamepadConnected = (e: GamepadEvent) => {
      gamepadIndexRef.current = e.gamepad.index;
    };

    const handleGamepadDisconnected = (e: GamepadEvent) => {
      if (gamepadIndexRef.current === e.gamepad.index) {
        gamepadIndexRef.current = null;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('gamepadconnected', handleGamepadConnected);
    window.addEventListener('gamepaddisconnected', handleGamepadDisconnected);

    const gamepads = navigator.getGamepads();
    for (const gp of gamepads) {
      if (gp) {
        gamepadIndexRef.current = gp.index;
        break;
      }
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('gamepadconnected', handleGamepadConnected);
      window.removeEventListener('gamepaddisconnected', handleGamepadDisconnected);
    };
  }, []);

  // Game loop — runs game logic only, no rendering (Three.js handles that)
  useEffect(() => {
    if (isLoading) return;

    const gameLoop = (timestamp: number) => {
      if (!gameStateRef.current) {
        animationFrameRef.current = requestAnimationFrame(gameLoop);
        return;
      }

      const deltaTime = Math.min((timestamp - lastTimeRef.current) / 16.67, 3);
      lastTimeRef.current = timestamp;

      // Poll gamepad input
      if (gamepadIndexRef.current !== null) {
        const gamepad = navigator.getGamepads()[gamepadIndexRef.current];
        if (gamepad) {
          const deadzone = 0.15;
          const lx = Math.abs(gamepad.axes[0]) > deadzone ? gamepad.axes[0] : 0;
          const ly = Math.abs(gamepad.axes[1]) > deadzone ? gamepad.axes[1] : 0;

          if (ly < -0.3) inputRef.current.keys.add('w');
          else inputRef.current.keys.delete('w');
          if (ly > 0.3) inputRef.current.keys.add('s');
          else inputRef.current.keys.delete('s');
          if (lx < -0.3) inputRef.current.keys.add('a');
          else inputRef.current.keys.delete('a');
          if (lx > 0.3) inputRef.current.keys.add('d');
          else inputRef.current.keys.delete('d');

          const rx = Math.abs(gamepad.axes[2]) > deadzone ? gamepad.axes[2] : 0;
          const ry = Math.abs(gamepad.axes[3]) > deadzone ? gamepad.axes[3] : 0;

          if (Math.abs(rx) > deadzone || Math.abs(ry) > deadzone) {
            if (gameStateRef.current) {
              const aimDistance = 200;
              inputRef.current.mousePos = {
                x: gameStateRef.current.player.position.x + rx * aimDistance,
                y: gameStateRef.current.player.position.y + ry * aimDistance,
              };
            }
          }

          if (gamepad.buttons[9]?.pressed && timestamp - lastPausePress.current > 300) {
            lastPausePress.current = timestamp;
            setIsPaused(p => !p);
          }
        }
      }

      if (!isPaused && !showUpgrades && gameStateRef.current.isRunning) {
        gameStateRef.current = updateGameState(
          gameStateRef.current,
          deltaTime,
          dimensions.width,
          dimensions.height,
          inputRef.current,
          DEFAULT_CONFIG
        );

        // Update display state periodically (~6x/sec)
        if (Math.floor(timestamp) % 100 < 17) {
          const gs = gameStateRef.current;
          const now = Date.now();
          setDisplayState({
            score: gs.score,
            wave: gs.wave,
            health: gs.player.health,
            maxHealth: gs.player.maxHealth,
            level: gs.player.level,
            experience: gs.player.experience,
            experienceToLevel: DEFAULT_CONFIG.experienceToLevel * gs.player.level,
            speedBonus: gs.player.speedBonus,
            magnetBonus: gs.player.magnetBonus,
            multiplier: gs.multiplier,
            killStreak: gs.killStreak,
            nearMissCount: gs.nearMissCount,
            activeEvent: gs.activeEvent,
            eventAnnounceTime: gs.eventAnnounceTime,
            weapons: gs.player.weapons.map(w => ({ type: w.type, level: w.level })),
            activeBuffs: gs.player.activeBuffs.map(b => ({
              type: b.type,
              remainingMs: Math.max(0, b.expiresAt - now),
            })),
            waveAnnounceTime: gs.waveAnnounceTime,
            gameTime: gs.gameTime,
          });
        }

        // Check for pending level ups
        if (gameStateRef.current.pendingLevelUps > 0 && !showUpgrades) {
          setShowUpgrades(true);
          setAvailableUpgrades(gameStateRef.current.availableUpgrades);
          playLevelUp();
        }

        // Sound effects
        const gs = gameStateRef.current;

        if (gs.wave > lastWaveRef.current) {
          lastWaveRef.current = gs.wave;
          playWaveComplete();
        }

        if (gs.player.health < lastHealthRef.current) {
          playDamage();
        }
        lastHealthRef.current = gs.player.health;

        if (gs.player.kills > lastKillsRef.current) {
          const killDiff = gs.player.kills - lastKillsRef.current;
          if (killDiff > 0) {
            const preferredWeapon = gs.player.weapons[gs.player.weapons.length - 1]?.type || 'blaster';
            playWeaponImpact(preferredWeapon);
            if (killDiff > 2) playExplosion();
          }
        }
        lastKillsRef.current = gs.player.kills;

        if (gs.killStreak > 0 && gs.killStreak !== lastStreakRef.current && gs.killStreak % 5 === 0) {
          playStreak(gs.killStreak);
        }
        lastStreakRef.current = gs.killStreak;

        if (gs.nearMissCount > lastNearMissRef.current) {
          playNearMiss();
        }
        lastNearMissRef.current = gs.nearMissCount;

        if (gs.activeEvent && gs.activeEvent !== lastEventRef.current) {
          playEventStart(gs.activeEvent);
        }
        lastEventRef.current = gs.activeEvent;

        for (const weapon of gs.player.weapons) {
          const prevFired = lastWeaponFireRef.current[weapon.type] || 0;
          if (weapon.lastFired > prevFired) {
            playWeaponFire(weapon.type);
            lastWeaponFireRef.current[weapon.type] = weapon.lastFired;
          }
        }
      }

      // Check game over
      if (gameStateRef.current.isGameOver) {
        const gs = gameStateRef.current;

        const achStats: AchievementStats = {
          score: gs.score,
          wave: gs.wave,
          kills: gs.player.kills,
          totalDamageDealt: gs.totalDamageDealt,
          totalDamageTaken: gs.totalDamageTaken,
          survivalTimeMs: Date.now() - gs.startTime,
          peakMultiplier: gs.peakMultiplier,
          weaponsUnlocked: gs.player.weapons.length,
          maxWeaponLevel: Math.max(...gs.player.weapons.map(w => w.level)),
          noDamageTaken: gs.totalDamageTaken === 0,
        };
        const newAchievements = checkAchievements(achStats);

        onGameOver(
          gs.score,
          gs.wave,
          gs.player.kills,
          {
            totalDamageDealt: gs.totalDamageDealt,
            totalDamageTaken: gs.totalDamageTaken,
            survivalTime: Date.now() - gs.startTime,
            peakMultiplier: gs.peakMultiplier,
            weaponLevels: gs.player.weapons.map(w => ({ type: w.type, level: w.level })),
            newAchievements,
          }
        );
        return;
      }

      animationFrameRef.current = requestAnimationFrame(gameLoop);
    };

    lastTimeRef.current = performance.now();
    animationFrameRef.current = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isLoading, isPaused, showUpgrades, dimensions, onGameOver]);

  return (
    <div className="fixed inset-0 bg-brutal-black flex flex-col">
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

        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              setSoundEnabled(s => {
                const next = !s;
                setMuted(!next);
                return next;
              });
            }}
            className="font-mono text-xs uppercase tracking-wider text-white/40 hover:text-electric-cyan transition-colors"
          >
            {soundEnabled ? '\uD83D\uDD0A' : '\uD83D\uDD07'}
          </button>
          <button
            onClick={() => setIsPaused(p => !p)}
            disabled={isLoading}
            className="font-mono text-xs uppercase tracking-wider text-white/40 hover:text-electric-cyan transition-colors disabled:opacity-30"
          >
            {isPaused ? '\u25B6 RESUME' : '|| PAUSE'}
          </button>
        </div>
      </div>

      {/* Game area */}
      <div ref={gameAreaRef} className="flex-1 relative overflow-hidden">
        {/* Loading overlay */}
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

        {/* Pause overlay */}
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

        {/* Upgrade overlay */}
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

        {/* Three.js Canvas */}
        {!isLoading && (
          <Canvas
            orthographic
            camera={{ position: [0, 0, 100], near: 0.1, far: 1000 }}
            gl={{ antialias: false, alpha: false }}
            style={{ position: 'absolute', inset: 0, background: '#0a0a0a' }}
          >
            <GameScene gameStateRef={gameStateRef} playerImage={playerImage} />
          </Canvas>
        )}

        {/* DOM overlays */}
        <TextParticles gameStateRef={gameStateRef} />
        <PowerupSprites gameStateRef={gameStateRef} />
        <HUD displayState={displayState} />

        {/* Stats display - permanent bonuses and active buffs */}
        {displayState && !isLoading && (
          <div className="absolute top-2 left-2 flex flex-col gap-1 text-xs font-mono z-10 pointer-events-none">
            {displayState.speedBonus > 0 && (
              <div className="flex items-center gap-2 bg-brutal-dark/80 px-2 py-1 border border-electric-yellow/30">
                <span>{'\u26A1'}</span>
                <span className="text-electric-yellow">Speed +{Math.round(displayState.speedBonus / 0.5)}</span>
              </div>
            )}
            {displayState.magnetBonus > 0 && (
              <div className="flex items-center gap-2 bg-brutal-dark/80 px-2 py-1 border border-electric-purple/30">
                <span>{'\uD83E\uDDF2'}</span>
                <span className="text-electric-purple">Magnet +{Math.round(displayState.magnetBonus / 0.3)}</span>
              </div>
            )}

            {displayState.activeBuffs.map((buff) => {
              const maxDuration = buff.type === 'magnet' ? 15000 : 10000;
              const percent = (buff.remainingMs / maxDuration) * 100;
              const colors: Record<string, string> = {
                speed: 'bg-electric-yellow',
                damage: 'bg-electric-pink',
                magnet: 'bg-electric-purple',
              };
              const icons: Record<string, string> = {
                speed: '\u26A1',
                damage: '\uD83D\uDCA5',
                magnet: '\uD83E\uDDF2',
              };
              return (
                <div key={buff.type} className="flex items-center gap-2 bg-brutal-dark/80 px-2 py-1 border border-white/20">
                  <span>{icons[buff.type]}</span>
                  <div className="w-16 h-2 bg-white/10 overflow-hidden">
                    <div
                      className={`h-full ${colors[buff.type]} transition-all duration-100`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <span className="text-white/60 w-8">{Math.ceil(buff.remainingMs / 1000)}s</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Powerup Legend */}
      {showPowerupLegend && (
        <div className="absolute bottom-16 left-4 bg-brutal-dark/95 border border-white/20 p-4 z-20 text-xs font-mono">
          <div className="text-white/60 uppercase tracking-wider mb-3">Powerups</div>
          <div className="space-y-2">
            <div className="flex items-center gap-3"><span className="text-lg">{'\u2764'}</span><span className="text-electric-green">Health</span><span className="text-white/40">+25 HP</span></div>
            <div className="flex items-center gap-3"><span className="text-lg">{'\u26A1'}</span><span className="text-electric-yellow">Speed</span><span className="text-white/40">+50% speed (temp)</span></div>
            <div className="flex items-center gap-3"><span className="text-lg">{'\uD83D\uDCA5'}</span><span className="text-electric-pink">Damage</span><span className="text-white/40">+50% damage (temp)</span></div>
            <div className="flex items-center gap-3"><span className="text-lg">{'\uD83E\uDDF2'}</span><span className="text-electric-purple">Magnet</span><span className="text-white/40">Pulls XP orbs (temp)</span></div>
            <div className="flex items-center gap-3"><span className="text-lg">{'\uD83D\uDCA3'}</span><span className="text-electric-orange">Bomb</span><span className="text-white/40">Clears nearby enemies</span></div>
            <div className="flex items-center gap-3"><span className="text-lg">{'\u2728'}</span><span className="text-electric-cyan">XP</span><span className="text-white/40">+50 experience</span></div>
          </div>
        </div>
      )}

      {/* Controls hint */}
      <div className="h-10 flex items-center justify-between px-4 border-t border-white/10 bg-brutal-dark/80 backdrop-blur-sm text-xs font-mono text-white/40">
        <button
          onClick={() => setShowPowerupLegend(p => !p)}
          className="hover:text-electric-cyan transition-colors"
        >
          [?] Powerups
        </button>
        <div className="flex items-center gap-6">
          <span>WASD / {'\uD83C\uDFAE'} Left Stick</span>
          <span>Mouse / {'\uD83C\uDFAE'} Right Stick to aim</span>
          <span>Auto-fire</span>
          <span>ESC / Start to pause</span>
        </div>
        <div className="w-20" />
      </div>
    </div>
  );
}
