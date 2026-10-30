/* ═══════════════════════════════════════════════════════════════════════
   顶栏那只猫猫仔（2026-10-30 · 第二版）

   用户这一版的原话：
     「这个猫猫形象和气泡猫猫不是很像，并且动作很僵硬」
     「猫猫活动范围有些局限，应该再整个状态栏都可以运动，左边可以有喝水吃猫粮的地方，
       右边是窝着睡觉觉的地方，中间可以走动，也能趴着睡」

   ★ 这一页是**顶层的** ✓ —— 它不在 01–06 那个大闭包里 ✓（闭包在 06 末尾收口 ✓）。
     所以这里**不用** `$` / `setStatus` / `group` 那些 ✓；它只认 DOM + `window` ✓。
     反过来，闭包里的 `setStatus()`（03-auth.js）通过 `window.__lgCat` 叫它 ✓。

   分工（照项目的老规矩 ✓）：
     · **CSS 管长相和动作** ✓ —— 全挂在 `#cat[data-mood="…"]` 上 ✓（见 app.css）
     · **这里只管三件事** ✓ —— ①现在什么心情 ✓ ②站在第几像素 ✓ ③接下来去哪 ✓
     · 心情从哪来 ✓ —— 服务端的状态事件（thinking / typing / lurking / done ✓）
       加上"自己刚发了消息"这个**立刻**的反馈 ✓

   站台（顶栏那 30px，和群名同一条线、压在名字前面，见 index.html ✓）：
     water 最左的水碗 ✓    food 饭盆 ✓
     mid1 / mid2 中间两块地 ✓（趴下就是"趴着睡" ✓）
     bed 最右的猫窝 ✓（默认就睡在这儿 ✓）
   规矩：
     · **用户一开口（think / 醒着）就原地站住** ✓ —— 不许把人话晾着、自己溜达 ✗
     · 用户的事办完 → 在碗边就回中间 ✓，在窝里就地趴下 ✓
     · **没事干才溜达** ✓，多半去中间 / 碗边 ✓，**小概率（22%）回窝** 睡一觉 ✓
       （一直不回家 = 窝白摆 ✗；每次都回家 = 地板大半时间空着 ✗）
     · 页面不可见 / 减弱动态 → 一律不动 ✓

   心情表：
     sleep   趴着睡（身子压扁 + 闭眼 + z z z ✓）
     awake   抬头发呆（碗边吃完那几秒 ✓，或者"不打算说话" ✓）
     think   想事情（头顶三颗点 + 尾巴快摆 ✓）
     walk    走过去（前爪交替 + 身子轻颠 + 朝前微倾 ✓）
     drink   低头喝水（水碗起涟漪 ✓）
     eat     低头吃猫粮（猫粮轻颤 ✓）
     stretch 伸懒腰（1.65s ✓，跟 app.css 的 catStretch 一致 ✓）
   ═══════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const el = document.getElementById('cat');
  const stage = document.getElementById('catStage');
  if (!el || !stage) return;

  const waterEl = stage.querySelector('.cat-water');
  const foodEl = stage.querySelector('.cat-food');
  const bedEl = stage.querySelector('.cat-bed');

  const reduce = () => !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const LABEL = {
    sleep:   '猫猫仔趴着打盹',
    awake:   '猫猫仔抬头发呆',
    think:   '猫猫仔在琢磨',
    walk:    '猫猫仔在走动',
    drink:   '猫猫仔在喝水',
    eat:     '猫猫仔在吃猫粮',
    stretch: '猫猫仔伸了个懒腰',
  };

  let spot = 'bed';        // 站在哪个站 ✓
  let mood = 'sleep';      // 现在什么心情 ✓（CSS 只认这一个 ✓）
  let mode = 'auto';       // auto = 自己过日子 ✓ / user = 用户的事还没完 ✓
  let moving = false;      // 正在走过去 ✓（这期间别叠别的动作 ✗）
  let x = 0;               // 现在的 --cat-x ✓
  let wokeOnce = false;    // 打开 App 时别先醒一下 ✓（第一个 idle 继续睡 ✓）
  let hidden = document.hidden;

  let idleTimer = null;    // 下一次自己找事做 ✓
  let actTimer = null;     // 碗边吃多久 / 醒多久 ✓
  let walkTimer = null;    // 走到没走到 ✓
  let thinkTimer = null;   // 思考的兜底 ✓

  const clearT = (t) => { if (t) clearTimeout(t); return null; };
  const catW = () => el.offsetWidth || 33;
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ── 位置 ────────────────────────────────────────────────────────────
  // 站哪 = 那个东西的**实测中心** − 猫身上那个点相对猫箱左边的距离 ✓。
  // 嘴在 viewBox 的 48/100 ✓（低头够碗 ✓）；身子在 50/100 ✓（趴窝 ✓）。
  const rectIn = (node) => {
    const r = node.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return { mid: r.left - s.left + r.width / 2 };
  };

  const xFor = (name) => {
    const w = catW();
    const sw = stage.clientWidth || 320;
    let px;
    if (name === 'water' || name === 'food') {
      px = rectIn(name === 'water' ? waterEl : foodEl).mid - w * 0.48;
    } else if (name === 'bed') {
      px = rectIn(bedEl).mid - w * 0.5;
    } else if (name === 'mid1') {
      px = sw * 0.36 - w * 0.5;
    } else {                                  // mid2
      px = sw * 0.60 - w * 0.5;
    }
    return Math.max(2, Math.min(sw - w - 2, px));
  };

  const setX = (px) => {
    x = px;
    el.style.setProperty('--cat-x', px + 'px');
  };

  // ── 心情 ────────────────────────────────────────────────────────────
  const setMood = (m) => {
    mood = m;
    if (el.getAttribute('data-mood') !== m) el.setAttribute('data-mood', m);
    const label = LABEL[m] || LABEL.sleep;
    if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
    // 碗里的动静跟着心情走 ✓（水波 / 猫粮轻颤 ✓，见 app.css）
    const act = (m === 'eat' || m === 'drink') ? m : '';
    if (stage.dataset.act !== act) stage.dataset.act = act;
  };

  // ── 走过去 ──────────────────────────────────────────────────────────
  /** 走到 `target` 之后做 `done` ✓。时长按距离算 ✓（快慢一致 ✓，不是固定 3.6s ✗）。 */
  const walkTo = (target, done) => {
    idleTimer = clearT(idleTimer);
    actTimer = clearT(actTimer);
    walkTimer = clearT(walkTimer);
    spot = target;
    const to = xFor(target);
    const dist = Math.abs(to - x);

    if (reduce() || dist < 2) {
      moving = false;
      el.classList.remove('walking');
      setX(to);
      if (done) done();
      return;
    }

    el.dataset.dir = to < x ? 'l' : 'r';
    const ms = Math.max(600, Math.round(dist / 0.058));   // ≈ 58px/s ✓（步子频 0.37s ✓，再快就像滑 ✗）
    el.style.setProperty('--walk-ms', ms + 'ms');
    moving = true;
    el.classList.add('walking');
    void el.offsetWidth;          // 先让"带过渡"这件事生效 ✓，再改坐标 ✓
    setX(to);
    setMood('walk');
    walkTimer = setTimeout(() => {
      walkTimer = null;
      moving = false;
      el.classList.remove('walking');
      if (done) done();
    }, ms + 30);
  };

  /** 半路被打断（用户发消息了 ✓）：就地站住 ✓，不许"滑"到目的地 ✗。 */
  const freeze = () => {
    if (!moving) return;
    walkTimer = clearT(walkTimer);
    const s = stage.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const here = Math.max(0, Math.min(stage.clientWidth - catW(), r.left - s.left));
    el.classList.remove('walking');
    setX(here);
    moving = false;
  };

  // ── 自己过日子 ──────────────────────────────────────────────────────
  const schedule = (ms) => {
    idleTimer = clearT(idleTimer);
    if (hidden || reduce() || mode !== 'auto') return;
    idleTimer = setTimeout(decide, ms == null ? rnd(9000, 17000) : ms);
  };

  const clearAuto = () => {
    idleTimer = clearT(idleTimer);
    actTimer = clearT(actTimer);
  };

  /** 到站以后干什么 ✓（中间 → 趴下 ✓；碗边 → 抬头醒一会儿再回家 ✓）。 */
  const arrive = () => {
    if (spot === 'water' || spot === 'food') {
      setMood('awake');
      actTimer = clearT(actTimer);
      actTimer = setTimeout(() => {
        actTimer = null;
        if (mode !== 'auto') return;
        walkTo('mid1', () => { setMood('sleep'); schedule(); });
      }, rnd(1600, 2800));
      return;
    }
    setMood('sleep');
    schedule();
  };

  /** 决定去哪儿 ✓。
   *  窝是"回家"的地方 ✓：不是每一趟都回 ✗（一直回窝 = 地板大半时间是空的 ✗），
   *  但也不能永远不回 ✗ —— 所以**小概率**（22%）回窝睡一觉 ✓。 */
  const decide = () => {
    idleTimer = null;
    if (hidden || reduce() || mode !== 'auto' || moving) return;
    const pool = ['mid1', 'mid2', 'water', 'food'].filter((v) => v !== spot);
    let next = pool[Math.floor(Math.random() * pool.length)];
    if (spot !== 'bed' && Math.random() < 0.22) next = 'bed';

    const go = () => {
      if (next === 'water' || next === 'food') {
        walkTo(next, () => {
          setMood(next === 'water' ? 'drink' : 'eat');
          actTimer = clearT(actTimer);
          actTimer = setTimeout(() => {
            actTimer = null;
            if (mode !== 'auto') return;
            setMood('awake');
            actTimer = setTimeout(() => {
              actTimer = null;
              if (mode !== 'auto') return;
              walkTo('mid1', () => { setMood('sleep'); schedule(); });
            }, rnd(1400, 2400));
          }, rnd(3600, 6000));
        });
        return;
      }
      walkTo(next, arrive);
    };

    // 偶尔先从窝里伸个大懒腰再走 ✓（动作清单里已经有的那个 ✓）
    if (spot === 'bed' && Math.random() < 0.45) {
      setMood('stretch');
      actTimer = setTimeout(() => { actTimer = null; go(); }, 1650);
    } else {
      go();
    }
  };

  // ── 用户那边的事 ────────────────────────────────────────────────────
  /** 想事情 ✓。`ms` 是兜底时长 ✓（服务端断了也不能永远在想 ✗）。 */
  const think = (ms) => {
    wokeOnce = true;
    mode = 'user';
    clearAuto();
    freeze();
    setMood('think');
    thinkTimer = clearT(thinkTimer);
    thinkTimer = setTimeout(() => {
      thinkTimer = null;
      if (mood === 'think') userAwake(6000);
    }, ms || 60000);
  };

  /** 醒着但不冒泡泡 ✓。`ms` 到了以后就地睡 / 从碗边回家 ✓。 */
  const userAwake = (ms) => {
    mode = 'user';
    clearAuto();
    thinkTimer = clearT(thinkTimer);
    freeze();
    setMood('awake');
    actTimer = setTimeout(() => {
      actTimer = null;
      if (mode !== 'user') return;
      mode = 'auto';
      if (spot === 'water' || spot === 'food') {
        walkTo('mid1', () => { setMood('sleep'); schedule(); });
      } else {
        setMood('sleep');
        schedule();
      }
    }, ms || 7000);
  };

  /** 服务端状态 → 猫的心情 ✓。
   *  thinking / typing → 抬头想 ✓；lurking → 醒着但不冒泡 ✓；idle → 先醒再睡 ✓。 */
  const set = (s) => {
    if (s === 'thinking' || s === 'typing') { think(); return; }
    if (s === 'lurking') { wokeOnce = true; userAwake(6500); return; }
    // idle：**没发过消息就接着睡** ✓ —— 打开 App / 切空间不是"叫醒它"的理由 ✗
    if (!wokeOnce) {
      if (mood === 'think' || moving) return;   // 让它把手上的事做完 ✓
      mode = 'auto';
      if (mood !== 'sleep' && mood !== 'stretch') setMood('sleep');
      schedule();
      return;
    }
    userAwake(7000);
  };

  /** 手动叫醒（比如自己刚发了一条 ✓）。`ms` = 多久后睡回去。 */
  const wake = (ms) => {
    wokeOnce = true;
    userAwake(ms || 7000);
  };

  // ── 页面不可见就别空转 ✓（动画本来也会被浏览器节流 ✓，定时器自己收 ✓）──
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    if (hidden) { clearAuto(); return; }
    if (mode !== 'auto' || moving) return;
    if (mood === 'sleep') schedule(rnd(2500, 6500));
  });

  // ── 尺寸变了（转屏 / 分屏 ✓）→ 重新站到那个东西前面 ✓ ──────────────
  let lastW = 0;
  const replace = () => {
    const w = stage.clientWidth;
    if (w === lastW) return;
    lastW = w;
    if (w < 40) return;           // 这一屏还没显示出来 ✓（等它显示 ✓）
    freeze();
    setX(xFor(spot));
  };
  if (window.ResizeObserver) new ResizeObserver(replace).observe(stage);
  else window.addEventListener('resize', replace);

  window.__lgCat = {
    set,
    think,
    wake,
    mood: () => mood,
  };

  // 开场：睡在窝里 ✓（ResizeObserver 第一次回调会把位置量准 ✓，
  // 这里先给一个"不用等"的估值 ✓ —— 0 宽的话它自己会再量 ✓）
  setMood('sleep');
  replace();
  schedule(rnd(7000, 13000));
})();
