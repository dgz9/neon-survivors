import type * as Party from "partykit/server";

// Message types
interface PlayerJoin {
  type: "player-join";
  id: string;
  name: string;
  imageUrl: string;
}

interface PlayerLeave {
  type: "player-leave";
  id: string;
}

interface PlayerInput {
  type: "player-input";
  id: string;
  keys: string[];
  mousePos: { x: number; y: number };
}

interface GameStateSync {
  type: "game-state";
  state: unknown;
  hostId: string;
}

interface StartGame {
  type: "start-game";
  arena: string;
}

interface RoomInfo {
  type: "room-info";
  players: { id: string; name: string; imageUrl: string; isHost: boolean }[];
  roomCode: string;
}

type Message = PlayerJoin | PlayerLeave | PlayerInput | GameStateSync | StartGame;

interface Player {
  id: string;
  name: string;
  imageUrl: string;
  isHost: boolean;
  connection: Party.Connection;
}

export default class NeonSurvivorsParty implements Party.Server {
  players: Map<string, Player> = new Map();
  hostId: string | null = null;
  gameStarted: boolean = false;

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    console.log(`Connection ${conn.id} joined room ${this.room.id}`);
  }

  onClose(conn: Party.Connection) {
    const player = this.players.get(conn.id);
    if (player) {
      this.players.delete(conn.id);
      
      // If host left, assign new host
      if (this.hostId === conn.id && this.players.size > 0) {
        const playersArray = Array.from(this.players.values());
        const newHost = playersArray[0];
        if (newHost) {
          newHost.isHost = true;
          this.hostId = newHost.id;
        }
      }
      
      // Notify others
      this.broadcast({
        type: "player-leave",
        id: conn.id,
      });
      
      this.broadcastRoomInfo();
    }
  }

  onMessage(message: string, sender: Party.Connection) {
    try {
      const data = JSON.parse(message) as Message;
      
      switch (data.type) {
        case "player-join":
          this.handlePlayerJoin(sender, data);
          break;
        case "player-input":
          // Forward inputs to host
          if (this.hostId && this.hostId !== sender.id) {
            const host = this.players.get(this.hostId);
            if (host) {
              console.log(`[SERVER] Forwarding player-input from ${sender.id} to host ${this.hostId}`);
              host.connection.send(message);
            }
          }
          break;
        case "game-state":
          // Host sends game state to all other players
          console.log(`[SERVER] game-state from ${sender.id}, hostId=${this.hostId}, players=${this.players.size}`);
          if (sender.id === this.hostId) {
            console.log(`[SERVER] Broadcasting game-state to ${this.players.size - 1} other players`);
            this.broadcastExcept(message, sender.id);
          } else {
            console.log(`[SERVER] Ignoring game-state - sender is not host`);
          }
          break;
        case "start-game":
          this.gameStarted = true;
          this.broadcast(message);
          break;
      }
    } catch (e) {
      console.error("Failed to parse message:", e);
    }
  }

  handlePlayerJoin(conn: Party.Connection, data: PlayerJoin) {
    const isHost = this.players.size === 0;
    
    const player: Player = {
      id: conn.id,
      name: data.name,
      imageUrl: data.imageUrl,
      isHost,
      connection: conn,
    };
    
    if (isHost) {
      this.hostId = conn.id;
    }
    
    this.players.set(conn.id, player);
    
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
      roomCode: this.room.id,
    };
    this.broadcast(roomInfo);
  }

  broadcast(message: unknown) {
    const msg = typeof message === "string" ? message : JSON.stringify(message);
    Array.from(this.players.values()).forEach(player => {
      player.connection.send(msg);
    });
  }

  broadcastExcept(message: string, exceptId: string) {
    Array.from(this.players.values()).forEach(player => {
      if (player.id !== exceptId) {
        player.connection.send(message);
      }
    });
  }
}

NeonSurvivorsParty satisfies Party.Worker;
