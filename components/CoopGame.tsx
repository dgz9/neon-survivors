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
} from '@/lib/gameEngine';
import { Upgrade } from '@/types/game';
import { sendInput, sendGameState, decodeGameState, MultiplayerMessage, MultiplayerPlayer } from '@/lib/multiplayer';
import { playLevelUp, playDamage, playWaveComplete, setMuted } from '@/lib/audio';
import { CoopGameScene } from './three/CoopGameScene';
import { CoopOverlay } from './three/CoopOverlay';
import { TextParticles } from './three/TextParticles';
import { PowerupSprites } from './three/PowerupSprites';
import { HUD } from './three/HUD';

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
  const p1ImageRef = useRef<HTMLImageElement | null>(null);
  const p2ImageRef = useRef<HTMLImageElement | null>(null);
  const inputRef = useRef<{ keys: Set<string>; mousePos: Vector2; mouseDown: boolean }>({
    keys: new Set(),
    mousePos: { x: 0, y: 0 },
    mouseDown: false,
  });
  const remoteInputRef = useRef<{ keys: string[]; mousePos: Vector2 }>({
    keys: [],
    mousePos: { x: 0, y: 0 },
  });
  const localPredictedProjectilesRef = useRef<LocalPredictedProjectile[]>([]);
  const localShotCooldownRef = useRef<Record<string, number>>({});
  const targetStateRef = useRef<{
    playerPos: Vector2 | null;
    playerVel: Vector2 | null;
    player2Pos: Vector2 | null;
    player2Vel: Vector2 | null;
    enemyPositions: Map<string, Vector2>;
    lastSnapshotAt: number;
  }>({
    playerPos: null,
    playerVel: null,
    player2Pos: null,
    player2Vel: null,
    enemyPositions: new Map(),
    lastSnapshotAt: 0,
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
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
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [myUpgradeChoice, setMyUpgradeChoice] = useState<string | null>(null);
  const [otherUpgradeChoice, setOtherUpgradeChoice] = useState<string | null>(null);
  const [otherUpgradeName, setOtherUpgradeName] = useState<string | null>(null);
  const [waitingForOther, setWaitingForOther] = useState(false);
  const gamepadIndexRef = useRef<number | null>(null);
  const lastPausePress = useRef<number>(0);
  const lastWaveRef = useRef<number>(1);
  const lastHealthRef = useRef<number>(100);
  const lastSyncRef = useRef<number>(0);
  const lastInputSendRef = useRef<number>(0);
  const guestUpgradeOptionsRef = useRef<Upgrade[]>([]);
  const gameOverSentRef = useRef(false);
  const gameOverHandledRef = useRef(false);
  const SYNC_INTERVAL = 40;
  const INPUT_SEND_INTERVAL = 16;

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

  const sendGuestInputNow = useCallback((force = false) => {
    if (isHost) return;
    const now = performance.now();
    if (!force && now - lastInputSendRef.current < INPUT_SEND_INTERVAL) return;
    lastInputSendRef.current = now;
    sendInput(socket, Array.from(inputRef.current.keys), inputRef.current.mousePos);
  }, [isHost, socket]);

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
    if (!isHost) {
      let state = createInitialGameState(
        otherPlayer?.imageUrl || '',
        dimensions.width,
        dimensions.height,
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
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    let state = createInitialGameState(
      myPlayer?.imageUrl || '',
      dimensions.width,
      dimensions.height,
      DEFAULT_CONFIG
    );
    state = { ...state, arena };
    state = await loadPlayerImage(state);
    state.player.color = PLAYER_COLORS[0];
    p1ImageRef.current = state.player.image;

    const p2: Player = {
      position: { x: dimensions.width / 2 + 50, y: dimensions.height / 2 },
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
  }, [isHost, myPlayer, otherPlayer, dimensions, arena]);

  useEffect(() => {
    if (dimensions.width > 0 && dimensions.height > 0) {
      initGame();
    }
  }, [initGame, dimensions.width, dimensions.height]);

  // Pending state for guest init
  const pendingGameStateRef = useRef<{
    player: Player;
    player2: Player | null;
    score: number;
    wave: number;
    multiplier: number;
    enemies: unknown[];
    projectiles: unknown[];
    powerups: unknown[];
    experienceOrbs: unknown[];
    particles?: unknown[];
    isGameOver: boolean;
    isRunning: boolean;
  } | null>(null);

  useEffect(() => {
    if (!isHost && gameStateRef.current && pendingGameStateRef.current) {
      const receivedState = pendingGameStateRef.current;
      gameStateRef.current.player = receivedState.player;
      gameStateRef.current.player.image = p1ImageRef.current;
      gameStateRef.current.score = receivedState.score;
      gameStateRef.current.wave = receivedState.wave;
      gameStateRef.current.multiplier = receivedState.multiplier || 1;
      gameStateRef.current.enemies = receivedState.enemies as typeof gameStateRef.current.enemies;
      gameStateRef.current.projectiles = receivedState.projectiles as typeof gameStateRef.current.projectiles;
      gameStateRef.current.projectileCount = (receivedState.projectiles as unknown[]).length;
      gameStateRef.current.powerups = receivedState.powerups as typeof gameStateRef.current.powerups;
      gameStateRef.current.experienceOrbs = receivedState.experienceOrbs as typeof gameStateRef.current.experienceOrbs;
      gameStateRef.current.experienceOrbCount = (receivedState.experienceOrbs as unknown[]).length;
      gameStateRef.current.particles = (receivedState.particles || []) as typeof gameStateRef.current.particles;
      gameStateRef.current.isGameOver = receivedState.isGameOver;
      gameStateRef.current.isRunning = receivedState.isRunning;
      player2Ref.current = receivedState.player2 ? normalizeSyncedPlayer(receivedState.player2) : null;
      if (player2Ref.current) player2Ref.current.image = p2ImageRef.current;
      pendingGameStateRef.current = null;
    }
  }, [isLoading, isHost]);

  // Handle multiplayer messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as MultiplayerMessage;

        if (data.type === 'player-input' && isHost) {
          remoteInputRef.current = { keys: data.keys, mousePos: data.mousePos };
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
          const receivedState = decodeGameState(data.state) as {
            player: Player;
            player2: Player | null;
            score: number;
            wave: number;
            multiplier: number;
            enemies: unknown[];
            projectiles: unknown[];
            powerups: unknown[];
            experienceOrbs: unknown[];
            particles?: unknown[];
            isGameOver: boolean;
            isRunning: boolean;
          };

          if (receivedState.isGameOver) {
            if (gameStateRef.current) {
              gameStateRef.current.isGameOver = true;
              gameStateRef.current.score = receivedState.score;
              gameStateRef.current.wave = receivedState.wave;
              gameStateRef.current.player.kills = receivedState.player?.kills || 0;
              if (player2Ref.current) player2Ref.current.kills = receivedState.player2?.kills || 0;
              gameStateRef.current.multiplier = receivedState.multiplier || 1;
              gameStateRef.current.isRunning = false;
            }
            return;
          }

          if (gameStateRef.current) {
            targetStateRef.current.playerPos = { ...receivedState.player.position };
            targetStateRef.current.playerVel = receivedState.player.velocity ? { ...receivedState.player.velocity } : null;
            targetStateRef.current.player2Pos = receivedState.player2 ? { ...receivedState.player2.position } : null;
            targetStateRef.current.player2Vel = receivedState.player2?.velocity ? { ...receivedState.player2.velocity } : null;
            targetStateRef.current.lastSnapshotAt = performance.now();

            targetStateRef.current.enemyPositions.clear();
            for (const enemy of receivedState.enemies as typeof gameStateRef.current.enemies) {
              targetStateRef.current.enemyPositions.set(enemy.id, { ...enemy.position });
            }

            const currentPlayerPos = gameStateRef.current.player.position;
            gameStateRef.current.player = receivedState.player;
            gameStateRef.current.player.position = currentPlayerPos;
            gameStateRef.current.player.image = p1ImageRef.current;

            gameStateRef.current.score = receivedState.score;
            gameStateRef.current.wave = receivedState.wave;
            gameStateRef.current.multiplier = receivedState.multiplier || 1;

            const existingEnemyPositions = new Map(
              gameStateRef.current.enemies.map(e => [e.id, { ...e.position }])
            );
            gameStateRef.current.enemies = (receivedState.enemies as typeof gameStateRef.current.enemies).map(e => {
              const existingPos = existingEnemyPositions.get(e.id);
              return { ...e, position: existingPos || e.position };
            });

            gameStateRef.current.projectiles = receivedState.projectiles as typeof gameStateRef.current.projectiles;
            gameStateRef.current.projectileCount = (receivedState.projectiles as unknown[]).length;
            gameStateRef.current.powerups = receivedState.powerups as typeof gameStateRef.current.powerups;
            gameStateRef.current.experienceOrbs = receivedState.experienceOrbs as typeof gameStateRef.current.experienceOrbs;
            gameStateRef.current.experienceOrbCount = (receivedState.experienceOrbs as unknown[]).length;

            if (localPredictedProjectilesRef.current.length > 0) {
              const authP2 = (receivedState.projectiles as Array<{ position: Vector2; isEnemy: boolean; color: string }>)
                .filter(p => !p.isEnemy && p.color === PLAYER_COLORS[1]);
              if (authP2.length > 0) {
                localPredictedProjectilesRef.current = localPredictedProjectilesRef.current.filter(local =>
                  !authP2.some(auth => Math.hypot(auth.position.x - local.position.x, auth.position.y - local.position.y) < 24)
                );
              }
            }

            gameStateRef.current.isGameOver = receivedState.isGameOver;
            gameStateRef.current.isRunning = receivedState.isRunning;

            if (receivedState.player2) {
              const currentP2Pos = player2Ref.current?.position;
              player2Ref.current = normalizeSyncedPlayer(receivedState.player2);
              if (currentP2Pos) player2Ref.current.position = currentP2Pos;
              player2Ref.current.image = p2ImageRef.current;
            } else {
              player2Ref.current = receivedState.player2;
            }
          } else {
            pendingGameStateRef.current = receivedState;
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
      sendGuestInputNow(true);
      if (key === 'escape') setIsPaused(p => !p);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      inputRef.current.keys.delete(e.key.toLowerCase());
      sendGuestInputNow(true);
    };

    const handleMouseMove = (e: MouseEvent) => {
      const el = gameAreaRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        inputRef.current.mousePos = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
        sendGuestInputNow(false);
      }
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
  }, [sendGuestInputNow]);

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

  // Game loop — logic only, no rendering
  useEffect(() => {
    if (isLoading) return;

    const gameLoop = (timestamp: number) => {
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
            const aimDistance = 200;
            const aimPlayer = isHost ? gameStateRef.current?.player : player2Ref.current;
            if (aimPlayer) {
              inputRef.current.mousePos = {
                x: aimPlayer.position.x + rx * aimDistance,
                y: aimPlayer.position.y + ry * aimDistance,
              };
            }
          }

          if (gamepad.buttons[9]?.pressed && timestamp - lastPausePress.current > 300) {
            lastPausePress.current = timestamp;
            setIsPaused(p => !p);
          }
        }
      }

      if (!isHost && timestamp - lastInputSendRef.current > INPUT_SEND_INTERVAL) {
        sendGuestInputNow(false);
      }

      // Guest: interpolate + local prediction
      if (!isHost && gameStateRef.current && gameStateRef.current.isRunning) {
        const remoteLerpFactor = 0.4;
        const msSinceSnapshot = targetStateRef.current.lastSnapshotAt > 0
          ? Math.min(120, timestamp - targetStateRef.current.lastSnapshotAt) : 0;
        const predictionFrames = (msSinceSnapshot + SYNC_INTERVAL * 0.5) / 16.67;

        if (targetStateRef.current.playerPos && gameStateRef.current.player) {
          const baseTarget = targetStateRef.current.playerPos;
          const vel = targetStateRef.current.playerVel;
          const target = vel
            ? { x: baseTarget.x + vel.x * predictionFrames, y: baseTarget.y + vel.y * predictionFrames }
            : baseTarget;
          gameStateRef.current.player.position.x += (target.x - gameStateRef.current.player.position.x) * remoteLerpFactor;
          gameStateRef.current.player.position.y += (target.y - gameStateRef.current.player.position.y) * remoteLerpFactor;
        }

        if (player2Ref.current) {
          const p2 = recalculatePlayerStats(player2Ref.current, Date.now());
          player2Ref.current = p2;

          let dx = 0, dy = 0;
          if (inputRef.current.keys.has('w') || inputRef.current.keys.has('arrowup')) dy -= 1;
          if (inputRef.current.keys.has('s') || inputRef.current.keys.has('arrowdown')) dy += 1;
          if (inputRef.current.keys.has('a') || inputRef.current.keys.has('arrowleft')) dx -= 1;
          if (inputRef.current.keys.has('d') || inputRef.current.keys.has('arrowright')) dx += 1;

          if (dx !== 0 || dy !== 0) { const len = Math.hypot(dx, dy); dx /= len; dy /= len; }

          p2.velocity.x = dx * p2.speed;
          p2.velocity.y = dy * p2.speed;
          p2.position.x += p2.velocity.x * deltaTime;
          p2.position.y += p2.velocity.y * deltaTime;
          p2.position.x = Math.max(p2.radius, Math.min(dimensions.width - p2.radius, p2.position.x));
          p2.position.y = Math.max(p2.radius, Math.min(dimensions.height - p2.radius, p2.position.y));

          if (targetStateRef.current.player2Pos) {
            const baseTarget = targetStateRef.current.player2Pos;
            const vel = targetStateRef.current.player2Vel;
            const target = vel
              ? { x: baseTarget.x + vel.x * predictionFrames, y: baseTarget.y + vel.y * predictionFrames }
              : baseTarget;
            const errorX = target.x - p2.position.x;
            const errorY = target.y - p2.position.y;
            const errorDistance = Math.hypot(errorX, errorY);

            if (errorDistance > 12) {
              const correctionFactor = errorDistance > 48 ? 0.32 : 0.18;
              const maxCorrection = errorDistance > 48 ? 14 : 6;
              const stepX = errorX * correctionFactor;
              const stepY = errorY * correctionFactor;
              const stepLen = Math.hypot(stepX, stepY);
              if (stepLen > maxCorrection && stepLen > 0) {
                const scale = maxCorrection / stepLen;
                p2.position.x += stepX * scale;
                p2.position.y += stepY * scale;
              } else {
                p2.position.x += stepX;
                p2.position.y += stepY;
              }
            }
          }
        }

        // Guest local shot prediction
        if (player2Ref.current && !isPaused && !showUpgrades) {
          const p2 = player2Ref.current;
          const mousePos = inputRef.current.mousePos;
          const nowMs = Date.now();

          p2.weapons.forEach((weapon, weaponIndex) => {
            const cooldownKey = `${weapon.type}-${weaponIndex}`;
            const lastShotAt = localShotCooldownRef.current[cooldownKey] || 0;
            if (nowMs - lastShotAt < weapon.fireRate) return;

            const angle = Math.atan2(mousePos.y - p2.position.y, mousePos.x - p2.position.x);
            const projectileCount = weapon.projectileCount || 1;

            for (let i = 0; i < projectileCount; i++) {
              let projectileAngle = angle;
              if (projectileCount > 1) {
                const spread = weapon.type === 'spread' ? Math.PI / 3 : Math.PI / 6;
                projectileAngle = angle - spread / 2 + (spread * i / (projectileCount - 1));
              }

              localPredictedProjectilesRef.current.push({
                id: `local-p2-${nowMs}-${Math.random()}-${i}`,
                position: { ...p2.position },
                velocity: {
                  x: Math.cos(projectileAngle) * weapon.projectileSpeed,
                  y: Math.sin(projectileAngle) * weapon.projectileSpeed,
                },
                radius: 6,
                color: PLAYER_COLORS[1],
                lifeMs: 140,
                maxLifeMs: 140,
              });
            }
            localShotCooldownRef.current[cooldownKey] = nowMs;
          });
        }

        if (localPredictedProjectilesRef.current.length > 0) {
          const frameMs = deltaTime * 16.67;
          localPredictedProjectilesRef.current = localPredictedProjectilesRef.current
            .map(proj => ({
              ...proj,
              position: {
                x: proj.position.x + proj.velocity.x * deltaTime,
                y: proj.position.y + proj.velocity.y * deltaTime,
              },
              lifeMs: proj.lifeMs - frameMs,
            }))
            .filter(proj =>
              proj.lifeMs > 0 &&
              proj.position.x >= -20 && proj.position.x <= dimensions.width + 20 &&
              proj.position.y >= -20 && proj.position.y <= dimensions.height + 20
            );
        }

        // Lerp enemy positions
        for (const enemy of gameStateRef.current.enemies) {
          const targetPos = targetStateRef.current.enemyPositions.get(enemy.id);
          if (targetPos) {
            enemy.position.x += (targetPos.x - enemy.position.x) * remoteLerpFactor;
            enemy.position.y += (targetPos.y - enemy.position.y) * remoteLerpFactor;
          }
        }
      }

      // Host: update game state
      if (isHost && gameStateRef.current && !isPaused && !showUpgrades && gameStateRef.current.isRunning) {
        gameStateRef.current = updateGameState(
          gameStateRef.current,
          deltaTime,
          dimensions.width,
          dimensions.height,
          inputRef.current,
          DEFAULT_CONFIG,
          player2Ref.current
        );

        // Update player 2 with remote input
        if (player2Ref.current) {
          player2Ref.current = recalculatePlayerStats(player2Ref.current, Date.now());
          const p2 = player2Ref.current;
          const remoteInput = remoteInputRef.current;

          let dx = 0, dy = 0;
          if (remoteInput.keys.includes('w') || remoteInput.keys.includes('arrowup')) dy -= 1;
          if (remoteInput.keys.includes('s') || remoteInput.keys.includes('arrowdown')) dy += 1;
          if (remoteInput.keys.includes('a') || remoteInput.keys.includes('arrowleft')) dx -= 1;
          if (remoteInput.keys.includes('d') || remoteInput.keys.includes('arrowright')) dx += 1;

          if (dx !== 0 || dy !== 0) { const len = Math.sqrt(dx * dx + dy * dy); dx /= len; dy /= len; }

          p2.velocity.x = dx * p2.speed;
          p2.velocity.y = dy * p2.speed;
          p2.position.x += p2.velocity.x * deltaTime;
          p2.position.y += p2.velocity.y * deltaTime;
          p2.position.x = Math.max(p2.radius, Math.min(dimensions.width - p2.radius, p2.position.x));
          p2.position.y = Math.max(p2.radius, Math.min(dimensions.height - p2.radius, p2.position.y));

          // P2 fires
          const now = Date.now();
          for (const weapon of p2.weapons) {
            if (now - weapon.lastFired >= weapon.fireRate) {
              const mousePos = remoteInput.mousePos;
              const angle = Math.atan2(mousePos.y - p2.position.y, mousePos.x - p2.position.x);
              const projectileCount = weapon.projectileCount || 1;

              for (let i = 0; i < projectileCount; i++) {
                let projectileAngle = angle;
                if (projectileCount > 1) {
                  const spread = weapon.type === 'spread' ? Math.PI / 3 : Math.PI / 6;
                  projectileAngle = angle - spread / 2 + (spread * i / (projectileCount - 1));
                }

                const proj = acquireProjectile();
                proj.id = `p2-proj-${now}-${Math.random()}-${i}`;
                proj.position.x = p2.position.x;
                proj.position.y = p2.position.y;
                proj.velocity.x = Math.cos(projectileAngle) * weapon.projectileSpeed;
                proj.velocity.y = Math.sin(projectileAngle) * weapon.projectileSpeed;
                proj.radius = 6;
                proj.color = PLAYER_COLORS[1];
                proj.damage = weapon.damage;
                proj.isEnemy = false;
                proj.piercing = weapon.piercing || 0;
                proj.hitEnemies.clear();
              }
              weapon.lastFired = now;
            }
          }

          // P2 collision with enemies
          for (const enemy of gameStateRef.current.enemies) {
            const dist = Math.hypot(enemy.position.x - p2.position.x, enemy.position.y - p2.position.y);
            if (dist < enemy.radius + p2.radius && now > p2.invulnerableUntil) {
              p2.health -= enemy.damage;
              p2.invulnerableUntil = now + 500;
              gameStateRef.current.totalDamageTaken += enemy.damage;
              playDamage();
            }
          }

          // P2 collects XP orbs
          const magnetRange = 100 * p2.magnetMultiplier;
          const orbCount = getXPOrbCount();
          for (let i = orbCount - 1; i >= 0; i--) {
            const orb = gameStateRef.current.experienceOrbs[i];
            const dist = Math.hypot(orb.position.x - p2.position.x, orb.position.y - p2.position.y);
            if (dist < magnetRange) {
              const pullStrength = 0.1 * (1 - dist / magnetRange);
              orb.position.x += (p2.position.x - orb.position.x) * pullStrength;
              orb.position.y += (p2.position.y - orb.position.y) * pullStrength;
            }
            if (dist < p2.radius + 8) {
              gameStateRef.current.player.experience += orb.value;
              releaseXPOrb(orb);
            }
          }

          gameStateRef.current.projectileCount = getProjectileCount();
          gameStateRef.current.experienceOrbCount = getXPOrbCount();
        }

        // Check co-op game over
        const p1Dead = gameStateRef.current.player.health <= 0;
        const p2Dead = !!player2Ref.current && player2Ref.current.health <= 0;
        if (p1Dead && p2Dead) gameStateRef.current.isGameOver = true;

        // Sync state to guest
        if (timestamp - lastSyncRef.current > SYNC_INTERVAL) {
          lastSyncRef.current = timestamp;

          const prunedEnemies = gameStateRef.current.enemies.map(e => ({
            id: e.id, position: e.position, health: e.health, maxHealth: e.maxHealth,
            type: e.type, radius: e.radius, damage: e.damage, color: e.color, ghostAlpha: e.ghostAlpha,
          }));

          const prunedProjectiles = [];
          const prCount = getProjectileCount();
          for (let pi = 0; pi < prCount; pi++) {
            const p = gameStateRef.current.projectiles[pi];
            prunedProjectiles.push({
              id: p.id, position: p.position, velocity: p.velocity, damage: p.damage,
              radius: p.radius, color: p.color, isEnemy: p.isEnemy, piercing: p.piercing,
            });
          }

          const prunedOrbs = [];
          const xpCount = getXPOrbCount();
          for (let oi = 0; oi < xpCount; oi++) {
            const o = gameStateRef.current.experienceOrbs[oi];
            prunedOrbs.push({ id: o.id, position: o.position, value: o.value });
          }

          const prunedPlayer = {
            position: gameStateRef.current.player.position,
            velocity: gameStateRef.current.player.velocity,
            health: gameStateRef.current.player.health,
            maxHealth: gameStateRef.current.player.maxHealth,
            radius: gameStateRef.current.player.radius,
            color: gameStateRef.current.player.color,
            invulnerableUntil: gameStateRef.current.player.invulnerableUntil,
            level: gameStateRef.current.player.level,
            experience: gameStateRef.current.player.experience,
            kills: gameStateRef.current.player.kills,
            weapons: gameStateRef.current.player.weapons.map(w => ({ type: w.type, level: w.level })),
            speed: gameStateRef.current.player.speed,
            baseSpeed: gameStateRef.current.player.baseSpeed,
            speedBonus: gameStateRef.current.player.speedBonus,
            magnetMultiplier: gameStateRef.current.player.magnetMultiplier,
            magnetBonus: gameStateRef.current.player.magnetBonus,
            activeBuffs: gameStateRef.current.player.activeBuffs,
          };

          const prunedPlayer2 = player2Ref.current ? {
            position: player2Ref.current.position,
            velocity: player2Ref.current.velocity,
            health: player2Ref.current.health,
            maxHealth: player2Ref.current.maxHealth,
            radius: player2Ref.current.radius,
            color: player2Ref.current.color,
            invulnerableUntil: player2Ref.current.invulnerableUntil,
            level: player2Ref.current.level,
            kills: player2Ref.current.kills,
            weapons: player2Ref.current.weapons.map(w => ({
              type: w.type, level: w.level, damage: w.damage, fireRate: w.fireRate,
              projectileSpeed: w.projectileSpeed, projectileCount: w.projectileCount,
              piercing: w.piercing, lastFired: w.lastFired,
            })),
            speed: player2Ref.current.speed,
            baseSpeed: player2Ref.current.baseSpeed,
            speedBonus: player2Ref.current.speedBonus,
            magnetMultiplier: player2Ref.current.magnetMultiplier,
            magnetBonus: player2Ref.current.magnetBonus,
            activeBuffs: player2Ref.current.activeBuffs,
          } : null;

          sendGameState(socket, {
            player: prunedPlayer, player2: prunedPlayer2,
            score: gameStateRef.current.score, wave: gameStateRef.current.wave,
            multiplier: gameStateRef.current.multiplier, enemies: prunedEnemies,
            projectiles: prunedProjectiles, powerups: gameStateRef.current.powerups,
            experienceOrbs: prunedOrbs, isGameOver: gameStateRef.current.isGameOver,
            isRunning: gameStateRef.current.isRunning,
          });
        }

        // Update display state
        if (Math.floor(timestamp) % 100 < 17) {
          const gs = gameStateRef.current;
          setDisplayState({
            score: gs.score, wave: gs.wave,
            health: gs.player.health, maxHealth: gs.player.maxHealth,
            health2: player2Ref.current?.health || 0, maxHealth2: player2Ref.current?.maxHealth || 100,
            level: gs.player.level, experience: gs.player.experience,
            experienceToLevel: DEFAULT_CONFIG.experienceToLevel * gs.player.level,
            multiplier: gs.multiplier,
            killStreak: gs.killStreak,
            nearMissCount: gs.nearMissCount,
            activeEvent: gs.activeEvent,
            eventAnnounceTime: gs.eventAnnounceTime,
            weapons: gs.player.weapons.map(w => ({ type: w.type, level: w.level })),
            waveAnnounceTime: gs.waveAnnounceTime, gameTime: gs.gameTime,
          });
        }

        // Check for pending level ups
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
        if (gameStateRef.current.player.health < lastHealthRef.current) playDamage();
        lastHealthRef.current = gameStateRef.current.player.health;
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

    lastTimeRef.current = performance.now();
    animationFrameRef.current = requestAnimationFrame(gameLoop);

    return () => { cancelAnimationFrame(animationFrameRef.current); };
  }, [isLoading, isPaused, showUpgrades, dimensions, isHost, socket, players, finishGameOver, sendGuestInputNow]);

  return (
    <div className="fixed inset-0 bg-brutal-black flex flex-col">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-white/10 bg-brutal-dark/80 backdrop-blur-sm z-10">
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
          <button
            onClick={() => { setSoundEnabled(s => { setMuted(!s); return !s; }); }}
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
      <div ref={gameAreaRef} className="flex-1 relative overflow-hidden">
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
                <button onClick={onBack} className="block w-48 mx-auto btn-brutal-outline">Quit Game</button>
              </div>
            </div>
          </div>
        )}

        {showUpgrades && (
          <div className="absolute inset-0 flex items-center justify-center bg-brutal-black/95 z-30">
            <div className="text-center max-w-2xl w-full px-4">
              <div className="font-display text-4xl text-electric-cyan mb-2 glitch-text" data-text="LEVEL UP!">LEVEL UP!</div>
              <p className="font-mono text-sm text-white/60 mb-4">Level {displayState?.level || 1} — Choose an upgrade</p>
              <p className="font-mono text-xs text-white/40 mb-4">Each player picks their own upgrade!</p>

              {waitingForOther && (
                <div className="mb-6 p-3 bg-electric-yellow/20 border border-electric-yellow/40">
                  <p className="font-mono text-sm text-electric-yellow animate-pulse">Waiting for teammate to choose...</p>
                </div>
              )}

              {otherUpgradeChoice && (
                <div className="mb-4 p-2 bg-electric-pink/20 border border-electric-pink/40">
                  <p className="font-mono text-xs text-electric-pink">
                    {otherPlayer?.name || 'Teammate'} picked: {otherUpgradeName || 'Locked in'}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {availableUpgrades.map((upgrade) => {
                  const isMyChoice = myUpgradeChoice === upgrade.id;
                  const isTeammateChoice = otherUpgradeChoice === upgrade.id;
                  return (
                    <button
                      key={upgrade.id}
                      onClick={() => !myUpgradeChoice && handleUpgrade(upgrade)}
                      disabled={!!myUpgradeChoice}
                      className={`group relative bg-brutal-dark border-2 p-6 transition-all duration-200 ${
                        myUpgradeChoice
                          ? isMyChoice ? 'border-electric-cyan scale-105'
                            : isTeammateChoice ? 'border-electric-pink'
                            : 'border-white/10 opacity-50'
                          : 'border-white/20 hover:border-electric-cyan hover:scale-105'
                      }`}
                      style={{ borderColor: isMyChoice ? '#00f0ff' : isTeammateChoice ? '#ff2d6a' : `${upgrade.color}40` }}
                    >
                      {isMyChoice && <div className="absolute top-2 right-2 text-electric-cyan text-xs font-mono">YOUR PICK</div>}
                      {isTeammateChoice && <div className="absolute top-2 left-2 text-electric-pink text-xs font-mono">P2 PICK</div>}
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity" style={{ backgroundColor: upgrade.color }} />
                      <div className="relative z-10">
                        <div className="text-4xl mb-3">{upgrade.icon}</div>
                        <div className="font-display text-xl mb-2" style={{ color: upgrade.color }}>{upgrade.name}</div>
                        <p className="font-mono text-xs text-white/60">{upgrade.description}</p>
                      </div>
                    </button>
                  );
                })}
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
            <CoopGameScene
              gameStateRef={gameStateRef}
              playerImage={p1ImageRef.current}
              player2Image={p2ImageRef.current}
              localPredictedProjectilesRef={localPredictedProjectilesRef}
              isHost={isHost}
            />
          </Canvas>
        )}

        {/* DOM overlays */}
        <TextParticles gameStateRef={gameStateRef} />
        <PowerupSprites gameStateRef={gameStateRef} />
        <CoopOverlay gameStateRef={gameStateRef} />
        <HUD displayState={displayState ? {
          score: displayState.score,
          wave: displayState.wave,
          health: displayState.health,
          maxHealth: displayState.maxHealth,
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
        } : null} />

        {/* P1/P2 Health bars */}
        {displayState && !isLoading && (
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

      {/* Controls hint */}
      <div className="h-10 flex items-center justify-center px-4 border-t border-white/10 bg-brutal-dark/80 backdrop-blur-sm text-xs font-mono text-white/40">
        <span>WASD / {'\uD83C\uDFAE'} Left Stick {'\u2022'} Mouse / Right Stick to aim {'\u2022'} Auto-fire {'\u2022'} ESC / Start to pause {'\u2022'} CO-OP</span>
      </div>
    </div>
  );
}
