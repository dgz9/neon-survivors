import PartySocket from "partysocket";
import type { WireCommand } from "./netcode";
import type { NetEvent } from "./engine/netEvents";

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
  | { type: "input"; id: string; cmds: WireCommand[] }
  | { type: "ping"; id: string; t: number }
  | { type: "pong"; t: number }
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

/**
 * v2 additions over v1:
 *  - `t`   host clock time of the simulation tick this snapshot represents,
 *          which is what makes real interpolation possible on the guest.
 *  - `ack` last guest input sequence the host folded in, for reconciliation.
 *  - enemy velocities, so remote motion can extrapolate through a dropped packet.
 *  - stable numeric projectile ids, so projectiles interpolate instead of
 *    teleporting between snapshots.
 *  - `ev`  cosmetic events (hits/kills/blasts) the guest replays locally —
 *          particles themselves are far too numerous to ship.
 */
interface WireGameStateV2 {
  __v: 2;
  t: number;
  ack: number;
  /** Host world size. The host owns the arena's dimensions; without them a
   *  guest on a differently shaped screen renders a different world. */
  ww: number;
  wh: number;
  p: WirePlayer;
  p2: WirePlayer | null;
  sc: number;
  wv: number;
  m: number;
  ks: number;
  nm: number;
  gt: number;
  ss: number;
  pl: number;
  /** Colour palette. Entities carry an index instead of a hex string — colours
   *  repeat heavily, and at 25 snapshots/sec the duplicates were the single
   *  largest field in the payload. */
  cp: string[];
  e: Array<[string, number, number, number, number, number, number, string, number, number, number | null, number, number]>;
  pr: Array<[number, number, number, number, number, number, number, number]>;
  pw: Array<[number, number, string]>;
  xo: Array<[number, number, number, number]>;
  ev: NetEvent[];
  go: 0 | 1;
  ru: 0 | 1;
  ae?: string;
  au?: number;
  wa?: number;
}

type RawGameStateLike = {
  t: number;
  ack: number;
  worldWidth: number;
  worldHeight: number;
  killStreak: number;
  nearMissCount: number;
  gameTime: number;
  screenShake: number;
  pendingLevelUps: number;
  events: NetEvent[];
  activeEvent?: string;
  eventAnnounceTime?: number;
  waveAnnounceTime?: number;
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
    velocity: { x: number; y: number };
    health: number;
    maxHealth: number;
    type: string;
    radius: number;
    color: string;
    ghostAlpha?: number;
    spawnTime: number;
    isElite?: boolean;
  }>;
  projectiles: Array<{
    nid: number;
    position: { x: number; y: number };
    velocity: { x: number; y: number };
    radius: number;
    color: string;
    isEnemy: boolean;
  }>;
  powerups: Array<{ position: { x: number; y: number }; type: string }>;
  experienceOrbs: Array<{ nid: number; position: { x: number; y: number }; value: number }>;
  // Projectiles and orbs live in pools, so the arrays run past the live
  // entities; these say where to stop. Encoding straight off the pools is what
  // keeps a busy wave from building thousands of throwaway objects a second
  // just to hand them to the encoder.
  projectileCount: number;
  experienceOrbCount: number;
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

function encodeEnemies(
  state: RawGameStateLike,
  colorId: (color: string) => number,
): WireGameStateV2["e"] {
  const count = state.enemies.length;
  const out: WireGameStateV2["e"] = new Array(count);
  for (let i = 0; i < count; i++) {
    const enemy = state.enemies[i];
    out[i] = [
      enemy.id,
      round1(enemy.position.x),
      round1(enemy.position.y),
      round1(enemy.velocity?.x || 0),
      round1(enemy.velocity?.y || 0),
      round1(enemy.health),
      round1(enemy.maxHealth),
      enemy.type,
      round1(enemy.radius),
      colorId(enemy.color),
      enemy.ghostAlpha ?? null,
      Math.round(enemy.spawnTime || 0),
      enemy.isElite ? 1 : 0,
    ];
  }
  return out;
}

function encodeProjectiles(
  state: RawGameStateLike,
  colorId: (color: string) => number,
): WireGameStateV2["pr"] {
  const count = Math.min(state.projectileCount, state.projectiles.length);
  const out: WireGameStateV2["pr"] = new Array(count);
  for (let i = 0; i < count; i++) {
    const projectile = state.projectiles[i];
    out[i] = [
      projectile.nid,
      round1(projectile.position.x),
      round1(projectile.position.y),
      round1(projectile.velocity.x),
      round1(projectile.velocity.y),
      round1(projectile.radius),
      colorId(projectile.color),
      projectile.isEnemy ? 1 : 0,
    ];
  }
  return out;
}

function encodeOrbs(state: RawGameStateLike): WireGameStateV2["xo"] {
  const count = Math.min(state.experienceOrbCount, state.experienceOrbs.length);
  const out: WireGameStateV2["xo"] = new Array(count);
  for (let i = 0; i < count; i++) {
    const orb = state.experienceOrbs[i];
    out[i] = [orb.nid, round1(orb.position.x), round1(orb.position.y), round1(orb.value)];
  }
  return out;
}

function encodeGameStateForWire(state: unknown): unknown {
  if (!isRawGameStateLike(state)) return state;

  const palette: string[] = [];
  const paletteIndex = new Map<string, number>();
  const colorId = (color: string): number => {
    let id = paletteIndex.get(color);
    if (id === undefined) {
      id = palette.length;
      palette.push(color);
      paletteIndex.set(color, id);
    }
    return id;
  };

  const wire: WireGameStateV2 = {
    __v: 2,
    t: Math.round(state.t),
    ack: state.ack || 0,
    ww: Math.round(state.worldWidth),
    wh: Math.round(state.worldHeight),
    p: encodePlayer(state.player),
    p2: state.player2 ? encodePlayer(state.player2) : null,
    sc: Math.round(state.score || 0),
    wv: Math.round(state.wave || 1),
    m: round2(state.multiplier || 1),
    ks: Math.round(state.killStreak || 0),
    nm: Math.round(state.nearMissCount || 0),
    gt: Math.round(state.gameTime || 0),
    ss: round1(state.screenShake || 0),
    pl: Math.round(state.pendingLevelUps || 0),
    cp: palette,
    e: encodeEnemies(state, colorId),
    // Projectiles are render-only on the guest, so damage and piercing never
    // leave the host. They are also the highest-count entity, so every dropped
    // field pays for itself many times over.
    pr: encodeProjectiles(state, colorId),
    pw: state.powerups.map(powerup => [
      round1(powerup.position.x),
      round1(powerup.position.y),
      powerup.type,
    ]),
    xo: encodeOrbs(state),
    ev: state.events || [],
    go: state.isGameOver ? 1 : 0,
    ru: state.isRunning ? 1 : 0,
    ae: state.activeEvent,
    au: state.eventAnnounceTime,
    wa: state.waveAnnounceTime,
  };

  return wire;
}

export interface DecodedSnapshot {
  hostTime: number;
  ack: number;
  worldWidth: number;
  worldHeight: number;
  player: ReturnType<typeof decodePlayer>;
  player2: ReturnType<typeof decodePlayer> | null;
  score: number;
  wave: number;
  multiplier: number;
  killStreak: number;
  nearMissCount: number;
  gameTime: number;
  screenShake: number;
  pendingLevelUps: number;
  enemies: Array<{
    id: string;
    position: { x: number; y: number };
    velocity: { x: number; y: number };
    health: number;
    maxHealth: number;
    type: string;
    radius: number;
    color: string;
    ghostAlpha?: number;
    spawnTime: number;
    isElite: boolean;
  }>;
  projectiles: Array<{
    nid: number;
    position: { x: number; y: number };
    velocity: { x: number; y: number };
    radius: number;
    color: string;
    isEnemy: boolean;
  }>;
  powerups: Array<{ id: string; position: { x: number; y: number }; type: string }>;
  experienceOrbs: Array<{ nid: number; position: { x: number; y: number }; value: number }>;
  events: NetEvent[];
  isGameOver: boolean;
  isRunning: boolean;
  activeEvent?: string;
  eventAnnounceTime?: number;
  waveAnnounceTime?: number;
}

function isWireGameStateV2(state: unknown): state is WireGameStateV2 {
  return !!state && typeof state === "object" && (state as WireGameStateV2).__v === 2;
}

export function decodeGameState(state: unknown): DecodedSnapshot | null {
  if (!isWireGameStateV2(state)) return null;

  const palette = state.cp || [];
  const color = (id: number) => palette[id] ?? '#ffffff';

  return {
    hostTime: state.t,
    ack: state.ack,
    worldWidth: state.ww,
    worldHeight: state.wh,
    player: decodePlayer(state.p),
    player2: state.p2 ? decodePlayer(state.p2) : null,
    score: state.sc,
    wave: state.wv,
    multiplier: state.m,
    killStreak: state.ks,
    nearMissCount: state.nm,
    gameTime: state.gt,
    screenShake: state.ss,
    pendingLevelUps: state.pl,
    enemies: state.e.map(enemy => ({
      id: enemy[0] as string,
      position: { x: enemy[1] as number, y: enemy[2] as number },
      velocity: { x: enemy[3] as number, y: enemy[4] as number },
      health: enemy[5] as number,
      maxHealth: enemy[6] as number,
      type: enemy[7] as string,
      radius: enemy[8] as number,
      color: color(enemy[9] as number),
      ghostAlpha: (enemy[10] as number | null) ?? undefined,
      spawnTime: enemy[11] as number,
      isElite: enemy[12] === 1,
    })),
    projectiles: state.pr.map(projectile => ({
      nid: projectile[0],
      position: { x: projectile[1], y: projectile[2] },
      velocity: { x: projectile[3], y: projectile[4] },
      radius: projectile[5],
      color: color(projectile[6]),
      isEnemy: projectile[7] === 1,
    })),
    powerups: state.pw.map((powerup, index) => ({
      id: `pw-${index}`,
      position: { x: powerup[0] as number, y: powerup[1] as number },
      type: powerup[2] as string,
    })),
    experienceOrbs: state.xo.map(orb => ({
      nid: orb[0],
      position: { x: orb[1], y: orb[2] },
      value: orb[3],
    })),
    events: state.ev || [],
    isGameOver: state.go === 1,
    isRunning: state.ru === 1,
    activeEvent: state.ae,
    eventAnnounceTime: state.au,
    waveAnnounceTime: state.wa,
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

/** Guest -> host. Sends the recent unacknowledged commands for loss tolerance. */
export function sendInputCommands(socket: PartySocket, cmds: WireCommand[]) {
  if (cmds.length === 0) return;
  socket.send(JSON.stringify({ type: "input", id: socket.id, cmds }));
}

export function sendPing(socket: PartySocket, t: number) {
  socket.send(JSON.stringify({ type: "ping", id: socket.id, t }));
}

export function sendPong(socket: PartySocket, t: number) {
  socket.send(JSON.stringify({ type: "pong", t }));
}

export function sendGameState(socket: PartySocket, state: unknown) {
  try {
    const encodedState = encodeGameStateForWire(state);
    socket.send(JSON.stringify({
      type: "game-state",
      state: encodedState,
      hostId: socket.id,
    }));
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
