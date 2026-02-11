// Web Audio API synthesizer for retro game sounds
// No audio files needed - all sounds are generated

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;
let prefsLoaded = false;

const MASTER_VOLUME = 0.3;
const MUTE_STORAGE_KEY = 'neon-survivors-muted';

let musicInterval: number | null = null;
let musicNextStepTime = 0;
let musicStep = 0;
let activeMusicTrack: MatchTrack | null = null;

interface MatchTrack {
  name: string;
  tempo: number;
  bass: Array<number | null>;
  lead: Array<number | null>;
  pad: Array<number | null>;
  kick: boolean[];
  snare: boolean[];
  hat: boolean[];
}

const MATCH_TRACKS: MatchTrack[] = [
  {
    name: 'Neon Grid Runner',
    tempo: 142,
    bass: [40, null, 40, null, 43, null, 45, null, 40, null, 40, null, 47, null, 45, null],
    lead: [76, null, 79, 83, null, 79, 76, null, 74, null, 76, 79, null, 76, 74, null],
    pad: [52, null, null, null, 55, null, null, null, 52, null, null, null, 57, null, null, null],
    kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    snare: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
    hat: [true, true, false, true, true, true, false, true, true, true, false, true, true, true, false, true],
  },
  {
    name: 'Chrome Alley',
    tempo: 136,
    bass: [38, null, 38, null, 41, null, 43, null, 45, null, 43, null, 41, null, 38, null],
    lead: [72, 74, null, 76, 77, null, 79, 77, 76, null, 74, 72, null, 71, 72, null],
    pad: [50, null, null, null, 53, null, null, null, 55, null, null, null, 53, null, null, null],
    kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    snare: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
    hat: [true, false, true, false, true, true, true, false, true, false, true, false, true, true, true, false],
  },
  {
    name: 'Data Rain',
    tempo: 148,
    bass: [36, null, 36, null, 39, null, 41, null, 43, null, 41, null, 39, null, 36, null],
    lead: [79, null, 81, 79, 76, null, 74, 76, 79, null, 81, 83, 81, null, 79, 76],
    pad: [48, null, null, null, 51, null, null, null, 53, null, null, null, 51, null, null, null],
    kick: [true, false, false, true, true, false, false, false, true, false, false, true, true, false, false, false],
    snare: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
    hat: [true, true, true, true, true, true, false, true, true, true, true, true, true, true, false, true],
  },
  {
    name: 'Night Circuit',
    tempo: 132,
    bass: [33, null, 33, null, 36, null, 38, null, 41, null, 38, null, 36, null, 33, null],
    lead: [69, null, 72, 74, 76, null, 74, 72, 69, null, 72, 74, 76, null, 77, 74],
    pad: [45, null, null, null, 48, null, null, null, 50, null, null, null, 48, null, null, null],
    kick: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
    snare: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
    hat: [true, true, false, true, true, false, true, true, true, true, false, true, true, false, true, true],
  },
  {
    name: 'Synth Siege',
    tempo: 154,
    bass: [40, null, 43, null, 47, null, 43, null, 40, null, 45, null, 47, null, 43, null],
    lead: [84, 83, 81, null, 79, 81, 83, null, 84, 83, 81, null, 79, 76, 79, null],
    pad: [52, null, null, null, 55, null, null, null, 59, null, null, null, 55, null, null, null],
    kick: [true, false, false, true, true, false, false, false, true, false, false, true, true, false, false, false],
    snare: [false, false, true, false, false, false, true, false, false, false, true, false, false, false, true, false],
    hat: [true, true, true, false, true, true, true, false, true, true, true, false, true, true, true, false],
  },
];

function loadMutePreference() {
  if (prefsLoaded || typeof window === 'undefined') return;
  prefsLoaded = true;
  try {
    muted = window.localStorage.getItem(MUTE_STORAGE_KEY) === 'true';
  } catch {
    // Ignore storage errors and keep in-memory default
  }
}

function persistMutePreference() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, String(muted));
  } catch {
    // Ignore storage errors
  }
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  loadMutePreference();

  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      masterGain = audioContext.createGain();
      masterGain.gain.value = muted ? 0 : MASTER_VOLUME;
      masterGain.connect(audioContext.destination);
    } catch (e) {
      console.warn('Web Audio not supported');
      return null;
    }
  }
  
  // Resume if suspended (browser autoplay policy)
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  
  return audioContext;
}

export function setMuted(value: boolean) {
  loadMutePreference();
  muted = value;
  persistMutePreference();
  if (masterGain) {
    masterGain.gain.setTargetAtTime(value ? 0 : MASTER_VOLUME, audioContext?.currentTime || 0, 0.01);
  }
}

export function isMuted(): boolean {
  loadMutePreference();
  return muted;
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function scheduleTone(time: number, frequency: number, duration: number, gainValue: number, type: OscillatorType, detuneCents = 0) {
  const ctx = getAudioContext();
  if (!ctx || !masterGain || muted) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, time);
  if (detuneCents !== 0) osc.detune.value = detuneCents;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.linearRampToValueAtTime(gainValue, time + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(time);
  osc.stop(time + duration);
}

function scheduleKick(time: number) {
  const ctx = getAudioContext();
  if (!ctx || !masterGain || muted) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(160, time);
  osc.frequency.exponentialRampToValueAtTime(45, time + 0.12);
  gain.gain.setValueAtTime(0.35, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(time);
  osc.stop(time + 0.12);
}

function scheduleNoiseHit(time: number, duration: number, gainAmount: number, highpass = 0) {
  const ctx = getAudioContext();
  if (!ctx || !masterGain || muted) return;

  const sampleCount = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) {
    channel[i] = Math.random() * 2 - 1;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = highpass > 0 ? 'highpass' : 'bandpass';
  filter.frequency.value = highpass > 0 ? highpass : 1800;
  filter.Q.value = 0.7;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainAmount, time);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain);

  source.start(time);
  source.stop(time + duration);
}

function scheduleMusicStep(track: MatchTrack, step: number, stepTime: number, stepDuration: number) {
  const bassNote = track.bass[step % track.bass.length];
  if (bassNote !== null) {
    scheduleTone(stepTime, midiToHz(bassNote), stepDuration * 0.95, 0.12, 'square');
  }

  const leadNote = track.lead[step % track.lead.length];
  if (leadNote !== null) {
    scheduleTone(stepTime + stepDuration * 0.04, midiToHz(leadNote), stepDuration * 0.6, 0.08, 'triangle', step % 2 === 0 ? 4 : -4);
  }

  const padNote = track.pad[step % track.pad.length];
  if (padNote !== null) {
    scheduleTone(stepTime, midiToHz(padNote), stepDuration * 2.5, 0.045, 'sawtooth');
  }

  if (track.kick[step % track.kick.length]) {
    scheduleKick(stepTime);
  }
  if (track.snare[step % track.snare.length]) {
    scheduleNoiseHit(stepTime, 0.09, 0.11);
  }
  if (track.hat[step % track.hat.length]) {
    scheduleNoiseHit(stepTime, 0.03, 0.045, 4500);
  }
}

function stopMusicScheduler() {
  if (musicInterval !== null && typeof window !== 'undefined') {
    window.clearInterval(musicInterval);
    musicInterval = null;
  }
  activeMusicTrack = null;
}

export function startMatchMusic() {
  const ctx = getAudioContext();
  if (!ctx) return;

  stopMusicScheduler();

  activeMusicTrack = MATCH_TRACKS[Math.floor(Math.random() * MATCH_TRACKS.length)];
  musicStep = 0;
  musicNextStepTime = ctx.currentTime + 0.02;

  const scheduleAheadSeconds = 0.12;
  musicInterval = window.setInterval(() => {
    if (!activeMusicTrack) return;
    const stepDuration = 60 / activeMusicTrack.tempo / 2;

    while (musicNextStepTime < ctx.currentTime + scheduleAheadSeconds) {
      scheduleMusicStep(activeMusicTrack, musicStep, musicNextStepTime, stepDuration);
      musicNextStepTime += stepDuration;
      musicStep = (musicStep + 1) % 16;
    }
  }, 25);
}

export function stopMatchMusic() {
  stopMusicScheduler();
}

// Shoot sound - quick high-pitched blip
export function playShoot() {
  const ctx = getAudioContext();
  if (!ctx || !masterGain || muted) return;
  
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.type = 'square';
  osc.frequency.setValueAtTime(880, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.05);
  
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
  
  osc.connect(gain);
  gain.connect(masterGain);
  
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.05);
}

// Hit sound - quick noise burst
export function playHit() {
  const ctx = getAudioContext();
  if (!ctx || !masterGain || muted) return;
  
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.08);
  
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
  
  osc.connect(gain);
  gain.connect(masterGain);
  
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.08);
}

// Explosion sound - low rumble with noise
export function playExplosion() {
  const ctx = getAudioContext();
  if (!ctx || !masterGain || muted) return;
  
  // Noise for explosion texture
  const bufferSize = ctx.sampleRate * 0.2;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.3, ctx.currentTime);
  noiseGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
  
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1000, ctx.currentTime);
  filter.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.2);
  
  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(masterGain);
  
  noise.start(ctx.currentTime);
  noise.stop(ctx.currentTime + 0.2);
  
  // Bass thump
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.15);
  
  oscGain.gain.setValueAtTime(0.4, ctx.currentTime);
  oscGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
  
  osc.connect(oscGain);
  oscGain.connect(masterGain);
  
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.15);
}

// Pickup sound - cheerful ascending tone
export function playPickup() {
  const ctx = getAudioContext();
  if (!ctx || !masterGain || muted) return;
  
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(400, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.1);
  
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
  
  osc.connect(gain);
  gain.connect(masterGain);
  
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.1);
}

// Level up sound - triumphant arpeggio
export function playLevelUp() {
  const ctx = getAudioContext();
  if (!ctx || !masterGain || muted) return;
  
  const master = masterGain; // Capture for closure
  const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
  
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'square';
    osc.frequency.value = freq;
    
    const startTime = ctx.currentTime + i * 0.08;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.15, startTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.2);
    
    osc.connect(gain);
    gain.connect(master);
    
    osc.start(startTime);
    osc.stop(startTime + 0.2);
  });
}

// Damage sound - low thud
export function playDamage() {
  const ctx = getAudioContext();
  if (!ctx || !masterGain || muted) return;
  
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(100, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.15);
  
  gain.gain.setValueAtTime(0.4, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
  
  osc.connect(gain);
  gain.connect(masterGain);
  
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.15);
}

// Game over sound - sad descending tone
export function playGameOver() {
  const ctx = getAudioContext();
  if (!ctx || !masterGain || muted) return;
  
  const master = masterGain; // Capture for closure
  const notes = [392, 349.23, 293.66, 261.63]; // G4, F4, D4, C4
  
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    
    const startTime = ctx.currentTime + i * 0.2;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.12, startTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.4);
    
    osc.connect(gain);
    gain.connect(master);
    
    osc.start(startTime);
    osc.stop(startTime + 0.4);
  });
}

// Wave complete sound
export function playWaveComplete() {
  const ctx = getAudioContext();
  if (!ctx || !masterGain || muted) return;
  
  const master = masterGain; // Capture for closure
  const notes = [523.25, 587.33, 659.25, 783.99]; // C5, D5, E5, G5
  
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'triangle';
    osc.frequency.value = freq;
    
    const startTime = ctx.currentTime + i * 0.06;
    gain.gain.setValueAtTime(0.15, startTime);
    gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.15);
    
    osc.connect(gain);
    gain.connect(master);
    
    osc.start(startTime);
    osc.stop(startTime + 0.15);
  });
}

function blip(type: OscillatorType, from: number, to: number, gainStart: number, duration: number) {
  const ctx = getAudioContext();
  if (!ctx || !masterGain || muted) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), ctx.currentTime + duration);
  gain.gain.setValueAtTime(gainStart, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
}

export function playWeaponFire(weaponType: string) {
  switch (weaponType) {
    case 'blaster':
      blip('square', 940, 510, 0.12, 0.045);
      break;
    case 'spread':
      blip('triangle', 620, 280, 0.12, 0.06);
      break;
    case 'laser':
      blip('sawtooth', 1300, 650, 0.08, 0.03);
      break;
    case 'orbit':
      blip('sine', 360, 420, 0.06, 0.07);
      break;
    case 'missile':
      blip('sawtooth', 260, 120, 0.16, 0.11);
      break;
    default:
      playShoot();
  }
}

export function playWeaponImpact(weaponType: string) {
  switch (weaponType) {
    case 'blaster':
      blip('square', 420, 180, 0.11, 0.05);
      break;
    case 'spread':
      blip('triangle', 280, 120, 0.12, 0.07);
      break;
    case 'laser':
      blip('sawtooth', 900, 240, 0.1, 0.045);
      break;
    case 'orbit':
      blip('sine', 500, 220, 0.1, 0.06);
      break;
    case 'missile':
      playExplosion();
      break;
    default:
      playHit();
  }
}

export function playStreak(streak: number) {
  const ctx = getAudioContext();
  if (!ctx || !masterGain || muted) return;
  const master = masterGain;
  const base = streak >= 10 ? 622 : 523;
  [base, base * 1.25, base * 1.5].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + i * 0.05;
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.12, start);
    gain.gain.exponentialRampToValueAtTime(0.01, start + 0.14);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + 0.14);
  });
}

export function playNearMiss() {
  blip('sine', 260, 760, 0.09, 0.08);
}

export function playEventStart(eventType: string) {
  if (eventType === 'surge') {
    blip('sawtooth', 320, 120, 0.2, 0.16);
  } else {
    blip('sine', 220, 520, 0.16, 0.2);
  }
}
