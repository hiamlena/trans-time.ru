// Нейронная сеть по карте России + логика входа.
// Требует:
//   <canvas id="lines"> и <canvas id="fx">
//   /assets/ru-mask.png — маска РФ (белое по чёрному)

class NeuralMap {
  constructor(opts = {}) {
    const defaults = {
      maskSrc: '/assets/ru-mask.png',
      gridStep: 30,
      kNearest: 5,
      maxPoints: 1100,
      particles: (window.innerWidth < 560 ? 160 : 260),
      speedMin: 0.18,
      speedMax: 0.40,
      endFlashRadius: 26,
      endFlashFade: 1.1,
      linesId: 'lines',
      fxId: 'fx'
    };
    this.cfg = { ...defaults, ...opts };

    this.lines = document.getElementById(this.cfg.linesId);
    this.fx = document.getElementById(this.cfg.fxId);

    if (!this.lines || !this.fx) {
      console.warn('[NeuralMap] Canvas elements not found');
      return;
    }

    this.lctx = this.lines.getContext('2d');
    this.fctx = this.fx.getContext('2d', { alpha: true });

    this.fctx.imageSmoothingEnabled = false;
    this.lctx.imageSmoothingEnabled = false;

    this.DPR = Math.min(window.devicePixelRatio || 1, 2);

    this.maskCanvas = document.createElement('canvas');
    this.maskCtx = this.maskCanvas.getContext('2d', { willReadFrequently: true });
    this.maskImg = new Image();
    this.maskData = null;

    this.W = 800;
    this.H = 450;

    this.pts = [];
    this.edges = [];
    this.majors = [];
    this.curves = [];
    this.edgeLoads = [];
    this.particles = [];
    this.pulses = [];
    this.ready = false;

    this.prev = performance.now();
    this.loop = this.loop.bind(this);

    this.ro = new ResizeObserver(() => {
      clearTimeout(this._tmr);
      this._tmr = setTimeout(() => this.rebuildAll(), 120);
    });
    this.ro.observe(this.lines);
    this.ro.observe(this.fx);

    // Хабы (нормированные координаты по маске)
    this.HUBS = [
      { x: 0.12, y: 0.45 }, { x: 0.20, y: 0.38 }, { x: 0.18, y: 0.26 },
      { x: 0.26, y: 0.47 }, { x: 0.31, y: 0.48 }, { x: 0.34, y: 0.53 },
      { x: 0.37, y: 0.60 }, { x: 0.40, y: 0.53 }, { x: 0.44, y: 0.56 },
      { x: 0.49, y: 0.55 }, { x: 0.56, y: 0.55 }, { x: 0.60, y: 0.58 },
      { x: 0.68, y: 0.55 }, { x: 0.76, y: 0.58 }, { x: 0.91, y: 0.47 },
      { x: 0.93, y: 0.58 }, { x: 0.25, y: 0.60 }, { x: 0.23, y: 0.64 }
    ];

    // "Федеральный позвоночник"
    this.BACKBONE = [
      [1, 3], [3, 4], [4, 5], [5, 8], [8, 9],
      [9, 10], [10, 11], [11, 12], [12, 13], [13, 14],
      [14, 15], [3, 16], [16, 17], [17, 6]
    ];
  }

  start() {
    if (!this.lines || !this.fx) return;

    this.maskImg.onload = () => {
      this.rebuildAll();
      requestAnimationFrame(this.loop);
    };
    this.maskImg.onerror = () => {
      this.maskCanvas.width = 800;
      this.maskCanvas.height = 450;
      this.maskCtx.fillStyle = '#fff';
      this.maskCtx.fillRect(0, 0, 800, 450);
      this.rebuildAll();
      requestAnimationFrame(this.loop);
    };
    this.maskImg.src = this.cfg.maskSrc;
  }

  fitCanvas(c) {
    const r = c.getBoundingClientRect();
    const w = Math.max(1, Math.floor(r.width * this.DPR));
    const h = Math.max(1, Math.floor(r.height * this.DPR));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
      c.getContext('2d').setTransform(this.DPR, 0, 0, this.DPR, 0, 0);
    }
    return { w: r.width, h: r.height };
  }

  insideMask(px, py) {
    const x = px | 0;
    const y = py | 0;

    if (x < 0 || y < 0 ||
        x >= this.maskCanvas.width ||
        y >= this.maskCanvas.height) {
      return false;
    }

    if (!this.maskData) {
      const d = this.maskCtx.getImageData(x, y, 1, 1).data;
      return d[3] > 40;
    }

    const idx = (y * this.maskCanvas.width + x) * 4 + 3; // alpha
    return this.maskData.data[idx] > 40;
  }

  clamp(v, a, b) {
    return Math.max(a, Math.min(b, v));
  }

  controlPoint(A, B, alt) {
    const x1 = A.x, y1 = A.y, x2 = B.x, y2 = B.y;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1, nx = -dy, ny = dx;
    const len = Math.hypot(nx, ny) || 1;
    const bend = 0.06 * Math.hypot(dx, dy);
    return {
      x: mx + (nx / len) * bend * (alt ? 1 : -1),
      y: my + (ny / len) * bend * (alt ? 1 : -1)
    };
  }

  precomputeCurves() {
    this.curves = [];
    const add = (i, j, alt, major = false) => {
      const A = this.pts[i], B = this.pts[j], C = this.controlPoint(A, B, alt);
      this.curves.push({ ai: i, bi: j, A, B, C, major });
    };
    this.edges.forEach(([i, j], idx) => add(i, j, (idx & 1) === 0, false));
    this.majors.forEach(([i, j], idx) => add(i, j, (idx & 1) === 0, true));
    this.edgeLoads = new Array(this.curves.length).fill(0);
  }

  rebuild() {
    const r = this.fitCanvas(this.lines);
    this.fitCanvas(this.fx);
    this.W = r.w;
    this.H = r.h;

    this.maskCanvas.width = Math.floor(this.W);
    this.maskCanvas.height = Math.floor(this.H);
    this.maskCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.maskCtx.clearRect(0, 0, this.W, this.H);

    const ir = this.maskImg.width / this.maskImg.height;
    const br = this.W / this.H;
    let dw = this.W, dh = this.H, dx = 0, dy = 0;

    if (ir > br) {
      dh = Math.round(this.W / ir);
      dy = Math.round((this.H - dh) / 2);
    } else {
      dw = Math.round(this.H * ir);
      dx = Math.round((this.W - dw) / 2);
    }

    this.maskCtx.drawImage(
      this.maskImg,
      0, 0, this.maskImg.width, this.maskImg.height,
      dx, dy, dw, dh
    );

    try {
      this.maskData = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    } catch (e) {
      this.maskData = null;
    }

    // Хабы
    this.pts = [];
    this.HUBS.forEach(h => {
      const x = Math.round(h.x * this.W);
      const y = Math.round(h.y * this.H);
      const inside = this.insideMask(x, y);
      this.pts.push({
        x: inside ? x : this.clamp(x, 1, this.W - 2),
        y: inside ? y : this.clamp(y, 1, this.H - 2),
        core: true
      });
    });

    // Сетка по маске
    const step = Math.max(12, this.cfg.gridStep | 0);
    const jitter = Math.round(step * 0.35);

    for (let yy = step / 2; yy < this.H; yy += step) {
      for (let xx = step / 2; xx < this.W; xx += step) {
        const jx = this.clamp(xx + (Math.random() * 2 - 1) * jitter, 1, this.W - 2);
        const jy = this.clamp(yy + (Math.random() * 2 - 1) * jitter, 1, this.H - 2);
        if (this.insideMask(jx, jy)) {
          this.pts.push({ x: jx, y: jy, core: false });
        }
        if (this.pts.length >= this.cfg.maxPoints) break;
      }
      if (this.pts.length >= this.cfg.maxPoints) break;
    }

    const N = this.pts.length;
    const k = Math.max(3, this.cfg.kNearest);
    const maxD = Math.max(110, Math.min(this.W, this.H) * 0.22);

    const m = new Map();
    const key = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

    for (let i = 0; i < N; i++) {
      const arr = [];
      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const d = Math.hypot(this.pts[i].x - this.pts[j].x, this.pts[i].y - this.pts[j].y);
        if (d <= maxD) arr.push({ j, d });
      }
      arr.sort((a, b) => a.d - b.d);
      for (let t = 0; t < Math.min(k, arr.length); t++) {
        m.set(key(i, arr[t].j), [i, arr[t].j]);
      }
    }

    this.BACKBONE.forEach(([a, b]) => m.set(key(a, b), [a, b, 'major']));

    this.edges = [];
    this.majors = [];
    m.forEach(v => {
      if (v[2]) this.majors.push([v[0], v[1]]);
      else this.edges.push([v[0], v[1]]);
    });

    this.precomputeCurves();
    this.drawStatic();
    this.initParticles();
  }

  drawStatic() {
    const { width, height } = this.lines.getBoundingClientRect();
    this.lctx.clearRect(0, 0, width, height);
    this.lctx.lineCap = 'round';

    // второстепенные связи
    this.lctx.lineWidth = 1;
    this.lctx.strokeStyle = 'rgba(230,230,235,0.22)';
    for (const c of this.curves) {
      if (c.major) continue;
      this.lctx.beginPath();
      this.lctx.moveTo(c.A.x, c.A.y);
      this.lctx.quadraticCurveTo(c.C.x, c.C.y, c.B.x, c.B.y);
      this.lctx.stroke();
    }

    // "федеральные трассы" ярче
    this.lctx.lineWidth = 1.6;
    this.lctx.strokeStyle = 'rgba(255,255,255,0.72)';
    for (const c of this.curves) {
      if (!c.major) continue;
      this.lctx.beginPath();
      this.lctx.moveTo(c.A.x, c.A.y);
      this.lctx.quadraticCurveTo(c.C.x, c.C.y, c.B.x, c.B.y);
      this.lctx.stroke();
    }

    // хабы
    this.lctx.fillStyle = 'rgba(255,255,255,0.96)';
    for (let i = 0; i < Math.min(this.HUBS.length, this.pts.length); i++) {
      const p = this.pts[i];
      this.lctx.beginPath();
      this.lctx.arc(p.x, p.y, 2.3, 0, Math.PI * 2);
      this.lctx.fill();
    }
  }

  pickCurveBalanced() {
    if (!this.curves.length) return null;
    let minLoad = Infinity;
    for (let i = 0; i < this.curves.length; i++) {
      if (this.edgeLoads[i] < minLoad) minLoad = this.edgeLoads[i];
    }
    const candidates = [];
    for (let i = 0; i < this.curves.length; i++) {
      if (this.edgeLoads[i] === minLoad) candidates.push(i);
    }
    const idx = candidates[(Math.random() * candidates.length) | 0];
    return { curve: this.curves[idx], index: idx };
  }

  spawnParticle() {
    const pick = this.pickCurveBalanced();
    const c = pick ? pick.curve : this.curves[(Math.random() * this.curves.length) | 0];
    const ci = pick ? pick.index : this.curves.indexOf(c);
    if (ci >= 0) this.edgeLoads[ci]++;

    return {
      ci,
      c,
      t: Math.random(),
      dir: Math.random() < 0.5 ? 1 : -1,
      s: this.cfg.speedMin + Math.random() * (this.cfg.speedMax - this.cfg.speedMin),
      r: 1.8 + Math.random() * 1.3
    };
  }

  initParticles() {
    this.edgeLoads = new Array(this.curves.length).fill(0);
    this.particles = [];
    for (let i = 0; i < this.cfg.particles; i++) {
      this.particles.push(this.spawnParticle());
    }
    this.pulses = [];
  }

  quadPoint(A, C, B, t) {
    const u = 1 - t;
    return {
      x: u * u * A.x + 2 * u * t * C.x + t * t * B.x,
      y: u * u * A.y + 2 * u * t * C.y + t * t * B.y
    };
  }

  step(dt) {
    const k = Math.min(1, dt / 1000);
    for (const p of this.particles) {
      p.t += p.s * k * 0.3 * p.dir;
      if (p.t >= 1 || p.t <= 0) {
        const end = p.t >= 1 ? p.c.B : p.c.A;
        this.pulses.push({ x: end.x, y: end.y, r: 0, life: 1 });
        if (typeof p.ci === 'number') {
          this.edgeLoads[p.ci] = Math.max(0, this.edgeLoads[p.ci] - 1);
        }
        Object.assign(p, this.spawnParticle());
      }
    }

    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pl = this.pulses[i];
      pl.r += this.cfg.endFlashRadius * k;
      pl.life -= this.cfg.endFlashFade * k;
      if (pl.life <= 0) this.pulses.splice(i, 1);
    }
  }

  drawFX() {
    const { width, height } = this.fx.getBoundingClientRect();
    this.fctx.clearRect(0, 0, width, height);

    for (const p of this.particles) {
      const pt = this.quadPoint(p.c.A, p.c.C, p.c.B, Math.min(1, Math.max(0, p.t)));
      const glowR = 3 + p.r * 1.1;

      const g = this.fctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, glowR);
      g.addColorStop(0, 'rgba(255,255,255,0.18)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      this.fctx.fillStyle = g;
      this.fctx.beginPath();
      this.fctx.arc(pt.x, pt.y, glowR, 0, Math.PI * 2);
      this.fctx.fill();

      this.fctx.fillStyle = 'rgba(255,255,255,1)';
      this.fctx.beginPath();
      this.fctx.arc(pt.x, pt.y, p.r, 0, Math.PI * 2);
      this.fctx.fill();
    }

    this.fctx.globalCompositeOperation = 'screen';
    for (const pl of this.pulses) {
      this.fctx.fillStyle = `rgba(255,255,255,${0.8 * pl.life})`;
      this.fctx.beginPath();
      this.fctx.arc(pl.x, pl.y, Math.max(2, 2.4 * pl.life), 0, Math.PI * 2);
      this.fctx.fill();

      const g = this.fctx.createRadialGradient(pl.x, pl.y, 0, pl.x, pl.y, pl.r);
      g.addColorStop(0, `rgba(255,255,255,${0.65 * pl.life})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      this.fctx.fillStyle = g;
      this.fctx.beginPath();
      this.fctx.arc(pl.x, pl.y, pl.r, 0, Math.PI * 2);
      this.fctx.fill();
    }
    this.fctx.globalCompositeOperation = 'source-over';
  }

  loop(now) {
    const dt = now - this.prev;
    this.prev = now;
    if (this.ready) {
      this.step(dt);
      this.drawFX();
    }
    requestAnimationFrame(this.loop);
  }

  rebuildAll() {
    if (!this.maskImg.complete) return;
    this.ready = false;
    this.rebuild();
    this.ready = true;
  }
}

// ИНИЦИАЛИЗАЦИЯ

document.addEventListener('DOMContentLoaded', () => {
  const nm = new NeuralMap();
  nm.start();

  const form = document.getElementById('loginForm');
  const msgBox = document.getElementById('welcome-msg');

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const login = document.getElementById('login').value.trim().toLowerCase();
      const pass = document.getElementById('password').value.trim();

      if (!msgBox) return;

      if (!login || !pass) {
        msgBox.textContent = 'Введите логин и пароль';
        msgBox.style.color = '#ff9c8a';
        return;
      }

      if (login === 'admin' && pass === '1234') {
        msgBox.textContent = 'Добро пожаловать, Админ!';
        msgBox.style.color = '#b8ffb8';
        try { localStorage.setItem('user', 'admin'); } catch (e2) {}
        setTimeout(() => { window.location.href = '/app/'; }, 800);
      } else if (login === 'test' && pass === '1234') {
        msgBox.textContent = 'Добро пожаловать, Тест!';
        msgBox.style.color = '#b8d7ff';
        try { localStorage.setItem('user', 'test'); } catch (e3) {}
        setTimeout(() => { window.location.href = '/guest/'; }, 800);
      } else {
        msgBox.textContent = 'Неверный логин или пароль';
        msgBox.style.color = '#ff9c8a';
      }
    });
  }

  const demoLink = document.getElementById('demoLink');
  if (demoLink) {
    demoLink.addEventListener('click', (e) => {
      e.preventDefault();
      try { localStorage.setItem('user', 'guest'); } catch (err) {}
      window.location.href = '/guest/';
    });
  }

  const registerLink = document.getElementById('registerLink');
  if (registerLink) {
    registerLink.addEventListener('click', () => {
      window.location.href = '/register';
    });
  }
});
