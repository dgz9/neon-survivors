'use client';

import { useState, useRef, useCallback } from 'react';

// Preset avatars (emoji-based for simplicity, can be replaced with actual images)
const PRESET_AVATARS = [
  { id: 'robot', emoji: '🤖', color: '#00f0ff' },
  { id: 'alien', emoji: '👽', color: '#39ff14' },
  { id: 'skull', emoji: '💀', color: '#ffffff' },
  { id: 'ninja', emoji: '🥷', color: '#bf5fff' },
  { id: 'astronaut', emoji: '🧑‍🚀', color: '#ff6b1a' },
  { id: 'zombie', emoji: '🧟', color: '#39ff14' },
  { id: 'vampire', emoji: '🧛', color: '#ff2d6a' },
  { id: 'wizard', emoji: '🧙', color: '#bf5fff' },
  { id: 'cat', emoji: '🐱', color: '#ff6b1a' },
  { id: 'dog', emoji: '🐶', color: '#e4ff1a' },
  { id: 'bear', emoji: '🐻', color: '#ff6b1a' },
  { id: 'fox', emoji: '🦊', color: '#ff6b1a' },
];

interface AvatarSelectorProps {
  onSelect: (imageUrl: string, name: string) => void;
  buttonText?: string;
}

export default function AvatarSelector({ onSelect, buttonText = '// START GAME' }: AvatarSelectorProps) {
  const [selectedAvatar, setSelectedAvatar] = useState<string | null>(null);
  const [customImage, setCustomImage] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setCustomImage(result);
        setSelectedAvatar(null);
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleAvatarSelect = useCallback((avatarId: string) => {
    setSelectedAvatar(avatarId);
    setCustomImage(null);
  }, []);

  const handleStart = useCallback(() => {
    if (!playerName.trim()) return;
    
    let imageUrl = '';
    
    if (customImage) {
      imageUrl = customImage;
    } else if (selectedAvatar) {
      // Create canvas with emoji for avatar
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const avatar = PRESET_AVATARS.find(a => a.id === selectedAvatar);
        if (avatar) {
          ctx.fillStyle = '#0a0a0a';
          ctx.fillRect(0, 0, 128, 128);
          ctx.font = '80px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(avatar.emoji, 64, 64);
        }
        imageUrl = canvas.toDataURL();
      }
    }

    onSelect(imageUrl, playerName.trim());
  }, [customImage, selectedAvatar, playerName, onSelect]);

  const isReady = playerName.trim() && (selectedAvatar || customImage);

  return (
    <div className="w-full max-w-2xl mx-auto space-y-8">
      {/* Name input */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-electric-yellow font-display text-2xl">01</span>
          <div className="h-[1px] flex-1 bg-white/10" />
          <span className="font-mono text-xs text-white/40 uppercase tracking-wider">Enter Your Name</span>
        </div>
        
        <input
          type="text"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          placeholder="Your name for the leaderboard..."
          maxLength={20}
          className="w-full bg-brutal-dark border-2 border-white/20 focus:border-electric-cyan px-4 py-3 font-mono text-white placeholder-white/30 outline-none transition-colors"
        />
      </div>

      {/* Avatar selection */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-electric-pink font-display text-2xl">02</span>
          <div className="h-[1px] flex-1 bg-white/10" />
          <span className="font-mono text-xs text-white/40 uppercase tracking-wider">Choose Avatar</span>
        </div>

        {/* Preset avatars */}
        <div className="grid grid-cols-6 gap-3 mb-6">
          {PRESET_AVATARS.map((avatar) => (
            <button
              key={avatar.id}
              onClick={() => handleAvatarSelect(avatar.id)}
              className={`aspect-square flex items-center justify-center text-4xl border-2 transition-all ${
                selectedAvatar === avatar.id
                  ? 'border-electric-cyan bg-electric-cyan/10 scale-110'
                  : 'border-white/20 hover:border-white/40 bg-brutal-dark'
              }`}
            >
              {avatar.emoji}
            </button>
          ))}
        </div>

        {/* Upload custom */}
        <div className="flex items-center gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 border-2 border-dashed border-white/20 hover:border-electric-pink py-4 font-mono text-sm text-white/60 hover:text-electric-pink transition-colors"
          >
            + Upload Custom Image
          </button>
          
          {customImage && (
            <div className="w-16 h-16 border-2 border-electric-cyan overflow-hidden">
              <img src={customImage} alt="Custom" className="w-full h-full object-cover" />
            </div>
          )}
        </div>
      </div>

      {/* Start button */}
      <div className="pt-4">
        <button
          onClick={handleStart}
          disabled={!isReady}
          className={`w-full py-4 font-display text-2xl uppercase tracking-wider transition-all ${
            isReady
              ? 'bg-electric-cyan text-brutal-black hover:bg-white'
              : 'bg-white/10 text-white/30 cursor-not-allowed'
          }`}
        >
          {isReady ? buttonText : '// SELECT AVATAR & NAME'}
        </button>
      </div>
    </div>
  );
}
