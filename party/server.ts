import { Server, routePartykitRequest, type Connection, type WSMessage } from "partyserver";

// The co-op room server, on Cloudflare (see wrangler.jsonc). Each room is its own Durable
// Object, and everything here is held in memory for as long as someone is connected.

// Only the game may open a socket from a browser, so another site can't spend this account's
// free allowance. Anything can still connect without a browser.
const ORIGINS = /^(https:\/\/survivors\.neonbit\.gg|https:\/\/neon-survivors[a-z0-9-]*\.vercel\.app|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

// Message types
interface PlayerJoin {
  type: "player-join";
  id: string;
  name: string;
  imageUrl: string;
}

interface PlayerInput {
  type: "input";
  id: string;
  cmds: [number, number, number, number][];
}

interface Ping {
  type: "ping";
  id: string;
  t: number;
}

interface Pong {
  type: "pong";
  t: number;
}

interface GameStateSync {
  type: "game-state";
  state: unknown;
}

interface StartGame {
  type: "start-game";
  arena: string;
}

interface LevelUp {
  type: "level-up";
  availableUpgrades: unknown[];
  level: number;
}

interface UpgradeSelected {
  type: "upgrade-selected";
  playerId: string;
  upgradeId: string;
  upgradeName?: string;
}

interface UpgradesComplete {
  type: "upgrades-complete";
  p1UpgradeId: string;
  p2UpgradeId: string;
}

interface GameOver {
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
}

interface RoomInfo {
  type: "room-info";
  players: { id: string; name: string; imageUrl: string; isHost: boolean }[];
  roomCode: string;
}

type Message = PlayerJoin | PlayerInput | Ping | Pong | GameStateSync | StartGame | LevelUp | UpgradeSelected | UpgradesComplete | GameOver;

interface Player {
  id: string;
  name: string;
  imageUrl: string;
  isHost: boolean;
}

// The binding's name, Main, is what makes this the default party at /parties/main/:room
export class Main extends Server {
  players: Map<string, Player> = new Map();
  // Track connections separately - connections can change, players persist
  connections: Map<string, Connection> = new Map();
  hostId: string | null = null;
  gameStarted: boolean = false;

  onConnect(conn: Connection) {
    console.log(`[SERVER] Connection ${conn.id} joined room ${this.name}, total connections: ${this.connections.size + 1}`);
    // Store connection, but don't add as player until they send player-join
    this.connections.set(conn.id, conn);
  }

  onClose(conn: Connection) {
    console.log(`[SERVER] Connection ${conn.id} closed, gameStarted=${this.gameStarted}`);
    this.connections.delete(conn.id);
    
    // Only remove player from game if NOT started (lobby phase)
    // During game, we keep player info but mark them as disconnected
    if (!this.gameStarted) {
      const player = this.players.get(conn.id);
      if (player) {
        this.players.delete(conn.id);
        
        // If host left, assign new host
        if (this.hostId === conn.id && this.players.size > 0) {
          const newHost = Array.from(this.players.values())[0];
          if (newHost) {
            newHost.isHost = true;
            this.hostId = newHost.id;
          }
        }
        
        // Notify others
        this.broadcastToConnections({
          type: "player-leave",
          id: conn.id,
        });
        
        this.broadcastRoomInfo();
      }
    }
  }

  onMessage(sender: Connection, raw: WSMessage) {
    // Everything in this game's protocol is JSON text
    if (typeof raw !== "string") return;
    const message = raw;
    try {
      const data = JSON.parse(message) as Message;
      
      switch (data.type) {
        case "player-join":
          this.handlePlayerJoin(sender, data);
          break;
          
        case "input":
          // Forward guest input commands to the host
          this.forwardToHost(message, sender.id);
          break;

        case "ping":
          // Latency probe from the guest — the host echoes it back as a pong
          this.forwardToHost(message, sender.id);
          break;

        case "pong":
          this.broadcastToOthers(message, sender.id);
          break;
          
        case "game-state":
          // Broadcast game state to all OTHER connections
          this.broadcastToOthers(message, sender.id);
          break;
          
        case "start-game":
          console.log(`[SERVER] Game starting! Players: ${this.players.size}, Connections: ${this.connections.size}`);
          this.gameStarted = true;
          this.broadcastToConnections(message);
          break;

        case "level-up":
          // Host sends level-up to guest
          this.broadcastToOthers(message, sender.id);
          break;

        case "upgrade-selected":
          // Either player can send their selection, broadcast to others
          this.broadcastToOthers(message, sender.id);
          break;

        case "upgrades-complete":
          // Host sends final upgrade choice to all
          this.broadcastToConnections(message);
          break;

        case "game-over":
          // Host sends final results immediately to guest
          this.broadcastToOthers(message, sender.id);
          break;
      }
    } catch (e) {
      console.error("[SERVER] Failed to parse message:", e);
    }
  }

  handlePlayerJoin(conn: Connection, data: PlayerJoin) {
    // Check if this player already exists (reconnection case)
    let existingPlayer: Player | undefined;
    for (const [id, player] of this.players) {
      if (player.name === data.name && player.imageUrl === data.imageUrl) {
        existingPlayer = player;
        // Remove old entry
        this.players.delete(id);
        break;
      }
    }
    
    const isHost = existingPlayer?.isHost ?? this.players.size === 0;
    
    const player: Player = {
      id: conn.id,
      name: data.name,
      imageUrl: data.imageUrl,
      isHost,
    };
    
    if (isHost) {
      this.hostId = conn.id;
    }
    
    this.players.set(conn.id, player);
    console.log(`[SERVER] Player joined: ${data.name} (${conn.id}), isHost=${isHost}, total players=${this.players.size}`);
    
    // Send room info to everyone
    this.broadcastRoomInfo();
  }

  broadcastRoomInfo() {
    const roomInfo: RoomInfo = {
      type: "room-info",
      players: Array.from(this.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        imageUrl: p.imageUrl,
        isHost: p.isHost,
      })),
      roomCode: this.name,
    };
    this.broadcastToConnections(roomInfo);
  }

  // Broadcast to ALL active connections
  broadcastToConnections(message: unknown) {
    const msg = typeof message === "string" ? message : JSON.stringify(message);
    for (const conn of this.connections.values()) {
      try {
        conn.send(msg);
      } catch (e) {
        console.error(`[SERVER] Failed to send to ${conn.id}:`, e);
      }
    }
  }

  // Broadcast to all connections EXCEPT one
  broadcastToOthers(message: string, exceptId: string) {
    for (const [id, conn] of this.connections) {
      if (id !== exceptId) {
        try {
          conn.send(message);
        } catch (e) {
          console.error(`[SERVER] Failed to send to ${id}:`, e);
        }
      }
    }
  }

  // Forward message to host connection
  forwardToHost(message: string, senderId: string) {
    if (!this.hostId || this.hostId === senderId) return;
    
    const hostConn = this.connections.get(this.hostId);
    if (hostConn) {
      try {
        hostConn.send(message);
      } catch (e) {
        console.error(`[SERVER] Failed to forward to host:`, e);
      }
    }
  }
}

interface Env extends Record<string, unknown> {
  Main: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env) {
    const response = await routePartykitRequest(request, env as never, {
      onBeforeConnect(req) {
        const origin = req.headers.get("Origin");
        if (origin && !ORIGINS.test(origin)) return new Response("Not from the game.", { status: 403 });
      },
    });
    return response ?? new Response("The Neon Survivors co-op server. The game is at https://survivors.neonbit.gg\n", { status: new URL(request.url).pathname === "/" ? 200 : 404 });
  },
};
