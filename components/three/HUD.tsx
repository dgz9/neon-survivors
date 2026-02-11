'use client';

interface HUDProps {
  displayState: {
    score: number;
    wave: number;
    health: number;
    maxHealth: number;
    level: number;
    experience: number;
    experienceToLevel: number;
    multiplier: number;
    killStreak: number;
    activeEvent?: string;
    eventAnnounceTime?: number;
    weapons: { type: string; level: number }[];
    waveAnnounceTime?: number;
    gameTime: number;
  } | null;
}

const WEAPON_ICONS: Record<string, string> = {
  blaster: '\u{1F52B}',
  spread: '\u{1F4A8}',
  laser: '\u26A1',
  orbit: '\u{1F52E}',
  missile: '\u{1F680}',
};

export function HUD({ displayState }: HUDProps) {
  if (!displayState) return null;

  const {
    score,
    wave,
    health,
    maxHealth,
    level,
    experience,
    experienceToLevel,
    multiplier,
    killStreak,
    activeEvent,
    eventAnnounceTime,
    weapons,
    waveAnnounceTime,
    gameTime,
  } = displayState;

  const healthPercent = Math.max(0, Math.min(100, (health / maxHealth) * 100));
  const xpPercent = Math.max(0, Math.min(100, (experience / experienceToLevel) * 100));

  // waveAnnounceTime is a Date.now() timestamp, so compare with Date.now()
  const now = Date.now();
  const showWaveAnnounce =
    waveAnnounceTime !== undefined && now - waveAnnounceTime < 3000;
  const waveAnnounceFade = showWaveAnnounce
    ? Math.max(0, 1 - (now - waveAnnounceTime!) / 3000)
    : 0;
  const showEventAnnounce = eventAnnounceTime !== undefined && now - eventAnnounceTime < 2200;
  const eventAnnounceFade = showEventAnnounce
    ? Math.max(0, 1 - (now - eventAnnounceTime!) / 2200)
    : 0;

  return (
    <div
      className="absolute inset-0 pointer-events-none font-mono"
      style={{ zIndex: 10 }}
    >
      {/* Score - Top Right */}
      <div className="absolute top-4 right-4 text-right">
        <div className="text-white text-2xl font-bold" style={{ textShadow: '0 0 10px rgba(0,240,255,0.8)' }}>
          {score.toLocaleString()}
        </div>
        {multiplier > 1 && (
          <div
            className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-bold"
            style={{
              background: 'rgba(228,255,26,0.2)',
              border: '1px solid rgba(228,255,26,0.6)',
              color: '#e4ff1a',
              textShadow: '0 0 6px rgba(228,255,26,0.6)',
            }}
          >
            x{multiplier.toFixed(1)}
          </div>
        )}
        {killStreak >= 3 && (
          <div
            className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-bold"
            style={{
              background: 'rgba(255,45,106,0.15)',
              border: '1px solid rgba(255,45,106,0.6)',
              color: '#ff2d6a',
              textShadow: '0 0 6px rgba(255,45,106,0.6)',
            }}
          >
            {killStreak} streak
          </div>
        )}
      </div>

      {/* Health Bar - Bottom Left */}
      <div className="absolute bottom-4 left-4" style={{ width: 180 }}>
        <div className="text-xs text-gray-300 mb-1" style={{ textShadow: '0 0 4px rgba(0,0,0,0.8)' }}>
          HP {Math.ceil(health)}/{maxHealth}
        </div>
        <div
          className="relative w-full rounded-full overflow-hidden"
          style={{ height: 10, background: 'rgba(255,0,0,0.3)', border: '1px solid rgba(255,255,255,0.2)' }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-200"
            style={{
              width: `${healthPercent}%`,
              background: healthPercent > 50
                ? `linear-gradient(90deg, #39ff14, #00ff88)`
                : healthPercent > 25
                  ? `linear-gradient(90deg, #e4ff1a, #ff6b1a)`
                  : `linear-gradient(90deg, #ff2d6a, #ff0044)`,
              boxShadow: `0 0 8px ${healthPercent > 50 ? '#39ff14' : healthPercent > 25 ? '#ff6b1a' : '#ff2d6a'}`,
            }}
          />
        </div>
      </div>

      {/* XP Bar - Bottom Center */}
      <div
        className="absolute bottom-4 left-1/2"
        style={{ transform: 'translateX(-50%)', width: 240 }}
      >
        <div className="text-xs text-center text-gray-300 mb-1" style={{ textShadow: '0 0 4px rgba(0,0,0,0.8)' }}>
          LV {level} &mdash; {Math.floor(experience)}/{experienceToLevel} XP
        </div>
        <div
          className="relative w-full rounded-full overflow-hidden"
          style={{ height: 8, background: 'rgba(0,240,255,0.15)', border: '1px solid rgba(0,240,255,0.3)' }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-200"
            style={{
              width: `${xpPercent}%`,
              background: 'linear-gradient(90deg, #00f0ff, #00c8ff)',
              boxShadow: '0 0 8px rgba(0,240,255,0.6)',
            }}
          />
        </div>
      </div>

      {/* Weapons - Bottom Right */}
      <div className="absolute bottom-4 right-4 text-right">
        {weapons.map((w, i) => (
          <div
            key={i}
            className="text-xs text-gray-200 mb-0.5"
            style={{ textShadow: '0 0 4px rgba(0,0,0,0.8)' }}
          >
            <span className="mr-1">{WEAPON_ICONS[w.type] || '?'}</span>
            <span className="capitalize">{w.type}</span>
            <span className="text-gray-400 ml-1">Lv{w.level}</span>
          </div>
        ))}
      </div>

      {/* Wave Announcement - Center */}
      {showWaveAnnounce && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ opacity: waveAnnounceFade }}
        >
          <div
            className="text-5xl font-bold tracking-widest"
            style={{
              color: '#fff',
              textShadow: '0 0 20px rgba(0,240,255,0.8), 0 0 40px rgba(0,240,255,0.4)',
              transform: `scale(${1 + (1 - waveAnnounceFade) * 0.3})`,
            }}
          >
            WAVE {wave}
          </div>
        </div>
      )}

      {showEventAnnounce && activeEvent && (
        <div
          className="absolute inset-0 flex items-start justify-center pt-24"
          style={{ opacity: eventAnnounceFade }}
        >
          <div
            className="text-2xl font-bold tracking-[0.2em]"
            style={{
              color: activeEvent === 'surge' ? '#ff2d6a' : '#00f0ff',
              textShadow: activeEvent === 'surge'
                ? '0 0 14px rgba(255,45,106,0.7)'
                : '0 0 14px rgba(0,240,255,0.7)',
            }}
          >
            {activeEvent === 'surge' ? 'SURGE MODE' : 'MAGNET STORM'}
          </div>
        </div>
      )}
    </div>
  );
}
