/* ===========================================================
   蓝冰猎影：宇宙幽灵  —  视觉渲染层
   1) 冰层背景：多层渐变 / 冰层年代带 / 裂纹 / 气泡 / 体积光柱 / 暗角
   2) 粒子与特效系统：切伦科夫蓝光锥、冲击环、放射线、光点、浮字
   全部程序化生成，无外部图片资源。
   =========================================================== */
(function () {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);

  /** 可复现随机数，保证 resize 时背景不跳动 */
  function seeded(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** 柔和光晕圆 */
  function glow(ctx, x, y, r, color, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
    g.addColorStop(0, color.replace('ALPHA', (alpha).toFixed(3)));
    g.addColorStop(.45, color.replace('ALPHA', (alpha * .35).toFixed(3)));
    g.addColorStop(1, color.replace('ALPHA', '0'));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }

  function glowLine(ctx, x1, y1, x2, y2, w, color, blur, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.shadowColor = color; ctx.shadowBlur = blur === undefined ? 12 : blur;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  /* =========================================================
     冰层背景
     ========================================================= */
  class IceBackdrop {
    constructor() { this.canvas = null; this.W = 0; this.H = 0; this.dpr = 1; this.bubbles = []; }

    build(W, H, dpr) {
      this.W = W; this.H = H; this.dpr = dpr;
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(W * dpr));
      cv.height = Math.max(1, Math.round(H * dpr));
      const c = cv.getContext('2d');
      c.scale(dpr, dpr);
      const R = seeded(20261110);

      // 基础深度渐变
      const base = c.createLinearGradient(0, 0, W * .18, H);
      base.addColorStop(0, '#020a16');
      base.addColorStop(.28, '#05203c');
      base.addColorStop(.58, '#073657');
      base.addColorStop(.82, '#062b4b');
      base.addColorStop(1, '#020c1c');
      c.fillStyle = base; c.fillRect(0, 0, W, H);

      // 冰层年代带（水平柔和色带，制造「深冰层次」）
      for (let i = 0; i < 13; i++) {
        const y = H * (i / 13) + R() * H * .03;
        const h = H * (.018 + R() * .055);
        const g = c.createLinearGradient(0, y, 0, y + h);
        const a = .018 + R() * .035;
        g.addColorStop(0, `rgba(120,205,255,0)`);
        g.addColorStop(.5, `rgba(${110 + R() * 60 | 0},${190 + R() * 50 | 0},255,${a})`);
        g.addColorStop(1, `rgba(80,160,230,0)`);
        c.fillStyle = g; c.fillRect(0, y, W, h);
      }

      // 斜射体积光柱（上方极光透过冰层）
      c.save(); c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) {
        const x0 = W * (.08 + i * .27) + R() * W * .06;
        const wid = W * (.10 + R() * .10);
        const g = c.createLinearGradient(x0, 0, x0 + W * .18, H);
        g.addColorStop(0, 'rgba(90,190,255,.10)');
        g.addColorStop(.45, 'rgba(60,150,230,.035)');
        g.addColorStop(1, 'rgba(30,100,180,0)');
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(x0 - wid * .3, 0); c.lineTo(x0 + wid * .3, 0);
        c.lineTo(x0 + W * .22 + wid, H); c.lineTo(x0 + W * .22 - wid, H);
        c.closePath(); c.fill();
      }
      c.restore();

      // 冰裂纹：细长折线，带微弱辉光
      for (let i = 0; i < 26; i++) {
        let x = R() * W, y = R() * H;
        const steps = 3 + (R() * 5 | 0);
        const ang = R() * TAU;
        const len = (40 + R() * 130) * (W / 1000 + .5);
        c.beginPath(); c.moveTo(x, y);
        for (let s = 0; s < steps; s++) {
          x += Math.cos(ang + (R() - .5) * .8) * len / steps;
          y += Math.sin(ang + (R() - .5) * .8) * len / steps;
          c.lineTo(x, y);
        }
        c.strokeStyle = `rgba(170,225,255,${.025 + R() * .055})`;
        c.lineWidth = .6 + R() * 1.2;
        c.shadowColor = 'rgba(120,200,255,.5)'; c.shadowBlur = 5;
        c.stroke();
      }
      c.shadowBlur = 0;

      // 静态气泡 / 冰晶微粒（散射点）
      for (let i = 0; i < 260; i++) {
        const x = R() * W, y = R() * H, r = .4 + R() * 2.1;
        c.beginPath(); c.arc(x, y, r, 0, TAU);
        c.fillStyle = `rgba(200,238,255,${.04 + R() * .16})`; c.fill();
        if (R() > .86) {
          c.beginPath(); c.arc(x, y, r * 3.4, 0, TAU);
          c.fillStyle = `rgba(130,210,255,${.02 + R() * .03})`; c.fill();
        }
      }

      // 远处冷光团（深度感）
      c.save(); c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 7; i++) {
        const x = R() * W, y = R() * H, rr = H * (.18 + R() * .32);
        glow(c, x, y, rr, 'rgba(40,130,210,ALPHA)', .055 + R() * .05);
      }
      c.restore();

      // 暗角
      const vg = c.createRadialGradient(W * .5, H * .48, Math.min(W, H) * .22, W * .5, H * .5, Math.max(W, H) * .78);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,4,14,.78)');
      c.fillStyle = vg; c.fillRect(0, 0, W, H);

      this.canvas = cv;

      // 动态上浮气泡（视差）
      this.bubbles = [];
      for (let i = 0; i < 34; i++) {
        this.bubbles.push({
          x: R() * W, y: R() * H,
          r: 1 + R() * 3.4, sp: 5 + R() * 16,
          ph: R() * TAU, a: .06 + R() * .18, depth: .4 + R() * .8
        });
      }
      this.crystals = [];
      for (let i = 0; i < 30; i++) this.crystals.push({ x: R() * W, y: R() * H, r: .7 + R() * 1.7, ph: R() * TAU });
    }

    draw(ctx, t, dt) {
      const W = this.W, H = this.H;
      if (!this.canvas) return;
      ctx.drawImage(this.canvas, 0, 0, W, H);

      // 光柱呼吸
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const breathe = .5 + .5 * Math.sin(t * .35);
      const lg = ctx.createLinearGradient(W * .28, 0, W * .5, H);
      lg.addColorStop(0, `rgba(110,205,255,${.022 + breathe * .022})`);
      lg.addColorStop(1, 'rgba(40,120,210,0)');
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.moveTo(W * .16, 0); ctx.lineTo(W * .38, 0);
      ctx.lineTo(W * .62, H); ctx.lineTo(W * .38, H); ctx.closePath(); ctx.fill();

      // 上浮气泡
      for (const b of this.bubbles) {
        b.y -= b.sp * dt * b.depth;
        b.x += Math.sin(t * .6 + b.ph) * 5 * dt;
        if (b.y < -8) { b.y = H + 8; b.x = Math.random() * W; }
        const a = b.a * (.65 + .35 * Math.sin(t * 1.4 + b.ph));
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU);
        ctx.fillStyle = `rgba(190,235,255,${a * .5})`; ctx.fill();
        ctx.strokeStyle = `rgba(200,245,255,${a})`; ctx.lineWidth = .7; ctx.stroke();
      }

      // 冰晶闪烁
      for (const k of this.crystals) {
        const s = .5 + .5 * Math.sin(t * 2.1 + k.ph);
        if (s > .82) {
          glow(ctx, k.x, k.y, k.r * 7, 'rgba(160,230,255,ALPHA)', (s - .82) * .9);
          ctx.beginPath(); ctx.arc(k.x, k.y, k.r, 0, TAU);
          ctx.fillStyle = `rgba(220,250,255,${(s - .82) * 3})`; ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  /* =========================================================
     特效系统
     ========================================================= */
  class IceFX {
    constructor() { this.items = []; this.shake = 0; this.flash = 0; this.flashColor = null; this.tint = 0; }

    _push(o) { if (this.items.length > 460) this.items.shift(); this.items.push(o); return o; }

    spark(x, y, o) {
      o = o || {};
      const ang = o.ang === undefined ? Math.random() * TAU : o.ang;
      const sp = o.speed === undefined ? rand(30, 150) : o.speed;
      return this._push({ type: 'spark', x, y,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        r: o.r || rand(1, 2.8), color: o.color || '#9be6ff',
        life: 0, max: o.life || rand(.3, .8), drag: o.drag || 2.2, grav: o.grav || 0 });
    }

    sparks(x, y, n, o) { for (let i = 0; i < n; i++) this.spark(x, y, o); }

    ring(x, y, o) {
      o = o || {};
      return this._push({ type: 'ring', x, y,
        r0: o.r0 || 2, r1: o.r1 || 60, color: o.color || '#8fe0ff',
        w: o.w || 2.5, life: 0, max: o.life || .5 });
    }

    beam(x1, y1, x2, y2, o) {
      o = o || {};
      return this._push({ type: 'beam', x1, y1, x2, y2,
        color: o.color || '#a8ecff', w: o.w || 3, life: 0, max: o.life || .18 });
    }

    cone(x, y, o) {
      o = o || {};
      return this._push({ type: 'cone', x, y,
        ang: o.ang === undefined ? Math.random() * TAU : o.ang,
        len: o.len || 90, half: o.half || .32,
        color: o.color || '#7fd8ff', life: 0, max: o.life || .5, spin: o.spin || 0 });
    }

    burst(x, y, o) {
      o = o || {};
      return this._push({ type: 'burst', x, y, n: o.n || 14,
        len: o.len || 46, color: o.color || '#c8f2ff',
        life: 0, max: o.life || .4, w: o.w || 1.6 });
    }

    text(x, y, str, o) {
      o = o || {};
      return this._push({ type: 'text', x, y, str, color: o.color || '#d8f6ff',
        size: o.size || 13, life: 0, max: o.life || .8, vy: o.vy || -34 });
    }

    /** 切伦科夫蓝光高潮：光锥 + 多层环 + 放射线 + 光点 */
    cherenkov(x, y, scale, violet) {
      scale = scale || 1;
      const c1 = violet ? '#b9a4ff' : '#8fe4ff';
      const c2 = violet ? '#e0d4ff' : '#e6fbff';
      for (let i = 0; i < 5; i++) {
        this.cone(x, y, { ang: Math.random() * TAU, len: (120 + Math.random() * 130) * scale,
          half: .18 + Math.random() * .22, color: c1, life: .55 + Math.random() * .35,
          spin: (Math.random() - .5) * 1.5 });
      }
      this.ring(x, y, { r0: 3, r1: 105 * scale, color: c2, w: 3.5, life: .6 });
      this.ring(x, y, { r0: 3, r1: 165 * scale, color: c1, w: 2, life: .85 });
      this.ring(x, y, { r0: 3, r1: 235 * scale, color: c1, w: 1.2, life: 1.05 });
      this.burst(x, y, { n: 20, len: 130 * scale, color: c2, life: .5, w: 2 });
      this.sparks(x, y, Math.min(60, 22 * scale | 0), { color: c2, speed: rand(90, 300) * scale, life: rand(.4, 1) });
      this.flash = Math.max(this.flash, .55 * scale);
      this.shake = Math.max(this.shake, 7 * scale);
      glowPulse(x, y, 220 * scale, c1, .55);
    }

    shock(x, y, color) {
      color = color || '#a78bff';
      this.ring(x, y, { r0: 8, r1: 340, color, w: 5, life: .8 });
      this.ring(x, y, { r0: 8, r1: 480, color, w: 2, life: 1.1 });
      this.sparks(x, y, 26, { color, speed: rand(80, 260), life: .8 });
      this.shake = Math.max(this.shake, 9);
    }

    update(dt) {
      const arr = this.items;
      for (let i = arr.length - 1; i >= 0; i--) {
        const o = arr[i]; o.life += dt;
        if (o.life >= o.max) { arr.splice(i, 1); continue; }
        if (o.type === 'spark') {
          o.x += o.vx * dt; o.y += o.vy * dt;
          const d = Math.exp(-o.drag * dt);
          o.vx *= d; o.vy *= d; o.vy += o.grav * dt;
        } else if (o.type === 'cone') { o.ang += o.spin * dt; }
        else if (o.type === 'text') { o.y += o.vy * dt; o.vy *= .94; }
      }
      this.shake *= Math.exp(-7 * dt);
      if (this.shake < .15) this.shake = 0;
      this.flash *= Math.exp(-1.9 * dt);
      if (this.flash < .008) this.flash = 0;
      this.tint *= Math.exp(-2.5 * dt);
      updatePulses(dt);
    }

    draw(ctx) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const o of this.items) {
        const p = o.life / o.max, fade = 1 - p;
        switch (o.type) {
          case 'spark': {
            ctx.globalAlpha = fade;
            ctx.fillStyle = o.color;
            ctx.shadowColor = o.color; ctx.shadowBlur = 9;
            ctx.beginPath(); ctx.arc(o.x, o.y, o.r * (.4 + fade * .8), 0, TAU); ctx.fill();
            ctx.shadowBlur = 0;
            break;
          }
          case 'ring': {
            const r = lerp(o.r0, o.r1, 1 - Math.pow(1 - p, 2.2));
            ctx.globalAlpha = fade * .9;
            ctx.strokeStyle = o.color; ctx.lineWidth = o.w * fade + .3;
            ctx.shadowColor = o.color; ctx.shadowBlur = 14;
            ctx.beginPath(); ctx.arc(o.x, o.y, r, 0, TAU); ctx.stroke();
            ctx.shadowBlur = 0;
            break;
          }
          case 'beam': {
            ctx.globalAlpha = fade;
            ctx.strokeStyle = o.color; ctx.lineWidth = o.w * fade + .5;
            ctx.shadowColor = o.color; ctx.shadowBlur = 18;
            ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke();
            ctx.lineWidth = 1; ctx.strokeStyle = '#ffffff'; ctx.stroke();
            ctx.shadowBlur = 0;
            break;
          }
          case 'cone': {
            ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.ang);
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, o.len);
            g.addColorStop(0, hexA(o.color, .55 * fade));
            g.addColorStop(.22, hexA(o.color, .22 * fade));
            g.addColorStop(1, hexA(o.color, 0));
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.moveTo(0, 0);
            ctx.arc(0, 0, o.len, -o.half, o.half); ctx.closePath(); ctx.fill();
            ctx.restore();
            break;
          }
          case 'burst': {
            ctx.globalAlpha = fade * .9;
            ctx.strokeStyle = o.color; ctx.lineWidth = o.w * fade + .3;
            ctx.shadowColor = o.color; ctx.shadowBlur = 10;
            const l = o.len * (0.25 + p * .9);
            ctx.beginPath();
            for (let i = 0; i < o.n; i++) {
              const a = i / o.n * TAU;
              ctx.moveTo(o.x + Math.cos(a) * 4, o.y + Math.sin(a) * 4);
              ctx.lineTo(o.x + Math.cos(a) * l, o.y + Math.sin(a) * l);
            }
            ctx.stroke(); ctx.shadowBlur = 0;
            break;
          }
        }
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      // 持久型柔光脉冲（合成 / 命中）
      for (const gp of pulses) {
        const f = 1 - gp.life / gp.max;
        glow(ctx, gp.x, gp.y, gp.r * (.6 + .4 * (1 - f)), gp.color, f * .28);
      }
      ctx.restore();

      // 浮字（普通混合，保证可读）
      ctx.save();
      for (const o of this.items) {
        if (o.type !== 'text') continue;
        const p = o.life / o.max, fade = 1 - p;
        ctx.globalAlpha = fade;
        ctx.font = `700 ${o.size}px ui-monospace, Consolas, monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = o.color;
        ctx.shadowColor = o.color; ctx.shadowBlur = 12;
        ctx.fillText(o.str, o.x, o.y);
        ctx.shadowBlur = 0;
      }
      ctx.restore();
    }

    /** 全屏叠加：切伦科夫泛光 */
    drawOverlay(ctx, W, H) {
      if (this.flash > .01) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(W * .5, H * .5, 0, W * .5, H * .5, Math.max(W, H) * .72);
        g.addColorStop(0, `rgba(175,232,255,${Math.min(.58, this.flash * .78)})`);
        g.addColorStop(.45, `rgba(52,150,255,${this.flash * .46})`);
        g.addColorStop(1, 'rgba(20,80,180,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
      }
      if (this.tint > .01) {
        ctx.save(); ctx.fillStyle = `rgba(150,110,255,${Math.min(.22, this.tint * .22)})`;
        ctx.fillRect(0, 0, W, H); ctx.restore();
      }
    }
  }

  // 柔光脉冲池
  const pulses = [];
  function glowPulse(x, y, r, color) {
    if (pulses.length > 40) pulses.shift();
    let rgb = '120,210,255';
    if (color && color[0] === '#') {
      const n = parseInt(color.slice(1), 16);
      rgb = `${n >> 16 & 255},${n >> 8 & 255},${n & 255}`;
    }
    pulses.push({ x, y, r, color: `rgba(${rgb},ALPHA)`, life: 0, max: .55 });
  }
  function updatePulses(dt) {
    for (let i = pulses.length - 1; i >= 0; i--) {
      pulses[i].life += dt;
      if (pulses[i].life >= pulses[i].max) pulses.splice(i, 1);
    }
  }

  /** #rrggbb -> rgba(...) */
  function hexA(hex, a) {
    if (hex[0] !== '#') return hex;
    const h = hex.length === 4
      ? '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3] : hex;
    const n = parseInt(h.slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a.toFixed(3)})`;
  }

  window.IceRender = { TAU, clamp, lerp, rand, seeded, roundRect, glow, glowLine, hexA, IceBackdrop, IceFX };
})();
