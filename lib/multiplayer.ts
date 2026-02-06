import PartySocket from "partysocket";

const PARTYKIT_HOST = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "localhost:1999";

export interface MultiplayerPlayer {
  id: string;
  name: string;
  imageUrl: string;
  isHost: boolean;
}

export interface RoomState {
  players: MultiplayerPlayer[];
  roomCode: string;
  isConnected: boolean;
  isHost: boolean;
  myId: string | null;
}

export type MultiplayerMessage =
  | { type: "room-info"; players: MultiplayerPlayer[]; roomCode: string }
  | { type: "player-leave"; id: string }
  | { type: "player-input"; id: string; keys: string[]; mousePos: { x: number; y: number } }
  | { type: "game-state"; state: unknown; hostId: string }
  | { type: "start-game"; arena: string }
  | { type: "level-up"; availableUpgrades: { id: string; name: string; description: string; icon: string; color: string; type: string; weaponType?: string; stat?: string }[]; level: number }
  | { type: "upgrade-selected"; playerId: string; upgradeId: string; upgradeName?: string }
  | { type: "upgrades-complete"; p1UpgradeId: string; p2UpgradeId: string }
  | {
      type: "game-over";
      score: number;
      wave: number;
      kills: number;
      stats: {
        totalDamageDealt: number;
        totalDamageTaken: number;
        survivalTime: number;
        peakMultiplier: number;
        weaponLevels: { type: string; level: number }[];
        teamNames: string[];
      };
    };

interface WirePlayer {
  p: [number, number];
  v: [number, number];
  h: number;
  mh: number;
  r: number;
  c: string;
  i: number;
  l: number;
  e: number;
  k: number;
  w: Array<[string, number, number, number, number, number, number, number]>;
  s: number;
  bs: number;
  sb: number;
  mm: number;
  mb: number;
  ab: Array<[string, number, number]>;
}

interface WireGameStateV1 {
  __v: 1;
  p: WirePlayer;
  p2: WirePlayer | null;
  sc: number;
  wv: number;
  m: number;
  e: Array<[string, number, number, number, number, string, number, number, string, number | null]>;
  pr: Array<[number, number, number, number, number, number, string, 0 | 1, number]>;
  pw: Array<[number, number, string]>;
  xo: Array<[number, number, number]>;
  go: 0 | 1;
  ru: 0 | 1;
}

type RawGameStateLike = {
  player: {
    position: { x: number; y: number };
    velocity: { x: number; y: number };
    health: number;
    maxHealth: number;
    radius: number;
    color: string;
    invulnerableUntil: number;
    level: number;
    experience: number;
    kills: number;
    weapons: Array<{
      type: string;
      level: number;
      damage?: number;
      fireRate?: number;
      projectileSpeed?: number;
      projectileCount?: number;
      piercing?: number;
      lastFired?: number;
    }>;
    speed: number;
    baseSpeed: number;
    speedBonus: number;
    magnetMultiplier: number;
    magnetBonus: number;
    activeBuffs: Array<{ type: string; expiresAt: number; multiplier: number }>;
  };
  player2?: RawGameStateLike["player"] | null;
  score: number;
  wave: number;
  multiplier: number;
  enemies: Array<{
    id: string;
    position: { x: number; y: number };
    health: number;
    maxHealth: number;
    type: string;
    radius: number;
    damage: number;
    color: string;
    ghostAlpha?: number;
  }>;
  projectiles: Array<{
    position: { x: number; y: number };
    velocity: { x: number; y: number };
    damage: number;
    radius: number;
    color: string;
    isEnemy: boolean;
    piercing: number;
  }>;
  powerups: Array<{ position: { x: number; y: number }; type: string }>;
  experienceOrbs: Array<{ position: { x: number; y: number }; value: number }>;
  isGameOver: boolean;
  isRunning: boolean;
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const round1 = (value: number) => Math.round(value * 10) / 10;

function isRawGameStateLike(state: unknown): state is RawGameStateLike {
  return !!state && typeof state === "object" && "player" in state && "enemies" in state && "projectiles" in state;
}

function encodePlayer(player: RawGameStateLike["player"]): WirePlayer {
  return {
    p: [round2(player.position.x), round2(player.position.y)],
    v: [round2(player.velocity.x), round2(player.velocity.y)],
    h: round1(player.health),
    mh: round1(player.maxHealth),
    r: round2(player.radius),
    c: player.color,
    i: Math.round(player.invulnerableUntil || 0),
    l: player.level || 1,
    e: round1(player.experience || 0),
    k: player.kills || 0,
    w: (player.weapons || []).map(w => [
      w.type,
      w.level || 1,
      round2(w.damage || 0),
      Math.round(w.fireRate || 0),
      round2(w.projectileSpeed || 0),
      w.projectileCount || 1,
      w.piercing || 0,
      Math.round(w.lastFired || 0),
    ]),
    s: round2(player.speed || 0),
    bs: round2(player.baseSpeed || 0),
    sb: round2(player.speedBonus || 0),
    mm: round2(player.magnetMultiplier || 1),
    mb: round2(player.magnetBonus || 0),
    ab: (player.activeBuffs || []).map(buff => [
      buff.type,
      Math.round(buff.expiresAt || 0),
      round2(buff.multiplier || 1),
    ]),
  };
}

function decodePlayer(player: WirePlayer) {
  return {
    position: { x: player.p[0], y: player.p[1] },
    velocity: { x: player.v[0], y: player.v[1] },
    health: player.h,
    maxHealth: player.mh,
    radius: player.r,
    color: player.c,
    invulnerableUntil: player.i,
    level: player.l,
    experience: player.e,
    kills: player.k,
    weapons: player.w.map((weapon) => ({
      type: weapon[0],
      level: weapon[1],
      damage: weapon[2],
      fireRate: weapon[3],
      projectileSpeed: weapon[4],
      projectileCount: weapon[5],
      piercing: weapon[6],
      lastFired: weapon[7],
    })),
    speed: player.s,
    baseSpeed: player.bs,
    speedBonus: player.sb,
    magnetMultiplier: player.mm,
    magnetBonus: player.mb,
    activeBuffs: player.ab.map(buff => ({
      type: buff[0],
      expiresAt: buff[1],
      multiplier: buff[2],
    })),
    image: null,
    imageUrl: "",
  };
}

function encodeGameStateForWire(state: unknown): unknown {
  if (!isRawGameStateLike(state)) return state;

  const wire: WireGameStateV1 = {
    __v: 1,
    p: encodePlayer(state.player),
    p2: state.player2 ? encodePlayer(state.player2) : null,
    sc: Math.round(state.score || 0),
    wv: Math.round(state.wave || 1),
    m: round2(state.multiplier || 1),
    e: state.enemies.map(enemy => [
      enemy.id,
      round2(enemy.position.x),
      round2(enemy.position.y),
      round1(enemy.health),
      round1(enemy.maxHealth),
      enemy.type,
      round2(enemy.radius),
      round1(enemy.damage),
      enemy.color,
      enemy.ghostAlpha ?? null,
    ]),
    pr: state.projectiles.map(projectile => [
      round2(projectile.position.x),
      round2(projectile.position.y),
      round2(projectile.velocity.x),
      round2(projectile.velocity.y),
      round2(projectile.damage),
      round2(projectile.radius),
      projectile.color,
      projectile.isEnemy ? 1 : 0,
      projectile.piercing || 0,
    ]),
    pw: state.powerups.map(powerup => [
      round2(powerup.position.x),
      round2(powerup.position.y),
      powerup.type,
    ]),
    xo: state.experienceOrbs.map(orb => [
      round2(orb.position.x),
      round2(orb.position.y),
      round1(orb.value),
    ]),
    go: state.isGameOver ? 1 : 0,
    ru: state.isRunning ? 1 : 0,
  };

  return wire;
}

function isWireGameStateV1(state: unknown): state is WireGameStateV1 {
  return !!state && typeof state === "object" && "__v" in state && (state as WireGameStateV1).__v === 1;
}

export function decodeGameState(state: unknown): unknown {
  if (!isWireGameStateV1(state)) return state;

  return {
    player: decodePlayer(state.p),
    player2: state.p2 ? decodePlayer(state.p2) : null,
    score: state.sc,
    wave: state.wv,
    multiplier: state.m,
    enemies: state.e.map(enemy => ({
      id: enemy[0],
      position: { x: enemy[1], y: enemy[2] },
      velocity: { x: 0, y: 0 },
      health: enemy[3],
      maxHealth: enemy[4],
      type: enemy[5],
      radius: enemy[6],
      damage: enemy[7],
      color: enemy[8],
      ghostAlpha: enemy[9] ?? undefined,
      speed: 0,
      points: 0,
      spawnTime: 0,
    })),
    projectiles: state.pr.map((projectile, index) => ({
      id: `p-${index}`,
      position: { x: projectile[0], y: projectile[1] },
      velocity: { x: projectile[2], y: projectile[3] },
      damage: projectile[4],
      radius: projectile[5],
      color: projectile[6],
      isEnemy: projectile[7] === 1,
      piercing: projectile[8],
      hitEnemies: new Set<string>(),
    })),
    powerups: state.pw.map((powerup, index) => ({
      id: `pw-${index}`,
      position: { x: powerup[0], y: powerup[1] },
      type: powerup[2],
      createdAt: 0,
      duration: 0,
    })),
    experienceOrbs: state.xo.map((orb, index) => ({
      id: `xo-${index}`,
      position: { x: orb[0], y: orb[1] },
      value: orb[2],
      createdAt: 0,
    })),
    isGameOver: state.go === 1,
    isRunning: state.ru === 1,
  };
}

export function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Store player info for reconnection
let storedPlayerInfo: { name: string; imageUrl: string } | null = null;

export function createPartySocket(
  roomCode: string,
  _onMessage: (msg: MultiplayerMessage) => void, // Deprecated - use your own handler
  onOpen?: () => void,
  onClose?: () => void
): PartySocket {
  const socket = new PartySocket({
    host: PARTYKIT_HOST,
    room: roomCode.toUpperCase(),
  });

  // NOTE: Message handler is NOT added here anymore to avoid stale closure issues.
  // Each component should add its own message handler that it can properly manage.
  // The _onMessage parameter is kept for backwards compatibility but not used.

  // Handle EVERY open event (including reconnections)
  socket.addEventListener("open", () => {
    console.log('[SOCKET] Connection opened/reconnected, id:', socket.id);

    // Re-send player-join on reconnection if we have stored info
    if (storedPlayerInfo) {
      console.log('[SOCKET] Re-sending player-join after reconnection');
      socket.send(JSON.stringify({
        type: "player-join",
        id: socket.id,
        name: storedPlayerInfo.name,
        imageUrl: storedPlayerInfo.imageUrl,
      }));
    }

    if (onOpen) {
      onOpen();
    }
  });

  if (onClose) {
    socket.addEventListener("close", onClose);
  }

  return socket;
}

export function joinRoom(socket: PartySocket, name: string, imageUrl: string) {
  // Store for reconnection
  storedPlayerInfo = { name, imageUrl };
  
  socket.send(JSON.stringify({
    type: "player-join",
    id: socket.id,
    name,
    imageUrl,
  }));
}

export function sendInput(
  socket: PartySocket,
  keys: string[],
  mousePos: { x: number; y: number }
) {
  socket.send(JSON.stringify({
    type: "player-input",
    id: socket.id,
    keys,
    mousePos,
  }));
}

export function sendGameState(socket: PartySocket, state: unknown) {
  try {
    const encodedState = encodeGameStateForWire(state);
    // Custom serializer to handle Sets (convert to arrays)
    const serialized = JSON.stringify({
      type: "game-state",
      state: encodedState,
      hostId: socket.id,
    }, (key, value) => {
      if (value instanceof Set) {
        return Array.from(value);
      }
      // Skip image objects (can't serialize HTMLImageElement)
      if (key === 'image' && value && typeof value === 'object') {
        return null;
      }
      return value;
    });
    socket.send(serialized);
  } catch (e) {
    console.error('[HOST] Failed to serialize game state:', e);
  }
}

export function startGame(socket: PartySocket, arena: string) {
  socket.send(JSON.stringify({
    type: "start-game",
    arena,
  }));
}
