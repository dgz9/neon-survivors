'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import PartySocket from 'partysocket';
import { GameState, DEFAULT_CONFIG, Vector2, ArenaType, Player, WEAPON_CONFIGS } from '@/types/game';
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
import { sendInput, sendGameState, MultiplayerMessage, MultiplayerPlayer } from '@/lib/multiplayer';
import { playLevelUp, playDamage, playWaveComplete, setMuted } from '@/lib/audio';

interface GameOverStats {
  totalDamageDealt: number;
  totalDamageTaken: number;
  survivalTime: number;
  peakMultiplier: number;
  weaponLevels: { type: string; level: number }[];
  teamNames: string[];
}

interface CoopGameProps {
  socket: PartySocket;
  players: MultiplayerPlayer[];
  isHost: boolean;
  arena: ArenaType;
  onGameOver: (score: number, wave: number, kills: number, stats?: GameOverStats) => void;
  onBack: () => void;
}

// Colors for player 2
const PLAYER_COLORS = ['#00f0ff', '#ff2d6a']; // cyan for P1, pink for P2

function recalculatePlayerStats(player: Player, currentTime: number): Player {
  const activeBuffs = player.activeBuffs.filter(buff => buff.expiresAt > currentTime);
  const speedBuff = activeBuffs.find(buff => buff.type === 'speed');
  const magnetBuff = activeBuffs.find(buff => buff.type === 'magnet');

  return {
    ...player,
    activeBuffs,
    speed: Math.min(8, (player.baseSpeed + player.speedBonus) * (speedBuff?.multiplier || 1)),
    magnetMultiplier: (1 + player.magnetBonus) * (magnetBuff?.multiplier || 1),
  };
}

// Helper to apply upgrade to player 2 (mirrors applyUpgrade logic)
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gameStateRef = useRef<GameState | null>(null);
  const player2Ref = useRef<Player | null>(null);
  const animationFrameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  // Cache loaded images (can't serialize HTMLImageElement over network)
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
  // Target state for interpolation (guest only) - stores positions to lerp towards
  const targetStateRef = useRef<{
    playerPos: Vector2 | null;
    player2Pos: Vector2 | null;
    enemyPositions: Map<string, Vector2>;
  }>({
    playerPos: null,
    player2Pos: null,
    enemyPositions: new Map(),
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
  } | null>(null);
  const [showUpgrades, setShowUpgrades] = useState(false);
  const [availableUpgrades, setAvailableUpgrades] = useState<Upgrade[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  // Upgrade sync state
  const [myUpgradeChoice, setMyUpgradeChoice] = useState<string | null>(null);
  const [otherUpgradeChoice, setOtherUpgradeChoice] = useState<string | null>(null);
  const [otherUpgradeName, setOtherUpgradeName] = useState<string | null>(null);
  const [waitingForOther, setWaitingForOther] = useState(false);
  const lastWaveRef = useRef<number>(1);
  const lastHealthRef = useRef<number>(100);
  const lastSyncRef = useRef<number>(0);
  const lastInputSendRef = useRef<number>(0);
  const guestUpgradeOptionsRef = useRef<Upgrade[]>([]);
  const gameOverSentRef = useRef(false);
  const gameOverHandledRef = useRef(false);
  const SYNC_INTERVAL = 50; // ms between state syncs
  const INPUT_SEND_INTERVAL = 50; // ms between input sends (same as sync)

  // Find my player info
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

  // Initialize game (host creates full state, guest creates placeholder)
  const initGame = useCallback(async () => {
    if (!isHost) {
      // Guest: create a minimal state and load BOTH player images
      console.log('[GUEST] Initializing - loading images for P1:', otherPlayer?.imageUrl, 'P2:', myPlayer?.imageUrl);
      
      let state = createInitialGameState(
        otherPlayer?.imageUrl || '', // Use host's (P1) image for main player display
        dimensions.width,
        dimensions.height,
        DEFAULT_CONFIG
      );
      state = { ...state, arena };
      state = await loadPlayerImage(state);
      state.player.color = PLAYER_COLORS[0]; // P1 is cyan
      p1ImageRef.current = state.player.image; // Cache P1 image
      console.log('[GUEST] P1 image loaded:', !!p1ImageRef.current);
      
      // Also load P2 (guest's own) image
      if (myPlayer?.imageUrl) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        try {
          await new Promise<void>((resolve, reject) => {
            img.onload = () => {
              p2ImageRef.current = img;
              console.log('[GUEST] P2 image loaded successfully');
              resolve();
            };
            img.onerror = (e) => {
              console.error('[GUEST] P2 image load error:', e);
              reject(e);
            };
            img.src = myPlayer.imageUrl;
          });
        } catch (e) {
          console.error('Failed to load P2 image on guest');
        }
      }
      
      state = startGame(state); // Start the game so isRunning is true
      gameStateRef.current = state;
      console.log('[GUEST] Init complete, isRunning:', state.isRunning);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    
    // Create player 1 (host)
    let state = createInitialGameState(
      myPlayer?.imageUrl || '',
      dimensions.width,
      dimensions.height,
      DEFAULT_CONFIG
    );
    state = { ...state, arena };
    state = await loadPlayerImage(state);
    state.player.color = PLAYER_COLORS[0];
    p1ImageRef.current = state.player.image; // Cache P1 image
    
    // Create player 2 (guest)
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
    
    // Load player 2 image
    if (otherPlayer?.imageUrl) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      try {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => {
            p2.image = img;
            p2ImageRef.current = img; // Cache P2 image
            resolve();
          };
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
  }, [initGame]);

  // Store pending game state for when gameStateRef is not yet initialized
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
    particles: unknown[];
    isGameOver: boolean;
    isRunning: boolean;
  } | null>(null);

  // Process pending game state once gameStateRef is ready
  useEffect(() => {
    if (!isHost && gameStateRef.current && pendingGameStateRef.current) {
      const receivedState = pendingGameStateRef.current;
      console.log('[GUEST] Processing pending game state');

      gameStateRef.current.player = receivedState.player;
      gameStateRef.current.player.image = p1ImageRef.current;
      gameStateRef.current.score = receivedState.score;
      gameStateRef.current.wave = receivedState.wave;
      gameStateRef.current.multiplier = receivedState.multiplier || 1;
      gameStateRef.current.enemies = receivedState.enemies as typeof gameStateRef.current.enemies;
      gameStateRef.current.projectiles = receivedState.projectiles as typeof gameStateRef.current.projectiles;
      gameStateRef.current.powerups = receivedState.powerups as typeof gameStateRef.current.powerups;
      gameStateRef.current.experienceOrbs = receivedState.experienceOrbs as typeof gameStateRef.current.experienceOrbs;
      gameStateRef.current.particles = receivedState.particles as typeof gameStateRef.current.particles;
      gameStateRef.current.isGameOver = receivedState.isGameOver;
      gameStateRef.current.isRunning = receivedState.isRunning;
      player2Ref.current = receivedState.player2;
      if (player2Ref.current) {
        player2Ref.current.image = p2ImageRef.current;
      }

      setDisplayState({
        score: receivedState.score,
        wave: receivedState.wave,
        health: receivedState.player.health,
        maxHealth: receivedState.player.maxHealth,
        health2: receivedState.player2?.health || 0,
        maxHealth2: receivedState.player2?.maxHealth || 100,
        level: receivedState.player.level,
      });

      pendingGameStateRef.current = null;
    }
  }, [isLoading, isHost]);

  // Handle multiplayer messages
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as MultiplayerMessage;

        if (data.type === 'player-input' && isHost) {
          // Host receives guest input
          remoteInputRef.current = {
            keys: data.keys,
            mousePos: data.mousePos,
          };
        } else if (data.type === 'game-over' && !isHost) {
          if (gameStateRef.current) {
            gameStateRef.current.isGameOver = true;
            gameStateRef.current.isRunning = false;
            gameStateRef.current.score = data.score;
            gameStateRef.current.wave = data.wave;
          }
          finishGameOver({
            score: data.score,
            wave: data.wave,
            kills: data.kills,
            stats: data.stats,
          });
          return;
        } else if (data.type === 'game-state' && !isHost) {
          // Guest receives game state from host
          const receivedState = data.state as {
            player: Player;
            player2: Player | null;
            score: number;
            wave: number;
            multiplier: number;
            enemies: unknown[];
            projectiles: unknown[];
            powerups: unknown[];
            experienceOrbs: unknown[];
            particles: unknown[];
            isGameOver: boolean;
            isRunning: boolean;
          };

          // Handle game over - just set the flag, let the game loop call onGameOver
          // This ensures onGameOver is only called once (from the game loop)
          if (receivedState.isGameOver) {
            if (gameStateRef.current) {
              gameStateRef.current.isGameOver = true;
              // Store the received data for the game loop to use
              gameStateRef.current.score = receivedState.score;
              gameStateRef.current.wave = receivedState.wave;
              gameStateRef.current.player.kills = receivedState.player?.kills || 0;
              if (player2Ref.current) {
                player2Ref.current.kills = receivedState.player2?.kills || 0;
              }
              gameStateRef.current.multiplier = receivedState.multiplier || 1;
              gameStateRef.current.isRunning = false;
            }
            return;
          }

          if (gameStateRef.current) {
            // Store target positions for interpolation (smooth movement)
            targetStateRef.current.playerPos = { ...receivedState.player.position };
            targetStateRef.current.player2Pos = receivedState.player2 ? { ...receivedState.player2.position } : null;

            // Store enemy target positions
            targetStateRef.current.enemyPositions.clear();
            for (const enemy of receivedState.enemies as typeof gameStateRef.current.enemies) {
              targetStateRef.current.enemyPositions.set(enemy.id, { ...enemy.position });
            }

            // Update player non-position data
            const currentPlayerPos = gameStateRef.current.player.position;
            gameStateRef.current.player = receivedState.player;
            gameStateRef.current.player.position = currentPlayerPos; // Keep current position for lerping
            gameStateRef.current.player.image = p1ImageRef.current;

            // Update non-position game state
            gameStateRef.current.score = receivedState.score;
            gameStateRef.current.wave = receivedState.wave;
            gameStateRef.current.multiplier = receivedState.multiplier || 1;

            // For enemies: keep existing positions for lerping, but update other data
            const existingEnemyPositions = new Map(
              gameStateRef.current.enemies.map(e => [e.id, { ...e.position }])
            );
            gameStateRef.current.enemies = (receivedState.enemies as typeof gameStateRef.current.enemies).map(e => {
              const existingPos = existingEnemyPositions.get(e.id);
              return {
                ...e,
                position: existingPos || e.position, // Use existing position if we have it
              };
            });

            gameStateRef.current.projectiles = receivedState.projectiles as typeof gameStateRef.current.projectiles;
            gameStateRef.current.powerups = receivedState.powerups as typeof gameStateRef.current.powerups;
            gameStateRef.current.experienceOrbs = receivedState.experienceOrbs as typeof gameStateRef.current.experienceOrbs;
            // Don't sync particles - guest generates own effects
            gameStateRef.current.isGameOver = receivedState.isGameOver;
            gameStateRef.current.isRunning = receivedState.isRunning;

            // Update player2 with position preservation
            if (receivedState.player2) {
              const currentP2Pos = player2Ref.current?.position;
              player2Ref.current = receivedState.player2;
              if (currentP2Pos) {
                player2Ref.current.position = currentP2Pos;
              }
              player2Ref.current.image = p2ImageRef.current;
            } else {
              player2Ref.current = receivedState.player2;
            }

            // Update display state for guest
            setDisplayState({
              score: receivedState.score,
              wave: receivedState.wave,
              health: receivedState.player.health,
              maxHealth: receivedState.player.maxHealth,
              health2: receivedState.player2?.health || 0,
              maxHealth2: receivedState.player2?.maxHealth || 100,
              level: receivedState.player.level,
            });
          } else {
            // Store for later processing when gameStateRef is ready
            pendingGameStateRef.current = receivedState;
          }
        }

        // Handle level-up message from host (guest receives)
        if (data.type === 'level-up' && !isHost) {
          setShowUpgrades(true);
          setAvailableUpgrades(data.availableUpgrades as Upgrade[]);
          setMyUpgradeChoice(null);
          setOtherUpgradeChoice(null);
          setOtherUpgradeName(null);
          setWaitingForOther(false);
          playLevelUp();
        }

        // Handle upgrade-selected from other player
        if (data.type === 'upgrade-selected') {
          setOtherUpgradeChoice(data.upgradeId);
          setOtherUpgradeName(data.upgradeName || null);
        }

        // Handle upgrades-complete from host (both receive)
        if (data.type === 'upgrades-complete') {
          // Guest: don't apply upgrade locally - host state will be synced
          // Just close the upgrade menu
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
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        inputRef.current.mousePos = {
          x: (e.clientX - rect.left) * scaleX,
          y: (e.clientY - rect.top) * scaleY,
        };
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  const resolveUpgradeRound = useCallback((p1UpgradeId: string, p2UpgradeId: string) => {
    if (!isHost || !gameStateRef.current) return;

    const p1Upgrade = availableUpgrades.find(u => u.id === p1UpgradeId);
    const p2Upgrade = guestUpgradeOptionsRef.current.find(u => u.id === p2UpgradeId);

    if (p1Upgrade) {
      gameStateRef.current = applyUpgrade(gameStateRef.current, p1Upgrade);
    }

    if (player2Ref.current && p2Upgrade) {
      player2Ref.current = applyUpgradeToPlayer2(player2Ref.current, p2Upgrade);
    }

    socket.send(JSON.stringify({
      type: 'upgrades-complete',
      p1UpgradeId,
      p2UpgradeId,
    }));

    if (gameStateRef.current.pendingLevelUps > 0) {
      const nextHostUpgrades = gameStateRef.current.availableUpgrades;
      const nextGuestUpgrades = player2Ref.current
        ? generateUpgrades(player2Ref.current)
        : nextHostUpgrades;

      guestUpgradeOptionsRef.current = nextGuestUpgrades;

      socket.send(JSON.stringify({
        type: 'level-up',
        availableUpgrades: nextGuestUpgrades,
        level: gameStateRef.current.player.level,
      }));
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

  // Handle upgrade selection (co-op - each player picks their own upgrade)
  const handleUpgrade = useCallback((upgrade: Upgrade) => {
    setMyUpgradeChoice(upgrade.id);

    socket.send(JSON.stringify({
      type: 'upgrade-selected',
      playerId: socket.id,
      upgradeId: upgrade.id,
      upgradeName: upgrade.name,
      isHost: isHost,
    }));

    if (otherUpgradeChoice && isHost) {
      resolveUpgradeRound(upgrade.id, otherUpgradeChoice);
    } else {
      setWaitingForOther(true);
    }
  }, [socket, isHost, otherUpgradeChoice, resolveUpgradeRound]);

  // Handle when other player's choice arrives after I've already chosen (host only)
  useEffect(() => {
    if (isHost && myUpgradeChoice && otherUpgradeChoice && waitingForOther) {
      resolveUpgradeRound(myUpgradeChoice, otherUpgradeChoice);
    }
  }, [isHost, myUpgradeChoice, otherUpgradeChoice, waitingForOther, resolveUpgradeRound]);

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isLoading) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const gameLoop = (timestamp: number) => {
      const deltaTime = Math.min((timestamp - lastTimeRef.current) / 16.67, 3);
      lastTimeRef.current = timestamp;

      // Guest: send input to host (throttled)
      if (!isHost && timestamp - lastInputSendRef.current > INPUT_SEND_INTERVAL) {
        lastInputSendRef.current = timestamp;
        const keys = Array.from(inputRef.current.keys);
        sendInput(socket, keys, inputRef.current.mousePos);
      }

      // Guest: interpolate remote entities and locally predict own movement
      if (!isHost && gameStateRef.current && gameStateRef.current.isRunning) {
        const remoteLerpFactor = 0.25;

        // Lerp host (remote) player position
        if (targetStateRef.current.playerPos && gameStateRef.current.player) {
          const target = targetStateRef.current.playerPos;
          gameStateRef.current.player.position.x += (target.x - gameStateRef.current.player.position.x) * remoteLerpFactor;
          gameStateRef.current.player.position.y += (target.y - gameStateRef.current.player.position.y) * remoteLerpFactor;
        }

        if (player2Ref.current) {
          const p2 = recalculatePlayerStats(player2Ref.current, Date.now());
          player2Ref.current = p2;

          // Local prediction for the guest-controlled player removes input lag.
          let dx = 0;
          let dy = 0;
          if (inputRef.current.keys.has('w') || inputRef.current.keys.has('arrowup')) dy -= 1;
          if (inputRef.current.keys.has('s') || inputRef.current.keys.has('arrowdown')) dy += 1;
          if (inputRef.current.keys.has('a') || inputRef.current.keys.has('arrowleft')) dx -= 1;
          if (inputRef.current.keys.has('d') || inputRef.current.keys.has('arrowright')) dx += 1;

          if (dx !== 0 || dy !== 0) {
            const len = Math.hypot(dx, dy);
            dx /= len;
            dy /= len;
          }

          p2.velocity.x = dx * p2.speed;
          p2.velocity.y = dy * p2.speed;
          p2.position.x += p2.velocity.x * deltaTime;
          p2.position.y += p2.velocity.y * deltaTime;

          p2.position.x = Math.max(p2.radius, Math.min(dimensions.width - p2.radius, p2.position.x));
          p2.position.y = Math.max(p2.radius, Math.min(dimensions.height - p2.radius, p2.position.y));

          // Reconcile prediction toward authoritative host position.
          if (targetStateRef.current.player2Pos) {
            const target = targetStateRef.current.player2Pos;
            const correctionFactor = 0.18;
            p2.position.x += (target.x - p2.position.x) * correctionFactor;
            p2.position.y += (target.y - p2.position.y) * correctionFactor;
          }
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
        // Update player 1 (host) - pass player2 so enemies target closest player
        gameStateRef.current = updateGameState(
          gameStateRef.current,
          deltaTime,
          dimensions.width,
          dimensions.height,
          inputRef.current,
          DEFAULT_CONFIG,
          player2Ref.current
        );

        // Update player 2 (guest) with remote input
        if (player2Ref.current) {
          player2Ref.current = recalculatePlayerStats(player2Ref.current, Date.now());
          const p2 = player2Ref.current;
          const remoteInput = remoteInputRef.current;
          
          // Movement
          let dx = 0, dy = 0;
          if (remoteInput.keys.includes('w') || remoteInput.keys.includes('arrowup')) dy -= 1;
          if (remoteInput.keys.includes('s') || remoteInput.keys.includes('arrowdown')) dy += 1;
          if (remoteInput.keys.includes('a') || remoteInput.keys.includes('arrowleft')) dx -= 1;
          if (remoteInput.keys.includes('d') || remoteInput.keys.includes('arrowright')) dx += 1;
          
          if (dx !== 0 || dy !== 0) {
            const len = Math.sqrt(dx * dx + dy * dy);
            dx /= len;
            dy /= len;
          }
          
          p2.velocity.x = dx * p2.speed;
          p2.velocity.y = dy * p2.speed;
          p2.position.x += p2.velocity.x * deltaTime;
          p2.position.y += p2.velocity.y * deltaTime;
          
          // Keep in bounds
          p2.position.x = Math.max(p2.radius, Math.min(dimensions.width - p2.radius, p2.position.x));
          p2.position.y = Math.max(p2.radius, Math.min(dimensions.height - p2.radius, p2.position.y));
          
          // P2 fires towards mouse position (same as P1)
          const now = Date.now();
          for (const weapon of p2.weapons) {
            if (now - weapon.lastFired >= weapon.fireRate) {
              // Use remote mouse position for aiming
              const mousePos = remoteInput.mousePos;
              const angle = Math.atan2(
                mousePos.y - p2.position.y,
                mousePos.x - p2.position.x
              );

              // Support multiple projectiles (spread weapons)
              const projectileCount = weapon.projectileCount || 1;
              for (let i = 0; i < projectileCount; i++) {
                let projectileAngle = angle;

                if (projectileCount > 1) {
                  const spread = weapon.type === 'spread' ? Math.PI / 3 : Math.PI / 6;
                  projectileAngle = angle - spread / 2 + (spread * i / (projectileCount - 1));
                }

                gameStateRef.current.projectiles.push({
                  id: `p2-proj-${now}-${Math.random()}-${i}`,
                  position: { ...p2.position },
                  velocity: {
                    x: Math.cos(projectileAngle) * weapon.projectileSpeed,
                    y: Math.sin(projectileAngle) * weapon.projectileSpeed,
                  },
                  radius: 6,
                  color: PLAYER_COLORS[1],
                  damage: weapon.damage,
                  isEnemy: false,
                  piercing: weapon.piercing || 0,
                  hitEnemies: new Set<string>(),
                });
              }

              weapon.lastFired = now;
            }
          }
          
          // Check P2 collision with enemies
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
          for (let i = gameStateRef.current.experienceOrbs.length - 1; i >= 0; i--) {
            const orb = gameStateRef.current.experienceOrbs[i];
            const dist = Math.hypot(orb.position.x - p2.position.x, orb.position.y - p2.position.y);
            
            if (dist < magnetRange) {
              const pullStrength = 0.1 * (1 - dist / magnetRange);
              orb.position.x += (p2.position.x - orb.position.x) * pullStrength;
              orb.position.y += (p2.position.y - orb.position.y) * pullStrength;
            }
            
            if (dist < p2.radius + 8) { // XP orb pickup radius
              // Shared XP - goes to main player for level ups
              gameStateRef.current.player.experience += orb.value;
              gameStateRef.current.experienceOrbs.splice(i, 1);
            }
          }
        }
        
        // Check if either player is dead (game over if both dead)
        const p1Dead = gameStateRef.current.player.health <= 0;
        const p2Dead = !!player2Ref.current && player2Ref.current.health <= 0;
        
        if (p1Dead && p2Dead) {
          gameStateRef.current.isGameOver = true;
        }
        
        // Sync state to guest
        if (timestamp - lastSyncRef.current > SYNC_INTERVAL) {
          lastSyncRef.current = timestamp;

          // Prune data to reduce bandwidth
          // Enemies: essential fields for rendering and gameplay
          const prunedEnemies = gameStateRef.current.enemies.map(e => ({
            id: e.id,
            position: e.position,
            health: e.health,
            maxHealth: e.maxHealth,
            type: e.type,
            radius: e.radius,
            damage: e.damage,
            color: e.color,
            ghostAlpha: e.ghostAlpha,
          }));

          // Projectiles: drop hitEnemies Set entirely
          const prunedProjectiles = gameStateRef.current.projectiles.map(p => ({
            id: p.id,
            position: p.position,
            velocity: p.velocity,
            damage: p.damage,
            radius: p.radius,
            color: p.color,
            isEnemy: p.isEnemy,
            piercing: p.piercing,
          }));

          // Experience orbs: minimal data
          const prunedOrbs = gameStateRef.current.experienceOrbs.map(o => ({
            id: o.id,
            position: o.position,
            value: o.value,
          }));

          // Players: only core combat data, exclude full weapon configs
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
            // Include weapons and stats so upgrades sync to guest
            weapons: player2Ref.current.weapons.map(w => ({
              type: w.type,
              level: w.level,
              damage: w.damage,
              fireRate: w.fireRate,
              projectileSpeed: w.projectileSpeed,
              projectileCount: w.projectileCount,
              piercing: w.piercing,
              lastFired: w.lastFired,
            })),
            speed: player2Ref.current.speed,
            baseSpeed: player2Ref.current.baseSpeed,
            speedBonus: player2Ref.current.speedBonus,
            magnetMultiplier: player2Ref.current.magnetMultiplier,
            magnetBonus: player2Ref.current.magnetBonus,
          } : null;

          // Don't sync particles - guest generates own visual effects locally
          // This significantly reduces bandwidth and lag

          sendGameState(socket, {
            player: prunedPlayer,
            player2: prunedPlayer2,
            score: gameStateRef.current.score,
            wave: gameStateRef.current.wave,
            multiplier: gameStateRef.current.multiplier,
            enemies: prunedEnemies,
            projectiles: prunedProjectiles,
            powerups: gameStateRef.current.powerups,
            experienceOrbs: prunedOrbs,
            isGameOver: gameStateRef.current.isGameOver,
            isRunning: gameStateRef.current.isRunning,
          });
        }

        // Update display state
        if (Math.floor(timestamp) % 100 < 17) {
          setDisplayState({
            score: gameStateRef.current.score,
            wave: gameStateRef.current.wave,
            health: gameStateRef.current.player.health,
            maxHealth: gameStateRef.current.player.maxHealth,
            health2: player2Ref.current?.health || 0,
            maxHealth2: player2Ref.current?.maxHealth || 100,
            level: gameStateRef.current.player.level,
          });
        }

        // Check for pending level ups
        if (gameStateRef.current.pendingLevelUps > 0 && !showUpgrades) {
          const hostUpgrades = gameStateRef.current.availableUpgrades;
          const guestUpgrades = player2Ref.current
            ? generateUpgrades(player2Ref.current)
            : hostUpgrades;

          guestUpgradeOptionsRef.current = guestUpgrades;

          setShowUpgrades(true);
          setAvailableUpgrades(hostUpgrades);
          setMyUpgradeChoice(null);
          setOtherUpgradeChoice(null);
          setOtherUpgradeName(null);
          setWaitingForOther(false);
          playLevelUp();

          // Send level-up message to guest
          socket.send(JSON.stringify({
            type: 'level-up',
            availableUpgrades: guestUpgrades,
            level: gameStateRef.current.player.level,
          }));
        }
        
        // Sound effects
        if (gameStateRef.current.wave > lastWaveRef.current) {
          lastWaveRef.current = gameStateRef.current.wave;
          playWaveComplete();
        }
        
        if (gameStateRef.current.player.health < lastHealthRef.current) {
          playDamage();
        }
        lastHealthRef.current = gameStateRef.current.player.health;
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
          socket.send(JSON.stringify({
            type: 'game-over',
            score: gs.score,
            wave: gs.wave,
            kills: totalKills,
            stats: finalStats,
          }));
        }

        finishGameOver({
          score: gs.score,
          wave: gs.wave,
          kills: totalKills,
          stats: finalStats,
        });
        return;
      }

      // Render
      if (gameStateRef.current) {
        renderGame(ctx, gameStateRef.current, dimensions.width, dimensions.height, timestamp);
        
        // Render player 2 with octagonal border (same style as P1)
        if (player2Ref.current) {
          const p2 = player2Ref.current;
          const isInvulnerable = Date.now() < p2.invulnerableUntil;
          const flash = isInvulnerable && Math.floor(timestamp / 100) % 2 === 0;
          
          ctx.save();
          ctx.translate(p2.position.x, p2.position.y);
          ctx.globalAlpha = flash ? 0.5 : 1;
          
          // Octagonal border
          ctx.strokeStyle = p2.color;
          ctx.lineWidth = 3;
          const sides = 8;
          ctx.beginPath();
          for (let i = 0; i < sides; i++) {
            const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
            const x = Math.cos(angle) * p2.radius;
            const y = Math.sin(angle) * p2.radius;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.stroke();
          
          // Draw image or fill inside octagon
          ctx.save();
          ctx.beginPath();
          for (let i = 0; i < sides; i++) {
            const angle = (i / sides) * Math.PI * 2 - Math.PI / 2;
            const x = Math.cos(angle) * (p2.radius - 3);
            const y = Math.sin(angle) * (p2.radius - 3);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.clip();
          
          if (p2.image) {
            const size = (p2.radius - 3) * 2;
            ctx.drawImage(p2.image, -p2.radius + 3, -p2.radius + 3, size, size);
          } else {
            ctx.fillStyle = `${p2.color}44`;
            ctx.fill();
          }
          ctx.restore();
          
          ctx.restore();
          
          // P2 health bar (outside the transform)
          const healthPercent = p2.health / p2.maxHealth;
          ctx.fillStyle = '#141414';
          ctx.fillRect(p2.position.x - 20, p2.position.y - p2.radius - 12, 40, 6);
          ctx.fillStyle = p2.health > p2.maxHealth * 0.3 ? '#ff2d6a' : '#ff6b1a';
          ctx.fillRect(p2.position.x - 20, p2.position.y - p2.radius - 12, 40 * healthPercent, 6);
          
          // P2 label
          ctx.fillStyle = '#ff2d6a';
          ctx.font = '10px "JetBrains Mono"';
          ctx.textAlign = 'center';
          ctx.fillText('P2', p2.position.x, p2.position.y - p2.radius - 16);
        }
        
        // Draw P1 label
        if (gameStateRef.current.player) {
          ctx.fillStyle = '#00f0ff';
          ctx.font = '10px "JetBrains Mono"';
          ctx.textAlign = 'center';
          ctx.fillText('P1', gameStateRef.current.player.position.x, gameStateRef.current.player.position.y - gameStateRef.current.player.radius - 16);
        }
      }

      animationFrameRef.current = requestAnimationFrame(gameLoop);
    };

    lastTimeRef.current = performance.now();
    animationFrameRef.current = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isLoading, isPaused, showUpgrades, dimensions, isHost, socket, players, finishGameOver]);

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
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-electric-cyan" />
            <span className="font-mono text-xs text-white/60">{myPlayer?.name}</span>
          </div>
          <span className="text-white/20">×</span>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-electric-pink" />
            <span className="font-mono text-xs text-white/60">{otherPlayer?.name}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              setSoundEnabled(s => {
                setMuted(!s);
                return !s;
              });
            }}
            className="font-mono text-xs uppercase tracking-wider text-white/40 hover:text-electric-cyan transition-colors"
          >
            {soundEnabled ? '🔊' : '🔇'}
          </button>
          <button
            onClick={() => setIsPaused(p => !p)}
            disabled={isLoading}
            className="font-mono text-xs uppercase tracking-wider text-white/40 hover:text-electric-cyan transition-colors disabled:opacity-30"
          >
            {isPaused ? '▶ RESUME' : '|| PAUSE'}
          </button>
        </div>
      </div>

      {/* Game canvas */}
      <div className="flex-1 relative overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-brutal-black z-20">
            <div className="text-center">
              <div className="font-display text-5xl text-electric-cyan mb-4 animate-pulse">
                {'//'}
              </div>
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
              <p className="font-mono text-sm text-white/60 mb-4">
                Level {displayState?.level || 1} — Choose an upgrade
              </p>

              <p className="font-mono text-xs text-white/40 mb-4">
                Each player picks their own upgrade!
              </p>

              {/* Waiting indicator */}
              {waitingForOther && (
                <div className="mb-6 p-3 bg-electric-yellow/20 border border-electric-yellow/40">
                  <p className="font-mono text-sm text-electric-yellow animate-pulse">
                    Waiting for teammate to choose...
                  </p>
                </div>
              )}

              {/* Show what other player chose */}
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
                          ? isMyChoice
                            ? 'border-electric-cyan scale-105'
                            : isTeammateChoice
                              ? 'border-electric-pink'
                              : 'border-white/10 opacity-50'
                          : 'border-white/20 hover:border-electric-cyan hover:scale-105'
                      }`}
                      style={{
                        borderColor: isMyChoice ? '#00f0ff' : isTeammateChoice ? '#ff2d6a' : `${upgrade.color}40`
                      }}
                    >
                      {isMyChoice && (
                        <div className="absolute top-2 right-2 text-electric-cyan text-xs font-mono">
                          YOUR PICK
                        </div>
                      )}
                      {isTeammateChoice && (
                        <div className="absolute top-2 left-2 text-electric-pink text-xs font-mono">
                          P2 PICK
                        </div>
                      )}
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
                  );
                })}
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

        {/* Health bars for both players */}
        {displayState && !isLoading && (
          <div className="absolute top-14 left-2 flex flex-col gap-2 z-10">
            {/* P1 Health */}
            <div className="flex items-center gap-2 bg-brutal-dark/80 px-3 py-2 border border-electric-cyan/30">
              <span className="w-2 h-2 rounded-full bg-electric-cyan" />
              <span className="font-mono text-xs text-electric-cyan">P1</span>
              <div className="w-24 h-2 bg-white/10 overflow-hidden">
                <div 
                  className="h-full bg-electric-cyan transition-all"
                  style={{ width: `${(displayState.health / displayState.maxHealth) * 100}%` }}
                />
              </div>
              <span className="font-mono text-xs text-white/60">{Math.max(0, Math.ceil(displayState.health))}</span>
            </div>
            
            {/* P2 Health */}
            <div className="flex items-center gap-2 bg-brutal-dark/80 px-3 py-2 border border-electric-pink/30">
              <span className="w-2 h-2 rounded-full bg-electric-pink" />
              <span className="font-mono text-xs text-electric-pink">P2</span>
              <div className="w-24 h-2 bg-white/10 overflow-hidden">
                <div 
                  className="h-full bg-electric-pink transition-all"
                  style={{ width: `${(displayState.health2 / displayState.maxHealth2) * 100}%` }}
                />
              </div>
              <span className="font-mono text-xs text-white/60">{Math.max(0, Math.ceil(displayState.health2))}</span>
            </div>
          </div>
        )}
      </div>

      {/* Controls hint */}
      <div className="h-10 flex items-center justify-center px-4 border-t border-white/10 bg-brutal-dark/80 backdrop-blur-sm text-xs font-mono text-white/40">
        <span>WASD to move • Auto-fire • ESC to pause • CO-OP MODE</span>
      </div>
    </div>
  );
}
