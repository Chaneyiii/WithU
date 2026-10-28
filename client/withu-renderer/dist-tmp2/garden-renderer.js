/* ===== 像素向日葵田 =====
   点阵来自原图逐像素提取（坐标 + 原始灰度），没上色时就是那幅灰色刻痕画。

   点击规则（只加不减，点第二次不会把颜色擦掉）：
     · 点在一朵花上 → 这一整朵上色：花瓣金黄（少数粉），花盘深棕
     · 点在叶/茎上 → 从点击处漫填这一丛，只染绿色，不漫进别的花
     · 点在空处   → 上方渐变成天空蓝
   三档互相兜底，所以画面里每一处都点得动。 */
(function () {
  const canvas = document.getElementById('garden-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const DPR = Math.min(window.devicePixelRatio || 1, 2);

  /* 页面纸色，与 identity-template.html 的 --paper 一致。
     未上色时画布不铺任何底色，直接透出页面背景，两者不会有色差。 */
  const PAPER = [246, 247, 249];

  const META = window.GARDEN_META || { cols: 328, rows: 143, pitch: 2, dots: 0 };
  const b64 = window.GARDEN_B64 || '';
  let cols = META.cols, rows = META.rows, pitch = META.pitch;
  let N = cols * rows;

  let dots = [];
  let tones = new Int8Array(N).fill(-1);   // 灰度 0..31；-1 = 无墨
  let heads = [];                          // { x, y, hue, r }
  let paint = new Float32Array(N);         // 当前上色量
  let target = new Float32Array(N);        // 目标上色量
  let kind = new Uint8Array(N);            // 0 绿 / 1 金 / 2 棕 / 3 粉 / 4 粉花盘
  let sky = 0, skyTarget = 0;
  let ready = false;

  const LATTICE_MIN = 22;                  // 此灰度以上是背景点阵，不属于植物
  const DISC_R = 3.2;                      // 花盘半径（格）
  const PETAL_R = 12;                      // 花瓣半径（格）：实测花瓣最远伸到 11~12 格
  const FILL_CAP = 300;                    // 一次点击最多染多少格
  const FILL_RADIUS = 12;                  // 一次点击的影响半径（格）

  /* 天空：顶部是蓝的，往下淡回纸色，底部与页面背景完全一致，看不出接缝。 */
  const SKY_STOPS = [
    { y: 0,   c: [222, 233, 248] },
    { y: 10,  c: [208, 224, 246] },
    { y: 20,  c: [203, 221, 243] },
    { y: 34,  c: [209, 225, 244] },
    { y: 50,  c: [220, 230, 243] },
    { y: 66,  c: [231, 236, 242] },
    { y: 84,  c: [240, 243, 246] },
    { y: 104, c: PAPER },
    { y: 142, c: PAPER },
  ];
  function skyAt(row) {
    const t = Math.max(0, Math.min(rows - 1, row));
    for (let i = 1; i < SKY_STOPS.length; i++) {
      const a = SKY_STOPS[i - 1], b = SKY_STOPS[i];
      if (t <= b.y) {
        const f = (t - a.y) / Math.max(1, b.y - a.y);
        return [
          a.c[0] + (b.c[0] - a.c[0]) * f,
          a.c[1] + (b.c[1] - a.c[1]) * f,
          a.c[2] + (b.c[2] - a.c[2]) * f,
        ];
      }
    }
    return SKY_STOPS[SKY_STOPS.length - 1].c;
  }

  /* 色阶：深浅两端按参考图同区域量出，中间由每个墨点自身的灰度插值，
     原刻痕的明暗关系因此保留下来。 */
  const GREEN_D = [62, 86, 50], GREEN_L = [196, 210, 186];
  const STEM_D  = [52, 74, 44], STEM_L  = [172, 190, 164];
  const GOLD_D  = [150, 110, 30], GOLD_L  = [245, 215, 130];
  const BROWN_D = [72, 38, 6],  BROWN_L = [156, 110, 56];
  const PINK_D  = [170, 100, 130], PINK_L = [250, 205, 220];
  const PINK_DISC_D = [110, 60, 62], PINK_DISC_L = [190, 140, 120];
  /* 区域底色：点与点之间的纸面也要染上，否则整朵花只剩稀疏的色点 */
  const BASE = {
    0: [150, 166, 138],   // 叶 / 茎
    1: [232, 196, 95],    // 金花瓣
    2: [104, 62, 28],     // 金花盘
    3: [238, 175, 198],   // 粉花瓣
    4: [140, 90, 70],     // 粉花盘
  };
  const BASE_STEM = [134, 152, 124];

  const grayOf = t => Math.round(Math.pow(t / 31, 1.06) * 246);
  function ramp(g, darkC, lightC) {
    const t = Math.max(0, Math.min(1, g / 246));
    return [
      Math.round(darkC[0] + (lightC[0] - darkC[0]) * t),
      Math.round(darkC[1] + (lightC[1] - darkC[1]) * t),
      Math.round(darkC[2] + (lightC[2] - darkC[2]) * t),
    ];
  }
  const blend = (a, b, t) => [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];

  /* ---- 解包 G8 ---- */
  function unpack(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (String.fromCharCode(u8[0], u8[1]) !== 'G8') throw new Error('bad garden data');
    pitch = dv.getUint8(2);
    cols = dv.getUint16(3, true);
    rows = dv.getUint16(5, true);
    const headCount = dv.getUint16(7, true);
    const dotCount = dv.getUint32(9, true);
    N = cols * rows;
    let off = 13;
    heads = [];
    for (let i = 0; i < headCount; i++) {
      heads.push({
        x: dv.getUint16(off, true),
        y: dv.getUint16(off + 2, true),
        hue: dv.getUint8(off + 4),
        r: dv.getUint8(off + 5),
      });
      off += 6;
    }
    dots = new Array(dotCount);
    tones = new Int8Array(N).fill(-1);
    for (let i = 0; i < dotCount; i++) {
      const x = dv.getUint16(off, true), y = dv.getUint16(off + 2, true), t = dv.getUint8(off + 4);
      dots[i] = { x: x, y: y, tone: t };
      tones[y * cols + x] = t;
      off += 5;
    }
    paint = new Float32Array(N);
    target = new Float32Array(N);
    kind = new Uint8Array(N);
  }

  /* ---- 尺寸 ----
     画布按容器实际宽度 × DPR 铺满，格子尺寸 = 设备宽 / 列数（可以是小数，
     绘制时取整到设备像素，所以边缘依然锐利）。点击坐标一律用元素的实际
     显示矩形换算，不再依赖任何推导量，点到哪里就染哪里。

     抽屉是 display:none 挂载的，首次 layout() 时宽度为 0；所以除了 resize，
     还用 ResizeObserver 盯住容器，抽屉一展开就立刻重新铺满。 */
  let cellDevX = 2, cellDevY = 2;
  function layout() {
    const host = canvas.parentElement;
    const w = host.getBoundingClientRect().width;
    if (w < 40) return false;                    // 还没展开，等下一次
    const cssW = Math.round(w);
    const cssH = Math.round(cssW * rows / cols);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.width = Math.max(cols, Math.round(cssW * DPR));
    canvas.height = Math.max(rows, Math.round(cssH * DPR));
    cellDevX = canvas.width / cols;
    cellDevY = canvas.height / rows;
    return true;
  }

  /* ---- 绘制 ---- */
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    /* 天空：整行铺色，上蓝下淡，底部就是纸色 */
    if (sky > 0.004) {
      for (let r = 0; r < rows; r++) {
        const base = skyAt(r);
        const c = blend(PAPER, [Math.round(base[0]), Math.round(base[1]), Math.round(base[2])], sky);
        ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
        const y0 = Math.round(r * cellDevY), y1 = Math.round((r + 1) * cellDevY);
        ctx.fillRect(0, y0, canvas.width, Math.max(1, y1 - y0));
      }
    }
    if (!ready) return;

    /* 底色层：上过色的每一格先铺底，把点与点之间的空隙也填上 */
    for (let i = 0; i < N; i++) {
      const p = paint[i];
      if (p <= 0.004) continue;
      const x = i % cols, y = (i / cols) | 0;
      const kd = kind[i];
      const base = kd === 0 ? (isStem(x, y) ? BASE_STEM : BASE[0]) : BASE[kd];
      ctx.globalAlpha = p;
      ctx.fillStyle = 'rgb(' + base[0] + ',' + base[1] + ',' + base[2] + ')';
      fillCell(x, y);
    }
    ctx.globalAlpha = 1;

    for (let k = 0; k < dots.length; k++) {
      const d = dots[k];
      const x = d.x, y = d.y, i = y * cols + x;
      const g = grayOf(d.tone);
      let rgb = [g, g, g];
      const p = paint[i];
      if (p > 0.004) {
        const kd = kind[i];
        let col;
        if (kd === 1) col = ramp(g, GOLD_D, GOLD_L);
        else if (kd === 2) col = ramp(g, BROWN_D, BROWN_L);
        else if (kd === 3) col = ramp(g, PINK_D, PINK_L);
        else if (kd === 4) col = ramp(g, PINK_DISC_D, PINK_DISC_L);
        else {
          const st = isStem(x, y);
          col = ramp(g, st ? STEM_D : GREEN_D, st ? STEM_L : GREEN_L);
        }
        rgb = blend(rgb, col, p);
      }
      ctx.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      fillCell(x, y);
    }
  }

  function fillCell(x, y) {
    const x0 = Math.round(x * cellDevX), x1 = Math.round((x + 1) * cellDevX);
    const y0 = Math.round(y * cellDevY), y1 = Math.round((y + 1) * cellDevY);
    ctx.fillRect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  }

  /* 竖向连续多 → 当茎，用更深的绿，让叶片与枝条有层次 */
  function isStem(x, y) {
    let h = 0, v = 0;
    for (let k = -2; k <= 2; k++) {
      if (k === 0) continue;
      const nx = x + k;
      if (nx >= 0 && nx < cols) { const t = tones[y * cols + nx]; if (t >= 0 && t < LATTICE_MIN) h++; }
      const ny = y + k;
      if (ny >= 0 && ny < rows) { const t = tones[ny * cols + x]; if (t >= 0 && t < LATTICE_MIN) v++; }
    }
    return v > h + 1;
  }

  /* ---- 花头命中 ----
     一朵花的影响圈就是它的花瓣外缘（PETAL_R）。圈内任意一点都算点中这朵花，
     这样花瓣边角也点得到；圈外则交给叶子/茎那条路。 */
  function nearestHead(x, y) {
    let best = -1, bd = 1e9;
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      const d = (h.x - x) * (h.x - x) + (h.y - y) * (h.y - y);
      if (d < bd) { bd = d; best = i; }
    }
    return bd <= PETAL_R * PETAL_R ? best : -1;
  }
  function headAt(x, y) {
    const i = nearestHead(x, y);
    return i < 0 ? null : heads[i];
  }
  /* 这朵花是否已经上过色（上过就不再动它） */
  function headPainted(h) { return target[h.y * cols + h.x] > 0.5; }

  /* ---- 局部漫填（有半径上限，不漫进花心，也不覆盖已经上过的颜色） ---- */
  function floodFrom(sx, sy, opts) {
    const skipPainted = opts && opts.skipPainted;
    const filled = [];
    const start = sy * cols + sx;
    if (tones[start] < 0 || tones[start] >= LATTICE_MIN) return filled;
    const seen = new Uint8Array(N);
    const queue = [start];
    seen[start] = 1;
    const r2 = FILL_RADIUS * FILL_RADIUS;
    while (queue.length && filled.length < FILL_CAP) {
      const p = queue.shift();
      filled.push(p);
      const x = p % cols, y = (p / cols) | 0;
      if (y >= rows) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const ddx = nx - sx, ddy = ny - sy;
        if (ddx * ddx + ddy * ddy > r2) continue;   // 半径上限：一次只染近处这一片
        const n = ny * cols + nx;
        if (seen[n]) continue;
        const t = tones[n];
        if (t < 0 || t >= LATTICE_MIN) continue;
        if (inAnyCore(nx, ny)) continue;            // 花心是边界，绿色不许漫进去
        if (skipPainted && target[n] > 0.5) continue; // 已经上过色的格不动
        seen[n] = 1;
        queue.push(n);
      }
    }
    return filled;
  }

  /* 是否落在某朵花的花心（花瓣圈内核）里 */
  function inAnyCore(x, y) {
    const r2 = DISC_R * DISC_R;
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      const dx = h.x - x, dy = h.y - y;
      if (dx * dx + dy * dy <= r2) return true;
    }
    return false;
  }
  /* 就近找一个「不属于未上色花朵」的植物格，用来给叶子找落脚点 */
  function nearestLeafSeed(x, y, R) {
    let best = -1, bd = 1e9;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const d = dx * dx + dy * dy;
      if (d > R * R) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const t = tones[ny * cols + nx];
      if (t < 0 || t >= LATTICE_MIN) continue;
      const hi = nearestHead(nx, ny);
      if (hi >= 0 && !headPainted(heads[hi])) continue;  // 那是还没上色的花瓣，交给花的路径
      const n = ny * cols + nx;
      if (target[n] > 0.5) continue;                     // 已经上过色
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  /* 点阵是离散像素，格与格之间很少紧邻。用形态学闭运算（先膨胀、再腐蚀）
     把花瓣/叶片内部的缝并掉，外缘的锯齿却不长胖。 */
  function closeMask(dotCells, grow, shrink) {
    const src = new Set(dotCells);
    if (!src.size) return dotCells;
    let x0 = cols, y0 = rows, x1 = -1, y1 = -1;
    for (const p of dotCells) {
      const x = p % cols, y = (p / cols) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    const pad = grow + shrink + 1;
    const ax0 = Math.max(0, x0 - pad), ax1 = Math.min(cols - 1, x1 + pad);
    const ay0 = Math.max(0, y0 - pad), ay1 = Math.min(rows - 1, y1 + pad);
    const inBox = (x, y) => x >= ax0 && x <= ax1 && y >= ay0 && y <= ay1;

    const hasBox = (set, x, y, r) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const nx = x + dx, ny = y + dy;
        if (!inBox(nx, ny)) continue;
        if (set.has(ny * cols + nx)) return true;
      }
      return false;
    };

    const dil = new Set(src);
    for (let y = ay0; y <= ay1; y++) for (let x = ax0; x <= ax1; x++) {
      const i = y * cols + x;
      if (!dil.has(i) && hasBox(src, x, y, grow)) dil.add(i);
    }

    const out = [];
    for (let y = ay0; y <= ay1; y++) for (let x = ax0; x <= ax1; x++) {
      const i = y * cols + x;
      if (src.has(i)) { out.push(i); continue; }
      if (!dil.has(i)) continue;
      let all = true;
      for (let dy = -shrink; dy <= shrink && all; dy++) for (let dx = -shrink; dx <= shrink; dx++) {
        if (dx * dx + dy * dy > shrink * shrink) continue;
        const nx = x + dx, ny = y + dy;
        if (!inBox(nx, ny) || !dil.has(ny * cols + nx)) { all = false; break; }
      }
      if (all) out.push(i);
    }
    return out;
  }

  /* 一朵花的格子：整朵花瓣圈内有墨的格，再闭运算把缝填上 */
  function cellsOfHead(h) {
    const R = PETAL_R;
    const dotCells = [];
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > R * R) continue;
      const x = h.x + dx, y = h.y + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      const i = y * cols + x;
      if (tones[i] < 0) continue;
      dotCells.push(i);
    }
    const out = [];
    for (const i of closeMask(dotCells, 1, 1)) {
      const x = i % cols, y = (i / cols) | 0;
      out.push({ i: i, disc: Math.hypot(x - h.x, y - h.y) <= DISC_R });
    }
    return out;
  }

  /* 只加不减：上过色的格保持上色，重复点击不会擦掉 */
  function apply(cells, colorOf) {
    if (!cells.length) return false;
    let changed = false;
    for (const c of cells) {
      const i = typeof c === 'number' ? c : c.i;
      const k = colorOf(c);
      if (kind[i] !== k) { kind[i] = k; changed = true; }
      if (target[i] < 1) { target[i] = 1; changed = true; }
    }
    return changed;
  }

  function handleClick(cx, cy) {
    if (!ready) return;
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;

    /* 1. 花：花瓣圈内任意位置都算点中这朵 */
    const h = headAt(cx, cy);
    if (h) {
      colorHead(h);
      animate();
      return;
    }

    /* 2. 叶 / 茎：优先认点击处 2 格内的植物；点阵很稀，手落在叶缝里时
       放宽到 4 格，保证这一下一定能染到最近的叶子，而不是掉到天空。 */
    let seed = nearestLeafSeed(cx, cy, 2);
    if (seed < 0) seed = nearestLeafSeed(cx, cy, 4);
    if (seed >= 0) {
      let filled = closeMask(floodFrom(seed % cols, (seed / cols) | 0, { skipPainted: true }), 2, 1);
      /* 漫填太小（点在细枝上）就补一圈，保证这一下看得见 */
      if (filled.length < 10) {
        const px = seed % cols, py = (seed / cols) | 0;
        for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
          if (dx * dx + dy * dy > 25) continue;
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const n = ny * cols + nx;
          const t = tones[n];
          if (t < 0 || t >= LATTICE_MIN) continue;
          if (inAnyCore(nx, ny)) continue;
          if (target[n] > 0.5) continue;
          filled.push(n);
        }
      }
      if (filled.length) {
        apply(filled, function () { return 0; });
        animate();
        return;
      }
    }

    /* 3. 空处 → 天空（只加不减） */
    if (skyTarget < 1) { skyTarget = 1; animate(); }
  }

  function colorHead(h) {
    apply(cellsOfHead(h), function (c) {
      if (!c.disc) return h.hue;
      return h.hue === 3 ? 4 : 2;
    });
  }

  /* 点击坐标按元素实际显示矩形换算：CS 像素 → 格 */
  function onClick(e) {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cx = Math.floor((e.clientX - r.left) / r.width * cols);
    const cy = Math.floor((e.clientY - r.top) / r.height * rows);
    handleClick(cx, cy);
  }
  canvas.addEventListener('pointerdown', onClick);

  /* ---- 动画（rAF + 心跳兜底：webview 隐藏时 rAF 停摆） ---- */
  let running = false, hbTimer = null;
  function animate() {
    if (running) return;
    running = true;
    const tick = function () {
      let moving = false;
      for (let i = 0; i < N; i++) {
        const d = target[i] - paint[i];
        if (Math.abs(d) > 0.005) { paint[i] += d * 0.30; moving = true; }
        else paint[i] = target[i];
      }
      const ds = skyTarget - sky;
      if (Math.abs(ds) > 0.005) { sky += ds * 0.16; moving = true; }
      else sky = skyTarget;
      draw();
      if (!moving) {
        running = false;
        if (hbTimer) { clearInterval(hbTimer); hbTimer = null; }
      }
    };
    requestAnimationFrame(tick);
    if (!hbTimer) {
      hbTimer = setInterval(function () {
        if (!running) { clearInterval(hbTimer); hbTimer = null; return; }
        tick();
      }, 110);
    }
  }

  let resizeTimer = null;
  function relayout() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (layout()) draw(); }, 80);
  }
  window.addEventListener('resize', relayout);
  /* 抽屉展开/收起、窗口尺寸变化都靠它接住；宽度为 0 时 layout() 自己跳过 */
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(relayout).observe(canvas.parentElement);
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && layout()) draw();
  });

  /* ---- 探针 ---- */
  window.__gardenReady = function () { return ready; };
  window.__gardenState = function () {
    let green = 0, gold = 0, pink = 0;
    for (let i = 0; i < N; i++) {
      if (target[i] < 0.5) continue;
      const k = kind[i];
      if (k === 0) green++;
      else if (k === 1 || k === 2) gold++;
      else pink++;
    }
    return {
      sky: +sky.toFixed(2), skyTarget: skyTarget, green: green, gold: gold, pink: pink,
      cols: cols, rows: rows, dots: dots.length, heads: heads.length, cell: cellDevX / DPR,
    };
  };
  window.__gardenHeads = function () { return heads.map(function (h) { return [h.x, h.y]; }); };
  window.__gardenCellAt = function (x, y) {
    const i = y * cols + x;
    const h = headAt(x, y);
    return { tone: tones[i], painted: +target[i].toFixed(2), kind: kind[i], head: h ? heads.indexOf(h) : -1 };
  };
  window.__gardenClick = function (x, y) { handleClick(x, y); return true; };
  window.__gardenSettle = function () {
    for (let i = 0; i < N; i++) paint[i] = target[i];
    sky = skyTarget;
    draw();
    return true;
  };
  window.__gardenReset = function () {
    paint.fill(0); target.fill(0); kind.fill(0);
    sky = 0; skyTarget = 0;
    draw();
    return true;
  };
  window.__gardenRect = function () {
    const r = canvas.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cell: r.width / cols };
  };

  window.__gardenDbg = function (x, y) {
    const t = tones[y * cols + x];
    const f = floodFrom(x, y);
    const h = headAt(x, y);
    return {
      tone: t, inRange: t >= 0 && t < LATTICE_MIN,
      filled: f.length, firstFilled: f.length ? f[0] : -1,
      head: h ? [h.x, h.y, h.r] : null,
      LATTICE_MIN: LATTICE_MIN, cols: cols, rows: rows, ready: ready,
      targetSum: (function(){let q=0;for(let i=0;i<N;i++)q+=target[i];return q;})(),
    };
  };

  /* ---- 启动 ---- */
  layout();
  /* webview 被抽屉遮住时 visibilityState 是 hidden，ResizeObserver 不一定回调，
     所以再加一个低频看门狗：尺寸对不上就重铺一次。 */
  setInterval(function () {
    const w = Math.round(canvas.parentElement.getBoundingClientRect().width);
    if (w >= 40 && Math.abs(w - Math.round(canvas.width / DPR)) > 2) {
      if (layout()) draw();
    }
  }, 600);
  function boot() {
    try {
      if (typeof DecompressionStream === 'undefined') { ready = true; draw(); return; }
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const ds = new DecompressionStream('deflate');
      const w = ds.writable.getWriter();
      w.write(bytes); w.close();
      new Response(ds.readable).arrayBuffer().then(function (buf) {
        unpack(buf);
        ready = true;
        layout();
        draw();
      }).catch(function () { ready = true; draw(); });
    } catch (err) { ready = true; draw(); }
  }
  boot();
})();
