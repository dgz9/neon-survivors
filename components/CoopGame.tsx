'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import PartySocket from 'partysocket';
import { GameState, DEFAULT_CONFIG, Vector2, ArenaType, Player } from '@/types/game';
import {
  createInitialGameState,
  loadPlayerImage,
  startGame,
  updateGameState,
  renderGame,
  applyUpgrade,
} from '@/lib/gameEngine';
import { Upgrade } from '@/types/game';
import { sendInput, sendGameState, MultiplayerMessage, MultiplayerPlayer } from '@/lib/multiplayer';
import { playShoot, playHit, playExplosion, playLevelUp, playDamage, playWaveComplete, setMuted } from '@/lib/audio';

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
  const inputRef = useRef<{ keys: Set<string>; mousePos: Vector2; mouseDown: boolean }>({
    keys: new Set(),
    mousePos: { x: 0, y: 0 },
    mouseDown: false,
  });
  const remoteInputRef = useRef<{ keys: string[]; mousePos: Vector2 }>({
    keys: [],
    mousePos: { x: 0, y: 0 },
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
  const lastWaveRef = useRef<number>(1);
  const lastHealthRef = useRef<number>(100);
  const lastSyncRef = useRef<number>(0);
  const SYNC_INTERVAL = 50; // ms between state syncs

  // Find my player info
  const myPlayer = players.find(p => p.id === socket.id);
  const otherPlayer = players.find(p => p.id !== socket.id);

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
      // Guest: create a minimal state that can be rendered while waiting for sync
      let state = createInitialGameState(
        myPlayer?.imageUrl || '',
        dimensions.width,
        dimensions.height,
        DEFAULT_CONFIG
      );
      state = { ...state, arena };
      state = await loadPlayerImage(state);
      state.player.color = PLAYER_COLORS[1]; // Guest is P2 (pink)
      state = startGame(state); // Start the game so isRunning is true
      gameStateRef.current = state;
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
        } else if (data.type === 'game-state' && !isHost) {
          // Guest receives game state from host
          const receivedState = data.state as {
            player: Player;
            player2: Player;
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
          
          if (gameStateRef.current) {
            // Update local state with received data, preserving local fields
            gameStateRef.current.player = receivedState.player;
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
          }
        }
      } catch (e) {
        console.error('Failed to parse multiplayer message:', e);
      }
    };

    socket.addEventListener('message', handleMessage);
    return () => socket.removeEventListener('message', handleMessage);
  }, [socket, isHost]);

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

  // Game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isLoading) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const gameLoop = (timestamp: number) => {
      const deltaTime = Math.min((timestamp - lastTimeRef.current) / 16.67, 3);
      lastTimeRef.current = timestamp;

      // Guest: send input to host
      if (!isHost) {
        sendInput(socket, Array.from(inputRef.current.keys), inputRef.current.mousePos);
      }

      // Host: update game state
      if (isHost && gameStateRef.current && !isPaused && !showUpgrades && gameStateRef.current.isRunning) {
        // Update player 1 (host)
        gameStateRef.current = updateGameState(
          gameStateRef.current,
          deltaTime,
          dimensions.width,
          dimensions.height,
          inputRef.current,
          DEFAULT_CONFIG
        );

        // Update player 2 (guest) with remote input
        if (player2Ref.current) {
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
          
          // P2 auto-fire towards nearest enemy or mouse
          const now = Date.now();
          for (const weapon of p2.weapons) {
            if (now - weapon.lastFired >= weapon.fireRate) {
              const nearestEnemy = gameStateRef.current.enemies.reduce((nearest, enemy) => {
                const dist = Math.hypot(enemy.position.x - p2.position.x, enemy.position.y - p2.position.y);
                if (!nearest || dist < nearest.dist) {
                  return { enemy, dist };
                }
                return nearest;
              }, null as { enemy: typeof gameStateRef.current.enemies[0]; dist: number } | null);
              
              if (nearestEnemy) {
                const angle = Math.atan2(
                  nearestEnemy.enemy.position.y - p2.position.y,
                  nearestEnemy.enemy.position.x - p2.position.x
                );
                
                gameStateRef.current.projectiles.push({
                  id: `p2-proj-${now}-${Math.random()}`,
                  position: { ...p2.position },
                  velocity: {
                    x: Math.cos(angle) * weapon.projectileSpeed,
                    y: Math.sin(angle) * weapon.projectileSpeed,
                  },
                  radius: 6,
                  color: PLAYER_COLORS[1],
                  damage: weapon.damage,
                  isEnemy: false,
                  piercing: weapon.piercing || 0,
                  hitEnemies: new Set<string>(),
                });
                
                weapon.lastFired = now;
              }
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
        const p2Dead = player2Ref.current && player2Ref.current.health <= 0;
        
        if (p1Dead && p2Dead) {
          gameStateRef.current.isGameOver = true;
        }
        
        // Sync state to guest
        if (timestamp - lastSyncRef.current > SYNC_INTERVAL) {
          lastSyncRef.current = timestamp;
          sendGameState(socket, {
            player: gameStateRef.current.player,
            player2: player2Ref.current,
            score: gameStateRef.current.score,
            wave: gameStateRef.current.wave,
            multiplier: gameStateRef.current.multiplier,
            enemies: gameStateRef.current.enemies,
            projectiles: gameStateRef.current.projectiles,
            powerups: gameStateRef.current.powerups,
            experienceOrbs: gameStateRef.current.experienceOrbs,
            particles: gameStateRef.current.particles,
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
          setShowUpgrades(true);
          setAvailableUpgrades(gameStateRef.current.availableUpgrades);
          playLevelUp();
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
        const teamNames = players.map(p => p.name);
        
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
            teamNames,
          }
        );
        return;
      }

      // Render
      if (gameStateRef.current) {
        renderGame(ctx, gameStateRef.current, dimensions.width, dimensions.height, timestamp);
        
        // Render player 2
        if (player2Ref.current) {
          const p2 = player2Ref.current;
          ctx.save();
          
          // Draw P2
          if (p2.image) {
            ctx.beginPath();
            ctx.arc(p2.position.x, p2.position.y, p2.radius, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(
              p2.image,
              p2.position.x - p2.radius,
              p2.position.y - p2.radius,
              p2.radius * 2,
              p2.radius * 2
            );
          } else {
            ctx.fillStyle = p2.color;
            ctx.beginPath();
            ctx.arc(p2.position.x, p2.position.y, p2.radius, 0, Math.PI * 2);
            ctx.fill();
          }
          
          // P2 health bar
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
          
          ctx.restore();
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
  }, [isLoading, isPaused, showUpgrades, dimensions, isHost, socket, onGameOver, players]);

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

        {showUpgrades && isHost && (
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
