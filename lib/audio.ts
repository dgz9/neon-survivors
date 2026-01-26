// Web Audio API synthesizer for retro game sounds
// No audio files needed - all sounds are generated

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let muted = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      masterGain = audioContext.createGain();
      masterGain.gain.value = 0.3;
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
  muted = value;
  if (masterGain) {
    masterGain.gain.value = value ? 0 : 0.3;
  }
}

export function isMuted(): boolean {
  return muted;
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
    gain.connect(masterGain);
    
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
    gain.connect(masterGain);
    
    osc.start(startTime);
    osc.stop(startTime + 0.4);
  });
}

// Wave complete sound
export function playWaveComplete() {
  const ctx = getAudioContext();
  if (!ctx || !masterGain || muted) return;
  
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
    gain.connect(masterGain);
    
    osc.start(startTime);
    osc.stop(startTime + 0.15);
  });
}
