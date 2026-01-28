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
  | { type: "level-up"; availableUpgrades: { id: string; name: string; description: string; icon: string; color: string; type: string; weaponType?: string }[]; level: number }
  | { type: "upgrade-selected"; playerId: string; upgradeId: string }
  | { type: "upgrades-complete"; upgradeId: string };

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
    // Custom serializer to handle Sets (convert to arrays)
    const serialized = JSON.stringify({
      type: "game-state",
      state,
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
