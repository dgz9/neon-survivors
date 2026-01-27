'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Users, Copy, Check, Crown, Loader2 } from 'lucide-react';
import PartySocket from 'partysocket';
import {
  generateRoomCode,
  createPartySocket,
  joinRoom,
  startGame as sendStartGame,
  MultiplayerPlayer,
  MultiplayerMessage,
} from '@/lib/multiplayer';

interface LobbyProps {
  playerName: string;
  playerImageUrl: string;
  selectedArena: 'void' | 'grid' | 'cyber' | 'neon';
  onStartGame: (socket: PartySocket, players: MultiplayerPlayer[], isHost: boolean) => void;
  onBack: () => void;
}

export default function Lobby({
  playerName,
  playerImageUrl,
  selectedArena,
  onStartGame,
  onBack,
}: LobbyProps) {
  const [mode, setMode] = useState<'select' | 'create' | 'join'>('select');
  const [roomCode, setRoomCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [players, setPlayers] = useState<MultiplayerPlayer[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<PartySocket | null>(null);
  const myIdRef = useRef<string | null>(null);

  const handleMessage = useCallback((msg: MultiplayerMessage) => {
    switch (msg.type) {
      case 'room-info':
        setPlayers(msg.players);
        setRoomCode(msg.roomCode);
        const me = msg.players.find(p => p.id === myIdRef.current);
        if (me) {
          setIsHost(me.isHost);
        }
        break;
      case 'player-leave':
        setPlayers(prev => prev.filter(p => p.id !== msg.id));
        break;
      case 'start-game':
        if (socketRef.current) {
          onStartGame(socketRef.current, players, isHost);
        }
        break;
    }
  }, [players, isHost, onStartGame]);

  const connectToRoom = useCallback((code: string) => {
    setError(null);
    
    const socket = createPartySocket(
      code,
      handleMessage,
      () => {
        setIsConnected(true);
        myIdRef.current = socket.id;
        joinRoom(socket, playerName, playerImageUrl);
      },
      () => {
        setIsConnected(false);
        setError('Disconnected from room');
      }
    );
    
    socketRef.current = socket;
  }, [handleMessage, playerName, playerImageUrl]);

  const handleCreateRoom = useCallback(() => {
    const code = generateRoomCode();
    setRoomCode(code);
    setMode('create');
    connectToRoom(code);
  }, [connectToRoom]);

  const handleJoinRoom = useCallback(() => {
    if (joinCode.length !== 4) {
      setError('Room code must be 4 characters');
      return;
    }
    setMode('join');
    connectToRoom(joinCode.toUpperCase());
  }, [joinCode, connectToRoom]);

  const handleCopyCode = useCallback(() => {
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [roomCode]);

  const handleStartGame = useCallback(() => {
    if (socketRef.current && isHost && players.length >= 2) {
      sendStartGame(socketRef.current, selectedArena);
      onStartGame(socketRef.current, players, isHost);
    }
  }, [isHost, players, selectedArena, onStartGame]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      socketRef.current?.close();
    };
  }, []);

  // Update message handler when dependencies change
  useEffect(() => {
    if (socketRef.current) {
      const socket = socketRef.current;
      const handler = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data) as MultiplayerMessage;
          handleMessage(data);
        } catch (e) {
          console.error('Failed to parse message:', e);
        }
      };
      
      socket.addEventListener('message', handler);
      return () => socket.removeEventListener('message', handler);
    }
  }, [handleMessage]);

  return (
    <div className="w-full max-w-md mx-auto">
      {mode === 'select' && (
        <div className="space-y-6">
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Users className="w-8 h-8 text-electric-cyan" />
              <h2 className="font-display text-3xl text-electric-cyan">CO-OP MODE</h2>
            </div>
            <p className="font-mono text-sm text-white/60">
              Team up with a friend and survive together!
            </p>
          </div>

          <button
            onClick={handleCreateRoom}
            className="w-full py-4 font-display text-xl uppercase tracking-wider bg-electric-cyan text-brutal-black hover:bg-white transition-colors"
          >
            Create Room
          </button>

          <div className="flex items-center gap-4">
            <div className="h-[1px] flex-1 bg-white/20" />
            <span className="font-mono text-xs text-white/40">OR</span>
            <div className="h-[1px] flex-1 bg-white/20" />
          </div>

          <div className="space-y-3">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 4))}
              placeholder="ENTER CODE"
              maxLength={4}
              className="w-full bg-brutal-dark border-2 border-white/20 focus:border-electric-pink px-4 py-3 font-mono text-2xl text-center tracking-[0.5em] text-white placeholder-white/30 outline-none transition-colors uppercase"
            />
            <button
              onClick={handleJoinRoom}
              disabled={joinCode.length !== 4}
              className={`w-full py-4 font-display text-xl uppercase tracking-wider border-2 transition-colors ${
                joinCode.length === 4
                  ? 'border-electric-pink text-electric-pink hover:bg-electric-pink hover:text-brutal-black'
                  : 'border-white/20 text-white/30 cursor-not-allowed'
              }`}
            >
              Join Room
            </button>
          </div>

          {error && (
            <p className="text-center font-mono text-sm text-electric-pink">{error}</p>
          )}

          <button
            onClick={onBack}
            className="w-full py-3 font-mono text-sm uppercase tracking-wider text-white/40 hover:text-white transition-colors"
          >
            {'<--'} Back to Menu
          </button>
        </div>
      )}

      {(mode === 'create' || mode === 'join') && (
        <div className="space-y-6">
          {/* Room Code Display */}
          <div className="text-center">
            <p className="font-mono text-xs text-white/40 uppercase tracking-wider mb-2">
              Room Code
            </p>
            <div className="flex items-center justify-center gap-3">
              <span className="font-display text-5xl tracking-[0.3em] text-electric-yellow">
                {roomCode || '----'}
              </span>
              <button
                onClick={handleCopyCode}
                className="p-2 text-white/40 hover:text-electric-cyan transition-colors"
                title="Copy code"
              >
                {copied ? <Check className="w-6 h-6 text-electric-green" /> : <Copy className="w-6 h-6" />}
              </button>
            </div>
          </div>

          {/* Connection Status */}
          {!isConnected && (
            <div className="flex items-center justify-center gap-3 py-4">
              <Loader2 className="w-5 h-5 text-electric-cyan animate-spin" />
              <span className="font-mono text-sm text-white/60">Connecting...</span>
            </div>
          )}

          {/* Players List */}
          {isConnected && (
            <div className="border border-white/10 bg-brutal-dark">
              <div className="flex items-center gap-3 p-3 border-b border-white/10">
                <Users className="w-5 h-5 text-electric-cyan" />
                <span className="font-mono text-xs uppercase tracking-wider text-white/60">
                  Players ({players.length}/2)
                </span>
              </div>
              
              <div className="divide-y divide-white/5">
                {players.map((player) => (
                  <div
                    key={player.id}
                    className="flex items-center gap-3 p-4"
                  >
                    <div className="w-10 h-10 border border-white/20 overflow-hidden flex items-center justify-center bg-brutal-black">
                      {player.imageUrl ? (
                        <img src={player.imageUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-2xl">👤</span>
                      )}
                    </div>
                    <span className="font-mono text-white flex-1">{player.name}</span>
                    {player.isHost && (
                      <Crown className="w-5 h-5 text-electric-yellow" />
                    )}
                    {player.id === myIdRef.current && (
                      <span className="font-mono text-xs text-electric-cyan">(you)</span>
                    )}
                  </div>
                ))}
                
                {players.length < 2 && (
                  <div className="flex items-center gap-3 p-4 text-white/30">
                    <div className="w-10 h-10 border border-dashed border-white/20 flex items-center justify-center">
                      <span className="text-xl">?</span>
                    </div>
                    <span className="font-mono text-sm">Waiting for player...</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <p className="text-center font-mono text-sm text-electric-pink">{error}</p>
          )}

          {/* Start Button (Host only) */}
          {isHost && (
            <button
              onClick={handleStartGame}
              disabled={players.length < 2}
              className={`w-full py-4 font-display text-xl uppercase tracking-wider transition-colors ${
                players.length >= 2
                  ? 'bg-electric-green text-brutal-black hover:bg-white'
                  : 'bg-white/10 text-white/30 cursor-not-allowed'
              }`}
            >
              {players.length >= 2 ? '// START CO-OP' : 'Waiting for teammate...'}
            </button>
          )}

          {!isHost && isConnected && (
            <div className="text-center py-4">
              <p className="font-mono text-sm text-white/60">
                Waiting for host to start...
              </p>
            </div>
          )}

          <button
            onClick={() => {
              socketRef.current?.close();
              setMode('select');
              setPlayers([]);
              setIsConnected(false);
              setRoomCode('');
            }}
            className="w-full py-3 font-mono text-sm uppercase tracking-wider text-white/40 hover:text-white transition-colors"
          >
            {'<--'} Leave Room
          </button>
        </div>
      )}
    </div>
  );
}
