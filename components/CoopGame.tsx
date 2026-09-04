'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import PartySocket from 'partysocket';
import { GameState, DEFAULT_CONFIG, Vector2, ArenaType, Player, WEAPON_CONFIGS } from '@/types/game';
import {
  createInitialGameState,
  loadPlayerImage,
  startGame,
  updateGameState,
  generateUpgrades,
  applyUpgrade,
  acquireProjectile,
  getProjectileCount,
  releaseXPOrb,
  getXPOrbCount,
  getParticleCount,
  updateParticles,
  createMuzzleFlash,
  setEventRecording,
  drainEvents,
  createPlayerHurtEffect,
  recordEvent,
  NetEventKind,
  createAimState,
  resolveTouchAim,
} from '@/lib/gameEngine';
import { FIXED_DT, createAccumulator, advanceAccumulator, AccumulatorState } from '@/lib/engine/timestep';
import { Upgrade } from '@/types/game';
import {
  sendInputCommands,
  sendGameState,
  sendPing,
  sendPong,
  decodeGameState,
  MultiplayerMessage,
  MultiplayerPlayer,
} from '@/lib/multiplayer';
import {
  CommandBuffer,
  CommandQueue,
  ErrorSmoother,
  LatencyTracker,
  applyMoveCommand,
  encodeCommand,
  decodeCommand,
  InputCommand,
} from '@/lib/netcode';
import { CoopGuestWorld } from '@/lib/coopGuestWorld';
import { ViewTransform, createViewTransform, fitViewTransform } from '@/lib/viewport';
import { playLevelUp, playDamage, playWaveComplete, playExplosion, setMuted, isMuted, startMatchMusic, stopMatchMusic } from '@/lib/audio';
import { CoopGameScene } from './three/CoopGameScene';
import { CoopOverlay } from './three/CoopOverlay';
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
  teamNames: string[];
}

interface LocalPredictedProjectile {
  id: string;
  position: Vector2;
  velocity: Vector2;
  radius: number;
  color: string;
  lifeMs: number;
  maxLifeMs: number;
}

interface CoopGameProps {
  socket: PartySocket;
  players: MultiplayerPlayer[];
  isHost: boolean;
  arena: ArenaType;
  onGameOver: (score: number, wave: number, kills: number, stats?: GameOverStats) => void;
  onBack: () => void;
}

const PLAYER_COLORS = ['#00f0ff', '#ff2d6a'];

function recalculatePlayerStats(player: Player, currentTime: number): Player {
  const activeBuffs = (player.activeBuffs || []).filter(buff => buff.expiresAt > currentTime);
  const speedBuff = activeBuffs.find(buff => buff.type === 'speed');
  const magnetBuff = activeBuffs.find(buff => buff.type === 'magnet');
  const baseSpeed = player.baseSpeed || DEFAULT_CONFIG.playerSpeed;
  const speedBonus = player.speedBonus || 0;
  const magnetBonus = player.magnetBonus || 0;

  return {
    ...player,
    baseSpeed,
    speedBonus,
    magnetBonus,
    activeBuffs,
    speed: Math.min(8, (baseSpeed + speedBonus) * (speedBuff?.multiplier || 1)),
    magnetMultiplier: (1 + magnetBonus) * (magnetBuff?.multiplier || 1),
  };
}

function normalizeSyncedPlayer(player: Player): Player {
  return {
    ...player,
    activeBuffs: player.activeBuffs || [],
    speedBonus: player.speedBonus || 0,
    magnetBonus: player.magnetBonus || 0,
    baseSpeed: player.baseSpeed || DEFAULT_CONFIG.playerSpeed,
    speed: player.speed || player.baseSpeed || DEFAULT_CONFIG.playerSpeed,
    magnetMultiplier: player.magnetMultiplier || 1,
  };
}

function applyUpgradeToPlayer2(player: Player, upgrade: Upgrade): Player {
  let updatedPlayer = player;

  if (upgrade.type === 'weapon_new' && upgrade.weaponType) {
    updatedPlayer = {
      ...updatedPlayer,
      weapons: [
        ...updatedPlayer.weapons,
        {
          type: upgrade.weaponType,
          level: 1,
          lastFired: 0,
          ...WEAPON_CONFIGS[upgrade.weaponType],
        },
      ],
    };
  } else if (upgrade.type === 'weapon_upgrade' && upgrade.weaponType) {
    updatedPlayer = {
      ...updatedPlayer,
      weapons: updatedPlayer.weapons.map(w => {
        if (w.type === upgrade.weaponType) {
          return {
            ...w,
            level: w.level + 1,
            damage: w.damage * 1.2,
            fireRate: Math.max(50, w.fireRate * 0.9),
            projectileCount: w.type === 'spread' ? w.projectileCount + 1 : w.projectileCount,
            piercing: w.type === 'laser' ? (w.piercing || 0) + 1 : w.piercing,
          };
        }
        return w;
      }),
    };
  } else if (upgrade.type === 'stat') {
    switch (upgrade.stat) {
      case 'health':
        updatedPlayer = {
          ...updatedPlayer,
          maxHealth: updatedPlayer.maxHealth + 25,
          health: Math.min(updatedPlayer.health + 25, updatedPlayer.maxHealth + 25),
        };
        break;
      case 'speed':
        updatedPlayer = { ...updatedPlayer, speedBonus: (updatedPlayer.speedBonus || 0) + 0.5 };
        break;
      case 'magnet':
        updatedPlayer = { ...updatedPlayer, magnetBonus: (updatedPlayer.magnetBonus || 0) + 0.3 };
        break;
    }
  }

  return recalculatePlayerStats(updatedPlayer, Date.now());
}

export default function CoopGame({
  socket,
  players,
  isHost,
  arena,
  onGameOver,
  onBack,
}: CoopGameProps) {
  const gameAreaRef = useRef<HTMLDivElement>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const player2Ref = useRef<Player | null>(null);
  const animationFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const accRef = useRef<AccumulatorState | null>(null);
  const p1ImageRef = useRef<HTMLImageElement | null>(null);
  const p2ImageRef = useRef<HTMLImageElement | null>(null);
  const inputRef = useRef<{ keys: Set<string>; mousePos: Vector2; mouseDown: boolean; touchMovement?: Vector2 }>({
    keys: new Set(),
    mousePos: { x: 0, y: 0 },
    mouseDown: false,
  });
  const localPredictedProjectilesRef = useRef<LocalPredictedProjectile[]>([]);
  const localShotCooldownRef = useRef<Record<string, number>>({});

  // --- Netcode ---------------------------------------------------------------
  /** Host: jitter-buffered queue of the guest's input commands. */
  const commandQueueRef = useRef(new CommandQueue());
  /** Guest: unacknowledged commands, replayed on every server correction. */
  const commandBufferRef = useRef(new CommandBuffer());
  /** Guest: interpolated view of everything the host owns. */
  const guestWorldRef = useRef(new CoopGuestWorld());
  /** Guest: dead-reckoned position of its own avatar, before error smoothing. */
  const predictedP2Ref = useRef<{ position: Vector2; velocity: Vector2 }>({
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
  });
  const errorSmootherRef = useRef(new ErrorSmoother());
  const latencyRef = useRef(new LatencyTracker());
  const pendingReconcileRef = useRef<{ position: Vector2; velocity: Vector2; ack: number } | null>(null);
  const guestAccRef = useRef<AccumulatorState | null>(null);
  const lastPingSentRef = useRef(0);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

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
    health2: number;
    maxHealth2: number;
    level: number;
    experience: number;
    experienceToLevel: number;
    multiplier: number;
    killStreak: number;
    nearMissCount: number;
    activeEvent?: string;
    eventAnnounceTime?: number;
    weapons: { type: string; level: number }[];
    waveAnnounceTime?: number;
    gameTime: number;
  } | null>(null);
  const [showUpgrades, setShowUpgrades] = useState(false);
  const [availableUpgrades, setAvailableUpgrades] = useState<Upgrade[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(() => !isMuted());
  const [myUpgradeChoice, setMyUpgradeChoice] = useState<string | null>(null);
  const [otherUpgradeChoice, setOtherUpgradeChoice] = useState<string | null>(null);
  const [otherUpgradeName, setOtherUpgradeName] = useState<string | null>(null);
  const [waitingForOther, setWaitingForOther] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  /** Gates the first world build on knowing whether the camera will be zoomed out. */
  const [inputDetected, setInputDetected] = useState(false);
  const touchMovementRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchAimRef = useRef<{ x: number; y: number } | null>(null);
  /** Remembers the touch facing so releasing both sticks holds it. */
  const aimStateRef = useRef(createAimState());
  /** Reused every frame — the movement vector handed to the engine. */
  const moveScratchRef = useRef<Vector2>({ x: 0, y: 0 });
  const gamepadIndexRef = useRef<number | null>(null);
  const lastPausePress = useRef<number>(0);
  const lastWaveRef = useRef<number>(1);
  const lastHealthRef = useRef<number>(100);
  const lastSyncRef = useRef<number>(0);
  const lastInputSendRef = useRef<number>(0);
  const lastDisplayRef = useRef<number>(0);
  const guestUpgradeOptionsRef = useRef<Upgrade[]>([]);
  const gameOverSentRef = useRef(false);
  const gameOverHandledRef = useRef(false);
  const SYNC_INTERVAL = 40;
  /** Guest -> host input cadence. Each message resends recent commands so a
   *  dropped packet never costs a frame of movement. */
  const INPUT_SEND_INTERVAL = 33;
  const PING_INTERVAL = 1000;

  const mobileScale = isTouchDevice ? 0.7 : 1;
  const mobileScaleRef = useRef(mobileScale);
  mobileScaleRef.current = mobileScale;

  /** Arena size in world units, and the world-to-canvas mapping built from it. */
  const worldRef = useRef({ width: 800, height: 600 });
  const viewRef = useRef<ViewTransform>(createViewTransform());

  /**
   * Recomputes the arena size and the mapping that draws it.
   *
   * The host sizes the arena to its own screen; the guest adopts the host's
   * size and letterboxes it into whatever screen it has. Both players are then
   * looking at the same arena, which is the whole point — sizing each client's
   * world from its own viewport put them in different coordinate spaces, so
   * entities landed off-screen for the guest and its avatar fought the host
   * over where the walls were.
   */
  const syncView = useCallback(() => {
    const dims = dimensionsRef.current;
    const world = worldRef.current;
    if (dims.width <= 0 || dims.height <= 0) return world;

    const scale = mobileScaleRef.current;
    const hostWidth = isHost ? 0 : guestWorldRef.current.worldWidth;
    const hostHeight = isHost ? 0 : guestWorldRef.current.worldHeight;

    if (hostWidth > 0 && hostHeight > 0) {
      world.width = hostWidth;
      world.height = hostHeight;
    } else {
      // Host, or a guest that has not heard from one yet.
      world.width = Math.floor(dims.width / scale);
      world.height = Math.floor(dims.height / scale);
    }

    fitViewTransform(viewRef.current, dims.width, dims.height, world.width, world.height);
    return world;
  }, [isHost]);

  // Keep the mapping correct before the first simulated frame, and after every
  // resize or rotation.
  useEffect(() => { syncView(); }, [syncView, dimensions, mobileScale]);
  const myPlayer = players.find(p => p.id === socket.id);
  const otherPlayer = players.find(p => p.id !== socket.id);

  const finishGameOver = useCallback((override?: {
    score: number;
    wave: number;
    kills: number;
    stats: GameOverStats;
  }) => {
    if (gameOverHandledRef.current) return;
    gameOverHandledRef.current = true;

    if (override) {
      onGameOver(override.score, override.wave, override.kills, override.stats);
      return;
    }

    const gs = gameStateRef.current;
    if (!gs) return;

    onGameOver(
      gs.score,
      gs.wave,
      gs.player.kills + (player2Ref.current?.kills || 0),
      {
        totalDamageDealt: gs.totalDamageDealt,
        totalDamageTaken: gs.totalDamageTaken,
        survivalTime: Date.now() - gs.startTime,
        peakMultiplier: gs.peakMultiplier,
        weaponLevels: gs.player.weapons.map(w => ({ type: w.type, level: w.level })),
        teamNames: players.map(p => p.name),
      }
    );
  }, [onGameOver, players]);

  /** Ships recent unacknowledged commands to the host. */
  const flushGuestInput = useCallback((now: number) => {
    if (isHost) return;
    if (now - lastInputSendRef.current < INPUT_SEND_INTERVAL) return;
    lastInputSendRef.current = now;
    // Redundant resend: three copies of each command means a single lost packet
    // is invisible, which matters far more than the handful of bytes it costs.
    const recent = commandBufferRef.current.recent(12);
    if (recent.length > 0) sendInputCommands(socket, recent.map(encodeCommand));
  }, [isHost, socket]);

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

  // Initialize game (only once)
  const initGame = useCallback(async () => {
    // The arena the host owns, letterboxed into whatever screen this client has.
    const world = syncView();
    const effectiveWidth = world.width;
    const effectiveHeight = world.height;
    if (!isHost) {
      // Only the host records cosmetic events; the guest replays them.
      setEventRecording(false);
      let state = createInitialGameState(
        otherPlayer?.imageUrl || '',
        effectiveWidth,
        effectiveHeight,
        DEFAULT_CONFIG
      );
      state = { ...state, arena };
      state = await loadPlayerImage(state);
      state.player.color = PLAYER_COLORS[0];
      p1ImageRef.current = state.player.image;

      if (myPlayer?.imageUrl) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        try {
          await new Promise<void>((resolve, reject) => {
            img.onload = () => { p2ImageRef.current = img; resolve(); };
            img.onerror = reject;
            img.src = myPlayer.imageUrl;
          });
        } catch (e) {
          console.error('Failed to load P2 image on guest');
        }
      }

      state = startGame(state);
      gameStateRef.current = state;
      guestWorldRef.current.reset();
      commandBufferRef.current.clear();
      errorSmootherRef.current.reset();
      predictedP2Ref.current.position = { x: effectiveWidth / 2 + 50, y: effectiveHeight / 2 };
      predictedP2Ref.current.velocity = { x: 0, y: 0 };
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setEventRecording(true);
    commandQueueRef.current.reset();

    let state = createInitialGameState(
      myPlayer?.imageUrl || '',
      effectiveWidth,
      effectiveHeight,
      DEFAULT_CONFIG
    );
    state = { ...state, arena };
    state = await loadPlayerImage(state);
    state.player.color = PLAYER_COLORS[0];
    p1ImageRef.current = state.player.image;

    const p2: Player = {
      position: { x: effectiveWidth / 2 + 50, y: effectiveHeight / 2 },
      velocity: { x: 0, y: 0 },
      radius: DEFAULT_CONFIG.playerRadius,
      color: PLAYER_COLORS[1],
      health: DEFAULT_CONFIG.playerMaxHealth,
      maxHealth: DEFAULT_CONFIG.playerMaxHealth,
      baseSpeed: DEFAULT_CONFIG.playerSpeed,
      speed: DEFAULT_CONFIG.playerSpeed,
      image: null,
      imageUrl: otherPlayer?.imageUrl || '',
      invulnerableUntil: 0,
      weapons: [{
        type: 'blaster',
        level: 1,
        lastFired: 0,
        damage: 10,
        fireRate: 200,
        projectileSpeed: 12,
        projectileCount: 1,
        piercing: 0,
      }],
      experience: 0,
      level: 1,
      kills: 0,
      magnetMultiplier: 1,
      activeBuffs: [],
      speedBonus: 0,
      magnetBonus: 0,
    };

    if (otherPlayer?.imageUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      try {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => { p2.image = img; p2ImageRef.current = img; resolve(); };
          img.onerror = reject;
          img.src = otherPlayer.imageUrl;
        });
      } catch (e) {
        console.error('Failed to load P2 image');
      }
    }

    player2Ref.current = p2;
    state = startGame(state);
    gameStateRef.current = state;
    setIsLoading(false);
  }, [isHost, myPlayer, otherPlayer, arena, syncView]);

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

  useEffect(() => {
    if (isLoading) return;
    startMatchMusic();
    return () => stopMatchMusic();
  }, [isLoading]);

  // Handle multiplayer messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as MultiplayerMessage;

        if (data.type === 'input' && isHost) {
          commandQueueRef.current.push(data.cmds.map(decodeCommand));
        } else if (data.type === 'ping' && isHost) {
          // Echo straight back so the guest can measure a true round trip.
          sendPong(socket, data.t);
        } else if (data.type === 'pong' && !isHost) {
          latencyRef.current.sample(performance.now() - data.t);
        } else if (data.type === 'game-over' && !isHost) {
          if (gameStateRef.current) {
            gameStateRef.current.isGameOver = true;
            gameStateRef.current.isRunning = false;
            gameStateRef.current.score = data.score;
            gameStateRef.current.wave = data.wave;
          }
          finishGameOver({ score: data.score, wave: data.wave, kills: data.kills, stats: data.stats });
          return;
        } else if (data.type === 'game-state' && !isHost) {
          const snapshot = decodeGameState(data.state);
          if (!snapshot) return;

          guestWorldRef.current.ingest(snapshot, performance.timeOrigin + performance.now());

          if (snapshot.player2) {
            // The snapshot's "player2" is this client's own avatar. Its stats
            // are authoritative; its position feeds reconciliation rather than
            // being applied directly, so local input stays lag-free.
            const synced = normalizeSyncedPlayer(snapshot.player2 as unknown as Player);
            if (player2Ref.current) {
              synced.position = player2Ref.current.position;
            } else {
              synced.position = { ...snapshot.player2.position };
              predictedP2Ref.current.position = { ...snapshot.player2.position };
            }
            synced.image = p2ImageRef.current;
            player2Ref.current = synced;

            pendingReconcileRef.current = {
              position: { ...snapshot.player2.position },
              velocity: { ...snapshot.player2.velocity },
              ack: snapshot.ack,
            };
          }

          if (snapshot.isGameOver && gameStateRef.current) {
            gameStateRef.current.isGameOver = true;
            gameStateRef.current.isRunning = false;
            gameStateRef.current.score = snapshot.score;
            gameStateRef.current.wave = snapshot.wave;
            gameStateRef.current.player.kills = snapshot.player.kills;
            if (player2Ref.current) player2Ref.current.kills = snapshot.player2?.kills || 0;
          }
        }

        if (data.type === 'level-up' && !isHost) {
          setShowUpgrades(true);
          setAvailableUpgrades(data.availableUpgrades as Upgrade[]);
          setMyUpgradeChoice(null);
          setOtherUpgradeChoice(null);
          setOtherUpgradeName(null);
          setWaitingForOther(false);
          playLevelUp();
        }

        if (data.type === 'upgrade-selected') {
          setOtherUpgradeChoice(data.upgradeId);
          setOtherUpgradeName(data.upgradeName || null);
        }

        if (data.type === 'upgrades-complete') {
          setShowUpgrades(false);
          setAvailableUpgrades([]);
          setMyUpgradeChoice(null);
          setOtherUpgradeChoice(null);
          setOtherUpgradeName(null);
          setWaitingForOther(false);
        }
      } catch (e) {
        console.error('Failed to parse multiplayer message:', e);
      }
    };

    socket.addEventListener('message', handleMessage);
    return () => socket.removeEventListener('message', handleMessage);
  }, [socket, isHost, finishGameOver]);

  // Handle input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      inputRef.current.keys.add(key);
      if (key === 'escape') setIsPaused(p => !p);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      inputRef.current.keys.delete(e.key.toLowerCase());
    };

    const handleMouseMove = (e: MouseEvent) => {
      const el = gameAreaRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Undo the same zoom and letterbox offset the renderer applies.
      const view = viewRef.current;
      inputRef.current.mousePos = {
        x: (e.clientX - rect.left - view.offsetX) / view.scale,
        y: (e.clientY - rect.top - view.offsetY) / view.scale,
      };
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
      window.removeEventListener('gamepadconnected', handleGamepadConnected);
      window.removeEventListener('gamepaddisconnected', handleGamepadDisconnected);
    };
  }, []);

  const resolveUpgradeRound = useCallback((p1UpgradeId: string, p2UpgradeId: string) => {
    if (!isHost || !gameStateRef.current) return;

    const p1Upgrade = availableUpgrades.find(u => u.id === p1UpgradeId);
    const p2Upgrade = guestUpgradeOptionsRef.current.find(u => u.id === p2UpgradeId);

    if (p1Upgrade) gameStateRef.current = applyUpgrade(gameStateRef.current, p1Upgrade);
    if (player2Ref.current && p2Upgrade) player2Ref.current = applyUpgradeToPlayer2(player2Ref.current, p2Upgrade);

    socket.send(JSON.stringify({ type: 'upgrades-complete', p1UpgradeId, p2UpgradeId }));

    if (gameStateRef.current.pendingLevelUps > 0) {
      const nextHostUpgrades = gameStateRef.current.availableUpgrades;
      const nextGuestUpgrades = player2Ref.current ? generateUpgrades(player2Ref.current) : nextHostUpgrades;
      guestUpgradeOptionsRef.current = nextGuestUpgrades;

      socket.send(JSON.stringify({ type: 'level-up', availableUpgrades: nextGuestUpgrades, level: gameStateRef.current.player.level }));
      setAvailableUpgrades(nextHostUpgrades);
      setMyUpgradeChoice(null);
      setOtherUpgradeChoice(null);
      setOtherUpgradeName(null);
      setWaitingForOther(false);
      return;
    }

    setShowUpgrades(false);
    setAvailableUpgrades([]);
    setMyUpgradeChoice(null);
    setOtherUpgradeChoice(null);
    setOtherUpgradeName(null);
    setWaitingForOther(false);
  }, [availableUpgrades, isHost, socket]);

  const handleUpgrade = useCallback((upgrade: Upgrade) => {
    setMyUpgradeChoice(upgrade.id);
    socket.send(JSON.stringify({
      type: 'upgrade-selected',
      playerId: socket.id,
      upgradeId: upgrade.id,
      upgradeName: upgrade.name,
      isHost,
    }));

    if (otherUpgradeChoice && isHost) {
      resolveUpgradeRound(upgrade.id, otherUpgradeChoice);
    } else {
      setWaitingForOther(true);
    }
  }, [socket, isHost, otherUpgradeChoice, resolveUpgradeRound]);

  useEffect(() => {
    if (isHost && myUpgradeChoice && otherUpgradeChoice && waitingForOther) {
      resolveUpgradeRound(myUpgradeChoice, otherUpgradeChoice);
    }
  }, [isHost, myUpgradeChoice, otherUpgradeChoice, waitingForOther, resolveUpgradeRound]);

  // Shared display-state publisher — runs for host *and* guest. The guest used
  // to get no HUD at all because this only lived inside the host branch.
  const publishDisplayState = useCallback(() => {
    const gs = gameStateRef.current;
    if (!gs) return;
    setDisplayState({
      score: gs.score,
      wave: gs.wave,
      health: gs.player.health,
      maxHealth: gs.player.maxHealth,
      health2: player2Ref.current?.health || 0,
      maxHealth2: player2Ref.current?.maxHealth || 100,
      level: gs.player.level,
      experience: gs.player.experience,
      experienceToLevel: DEFAULT_CONFIG.experienceToLevel * gs.player.level,
      multiplier: gs.multiplier,
      killStreak: gs.killStreak,
      nearMissCount: gs.nearMissCount,
      activeEvent: gs.activeEvent,
      eventAnnounceTime: gs.eventAnnounceTime,
      // The HUD belongs to whoever is holding this device, not to P1.
      weapons: (isHost ? gs.player : player2Ref.current ?? gs.player).weapons
        .map(w => ({ type: w.type, level: w.level })),
      waveAnnounceTime: gs.waveAnnounceTime,
      gameTime: gs.gameTime,
    });
  }, [isHost]);

  // Game loop — logic only, no rendering
  useEffect(() => {
    if (isLoading) return;

    const gameLoop = (timestamp: number) => {
      const frameDelta = Math.min((timestamp - lastTimeRef.current) / 16.67, 3);
      lastTimeRef.current = timestamp;
      // Re-read every frame: the host can rotate its device, and the guest
      // follows whatever arena the latest snapshot describes.
      const world = syncView();
      const effectiveWidth = world.width;
      const effectiveHeight = world.height;
      const nowMs = Date.now();

      if (!accRef.current) accRef.current = createAccumulator(timestamp);
      if (!guestAccRef.current) guestAccRef.current = createAccumulator(timestamp);

      // The avatar this client actually drives.
      const localPlayer = isHost ? gameStateRef.current?.player : player2Ref.current;

      // ---------------------------------------------------------------- input
      let moveX = 0;
      let moveY = 0;

      if (isTouchDevice) {
        // Analog stick straight through — no 8-way key quantisation.
        const tm = touchMovementRef.current;
        moveX = tm.x;
        moveY = tm.y;
      }

      if (gamepadIndexRef.current !== null) {
        const gamepad = navigator.getGamepads()[gamepadIndexRef.current];
        if (gamepad) {
          const deadzone = 0.15;
          const lx = Math.abs(gamepad.axes[0]) > deadzone ? gamepad.axes[0] : 0;
          const ly = Math.abs(gamepad.axes[1]) > deadzone ? gamepad.axes[1] : 0;
          if (lx !== 0 || ly !== 0) {
            moveX = lx;
            moveY = ly;
          }

          const rx = Math.abs(gamepad.axes[2]) > deadzone ? gamepad.axes[2] : 0;
          const ry = Math.abs(gamepad.axes[3]) > deadzone ? gamepad.axes[3] : 0;
          if ((rx !== 0 || ry !== 0) && localPlayer) {
            inputRef.current.mousePos = {
              x: localPlayer.position.x + rx * 200,
              y: localPlayer.position.y + ry * 200,
            };
          }

          if (gamepad.buttons[9]?.pressed && timestamp - lastPausePress.current > 300) {
            lastPausePress.current = timestamp;
            setIsPaused(p => !p);
          }
        }
      }

      if (moveX === 0 && moveY === 0) {
        // Keyboard fallback.
        if (inputRef.current.keys.has('w') || inputRef.current.keys.has('arrowup')) moveY -= 1;
        if (inputRef.current.keys.has('s') || inputRef.current.keys.has('arrowdown')) moveY += 1;
        if (inputRef.current.keys.has('a') || inputRef.current.keys.has('arrowleft')) moveX -= 1;
        if (inputRef.current.keys.has('d') || inputRef.current.keys.has('arrowright')) moveX += 1;
        const len = Math.hypot(moveX, moveY);
        if (len > 1) {
          moveX /= len;
          moveY /= len;
        }
      }

      // Feed the shared movement path used by the single-player engine.
      const move = moveScratchRef.current;
      move.x = moveX;
      move.y = moveY;
      inputRef.current.touchMovement = (moveX !== 0 || moveY !== 0) ? move : undefined;

      // Aim: gamepad right stick and mouse have already written mousePos above.
      // On touch the aim stick points the gun, and with it idle the player
      // shoots the way they are walking — nothing targets an enemy for them.
      if (isTouchDevice && localPlayer) {
        resolveTouchAim(
          aimStateRef.current,
          localPlayer.position,
          touchAimRef.current,
          move,
          inputRef.current.mousePos,
        );
      }

      const canAct = !isPaused && !showUpgrades;

      // ------------------------------------------------------------ host path
      if (isHost && gameStateRef.current) {
        const simulating = canAct && gameStateRef.current.isRunning;

        if (simulating) {
          const gs = gameStateRef.current;
          const slowMoFactor = (gs.slowMoUntil && nowMs < gs.slowMoUntil)
            ? (gs.slowMoFactor || 0.3) : 1;

          const { acc: newAcc, tickCount } = advanceAccumulator(accRef.current, timestamp, slowMoFactor);
          accRef.current = newAcc;

          for (let ti = 0; ti < tickCount; ti++) {
            gameStateRef.current = updateGameState(
              gameStateRef.current,
              FIXED_DT,
              effectiveWidth,
              effectiveHeight,
              inputRef.current,
              DEFAULT_CONFIG,
              player2Ref.current
            );

            // P2 advances inside the same fixed tick as everything else. It used
            // to run once per rendered frame with a wall-clock delta, which made
            // the second player's movement frame-rate dependent and produced
            // jittery snapshots for the guest to interpolate.
            if (player2Ref.current) {
              simulateRemotePlayerTick(effectiveWidth, effectiveHeight);
            }

            if (gameStateRef.current.isGameOver) break;
          }

          // Co-op game over: both down.
          const p1Dead = gameStateRef.current.player.health <= 0;
          const p2Dead = !!player2Ref.current && player2Ref.current.health <= 0;
          if (p1Dead && p2Dead) gameStateRef.current.isGameOver = true;
        } else {
          // Re-anchor the accumulator so resuming does not fire a burst of
          // catch-up ticks for the time spent paused.
          accRef.current = createAccumulator(timestamp);
        }

        // ---- snapshot ----
        // Sent even while paused: the guest needs a continuing snapshot stream
        // to keep its interpolation clock alive and to receive input acks,
        // otherwise the world visibly drifts and then freezes on its side.
        if (timestamp - lastSyncRef.current >= SYNC_INTERVAL) {
          // Advance on a fixed grid so the cadence stays steady instead of
          // drifting with frame times; resync if we fell far behind.
          lastSyncRef.current += SYNC_INTERVAL;
          if (timestamp - lastSyncRef.current > SYNC_INTERVAL * 4) lastSyncRef.current = timestamp;
          sendSnapshot(timestamp);
        }

        if (timestamp - lastDisplayRef.current > 100) {
          lastDisplayRef.current = timestamp;
          publishDisplayState();
        }

        // Level ups
        if (gameStateRef.current.pendingLevelUps > 0 && !showUpgrades) {
          const hostUpgrades = gameStateRef.current.availableUpgrades;
          const guestUpgrades = player2Ref.current ? generateUpgrades(player2Ref.current) : hostUpgrades;
          guestUpgradeOptionsRef.current = guestUpgrades;
          setShowUpgrades(true);
          setAvailableUpgrades(hostUpgrades);
          setMyUpgradeChoice(null);
          setOtherUpgradeChoice(null);
          setOtherUpgradeName(null);
          setWaitingForOther(false);
          playLevelUp();
          socket.send(JSON.stringify({ type: 'level-up', availableUpgrades: guestUpgrades, level: gameStateRef.current.player.level }));
        }

        if (gameStateRef.current.wave > lastWaveRef.current) {
          lastWaveRef.current = gameStateRef.current.wave;
          playWaveComplete();
        }
        if (gameStateRef.current.player.health < lastHealthRef.current) {
          playDamage();
          if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(30);
        }
        lastHealthRef.current = gameStateRef.current.player.health;
      }

      // ----------------------------------------------------------- guest path
      if (!isHost && gameStateRef.current) {
        const world = guestWorldRef.current;
        const localNow = performance.timeOrigin + timestamp;

        // --- own avatar: predict, then reconcile ---
        if (player2Ref.current && gameStateRef.current.isRunning) {
          player2Ref.current = recalculatePlayerStats(player2Ref.current, nowMs);
          const p2 = player2Ref.current;
          const bounds = { width: effectiveWidth, height: effectiveHeight, radius: p2.radius };
          const predicted = predictedP2Ref.current;

          const reconcile = pendingReconcileRef.current;
          if (reconcile) {
            pendingReconcileRef.current = null;
            const beforeX = predicted.position.x;
            const beforeY = predicted.position.y;

            // Rewind to the host's authoritative result, then replay every
            // command it hasn't seen yet. Local input therefore stays
            // instantaneous while still converging on the server's truth.
            commandBufferRef.current.acknowledge(reconcile.ack);
            predicted.position.x = reconcile.position.x;
            predicted.position.y = reconcile.position.y;
            predicted.velocity.x = reconcile.velocity.x;
            predicted.velocity.y = reconcile.velocity.y;

            for (const cmd of commandBufferRef.current.unacknowledged) {
              applyMoveCommand(predicted.position, predicted.velocity, cmd, p2.speed, bounds, FIXED_DT);
            }

            // Fold the correction into a decaying visual offset instead of
            // teleporting the avatar.
            errorSmootherRef.current.absorb(
              beforeX - predicted.position.x,
              beforeY - predicted.position.y,
            );
          }

          const aim = Math.atan2(
            inputRef.current.mousePos.y - predicted.position.y,
            inputRef.current.mousePos.x - predicted.position.x,
          );

          const { acc: gAcc, tickCount: gTicks } = advanceAccumulator(guestAccRef.current, timestamp, 1);
          guestAccRef.current = gAcc;

          // Commands are produced even while paused, but zeroed. Skipping them
          // entirely would leave the host's queue empty, and an empty queue
          // holds the last input — the guest would keep sliding on the host's
          // side for as long as the overlay was up.
          for (let ti = 0; ti < gTicks; ti++) {
            const cmd = canAct
              ? commandBufferRef.current.create(moveX, moveY, aim)
              : commandBufferRef.current.create(0, 0, aim);
            applyMoveCommand(predicted.position, predicted.velocity, cmd, p2.speed, bounds, FIXED_DT);
          }

          errorSmootherRef.current.decay(frameDelta);
          p2.position.x = predicted.position.x + errorSmootherRef.current.x;
          p2.position.y = predicted.position.y + errorSmootherRef.current.y;
          p2.velocity.x = predicted.velocity.x;
          p2.velocity.y = predicted.velocity.y;

          if (canAct) predictLocalShots(p2, effectiveWidth, effectiveHeight);
        }

        flushGuestInput(timestamp);

        if (timestamp - lastPingSentRef.current > PING_INTERVAL) {
          lastPingSentRef.current = timestamp;
          sendPing(socket, performance.now());
          setLatencyMs(Math.round(latencyRef.current.rttMs));
        }

        // --- remote world: render on the delayed, interpolated timeline ---
        const renderTime = world.renderTime(localNow);
        world.replayDueEvents(renderTime, {
          onEnemyHit: (id) => world.flashEnemy(id, nowMs),
          onKill: (_x, _y, radius, isBoss) => {
            if (isBoss || radius >= 22) playExplosion();
          },
          onPlayerHurt: (heavy, isLocal) => {
            playDamage();
            if (!gameStateRef.current) return;
            // Both players' hits are audible — that is useful co-op awareness —
            // but only your own shakes the screen and buzzes the device.
            if (isLocal) {
              gameStateRef.current.screenFlash = nowMs;
              gameStateRef.current.screenFlashColor = '255, 45, 106';
              gameStateRef.current.screenShake = Math.max(gameStateRef.current.screenShake, heavy ? 26 : 14);
              if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(heavy ? 35 : 18);
            }
          },
          onBlast: () => {
            if (gameStateRef.current) {
              gameStateRef.current.screenFlash = nowMs;
              gameStateRef.current.screenFlashColor = '255, 170, 45';
            }
          },
        });
        world.sample(renderTime, gameStateRef.current);
        gameStateRef.current.player.image = p1ImageRef.current;

        // The guest owns its own particle simulation — the effects it spawns
        // from replayed events still need to be animated.
        updateParticles(frameDelta);
        gameStateRef.current.particleCount = getParticleCount();

        advanceLocalShots(frameDelta, effectiveWidth, effectiveHeight);
        // Retire local tracers once the authoritative shot has caught up to
        // them, so the two never render on top of each other.
        reconcileLocalShots(world.projectiles);

        if (timestamp - lastDisplayRef.current > 100) {
          lastDisplayRef.current = timestamp;
          publishDisplayState();
        }

        if (gameStateRef.current.wave > lastWaveRef.current) {
          lastWaveRef.current = gameStateRef.current.wave;
          playWaveComplete();
        }
      }

      // Attach player2 to gameState so scene components can read it
      if (gameStateRef.current) {
        (gameStateRef.current as any).player2 = player2Ref.current;
      }

      // Check game over
      if (gameStateRef.current?.isGameOver) {
        const gs = gameStateRef.current;
        const finalStats: GameOverStats = {
          totalDamageDealt: gs.totalDamageDealt,
          totalDamageTaken: gs.totalDamageTaken,
          survivalTime: Date.now() - gs.startTime,
          peakMultiplier: gs.peakMultiplier,
          weaponLevels: gs.player.weapons.map(w => ({ type: w.type, level: w.level })),
          teamNames: players.map(p => p.name),
        };
        const totalKills = gs.player.kills + (player2Ref.current?.kills || 0);

        if (isHost && !gameOverSentRef.current) {
          gameOverSentRef.current = true;
          socket.send(JSON.stringify({ type: 'game-over', score: gs.score, wave: gs.wave, kills: totalKills, stats: finalStats }));
        }

        finishGameOver({ score: gs.score, wave: gs.wave, kills: totalKills, stats: finalStats });
        return;
      }

      animationFrameRef.current = requestAnimationFrame(gameLoop);
    };

    // ---------------------------------------------------------------- helpers

    /** Host: one fixed tick of the guest's avatar, driven by its input queue. */
    function simulateRemotePlayerTick(width: number, height: number) {
      const gs = gameStateRef.current;
      if (!gs || !player2Ref.current) return;

      player2Ref.current = recalculatePlayerStats(player2Ref.current, Date.now());
      const p2 = player2Ref.current;
      const queue = commandQueueRef.current;

      // Every command exactly once, in order, and nothing else moves P2 — that
      // identity is what lets the guest's prediction land on this answer rather
      // than near it. Network timing is absorbed by the buffer instead: no
      // steps while waiting on a late packet, two while spending a surplus.
      const bounds = { width, height, radius: p2.radius };
      const steps = queue.stepsThisTick();
      for (let step = 0; step < steps; step++) {
        applyMoveCommand(p2.position, p2.velocity, queue.next(), p2.speed, bounds, FIXED_DT);
      }

      const now = Date.now();
      // Aim holds through a gap in the stream; only movement waits.
      const aimAngle = queue.lastAim;
      const aimPos = {
        x: p2.position.x + Math.cos(aimAngle) * 200,
        y: p2.position.y + Math.sin(aimAngle) * 200,
      };

      for (const weapon of p2.weapons) {
        if (now - weapon.lastFired < weapon.fireRate) continue;
        const angle = Math.atan2(aimPos.y - p2.position.y, aimPos.x - p2.position.x);
        const projectileCount = weapon.projectileCount || 1;

        for (let i = 0; i < projectileCount; i++) {
          let projectileAngle = angle;
          if (projectileCount > 1) {
            const spread = weapon.type === 'spread' ? Math.PI / 3 : Math.PI / 6;
            projectileAngle = angle - spread / 2 + (spread * i / (projectileCount - 1));
          }

          const proj = acquireProjectile();
          proj.id = `p2-${proj.nid}`;
          proj.position.x = p2.position.x;
          proj.position.y = p2.position.y;
          proj.velocity.x = Math.cos(projectileAngle) * weapon.projectileSpeed;
          proj.velocity.y = Math.sin(projectileAngle) * weapon.projectileSpeed;
          proj.radius = 6;
          proj.color = PLAYER_COLORS[1];
          proj.damage = weapon.damage;
          proj.isEnemy = false;
          proj.piercing = weapon.piercing || 0;
          proj.weaponType = weapon.type;
          proj.hitEnemies.clear();
        }
        createMuzzleFlash(p2.position, angle, PLAYER_COLORS[1], 1);
        weapon.lastFired = now;
      }

      // P2 contact damage
      for (const enemy of gs.enemies) {
        const dist = Math.hypot(enemy.position.x - p2.position.x, enemy.position.y - p2.position.y);
        if (dist < enemy.radius + p2.radius && now > p2.invulnerableUntil) {
          p2.health -= enemy.damage;
          p2.invulnerableUntil = now + 1000;
          gs.totalDamageTaken += enemy.damage;
          gs.screenShake = Math.max(gs.screenShake, 22);
          createPlayerHurtEffect(p2.position, true);
          recordEvent([
            NetEventKind.PlayerHurt,
            now,
            Math.round(p2.position.x),
            Math.round(p2.position.y),
            enemy.damage,
            1, // heavy
            1, // owner: the guest's avatar
          ]);
          playDamage();
        }
      }

      // P2 magnet + XP pickup
      const magnetRange = 100 * p2.magnetMultiplier;
      const orbCount = getXPOrbCount();
      for (let i = orbCount - 1; i >= 0; i--) {
        const orb = gs.experienceOrbs[i];
        const dist = Math.hypot(orb.position.x - p2.position.x, orb.position.y - p2.position.y);
        if (dist < magnetRange) {
          const pullStrength = 0.1 * (1 - dist / magnetRange);
          orb.position.x += (p2.position.x - orb.position.x) * pullStrength;
          orb.position.y += (p2.position.y - orb.position.y) * pullStrength;
        }
        if (dist < p2.radius + 8) {
          gs.player.experience += orb.value;
          releaseXPOrb(orb);
        }
      }

      gs.projectileCount = getProjectileCount();
      gs.experienceOrbCount = getXPOrbCount();
    }

    /** Host: build and send an authoritative snapshot. */
    function sendSnapshot(timestamp: number) {
      const gs = gameStateRef.current;
      if (!gs) return;
      const arenaSize = worldRef.current;

      const prunedPlayer = {
        position: gs.player.position,
        velocity: gs.player.velocity,
        health: gs.player.health,
        maxHealth: gs.player.maxHealth,
        radius: gs.player.radius,
        color: gs.player.color,
        invulnerableUntil: gs.player.invulnerableUntil,
        level: gs.player.level,
        experience: gs.player.experience,
        kills: gs.player.kills,
        weapons: gs.player.weapons.map(w => ({ type: w.type, level: w.level })),
        speed: gs.player.speed,
        baseSpeed: gs.player.baseSpeed,
        speedBonus: gs.player.speedBonus,
        magnetMultiplier: gs.player.magnetMultiplier,
        magnetBonus: gs.player.magnetBonus,
        activeBuffs: gs.player.activeBuffs,
      };

      const p2 = player2Ref.current;
      const prunedPlayer2 = p2 ? {
        position: p2.position,
        velocity: p2.velocity,
        health: p2.health,
        maxHealth: p2.maxHealth,
        radius: p2.radius,
        color: p2.color,
        invulnerableUntil: p2.invulnerableUntil,
        level: p2.level,
        experience: p2.experience,
        kills: p2.kills,
        weapons: p2.weapons.map(w => ({
          type: w.type, level: w.level, damage: w.damage, fireRate: w.fireRate,
          projectileSpeed: w.projectileSpeed, projectileCount: w.projectileCount,
          piercing: w.piercing, lastFired: w.lastFired,
        })),
        speed: p2.speed,
        baseSpeed: p2.baseSpeed,
        speedBonus: p2.speedBonus,
        magnetMultiplier: p2.magnetMultiplier,
        magnetBonus: p2.magnetBonus,
        activeBuffs: p2.activeBuffs,
      } : null;

      sendGameState(socket, {
        // Timestamped on the shared Date epoch so the guest can align it with
        // the event timeline and its own clock.
        t: performance.timeOrigin + timestamp,
        ack: commandQueueRef.current.ackSeq,
        // The guest has no way to know how big the host's arena is, and gets
        // its own bounds and camera from these.
        worldWidth: arenaSize.width,
        worldHeight: arenaSize.height,
        player: prunedPlayer,
        player2: prunedPlayer2,
        score: gs.score,
        wave: gs.wave,
        multiplier: gs.multiplier,
        killStreak: gs.killStreak,
        nearMissCount: gs.nearMissCount,
        gameTime: gs.gameTime,
        screenShake: gs.screenShake,
        pendingLevelUps: gs.pendingLevelUps,
        // Handed over as-is; the encoder reads only the fields that go on the
        // wire, and stops at the counts rather than walking the whole pool.
        enemies: gs.enemies,
        projectiles: gs.projectiles,
        projectileCount: getProjectileCount(),
        powerups: gs.powerups,
        experienceOrbs: gs.experienceOrbs,
        experienceOrbCount: getXPOrbCount(),
        events: drainEvents(),
        isGameOver: gs.isGameOver,
        isRunning: gs.isRunning,
        activeEvent: gs.activeEvent,
        eventAnnounceTime: gs.eventAnnounceTime,
        waveAnnounceTime: gs.waveAnnounceTime,
      });
    }

    /** Guest: fire local tracer rounds so shooting feels instant. */
    function predictLocalShots(p2: Player, width: number, height: number) {
      const mousePos = inputRef.current.mousePos;
      const now = Date.now();
      // Local tracers must survive until the authoritative shot shows up on the
      // delayed timeline, which is half a round trip plus the interpolation lag.
      const lifeMs = Math.max(
        140,
        Math.min(520, latencyRef.current.halfRttMs + guestWorldRef.current.interpolationDelayMs + 60),
      );

      p2.weapons.forEach((weapon, weaponIndex) => {
        const cooldownKey = `${weapon.type}-${weaponIndex}`;
        const lastShotAt = localShotCooldownRef.current[cooldownKey] || 0;
        if (now - lastShotAt < weapon.fireRate) return;

        const angle = Math.atan2(mousePos.y - p2.position.y, mousePos.x - p2.position.x);
        const projectileCount = weapon.projectileCount || 1;

        for (let i = 0; i < projectileCount; i++) {
          let projectileAngle = angle;
          if (projectileCount > 1) {
            const spread = weapon.type === 'spread' ? Math.PI / 3 : Math.PI / 6;
            projectileAngle = angle - spread / 2 + (spread * i / (projectileCount - 1));
          }

          localPredictedProjectilesRef.current.push({
            id: `local-p2-${now}-${Math.random()}-${i}`,
            position: { ...p2.position },
            velocity: {
              x: Math.cos(projectileAngle) * weapon.projectileSpeed,
              y: Math.sin(projectileAngle) * weapon.projectileSpeed,
            },
            radius: 6,
            color: PLAYER_COLORS[1],
            lifeMs,
            maxLifeMs: lifeMs,
          });
        }

        createMuzzleFlash(p2.position, angle, PLAYER_COLORS[1], 1);
        localShotCooldownRef.current[cooldownKey] = now;
      });
    }

    /** Drops predicted tracers that the real projectile has now replaced. */
    function reconcileLocalShots(authoritative: { position: Vector2; color: string; isEnemy: boolean }[]) {
      const list = localPredictedProjectilesRef.current;
      if (list.length === 0) return;

      let write = 0;
      for (let i = 0; i < list.length; i++) {
        const local = list[i];
        let matched = false;
        for (let j = 0; j < authoritative.length; j++) {
          const auth = authoritative[j];
          if (auth.isEnemy || auth.color !== PLAYER_COLORS[1]) continue;
          const dx = auth.position.x - local.position.x;
          const dy = auth.position.y - local.position.y;
          if (dx * dx + dy * dy < 400) {
            matched = true;
            break;
          }
        }
        if (!matched) list[write++] = local;
      }
      list.length = write;
    }

    function advanceLocalShots(delta: number, width: number, height: number) {
      const list = localPredictedProjectilesRef.current;
      if (list.length === 0) return;
      const frameMs = delta * 16.67;

      let write = 0;
      for (let i = 0; i < list.length; i++) {
        const proj = list[i];
        proj.position.x += proj.velocity.x * delta;
        proj.position.y += proj.velocity.y * delta;
        proj.lifeMs -= frameMs;
        if (
          proj.lifeMs > 0 &&
          proj.position.x >= -20 && proj.position.x <= width + 20 &&
          proj.position.y >= -20 && proj.position.y <= height + 20
        ) {
          list[write++] = proj;
        }
      }
      list.length = write;
    }

    lastTimeRef.current = performance.now();
    accRef.current = null;
    guestAccRef.current = null;
    animationFrameRef.current = requestAnimationFrame(gameLoop);

    return () => { cancelAnimationFrame(animationFrameRef.current); };
  }, [isLoading, isPaused, showUpgrades, isHost, socket, players, finishGameOver, flushGuestInput, isTouchDevice, publishDisplayState, syncView]);

  return (
    <div className={`fixed inset-0 bg-brutal-black flex flex-col ${isTouchDevice ? 'game-touch-area safe-area-top safe-area-bottom safe-area-x' : ''}`}>
      {/* Header - hidden on mobile */}
      <div className={`h-12 flex items-center justify-between px-4 border-b border-white/10 bg-brutal-dark/80 backdrop-blur-sm z-10 ${isTouchDevice ? 'hidden' : ''}`}>
        <button onClick={onBack} className="font-mono text-xs uppercase tracking-wider text-white/40 hover:text-electric-pink transition-colors">
          {'<--'} EXIT
        </button>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-electric-cyan" />
            <span className="font-mono text-xs text-white/60">{isHost ? myPlayer?.name : otherPlayer?.name}</span>
          </div>
          <span className="text-white/20">{'\u00D7'}</span>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-electric-pink" />
            <span className="font-mono text-xs text-white/60">{isHost ? otherPlayer?.name : myPlayer?.name}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {!isHost && latencyMs !== null && (
            <span
              className="font-mono text-[10px] uppercase tracking-wider"
              style={{ color: latencyMs < 80 ? '#39ff14' : latencyMs < 160 ? '#e4ff1a' : '#ff2d6a' }}
              title="Round-trip time to the host"
            >
              {latencyMs}ms
            </span>
          )}
          <button
            onClick={handleToggleSound}
            className="font-mono text-xs uppercase tracking-wider text-white/40 hover:text-electric-cyan transition-colors"
          >
            {soundEnabled ? '\uD83D\uDD0A' : '\uD83D\uDD07'}
          </button>
          <button
            onClick={() => setIsPaused(p => !p)} disabled={isLoading}
            className="font-mono text-xs uppercase tracking-wider text-white/40 hover:text-electric-cyan transition-colors disabled:opacity-30"
          >
            {isPaused ? '\u25B6 RESUME' : '|| PAUSE'}
          </button>
        </div>
      </div>

      {/* Game area */}
      <div ref={gameAreaRef} className="flex-1 min-h-0 relative overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-brutal-black z-20">
            <div className="text-center">
              <div className="font-display text-5xl text-electric-cyan mb-4 animate-pulse">{'//'}</div>
              <p className="font-mono text-xs uppercase tracking-wider text-white/60">
                {isHost ? 'Initializing co-op arena...' : 'Syncing with host...'}
              </p>
            </div>
          </div>
        )}

        {isPaused && !isLoading && !showUpgrades && (
          <div className="absolute inset-0 flex items-center justify-center bg-brutal-black/90 z-20">
            <div className="text-center">
              <div className="font-display text-6xl text-electric-yellow mb-4">||</div>
              <p className="font-mono text-xs uppercase tracking-wider text-white/60 mb-6">Game Paused</p>
              <div className="space-y-3">
                <button onClick={() => setIsPaused(false)} className="block w-48 mx-auto btn-brutal">Resume</button>
                <button onClick={handleToggleSound} className="block w-48 mx-auto btn-brutal-outline">
                  Sound: {soundEnabled ? 'On' : 'Off'}
                </button>
                <button onClick={onBack} className="block w-48 mx-auto btn-brutal-outline">Quit Game</button>
              </div>
            </div>
          </div>
        )}

        {showUpgrades && (
          <div className="absolute inset-0 bg-brutal-black/95 z-30 overflow-y-auto overscroll-contain">
            <div className="min-h-full flex items-center justify-center p-4">
              <div className="text-center max-w-2xl w-full">
                <div className="font-display text-3xl sm:text-4xl text-electric-cyan mb-2 glitch-text" data-text="LEVEL UP!">LEVEL UP!</div>
                <p className="font-mono text-xs sm:text-sm text-white/60 mb-2">Level {displayState?.level || 1} — Choose an upgrade</p>
                <p className="font-mono text-xs text-white/40 mb-4">Each player picks their own upgrade!</p>

                {waitingForOther && (
                  <div className="mb-4 p-2 sm:p-3 bg-electric-yellow/20 border border-electric-yellow/40">
                    <p className="font-mono text-xs sm:text-sm text-electric-yellow animate-pulse">Waiting for teammate to choose...</p>
                  </div>
                )}

                {otherUpgradeChoice && (
                  <div className="mb-4 p-2 bg-electric-pink/20 border border-electric-pink/40">
                    <p className="font-mono text-xs text-electric-pink">
                      {otherPlayer?.name || 'Teammate'} picked: {otherUpgradeName || 'Locked in'}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                  {availableUpgrades.map((upgrade) => {
                    const isMyChoice = myUpgradeChoice === upgrade.id;
                    const isTeammateChoice = otherUpgradeChoice === upgrade.id;
                    return (
                      <button
                        key={upgrade.id}
                        onClick={() => !myUpgradeChoice && handleUpgrade(upgrade)}
                        disabled={!!myUpgradeChoice}
                        className={`group relative bg-brutal-dark border-2 p-4 sm:p-5 md:p-6 transition-all duration-200 flex items-center gap-4 text-left sm:block sm:text-center ${
                          myUpgradeChoice
                            ? isMyChoice ? 'border-electric-cyan scale-105'
                              : isTeammateChoice ? 'border-electric-pink'
                              : 'border-white/10 opacity-50'
                            : 'border-white/20 hover:border-electric-cyan hover:scale-105 active:scale-95'
                        }`}
                        style={{ borderColor: isMyChoice ? '#00f0ff' : isTeammateChoice ? '#ff2d6a' : `${upgrade.color}40` }}
                      >
                        {isMyChoice && <div className="absolute top-1 right-2 text-electric-cyan text-[10px] sm:text-xs font-mono">YOUR PICK</div>}
                        {isTeammateChoice && <div className="absolute top-1 left-2 text-electric-pink text-[10px] sm:text-xs font-mono">P2 PICK</div>}
                        <div className="absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity" style={{ backgroundColor: upgrade.color }} />
                        <div className="relative z-10 text-3xl sm:text-4xl shrink-0 sm:mb-3">{upgrade.icon}</div>
                        <div className="relative z-10 min-w-0">
                          <div className="font-display text-lg sm:text-xl sm:mb-2" style={{ color: upgrade.color }}>{upgrade.name}</div>
                          <p className="font-mono text-xs text-white/60">{upgrade.description}</p>
                        </div>
                      </button>
                    );
                  })}
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
            <CoopGameScene
              gameStateRef={gameStateRef}
              playerImage={p1ImageRef.current}
              player2Image={p2ImageRef.current}
              localPredictedProjectilesRef={localPredictedProjectilesRef}
              isHost={isHost}
              viewRef={viewRef}
            />
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
        <CoopOverlay gameStateRef={gameStateRef} viewRef={viewRef} />
        <HUD displayState={displayState ? {
          score: displayState.score,
          wave: displayState.wave,
          health: isHost ? displayState.health : displayState.health2,
          maxHealth: isHost ? displayState.maxHealth : displayState.maxHealth2,
          level: displayState.level,
          experience: displayState.experience,
          experienceToLevel: displayState.experienceToLevel,
          multiplier: displayState.multiplier,
          killStreak: displayState.killStreak,
          activeEvent: displayState.activeEvent,
          eventAnnounceTime: displayState.eventAnnounceTime,
          weapons: displayState.weapons,
          waveAnnounceTime: displayState.waveAnnounceTime,
          gameTime: displayState.gameTime,
        } : null} isMobile={isTouchDevice} />

        {/* P1/P2 Health bars (hidden on mobile - shown in bottom bar) */}
        {displayState && !isLoading && !isTouchDevice && (
          <div className="absolute top-2 left-2 flex flex-col gap-2 z-10 pointer-events-none">
            <div className="flex items-center gap-2 bg-brutal-dark/80 px-3 py-2 border border-electric-cyan/30">
              <span className="w-2 h-2 rounded-full bg-electric-cyan" />
              <span className="font-mono text-xs text-electric-cyan">P1</span>
              <div className="w-24 h-2 bg-white/10 overflow-hidden">
                <div className="h-full bg-electric-cyan transition-all" style={{ width: `${(displayState.health / displayState.maxHealth) * 100}%` }} />
              </div>
              <span className="font-mono text-xs text-white/60">{Math.max(0, Math.ceil(displayState.health))}</span>
            </div>
            <div className="flex items-center gap-2 bg-brutal-dark/80 px-3 py-2 border border-electric-pink/30">
              <span className="w-2 h-2 rounded-full bg-electric-pink" />
              <span className="font-mono text-xs text-electric-pink">P2</span>
              <div className="w-24 h-2 bg-white/10 overflow-hidden">
                <div className="h-full bg-electric-pink transition-all" style={{ width: `${(displayState.health2 / displayState.maxHealth2) * 100}%` }} />
              </div>
              <span className="font-mono text-xs text-white/60">{Math.max(0, Math.ceil(displayState.health2))}</span>
            </div>
          </div>
        )}
      </div>

      {/* Mobile bottom HUD bar. Rendered as soon as we know this is a touch
          device: reserving the space up front means the arena is already its
          final size when the world is built, instead of shrinking under the
          players the moment the first display state lands. */}
      {isTouchDevice && (
        <div className="h-14 landscape:h-11 shrink-0 flex items-center justify-between gap-2 px-3 border-t border-white/10 bg-brutal-dark/95 backdrop-blur-sm z-10 font-mono">
          {displayState && !isLoading && (
          <>
          {/* P1 HP */}
          <div className="flex flex-col gap-0.5 shrink-0" style={{ width: '25%' }}>
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-electric-cyan" />
              <span className="text-[9px] text-electric-cyan">P1</span>
              <span className="text-[9px] text-white/50">{Math.max(0, Math.ceil(displayState.health))}</span>
            </div>
            <div className="w-full h-1.5 bg-white/10 overflow-hidden">
              <div className="h-full bg-electric-cyan transition-all" style={{ width: `${Math.max(0, (displayState.health / displayState.maxHealth) * 100)}%` }} />
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
            <div className="text-[9px] text-electric-cyan flex items-center gap-1">
              <span>LV{displayState.level} W{displayState.wave}</span>
              {!isHost && latencyMs !== null && (
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: latencyMs < 80 ? '#39ff14' : latencyMs < 160 ? '#e4ff1a' : '#ff2d6a' }}
                  title={`${latencyMs}ms to host`}
                />
              )}
            </div>
          </div>
          {/* P2 HP */}
          <div className="flex flex-col gap-0.5 shrink-0" style={{ width: '25%' }}>
            <div className="flex items-center gap-1 justify-end">
              <span className="text-[9px] text-white/50">{Math.max(0, Math.ceil(displayState.health2))}</span>
              <span className="text-[9px] text-electric-pink">P2</span>
              <span className="w-1.5 h-1.5 rounded-full bg-electric-pink" />
            </div>
            <div className="w-full h-1.5 bg-white/10 overflow-hidden">
              <div className="h-full bg-electric-pink transition-all" style={{ width: `${Math.max(0, (displayState.health2 / displayState.maxHealth2) * 100)}%` }} />
            </div>
          </div>
          </>
          )}
        </div>
      )}

      {/* Controls hint */}
      <div className={`h-10 flex items-center justify-center px-4 border-t border-white/10 bg-brutal-dark/80 backdrop-blur-sm text-xs font-mono text-white/40 ${isTouchDevice ? 'hidden' : ''}`}>
        <span>WASD / {'\uD83C\uDFAE'} Left Stick {'\u2022'} Mouse / Right Stick to aim {'\u2022'} Auto-fire {'\u2022'} ESC / Start to pause {'\u2022'} CO-OP</span>
      </div>
    </div>
  );
}
