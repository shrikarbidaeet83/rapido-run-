// WebAudio-only sounds, synthesized on the fly (no audio files).

let ctx = null, master = null, engineOsc = null, engineOsc2 = null, engineGain = null, noiseBuf = null;
// Sound is OFF unless the player turned it on (M) — quiet by default for office play.
let muted = true;
try { muted = localStorage.getItem('tr-sound') !== 'on'; } catch { /* storage blocked */ }

function ensure() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);

  engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  engineOsc = ctx.createOscillator();
  engineOsc.type = 'sawtooth';
  engineOsc2 = ctx.createOscillator();
  engineOsc2.type = 'square';
  engineOsc.connect(filter);
  engineOsc2.connect(filter);
  filter.connect(engineGain);
  engineGain.connect(master);
  engineOsc.start();
  engineOsc2.start();

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  return true;
}

export const audio = {
  get muted() { return muted; },

  // must be called from a user gesture (autoplay rules)
  unlock() {
    if (!ensure()) return;
    if (ctx.state === 'suspended') ctx.resume();
  },

  toggleMute() {
    muted = !muted;
    try { localStorage.setItem('tr-sound', muted ? 'off' : 'on'); } catch { /* ignore */ }
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02);
    return muted;
  },

  // speed01: 0..1, active: whether the engine should be heard at all
  engine(speed01, active) {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const f = 55 + speed01 * 150;
    engineOsc.frequency.setTargetAtTime(f, t, 0.05);
    engineOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    engineGain.gain.setTargetAtTime(active ? 0.05 + speed01 * 0.07 : 0, t, 0.08);
  },

  crash(volume) {
    if (!ctx || ctx.state !== 'running' || volume <= 0.02) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500 + volume * 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(1, volume) * 0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
    src.stop(t + 0.35);
  },

  boost() {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
    src.stop(t + 0.4);
  },

  beep(high = false) {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = high ? 880 : 440;
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (high ? 0.5 : 0.2));
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + 0.55);
  },

  fanfare() {
    if (!ctx || ctx.state !== 'running') return;
    const notes = [523, 659, 784, 1047, 784, 1047];
    const t0 = ctx.currentTime;
    notes.forEach((freq, i) => {
      const t = t0 + i * 0.13 + (i >= 4 ? 0.1 : 0);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (i === notes.length - 1 ? 0.7 : 0.2));
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.8);
    });
  },
};
