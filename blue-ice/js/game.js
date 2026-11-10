/* ===========================================================
   蓝冰猎影：宇宙幽灵  —  第一关核心玩法
   纯 Canvas 2D + 原生 JS，无框架、无外部资源。
   核心动词：「布」—— 在有限钻孔里放置随机光学装置，
   用合成与地形把随机的序列整理成能扛住 12 波的阵列。
   =========================================================== */
(function () {
  'use strict';

  const R = window.IceRender, A = window.IceAudio;
  const { TAU, clamp, lerp, rand, roundRect, glow, glowLine, hexA, IceBackdrop, IceFX } = R;
  const $ = id => document.getElementById(id);

  function tpl(hex) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},ALPHA)`;
  }

  /* ======================= 关卡配置 ======================= */
  const COLS = 8, ROWS = 5, TOTAL_WAVES = 12;
  const DEPLOY_COST = 20;
  const MAX_LV = 5;

  // 干扰粒子沿冰裂隙行进的路线（单位：格中心坐标）
  const PATH = [
    [-.8, 2], [0, 2], [1, 2], [2, 2], [2, 1], [3, 1], [4, 1],
    [4, 2], [4, 3], [5, 3], [6, 3], [6, 2], [7, 2], [8.2, 2]
  ];
  const PATH_SET = new Set();
  PATH.forEach(p => { if (Number.isInteger(p[0]) && Number.isInteger(p[1])) PATH_SET.add(p[0] + ',' + p[1]); });

  // 冰层地形：钻孔位置固定，形成明确的布阵取舍
  const TERRAIN = {
    pure:     { name: '纯净深冰', color: '#7fe4ff', dmg: 1.25, cd: 1,    range: 1,    note: '伤害 +25%' },
    resonant: { name: '共振冰',   color: '#b69bff', dmg: 1,    cd: .77, range: 1,    note: '攻速 +30%' },
    bubble:   { name: '气泡层',   color: '#8fd8c8', dmg: 1,    cd: 1,   range: 1.35, note: '射程 +35%' },
    normal:   { name: '常规冰层', color: '#6fb0d8', dmg: 1,    cd: 1,   range: 1,    note: '无加成' }
  };
  // 第一关只完成部分钻孔：空间稀缺是布阵策略的来源，其余冰层留待后续关卡解锁
  const ACTIVE_CELLS = new Set([
    '1,0', '3,0', '5,0', '6,0',
    '0,1', '1,1', '6,1', '7,1',
    '3,2', '5,2',
    '1,3', '3,3', '7,3',
    '0,4', '2,4', '4,4', '5,4'
  ]);

  const TERRAIN_MAP = {
    '0,0': 'bubble', '1,0': 'normal', '2,0': 'bubble', '3,0': 'pure', '5,0': 'resonant', '6,0': 'bubble', '7,0': 'normal',
    '0,1': 'resonant', '1,1': 'pure', '5,1': 'pure', '6,1': 'resonant', '7,1': 'pure',
    '3,2': 'pure', '5,2': 'pure', '0,3': 'normal', '1,3': 'resonant', '3,3': 'resonant', '7,3': 'resonant',
    '0,4': 'bubble', '1,4': 'normal', '2,4': 'pure', '3,4': 'normal', '4,4': 'bubble', '5,4': 'pure', '6,4': 'bubble', '7,4': 'normal'
  };

  // 5 种光学探测装置：能力差异清晰，全部取自 IceCube 真实概念的艺术化
  const TOWERS = {
    dom: {
      key: 'dom', name: 'DOM 光学模块', role: 'SINGLE TARGET', glyph: '◎', color: '#7fdcff', weight: 34,
      dmg: 13, range: 2.15, cd: .72,
      desc: '冰下数字光学模块，持续捕捉光子并发出稳定的切伦科夫蓝脉冲。可靠的单体输出。'
    },
    cascade: {
      key: 'cascade', name: '级联阵列', role: 'AOE BURST', glyph: '✳', color: '#4fc3ff', weight: 22,
      dmg: 19, range: 1.95, cd: 1.48, splash: 1.18,
      desc: '模拟粒子级联簇射，命中后炸开一片蓝光，对范围内所有干扰造成溅射伤害。'
    },
    track: {
      key: 'track', name: 'μ 子径迹仪', role: 'PIERCING LINE', glyph: '⟋', color: '#b9ecff', weight: 18,
      dmg: 23, range: 2.85, cd: 1.32, pierce: true,
      desc: '沿 μ 子长径迹发射一道贯穿光束，穿透整条直线上的干扰粒子。'
    },
    coincidence: {
      key: 'coincidence', name: '符合触发器', role: 'SLOW / MARK', glyph: '⊕', color: '#a99bff', weight: 16,
      dmg: 7, range: 2.25, cd: .95, slow: .45, slowT: 2.2, mark: 1.35, markT: 2.6, multi: 3,
      desc: '多重符合判定：同时标记多个目标、拖慢其速度，被标记的干扰受到额外伤害。'
    },
    amplifier: {
      key: 'amplifier', name: '量子增益器', role: 'SUPPORT / ECON', glyph: '◈', color: '#8fffd8', weight: 10,
      dmg: 0, range: 1.55, cd: 2.3, aura: .28, income: 6,
      desc: '不直接攻击。为相邻钻孔的装置提供增益光环，并周期性回收额外光子预算。'
    }
  };
  const TOWER_KEYS = Object.keys(TOWERS);
  const SHORT_NAME = {
    dom: 'DOM 模块', cascade: '级联阵列', track: 'μ 子径迹仪',
    coincidence: '符合触发器', amplifier: '量子增益器'
  };

  // 宇宙线背景干扰 / 高能事件
  // leak = 抵达数据链路时扣掉的链路百分比。取值原则：
  //   普通干扰单只 2–9%（能被血条读出来），但绝不单独致命；
  //   BOSS 穿透一次 38%（重创而非秒杀），会被弹回入口重新进入，最多三进三出。
  const ENEMIES = {
    muon:     { name: '大气 μ 子',   hp: 36,   spd: 1.18, leak: 4,  color: '#8ad4ff', r: .16, reward: 2,  shape: 'muon' },
    dark:     { name: '暗噪声',       hp: 22,   spd: 2.00, leak: 2,  color: '#b9a4ff', r: .12, reward: 2,  shape: 'dark' },
    shower:   { name: '簇射背景',     hp: 68,   spd: 1.05, leak: 6,  color: '#67d8d0', r: .20, reward: 3,  shape: 'shower' },
    cascadeN: { name: '级联噪声簇',   hp: 138,  spd: .70,  leak: 9,  color: '#4f9ee0', r: .27, reward: 5,  shape: 'cascade' },
    ghost:    { name: '宇宙幽灵',     hp: 12000, spd: .38, leak: 38, color: '#c9b0ff', r: .52, reward: 60, shape: 'boss', boss: true }
  };

  const WAVES = [
    { label: '大气 μ 子背景流',       groups: [{ t: 'muon', n: 6, gap: .95 }] },
    { label: 'μ 子流增强',            groups: [{ t: 'muon', n: 8, gap: .72 }, { t: 'dark', n: 2, gap: 1 }] },
    { label: '暗计数闪烁',            groups: [{ t: 'dark', n: 8, gap: .52 }, { t: 'muon', n: 5, gap: .7 }] },
    { label: '簇射背景渗透',          groups: [{ t: 'shower', n: 6, gap: .85 }, { t: 'muon', n: 5, gap: .6 }] },
    { label: '精英 · 级联噪声簇',      groups: [{ t: 'cascadeN', n: 2, gap: 2.6 }, { t: 'dark', n: 8, gap: .55 }], elite: true },
    { label: '背景流叠加',            groups: [{ t: 'muon', n: 10, gap: .52 }, { t: 'shower', n: 4, gap: 1.1 }] },
    { label: '暗噪声风暴',            groups: [{ t: 'dark', n: 12, gap: .38 }, { t: 'shower', n: 5, gap: .9 }] },
    { label: '厚重噪声前压',          groups: [{ t: 'cascadeN', n: 3, gap: 1.9 }, { t: 'muon', n: 8, gap: .5 }] },
    { label: '混合干扰潮',            groups: [{ t: 'shower', n: 8, gap: .6 }, { t: 'dark', n: 10, gap: .35 }] },
    { label: '链路高压',              groups: [{ t: 'cascadeN', n: 4, gap: 1.55 }, { t: 'muon', n: 10, gap: .42 }] },
    { label: '观测窗口关闭前夜',      groups: [{ t: 'shower', n: 10, gap: .5 }, { t: 'dark', n: 12, gap: .3 }, { t: 'cascadeN', n: 2, gap: 2.2 }] },
    { label: '高能中微子事件 · 宇宙幽灵', groups: [{ t: 'ghost', n: 1, gap: 1 }, { t: 'dark', n: 10, gap: 1.1 }, { t: 'cascadeN', n: 2, gap: 3 }], boss: true }
  ];

  /* 后段升压表（相对基准血量的额外倍率）
     前 7 波保持平稳，让玩家把阵列搭起来；第 8 波起逐波加压，
     使「要不要现在合成 / 现在补位」在每一波都变成真实取舍。
     第 12 波的伴随干扰沿用第 11 波倍率：最后一波只应由 BOSS 定义难度。 */
  const LATE_PRESSURE = { 8: 1.45, 9: 2.35, 10: 3.80, 11: 4.50 };
  const pressureAt = w => LATE_PRESSURE[Math.min(w, TOTAL_WAVES - 1)] || 1;

  /* ======================= 游戏主体 ======================= */
  class Game {
    constructor() {
      this.canvas = $('stage');
      this.ctx = this.canvas.getContext('2d', { alpha: false });
      this.backdrop = new IceBackdrop();
      this.fx = new IceFX();
      this.dpr = 1; this.W = 0; this.H = 0;
      this.d = {
        hud: $('hud'), dock: $('dock'), inspector: $('inspector'),
        title: $('titleScreen'), tutorial: $('tutorial'), help: $('helpPanel'),
        result: $('resultScreen'), pauseVeil: $('pauseVeil'), flash: $('flash'),
        valLink: $('valLink'), barLink: $('barLink'), valEnergy: $('valEnergy'),
        valWave: $('valWave'), valScore: $('valScore'),
        btnAutoDeploy: $('btnAutoDeploy'), btnAutoMerge: $('btnAutoMerge'),
        btnNextWave: $('btnNextWave'), deployCost: $('deployCost'),
        mergeCount: $('mergeCount'), nextWaveSub: $('nextWaveSub'),
        waveBanner: $('waveBanner'), waveKicker: $('waveKicker'),
        waveTitle: $('waveTitle'), waveSub: $('waveSub'), toast: $('toast')
      };
      this.resize();
      window.addEventListener('resize', () => this.resize());
      window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 220));
      this.buildHelp();
      this.buildLegend();
      this.bindUI();
      this.bindPointer();
      this._seed = null; this._rngState = 1;
      this.reset();
      this.last = performance.now();
      requestAnimationFrame(t => this.loop(t));
    }

    /* ---------------- 布局 ---------------- */
    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.W = w; this.H = h;
      this.canvas.width = Math.round(w * this.dpr);
      this.canvas.height = Math.round(h * this.dpr);
      this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
      this.layout();
      this.backdrop.build(w, h, this.dpr);
    }

    layout() {
      const W = this.W, H = this.H;
      const narrow = W < 820;
      const top = narrow ? 106 : 78;
      const bottom = narrow ? 106 : 94;
      const availH = Math.max(160, H - top - bottom);
      const availW = Math.max(200, W - 30);
      const cell = Math.min(availW / (COLS + 1.25), availH / (ROWS + .85));
      this.cell = cell;
      const gw = COLS * cell, gh = ROWS * cell;
      this.gx0 = (W - gw) / 2 - cell * .12;
      this.gy0 = top + (availH - gh) / 2;
      this.top = top; this.bottom = bottom;

      const raw = PATH.map(p => ({ x: this.gx0 + (p[0] + .5) * cell, y: this.gy0 + (p[1] + .5) * cell }));
      this.pathPts = this.smoothPath(raw);
      this.pathCum = [0];
      for (let i = 1; i < this.pathPts.length; i++) {
        const a = this.pathPts[i - 1], b = this.pathPts[i];
        this.pathCum[i] = this.pathCum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y);
      }
      this.pathLen = this.pathCum[this.pathCum.length - 1];
      this.core = { x: this.pathPts[this.pathPts.length - 1].x, y: this.pathPts[this.pathPts.length - 1].y };

      // 塔坐标随布局重算
      if (this.towers) for (const t of this.towers) {
        const p = this.center(t.c, t.r); t.x = p.x; t.y = p.y;
      }
      if (this.enemies) for (const e of this.enemies) {
        const p = this.posAt(e.dist); e.x = p.x; e.y = p.y;
      }
      if (this.bullets) for (const b of this.bullets) { b.x *= .9; b.y *= .9; }
    }

    /** 把折线路径转成圆滑的冰裂隙曲线（二次贝塞尔采样），绘制与敌人行进完全共用 */
    smoothPath(raw) {
      const pts = [{ x: raw[0].x, y: raw[0].y }];
      for (let i = 1; i < raw.length - 1; i++) {
        const a = raw[i], b = raw[i + 1], prev = pts[pts.length - 1];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        for (let k = 1; k <= 8; k++) {
          const t = k / 8, u = 1 - t;
          pts.push({
            x: u * u * prev.x + 2 * u * t * a.x + t * t * mx,
            y: u * u * prev.y + 2 * u * t * a.y + t * t * my
          });
        }
      }
      const last = raw[raw.length - 1];
      pts.push({ x: last.x, y: last.y });
      return pts;
    }

    center(c, r) { return { x: this.gx0 + (c + .5) * this.cell, y: this.gy0 + (r + .5) * this.cell }; }
    terrainAt(c, r) { return TERRAIN_MAP[c + ',' + r] || 'normal'; }
    isPath(c, r) { return PATH_SET.has(c + ',' + r); }
    isActive(c, r) { return ACTIVE_CELLS.has(c + ',' + r); }

    /* ---------------- 可复现随机（xorshift32） ----------------
       只用于影响玩法的随机（抽卡、选位抖动、装置初始相位）。
       设置了种子后，同一操作序列会得到完全一致的对局，便于改前改后对比。 */
    seed(s) {
      this._seed = (s >>> 0) || 1;
      this._rngState = this._seed >>> 0;
      return this._seed;
    }
    rnd() {
      if (this._seed === null || this._seed === undefined) return Math.random();
      let x = this._rngState;
      x ^= x << 13; x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5; x >>>= 0;
      this._rngState = x || 1;
      return this._rngState / 4294967296;
    }

    posAt(d) {
      const cum = this.pathCum, pts = this.pathPts;
      d = clamp(d, 0, this.pathLen);
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const a = pts[i - 1], b = pts[i];
      const seg = cum[i] - cum[i - 1] || 1;
      const t = (d - cum[i - 1]) / seg;
      return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), ang: Math.atan2(b.y - a.y, b.x - a.x) };
    }

    /* ---------------- 状态 ---------------- */
    reset() {
      this.phase = 'title';           // title | playing | win | lose
      this.paused = false; this.speed = 1;
      this.energy = 130; this.link = 100; this.score = 0;
      this.wave = 0;
      this.waveState = 'prep';        // prep | running
      this.prepTimer = 14;
      this.spawnQueue = []; this.spawnClock = 0;
      this.enemies = []; this.towers = []; this.bullets = [];
      this.selected = null; this.drag = null; this.hoverCell = null;
      this.stats = { kills: 0, merges: 0, maxLv: 1, deployed: 0, leaked: 0, damage: 0, leakDamage: 0, bossPasses: 0 };
      this.gameTime = 0; this.hudT = 0;
      this.bossRef = null; this.bossTimer = 0; this.bossStep = 0;
      this.godMode = false;
      this.uid = 1;
      // 随机种子：测试时可复现同一抽卡序列（null = 真随机）
      if (this._seed !== null && this._seed !== undefined) this._rngState = this._seed >>> 0;
      this.waveTrace = []; this._waveLeaks = 0; this._waveDmg = 0; this._waveDeepest = 0;
      this._waveStartLink = 100;
      this.fx.items.length = 0; this.fx.flash = 0; this.fx.tint = 0; this.fx.shake = 0;
      this.d.hud.classList.add('hidden'); this.d.dock.classList.add('hidden');
      this.d.inspector.classList.add('hidden'); this.d.pauseVeil.classList.add('hidden');
      this.d.result.classList.add('hidden'); this.d.tutorial.classList.add('hidden');
      this.d.help.classList.add('hidden');
      this.syncHUD(true);
    }

    startGame() {
      this.reset();
      this.phase = 'playing';
      this.d.title.classList.add('hidden');
      this.d.hud.classList.remove('hidden');
      this.d.dock.classList.remove('hidden');
      this.d.tutorial.classList.remove('hidden');
      A.init(); A.resume();
      this.syncHUD(true);
    }

    /* ---------------- UI 绑定 ---------------- */
    buildHelp() {
      const box = $('helpTowers');
      box.innerHTML = TOWER_KEYS.map(k => {
        const t = TOWERS[k];
        return `<div><span class="hg-icon" style="color:${t.color}">${t.glyph}</span>
          <div><b>${t.name}</b><small>${t.role} · ${t.desc}</small></div></div>`;
      }).join('');
    }

    buildLegend() {
      $('dockLegend').innerHTML = `
        <span class="lg"><i class="pure"></i>纯净深冰 伤害+25%</span>
        <span class="lg"><i class="resonant"></i>共振冰 攻速+30%</span>
        <span class="lg"><i class="bubble"></i>气泡层 射程+35%</span>`;
    }

    bindUI() {
      $('btnStart').onclick = () => { A.init(); A.click(); this.startGame(); };
      $('btnTutOk').onclick = () => { A.click(); this.d.tutorial.classList.add('hidden'); };
      $('btnHelp').onclick = () => { A.click(); this.d.help.classList.toggle('hidden'); };
      $('btnHelpClose').onclick = () => { A.click(); this.d.help.classList.add('hidden'); };
      $('btnSound').onclick = e => {
        A.init(); A.setMuted(!A.muted); A.click();
        e.currentTarget.textContent = A.muted ? '♪̸' : '♪';
        e.currentTarget.classList.toggle('off', A.muted);
      };
      $('btnSpeed').onclick = e => {
        this.speed = this.speed === 1 ? 2 : 1; A.click();
        e.currentTarget.textContent = this.speed + '×';
      };
      $('btnPause').onclick = e => {
        this.paused = !this.paused; A.click();
        this.d.pauseVeil.classList.toggle('hidden', !this.paused);
        e.currentTarget.textContent = this.paused ? '▶' : 'Ⅱ';
      };
      this.d.pauseVeil.onclick = () => {
        this.paused = false; this.d.pauseVeil.classList.add('hidden');
        $('btnPause').textContent = 'Ⅱ';
      };
      this.d.btnAutoDeploy.onclick = () => { A.click(); this.autoDeploy(); };
      this.d.btnAutoMerge.onclick = () => { A.click(); this.autoMerge(); };
      this.d.btnNextWave.onclick = () => { A.click(); this.forceNextWave(); };
      $('inspClose').onclick = () => { this.select(null); };
      $('btnMergeOne').onclick = () => { A.click(); this.mergeSelected(); };
      $('btnRecycle').onclick = () => { A.click(); this.recycleSelected(); };
      $('btnReplay').onclick = () => { A.click(); this.startGame(); this.d.tutorial.classList.add('hidden'); };
      document.addEventListener('keydown', e => {
        if (e.key === ' ') { e.preventDefault(); $('btnPause').click(); }
        else if (e.key === 'd' || e.key === 'D') this.autoDeploy();
        else if (e.key === 'm' || e.key === 'M') this.autoMerge();
        else if (e.key === 'Escape') this.select(null);
      });
    }

    /* ---------------- 指针交互（鼠标 + 触屏统一） ---------------- */
    bindPointer() {
      const cv = this.canvas;
      const local = e => {
        const r = cv.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      };
      cv.addEventListener('pointerdown', e => {
        if (this.phase !== 'playing' || this.paused) return;
        cv.setPointerCapture(e.pointerId);
        const p = local(e);
        const g = this.cellFrom(p.x, p.y);
        const t = g ? this.towerAt(g.c, g.r) : null;
        if (t) {
          this.drag = { from: t, x0: p.x, y0: p.y, x: p.x, y: p.y, moved: false };
        } else {
          this.drag = null;
          if (g && !this.isPath(g.c, g.r)) this.deployAt(g.c, g.r);
          else this.select(null);
        }
      });
      cv.addEventListener('pointermove', e => {
        const p = local(e);
        const g = this.cellFrom(p.x, p.y);
        this.hoverCell = g;
        if (this.drag) {
          this.drag.x = p.x; this.drag.y = p.y;
          if (Math.hypot(p.x - this.drag.x0, p.y - this.drag.y0) > this.cell * .22) this.drag.moved = true;
        }
      });
      cv.addEventListener('pointerup', e => {
        const p = local(e), dr = this.drag;
        this.drag = null;
        if (!dr) return;
        if (!dr.moved) { this.select(dr.from); return; }
        const g = this.cellFrom(p.x, p.y);
        if (!g || this.isPath(g.c, g.r) || !this.isActive(g.c, g.r)) { this.select(dr.from); return; }
        const target = this.towerAt(g.c, g.r);
        if (target && target !== dr.from) {
          if (target.type === dr.from.type && target.lv === dr.from.lv && target.lv < MAX_LV) {
            this.merge(dr.from, target);
          } else {
            this.toast('只有同种同级装置可以合成'); A.error();
            this.select(dr.from);
          }
        } else if (!target) {
          // 拖动到空钻孔 = 重新布阵
          dr.from.c = g.c; dr.from.r = g.r;
          const c = this.center(g.c, g.r); dr.from.x = c.x; dr.from.y = c.y;
          this.fx.ring(c.x, c.y, { r0: 4, r1: this.cell * .7, color: '#8fe0ff', life: .35 });
          A.click(); this.select(dr.from);
        } else this.select(dr.from);
      });
      cv.addEventListener('pointercancel', () => { this.drag = null; });
      cv.addEventListener('contextmenu', e => e.preventDefault());
    }

    cellFrom(x, y) {
      const c = Math.floor((x - this.gx0) / this.cell);
      const r = Math.floor((y - this.gy0) / this.cell);
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
      return { c, r };
    }
    towerAt(c, r) { return this.towers.find(t => t.c === c && t.r === r) || null; }

    /* ---------------- 部署 / 合成 / 回收 ---------------- */
    pickType() {
      // 保底：场上已有可合成对时，提高抽到同类概率，降低随机挫败
      const pair = this.findMergePair();
      if (pair && this.rnd() < .34) return pair[0].type;
      const total = TOWER_KEYS.reduce((s, k) => s + TOWERS[k].weight, 0);
      let x = this.rnd() * total;
      for (const k of TOWER_KEYS) { x -= TOWERS[k].weight; if (x <= 0) return k; }
      return 'dom';
    }

    emptyCells() {
      const out = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (this.isActive(c, r) && !this.isPath(c, r) && !this.towerAt(c, r)) out.push({ c, r });
      }
      return out;
    }

    /** 智能部署：按「覆盖路径长度 + 地形价值 + 相邻同类」评分选位 */
    bestCell(type) {
      const cells = this.emptyCells();
      if (!cells.length) return null;
      const def = TOWERS[type];
      let best = null, bestScore = -1e9;
      for (const g of cells) {
        const p = this.center(g.c, g.r);
        const ter = TERRAIN[this.terrainAt(g.c, g.r)];
        const range = def.range * ter.range * this.cell;
        // 采样路径点，统计射程覆盖
        let cover = 0;
        for (let i = 0; i < 40; i++) {
          const q = this.posAt(this.pathLen * i / 40);
          if (Math.hypot(q.x - p.x, q.y - p.y) < range) cover++;
        }
        let score = cover * 2.2;
        if (def.pierce) score += cover * .6;
        if (type === 'amplifier') {
          let n = 0;
          for (const t of this.towers) if (Math.abs(t.c - g.c) <= 1 && Math.abs(t.r - g.r) <= 1) n++;
          score = n * 14 + cover;
        } else {
          score += (ter.dmg - 1) * 24 + (1 - ter.cd) * 20 + (ter.range - 1) * 14;
          // 靠近已有的同类同级，方便合成
          for (const t of this.towers) {
            if (t.type === type && t.lv === 1 && Math.abs(t.c - g.c) + Math.abs(t.r - g.r) <= 2) score += 5;
          }
        }
        score += this.rnd() * 1.5;
        if (score > bestScore) { bestScore = score; best = g; }
      }
      return best;
    }

    /** 部署成本随累计部署次数递增：每 5 次 +5，防止无限抽卡冲淡合成决策 */
    deployCost() { return DEPLOY_COST + Math.floor(this.stats.deployed / 5) * 5; }

    deployAt(c, r, forcedType) {
      if (this.phase !== 'playing') return false;
      if (this.isPath(c, r)) { this.toast('裂隙通道无法部署'); A.error(); return false; }
      if (!this.isActive(c, r)) { this.toast('该冰层尚未钻探 · 第一关未开放'); A.error(); return false; }
      if (this.towerAt(c, r)) return false;
      const cost = this.deployCost();
      if (this.energy < cost) { this.toast('光子预算不足 · 等待干扰被滤除'); A.error(); return false; }
      const type = forcedType || this.pickType();
      this.energy -= cost;
      const p = this.center(c, r);
      const t = { id: this.uid++, c, r, x: p.x, y: p.y, type, lv: 1, cd: this.rnd() * .3,
        angle: 0, disabled: 0, born: this.gameTime, pulse: 1 };
      this.towers.push(t);
      this.stats.deployed++;
      const def = TOWERS[type], col = def.color;
      this.fx.ring(p.x, p.y, { r0: 2, r1: this.cell * .85, color: col, w: 3, life: .45 });
      this.fx.cone(p.x, p.y, { len: this.cell * 1.6, half: .5, color: col, life: .45 });
      this.fx.sparks(p.x, p.y, 14, { color: '#d8f6ff', speed: rand(40, 150), life: .55 });
      // 短标签且只保留最新的一个，避免连续部署时文字堆叠遮挡战场
      this.fx.items = this.fx.items.filter(o => !(o.type === 'text' && o.tag === 'deploy'));
      const tag = this.fx.text(p.x, p.y - this.cell * .52, SHORT_NAME[type],
        { color: col, size: Math.max(10, this.cell * .15), life: .62 });
      tag.tag = 'deploy';
      A.deploy();
      this.select(null);
      this.syncHUD(true);
      return true;
    }

    autoDeploy() {
      if (this.phase !== 'playing') return;
      const type = this.pickType();
      const g = this.bestCell(type);
      if (!g) { this.toast('所有钻孔已占用 · 试试合成'); A.error(); return; }
      this.deployAt(g.c, g.r, type);
    }

    findMergePair(prefer) {
      const byKey = new Map();
      for (const t of this.towers) {
        if (t.lv >= MAX_LV) continue;
        const k = t.type + ':' + t.lv;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(t);
      }
      let best = null, bestLv = -1;
      if (prefer && prefer.lv < MAX_LV) {
        const list = byKey.get(prefer.type + ':' + prefer.lv) || [];
        const o = list.find(t => t !== prefer);
        if (o) return [prefer, o];
      }
      for (const [k, list] of byKey) {
        if (list.length < 2) continue;
        const lv = list[0].lv;
        if (lv > bestLv) { bestLv = lv; best = [list[0], list[1]]; }
      }
      return best;
    }

    /** a 合并进 b（保留 b 的位置） */
    merge(a, b) {
      if (a === b || a.type !== b.type || a.lv !== b.lv || a.lv >= MAX_LV) return false;
      this.towers = this.towers.filter(t => t !== a);
      b.lv++;
      b.cd = 0; b.pulse = 1;
      this.stats.merges++;
      this.stats.maxLv = Math.max(this.stats.maxLv, b.lv);
      // 合成高潮：随等级增强的切伦科夫蓝光
      this.fx.cherenkov(b.x, b.y, .48 + b.lv * .16, false);
      this.fx.text(b.x, b.y - this.cell * .75, `Lv.${b.lv}  ${TOWERS[b.type].name}`,
        { color: '#e8fbff', size: 13, life: 1.3 });
      A.merge(b.lv);
      if (b.lv >= 4) this.flashScreen('', .55);
      this.select(b);
      this.syncHUD(true);
      return true;
    }

    autoMerge() {
      const pair = this.findMergePair(this.selected);
      if (!pair) { this.toast('暂无可合成的同种同级装置'); A.error(); return; }
      this.merge(pair[0], pair[1]);
    }
    mergeSelected() {
      if (!this.selected) return;
      const pair = this.findMergePair(this.selected);
      if (!pair) { this.toast('没有可与之合成的同种同级装置'); A.error(); return; }
      this.merge(pair[0], pair[1]);
    }
    recycleSelected() {
      if (!this.selected) return;
      const t = this.selected;
      this.towers = this.towers.filter(x => x !== t);
      this.energy += Math.round(DEPLOY_COST * .5 + (t.lv - 1) * 6);
      this.fx.sparks(t.x, t.y, 12, { color: '#8fd8ff', speed: rand(30, 110), life: .5 });
      A.click(); this.select(null); this.syncHUD(true);
      this.toast('钻孔已回收 · 返还光子预算');
    }

    select(t) {
      this.selected = t || null;
      const el = this.d.inspector;
      if (!t) { el.classList.add('hidden'); return; }
      el.classList.remove('hidden');
      const def = TOWERS[t.type], ter = TERRAIN[this.terrainAt(t.c, t.r)];
      const s = this.towerStats(t);
      $('inspGlyph').textContent = def.glyph;
      $('inspGlyph').style.color = def.color;
      $('inspName').textContent = def.name;
      $('inspRole').textContent = def.role;
      $('inspLv').textContent = 'Lv.' + t.lv;
      $('inspDesc').textContent = def.desc;
      $('inspStats').innerHTML = def.dmg === 0
        ? `<div><span>增益光环</span><b>+${Math.round(s.aura * 100)}%</b></div><div><span>光子产出</span><b>+${def.income}/次</b></div>`
        : `<div><span>单发伤害</span><b>${Math.round(s.dmg)}</b></div><div><span>攻击间隔</span><b>${s.cd.toFixed(2)}s</b></div>
           <div><span>探测半径</span><b>${(s.range / this.cell).toFixed(1)} 格</b></div><div><span>理论 DPS</span><b>${Math.round(s.dmg / s.cd)}</b></div>`;
      $('inspTerrain').textContent = `地形 · ${ter.name}　${ter.note}`;
      $('btnMergeOne').disabled = !this.findMergePair(t);
      this.syncHUD(true);
    }

    /** 计算塔实际属性（等级 / 地形 / 邻位增益） */
    towerStats(t) {
      const def = TOWERS[t.type], ter = TERRAIN[this.terrainAt(t.c, t.r)];
      const lvD = 1 + (t.lv - 1) * .75;
      const lvR = 1 + (t.lv - 1) * .10;
      const lvC = 1 - (t.lv - 1) * .085;
      let aura = 0;
      for (const o of this.towers) {
        if (o !== t && o.type === 'amplifier' && Math.abs(o.c - t.c) <= 1 && Math.abs(o.r - t.r) <= 1) {
          aura += TOWERS.amplifier.aura * (1 + (o.lv - 1) * .35);
        }
      }
      return {
        dmg: def.dmg * lvD * ter.dmg * (1 + aura) * (this.godMode ? 30 : 1),
        range: def.range * lvR * ter.range * this.cell,
        cd: Math.max(.16, def.cd * lvC * ter.cd * (1 - Math.min(.25, aura * .4))),
        aura, splash: (def.splash || 0) * (1 + (t.lv - 1) * .12) * this.cell,
        slow: def.slow || 0, slowT: def.slowT || 0,
        mark: def.mark || 1, markT: def.markT || 0,
        income: Math.round(def.income * (1 + (t.lv - 1) * .7))
      };
    }

    /* ---------------- 波次 ---------------- */
    buildSpawnQueue(n) {
      const w = WAVES[n - 1], q = [];
      let t = 0;
      for (const g of w.groups) {
        for (let i = 0; i < g.n; i++) { q.push({ at: t, type: g.t }); t += g.gap; }
        t += .7;
      }
      return q;
    }

    startWave(n) {
      this.wave = n;
      this.waveState = 'running';
      this.spawnQueue = this.buildSpawnQueue(n);
      this.spawnClock = 0;
      this._waveStartLink = Math.ceil(this.link);
      this._waveLeaks = 0; this._waveDmg = 0; this._waveDeepest = 0;
      const w = WAVES[n - 1];
      const banner = this.d.waveBanner;
      banner.classList.remove('hidden', 'boss');
      // 重启动画
      banner.style.animation = 'none'; void banner.offsetWidth; banner.style.animation = '';
      if (w.boss) banner.classList.add('boss');
      this.d.waveKicker.textContent = w.boss ? 'HIGH-ENERGY EVENT DETECTED' : (w.elite ? 'ELITE INTERFERENCE' : 'INCOMING BACKGROUND');
      this.d.waveTitle.textContent = 'WAVE ' + String(n).padStart(2, '0');
      this.d.waveSub.textContent = w.label;
      setTimeout(() => banner.classList.add('hidden'), 2650);
      A.setIntensity(n / TOTAL_WAVES, !!w.boss);
      if (w.boss) {
        A.boss(); this.fx.tint = 1; this.fx.shake = 12;
        this.flashScreen('', .9);
        this.toast('⚠ 高能事件逼近 · 阵列对准');
      } else { A.waveStart(n); }
      this.syncHUD(true);
    }

    forceNextWave() {
      if (this.phase !== 'playing' || this.waveState !== 'prep') return;
      if (this.wave >= TOTAL_WAVES) return;
      this.energy += 10;
      this.toast('提前开启观测窗口 · 光子预算 +10');
      this.prepTimer = 0;
      this.startWave(this.wave + 1);
    }

    waveClear() {
      this.pushWaveTrace();
      if (this.wave >= TOTAL_WAVES) { this.win(); return; }
      this.waveState = 'prep';
      this.prepTimer = 9;
      const bonus = 14 + this.wave;
      this.energy += bonus;
      A.waveClear();
      this.toast(`第 ${this.wave} 波干扰已滤除 · 光子预算 +${bonus}`);
      this.syncHUD(true);
    }

    /** 记录本波「最深穿透深度 / 漏怪数 / 掉血」，用于难度曲线取证 */
    pushWaveTrace() {
      if (!this.wave) return;
      this.waveTrace.push({
        wave: this.wave, link: Math.ceil(this.link),
        leaks: this._waveLeaks, dmg: this._waveDmg,
        deepest: +this._waveDeepest.toFixed(2)
      });
    }

    spawnEnemy(type, atDist) {
      const def = ENEMIES[type];
      // 噪声强度按「威胁波次」计算：BOSS 波的伴随干扰沿用第 11 波强度，
      // 避免最后一波同时叠加「更厚的杂兵」与「BOSS」，把压力变成一道突然的墙。
      const tw = (def.boss || this.wave >= TOTAL_WAVES) ? Math.min(this.wave, TOTAL_WAVES - 1) : this.wave;
      const hpMul = def.boss ? 1 : (1 + (tw - 1) * .38) * pressureAt(tw);
      const hp = Math.round(def.hp * hpMul);
      const dist = atDist === undefined ? 0 : atDist;
      const p = this.posAt(dist);
      const e = {
        id: this.uid++, type, hp, maxHp: hp, dist,
        spd: def.spd * this.cell, color: def.color, r: def.r * this.cell,
        x: p.x, y: p.y, trail: [], slow: 0, slowT: 0, markT: 0,
        hitFlash: 0, phase: this.rnd() * TAU, dead: false,
        boss: !!def.boss, leak: def.leak, reward: def.reward
      };
      this.enemies.push(e);
      if (e.boss) {
        this.bossRef = e; this.bossTimer = 4.8;
        this.fx.shock(p.x, p.y, '#b9a4ff');
      }
      return e;
    }

    /* ---------------- 战斗 ---------------- */
    damage(e, dmg, color) {
      if (e.dead) return;
      let d = dmg * (e.markT > 0 ? TOWERS.coincidence.mark : 1);
      e.hp -= d; e.hitFlash = .16;
      this.stats.damage += d;
      if (this.godMode) d = Math.min(d, 99999);
      this.fx.spark(e.x, e.y, { color: color || '#d8f6ff', speed: rand(20, 80), r: 1.6, life: .3 });
      if (e.hp <= 0) this.kill(e);
    }

    kill(e) {
      if (e.dead) return;
      e.dead = true;
      this.stats.kills++;
      this.energy += e.reward; this.score += e.reward;
      const scale = e.boss ? 3 : (e.maxHp > 100 ? 1.5 : 1);
      this.fx.ring(e.x, e.y, { r0: 2, r1: 34 * scale, color: e.color, w: 2, life: .4 });
      this.fx.sparks(e.x, e.y, Math.min(26, 6 + 5 * scale | 0), { color: e.boss ? '#e7dcff' : '#b9ecff', speed: rand(40, 170) * scale, life: .6 });
      if (e.boss) {
        this.fx.cherenkov(e.x, e.y, 2.2, true);
        this.fx.shock(e.x, e.y, '#c9b0ff');
        this.flashScreen('', 1.1);
      } else if (Math.random() < .55) A.kill();
      if (e.boss) { this.bossRef = null; this.win(); }
      this.syncHUD(true);
    }

    leak(e) {
      const dmg = e.leak;
      if (e.boss) this.stats.bossPasses = (this.stats.bossPasses || 0) + 1;
      this.link = Math.max(0, this.link - dmg);
      this.stats.leaked++;
      this.stats.leakDamage += dmg;
      this._waveLeaks++; this._waveDmg += dmg;
      A.leak();
      this.fx.shock(this.core.x, this.core.y, '#ff7896');
      this.flashScreen('hit', e.boss ? .85 : .45);
      this.fx.shake = e.boss ? 20 : 12;
      // 把损失直接写在链路旁边：玩家必须能看懂「刚刚掉了多少」
      this.fx.text(this.core.x, this.core.y - this.cell * .85, `-${dmg}%`,
        { color: '#ff8fa8', size: Math.max(14, this.cell * (e.boss ? .3 : .17)), life: 1.15 });
      if (this.link <= 0) { this.lose(); return; }
      if (e.boss) this.bossPenetrated(e);
      this.syncHUD(true);
    }

    /** BOSS 穿透链路：重创但不结束，被弹回注入口重新进入 —— 变成一场可见的 DPS 竞赛 */
    bossPenetrated(e) {
      e.dist = 0; e.trail.length = 0;
      const p = this.posAt(0); e.x = p.x; e.y = p.y;
      this.enemies.push(e);
      this.bossTimer = 4.8;
      this.fx.cherenkov(this.core.x, this.core.y, 1.6, false);
      this.fx.ring(this.core.x, this.core.y, { r0: 6, r1: this.cell * 3, color: '#ff9ab0', w: 2.5, life: .7 });
      A.boss();
      this.toast(`幽灵穿透阵列 · 链路 -${e.leak}% · 重新捕获窗口开启`);
    }

    fire(t, s) {
      const def = TOWERS[t.type];
      // 增益器不依赖敌人，周期性产出光子并给邻位脉冲
      if (t.type === 'amplifier') {
        this.fx.ring(t.x, t.y, { r0: 4, r1: s.range, color: def.color, w: 1.6, life: .6 });
        this.energy += s.income; this.score += 2;
        this.fx.text(t.x, t.y - this.cell * .5, `+${s.income}`, { color: def.color, size: 12, life: .8 });
        A.shoot(t.type);
        return true;
      }
      const targets = this.enemies.filter(e => !e.dead &&
        Math.hypot(e.x - t.x, e.y - t.y) <= s.range).sort((a, b) => b.dist - a.dist);
      if (!targets.length) return false;
      const main = targets[0];
      t.angle = Math.atan2(main.y - t.y, main.x - t.x);
      t.pulse = 1;
      A.shoot(t.type);

      if (def.pierce) {
        // 贯穿光束：从塔沿目标方向射出，命中线段附近所有敌人
        const ex = t.x + Math.cos(t.angle) * s.range, ey = t.y + Math.sin(t.angle) * s.range;
        this.fx.beam(t.x, t.y, ex, ey, { color: def.color, w: 3 + t.lv, life: .22 });
        this.fx.cone(t.x, t.y, { ang: t.angle, len: s.range, half: .12, color: def.color, life: .22 });
        for (const e of this.enemies) {
          if (e.dead) continue;
          const dx = e.x - t.x, dy = e.y - t.y;
          const proj = dx * Math.cos(t.angle) + dy * Math.sin(t.angle);
          if (proj < 0 || proj > s.range) continue;
          const perp = Math.abs(-dx * Math.sin(t.angle) + dy * Math.cos(t.angle));
          if (perp < this.cell * .38 + e.r * .5) this.damage(e, s.dmg, def.color);
        }
      } else if (t.type === 'coincidence') {
        // 多重符合：连接多个目标，施加减速与标记
        const list = targets.slice(0, def.multi + Math.floor((t.lv - 1) / 2));
        for (const e of list) {
          this.fx.beam(t.x, t.y, e.x, e.y, { color: def.color, w: 1.8, life: .2 });
          this.fx.ring(e.x, e.y, { r0: 2, r1: e.r * 2.2, color: def.color, w: 1.4, life: .35 });
          e.slow = Math.max(e.slow, s.slow); e.slowT = Math.max(e.slowT, s.slowT);
          e.markT = Math.max(e.markT, s.markT);
          this.damage(e, s.dmg, def.color);
        }
      } else {
        // 弹丸（单体 / 溅射）
        this.bullets.push({
          x: t.x, y: t.y, target: main, dmg: s.dmg, spd: this.cell * 7.5,
          color: def.color, splash: s.splash, kind: t.type, life: 1.4,
          px: t.x, py: t.y
        });
        this.fx.ring(t.x, t.y, { r0: 1, r1: this.cell * .35, color: def.color, w: 1.5, life: .2 });
      }
      return true;
    }

    updateBullets(dt) {
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        const b = this.bullets[i];
        b.life -= dt;
        let tx, ty;
        if (b.target && !b.target.dead) { tx = b.target.x; ty = b.target.y; }
        else { tx = b.lx === undefined ? b.x : b.lx; ty = b.ly === undefined ? b.y : b.ly; }
        b.lx = tx; b.ly = ty;
        const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy);
        const step = b.spd * dt;
        b.px = b.x; b.py = b.y;
        if (d <= step + 4 || b.life <= 0) {
          if (b.target && !b.target.dead) {
            this.damage(b.target, b.dmg, b.color);
            if (b.splash > 0) {
              this.fx.ring(tx, ty, { r0: 3, r1: b.splash, color: b.color, w: 2.5, life: .38 });
              this.fx.cone(tx, ty, { len: b.splash * 1.2, half: 1.1, color: b.color, life: .3 });
              for (const e of this.enemies) {
                if (e.dead || e === b.target) continue;
                if (Math.hypot(e.x - tx, e.y - ty) <= b.splash) this.damage(e, b.dmg * .62, b.color);
              }
            } else {
              this.fx.ring(tx, ty, { r0: 1, r1: 14, color: b.color, w: 1.5, life: .22 });
            }
          }
          this.bullets.splice(i, 1);
        } else {
          b.x += dx / d * step; b.y += dy / d * step;
        }
      }
    }

    bossPulse() {
      const b = this.bossRef;
      if (!b || b.dead) return;
      A.bossPulse();
      this.fx.shock(b.x, b.y, '#c9b0ff');
      this.fx.tint = .85;
      // 随机使 2 座装置短暂离线：这是 BOSS 战唯一的干扰机制，
      // 不再额外生成隐藏杂兵——第 12 波的伴随噪声已由波次表明确给出，
      // 否则失败会被看不见的刷怪量决定，玩家无法从画面理解发生了什么。
      const active = this.towers.filter(t => t.disabled <= 0);
      for (let i = 0; i < Math.min(2, active.length); i++) {
        const t = active.splice(Math.floor(this.rnd() * active.length), 1)[0];
        t.disabled = 2.2;
        this.fx.ring(t.x, t.y, { r0: 2, r1: this.cell * .6, color: '#ff9ab0', w: 2, life: .5 });
      }
      this.toast('幽灵脉冲 · 部分装置离线');
    }

    update(dt) {
      this.gameTime += dt;
      const time = this.gameTime;
      this.fx.update(dt);
      if (this.bossRef && !this.bossRef.dead) {
        this.bossTimer -= dt;
        A.heartbeat();
        if (this.bossTimer <= 0) { this.bossTimer = 4.8; this.bossPulse(); }
        const frac = this.bossRef.hp / this.bossRef.maxHp;
        const step = Math.floor(frac * 4);
        if (step < this.bossStep) { this.bossStep = step; this.bossPulse(); }
      }

      // 波次调度
      if (this.waveState === 'prep') {
        this.prepTimer -= dt;
        if (this.prepTimer <= 0) this.startWave(this.wave + 1);
      } else {
        this.spawnClock += dt;
        while (this.spawnQueue.length && this.spawnQueue[0].at <= this.spawnClock) {
          this.spawnEnemy(this.spawnQueue.shift().type);
        }
      }

      // 塔
      for (const t of this.towers) {
        if (t.disabled > 0) { t.disabled -= dt; continue; }
        t.pulse = Math.max(0, t.pulse - dt * 3);
        t.cd -= dt;
        if (t.cd <= 0) {
          const s = this.towerStats(t);
          const fired = this.fire(t, s);
          t.cd = fired ? s.cd : .12;
        }
      }

      // 敌人
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (e.dead) { this.enemies.splice(i, 1); continue; }
        e.hitFlash = Math.max(0, e.hitFlash - dt);
        if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slow = 0; }
        if (e.markT > 0) e.markT -= dt;
        e.dist += e.spd * (1 - e.slow) * dt;
        const p = this.posAt(e.dist);
        e.trail.push({ x: e.x, y: e.y });
        if (e.trail.length > (e.boss ? 18 : 8)) e.trail.shift();
        e.x = p.x; e.y = p.y;
        if (e.dist / this.pathLen > this._waveDeepest) this._waveDeepest = e.dist / this.pathLen;
        if (e.dist >= this.pathLen) {
          this.enemies.splice(i, 1);
          this.leak(e);
          if (this.phase !== 'playing') return;
        }
      }

      this.updateBullets(dt);

      // 波次清空判定
      if (this.waveState === 'running' && this.spawnQueue.length === 0 && this.enemies.length === 0 && this.bullets.length === 0) {
        this.waveClear();
      }

      this.hudT += dt;
      if (this.hudT > .18) { this.hudT = 0; this.syncHUD(); }
    }

    /* ---------------- 结算 ---------------- */
    win() {
      if (this.phase !== 'playing') return;
      this.pushWaveTrace();
      this.phase = 'win';
      A.win(); A.setIntensity(1, false);
      this.d.waveBanner.classList.add('hidden');
      this.d.toast.classList.add('hidden');
      const W = this.W, H = this.H;
      // 切伦科夫蓝光全屏高潮
      // 视觉高潮：切伦科夫蓝光先独占画面约 2 秒，再浮出结算面板
      this.fx.cherenkov(this.core.x, this.core.y, 3.6, false);
      this.fx.cherenkov(W * .32, H * .45, 2.6, false);
      this.fx.cherenkov(W * .68, H * .6, 2.8, false);
      this.flashScreen('', 2.0);
      for (let i = 0; i < 12; i++) {
        this.fx.cone(W * .5, H * .5, {
          ang: i / 12 * TAU, len: Math.max(W, H) * .95, half: .13,
          color: i % 3 === 0 ? '#e6fbff' : '#8fe4ff', life: 1.9, spin: .18
        });
      }
      for (let i = 0; i < 26; i++) {
        this.fx.spark(W * .5, H * .5, {
          ang: Math.random() * TAU, speed: rand(120, 520), r: rand(1.5, 3.6),
          color: '#d8f6ff', life: rand(.9, 1.8), drag: .7
        });
      }
      setTimeout(() => {
        if (this.phase !== 'win') return;
        this.fx.cherenkov(W * .5, H * .5, 2.4, false);
        this.fx.ring(W * .5, H * .5, { r0: 10, r1: Math.max(W, H), color: '#a8ecff', w: 3, life: 1.2 });
      }, 620);
      this.showResult(true);
    }

    lose() {
      if (this.phase !== 'playing') return;
      this.pushWaveTrace();
      this.phase = 'lose';
      A.lose(); A.setIntensity(0, false);
      this.fx.shake = 14;
      this.showResult(false);
    }

    showResult(won) {
      const d = this.d;
      const panel = d.result.querySelector('.result-panel');
      panel.classList.toggle('lose', !won);
      $('resKicker').textContent = won ? 'OBSERVATION COMPLETE / 事件捕获' : 'DATA LINK LOST / 链路中断';
      $('resTitle').textContent = won ? '高能中微子事件 · 捕获成功' : '数据链路被背景干扰击穿';
      $('resDesc').textContent = won
        ? `最后一束切伦科夫蓝光穿过 1450 米深冰，阵列完整记录下这次来自宇宙深处的稀有信号。链路剩余 ${Math.ceil(this.link)}%。`
        : (this.wave >= TOTAL_WAVES
            ? `宇宙幽灵第 ${this.stats.bossPasses} 次穿透数据链路（每次 −${ENEMIES.ghost.leak}%），观测窗口关闭。进入 BOSS 波时链路只剩 ${this._waveStartLink}%——真正决定成败的，是穿透发生前你攒下了多少余量。`
            : `观测在第 ${this.wave} 波中断：链路被逐波累积的背景干扰耗尽（本局漏过 ${this.stats.leaked} 个干扰，累计损失 ${this.stats.leakDamage}%）。检查哪几段裂隙通道没有被钻孔覆盖，并优先把同种装置合成到 Lv.3 以上。`);
      const stars = won ? (this.link >= 80 && this.stats.maxLv >= 4 ? 3 : (this.link >= 50 ? 2 : 1)) : 0;
      $('resStars').innerHTML = [0, 1, 2].map(i => `<span class="${i < stars ? '' : 'off'}">★</span>`).join('');
      $('resStats').innerHTML = `
        <div><span>到达波次</span><b>${this.wave} / ${TOTAL_WAVES}</b></div>
        <div><span>滤除干扰</span><b>${this.stats.kills}</b></div>
        <div><span>合成次数</span><b>${this.stats.merges}</b></div>
        <div><span>最高等级</span><b>Lv.${this.stats.maxLv}</b></div>`;
      $('resScience').innerHTML = won
        ? `<b>科学笔记 · 为什么是蓝光？</b><br>中微子几乎不与物质作用，但偶尔会在冰中与原子核碰撞，产生以超过冰中光速运动的带电粒子。它们激发「切伦科夫辐射」——一道锥形蓝光。IceCube 用 5000 多个光学模块记录光子到达时间，反推出中微子的方向与能量。你刚刚做的，正是把宇宙线背景噪声滤掉，留下那一个真正重要的事件。`
        : `<b>科学笔记 · 背景有多吵？</b><br>真实观测站每秒记录到的大气 μ 子背景，远比稀有中微子事件多得多。科学家靠「多重符合触发」和深冰屏蔽来压低噪声——就像这一关里，你需要用符合触发器与合成后的高等级阵列，把干扰挡在数据链路之外。`;
      setTimeout(() => d.result.classList.remove('hidden'), won ? 1900 : 500);
    }

    /* ---------------- HUD / 提示 ---------------- */
    syncHUD(force) {
      const d = this.d;
      d.valLink.textContent = Math.ceil(this.link);
      d.barLink.style.width = this.link + '%';
      d.valLink.parentElement.parentElement.classList.toggle('low', this.link < 35);
      d.valEnergy.textContent = Math.floor(this.energy);
      d.valWave.textContent = this.wave;
      d.valScore.textContent = this.score;
      const cost = this.deployCost();
      d.deployCost.textContent = cost + ' 光子' + (cost > DEPLOY_COST ? ' ↑' : '');
      const pair = this.findMergePair();
      d.mergeCount.textContent = pair ? `可合成 ${SHORT_NAME[pair[0].type]} Lv.${pair[0].lv}` : '无可用合成';
      d.btnAutoDeploy.disabled = this.energy < cost || this.emptyCells().length === 0;
      d.btnAutoMerge.disabled = !pair;
      if (this.waveState === 'prep' && this.phase === 'playing') {
        d.btnNextWave.disabled = false;
        d.btnNextWave.classList.add('ready');
        d.nextWaveSub.textContent = `准备中 ${Math.max(0, Math.ceil(this.prepTimer))}s · +10`;
        $('dockHint') && ($('dockHint').innerHTML = '点击冰层中的<b>空钻孔</b>部署探测装置 · 拖动可移动 / 合成');
      } else {
        d.btnNextWave.disabled = true;
        d.btnNextWave.classList.remove('ready');
        d.nextWaveSub.textContent = this.phase === 'playing' ? '波次进行中' : '观测结束';
        $('dockHint') && ($('dockHint').innerHTML = '点击冰层中的<b>空钻孔</b>部署探测装置 · 拖动可移动 / 合成');
      }
      if (this.selected && !this.towers.includes(this.selected)) this.select(null);
    }

    toast(msg) {
      const el = this.d.toast;
      el.textContent = msg;
      el.classList.remove('hidden');
      el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => el.classList.add('hidden'), 2200);
    }

    flashScreen(cls, dur) {
      const el = this.d.flash;
      el.className = cls || '';
      el.style.transition = 'none'; el.style.opacity = '1';
      void el.offsetWidth;
      requestAnimationFrame(() => {
        el.style.transition = `opacity ${dur || .5}s ease-out`;
        el.style.opacity = '0';
      });
    }

    /* ======================= 绘制 ======================= */
    render() {
      const c = this.ctx, W = this.W, H = this.H, t = this.gameTime;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.save();
      if (this.fx.shake > .2) c.translate(rand(-this.fx.shake, this.fx.shake), rand(-this.fx.shake, this.fx.shake));

      this.backdrop.draw(c, t, 1 / 60);
      if (this.phase === 'title') {
        this.drawTitleAmbience(c, t);
      } else {
        this.drawDecor(c, t);
        this.drawPath(c, t);
        this.drawHoles(c, t);
        this.drawCore(c, t);
        this.drawRangePreview(c, t);
        for (const tw of this.towers) this.drawTower(c, tw, t);
        this.drawBullets(c);
        for (const e of this.enemies) this.drawEnemy(c, e, t);
        this.fx.draw(c);
        this.drawDrag(c);
        this.drawBossBar(c);
      }
      this.fx.drawOverlay(c, W, H);
      c.restore();
    }

    /** 标题页专属氛围：冰下钻孔串 + 切伦科夫光柱（不显示战场，保持首屏干净） */
    drawTitleAmbience(c, t) {
      const W = this.W, H = this.H, cx = W * .5;
      c.save(); c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const off = (i - 1) * W * .06;
        const g = c.createLinearGradient(cx + off, 0, cx + off, H * .9);
        g.addColorStop(0, `rgba(120,215,255,${.085 - i * .014})`);
        g.addColorStop(1, 'rgba(30,110,200,0)');
        c.fillStyle = g;
        c.beginPath();
        c.moveTo(cx + off - W * .03, 0); c.lineTo(cx + off + W * .03, 0);
        c.lineTo(cx + off + W * .22, H * .9); c.lineTo(cx + off - W * .22, H * .9);
        c.closePath(); c.fill();
      }
      const cols = [.16, .33, .5, .67, .84];
      for (let i = 0; i < cols.length; i++) {
        const x = W * cols[i] + Math.sin(t * .22 + i) * 6;
        c.strokeStyle = 'rgba(100,195,255,.17)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(x, H * .14); c.lineTo(x, H * .86); c.stroke();
        for (let k = 0; k < 10; k++) {
          const y = H * (.16 + k * .074);
          const w = .5 + .5 * Math.sin(t * 1.5 - k * .45 + i * 1.3);
          const a = .18 + w * .5;
          glow(c, x, y, 20 + w * 12, 'rgba(90,200,255,ALPHA)', a * .28);
          c.fillStyle = `rgba(200,242,255,${a * .75})`;
          c.beginPath(); c.arc(x, y, 1.8 + w * 1.5, 0, TAU); c.fill();
        }
      }
      for (let i = 0; i < 3; i++) {
        const p = (t * .18 + i / 3) % 1;
        c.strokeStyle = `rgba(120,215,255,${(1 - p) * .16})`;
        c.lineWidth = 1.2;
        c.beginPath(); c.arc(cx, H * .5, 40 + p * Math.min(W, H) * .55, 0, TAU); c.stroke();
      }
      for (let i = 0; i < 26; i++) {
        const x = (i * 137.5) % W, y = (i * 89.3) % H + Math.sin(t * .3 + i) * 12;
        const a = .2 + .3 * Math.sin(t * 1.2 + i * 2.1);
        c.fillStyle = `rgba(190,235,255,${Math.max(.04, a * .3)})`;
        c.beginPath(); c.arc(x, y, 1 + (i % 3) * .6, 0, TAU); c.fill();
      }
      c.restore();
    }

    drawDecor(c, t) {
      // 左侧深度刻度，制造「冰下 1450m」的仪表感
      c.save();
      c.globalAlpha = .5;
      c.strokeStyle = 'rgba(120,200,255,.28)'; c.lineWidth = 1;
      c.font = '9px ui-monospace, Consolas, monospace';
      c.fillStyle = 'rgba(140,205,240,.55)'; c.textAlign = 'left';
      const x0 = this.W < 820 ? 6 : 18;
      for (let i = 0; i <= 8; i++) {
        const y = this.top + 20 + i * (this.H - this.top - this.bottom - 40) / 8;
        c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + (i % 2 === 0 ? 13 : 7), y); c.stroke();
        if (i % 2 === 0 && this.W > 700) c.fillText(`-${1450 + i * 125}m`, x0 + 18, y + 3);
      }
      c.fillStyle = 'rgba(120,190,230,.35)';
      if (this.W > 700) {
        c.fillText('ICECUBE / DEEP ICE OPTICAL ARRAY', 18, this.H - this.bottom + 18);
        c.textAlign = 'right';
        c.fillText(`PHOTON LINK  ·  ${Math.ceil(this.link)}%`, this.W - 18, this.H - this.bottom + 18);
      }
      c.restore();
    }

    drawPath(c, t) {
      const pts = this.pathPts, cell = this.cell;
      const trace = (w, color, blur, alpha) => {
        c.save();
        c.globalAlpha = alpha;
        c.strokeStyle = color; c.lineWidth = w;
        c.lineJoin = 'round'; c.lineCap = 'round';
        if (blur) { c.shadowColor = color; c.shadowBlur = blur; }
        c.beginPath(); c.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
        c.stroke(); c.restore();
      };
      trace(cell * .72, 'rgba(24,96,165,.20)', 26, 1);
      trace(cell * .56, 'rgba(6,28,54,.88)', 0, 1);
      trace(cell * .40, 'rgba(12,52,92,.85)', 0, 1);
      trace(cell * .10, 'rgba(90,200,255,.20)', 16, 1);
      trace(cell * .025, 'rgba(150,230,255,.35)', 8, .8);

      // 沿裂隙流动的光子
      c.save(); c.globalCompositeOperation = 'lighter';
      const speed = 46;
      for (let i = 0; i < 24; i++) {
        const d = ((t * speed + i * this.pathLen / 24) % this.pathLen);
        const p = this.posAt(d);
        glow(c, p.x, p.y, cell * .16, 'rgba(130,220,255,ALPHA)', .35);
        c.beginPath(); c.arc(p.x, p.y, 1.2, 0, TAU);
        c.fillStyle = 'rgba(210,245,255,.8)'; c.fill();
      }
      c.restore();

      // 入口：宇宙线背景注入口
      const s = pts[0];
      c.save(); c.translate(s.x, s.y);
      c.rotate(t * .5);
      c.strokeStyle = 'rgba(160,140,255,.55)'; c.lineWidth = 1.5;
      c.setLineDash([cell * .18, cell * .14]);
      c.beginPath(); c.arc(0, 0, cell * .34, 0, TAU); c.stroke();
      c.setLineDash([]);
      c.rotate(-t * .9);
      c.strokeStyle = 'rgba(190,170,255,.35)';
      c.beginPath(); c.arc(0, 0, cell * .22, 0, TAU * .7); c.stroke();
      c.restore();
      glow(c, s.x, s.y, cell * .5, 'rgba(140,110,240,ALPHA)', .22);
    }

    drawHoles(c, t) {
      const cell = this.cell;
      const pair = this.selected ? this.findMergePair(this.selected) : null;
      const mergeTargets = pair ? pair.filter(x => x !== this.selected) : [];
      for (let r = 0; r < ROWS; r++) for (let col = 0; col < COLS; col++) {
        if (this.isPath(col, r)) continue;
        const p = this.center(col, r), x = p.x, y = p.y;
        if (!this.isActive(col, r)) {
          // 未钻探冰层：只留极淡的轮廓与冰点，和可用钻孔形成明确层级
          c.fillStyle = 'rgba(6,26,48,.30)';
          c.beginPath(); c.arc(x, y, cell * .32, 0, TAU); c.fill();
          c.strokeStyle = 'rgba(100,165,210,.10)'; c.lineWidth = 1;
          c.beginPath(); c.arc(x, y, cell * .36, 0, TAU); c.stroke();
          c.fillStyle = 'rgba(140,195,230,.13)';
          c.beginPath(); c.arc(x - cell * .08, y - cell * .06, 1.2, 0, TAU); c.fill();
          c.beginPath(); c.arc(x + cell * .11, y + cell * .1, .9, 0, TAU); c.fill();
          continue;
        }
        const ter = TERRAIN[this.terrainAt(col, r)];
        const occupied = this.towerAt(col, r);
        const hover = this.hoverCell && this.hoverCell.c === col && this.hoverCell.r === r;
        const isTarget = mergeTargets.some(x2 => x2 === occupied);
        const breath = .5 + .5 * Math.sin(t * 1.7 + col * .7 + r * 1.1);

        // 孔壁
        const g = c.createRadialGradient(x - cell * .08, y - cell * .1, cell * .02, x, y, cell * .44);
        g.addColorStop(0, occupied ? 'rgba(16,58,96,.55)' : 'rgba(10,40,72,.48)');
        g.addColorStop(.7, 'rgba(4,20,40,.55)');
        g.addColorStop(1, 'rgba(2,12,26,.15)');
        c.fillStyle = g;
        c.beginPath(); c.arc(x, y, cell * .42, 0, TAU); c.fill();

        c.strokeStyle = hexA(ter.color, .20 + breath * .08);
        c.lineWidth = 1;
        c.beginPath(); c.arc(x, y, cell * .40, 0, TAU); c.stroke();

        // 地形标识
        if (ter === TERRAIN.pure) {
          c.strokeStyle = hexA(ter.color, .42); c.lineWidth = 1.4;
          c.beginPath(); c.arc(x, y, cell * .31, -1.1, 1.1); c.stroke();
          c.beginPath(); c.arc(x, y, cell * .31, 2.05, 4.25); c.stroke();
        } else if (ter === TERRAIN.resonant) {
          c.strokeStyle = hexA(ter.color, .38); c.lineWidth = 1;
          c.beginPath(); c.arc(x, y, cell * .27, 0, TAU); c.stroke();
          c.beginPath(); c.arc(x, y, cell * .35, 0, TAU); c.stroke();
        } else if (ter === TERRAIN.bubble) {
          c.fillStyle = hexA(ter.color, .35);
          for (let i = 0; i < 5; i++) {
            const a = i / 5 * TAU + .3;
            c.beginPath(); c.arc(x + Math.cos(a) * cell * .27, y + Math.sin(a) * cell * .27, 1.3, 0, TAU); c.fill();
          }
        }

        if (!occupied) {
          const a = .16 + breath * .18 + (hover ? .22 : 0);
          glow(c, x, y, cell * .34, tpl(ter.color), a * .5);
          if (hover) {
            c.strokeStyle = hexA('#b9ecff', .8); c.lineWidth = 1.8;
            c.beginPath(); c.arc(x, y, cell * .42, 0, TAU); c.stroke();
            c.fillStyle = 'rgba(200,240,255,.65)'; c.font = `600 ${Math.max(10, cell * .24)}px sans-serif`;
            c.textAlign = 'center'; c.textBaseline = 'middle';
            c.fillText('＋', x, y + 1);
          }
        }
        if (isTarget) {
          c.save();
          c.strokeStyle = `rgba(255,225,150,${.5 + breath * .5})`;
          c.lineWidth = 2; c.shadowColor = '#ffd98a'; c.shadowBlur = 12;
          c.beginPath(); c.arc(x, y, cell * (.44 + breath * .05), 0, TAU); c.stroke();
          c.restore();
        }
      }
    }

    drawCore(c, t) {
      const { x, y } = this.core, cell = this.cell;
      const frac = this.link / 100;
      const col = frac > .35 ? '#7fe4ff' : '#ff7896';
      c.save(); c.globalCompositeOperation = 'lighter';
      glow(c, x, y, cell * 1.5, tpl(col), .28 + .08 * Math.sin(t * 2));
      c.restore();
      c.save(); c.translate(x, y);
      // 外层数据环
      c.strokeStyle = hexA(col, .55); c.lineWidth = 2;
      c.beginPath(); c.arc(0, 0, cell * .44, 0, TAU); c.stroke();
      c.save(); c.rotate(t * .6);
      c.setLineDash([cell * .12, cell * .10]);
      c.strokeStyle = hexA(col, .7); c.lineWidth = 1.5;
      c.beginPath(); c.arc(0, 0, cell * .56, 0, TAU); c.stroke();
      c.restore();
      // 完整度扇形
      c.strokeStyle = hexA(col, .9); c.lineWidth = 3;
      c.beginPath(); c.arc(0, 0, cell * .44, -Math.PI / 2, -Math.PI / 2 + TAU * frac); c.stroke();
      // 中心数据核
      const g = c.createRadialGradient(0, 0, 0, 0, 0, cell * .32);
      g.addColorStop(0, 'rgba(235,252,255,.95)');
      g.addColorStop(.35, hexA(col, .65));
      g.addColorStop(1, 'rgba(6,30,58,.9)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, cell * .3, 0, TAU); c.fill();
      // 旋转扫描
      c.rotate(t * 1.4);
      c.strokeStyle = 'rgba(230,250,255,.5)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(0, 0); c.lineTo(cell * .28, 0); c.stroke();
      c.restore();
      c.fillStyle = 'rgba(170,225,255,.65)';
      c.font = `${Math.max(8, cell * .17)}px ui-monospace, Consolas, monospace`;
      const narrow = this.W < 820;
      c.textAlign = narrow ? 'right' : 'center';
      c.fillText(narrow ? 'LINK' : 'DATA LINK', narrow ? this.W - 6 : x, y + cell * .78);
    }

    drawRangePreview(c, t) {
      const s = this.selected;
      if (!s) return;
      const st = this.towerStats(s), def = TOWERS[s.type];
      c.save();
      c.setLineDash([6, 7]); c.lineDashOffset = -t * 18;
      c.strokeStyle = hexA(def.color, .55); c.lineWidth = 1.5;
      c.beginPath(); c.arc(s.x, s.y, st.range, 0, TAU); c.stroke();
      c.setLineDash([]);
      c.fillStyle = hexA(def.color, .05);
      c.beginPath(); c.arc(s.x, s.y, st.range, 0, TAU); c.fill();
      // 选中环
      c.strokeStyle = hexA('#e6fbff', .9); c.lineWidth = 2;
      c.shadowColor = def.color; c.shadowBlur = 14;
      c.beginPath(); c.arc(s.x, s.y, this.cell * (.46 + .03 * Math.sin(t * 5)), 0, TAU); c.stroke();
      c.restore();
    }

    drawTower(c, t, time) {
      const def = TOWERS[t.type], s = this.cell, x = t.x, y = t.y;
      const dis = t.disabled > 0;
      const col = dis ? '#5f8098' : def.color;
      const breath = .5 + .5 * Math.sin(time * 2.3 + t.id * 1.7);
      const born = Math.min(1, (time - t.born) * 4);
      c.save(); c.translate(x, y); c.scale(born, born);
      c.globalCompositeOperation = 'lighter';
      glow(c, 0, 0, s * (.62 + breath * .09 + t.pulse * .25), tpl(col), dis ? .10 : .26 + breath * .12 + t.pulse * .25);
      c.globalCompositeOperation = 'source-over';

      // 底座
      const g = c.createRadialGradient(-s * .1, -s * .12, 0, 0, 0, s * .36);
      g.addColorStop(0, hexA(col, .38));
      g.addColorStop(.6, 'rgba(7,32,60,.94)');
      g.addColorStop(1, 'rgba(2,14,32,.98)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, s * .35, 0, TAU); c.fill();
      c.strokeStyle = hexA(col, .6); c.lineWidth = 1.2;
      c.beginPath(); c.arc(0, 0, s * .35, 0, TAU); c.stroke();

      c.save();
      c.rotate(t.angle);
      c.globalCompositeOperation = 'lighter';
      c.strokeStyle = hexA(col, .75); c.lineWidth = 1.3;
      c.shadowColor = col; c.shadowBlur = 9;

      switch (t.type) {
        case 'dom': {
          // PMT 球形光电倍增管 + 内部网格
          c.beginPath(); c.arc(0, 0, s * .21, 0, TAU); c.stroke();
          for (let i = -1; i <= 1; i++) {
            c.beginPath(); c.moveTo(i * s * .09, -s * .16); c.lineTo(i * s * .09, s * .16); c.stroke();
            c.beginPath(); c.moveTo(-s * .16, i * s * .09); c.lineTo(s * .16, i * s * .09); c.stroke();
          }
          c.fillStyle = hexA('#e6fbff', .9);
          c.beginPath(); c.arc(0, 0, s * (.055 + t.pulse * .05), 0, TAU); c.fill();
          c.beginPath(); c.arc(0, 0, s * .28, time * 1.5, time * 1.5 + 1.5); c.stroke();
          break;
        }
        case 'cascade': {
          for (let i = 0; i < 3; i++) {
            const a = time * .7 + i / 3 * TAU;
            const px = Math.cos(a) * s * .15, py = Math.sin(a) * s * .15;
            c.beginPath();
            for (let k = 0; k < 6; k++) {
              const aa = k / 6 * TAU + a;
              const xx = px + Math.cos(aa) * s * .10, yy = py + Math.sin(aa) * s * .10;
              k ? c.lineTo(xx, yy) : c.moveTo(xx, yy);
            }
            c.closePath(); c.stroke();
          }
          c.fillStyle = hexA('#e6fbff', .85);
          c.beginPath(); c.arc(0, 0, s * (.05 + t.pulse * .06), 0, TAU); c.fill();
          break;
        }
        case 'track': {
          // 细长 μ 子径迹
          c.beginPath(); c.moveTo(-s * .27, 0); c.lineTo(s * .27, 0); c.stroke();
          c.beginPath(); c.moveTo(s * .07, -s * .13); c.lineTo(s * .27, 0); c.lineTo(s * .07, s * .13); c.stroke();
          c.fillStyle = hexA('#e6fbff', .9);
          c.beginPath(); c.arc(s * .27, 0, s * .045 + t.pulse * .04, 0, TAU); c.fill();
          c.beginPath(); c.arc(0, 0, s * .055, 0, TAU); c.fill();
          break;
        }
        case 'coincidence': {
          c.beginPath(); c.arc(0, 0, s * .24, 0, TAU); c.stroke();
          c.beginPath(); c.arc(0, 0, s * .13, 0, TAU); c.stroke();
          c.beginPath(); c.moveTo(-s * .27, 0); c.lineTo(s * .27, 0);
          c.moveTo(0, -s * .27); c.lineTo(0, s * .27); c.stroke();
          for (let i = 0; i < 4; i++) {
            const a = time * 1.1 + i / 4 * TAU;
            c.fillStyle = hexA('#e6fbff', .8);
            c.beginPath(); c.arc(Math.cos(a) * s * .24, Math.sin(a) * s * .24, s * .028, 0, TAU); c.fill();
          }
          break;
        }
        case 'amplifier': {
          c.rotate(time * .5);
          c.beginPath(); c.moveTo(0, -s * .26); c.lineTo(s * .26, 0); c.lineTo(0, s * .26); c.lineTo(-s * .26, 0);
          c.closePath(); c.stroke();
          c.beginPath(); c.arc(0, 0, s * .32, 0, TAU); c.stroke();
          c.fillStyle = hexA('#e6fbff', .85);
          c.beginPath(); c.arc(0, 0, s * .06, 0, TAU); c.fill();
          break;
        }
      }
      c.restore();

      // 等级标记
      c.globalCompositeOperation = 'lighter';
      for (let i = 0; i < t.lv; i++) {
        const px = (i - (t.lv - 1) / 2) * s * .115;
        c.fillStyle = i < t.lv ? hexA(col, .95) : 'rgba(120,160,190,.3)';
        c.shadowColor = col; c.shadowBlur = 7;
        c.beginPath(); c.arc(px, s * .47, s * .036, 0, TAU); c.fill();
      }
      c.shadowBlur = 0;

      if (dis) {
        c.globalCompositeOperation = 'source-over';
        c.strokeStyle = `rgba(255,120,150,${.4 + .4 * Math.sin(time * 12)})`;
        c.lineWidth = 2;
        c.beginPath(); c.arc(0, 0, s * .4, 0, TAU); c.stroke();
      }
      c.restore();
    }

    drawBullets(c) {
      const s = this.cell;
      c.save(); c.globalCompositeOperation = 'lighter';
      for (const b of this.bullets) {
        glowLine(c, b.px, b.py, b.x, b.y, b.kind === 'cascade' ? 4 : 2.4, b.color, 12, .8);
        glow(c, b.x, b.y, s * .18, tpl(b.color), .5);
        c.fillStyle = '#e6fbff';
        c.beginPath(); c.arc(b.x, b.y, b.kind === 'cascade' ? 3.2 : 2, 0, TAU); c.fill();
      }
      c.restore();
    }

    drawEnemy(c, e, time) {
      const s = this.cell, col = e.color;
      c.save(); c.globalCompositeOperation = 'lighter';
      // 拖尾
      for (let i = 0; i < e.trail.length; i++) {
        const p = e.trail[i], a = (i + 1) / e.trail.length;
        c.fillStyle = hexA(col, a * .22);
        c.beginPath(); c.arc(p.x, p.y, e.r * a * .8, 0, TAU); c.fill();
      }
      glow(c, e.x, e.y, e.r * 2.7, tpl(col), e.boss ? .45 : .3);
      c.globalCompositeOperation = 'source-over';

      c.save(); c.translate(e.x, e.y);
      const flash = e.hitFlash > 0;
      const body = flash ? '#ffffff' : col;

      if (e.type === 'muon') {
        c.rotate(Math.atan2(0, 1));
        c.fillStyle = hexA(body, .9);
        c.beginPath(); c.ellipse(0, 0, e.r * 1.35, e.r * .62, 0, 0, TAU); c.fill();
        c.strokeStyle = hexA('#e6fbff', .6); c.lineWidth = 1;
        c.beginPath(); c.ellipse(0, 0, e.r * 1.7, e.r * .85, 0, 0, TAU); c.stroke();
      } else if (e.type === 'dark') {
        c.rotate(time * 3 + e.phase);
        c.fillStyle = hexA(body, .9);
        c.beginPath(); c.moveTo(0, -e.r); c.lineTo(e.r, 0); c.lineTo(0, e.r); c.lineTo(-e.r, 0);
        c.closePath(); c.fill();
      } else if (e.type === 'shower') {
        c.rotate(time * .8 + e.phase);
        c.strokeStyle = hexA(body, .9); c.lineWidth = 2;
        c.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = k / 6 * TAU, xx = Math.cos(a) * e.r, yy = Math.sin(a) * e.r;
          k ? c.lineTo(xx, yy) : c.moveTo(xx, yy);
        }
        c.closePath(); c.stroke();
        c.fillStyle = hexA(body, .35); c.fill();
      } else if (e.type === 'cascadeN') {
        c.fillStyle = hexA(body, .55);
        c.beginPath(); c.arc(0, 0, e.r, 0, TAU); c.fill();
        c.strokeStyle = hexA('#cdefff', .8); c.lineWidth = 1.5;
        c.beginPath(); c.arc(0, 0, e.r, 0, TAU); c.stroke();
        for (let k = 0; k < 5; k++) {
          const a = time * 1.4 + k / 5 * TAU;
          c.fillStyle = hexA('#e6fbff', .8);
          c.beginPath(); c.arc(Math.cos(a) * e.r * .62, Math.sin(a) * e.r * .62, e.r * .16, 0, TAU); c.fill();
        }
      } else if (e.boss) {
        // 宇宙幽灵：旋转切伦科夫光锥 + 多层环
        c.save(); c.globalCompositeOperation = 'lighter';
        for (let k = 0; k < 4; k++) {
          const a = time * .55 + k / 4 * TAU;
          const g = c.createRadialGradient(0, 0, 0, 0, 0, e.r * 3.4);
          g.addColorStop(0, hexA(col, .5)); g.addColorStop(.3, hexA(col, .16)); g.addColorStop(1, hexA(col, 0));
          c.fillStyle = g;
          c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, e.r * 3.4, a - .22, a + .22); c.closePath(); c.fill();
        }
        c.restore();
        const g = c.createRadialGradient(0, 0, 0, 0, 0, e.r);
        g.addColorStop(0, '#ffffff'); g.addColorStop(.28, hexA(col, .95)); g.addColorStop(1, hexA('#4a2a9a', .9));
        c.fillStyle = g; c.beginPath(); c.arc(0, 0, e.r, 0, TAU); c.fill();
        c.strokeStyle = hexA('#e9dcff', .85); c.lineWidth = 2;
        c.beginPath(); c.arc(0, 0, e.r * 1.15, 0, TAU); c.stroke();
        c.save(); c.rotate(-time * .8);
        c.setLineDash([e.r * .3, e.r * .22]);
        c.strokeStyle = hexA(col, .6); c.lineWidth = 1.4;
        c.beginPath(); c.arc(0, 0, e.r * 1.5, 0, TAU); c.stroke();
        c.restore();
      }
      c.restore();

      // 状态标记
      if (e.slowT > 0 || e.markT > 0) {
        c.strokeStyle = `rgba(180,155,255,${.4 + .3 * Math.sin(time * 7)})`;
        c.lineWidth = 1.5;
        c.beginPath(); c.arc(e.x, e.y, e.r * 1.35, 0, TAU); c.stroke();
      }
      // 血条
      if (e.hp < e.maxHp && !e.boss) {
        const w = e.r * 2.4, y = e.y - e.r - 7;
        c.fillStyle = 'rgba(4,18,34,.8)'; c.fillRect(e.x - w / 2, y, w, 3);
        c.fillStyle = hexA(col, .9); c.fillRect(e.x - w / 2, y, w * clamp(e.hp / e.maxHp, 0, 1), 3);
      }
      c.restore();
    }

    drawDrag(c) {
      const d = this.drag;
      if (!d || !d.moved) return;
      c.save(); c.globalCompositeOperation = 'lighter';
      glowLine(c, d.from.x, d.from.y, d.x, d.y, 3, '#a8ecff', 18, .7);
      glow(c, d.x, d.y, this.cell * .4, tpl('#a8ecff'), .3);
      c.restore();
    }

    drawBossBar(c) {
      const b = this.bossRef;
      if (!b || b.dead) return;
      const W = this.W, w = Math.min(W * .48, 460), x = (W - w) / 2, y = this.top + 6;
      c.save();
      c.fillStyle = 'rgba(4,14,30,.85)';
      roundRect(c, x - 8, y - 12, w + 16, 30, 8); c.fill();
      c.strokeStyle = 'rgba(180,150,255,.5)'; c.lineWidth = 1; c.stroke();
      c.fillStyle = 'rgba(200,180,255,.9)';
      c.font = '10px ui-monospace, Consolas, monospace'; c.textAlign = 'center';
      c.fillText('HIGH-ENERGY EVENT · 宇宙幽灵', W / 2, y);
      c.fillStyle = 'rgba(120,90,190,.35)'; c.fillRect(x, y + 6, w, 5);
      const g = c.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, '#8a6cff'); g.addColorStop(1, '#e0d4ff');
      c.fillStyle = g; c.fillRect(x, y + 6, w * clamp(b.hp / b.maxHp, 0, 1), 5);
      c.restore();
    }

    /* ---------------- 主循环 ---------------- */
    loop(ts) {
      let dt = (ts - this.last) / 1000;
      this.last = ts;
      dt = Math.min(.05, Math.max(0, dt));
      if (this.phase === 'playing' && !this.paused) {
        const steps = this.speed === 2 ? 2 : 1;
        for (let i = 0; i < steps; i++) { this.update(dt); if (this.phase !== 'playing') break; }
      } else {
        // 结算 / 标题界面保留特效余晖
        this.gameTime += dt * .35;
        this.fx.update(dt);
      }
      this.render();
      requestAnimationFrame(t => this.loop(t));
    }

    /** 自动化测试用：以固定步长推进真实游戏逻辑（不经 rAF） */
    advance(seconds, step) {
      step = step || 1 / 30;
      let n = Math.ceil(seconds / step);
      while (n-- > 0 && this.phase === 'playing') {
        this.update(step);
        if (this.waveState === 'prep') this.prepTimer = Math.min(this.prepTimer, .05);
      }
      return this.snapshot();
    }
  }

  /* ======================= 启动 & 调试接口 ======================= */
  const game = new Game();

  window.__ICE_DEBUG__ = {
    game,
    snapshot() { return game.snapshot(); },
    start() { game.startGame(); game.d.tutorial.classList.add('hidden'); return game.snapshot(); },
    deploy(n, type) {
      for (let i = 0; i < (n || 1); i++) {
        game.energy = Math.max(game.energy, game.deployCost());
        const g = game.bestCell(type || game.pickType());
        if (g) game.deployAt(g.c, g.r, type || undefined);
      }
      return game.snapshot();
    },
    addEnergy(v) { game.energy += v; return game.snapshot(); },
    mergeAll() { let i = 0; while (game.findMergePair() && i++ < 40) game.autoMerge(); return game.snapshot(); },
    nextWave() { game.forceNextWave(); return game.snapshot(); },
    setLink(v) { game.link = v; return game.snapshot(); },
    godMode(v) { game.godMode = !!v; return game.snapshot(); },
    seed(n) { return game.seed(n); },
    advance(sec, step) { return game.advance(sec, step); },
    forceLose() { game.link = 0; game.lose(); return game.snapshot(); },
    state() { return game.snapshot(); }
  };

  Game.prototype.snapshot = function () {
    return {
      phase: this.phase, paused: this.paused, speed: this.speed,
      wave: this.wave, waveState: this.waveState,
      energy: Math.floor(this.energy), link: Math.ceil(this.link), score: this.score,
      towers: this.towers.length, lvMax: this.towers.reduce((m, t) => Math.max(m, t.lv), 0),
      enemies: this.enemies.length, bullets: this.bullets.length,
      queue: this.spawnQueue.length, boss: !!this.bossRef && !this.bossRef.dead,
      waveTrace: this.waveTrace.slice(),
      bossHp: this.bossRef && !this.bossRef.dead ? Math.round(this.bossRef.hp) : 0,
      stats: Object.assign({}, this.stats),
      canvas: { w: this.W, h: this.H, dpr: this.dpr, cell: Math.round(this.cell) },
      audioReady: A.ready
    };
  };

})();
