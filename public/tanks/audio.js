// WebAudio synthesized sounds (no audio files). Starts after the first user interaction.

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

class Audio {
  constructor() {
    this.ctx = null;
    this.volume = Number(store.get('ssa-volume', '0.6'));
    if (!Number.isFinite(this.volume)) this.volume = 0.6;
    this.muted = store.get('ssa-muted', '0') === '1';
    this.ambient = null;
    this.theme = null;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.applyVolume();
      this.noiseBuf = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      if (this.theme) this.setAmbience(this.theme);
    } catch { this.ctx = null; }
  }

  applyVolume() {
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }
  setVolume(v) { this.volume = v; store.set('ssa-volume', String(v)); this.applyVolume(); }
  setMuted(m) { this.muted = m; store.set('ssa-muted', m ? '1' : '0'); this.applyVolume(); }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  get ok() { return !!this.ctx && !this.muted && this.ctx.state === 'running'; }

  env(gain, t, a, d, peak) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + a);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  tone(type, f0, f1, dur, peak = 0.3, delay = 0) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    this.env(g, t, 0.005, dur, peak);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  noise(dur, filterType, f0, f1, peak = 0.4, delay = 0, q = 1) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, 0.004, dur, peak);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  cannon() { this.tone('sine', 140, 40, 0.35, 0.6); this.noise(0.25, 'lowpass', 1800, 200, 0.5); }
  whistle(dur = 1) { this.tone('sine', 1800, 500, Math.min(2.5, dur), 0.05); }
  explosion(r = 30) {
    const k = Math.min(1, r / 150);
    this.noise(0.4 + k * 1.6, 'lowpass', 900 + k * 1500, 60, 0.35 + k * 0.45);
    this.tone('sine', 90 - k * 40, 30, 0.3 + k * 0.9, 0.5 + k * 0.3);
  }
  pop() { this.noise(0.12, 'bandpass', 2500, 900, 0.25, 0, 2); }
  crack() { this.noise(0.5, 'highpass', 4000, 800, 0.6); this.tone('square', 220, 60, 0.3, 0.15, 0.04); }
  zap() { this.tone('sawtooth', 1400, 180, 0.45, 0.18); this.tone('square', 900, 120, 0.4, 0.08, 0.02); }
  tick() { this.tone('square', 1200, 1200, 0.04, 0.08); }
  chime() { this.tone('sine', 880, 880, 0.25, 0.15); this.tone('sine', 1320, 1320, 0.35, 0.12, 0.09); }
  click() { this.tone('triangle', 600, 400, 0.05, 0.08); }
  dirt() { this.noise(0.35, 'lowpass', 500, 120, 0.4); }
  shield() { this.tone('sine', 300, 900, 0.5, 0.15); this.tone('sine', 450, 1350, 0.5, 0.08, 0.05); }
  freeze() { this.noise(0.6, 'highpass', 6000, 2000, 0.2); this.tone('sine', 1600, 2400, 0.4, 0.06); }
  teleport() { this.tone('sine', 200, 1600, 0.35, 0.15); this.tone('triangle', 1600, 200, 0.35, 0.08, 0.15); }
  rumble(dur = 2) { this.noise(dur, 'lowpass', 160, 60, 0.6); }
  move() { this.noise(0.25, 'lowpass', 300, 200, 0.15); }
  jingle() { [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.3, 0.18, i * 0.13)); this.tone('sine', 1047, 1047, 0.8, 0.12, 0.55); }
  sad() { [392, 349, 311].forEach((f, i) => this.tone('triangle', f, f * 0.98, 0.35, 0.14, i * 0.2)); }

  // Light looping background per theme: filtered noise wind + soft drone.
  setAmbience(theme) {
    this.theme = theme;
    if (!this.ctx) return;
    this.stopAmbience();
    const cfg = {
      hills: [500, 0.05, 110], dunes: [350, 0.08, 98], snow: [900, 0.06, 147], volcanic: [180, 0.09, 55], moon: [120, 0.03, 65], neon: [700, 0.03, 82],
    }[theme] || [400, 0.05, 100];
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cfg[0];
    const g = this.ctx.createGain(); g.gain.value = cfg[1];
    const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
    lfo.frequency.value = 0.12; lg.gain.value = cfg[0] * 0.4;
    lfo.connect(lg).connect(f.frequency);
    const o = this.ctx.createOscillator(), og = this.ctx.createGain();
    o.type = 'sine'; o.frequency.value = cfg[2]; og.gain.value = 0.015;
    src.connect(f).connect(g).connect(this.master);
    o.connect(og).connect(this.master);
    src.start(); lfo.start(); o.start();
    this.ambient = [src, lfo, o];
  }
  stopAmbience() {
    if (!this.ambient) return;
    for (const n of this.ambient) { try { n.stop(); } catch { /* already stopped */ } }
    this.ambient = null;
  }
}

export const audio = new Audio();
