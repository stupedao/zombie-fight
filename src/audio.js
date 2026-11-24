/* ============================================================
   DEAD HOURS - Web Audio synthesized SFX
   Zero audio files: gunshots, groans, thunder, rain and wind are
   all built from oscillators, noise buffers and envelopes.
   ============================================================ */

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.ambient = null;
    this.heartTimer = 0;
    this.heartOn = false;
    this._noiseBuf = null;
  }

  /** must be called from a user gesture (Play click) */
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return; }
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 8;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    // shared white-noise buffer (2s)
    const len = this.ctx.sampleRate * 2;
    this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  _now() { return this.ctx ? this.ctx.currentTime : 0; }

  _noise({ dur = 0.3, type = 'lowpass', freq = 1000, q = 0.8, gain = 1, attack = 0.001, decay = null, pan = 0, playbackRate = 1 } = {}) {
    if (!this.ctx) return;
    const t = this._now();
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.playbackRate.value = playbackRate;
    const flt = this.ctx.createBiquadFilter();
    flt.type = type; flt.frequency.value = freq; flt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (decay || dur));
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(flt); flt.connect(g); g.connect(panner); panner.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.05);
    return { src, flt, g };
  }

  _osc({ type = 'sine', f0 = 200, f1 = null, dur = 0.2, gain = 0.5, pan = 0, attack = 0.002 } = {}) {
    if (!this.ctx) return;
    const t = this._now();
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== null) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    o.connect(g); g.connect(panner); panner.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
    return { o, g };
  }

  /* ---------------- weapons ---------------- */

  gunshot(kind = 'rifle', pan = 0) {
    if (!this.ctx) return;
    if (kind === 'pistol') {
      this._noise({ dur: 0.22, freq: 3400, q: 0.7, gain: 0.55, decay: 0.14, pan });
      this._noise({ dur: 0.32, type: 'lowpass', freq: 900, gain: 0.5, decay: 0.26, pan });
      this._osc({ type: 'sine', f0: 260, f1: 70, dur: 0.12, gain: 0.5, pan });
    } else if (kind === 'rifle') {
      this._noise({ dur: 0.16, freq: 4200, q: 0.6, gain: 0.6, decay: 0.09, pan });
      this._noise({ dur: 0.5, type: 'lowpass', freq: 700, gain: 0.62, decay: 0.42, pan });
      this._osc({ type: 'sine', f0: 190, f1: 55, dur: 0.16, gain: 0.62, pan });
      // mechanical action clack
      this._noise({ dur: 0.05, type: 'bandpass', freq: 2200, q: 6, gain: 0.18, attack: 0.06, pan });
    } else { // shotgun
      this._noise({ dur: 0.28, freq: 2600, q: 0.5, gain: 0.75, decay: 0.17, pan });
      this._noise({ dur: 0.8, type: 'lowpass', freq: 420, gain: 0.8, decay: 0.7, pan });
      this._osc({ type: 'sine', f0: 130, f1: 34, dur: 0.3, gain: 0.85, pan });
    }
  }

  reload() {
    if (!this.ctx) return;
    this._noise({ dur: 0.06, type: 'bandpass', freq: 1800, q: 5, gain: 0.3 });
    setTimeout(() => this._noise({ dur: 0.07, type: 'bandpass', freq: 1300, q: 5, gain: 0.32 }), 170);
    setTimeout(() => this._noise({ dur: 0.08, type: 'bandpass', freq: 2400, q: 5, gain: 0.38 }), 420);
  }

  empty() {
    this._noise({ dur: 0.05, type: 'bandpass', freq: 2900, q: 8, gain: 0.25 });
  }

  casing() {
    this._osc({ type: 'triangle', f0: 2400 + Math.random() * 900, f1: 1700, dur: 0.06, gain: 0.05, attack: 0.01 });
  }

  /* ---------------- zombies ---------------- */

  groan(dist = 10, pan = 0) {
    if (!this.ctx) return;
    const vol = Math.max(0.04, 1 - dist / 45) * 0.4;
    const t = this._now();
    const f0 = 70 + Math.random() * 55;
    const o1 = this.ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.setValueAtTime(f0, t);
    o1.frequency.linearRampToValueAtTime(f0 * (0.7 + Math.random() * 0.5), t + 1.1);
    const o2 = this.ctx.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.setValueAtTime(f0 * 1.03 + 3, t);
    o2.frequency.linearRampToValueAtTime(f0 * 0.8, t + 1.1);
    // vibrato wobble
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 4.5 + Math.random() * 3;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 9;
    lfo.connect(lfoG); lfoG.connect(o1.frequency); lfoG.connect(o2.frequency);
    // throaty formant filter + distortion
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 480; flt.Q.value = 4;
    const shaper = this.ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 2.6); }
    shaper.curve = curve;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.25);
    g.gain.setValueAtTime(vol, t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.35);
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    o1.connect(shaper); o2.connect(shaper);
    shaper.connect(flt); flt.connect(g); g.connect(panner); panner.connect(this.master);
    o1.start(t); o2.start(t); lfo.start(t);
    o1.stop(t + 1.5); o2.stop(t + 1.5); lfo.stop(t + 1.5);
  }

  snarl(dist = 6, pan = 0) {
    if (!this.ctx) return;
    const vol = Math.max(0.08, 1 - dist / 30) * 0.5;
    const t = this._now();
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.45);
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'bandpass'; flt.frequency.value = 700; flt.Q.value = 2.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    const panner = this.ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    o.connect(flt); flt.connect(g); g.connect(panner); panner.connect(this.master);
    o.start(t); o.stop(t + 0.55);
    this._noise({ dur: 0.4, type: 'bandpass', freq: 1100, q: 1.2, gain: vol * 0.5, decay: 0.35, pan });
  }

  hitFlesh(pan = 0) {
    this._noise({ dur: 0.18, type: 'lowpass', freq: 600, gain: 0.5, decay: 0.13, pan, playbackRate: 0.8 });
    this._osc({ type: 'sine', f0: 130, f1: 60, dur: 0.09, gain: 0.3, pan });
  }

  headshot(pan = 0) {
    this._osc({ type: 'sine', f0: 320, f1: 70, dur: 0.11, gain: 0.6, pan });
    this._noise({ dur: 0.25, type: 'lowpass', freq: 900, gain: 0.55, decay: 0.2, pan, playbackRate: 0.7 });
  }

  zombieDeath(dist = 8, pan = 0) {
    const vol = Math.max(0.05, 1 - dist / 40);
    this._osc({ type: 'sawtooth', f0: 120, f1: 35, dur: 0.8, gain: 0.25 * vol, pan });
    this._noise({ dur: 0.5, type: 'lowpass', freq: 500, gain: 0.3 * vol, decay: 0.45, pan, playbackRate: 0.6 });
  }

  /* ---------------- player ---------------- */

  footstep(sprint = false) {
    this._noise({
      dur: 0.09, type: 'lowpass', freq: 320 + Math.random() * 120,
      gain: sprint ? 0.16 : 0.1, decay: 0.07, playbackRate: 0.9 + Math.random() * 0.25,
    });
  }

  jump() { this._noise({ dur: 0.1, type: 'lowpass', freq: 400, gain: 0.12, decay: 0.08 }); }
  land() {
    this._noise({ dur: 0.16, type: 'lowpass', freq: 220, gain: 0.22, decay: 0.13 });
    this._osc({ type: 'sine', f0: 95, f1: 45, dur: 0.12, gain: 0.2 });
  }
  hurt() {
    this._noise({ dur: 0.25, type: 'lowpass', freq: 700, gain: 0.4, decay: 0.2 });
    this._osc({ type: 'sine', f0: 180, f1: 60, dur: 0.2, gain: 0.35 });
  }
  heartbeat() {
    this._osc({ type: 'sine', f0: 55, f1: 40, dur: 0.1, gain: 0.5 });
    setTimeout(() => this._osc({ type: 'sine', f0: 50, f1: 35, dur: 0.08, gain: 0.32 }), 170);
  }

  /* ---------------- pickups & UI ---------------- */

  pickupHealth() {
    this._osc({ type: 'sine', f0: 660, f1: 880, dur: 0.12, gain: 0.25 });
    setTimeout(() => this._osc({ type: 'sine', f0: 880, f1: 1100, dur: 0.14, gain: 0.2 }), 90);
  }
  pickupAmmo() {
    this._noise({ dur: 0.08, type: 'bandpass', freq: 1600, q: 4, gain: 0.3 });
    setTimeout(() => this._noise({ dur: 0.08, type: 'bandpass', freq: 1100, q: 4, gain: 0.3 }), 100);
  }
  pickupBoost() {
    if (!this.ctx) return;
    const t = this._now();
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.45);
  }
  click() { this._noise({ dur: 0.03, type: 'bandpass', freq: 2400, q: 6, gain: 0.15 }); }

  waveHorn() {
    if (!this.ctx) return;
    const t = this._now();
    for (const det of [0, -4, 7]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 62 * Math.pow(2, det / 1200);
      o.detune.value = det * 10;
      const flt = this.ctx.createBiquadFilter();
      flt.type = 'lowpass'; flt.frequency.setValueAtTime(200, t);
      flt.frequency.linearRampToValueAtTime(900, t + 0.9);
      flt.frequency.linearRampToValueAtTime(150, t + 1.6);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
      o.connect(flt); flt.connect(g); g.connect(this.master);
      o.start(t); o.stop(t + 1.8);
    }
  }

  waveClear() {
    this._osc({ type: 'sine', f0: 520, f1: 520, dur: 0.2, gain: 0.18 });
    setTimeout(() => this._osc({ type: 'sine', f0: 660, f1: 660, dur: 0.2, gain: 0.18 }), 150);
    setTimeout(() => this._osc({ type: 'sine', f0: 780, f1: 780, dur: 0.3, gain: 0.2 }), 300);
  }

  thunder(delay = 1, vol = 0.5) {
    if (!this.ctx) return;
    setTimeout(() => {
      const t = this._now();
      // brown-ish rumble
      const len = this.ctx.sampleRate * 2.6;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const flt = this.ctx.createBiquadFilter();
      flt.type = 'lowpass'; flt.frequency.value = 240;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.12);
      g.gain.setValueAtTime(vol, t + 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      src.connect(flt); flt.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + 2.6);
      this._osc({ type: 'sine', f0: 42, f1: 28, dur: 1.4, gain: vol * 0.8 });
    }, delay * 1000);
  }

  /* ---------------- ambient bed ---------------- */

  startAmbient() {
    if (!this.ctx || this.ambient) return;
    const t = this._now();
    // wind: looped filtered noise with slow LFO
    const wind = this.ctx.createBufferSource();
    wind.buffer = this._noiseBuf; wind.loop = true;
    const windF = this.ctx.createBiquadFilter();
    windF.type = 'bandpass'; windF.frequency.value = 380; windF.Q.value = 0.6;
    const windG = this.ctx.createGain();
    windG.gain.value = 0.05;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoG = this.ctx.createGain();
    lfoG.gain.value = 0.035;
    lfo.connect(lfoG); lfoG.connect(windG.gain);
    // rain: highpassed noise
    const rain = this.ctx.createBufferSource();
    rain.buffer = this._noiseBuf; rain.loop = true; rain.playbackRate.value = 1.7;
    const rainF = this.ctx.createBiquadFilter();
    rainF.type = 'highpass'; rainF.frequency.value = 2600;
    const rainG = this.ctx.createGain();
    rainG.gain.value = 0.045;
    wind.connect(windF); windF.connect(windG); windG.connect(this.master);
    rain.connect(rainF); rainF.connect(rainG); rainG.connect(this.master);
    wind.start(t); rain.start(t); lfo.start(t);
    this.ambient = { wind, rain, lfo, rainG };
  }

  stopAmbient() {
    if (!this.ambient) return;
    const t = this._now();
    try {
      this.ambient.wind.stop(t);
      this.ambient.rain.stop(t);
      this.ambient.lfo.stop(t);
    } catch (e) { /* already stopped */ }
    this.ambient = null;
  }

  /** call every sim step - heartbeat when hp is low */
  tick(dt, hp, maxHp) {
    if (!this.ctx || hp <= 0) return;
    const want = hp < maxHp * 0.35;
    if (want) {
      this.heartTimer -= dt;
      const rate = hp < maxHp * 0.18 ? 0.75 : 1.0;
      if (this.heartTimer <= 0) {
        this.heartbeat();
        this.heartTimer = rate;
      }
    } else {
      this.heartTimer = 0;
    }
  }
}
