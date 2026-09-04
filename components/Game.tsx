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
  createAimState,
  resolveTouchAim,
} from '@/lib/gameEngine';
import { FIXED_DT, createAccumulator, advanceAccumulator, AccumulatorState } from '@/lib/engine/timestep';
import {
  loadMetaProgression,
  saveMetaProgression,
  calculateRunReward,
  applyMetaToInitialState,
} from '@/lib/engine/metaProgression';
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
import { ViewTransform, createViewTransform, fitViewTransform } from '@/lib/viewport';
import { GameScene } from './three/GameScene';
import { TextParticles } from './three/TextParticles';
import { PowerupSprites } from './three/PowerupSprites';
import { HUD } from './three/HUD';
import TouchControls from './TouchControls';

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
  const accRef = useRef<AccumulatorState | null>(null);
  const inputRef = useRef<{ keys: Set<string>; mousePos: Vector2; mouseDown: boolean; touchMovement?: Vector2 }>({
    keys: new Set(),
    mousePos: { x: 0, y: 0 },
    mouseDown: false,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const dimensionsRef = useRef(dimensions);
  const gameInitializedRef = useRef(false);
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

  const [isTouchDevice, setIsTouchDevice] = useState(false);
  /** Gates the first world build on knowing whether the camera will be zoomed out. */
  const [inputDetected, setInputDetected] = useState(false);
  const touchMovementRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchAimRef = useRef<{ x: number; y: number } | null>(null);
  /** Remembers the touch facing so releasing both sticks holds it. */
  const aimStateRef = useRef(createAimState());

  const gamepadIndexRef = useRef<number | null>(null);
  const lastPausePress = useRef<number>(0);
  const lastWaveRef = useRef<number>(1);
  const lastHealthRef = useRef<number>(100);
  const lastKillsRef = useRef<number>(0);
  const lastWeaponFireRef = useRef<Record<string, number>>({});
  const lastNearMissRef = useRef<number>(0);
  const lastEventRef = useRef<string | undefined>(undefined);
  const lastStreakRef = useRef<number>(0);

  const measureArena = useCallback(() => {
    const el = gameAreaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const newDims = {
      width: Math.floor(rect.width),
      height: Math.floor(rect.height),
    };
    if (newDims.width <= 0 || newDims.height <= 0) return;
    if (
      newDims.width === dimensionsRef.current.width &&
      newDims.height === dimensionsRef.current.height
    ) {
      return;
    }
    dimensionsRef.current = newDims;
    setDimensions(newDims);
  }, []);

  // Track the arena box itself, not just the window: rotating the device
  // resizes the box without firing a window resize, which used to leave the
  // world taller than what is on screen so enemies drifted into a strip nobody
  // could see.
  useEffect(() => {
    const el = gameAreaRef.current;
    if (!el) return;

    measureArena();
    const observer = new ResizeObserver(measureArena);
    observer.observe(el);
    window.addEventListener('orientationchange', measureArena);
    return () => {
      observer.disconnect();
      window.removeEventListener('orientationchange', measureArena);
    };
  }, [measureArena]);

  const mobileScale = isTouchDevice ? 0.7 : 1;
  const mobileScaleRef = useRef(mobileScale);
  mobileScaleRef.current = mobileScale;

  /** World-to-canvas mapping shared with every renderer. */
  const viewRef = useRef<ViewTransform>(createViewTransform());
  const syncView = useCallback(() => {
    const dims = dimensionsRef.current;
    if (dims.width <= 0 || dims.height <= 0) return;
    const scale = mobileScaleRef.current;
    fitViewTransform(
      viewRef.current,
      dims.width,
      dims.height,
      Math.floor(dims.width / scale),
      Math.floor(dims.height / scale),
    );
  }, []);

  // Keep the mapping correct before the first simulated frame, and after every
  // resize or rotation.
  useEffect(syncView, [syncView, dimensions, mobileScale]);

  // Initialize game (only once)
  const initGame = useCallback(async () => {
    setIsLoading(true);

    const dims = dimensionsRef.current;
    // Use effective dimensions (larger on mobile) so game fills the zoomed-out camera view
    const effectiveWidth = Math.floor(dims.width / mobileScale);
    const effectiveHeight = Math.floor(dims.height / mobileScale);
    let state = createInitialGameState(playerImageUrl, effectiveWidth, effectiveHeight, DEFAULT_CONFIG);
    state = { ...state, arena };
    const meta = loadMetaProgression();
    state = applyMetaToInitialState(state, meta);
    state = await loadPlayerImage(state);
    state = startGame(state);

    setPlayerImage(state.player.image);
    gameStateRef.current = state;
    setIsLoading(false);
  }, [playerImageUrl, arena, mobileScale]);

  useEffect(() => {
    if (!inputDetected || gameInitializedRef.current) return;
    // Re-read the box now that the touch layout is committed, so the world is
    // built against the arena the player will actually see.
    measureArena();
    if (dimensionsRef.current.width <= 0 || dimensionsRef.current.height <= 0) return;
    gameInitializedRef.current = true;
    initGame();
  }, [initGame, dimensions, inputDetected, measureArena]);

  useEffect(() => {
    setSoundEnabled(!isMuted());
  }, []);

  // Detect touch device. A touch-capable laptop reports maxTouchPoints > 0 while
  // still being driven with a mouse, so ask for a coarse primary pointer first
  // and only fall back to feature sniffing on browsers without pointer queries.
  useEffect(() => {
    const hasTouchEvents = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const query = window.matchMedia?.('(pointer: coarse)');
    const evaluate = () => setIsTouchDevice(query ? query.matches : hasTouchEvents);

    evaluate();
    setInputDetected(true);
    query?.addEventListener('change', evaluate);
    return () => query?.removeEventListener('change', evaluate);
  }, []);

  // Lock the document while a match is running so mobile browsers cannot
  // pull-to-refresh, rubber-band, or pinch-zoom the arena out of frame.
  useEffect(() => {
    document.documentElement.classList.add('playing');
    return () => document.documentElement.classList.remove('playing');
  }, []);

  // Touch control callbacks
  const handleTouchMovement = useCallback((direction: { x: number; y: number }) => {
    touchMovementRef.current = direction;
  }, []);

  const handleTouchAim = useCallback((position: { x: number; y: number } | null) => {
    touchAimRef.current = position;
  }, []);

  const handleTouchPause = useCallback(() => {
    setIsPaused(p => !p);
  }, []);

  const handleToggleSound = useCallback(() => {
    setSoundEnabled(s => {
      const next = !s;
      setMuted(!next);
      return next;
    });
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
        // Undo exactly the zoom and offset the renderer applies.
        const view = viewRef.current;
        inputRef.current.mousePos = {
          x: (e.clientX - rect.left - view.offsetX) / view.scale,
          y: (e.clientY - rect.top - view.offsetY) / view.scale,
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

      // Initialize accumulator on first frame
      if (!accRef.current) {
        accRef.current = createAccumulator(timestamp);
      }

      // Poll touch input
      if (isTouchDevice && gameStateRef.current) {
        // Pass analog movement directly for smooth proportional control
        inputRef.current.touchMovement = touchMovementRef.current;

        // The aim stick points the gun; with it idle the player shoots the way
        // they are walking. Nothing ever targets an enemy for them.
        resolveTouchAim(
          aimStateRef.current,
          gameStateRef.current.player.position,
          touchAimRef.current,
          touchMovementRef.current,
          inputRef.current.mousePos,
        );
      } else {
        inputRef.current.touchMovement = undefined;
      }

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
        // Compute slow-mo factor from game state
        const curState = gameStateRef.current;
        const slowMoFactor = (curState.slowMoUntil && Date.now() < curState.slowMoUntil)
          ? (curState.slowMoFactor || 0.3) : 1;

        const { acc, tickCount } = advanceAccumulator(accRef.current, timestamp, slowMoFactor);
        accRef.current = acc;

        const dims = dimensionsRef.current;
        const effectiveWidth = Math.floor(dims.width / mobileScale);
        const effectiveHeight = Math.floor(dims.height / mobileScale);
        syncView();
        for (let i = 0; i < tickCount; i++) {
          gameStateRef.current = updateGameState(
            gameStateRef.current,
            FIXED_DT,
            effectiveWidth,
            effectiveHeight,
            inputRef.current,
            DEFAULT_CONFIG
          );
          if (gameStateRef.current.isGameOver) break;
        }

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
          // Haptic thump on phones — the strongest "you got hit" cue available
          // when the screen is half-covered by thumbs.
          if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
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

        // Award crystals and save meta-progression
        const crystals = calculateRunReward(gs.score, gs.wave, gs.bossesKilledThisRun || 0);
        const meta = loadMetaProgression();
        saveMetaProgression({
          ...meta,
          crystals: meta.crystals + crystals,
          totalCrystalsEarned: meta.totalCrystalsEarned + crystals,
        });

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

    accRef.current = null; // will be initialized on first frame
    animationFrameRef.current = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isLoading, isPaused, showUpgrades, onGameOver, isTouchDevice, mobileScale, syncView]);

  return (
    <div className={`fixed inset-0 bg-brutal-black flex flex-col ${isTouchDevice ? 'game-touch-area safe-area-top safe-area-bottom safe-area-x' : ''}`}>
      {/* Header - hidden on mobile */}
      <div className={`h-12 flex items-center justify-between px-4 border-b border-white/10 bg-brutal-dark/80 backdrop-blur-sm z-10 ${isTouchDevice ? 'hidden' : ''}`}>
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
            onClick={handleToggleSound}
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
      <div ref={gameAreaRef} className="flex-1 min-h-0 relative overflow-hidden">
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
                  onClick={handleToggleSound}
                  className="block w-48 mx-auto btn-brutal-outline"
                >
                  Sound: {soundEnabled ? 'On' : 'Off'}
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

        {/* Upgrade overlay. The document is scroll-locked during a match, so
            this pane owns its own scrolling — centred when it fits, scrollable
            from the top when three cards outgrow a short phone screen. */}
        {showUpgrades && (
          <div className="absolute inset-0 bg-brutal-black/95 z-30 overflow-y-auto overscroll-contain">
            <div className="min-h-full flex items-center justify-center p-4">
              <div className="text-center max-w-2xl w-full">
                <div className="font-display text-3xl sm:text-4xl text-electric-cyan mb-2 glitch-text" data-text="LEVEL UP!">
                  LEVEL UP!
                </div>
                <p className="font-mono text-xs sm:text-sm text-white/60 mb-4 sm:mb-8">
                  Level {displayState?.level || 1} — Choose an upgrade
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                  {availableUpgrades.map((upgrade) => (
                    <button
                      key={upgrade.id}
                      onClick={() => handleUpgrade(upgrade)}
                      className="group relative bg-brutal-dark border-2 border-white/20 hover:border-electric-cyan p-4 sm:p-5 md:p-6 transition-all duration-200 hover:scale-105 active:scale-95 flex items-center gap-4 text-left sm:block sm:text-center"
                      style={{ borderColor: `${upgrade.color}40` }}
                    >
                      <div
                        className="absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity"
                        style={{ backgroundColor: upgrade.color }}
                      />
                      <div className="relative z-10 text-3xl sm:text-4xl shrink-0 sm:mb-3">{upgrade.icon}</div>
                      <div className="relative z-10 min-w-0">
                        <div
                          className="font-display text-lg sm:text-xl sm:mb-2"
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
          </div>
        )}

        {/* Three.js Canvas */}
        {!isLoading && (
          <Canvas
            orthographic
            camera={{ position: [0, 0, 100], near: 0.1, far: 1000 }}
            gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
            // Phones routinely report DPR 3-4; rendering a bloom-heavy scene at
            // that density is what makes mobile drop frames. Cap it.
            dpr={isTouchDevice ? [1, 1.75] : [1, 2]}
            style={{ position: 'absolute', inset: 0, background: '#0a0a0a' }}
          >
            <GameScene gameStateRef={gameStateRef} playerImage={playerImage} viewRef={viewRef} />
          </Canvas>
        )}

        {/* Touch controls */}
        {isTouchDevice && !isLoading && !isPaused && !showUpgrades && (
          <TouchControls
            onMovementChange={handleTouchMovement}
            onAimChange={handleTouchAim}
            onPause={handleTouchPause}
            soundEnabled={soundEnabled}
            onToggleSound={handleToggleSound}
            visible={true}
          />
        )}

        {/* DOM overlays */}
        <TextParticles gameStateRef={gameStateRef} viewRef={viewRef} />
        <PowerupSprites gameStateRef={gameStateRef} viewRef={viewRef} />
        <HUD displayState={displayState} isMobile={isTouchDevice} />

        {/* Stats display - permanent bonuses and active buffs (hidden on mobile) */}
        {displayState && !isLoading && !isTouchDevice && (
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

      {/* Mobile bottom HUD bar. Rendered as soon as we know this is a touch
          device: reserving the space up front means the arena is already its
          final size when the world is built, instead of shrinking under the
          player the moment the first display state lands. */}
      {isTouchDevice && (
        <div className="h-14 landscape:h-11 shrink-0 flex items-center justify-between gap-2 px-3 border-t border-white/10 bg-brutal-dark/95 backdrop-blur-sm z-10 font-mono">
          {displayState && !isLoading && (
          <>
          {/* HP */}
          <div className="flex flex-col gap-0.5 shrink-0" style={{ width: '28%' }}>
            <div className="text-[9px] text-white/50">HP {Math.ceil(displayState.health)}/{displayState.maxHealth}</div>
            <div className="w-full h-2 bg-white/10 overflow-hidden">
              <div
                className="h-full transition-all duration-200"
                style={{
                  width: `${Math.max(0, Math.min(100, (displayState.health / displayState.maxHealth) * 100))}%`,
                  background: displayState.health / displayState.maxHealth > 0.5
                    ? '#39ff14' : displayState.health / displayState.maxHealth > 0.25
                    ? '#e4ff1a' : '#ff2d6a',
                }}
              />
            </div>
          </div>
          {/* Score + Level */}
          <div className="flex flex-col items-center gap-0.5">
            <div className="text-xs text-white font-bold" style={{ textShadow: '0 0 6px rgba(0,240,255,0.5)' }}>
              {Math.floor(displayState.score).toLocaleString()}
              {displayState.multiplier > 1 && (
                <span className="text-[9px] ml-1" style={{ color: '#e4ff1a' }}>x{displayState.multiplier.toFixed(1)}</span>
              )}
            </div>
            <div className="text-[9px] text-electric-cyan">LV{displayState.level} W{displayState.wave}</div>
          </div>
          {/* XP */}
          <div className="flex flex-col gap-0.5 shrink-0" style={{ width: '28%' }}>
            <div className="text-[9px] text-white/50 text-right">XP {Math.floor(displayState.experience)}/{displayState.experienceToLevel}</div>
            <div className="w-full h-2 bg-white/10 overflow-hidden">
              <div
                className="h-full transition-all duration-200"
                style={{
                  width: `${Math.max(0, Math.min(100, (displayState.experience / displayState.experienceToLevel) * 100))}%`,
                  background: '#00f0ff',
                }}
              />
            </div>
          </div>
          </>
          )}
        </div>
      )}

      {/* Controls hint */}
      <div className={`h-10 flex items-center justify-between px-4 border-t border-white/10 bg-brutal-dark/80 backdrop-blur-sm text-xs font-mono text-white/40 ${isTouchDevice ? 'hidden' : ''}`}>
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
