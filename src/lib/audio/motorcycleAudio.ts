import type { AudioProfileType } from '@/lib/vehicles/types';

interface CombustionGrainConfig {
  // Firing event phase positions within a 720-degree (2-rev) 4-stroke cycle [0..1)
  firingPhases: number[];
  firingAmps: number[];
  // Exhaust pipe resonance modes: [freq Hz, decay s, gain]
  lowModes: [number, number, number][];
  highModes: [number, number, number][];
  clickGain: number;
  cycleBaseSec: number; // cycle duration at reference RPM
  refRpm: number;
  subGain: number;
}

const AUDIO_PROFILES: Record<AudioProfileType, CombustionGrainConfig> = {
  // Honda Super Cub C90: crisp airy single-cylinder 4-stroke putt-putt
  single_thumper: {
    firingPhases: [0.0],
    firingAmps: [1.0],
    lowModes: [[95, 0.032, 1.0], [215, 0.018, 0.55], [480, 0.009, 0.25], [960, 0.004, 0.12]],
    highModes: [[155, 0.020, 0.9], [340, 0.012, 0.65], [760, 0.006, 0.42], [1480, 0.003, 0.22]],
    clickGain: 0.32,
    cycleBaseSec: 0.085,
    refRpm: 1410,
    subGain: 0.42,
  },
  // Honda CG 125 OHV: mechanical pushrod rattle + punchy upright single thump
  classic_ohv: {
    firingPhases: [0.0],
    firingAmps: [1.0],
    lowModes: [[108, 0.028, 1.0], [240, 0.016, 0.62], [530, 0.009, 0.34], [1120, 0.004, 0.18]],
    highModes: [[175, 0.017, 0.95], [385, 0.011, 0.72], [850, 0.006, 0.48], [1680, 0.003, 0.28]],
    clickGain: 0.46,
    cycleBaseSec: 0.080,
    refRpm: 1500,
    subGain: 0.48,
  },
  // Harley Fat Boy / XYN Bobber: AUTHENTIC 45° V-Twin 315°/405° uneven firing ("potato-potato-potato"!)
  vtwin_45: {
    firingPhases: [0.0, 315 / 720],
    firingAmps: [1.0, 0.88],
    lowModes: [[62, 0.048, 1.15], [132, 0.030, 0.75], [295, 0.014, 0.38], [620, 0.007, 0.16]],
    highModes: [[95, 0.030, 1.05], [205, 0.018, 0.78], [460, 0.009, 0.45], [980, 0.004, 0.22]],
    clickGain: 0.28,
    cycleBaseSec: 0.120,
    refRpm: 1000,
    subGain: 0.72,
  },
  // Street Sport 650: High-revving Inline-4 (4 evenly spaced pulses with header asymmetry)
  inline4_sport: {
    firingPhases: [0.0, 0.251, 0.498, 0.752],
    firingAmps: [1.0, 0.90, 1.06, 0.87],
    lowModes: [[125, 0.024, 1.0], [270, 0.014, 0.65], [560, 0.008, 0.38], [1120, 0.004, 0.18]],
    highModes: [[195, 0.014, 0.95], [430, 0.009, 0.74], [910, 0.005, 0.52], [1850, 0.003, 0.34]],
    clickGain: 0.52,
    cycleBaseSec: 0.048,
    refRpm: 2500,
    subGain: 0.36,
  },
  // CVT scooter profile for user-imported vehicles: smooth compact single + subtle belt variator hum
  cvt_scooter: {
    firingPhases: [0.0],
    firingAmps: [0.95],
    lowModes: [[112, 0.024, 0.9], [250, 0.013, 0.48], [560, 0.007, 0.22], [1080, 0.003, 0.10]],
    highModes: [[180, 0.015, 0.85], [390, 0.009, 0.55], [820, 0.005, 0.30], [1500, 0.0025, 0.16]],
    clickGain: 0.22,
    cycleBaseSec: 0.075,
    refRpm: 1600,
    subGain: 0.28,
  },
};

export class MotorcycleAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private lowSrc: AudioBufferSourceNode | null = null;
  private highSrc: AudioBufferSourceNode | null = null;
  private lowGain: GainNode | null = null;
  private highGain: GainNode | null = null;
  private exhaustFilter: BiquadFilterNode | null = null;
  private shaper: WaveShaperNode | null = null;
  private engineBus: GainNode | null = null;

  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private scrubGain: GainNode | null = null;

  private hornOscA: OscillatorNode | null = null;
  private hornOscB: OscillatorNode | null = null;
  private hornGain: GainNode | null = null;

  private profile: AudioProfileType = 'single_thumper';
  private muted = false;
  private ready = false;

  public setMuted(m: boolean) {
    this.muted = m;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(m ? 0 : 0.42, this.ctx.currentTime, 0.04);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public ensure() {
    if (this.ready || typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.42;
      this.masterGain.connect(ctx.destination);

      // Engine bus -> soft waveshaper -> dynamic RPM lowpass -> master
      this.engineBus = ctx.createGain();
      this.engineBus.gain.value = 0;

      this.shaper = ctx.createWaveShaper();
      this.updateShaperCurve(1.8);

      this.exhaustFilter = ctx.createBiquadFilter();
      this.exhaustFilter.type = 'lowpass';
      this.exhaustFilter.frequency.value = 950;
      this.exhaustFilter.Q.value = 1.4;

      this.lowGain = ctx.createGain();
      this.highGain = ctx.createGain();
      this.lowGain.gain.value = 0.8;
      this.highGain.gain.value = 0.0;

      this.lowGain.connect(this.shaper);
      this.highGain.connect(this.shaper);
      this.shaper.connect(this.exhaustFilter);
      this.exhaustFilter.connect(this.engineBus);
      this.engineBus.connect(this.masterGain);

      // Looped noise bed for wind rush + tire scrub
      const nLen = ctx.sampleRate * 2;
      const nBuf = ctx.createBuffer(1, nLen, ctx.sampleRate);
      const nd = nBuf.getChannelData(0);
      for (let i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
      const nSrc = ctx.createBufferSource();
      nSrc.buffer = nBuf;
      nSrc.loop = true;

      this.windFilter = ctx.createBiquadFilter();
      this.windFilter.type = 'bandpass';
      this.windFilter.frequency.value = 340;
      this.windFilter.Q.value = 0.7;
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0;
      nSrc.connect(this.windFilter);
      this.windFilter.connect(this.windGain);
      this.windGain.connect(this.masterGain);

      const scrubFilter = ctx.createBiquadFilter();
      scrubFilter.type = 'bandpass';
      scrubFilter.frequency.value = 820;
      scrubFilter.Q.value = 1.8;
      this.scrubGain = ctx.createGain();
      this.scrubGain.gain.value = 0;
      nSrc.connect(scrubFilter);
      scrubFilter.connect(this.scrubGain);
      this.scrubGain.connect(this.masterGain);
      nSrc.start();

      // Horn dual-tone oscillator (stays silent until triggered)
      this.hornGain = ctx.createGain();
      this.hornGain.gain.value = 0;
      const hornFilter = ctx.createBiquadFilter();
      hornFilter.type = 'bandpass';
      hornFilter.frequency.value = 1100;
      hornFilter.Q.value = 1.6;
      this.hornOscA = ctx.createOscillator();
      this.hornOscB = ctx.createOscillator();
      this.hornOscA.type = 'sawtooth';
      this.hornOscB.type = 'sawtooth';
      this.hornOscA.connect(hornFilter);
      this.hornOscB.connect(hornFilter);
      hornFilter.connect(this.hornGain);
      this.hornGain.connect(this.masterGain);
      this.hornOscA.start();
      this.hornOscB.start();

      this.ready = true;
      this.rebuildGrains();
    } catch {
      // Audio unavailable
    }
  }

  private updateShaperCurve(drive: number) {
    if (!this.shaper) return;
    const curve = new Float32Array(257);
    const norm = Math.tanh(drive);
    for (let i = 0; i < 257; i++) {
      const x = i / 128 - 1;
      curve[i] = Math.tanh(drive * x) / norm;
    }
    this.shaper.curve = curve;
  }

  public setProfile(profile: AudioProfileType) {
    const changed = this.profile !== profile;
    this.profile = profile;
    if (changed && this.ready) {
      this.rebuildGrains();
    }
  }

  private synthesizeGrain(cfg: CombustionGrainConfig, isHighBank: boolean): AudioBuffer {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const cycle = Math.floor(sr * cfg.cycleBaseSec);
    const acc = new Float32Array(cycle * 3);
    const baseModes = isHighBank ? cfg.highModes : cfg.lowModes;

    const clickLen = Math.floor(sr * 0.0018);

    // Render 3 consecutive cycles and cut the middle cycle for a mathematically seamless loop!
    for (let c = 0; c < 3; c++) {
      for (let k = 0; k < cfg.firingPhases.length; k++) {
        const t0 = Math.floor((c + cfg.firingPhases[k]) * cycle);
        const amp = cfg.firingAmps[k];
        for (const [f, dec, gm] of baseModes) {
          const freq = f;
          const decayS = dec;
          const w = (2 * Math.PI * freq) / sr;
          const dRate = 1 / (decayS * sr);
          const n = Math.min(Math.floor(decayS * sr * 6), acc.length - t0);
          for (let i = 0; i < n; i++) {
            acc[t0 + i] += amp * gm * Math.exp(-i * dRate) * Math.sin(w * i);
          }
        }
        // Deterministic valve/combustion click
        let seed = (k + 1) * 48271;
        for (let i = 0; i < clickLen && t0 + i < acc.length; i++) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          const noise = (seed / 2147483648 - 1) * (1 - i / clickLen);
          acc[t0 + i] += amp * cfg.clickGain * noise;
        }
      }
    }

    const out = ctx.createBuffer(1, cycle, sr);
    const d = out.getChannelData(0);
    let mean = 0;
    for (let i = 0; i < cycle; i++) {
      d[i] = Math.tanh(acc[cycle + i] * 1.5);
      mean += d[i];
    }
    mean /= cycle;
    let peak = 0;
    for (let i = 0; i < cycle; i++) {
      d[i] -= mean;
      peak = Math.max(peak, Math.abs(d[i]));
    }
    const scale = 0.88 / (peak || 1);
    for (let i = 0; i < cycle; i++) d[i] *= scale;
    return out;
  }

  private rebuildGrains() {
    if (!this.ctx || !this.lowGain || !this.highGain) return;
    try { this.lowSrc?.stop(); } catch { /* noop */ }
    try { this.highSrc?.stop(); } catch { /* noop */ }

    const cfg = AUDIO_PROFILES[this.profile] || AUDIO_PROFILES.single_thumper;
    this.updateShaperCurve(1.6);

    const lowBuf = this.synthesizeGrain(cfg, false);
    const highBuf = this.synthesizeGrain(cfg, true);

    this.lowSrc = this.ctx.createBufferSource();
    this.lowSrc.buffer = lowBuf;
    this.lowSrc.loop = true;
    this.lowSrc.connect(this.lowGain);
    this.lowSrc.start();

    this.highSrc = this.ctx.createBufferSource();
    this.highSrc.buffer = highBuf;
    this.highSrc.loop = true;
    this.highSrc.connect(this.highGain);
    this.highSrc.start();

    // Tune horn frequency to bike class (deep dual-tone cruiser vs crisp Japanese moped beep!)
    if (this.hornOscA && this.hornOscB) {
      if (this.profile === 'vtwin_45') {
        this.hornOscA.frequency.value = 340;
        this.hornOscB.frequency.value = 428;
      } else if (this.profile === 'inline4_sport') {
        this.hornOscA.frequency.value = 440;
        this.hornOscB.frequency.value = 554;
      } else {
        this.hornOscA.frequency.value = 510;
        this.hornOscB.frequency.value = 515;
      }
    }
  }

  public update(params: {
    engineRunning: boolean;
    rpm: number;
    redlineRpm: number;
    throttle: number;
    speedKmh: number;
    slipRatio: number;
    hornActive: boolean;
    shiftCut?: boolean;
  }) {
    if (!this.ready || !this.ctx || !this.engineBus || !this.lowSrc || !this.highSrc || !this.lowGain || !this.highGain || !this.exhaustFilter) {
      return;
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    const t = this.ctx.currentTime;
    const cfg = AUDIO_PROFILES[this.profile] || AUDIO_PROFILES.single_thumper;

    if (!params.engineRunning || params.rpm < 150) {
      this.engineBus.gain.setTargetAtTime(0, t, 0.08);
    } else {
      const rate = Math.max(0.45, Math.min(6.5, params.rpm / cfg.refRpm));
      // Subtle combustion jitter keeps idle organic and alive
      const flutter = 1 + (Math.sin(t * 27) * 0.008);
      this.lowSrc.playbackRate.setTargetAtTime(rate * flutter, t, 0.03);
      this.highSrc.playbackRate.setTargetAtTime(rate * flutter, t, 0.03);

      const rpmNorm = Math.max(0, Math.min(1, params.rpm / params.redlineRpm));
      // Equal-power crossfade between boomy low-RPM bank and snappy high-RPM bank
      const lowW = Math.cos(rpmNorm * Math.PI * 0.5);
      const highW = Math.sin(rpmNorm * Math.PI * 0.5);
      this.lowGain.gain.setTargetAtTime(lowW * 0.9, t, 0.04);
      this.highGain.gain.setTargetAtTime(highW * 0.95, t, 0.04);

      // Engine resonance filter follows RPM and throttle.
      const cutoff = 380 + rpmNorm * 1850 + params.throttle * 1150;
      this.exhaustFilter.frequency.setTargetAtTime(Math.min(5500, cutoff), t, 0.04);

      const baseVol = (0.24 + params.throttle * 0.28 + rpmNorm * 0.22) * 0.9;
      const vol = params.shiftCut ? baseVol * 0.2 : baseVol;
      this.engineBus.gain.setTargetAtTime(vol, t, 0.03);

    }

    // Wind rush scales with speed^2
    if (this.windGain && this.windFilter) {
      const vNorm = Math.min(1, params.speedKmh / 180);
      this.windGain.gain.setTargetAtTime(vNorm * vNorm * 0.22, t, 0.08);
      this.windFilter.frequency.setTargetAtTime(240 + vNorm * 900, t, 0.08);
    }

    // Tire scrub / braking squeal
    if (this.scrubGain) {
      this.scrubGain.gain.setTargetAtTime(Math.min(0.28, params.slipRatio * 0.35), t, 0.04);
    }

    // Horn
    if (this.hornGain) {
      this.hornGain.gain.setTargetAtTime(params.hornActive ? 0.28 : 0, t, 0.015);
    }
  }

  public playIgnitionClick() {
    this.ensure();
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1400, t);
    osc.frequency.exponentialRampToValueAtTime(320, t + 0.035);
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.045);
  }

  public playStarterCrank(isKickstart = false) {
    this.ensure();
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    if (isKickstart) {
      // Mechanical ratchet zip + compression thump!
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.22);
      g.gain.setValueAtTime(0.35, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      osc.connect(g);
      g.connect(this.masterGain);
      osc.start(t);
      osc.stop(t + 0.28);
      return;
    }
    // Electric starter motor "whir-chug-whir-chug-VROOM!"
    const osc = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoG = this.ctx.createGain();
    const g = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(210, t);
    osc.frequency.linearRampToValueAtTime(260, t + 0.55);
    lfo.frequency.value = 6.5;
    lfoG.gain.value = 48;
    lfo.connect(lfoG);
    lfoG.connect(osc.frequency);
    g.gain.setValueAtTime(0.22, t);
    g.gain.setValueAtTime(0.24, t + 0.45);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.62);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.65);
    lfo.stop(t + 0.65);
  }

  public playShiftClunk() {
    this.ensure();
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, t);
    osc.frequency.exponentialRampToValueAtTime(75, t + 0.065);
    g.gain.setValueAtTime(0.28, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.075);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.08);
  }

  public playMechanicalLatch() {
    this.ensure();
    if (!this.ctx || !this.masterGain) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.055);
    g.gain.setValueAtTime(0.16, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.065);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.07);
  }

  public playSignalTick(high = true) {
    if (!this.ready || !this.ctx || !this.masterGain || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = high ? 1150 : 880;
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.018);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(t);
    osc.stop(t + 0.02);
  }

  public dispose() {
    try { this.lowSrc?.stop(); } catch { /* noop */ }
    try { this.highSrc?.stop(); } catch { /* noop */ }
    try { this.hornOscA?.stop(); } catch { /* noop */ }
    try { this.hornOscB?.stop(); } catch { /* noop */ }
    try { this.ctx?.close(); } catch { /* noop */ }
    this.ready = false;
  }
}
