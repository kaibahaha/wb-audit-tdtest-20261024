/* ===========================================================
   蓝冰猎影：宇宙幽灵  —  程序化动态音效引擎
   无任何外部音频资源，全部由 Web Audio API 实时合成。
   设计意图：冰下 1450 米的「水下 / 低频 / 空灵」空间感，
   并让音效随波次紧张度、BOSS 心跳、合成等级动态变化。
   =========================================================== */
(function () {
  'use strict';

  class IceAudio {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.wet = null;
      this.muted = false;
      this.ready = false;
      this.intensity = 0;      // 0..1，随波次上升
      this.bossMode = false;
      this._pad = [];
      this._heartTime = 0;
      this._lastShot = 0;
    }

    /** 必须在用户手势中调用（浏览器自动播放策略） */
    init() {
      if (this.ctx) { this.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        this.ctx = new AC();
        const c = this.ctx;
        this.master = c.createGain();
        this.master.gain.value = this.muted ? 0 : 0.52;

        // 总线压缩，避免叠加爆音
        const comp = c.createDynamicsCompressor();
        comp.threshold.value = -18; comp.knee.value = 22;
        comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.22;
        this.master.connect(comp); comp.connect(c.destination);

        // 程序生成的短混响（冰洞空间感）
        const conv = c.createConvolver();
        conv.buffer = this._makeIR(1.15, 2.6);
        this.wet = c.createGain(); this.wet.gain.value = 0.22;
        conv.connect(this.wet); this.wet.connect(this.master);
        this.reverbIn = conv;

        this._startPad();
        this.ready = true;
      } catch (e) { this.ctx = null; }
    }

    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); }

    setMuted(m) {
      this.muted = m;
      if (this.master && this.ctx)
        this.master.gain.setTargetAtTime(m ? 0 : 0.52, this.ctx.currentTime, 0.05);
    }

    /** 生成衰减噪声脉冲响应 */
    _makeIR(dur, decay) {
      const c = this.ctx, len = Math.floor(c.sampleRate * dur);
      const buf = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const t = i / len;
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.35);
        }
      }
      return buf;
    }

    _noiseBuffer(dur) {
      const c = this.ctx, len = Math.max(1, Math.floor(c.sampleRate * dur));
      const b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return b;
    }

    /** 单个带包络的振荡器音 */
    tone(o) {
      if (!this.ready || this.muted) return;
      const c = this.ctx, t0 = c.currentTime + (o.delay || 0);
      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.freq, t0);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + (o.dur || .2));
      if (o.detune) osc.detune.value = o.detune;

      let node = osc;
      if (o.filter) {
        const f = c.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = o.filter; f.Q.value = o.q || 0.8;
        node.connect(f); node = f;
      }
      const peak = (o.gain === undefined ? 0.16 : o.gain);
      const a = o.attack === undefined ? 0.008 : o.attack;
      const d = o.dur || 0.22;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + a);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
      node.connect(g);
      g.connect(this.master);
      if (o.reverb !== false && this.reverbIn) {
        const rg = c.createGain(); rg.gain.value = o.reverb === undefined ? 0.5 : o.reverb;
        g.connect(rg); rg.connect(this.reverbIn);
      }
      osc.start(t0); osc.stop(t0 + d + 0.05);
    }

    /** 带滤波的噪声（命中 / 爆炸 / 冲击） */
    noise(o) {
      if (!this.ready || this.muted) return;
      const c = this.ctx, t0 = c.currentTime + (o.delay || 0);
      const src = c.createBufferSource(); src.buffer = this._noiseBuffer((o.dur || .18) + .02);
      const f = c.createBiquadFilter();
      f.type = o.hp ? 'highpass' : 'bandpass';
      f.frequency.setValueAtTime(o.freq || 900, t0);
      if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(60, o.to), t0 + (o.dur || .18));
      f.Q.value = o.q || 0.7;
      const g = c.createGain(), d = o.dur || .18;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(.0002, o.gain || .12), t0 + .006);
      g.gain.exponentialRampToValueAtTime(.0001, t0 + d);
      src.connect(f); f.connect(g); g.connect(this.master);
      if (this.reverbIn && o.reverb !== false) {
        const rg = c.createGain(); rg.gain.value = .35; g.connect(rg); rg.connect(this.reverbIn);
      }
      src.start(t0); src.stop(t0 + d + .03);
    }

    /** 持续低音环境层：冰下嗡鸣 + 缓慢起伏 */
    _startPad() {
      const c = this.ctx, t = c.currentTime;
      const base = [55, 82.41, 110.0, 164.81];
      const g = c.createGain(); g.gain.value = 0.0;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420; f.Q.value = .5;
      g.connect(f); f.connect(this.master);
      if (this.reverbIn) { const rg = c.createGain(); rg.gain.value = .3; f.connect(rg); rg.connect(this.reverbIn); }
      g.gain.setTargetAtTime(.045, t, 1.4);

      base.forEach((hz, i) => {
        const o = c.createOscillator();
        o.type = i === 3 ? 'sine' : 'triangle';
        o.frequency.value = hz; o.detune.value = (i - 1.5) * 6;
        const og = c.createGain(); og.gain.value = [0.5, 0.24, 0.15, 0.07][i];
        const lfo = c.createOscillator(), lg = c.createGain();
        lfo.frequency.value = 0.055 + i * 0.021; lg.gain.value = 0.09 + i * 0.015;
        lfo.connect(lg); lg.connect(og.gain);
        o.connect(og); og.connect(g);
        o.start(t); lfo.start(t);
        this._pad.push(o, lfo);
      });
      this._padGain = g;
      this._padFilter = f;
    }

    /** 随波次 / BOSS 动态改变环境层，uddates from main loop */
    setIntensity(v, boss) {
      if (!this.ready) return;
      this.intensity = v; this.bossMode = !!boss;
      const c = this.ctx, t = c.currentTime;
      this._padGain.gain.setTargetAtTime(boss ? .085 : .045 + v * .022, t, 1.1);
      this._padFilter.frequency.setTargetAtTime(boss ? 260 : 420 + v * 220, t, 1.1);
    }

    /** BOSS 心跳，由主循环节流调用 */
    heartbeat() {
      if (!this.ready || this.muted || !this.bossMode) return;
      const t = this.ctx.currentTime;
      if (t - this._heartTime < 0.85) return;
      this._heartTime = t;
      this.tone({ freq: 62, to: 38, dur: .22, type: 'sine', gain: .26, filter: 180, reverb: .25 });
      this.tone({ freq: 58, to: 34, dur: .26, type: 'sine', gain: .18, filter: 150, delay: .19, reverb: .25 });
    }

    // ---------------- 具体事件音 ----------------
    click()   { this.tone({ freq: 880, to: 1180, dur: .07, type: 'sine', gain: .09, reverb: .2 }); }
    error()   { this.tone({ freq: 210, to: 130, dur: .18, type: 'triangle', gain: .11, filter: 700 }); }

    deploy() {
      this.tone({ freq: 420, to: 960, dur: .20, type: 'sine', gain: .18, filter: 2600 });
      this.tone({ freq: 1260, to: 1780, dur: .28, type: 'sine', gain: .09, delay: .055, reverb: .8 });
      this.noise({ freq: 2400, to: 900, dur: .13, gain: .05, hp: true });
    }

    merge(level) {
      const root = 330 * Math.pow(1.16, Math.min(5, level));
      [0, 4, 7, 12].forEach((semi, i) => {
        this.tone({ freq: root * Math.pow(2, semi / 12), dur: .34 + i * .05, type: 'sine',
          gain: .13 - i * .012, delay: i * .062, reverb: .8 });
      });
      this.tone({ freq: root / 2, to: root, dur: .5, type: 'triangle', gain: .09, filter: 1500 });
      this.noise({ freq: 3200, to: 700, dur: .3, gain: .07, hp: true, delay: .04 });
    }

    shoot(kind) {
      // 限流，避免多塔齐射造成音墙
      const now = this.ctx ? this.ctx.currentTime : 0;
      if (now - this._lastShot < 0.045) return;
      this._lastShot = now;
      switch (kind) {
        case 'dom':        this.tone({ freq: 1080, to: 520, dur: .085, type: 'sine', gain: .055, reverb: .18 }); break;
        case 'cascade':    this.tone({ freq: 260, to: 90, dur: .20, type: 'triangle', gain: .09, filter: 900 });
                           this.noise({ freq: 1500, to: 320, dur: .16, gain: .045 }); break;
        case 'track':      this.tone({ freq: 1500, to: 260, dur: .16, type: 'sawtooth', gain: .045, filter: 2200, reverb: .3 }); break;
        case 'coincidence':this.tone({ freq: 700, to: 940, dur: .10, type: 'sine', gain: .05 });
                           this.tone({ freq: 1050, to: 1410, dur: .10, type: 'sine', gain: .04, delay: .06, reverb: .4 }); break;
        default:           this.tone({ freq: 900, to: 600, dur: .08, type: 'sine', gain: .045, reverb: .15 });
      }
    }

    hit()  { this.noise({ freq: 1700, to: 620, dur: .055, gain: .035, hp: true, reverb: false }); }
    kill() { this.noise({ freq: 1100, to: 180, dur: .17, gain: .075 }); 
             this.tone({ freq: 320, to: 120, dur: .16, type: 'sine', gain: .055, filter: 800 }); }

    leak() {
      this.tone({ freq: 150, to: 62, dur: .42, type: 'sawtooth', gain: .16, filter: 480 });
      this.noise({ freq: 420, to: 90, dur: .38, gain: .11 });
    }

    waveStart(n) {
      this.tone({ freq: 190 + n * 5, to: 150 + n * 5, dur: .30, type: 'triangle', gain: .13, filter: 700 });
      this.tone({ freq: 190 + n * 5, to: 150 + n * 5, dur: .30, type: 'triangle', gain: .11, filter: 700, delay: .34 });
      this.noise({ freq: 300, to: 120, dur: .5, gain: .05, delay: .1 });
    }

    waveClear() {
      [523, 659, 784].forEach((f, i) => this.tone({ freq: f, dur: .30, type: 'sine', gain: .10, delay: i * .09, reverb: .7 }));
    }

    boss() {
      this.tone({ freq: 92, to: 34, dur: 1.7, type: 'sawtooth', gain: .20, filter: 300 });
      this.tone({ freq: 138, to: 55, dur: 1.5, type: 'sine', gain: .13, filter: 400, delay: .12 });
      this.noise({ freq: 180, to: 60, dur: 1.6, gain: .11 });
      [0, .38, .76].forEach(d => this.tone({ freq: 60, to: 38, dur: .3, type: 'sine', gain: .2, delay: d, filter: 150 }));
    }

    bossPulse() {
      this.tone({ freq: 700, to: 60, dur: .55, type: 'sawtooth', gain: .15, filter: 900 });
      this.noise({ freq: 900, to: 100, dur: .6, gain: .13 });
    }

    win() {
      // 切伦科夫蓝光爆发：明亮大和弦 + 上行光辉
      const chord = [261.6, 329.6, 392, 523.3, 659.3, 784];
      chord.forEach((f, i) => this.tone({ freq: f, dur: 1.9 - i * .1, type: 'sine',
        gain: .105 - i * .008, delay: i * .085, reverb: .9 }));
      this.tone({ freq: 1046, to: 2093, dur: 1.3, type: 'sine', gain: .07, delay: .5, reverb: 1 });
      this.noise({ freq: 4200, to: 700, dur: 1.1, gain: .07, hp: true, delay: .35 });
    }

    lose() {
      [392, 330, 262, 196].forEach((f, i) => this.tone({ freq: f, dur: .55, type: 'triangle',
        gain: .11, delay: i * .18, filter: 900, reverb: .7 }));
      this.tone({ freq: 90, to: 40, dur: 1.5, type: 'sine', gain: .13, delay: .4 });
    }
  }

  window.IceAudio = new IceAudio();
})();
