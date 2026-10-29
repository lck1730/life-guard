/* ═══════════════════════════════════════════════════════════════════════
   顶栏那只猫猫仔（2026-10-30）

   用户的原话：
     「管家状态条不要了，换成一个气泡小猫形象的猫猫仔顶部空间活动，
       平时在睡觉，偶尔舒展身体走两下，发送消息后会处于思考状态，
       回复完或者不回复就处于睡觉或者休闲状态」

   ★ 这一页是**顶层的** ✓ —— 它不在 01–06 那个大闭包里 ✓（闭包在 06 末尾收口 ✓）。
     所以这里**不用** `$` / `setStatus` / `group` 那些 ✓；它只认 DOM + `window` ✓。
     反过来，闭包里的 `setStatus()`（03-auth.js）通过 `window.__lgCat` 叫它 ✓。

   分工（照项目的老规矩 ✓）：
     · **CSS 管长相和动作** ✓ —— 全挂在 `#cat[data-mood="…"]` 上 ✓（见 app.css）
     · **这里只管"现在是什么心情"** ✓ —— 一次只换一个 data-mood ✓，不写 style ✗
     · **心情从哪来** ✓ —— 服务端的状态事件（thinking / typing / lurking / done ✓）
       加上"自己刚发了消息"这个**立刻**的反馈 ✓（事件回来之前那几百毫秒也要有反应 ✓）

   心情表：
     sleep   打盹（默认 ✓，z z z ✓，偶尔自己伸懒腰 / 走两步 ✓）
     awake   发呆（回复完先醒一会儿 ✓，或者"不打算说话" ✓）
     think   想事情（头顶三颗点 + 尾巴快摆 ✓）
     stretch 伸懒腰（1.9s ✓）
     walk    走两步（3.6s ✓）
   ═══════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const el = document.getElementById('cat');
  if (!el) return;

  const reduce = () => !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const LABEL = {
    sleep:   '猫猫仔趴在顶上打盹',
    awake:   '猫猫仔在发呆',
    think:   '猫猫仔在琢磨',
    stretch: '猫猫仔伸了个懒腰',
    walk:    '猫猫仔走了两步',
  };

  // 底子（sleep / awake）和短暂动作（think / stretch / walk）分开存 ✓：
  // 动作演完要**落回底子** ✓，而不是每次都猜"之前是什么" ✗。
  let base = 'sleep';
  let overlay = null;
  let baseTimer = null;      // 醒一会儿 → 睡回去
  let overlayTimer = null;   // 伸懒腰 → 走 → 结束
  let failSafe = null;       // 思考最多维持多久（防止猫永远在想 ✗）
  let wanderTimer = null;    // 下一次自己找事做
  let wokeOnce = false;      // 打开 App 时别先醒一下（第一个 idle 继续睡 ✓）
  let hidden = document.hidden;

  const clearT = (t) => { if (t) clearTimeout(t); return null; };

  const paint = () => {
    const m = overlay || base;
    if (el.getAttribute('data-mood') !== m) el.setAttribute('data-mood', m);
    const label = LABEL[m] || LABEL.sleep;
    if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
  };

  // ── 自己找事做 ────────────────────────────────────────────────────
  const clearWander = () => { wanderTimer = clearT(wanderTimer); };

  const scheduleWander = (ms) => {
    clearWander();
    if (hidden || reduce()) return;
    wanderTimer = setTimeout(wander,
      ms == null ? (9000 + Math.random() * 7000) : ms);
  };

  const wander = () => {
    wanderTimer = null;
    // 只有**睡着**且没别的事时才自己动 ✓ —— 用户在看、在聊的时候别乱走 ✗。
    if (hidden || reduce() || overlay || base !== 'sleep') return;
    overlay = 'stretch'; paint();
    overlayTimer = clearT(overlayTimer);
    overlayTimer = setTimeout(() => {
      overlay = 'walk'; paint();
      overlayTimer = setTimeout(() => {
        overlay = null; overlayTimer = null; paint();
        scheduleWander(13000 + Math.random() * 11000);
      }, 3600);                        // 跟 app.css 的 catWalk 一致 ✓
    }, 1900);                          // 跟 app.css 的 catStretch 一致 ✓
  };

  const stopOverlay = () => {
    overlay = null;
    overlayTimer = clearT(overlayTimer);
  };

  // ── 底子 ──────────────────────────────────────────────────────────
  const setBase = (m, ms) => {
    base = m;
    baseTimer = clearT(baseTimer);
    if (m === 'awake') {
      clearWander();
      baseTimer = setTimeout(() => {
        baseTimer = null;
        if (overlay) return;           // 这期间又忙起来了 → 让那边收尾 ✓
        base = 'sleep';
        scheduleWander();
        paint();
      }, ms || 9000);
    } else {
      scheduleWander();
    }
    if (!overlay) paint();
  };

  const toAwake = (ms) => {
    stopOverlay();
    failSafe = clearT(failSafe);
    setBase('awake', ms);
  };

  const think = (ms) => {
    wokeOnce = true;
    baseTimer = clearT(baseTimer);
    clearWander();
    base = 'sleep';                    // 想完直接睡 ✓（不额外多醒一轮 ✓）
    overlay = 'think';
    paint();
    failSafe = clearT(failSafe);
    // ⚠️ 兜底：服务端断了 / 那一轮被掐了，猫不能永远在琢磨 ✗
    failSafe = setTimeout(() => {
      failSafe = null;
      if (overlay === 'think') toAwake(6000);
    }, ms || 60000);
  };

  /** 服务端四个状态 → 猫的心情 ✓。
   *  thinking / typing → 抬头想 ✓；lurking → 醒着但不冒泡 ✓；idle → 先醒再睡 ✓。 */
  const set = (s) => {
    if (s === 'thinking' || s === 'typing') { think(); return; }
    if (s === 'lurking') { wokeOnce = true; toAwake(6500); return; }
    // idle：**没发过消息就接着睡** ✓ —— 打开 App / 切空间不是"叫醒它"的理由 ✗
    if (!wokeOnce && !overlay) {
      base = 'sleep';
      scheduleWander();
      paint();
      return;
    }
    toAwake(7000);
  };

  /** 手动叫醒（比如自己刚发了一条 ✓）。`ms` = 多久后睡回去。 */
  const wake = (ms) => {
    wokeOnce = true;
    toAwake(ms || 7000);
  };

  // ── 页面不可见就别空转 ✓（动画本来也会被浏览器节流 ✓，定时器自己收 ✓）──
  const onVis = () => {
    hidden = document.hidden;
    if (hidden) {
      clearWander();
    } else if (base === 'sleep' && !overlay) {
      scheduleWander(4000 + Math.random() * 3000);
    }
  };
  document.addEventListener('visibilitychange', onVis);

  window.__lgCat = {
    set,
    think,
    wake,
    mood: () => overlay || base,
  };

  paint();
  scheduleWander(8000 + Math.random() * 6000);
})();
