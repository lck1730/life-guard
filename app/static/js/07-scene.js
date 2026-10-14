  // ═══════════════════════════════════════════════════════════════════
  //  07-scene.js —— 卧室场景引擎（2026-10-15）
  //
  //  上一版是**画透视** ✗：每个多边形的手写坐标里各带一点「像是有纵深」，
  //  但彼此之间**没有任何约束** ✓ → 家具浮在墙上、影子方向乱、
  //  地板和墙脚线对不上 ✓。看着就是「贴纸感」✓。
  //
  //  这一版是**算透视** ✓：一个针孔相机（高度、焦距、偏转角）+ 一个世界坐标系
  //  （X 左右 / Y 上 / Z 纵深，单位≈米）。**屋子、家具、影子、光的落点**
  //  全部是「世界里的几何」✓，投影成屏幕坐标 ✓ → 它们之间**不可能对不上** ✓。
  //
  //  三条由此白拿的东西 ✓：
  //    · **纵深感是真的** ✓ —— 近大远小由焦距决定，不是手调的 ✓
  //    · **光是同一盏** ✓ —— 所有面的亮度 = 面法线 · 光方向 ✓；
  //      所有影子的落点 = 物体底面沿光方向拉出去 ✓ → 方向一致 ✓
  //    · **横滑 = 屋子真的更宽** ✓ —— 屋在世界里比手机宽 ✓，
  //      滑过去看见的是**屋里别的地方**，不是另一张画 ✓
  //
  //  ⚠️ **本文件一个反引号都不能有** ✗→✓ —— 部署前那步「抽脚本」是**按字符扫**的 ✓
  //     （见 05-settings.js 顶部那段）✓：看见反引号就以为模板字符串开始了 ✓
  //     → 后面整段被当成字符串吃掉 ✓。所以这里全是 `+` 拼接 ✓。
  //     （这也是 node --check 唯一能在部署前替我们抓住它的方式 ✓，改完要跑 ✓）
  //
  //  ⚠️ 这个文件只**画屋** ✓；**点物进组件 / 点猫退群**那套交互在 06-workshop.js ✓
  //     （同一个 IIFE ✓，`openComp` / `closeWorkshop` 直接可见 ✓）。
  // ═══════════════════════════════════════════════════════════════════

  // ── 相机 ─────────────────────────────────────────────────────────
  // 眼睛的世界位置 + 焦距 + 主点。改这 6 个数就是改镜头 ✓：
  //   f 小 = 广角（更夸张的纵深）✓ · f 大 = 长焦（更平面）✓
  //   phi > 0 = 向右看 ✓（右近的、左远的 → 两面墙都退进纵深 = 两点透视 ✓）
  const CAM = { x: 0, y: 0.66, z: 0, phi: -0.150, f: 348, cx: 300, yh: 236 };
  const _CP = Math.cos(CAM.phi), _SP = Math.sin(CAM.phi);

  // 世界 → 视图空间（相机在原点、朝 +Z 看）
  const RV = (p) => {
    const dx = p[0] - CAM.x, dz = p[2] - CAM.z;
    return [dx * _CP - dz * _SP, p[1] - CAM.y, dx * _SP + dz * _CP];
  };
  // 视图 → 屏幕
  const RS = (v) => [CAM.cx + CAM.f * v[0] / v[2], CAM.yh - CAM.f * v[1] / v[2]];
  // 世界 → 屏幕
  const RB_PT = (p) => RS(RV(p));
  // 世界坐标的视图纵深（画家排序用 ✓）
  const RB_Z = (p) => (p[0] - CAM.x) * _SP + (p[2] - CAM.z) * _CP;

  // 世界点数组 → SVG points 字符串
  const RB_Q = (pts) => {
    let s = '';
    for (let i = 0; i < pts.length; i++) {
      const q = RB_PT(pts[i]);
      s += (i ? ' ' : '') + q[0].toFixed(1) + ',' + q[1].toFixed(1);
    }
    return s;
  };
  // 屏幕点数组 → SVG points 字符串（裁完再用 ✓）
  const RB_QS = (pts) => {
    let s = '';
    for (let i = 0; i < pts.length; i++)
      s += (i ? ' ' : '') + pts[i][0].toFixed(1) + ',' + pts[i][1].toFixed(1);
    return s;
  };

  // ── 画布 ──────────────────────────────────────────────────────────
  // ⚠️ 视图框**由屋子算出来**，不是写死的 ✓ —— 屋子在世界里多大，画布就多大 ✓。
  const RB_W = 1180, RB_H = 700;

  // Sutherland–Hodgman 把屏幕多边形裁进画布 ✓。
  // 必须裁 ✓：广角下屋子近端的角会投到画面**几千像素外** ✗，
  // 不裁的话 SVG 里全是超大坐标（而且视图框被撑到没法看）✓。
  const RB_CLIP = (poly) => {
    let out = poly.slice();
    const E = [[0, 0, 1], [0, RB_W, -1], [1, 0, 1], [1, RB_H, -1]];
    for (let e = 0; e < E.length; e++) {
      const ax = E[e][0], lim = E[e][1], dir = E[e][2];
      const inp = out; out = [];
      for (let i = 0; i < inp.length; i++) {
        const A = inp[i], B = inp[(i + 1) % inp.length];
        const da = dir * (A[ax] - lim), db = dir * (B[ax] - lim);
        const ia = da >= 0, ib = db >= 0;
        if (ia) out.push(A);
        if (ia !== ib) {
          const t = da / (da - db);
          out.push([A[0] + t * (B[0] - A[0]), A[1] + t * (B[1] - A[1])]);
        }
      }
      if (!out.length) break;
    }
    return out;
  };
  // 世界多边形 → 裁好的 SVG points
  const RB_CQ = (pts) => RB_QS(RB_CLIP(pts.map(RB_PT)));

  // ── 光 ────────────────────────────────────────────────────────────
  // `d` 是「从面**指向光源**」的单位方向 ✓；面亮度 = Σ max(0, 法线·d) ✓。
  // ⚠️ `d[0]` 必须是**负的** ✓ —— 窗在 x≈-0.58（左半边）✓，所以朝窗看的方向带 -x ✓。
  //    之前写成正的 ✓，右墙（法线 [-1,0,0]）算出负值 → 右墙整面死黑 ✗，
  //    书架那面墙变成一块板 ✗（2026-10-14 渲染里看见了 ✓）。
  const LIGHTS = [
    { d: [-0.14, 0.55, 0.82], w: 1.00, t: [255, 238, 206] },  // 窗光（主）
    { d: [-0.62, 0.26, -0.73], w: 0.36, t: [255, 176, 108] }, // 台灯（暖补）
    { d: [0.05, -0.12, -0.99], w: 0.12, t: [198, 214, 248] }, // 冷色反补
    { d: [-0.85, 0.20, 0.48], w: 0.24, t: [255, 231, 196] }   // 地板弹回来的光
  ];
  const _AMB = 0.66;
  const _HEX = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16),
                       parseInt(h.slice(5, 7), 16)];
  const _CSS = (c) => 'rgb(' +
    Math.max(0, Math.min(255, Math.round(c[0]))) + ',' +
    Math.max(0, Math.min(255, Math.round(c[1]))) + ',' +
    Math.max(0, Math.min(255, Math.round(c[2]))) + ')';
  // 基色 + 面法线 → 受光后的颜色
  // ⚠️ 最后一道是**色调映射**（F = 1 - e^(-c·F)）✓ —— 亮面把 1.4 压回 ≤1 ✓。
  //    不压的话向阳面全变成纯白一块 ✓，木头、布料的材质全丢了 ✗。
  const _TONE = (c) => 255 * (1 - Math.exp(-1.05 * Math.max(0, c) / 255));
  const RB_LIT = (base, n) => {
    const b = _HEX(base);
    let k = _AMB, tr = 0, tg = 0, tb = 0;
    for (let i = 0; i < LIGHTS.length; i++) {
      const L = LIGHTS[i];
      const d = n[0] * L.d[0] + n[1] * L.d[1] + n[2] * L.d[2];
      if (d > 0) {
        k += d * L.w;
        const a = d * L.w * 0.40;
        tr += (L.t[0] - b[0]) * a;
        tg += (L.t[1] - b[1]) * a;
        tb += (L.t[2] - b[2]) * a;
      }
    }
    return _CSS([_TONE(b[0] * k + tr), _TONE(b[1] * k + tg), _TONE(b[2] * k + tb)]);
  };

  // ── 凸盒子 ────────────────────────────────────────────────────────
  // 世界里一个轴对齐的盒子 → 可见面（背面剔除）+ 画家排序 + 逐面受光。
  // 这是整间屋的**基本粒子** ✓：床、桌、柜、书架、书、盒子，全是它 ✓。
  const _CM = [CAM.x, CAM.y, CAM.z];
  const RB_BOX = (cx, cz, y0, w, d, h, col, o) => {
    o = o || {};
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    const C = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
                [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    const F = [[[4, 5, 6, 7], [0, 1, 0]], [[5, 1, 2, 6], [1, 0, 0]],
               [[4, 0, 3, 7], [-1, 0, 0]], [[2, 3, 7, 6], [0, 0, 1]],
               [[1, 0, 4, 5], [0, 0, -1]]];
    const st = o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' +
      (o.sw || 1) + '" stroke-linejoin="round"' : '';
    const vis = [];
    for (let i = 0; i < F.length; i++) {
      const f = F[i], n = f[1];
      let mx = 0, my = 0, mz = 0, dz = 0;
      for (let j = 0; j < 4; j++) {
        const c = C[f[0][j]]; mx += c[0]; my += c[1]; mz += c[2]; dz += RB_Z(c);
      }
      mx /= 4; my /= 4; mz /= 4; dz /= 4;
      // 面朝向相机 = 法线 · (面心 - 相机) < 0
      if (n[0] * (mx - _CM[0]) + n[1] * (my - _CM[1]) + n[2] * (mz - _CM[2]) < 0)
        vis.push([dz, f]);
    }
    vis.sort((a, b) => b[0] - a[0]);           // 远的先画 ✓
    let s = '';
    for (let i = 0; i < vis.length; i++) {
      const f = vis[i][1];
      const pts = [];
      for (let j = 0; j < 4; j++) pts.push(C[f[0][j]]);
      s += '<polygon points="' + RB_Q(pts) + '" fill="' + RB_LIT(col, f[1]) + '"' + st + '/>';
    }
    return s;
  };

  // 凸包（单调链 ✓）—— 影子要用 ✓。i0/i1 选哪两个轴 ✓。
  const RB_HULL = (pts, i0, i1) => {
    i0 = i0 == null ? 0 : i0; i1 = i1 == null ? 1 : i1;
    const p = pts.slice().sort((a, b) => (a[i0] - b[i0]) || (a[i1] - b[i1]));
    const cr = (O, A, B) => (A[i0] - O[i0]) * (B[i1] - O[i1]) - (A[i1] - O[i1]) * (B[i0] - O[i0]);
    const lo = [], up = [];
    for (let i = 0; i < p.length; i++) {
      while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p[i]) <= 0) lo.pop();
      lo.push(p[i]);
    }
    for (let i = p.length - 1; i >= 0; i--) {
      while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p[i]) <= 0) up.pop();
      up.push(p[i]);
    }
    lo.pop(); up.pop();
    return lo.concat(up);
  };

  // ── 影子 ──────────────────────────────────────────────────────────
  // 主光行进方向（`LIGHTS[0].d` 的反向 ✓）→ 影子朝**相机这边**斜拉 ✓。
  // 长度 ∝ 物体高度 ✓（高的东西影子长 ✓，这才是空间感的证据 ✓）。
  // ⚠️ `_SHD` 要按**几何**算 ✓：光每下降 1 单位就在地板上走 0.82/0.55 ≈ 1.49 单位 ✓，
  //    所以 `t` 里的 1.15 是把「1 米高的东西影子走 1.7 米」收回来一点（不然拖出画面外 ✗）。
  const _SHD = [0.17, -0.95];
  const RB_SHADOW = (cx, cz, hw, hd, h, op) => {
    const t = h * 1.15;
    const B = [[cx - hw, 0, cz - hd], [cx + hw, 0, cz - hd],
               [cx + hw, 0, cz + hd], [cx - hw, 0, cz + hd]];
    const cast = [];
    for (let i = 0; i < 4; i++)
      cast.push([B[i][0] + _SHD[0] * t, 0, B[i][2] + _SHD[1] * t]);
    const hull = RB_HULL(B.concat(cast), 0, 2);
    const scr = RB_CLIP(hull.map(RB_PT));
    if (!scr.length) return '';
    return '<polygon points="' + RB_QS(scr) + '" fill="#241509" opacity="' +
      (op == null ? 0.21 : op) + '" filter="url(#rbB1)"/>';
  };

  // ── 涂料 ──────────────────────────────────────────────────────────
  const RB_DEFS = [
    '<defs>',
    '  <linearGradient id="rbSky" x1="0" y1="0" x2="0" y2="1">',
    '    <stop offset="0" stop-color="#8fc9ec"/><stop offset="0.45" stop-color="#c6e6f6"/>',
    '    <stop offset="0.78" stop-color="#eef0d8"/><stop offset="1" stop-color="#f7e6c4"/>',
    '  </linearGradient>',
    '  <radialGradient id="rbPool" cx="0.5" cy="0.5" r="0.5">',
    '    <stop offset="0" stop-color="#ffe4ac" stop-opacity="0.62"/>',
    '    <stop offset="0.55" stop-color="#ffdda0" stop-opacity="0.26"/>',
    '    <stop offset="1" stop-color="#ffdda0" stop-opacity="0"/>',
    '  </radialGradient>',
    '  <radialGradient id="rbLamp" cx="0.5" cy="0.5" r="0.5">',
    '    <stop offset="0" stop-color="#ffd28a" stop-opacity="0.85"/>',
    '    <stop offset="0.5" stop-color="#ffb85e" stop-opacity="0.30"/>',
    '    <stop offset="1" stop-color="#ffb85e" stop-opacity="0"/>',
    '  </radialGradient>',
    '  <radialGradient id="rbWin" cx="0.5" cy="0.5" r="0.5">',
    '    <stop offset="0" stop-color="#fff4da" stop-opacity="0.46"/>',
    '    <stop offset="0.55" stop-color="#fff1d0" stop-opacity="0.16"/>',
    '    <stop offset="1" stop-color="#fff1d0" stop-opacity="0"/>',
    '  </radialGradient>',
    '  <linearGradient id="rbWallG" x1="0" y1="0" x2="0" y2="1">',
    '    <stop offset="0" stop-color="#fff6e2" stop-opacity="0.30"/>',
    '    <stop offset="0.42" stop-color="#fff6e2" stop-opacity="0"/>',
    '    <stop offset="1" stop-color="#4a3218" stop-opacity="0.22"/>',
    '  </linearGradient>',
    '  <radialGradient id="rbVign" cx="0.5" cy="0.44" r="0.74">',
    '    <stop offset="0.52" stop-color="#000" stop-opacity="0"/>',
    '    <stop offset="1" stop-color="#2a180a" stop-opacity="0.36"/>',
    '  </radialGradient>',
    '  <linearGradient id="rbAO" x1="0" y1="0" x2="0" y2="1">',
    '    <stop offset="0" stop-color="#3a2716" stop-opacity="0.30"/>',
    '    <stop offset="1" stop-color="#3a2716" stop-opacity="0"/>',
    '  </linearGradient>',
    '  <filter id="rbB1" x="-45%" y="-45%" width="190%" height="190%">',
    '    <feGaussianBlur stdDeviation="5"/>',
    '  </filter>',
    '  <filter id="rbB2" x="-60%" y="-60%" width="220%" height="220%">',
    '    <feGaussianBlur stdDeviation="13"/>',
    '  </filter>',
    '  <filter id="rbB3" x="-80%" y="-80%" width="260%" height="260%">',
    '    <feGaussianBlur stdDeviation="28"/>',
    '  </filter>',
    '</defs>'
  ].join('\n');

  // ── 几何小工具 ────────────────────────────────────────────────────
  // 绕 Z 轴转 θ 的盒子 ✓（枕头、歪着的书、斜靠的相框都用它 ✓）。
  // 角点在世界里先转好 ✓，所以投影、受光、影子全都照常用 ✓。
  const RB_ROT = (cx, cz, y0, w, d, h, th, col, o) => {
    o = o || {};
    const c = Math.cos(th), s = Math.sin(th);
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    const T = (px, pz) => {
      const a = px - cx, b = pz - cz;
      return [cx + a * c - b * s, cz + a * s + b * c];
    };
    const B = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]
      .map(p => T(p[0], p[2]));
    const Tp = [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]
      .map(p => T(p[0], p[2]));
    const C = B.concat(Tp);
    const F = [[[4, 5, 6, 7], [0, 1, 0]], [[5, 1, 2, 6], s > 0 ? [c, 0, s] : [-c, 0, -s]],
               [[4, 0, 3, 7], s > 0 ? [-c, 0, -s] : [c, 0, s]],
               [[2, 3, 7, 6], s > 0 ? [-s, 0, c] : [s, 0, -c]],
               [[1, 0, 4, 5], s > 0 ? [s, 0, -c] : [-s, 0, c]]];
    const st = o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' +
      (o.sw || 1) + '" stroke-linejoin="round"' : '';
    const vis = [];
    for (let i = 0; i < F.length; i++) {
      const f = F[i], n = f[1];
      let mx = 0, my = 0, mz = 0, dz = 0;
      for (let j = 0; j < 4; j++) {
        const q = C[f[0][j]]; mx += q[0]; my += q[1]; mz += q[2]; dz += RB_Z(q);
      }
      mx /= 4; my /= 4; mz /= 4; dz /= 4;
      if (n[0] * (mx - _CM[0]) + n[1] * (my - _CM[1]) + n[2] * (mz - _CM[2]) < 0)
        vis.push([dz, f]);
    }
    vis.sort((a, b) => b[0] - a[0]);
    let out = '';
    for (let i = 0; i < vis.length; i++) {
      const f = vis[i][1];
      const pts = [];
      for (let j = 0; j < 4; j++) pts.push(C[f[0][j]]);
      out += '<polygon points="' + RB_Q(pts) + '" fill="' + RB_LIT(col, f[1]) + '"' + st + '/>';
    }
    return out;
  };
  // 圆柱（花瓶、杯子、灯杆）✓ —— 一圈竖棱 + 椭圆顶面 ✓。
  const RB_CYL = (cx, cz, y0, r, h, col, o) => {
    o = o || {};
    const N = 12, sides = [], top = [];
    const y1 = y0 + h;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * 2 * Math.PI, a1 = ((i + 1) / N) * 2 * Math.PI;
      sides.push('<polygon points="' + RB_Q([
        [cx + r * Math.cos(a0), y0, cz + r * Math.sin(a0)],
        [cx + r * Math.cos(a1), y0, cz + r * Math.sin(a1)],
        [cx + r * Math.cos(a1), y1, cz + r * Math.sin(a1)],
        [cx + r * Math.cos(a0), y1, cz + r * Math.sin(a0)]
      ]) + '" fill="' + RB_LIT(col, [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)]) + '"/>');
      top.push([cx + r * Math.cos(a1), y1, cz + r * Math.sin(a1)]);
    }
    let s = sides.join('');
    s += '<polygon points="' + RB_Q(top) + '" fill="' + RB_LIT(col, [0, 1, 0]) + '"/>';
    if (o.lip) {
      // 杯口 / 瓶口的内圈 ✓
      const inn = [];
      for (let i = 0; i < N; i++) {
        const a = ((i + 0.5) / N) * 2 * Math.PI;
        inn.push([cx + r * 0.82 * Math.cos(a), y1 - o.lip, cz + r * 0.82 * Math.sin(a)]);
      }
      s = '<polygon points="' + RB_Q(inn) + '" fill="' +
        RB_LIT(o.lipCol || '#3a2a1c', [0, -1, 0]) + '"/>' + s;
    }
    return s;
  };
  // 一个环（在 u/v 张成的平面上 ✓ —— 地板上的圆毯、墙上的钟面、桌面都能用 ✓）
  const RB_RING = (pt, u, v, r, n, col, o) => {
    o = o || {};
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI, c = Math.cos(a), s = Math.sin(a);
      pts.push([pt[0] + (u[0] * c + v[0] * s) * r,
                pt[1] + (u[1] * c + v[1] * s) * r,
                pt[2] + (u[2] * c + v[2] * s) * r]);
    }
    return '<polygon points="' + RB_Q(pts) + '" fill="' + col + '"' +
      (o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + (o.sw || 1) + '"' : '') +
      (o.op != null ? ' opacity="' + o.op + '"' : '') + '/>';
  };
  // 地板上的圆（圆毯、杯垫）✓
  const RB_RND = (cx, cz, r, n, col, o) =>
    RB_RING([cx, o && o.y == null ? 0.002 : o.y, cz], [1, 0, 0], [0, 0, 1], r, n, col, o);
  // 世界里的两点 → 一条线（钟的指针、画框的边、地毯的流苏）✓
  const RB_LINE = (a, b, col, sw, op) => {
    const p = RB_PT(a), q = RB_PT(b);
    return '<line x1="' + p[0].toFixed(1) + '" y1="' + p[1].toFixed(1) +
      '" x2="' + q[0].toFixed(1) + '" y2="' + q[1].toFixed(1) +
      '" stroke="' + col + '" stroke-width="' + (sw || 1) + '"' +
      (op != null ? ' opacity="' + op + '"' : '') + '/>';
  };
  // 一团光晕（灯的暖光、窗的亮边）✓ —— 位置在世界里 ✓，半径在屏幕里 ✓
  const RB_GLOW = (p, r, url, op) => {
    const q = RB_PT(p);
    return '<circle cx="' + q[0].toFixed(1) + '" cy="' + q[1].toFixed(1) + '" r="' + r +
      '" fill="url(#' + url + ')" opacity="' + (op == null ? 1 : op) + '" pointer-events="none"/>';
  };
  // 贴在某个平面上的矩形（墙上的画、窗玻璃、地板上的图案）✓。
  // `pt` = 一个角 ✓；`u`/`v` = 从这个角出发的**世界方向向量**（三个分量 ✓，
  // 斜着的墙、斜着的地板都能用 ✓）。四个角 = pt, pt+u, pt+u+v, pt+v ✓。
  const RB_FACE = (pt, u, v, col, o) => {
    o = o || {};
    const C = (a, b) => [pt[0] + u[0] * a + v[0] * b,
                         pt[1] + u[1] * a + v[1] * b,
                         pt[2] + u[2] * a + v[2] * b];
    return '<polygon points="' + RB_Q([C(0, 0), C(1, 0), C(1, 1), C(0, 1)]) +
      '" fill="' + (o.flat ? col : RB_LIT(col, o.n || [0, 0, -1])) + '"' +
      (o.op != null ? ' opacity="' + o.op + '"' : '') +
      (o.blend ? ' filter="url(#' + o.blend + ')"' : '') +
      (o.stroke ? ' stroke="' + o.stroke + '" stroke-width="' + (o.sw || 1) + '"' : '') + '/>';
  };

  // ── 屋子 ──────────────────────────────────────────────────────────
  // 世界单位≈米 ✓。房间 X -1.32..1.62 · Z 0.45(近)..2.34(远墙) · 层高 2.02 ✓。
  // ⚠️ 侧墙从 Z=0.95 才开始 ✓ —— 近端那一段是**没有墙的** ✓，
  //    等于站在门口往里看 ✓（这是「空间感」的一个来源 ✓：眼睛能一直往里走 ✓）。
  const W = {
    x0: -1.32, x1: 1.62, z0: 0.45, zn: 0.95, z1: 2.34, ceil: 2.02
  };
  // 三面墙的四角
  const _COR = (x, y, z) => [x, y, z];

  // 墙皮：底色 + 一层很淡的竖向渐变（上亮下暗 = 空气里的悬浮感 ✓）
  const RB_WALL = (pts, col, n) => {
    const q = RB_CQ(pts);
    let s = '<polygon points="' + q + '" fill="' + RB_LIT(col, n) + '"/>';
    s += '<polygon points="' + q + '" fill="url(#rbWallG)"/>';
    return s;
  };
  // 一大团软光 / 软影（用**屏幕点** ✓ —— 已经是投影后的形状 ✓）。
  const RB_WEDGE = (pts, col, op, inset, blur) => {
    let mx = 0, my = 0;
    for (let i = 0; i < pts.length; i++) { mx += pts[i][0]; my += pts[i][1]; }
    mx /= pts.length; my /= pts.length;
    const q = pts.map(p => [mx + (p[0] - mx) * (inset == null ? 1 : inset),
                            my + (p[1] - my) * (inset == null ? 1 : inset)]);
    return '<polygon points="' + RB_QS(q) + '" fill="' + col + '" opacity="' + op +
      '" filter="url(#' + (blur || 'rbB3') + ')"/>';
  };

  // ── 屋子外壳 ────────────────────────────────────────────────────
  // 画序：天花板 → 三面墙 → 地板 → 木条 → 墙脚暗 → 木线 → 光的落点 ✓
  const RB_SHELL = (function () {
    const X0 = W.x0, X1 = W.x1, Z0 = W.z0, ZN = W.zn, Z1 = W.z1, CE = W.ceil;
    const C = _COR;
    let s = '';

    // 天花板（只看得见远端那条边 ✓ —— 大部分在画面顶上外 ✓）
    const ceil = RB_CQ([C(X0, CE, Z0), C(X1, CE, Z0), C(X1, CE, Z1), C(X0, CE, Z1)]);
    s += '<polygon points="' + ceil + '" fill="' + RB_LIT('#ded0b4', [0, -1, 0]) + '"/>';
    s += '<polygon points="' + ceil + '" fill="url(#rbWallG)"/>';

    // 三面墙（法线给光照用 ✓ —— 向阳的右墙比背光的后墙亮一截 ✓）
    s += RB_WALL([C(X0, 0, Z1), C(X1, 0, Z1), C(X1, CE, Z1), C(X0, CE, Z1)], '#e7d8ba', [0, 0, -1]);
    s += RB_WALL([C(X0, 0, ZN), C(X0, 0, Z1), C(X0, CE, Z1), C(X0, CE, ZN)], '#d9c6a2', [1, 0, 0]);
    s += RB_WALL([C(X1, 0, Z1), C(X1, 0, ZN), C(X1, CE, ZN), C(X1, CE, Z1)], '#eadbb9', [-1, 0, 0]);

    // 地板
    const flr = RB_CQ([C(X0, 0, Z0), C(X1, 0, Z0), C(X1, 0, Z1), C(X0, 0, Z1)]);
    s += '<polygon points="' + flr + '" fill="' + RB_LIT('#c09257', [0, 1, 0]) + '"/>';

    // 木地板条 ✓ —— 条带**顺着纵深走** = 视线被一条一条引进屋子里 ✓
    const BW = (X1 - X0) / 11;
    const TONES = ['#c99d61', '#c39657', '#cda669', '#bf904f', '#cc9f62', '#c2904f'];
    for (let i = 0; i < 11; i++) {
      const x = X0 + i * BW;
      s += RB_FACE([x, 0.0012, Z0], [BW, 0, 0], [0, 0, Z1 - Z0],
        TONES[(i * 5 + 3) % TONES.length], { flat: true });
    }
    for (let i = 1; i < 11; i++) {                 // 条缝
      const x = X0 + i * BW;
      s += RB_FACE([x - 0.0035, 0.0024, Z0], [0.007, 0, 0], [0, 0, Z1 - Z0],
        '#7c5a2e', { flat: true, op: 0.5 });
    }
    // 条的端头（错开 ✓ —— 真地板是错缝铺的，不是一根通条）
    const ENDS = [[0.9, 1.15], [2.2, 1.62], [3.7, 1.05], [5.1, 1.78], [6.6, 1.28],
                  [8.0, 1.95], [9.4, 1.42], [10.0, 0.95]];
    for (let i = 0; i < ENDS.length; i++) {
      const x = X0 + ENDS[i][0] * BW, z = ENDS[i][1];
      s += RB_FACE([x - 0.0035, 0.0024, Z0], [0.007, 0, 0], [0, 0, z - Z0],
        '#7c5a2e', { flat: true, op: 0.42 });
      s += RB_FACE([x - 0.0035, 0.0024, z], [0.007, 0, 0], [0, 0, Z1 - z],
        '#7c5a2e', { flat: true, op: 0.42 });
    }
    // 木纹（每两条上一道很淡的纹 ✓）
    for (let i = 0; i < 11; i += 2) {
      const x = X0 + i * BW + BW * 0.42;
      s += RB_FACE([x, 0.0028, 0.6], [0.012, 0, 0], [0, 0, 1.5],
        '#a97f42', { flat: true, op: 0.16, blend: 'rbB1' });
    }

    // 墙脚一圈暗（环境光遮蔽 ✓ —— 屋子「压得住地」的关键 ✓）
    s += RB_WEDGE(RB_CLIP([C(X0, 0.001, Z1), C(X1, 0.001, Z1),
                           C(X1, 0.001, 1.84), C(X0, 0.001, 1.84)].map(RB_PT)),
                  '#33200f', 0.32, 1, 'rbB2');
    s += RB_WEDGE(RB_CLIP([C(X0, 0.001, ZN), C(X0, 0.001, Z1),
                           C(-0.78, 0.001, Z1), C(-0.78, 0.001, ZN)].map(RB_PT)),
                  '#33200f', 0.28, 1, 'rbB2');
    s += RB_WEDGE(RB_CLIP([C(X1, 0.001, Z1), C(X1, 0.001, ZN),
                           C(1.05, 0.001, ZN), C(1.05, 0.001, Z1)].map(RB_PT)),
                  '#33200f', 0.28, 1, 'rbB2');

    // 木线：踢脚线 + 顶角线（都是**有厚度**的盒子 ✓，不是画一条线 ✓）
    const TCOL = '#f2e8d2';
    s += RB_BOX(0.15, 2.318, 0, 2.94, 0.046, 0.095, TCOL, { stroke: '#d9c9a4', sw: 0.8 });
    s += RB_BOX(-1.298, 1.645, 0, 0.046, 1.39, 0.095, TCOL, { stroke: '#d9c9a4', sw: 0.8 });
    s += RB_BOX(1.598, 1.645, 0, 0.046, 1.39, 0.095, TCOL, { stroke: '#d9c9a4', sw: 0.8 });
    s += RB_BOX(0.15, 2.322, 1.945, 2.94, 0.056, 0.07, TCOL, { stroke: '#d9c9a4', sw: 0.8 });
    s += RB_BOX(-1.298, 1.645, 1.945, 0.056, 1.39, 0.07, TCOL, { stroke: '#d9c9a4', sw: 0.8 });
    s += RB_BOX(1.598, 1.645, 1.945, 0.056, 1.39, 0.07, TCOL, { stroke: '#d9c9a4', sw: 0.8 });

    return s;
  })();

  // 窗 → 地板的那片光 ✓（光的行进方向 = LIGHTS[0].d 的反向 ✓）
  // ⚠️ 只取窗下半截 ✓ —— 上半截的射线上地板会落在**画面近端之外**（z<0.45）✓，
  //    那条射线的屏幕投影是**病态的**（接近与视线平行 → 投到几千像素外）✗。
  const RB_POOL = (function () {
    const SW = [0.14, -0.55, -0.82];           // 光行进方向（= `LIGHTS[0].d` 取反 ✓）
    const ZW = 2.315;                          // 窗玻璃所在平面
    // (X, Y) → 打在地板上的点
    const hit = (X, Y) => {
      const t = Y / -SW[1];
      return [X + SW[0] * t, 0.0015, ZW + SW[2] * t];
    };
    // ⚠️ Y 上限卡 1.22 ✓ —— 再高一点，落点 z 就跑到 0.45 之外（镜头后边）✓，
    //    投影会飞到画面外上万像素 ✗（2026-10-14 踩过 ✓）。
    const A = hit(-1.05, 0.55), B = hit(-0.10, 0.55);
    const D = hit(-1.05, 1.22), C = hit(-0.10, 1.22);
    const scr = RB_CLIP([A, B, C, D].map(RB_PT));
    if (scr.length < 3) return '';
    let s = '';
    s += '<polygon points="' + RB_QS(scr) + '" fill="#ffe2a6" opacity="0.34" filter="url(#rbB3)"/>';
    // 靠窗那一段更实一点
    const s2 = RB_CLIP([A, B, hit(-0.10, 1.0), hit(-1.05, 1.0)].map(RB_PT));
    s += '<polygon points="' + RB_QS(s2) + '" fill="#ffe7b0" opacity="0.30" filter="url(#rbB2)"/>';
    return s;
  })();

  // ── 组件往哪摆（**世界坐标** ✓）──────────────────────────────────
  // 每个槽 = 一件物**站的那张面**：`x/z` = 面上的位置，`y` = 那张面的高度 ✓。
  // ⚠️ 顺序有意义 ✓ —— 服务端按 `component_spots.pos` 排，前几个必须落在**第一屏**
  //   （手机第一屏只到屏幕 x≈350 ✓）：床面、桌面、柜顶都在第一屏里 ✓。
  const RB_SLOTS = [
    { x: -0.67, y: 0.617, z: 1.43 },   // 床面 ✓（枕头和毯子之间的空当 ✓）
    { x: 0.48, y: 0.778, z: 1.98 },    // 桌面前侧 ✓
    { x: 0.33, y: 0.014, z: 1.10 },    // 圆毯正中 ✓
    { x: 0.05, y: 0, z: 0.85 },        // 地板 ①
    { x: 0.70, y: 0, z: 0.74 },        // 地板 ②
    { x: 1.10, y: 0, z: 0.94 },        // 地板 ③
    { x: 1.33, y: 0, z: 1.40 },        // 地板 ④
    { x: -0.42, y: 0, z: 1.28 },       // 地板 ⑤
    { x: -1.00, y: 0, z: 2.00 },       // 地板 ⑥
    { x: 0.88, y: 0, z: 1.56 },        // 地板 ⑦
  ];

  // ── 家具 ────────────────────────────────────────────────────────
  // 每件家具**是一个整体** ✓，按中心纵深排队（画家算法：远先画、近后画 ✓）。
  // ⚠️ 排序单位是「一件家具」不是一颗方块 ✓ —— 家具之间不穿插所以够用 ✓；
  //    一件家具内部各面，RB_BOX 自己已经排过序了 ✓。
  const _FI = [];
  const _BLOOM = [];
  const _add = (p, s) => { _FI.push([RB_Z(p), s]); };
  const _bloom = (s) => { _BLOOM.push(s); };
  const _furnDump = () => {
    _FI.sort((a, b) => b[0] - a[0]);
    return _FI.map(it => it[1]).join('') + _BLOOM.join('');
  };

  // ── 窗 ✓ —— 远墙左侧 ✓，窗下有书桌、窗上是床的床头 ✓
  (function () {
    const ZW = 2.34, XA = -1.05, XB = -0.10, YA = 0.55, YB = 1.45;
    const XC = (XA + XB) / 2, XCW = XB - XA;
    let s = '';
    // 玻璃（天空）✓
    s += RB_FACE([XA + 0.03, YA + 0.03, ZW - 0.002], [XCW - 0.06, 0, 0], [0, YB - YA - 0.06, 0],
      'url(#rbSky)', { flat: true });
    // 窗外那一小片远景（近处的地、远处的天 ✓ —— 让窗有"景"）✓
    s += RB_FACE([XA + 0.03, YA + 0.03, ZW - 0.002], [XCW - 0.06, 0, 0], [0, 0.34, 0],
      '#bcd8a8', { flat: true, op: 0.75 });
    // 窗棂 ✓
    s += RB_BOX(XC, ZW - 0.010, YA - 0.01, 0.036, 0.028, YB - YA + 0.02, '#f4ebd6',
      { stroke: '#d9cbb0', sw: 0.8 });
    s += RB_BOX(XC, ZW - 0.010, (YA + YB) / 2 - 0.0125, XCW - 0.06, 0.028, 0.025, '#f4ebd6',
      { stroke: '#d9cbb0', sw: 0.8 });
    // 窗框 ✓
    s += RB_BOX(XA + 0.025, ZW - 0.008, YA - 0.03, 0.055, 0.032, YB - YA + 0.06, '#f4ebd6',
      { stroke: '#d3c4a8', sw: 1 });
    s += RB_BOX(XB - 0.025, ZW - 0.008, YA - 0.03, 0.055, 0.032, YB - YA + 0.06, '#f4ebd6',
      { stroke: '#d3c4a8', sw: 1 });
    s += RB_BOX(XC, ZW - 0.008, YB + 0.0275, XCW, 0.032, 0.055, '#f4ebd6',
      { stroke: '#d3c4a8', sw: 1 });
    // 窗台（往外挑出来 ✓ —— 厚度就是"这是块玻璃"的证据）✓
    s += RB_BOX(XC, ZW - 0.022, YA - 0.075, XCW + 0.09, 0.075, 0.055, '#f7f0e0',
      { stroke: '#d0c1a5', sw: 1.1 });
    // 窗帘杆 + 左边那一幅（收起来的 ✓）✓
    s += RB_CYL(XC, ZW - 0.030, YB + 0.105, 0.008, XCW + 0.34, '#7a5630');
    s += RB_BOX(XA - 0.075, ZW - 0.048, 0.24, 0.15, 0.035, YB - YA + 0.42, '#d99f86',
      { stroke: '#bf8469', sw: 1 });
    for (const fx of [-1.14, -1.10, -1.06])
      s += RB_LINE([fx, 0.27, ZW - 0.030], [fx, YB + 0.11, ZW - 0.030], '#c08267', 1.2, 0.7);
    _add([XC, 1.0, ZW - 0.02], s);
    _bloom(RB_GLOW([XC, (YA + YB) / 2, ZW - 0.01], 168, 'rbWin', 0.9));
  })();

  // ── 书桌 ✓ —— 贴在远墙，左端正好挨着窗户 ✓
  (function () {
    const CX = 0.525, CZ = 2.09, TOP = 0.777;
    let s = RB_SHADOW(CX, CZ, 0.45, 0.23, 0.90, 0.26);
    // 桌面 ✓
    s += RB_BOX(CX, CZ, TOP - 0.032, 0.90, 0.46, 0.032, '#bd9460', { stroke: '#93703f', sw: 1.1 });
    // 桌面上的木纹 ✓（两道很淡的）
    s += RB_LINE([-0.02, TOP + 0.001, 1.99], [1.07, TOP + 0.001, 1.99], '#a87f4c', 1, 0.3);
    s += RB_LINE([-0.02, TOP + 0.001, 2.19], [1.07, TOP + 0.001, 2.19], '#a87f4c', 1, 0.3);
    // 后腿（贴着墙那排）✓
    s += RB_BOX(0.12, 2.29, 0, 0.055, 0.05, 0.745, '#a37a45', { stroke: '#836032', sw: 0.9 });
    s += RB_BOX(0.93, 2.29, 0, 0.055, 0.05, 0.745, '#a37a45', { stroke: '#836032', sw: 0.9 });
    // 右侧抽屉柜 ✓（前腿的位置由它占着）
    s += RB_BOX(0.80, CZ, 0.085, 0.32, 0.42, 0.66, '#b08850', { stroke: '#8d6c3c', sw: 1 });
    for (let i = 0; i < 3; i++) {
      const yy = 0.13 + i * 0.22;
      s += RB_BOX(0.80, 1.872, yy, 0.28, 0.016, 0.19, '#c49e67', { stroke: '#9d7a45', sw: 0.8 });
      s += RB_LINE([0.71, yy + 0.095, 1.862], [0.89, yy + 0.095, 1.862], '#5d4325', 2.8, 0.9);
    }
    // 左侧前腿 ✓
    s += RB_BOX(0.12, 1.91, 0, 0.055, 0.05, 0.745, '#a37a45', { stroke: '#836032', sw: 0.9 });
    // ── 桌面上的东西 ✓ ──
    // 杯子 ✓（带把手 ✓）
    s += RB_CYL(0.30, 2.18, TOP, 0.033, 0.088, '#f2ead9', { stroke: '#cfc2a6', sw: 0.8 });
    s += RB_RING([0.334, TOP + 0.045, 2.18], [0, 1, 0], [0, 0, 1], 0.030, 12, 'none',
      { stroke: '#f2ead9', sw: 3 });
    s += RB_RING([0.30, TOP + 0.0865, 2.18], [1, 0, 0], [0, 0, 1], 0.030, 12, '#d8cbb0',
      { stroke: '#c2b294', sw: 0.7 });
    // 一摞书 ✓
    s += RB_ROT(0.70, 2.16, TOP, 0.24, 0.17, 0.026, 0.16, '#b5573f', { stroke: '#8f4230', sw: 0.8 });
    s += RB_ROT(0.70, 2.16, TOP + 0.026, 0.225, 0.16, 0.024, -0.07, '#5d7a94', { stroke: '#44607a', sw: 0.8 });
    s += RB_ROT(0.70, 2.16, TOP + 0.050, 0.20, 0.15, 0.022, 0.24, '#c9a86a', { stroke: '#a5854e', sw: 0.8 });
    // 台灯 ✓
    s += RB_CYL(0.88, 2.13, TOP, 0.045, 0.020, '#463c2c', { stroke: '#2f281d', sw: 0.6 });
    s += RB_CYL(0.88, 2.13, TOP + 0.020, 0.009, 0.19, '#463c2c');
    s += RB_CYL(0.88, 2.13, TOP + 0.205, 0.058, 0.075, '#e6c084',
      { stroke: '#c49a5c', sw: 0.8, lip: 0.014, lipCol: '#6b4f28' });
    _add([CX, 0.78, CZ], s);
    _bloom(RB_GLOW([0.88, TOP + 0.22, 2.13], 62, 'rbLamp', 0.85));
  })();

  // ── 椅子 ✓ —— 斜拉在书桌**左头**前（不挡桌面中右那块 ✓）✓
  (function () {
    const CX = 0.13, CZ = 1.68;
    let s = RB_SHADOW(CX, CZ, 0.20, 0.19, 0.92, 0.20);
    for (const lx of [-0.145, 0.145])
      for (const lz of [-0.135, 0.135])
        s += RB_BOX(CX + lx, CZ + lz, 0, 0.034, 0.034, 0.435, '#8d6c3c');
    s += RB_BOX(CX, CZ, 0.435, 0.35, 0.33, 0.034, '#a8834f', { stroke: '#866434', sw: 1 });
    s += RB_BOX(CX, CZ, 0.469, 0.32, 0.30, 0.048, '#d99f86', { stroke: '#bf8469', sw: 0.9 });
    s += RB_BOX(CX - 0.155, CZ - 0.145, 0.47, 0.028, 0.028, 0.46, '#a8834f',
      { stroke: '#866434', sw: 0.9 });
    s += RB_BOX(CX + 0.155, CZ - 0.145, 0.47, 0.028, 0.028, 0.46, '#a8834f',
      { stroke: '#866434', sw: 0.9 });
    s += RB_BOX(CX, CZ - 0.145, 0.86, 0.34, 0.026, 0.034, '#a8834f',
      { stroke: '#866434', sw: 0.9 });
    s += RB_BOX(CX, CZ - 0.145, 0.66, 0.34, 0.026, 0.030, '#a8834f',
      { stroke: '#866434', sw: 0.9 });
    _add([CX, 0.45, CZ], s);
  })();

  // ── 床 ✓ —— 床头贴左墙，床尾朝画面近端右下 ✓
  (function () {
    let s = RB_SHADOW(-0.70, 1.43, 0.55, 0.44, 1.34, 0.25);
    // 床头板（薄板，贴在左墙上 ✓）+ 两块软包 ✓
    s += RB_BOX(-1.285, 1.43, 0.02, 0.03, 0.86, 1.32, '#8a6434', { stroke: '#6b4d27', sw: 1.1 });
    s += RB_BOX(-1.266, 1.24, 0.13, 0.014, 0.30, 1.04, '#9a7343', { stroke: '#7b5a33', sw: 0.8 });
    s += RB_BOX(-1.266, 1.64, 0.13, 0.014, 0.30, 1.04, '#9a7343', { stroke: '#7b5a33', sw: 0.8 });
    // 床架 → 床垫 → 被子 ✓
    s += RB_BOX(-0.70, 1.43, 0.03, 1.10, 0.88, 0.30, '#a8834f', { stroke: '#866434', sw: 1.1 });
    s += RB_BOX(-0.70, 1.43, 0.33, 1.06, 0.84, 0.17, '#efe9dd', { stroke: '#d8cfbc', sw: 1 });
    s += RB_BOX(-0.70, 1.43, 0.50, 1.02, 0.80, 0.115, '#7f95ad', { stroke: '#67798f', sw: 1 });
    // 被子的褶皱（三道很淡的）✓
    for (const zc of [1.18, 1.40, 1.63])
      s += RB_FACE([-1.20, 0.616, zc], [0.99, 0, 0], [0, 0, 0.013], '#68809a', { flat: true, op: 0.5 });
    // 盖到一半的毯子 ✓
    s += RB_BOX(-0.30, 1.43, 0.616, 0.40, 0.78, 0.030, '#d99f86', { stroke: '#bf8469', sw: 0.9 });
    s += RB_LINE([-0.48, 0.632, 1.30], [-0.12, 0.632, 1.30], '#c08267', 1, 0.55);
    // 两个枕头（歪着躺 ✓）✓
    s += RB_ROT(-1.05, 1.24, 0.615, 0.42, 0.26, 0.125, 0.30, '#f7f2e7', { stroke: '#ddd4c1', sw: 0.9 });
    s += RB_ROT(-1.05, 1.63, 0.615, 0.42, 0.26, 0.125, -0.22, '#f7f2e7', { stroke: '#ddd4c1', sw: 0.9 });
    _add([-0.70, 0.62, 1.43], s);
  })();

  // ── 书架 ✓ —— 沿着右墙往后退，是「空间感」的主轴 ✓
  (function () {
    const CX = 1.47, CZ = 1.80;
    let s = RB_SHADOW(CX, CZ, 0.15, 0.48, 1.52, 0.26);
    s += RB_BOX(1.612, CZ, 0, 0.015, 0.96, 1.50, '#8d6c3c', { stroke: '#6f5429', sw: 0.9 });
    s += RB_BOX(CX, 1.335, 0, 0.30, 0.026, 1.50, '#a8834f', { stroke: '#866434', sw: 1 });
    s += RB_BOX(CX, 2.265, 0, 0.30, 0.026, 1.50, '#a8834f', { stroke: '#866434', sw: 1 });
    s += RB_BOX(CX, CZ, 0.020, 0.28, 0.96, 0.062, '#a8834f', { stroke: '#866434', sw: 0.9 });
    s += RB_BOX(CX, CZ, 1.478, 0.29, 0.97, 0.042, '#a8834f', { stroke: '#866434', sw: 1 });
    const BOARD = [0.485, 0.815, 1.145];
    for (const yy of BOARD)
      s += RB_BOX(CX, CZ, yy, 0.28, 0.90, 0.03, '#a8834f', { stroke: '#866434', sw: 0.9 });
    // 一排排立着的书 ✓ —— 书脊厚度、高度、颜色都不同 ✓
    const SP = ['#b5573f', '#5d7a94', '#c9a86a', '#7d8f5a', '#9c6b86', '#c4a17a',
                '#6d8a8a', '#a86a4e', '#8a7f5a', '#7a94a8', '#bf7f6a', '#6a7d94'];
    for (let li = 0; li < BOARD.length + 1; li++) {
      const yt = (li === 0 ? 0.082 : BOARD[li - 1] + 0.03);
      let zc = 1.40 + (li % 2) * 0.03, k = li;
      while (zc < 2.20) {
        const w = 0.024 + ((k * 37 + li * 11) % 5) * 0.0035;
        const hh = 0.215 + ((k * 17 + li * 23) % 6) * 0.012;
        s += RB_BOX(CX, zc, yt, 0.205, w, hh, SP[(k + li * 3) % SP.length],
          { stroke: 'rgba(40,26,14,0.35)', sw: 0.6 });
        zc += w + 0.0045;
        k++;
      }
      // 每层最右头放一件横躺着的东西 ✓
      s += RB_ROT(1.47, 2.24, yt, 0.19, 0.05, 0.13, 0, SP[(li * 5) % SP.length],
        { stroke: 'rgba(40,26,14,0.3)', sw: 0.6 });
    }
    // 书架顶上一只花瓶 ✓
    s += RB_CYL(1.47, 1.52, 1.52, 0.048, 0.24, '#e8dfd0',
      { stroke: '#c8bca6', sw: 0.8, lip: 0.012, lipCol: '#8c7a5c' });
    s += RB_CYL(1.47, 2.10, 1.52, 0.052, 0.20, '#c98f76',
      { stroke: '#b07a61', sw: 0.8, lip: 0.010, lipCol: '#7a5240' });
    _add([CX, 0.75, CZ], s);
  })();

  // ── 矮柜 ✓ —— 右墙跟前 ✓
  // ⚠️ **必须矮** ✓ —— 之前这里放过一个 1.66 米的高柜，广角镜头一拉变成一块死板
  //    把整个书架都盖了 ✗（2026-10-14 渲染里看见 ✗）。矮下来只挡书架下角 ✓。
  (function () {
    let s = RB_SHADOW(1.41, 1.10, 0.21, 0.13, 0.72, 0.22);
    s += RB_BOX(1.41, 1.10, 0, 0.42, 0.26, 0.64, '#b08850', { stroke: '#8d6c3c', sw: 1.1 });
    s += RB_BOX(1.41, 1.10, 0.638, 0.445, 0.285, 0.040, '#c49e67', { stroke: '#9d7a45', sw: 1 });
    s += RB_BOX(1.192, 1.10, 0.15, 0.016, 0.24, 0.20, '#bd9760', { stroke: '#97743f', sw: 0.8 });
    s += RB_BOX(1.192, 1.10, 0.43, 0.016, 0.24, 0.18, '#bd9760', { stroke: '#97743f', sw: 0.8 });
    s += RB_LINE([1.168, 0.25, 1.00], [1.168, 0.25, 1.20], '#5d4325', 2.4, 0.85);
    s += RB_LINE([1.168, 0.52, 1.00], [1.168, 0.52, 1.20], '#5d4325', 2.4, 0.85);
    // 柜顶 ✓ —— 一只小碗 ✓
    s += RB_CYL(1.52, 1.10, 0.678, 0.062, 0.045, '#e8dfd0',
      { lip: 0.010, lipCol: '#8c7a5c' });
    _add([1.41, 0.34, 1.10], s);
  })();

  // ── 圆毯 ✓ —— 流苏 + 三道圈纹 ✓
  // ⚠️ **单独导出**、不进 FURN ✓ —— 因为它要画在 RB_POOL **底下**（光要落在毯上 ✗）✓
  const RB_RUG = (function () {
    const CX = 0.33, CZ = 1.12, R = 0.50;
    let s = RB_SHADOW(CX, CZ, R * 0.96, R * 0.96, 0.05, 0.12);
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * 2 * Math.PI + 0.05;
      s += RB_LINE([CX + (R + 0.005) * Math.cos(a), 0.004, CZ + (R + 0.005) * Math.sin(a)],
                    [CX + (R + 0.075) * Math.cos(a), 0.004, CZ + (R + 0.075) * Math.sin(a)],
                    '#e7d6ba', 1.5, 0.8);
    }
    s += RB_RND(CX, CZ, R, 30, '#b8735c', { stroke: '#9c5f4a', sw: 1.3 });
    s += RB_RND(CX, CZ, R * 0.87, 30, 'none', { stroke: '#ecdcc2', sw: 2.4 });
    s += RB_RND(CX, CZ, R * 0.65, 26, 'none', { stroke: '#ecdcc2', sw: 1.5 });
    s += RB_RND(CX, CZ, R * 0.33, 20, '#c98a72', { stroke: '#b07a61', sw: 1 });
    return s;
  })();

  // ── 墙上的画 ✓（床头板上面那两面 ✓）+ 墙上的钟 ✓
  (function () {
    let s = '';
    // 画 1 ✓
    s += RB_BOX(-1.303, 1.21, 1.42, 0.036, 0.30, 0.36, '#8a6434', { stroke: '#6b4d27', sw: 1 });
    s += RB_FACE([-1.2845, 1.44, 1.065], [0, 0, 0.27], [0, 0.32, 0], '#e9d3a8', { flat: true });
    s += RB_FACE([-1.2845, 1.44, 1.065], [0, 0, 0.27], [0, 0.11, 0], '#a86a4e', { flat: true, op: 0.7 });
    s += RB_RING([-1.284, 1.68, 1.21], [0, 1, 0], [0, 0, 1], 0.045, 14, '#d9a441', { flat: true });
    // 画 2 ✓
    s += RB_BOX(-1.303, 1.63, 1.44, 0.036, 0.26, 0.42, '#8a6434', { stroke: '#6b4d27', sw: 1 });
    s += RB_FACE([-1.2845, 1.46, 1.505], [0, 0, 0.23], [0, 0.38, 0], '#bcd8a8', { flat: true });
    s += RB_FACE([-1.2845, 1.46, 1.505], [0, 0, 0.23], [0, 0.14, 0], '#5f7f8f', { flat: true, op: 0.75 });
    // 钟（书桌上方那面墙 ✓）✓
    s += RB_RING([0.525, 1.72, 2.333], [1, 0, 0], [0, 1, 0], 0.128, 30, '#f8f3e6',
      { stroke: '#8a6434', sw: 3.5 });
    s += RB_LINE([0.525, 1.72, 2.330], [0.525, 1.800, 2.330], '#3a2a1c', 2.6);
    s += RB_LINE([0.525, 1.72, 2.330], [0.566, 1.704, 2.330], '#3a2a1c', 3.4);
    s += RB_RING([0.525, 1.72, 2.329], [1, 0, 0], [0, 1, 0], 0.007, 10, '#3a2a1c');
    _add([0.1, 1.6, 2.33], s);
  })();

  // ── 那盆角落的植物 ✓ —— 床和远墙之间那个角 ✓
  (function () {
    let s = RB_SHADOW(-1.13, 2.15, 0.14, 0.14, 0.72, 0.2);
    s += RB_CYL(-1.13, 2.15, 0, 0.105, 0.22, '#b5573f', { stroke: '#8f4230', sw: 1 });
    s += RB_RING([-1.13, 0.216, 2.15], [1, 0, 0], [0, 0, 1], 0.098, 14, '#5c4429');
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * 2 * Math.PI;
      const lean = 0.26 + (i % 3) * 0.13;
      s += RB_ROT(-1.13 + 0.02 * Math.cos(a), 2.15 + 0.02 * Math.sin(a), 0.20,
        0.024, 0.11, 0.52 + (i % 4) * 0.06, (a > 1.6 && a < 4.8) ? lean : -lean * 0.5,
        i % 2 ? '#6f8f4e' : '#5c7d40', { stroke: '#46622f', sw: 0.5 });
    }
    _add([-1.13, 0.30, 2.15], s);
  })();

  // ── 角落的一只大盆栽的叶子太密的话上面那段会糊，所以只画到这里 ✓

  const FURN = _furnDump();

  // ── 二狗 ✓ —— 屋里的出口（点它回群聊 ✓）✓
  // ⚠️ 这只猫是**屏幕空间手绘**、**锚在世界位置**上 ✓：
  //    曲线、耳朵、尾巴方块凑不出来 ✗ → 手绘；但它在屋里的**位置**必须是世界的 ✓。
  //    （之前是 🐈 emoji ✗ —— 跟这间屋的手绘风割裂，而且渲染成方框 ✗）
  const RB_CAT_AT = [-0.55, 0, 0.68];
  const RB_CAT = () => {
    const p = RB_PT(RB_CAT_AT);
    const cx = p[0], cy = p[1];
    let s = '';
    // 猫窝 + 地上的软影 ✓
    s += '<ellipse cx="' + cx.toFixed(1) + '" cy="' + (cy + 2).toFixed(1) +
      '" rx="56" ry="14" fill="#241509" opacity="0.20" filter="url(#rbB1)"/>';
    s += '<ellipse cx="' + cx.toFixed(1) + '" cy="' + (cy - 4).toFixed(1) +
      '" rx="52" ry="13" fill="#d8c9ac" stroke="#b3a184" stroke-width="2.2"/>';
    s += '<ellipse cx="' + cx.toFixed(1) + '" cy="' + (cy - 6).toFixed(1) +
      '" rx="41" ry="9" fill="#f0e7d5"/>';
    s += '<path d="M ' + (cx - 50).toFixed(1) + ' ' + (cy - 6).toFixed(1) +
      ' Q ' + cx.toFixed(1) + ' ' + (cy + 6).toFixed(1) + ' ' + (cx + 50).toFixed(1) + ' ' +
      (cy - 6).toFixed(1) + '" fill="none" stroke="#b3a184" stroke-width="2.2"/>';
    // 猫 ✓ —— 坐着，微微侧身
    const bx = cx - 2, by = cy - 8;
    s += '<path d="M ' + (bx - 12).toFixed(1) + ' ' + by.toFixed(1) +
      ' C ' + (bx - 26).toFixed(1) + ' ' + (by - 2).toFixed(1) + ', ' + (bx - 30).toFixed(1) + ' ' +
      (by - 20).toFixed(1) + ', ' + (bx - 18).toFixed(1) + ' ' + (by - 30).toFixed(1) +
      '" fill="none" stroke="#a07a52" stroke-width="7" stroke-linecap="round"/>';
    s += '<path d="M ' + (bx - 13).toFixed(1) + ' ' + by.toFixed(1) +
      ' C ' + (bx - 21).toFixed(1) + ' ' + (by - 15).toFixed(1) + ', ' + (bx - 20).toFixed(1) + ' ' +
      (by - 36).toFixed(1) + ', ' + (bx - 7).toFixed(1) + ' ' + (by - 42).toFixed(1) +
      ' L ' + (bx + 12).toFixed(1) + ' ' + (by - 42).toFixed(1) +
      ' C ' + (bx + 21).toFixed(1) + ' ' + (by - 36).toFixed(1) + ', ' + (bx + 20).toFixed(1) + ' ' +
      (by - 14).toFixed(1) + ', ' + (bx + 12).toFixed(1) + ' ' + by.toFixed(1) +
      ' Z" fill="#a9815a" stroke="#8a6542" stroke-width="1.4" stroke-linejoin="round"/>';
    s += '<ellipse cx="' + (bx + 2).toFixed(1) + '" cy="' + (by - 20).toFixed(1) +
      '" rx="10" ry="14" fill="#d9bd9c"/>';
    // 头 ✓
    s += '<circle cx="' + (bx + 5).toFixed(1) + '" cy="' + (by - 50).toFixed(1) +
      '" r="11.5" fill="#a9815a" stroke="#8a6542" stroke-width="1.4"/>';
    s += '<path d="M ' + (bx - 6).toFixed(1) + ' ' + (by - 57).toFixed(1) +
      ' L ' + (bx - 10).toFixed(1) + ' ' + (by - 71).toFixed(1) + ' L ' + (bx + 1).toFixed(1) + ' ' +
      (by - 61).toFixed(1) + ' Z" fill="#a9815a" stroke="#8a6542" stroke-width="1.4" ' +
      'stroke-linejoin="round"/>';
    s += '<path d="M ' + (bx + 14).toFixed(1) + ' ' + (by - 59).toFixed(1) +
      ' L ' + (bx + 22).toFixed(1) + ' ' + (by - 72).toFixed(1) + ' L ' + (bx + 13).toFixed(1) + ' ' +
      (by - 63).toFixed(1) + ' Z" fill="#a9815a" stroke="#8a6542" stroke-width="1.4" ' +
      'stroke-linejoin="round"/>';
    s += '<path d="M ' + (bx - 6).toFixed(1) + ' ' + (by - 60).toFixed(1) +
      ' L ' + (bx - 8).toFixed(1) + ' ' + (by - 67).toFixed(1) + ' L ' + (bx - 1).toFixed(1) + ' ' +
      (by - 62).toFixed(1) + ' Z" fill="#c98f76"/>';
    s += '<path d="M ' + (bx + 14).toFixed(1) + ' ' + (by - 62).toFixed(1) +
      ' L ' + (bx + 19).toFixed(1) + ' ' + (by - 69).toFixed(1) + ' L ' + (bx + 13).toFixed(1) + ' ' +
      (by - 65).toFixed(1) + ' Z" fill="#c98f76"/>';
    // 眼睛（眯着 ✓ —— 猫在打盹，屋子是安稳的）+ 鼻子 ✓
    s += '<path d="M ' + (bx - 1).toFixed(1) + ' ' + (by - 51).toFixed(1) +
      ' q ' + '3 ' + '2.4 ' + '6 ' + '0" fill="none" stroke="#3a2a1c" stroke-width="1.5" ' +
      'stroke-linecap="round"/>';
    s += '<path d="M ' + (bx + 9).toFixed(1) + ' ' + (by - 51).toFixed(1) +
      ' q ' + '3 ' + '2.4 ' + '6 ' + '0" fill="none" stroke="#3a2a1c" stroke-width="1.5" ' +
      'stroke-linecap="round"/>';
    s += '<path d="M ' + (bx + 5).toFixed(1) + ' ' + (by - 46.5).toFixed(1) +
      ' l ' + '2.2 ' + '2.2 l ' + '-4.4 ' + '0 Z" fill="#c98f76"/>';
    return s;
  };

/* ---APPEND--- */
