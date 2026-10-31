/* ═══════════════════════════════════════════════════════════════════════
   顶栏那只猫猫仔（2026-10-31 · 第九版：水碗 / 饭盆拿掉，左边换成猪猪 + 鸭鸭）

   第九版用户原话：
     「去掉水和食物，然后在上面添加猪猪和鸭鸭陪伴猫猫，
       形象就是来自气泡的猪猪和鸭鸭形象，试试」
   → 左边挪出两只**不吃不喝的伙伴** ✓（长相照气泡贴纸那两张脸画 ✓，
     身子是我补的 ✓ —— 见 index.html / app.css ✓）；
     猫多了个 `friends` 站 ✓（猪猪右手边那块地 ✓），会走过去挨着坐 ✓；
     一走近，它俩就原地蹦一下 + 冒爱心 ✓（见下面 maybeFriends ✓）。
     ★ **喝水 / 吃猫粮整套删了** ✓ —— 水碗、饭盆、舌头、涟漪、猫粮碎渣全没了 ✓，
       `drink` / `eat` 两个心情也跟着没了 ✓（别再捡回来 ✗）。

   第五版（动作那一版）的用户原话：
     「猫猫动作很僵硬」「吃饭喝水睡觉动作穿模且不自然」「建模也有点粗糙」
     「猫猫有点多动症，按理来说猫猫应该比较懒，不会一直动来动去，并且跑步速度很快」
     「跑步动作也不自然」「形象还是要保持，建模细节可以优化，动作类型也可以多一些，
       自然切换」

   ★ 这一页是**顶层的** ✓ —— 它不在 01–06 那个大闭包里 ✓（闭包在 06 末尾收口 ✓）。
     所以这里**不用** `$` / `setStatus` / `group` 那些 ✓；它只认 DOM + `window` ✓。
     反过来，闭包里的 `setStatus()`（03-auth.js）通过 `window.__lgCat` 叫它 ✓。

   分工（照项目的老规矩 ✓）：
     · **CSS 管长相和动作** ✓ —— 全挂在 `#cat[data-mood="…"]` 上 ✓（见 app.css）
     · **这里只管三件事** ✓ —— ①现在什么心情 ✓ ②站在第几像素 ✓ ③接下来去哪 ✓

   ★ 第五版改的三处（都是"看着假"的根子 ✓）：
     ① **走路不再用 CSS transition** ✗ → 逐帧写 `--cat-x` ✓（smoothstep 慢起慢收 ✓）。
        旧版固定 0.37s 步频 + 58px/s 的匀速滑 → 就是用户说的"跑步不自然 / 很快" ✓。
        现在 **30px/s** ✓（≈ 猫慢慢溜达 ✓），步子 460ms ✓，走远路也只会更久 ✗ 不会更快 ✓。
     ② **不再每 9–17s 就决定一次** ✗ → 睡一次 26–74s ✓，醒来常先打个哈欠 / 伸个懒腰 ✓，
        一动之后**六成**接着睡 ✓。真猫一天睡 12–16 小时 ✓。
     ③ **多了九种心情** ✓：settle（趴下前那一下）/ look（东张西望）/ groom（洗脸）/
        knead（踩奶）/ yawn（哈欠）/ perk（竖耳朵）—— 都是真猫会做的事 ✓，
        而且**每一种都有"入 / 出"的过渡** ✓，不再硬切 ✗。

   站台（顶栏那 30px，和群名同一条线、压在名字前面，见 index.html ✓）：
     friends 最左边：鸭鸭 + 猪猪 ✓（猫挨着它们坐 = "陪伴" ✓）
     mid1 / mid2 中间两块地 ✓（趴下就是"趴着睡" ✓）
     bed 最右的猫窝 ✓（默认就睡在这儿 ✓）

   规矩：
     · **用户一开口（think / 醒着）就原地站住** ✓ —— 不许把人话晾着、自己溜达 ✗
     · 用户的事办完 → 在朋友们旁边就回中间 ✓，在窝里就地趴下 ✓
     · **没事干才溜达** ✓，而且**偏爱近处** ✓（懒得走远 ✓）
     · 走到猪猪 / 鸭鸭旁边 → 它俩蹦一下 + 冒爱心 ✓（见下面 maybeFriends ✓）
     · 页面不可见 / 减弱动态 → 一律不动 ✓

   心情表：
     sleep   趴着睡（身子压成一条面包 + 闭眼 + z z z + 偶尔抽耳朵 ✓）
     settle  要趴下了（0.9s 矮下去 ✓ 再睡 ✓）
     awake   抬头发呆（呼吸 + 慢慢左右看 ✓）
     look    东张西望（比 awake 看得远一点 ✓）
     grooming / knead —— 洗脸 / 踩奶（闭眼 ✓）
     yawn    打哈欠（抬头张嘴 ✓）
     perk    竖起耳朵（一下抬头 ✓）
     think   想事情（头顶三颗点 + 尾巴快摆 ✓）
     walk    走过去（小碎步 + 身子左右摇 + 尾巴稳 ✓）
     stretch 伸懒腰（1.9s ✓，跟 app.css 的 catStretch / catStretchHead 一致 ✓）
   ═══════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const el = document.getElementById('cat');
  const stage = document.getElementById('catStage');
  if (!el || !stage) return;

  const bedEl = stage.querySelector('.cat-bed');
  // ★ 第九版：左边那两只伙伴 ✓（水碗 / 饭盆拿掉以后站在这儿 ✓）
  //   猫走过去挨着坐时，它俩蹦一下 + 冒爱心 ✓（见下面 maybeFriends ✓）
  const friendEls = [stage.querySelector('.cat-pig'), stage.querySelector('.cat-duck')];
  const pigEl = friendEls[0];
  // ★ 第八版：墙上那只挂着的猫猫玩具 ✓（住在 #catWall 里 ✓，不是 stage 里 ✓）
  //   —— 猫从底下过时，给它挂一个 `.swish` 让它荡一下 ✓（见下面 maybeToy）
  const toyEl = document.querySelector('#catWall .cw-toy');

  const reduce = () => !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const LABEL = {
    sleep:   '猫猫仔趴着打盹',
    settle:  '猫猫仔要趴下了',
    awake:   '猫猫仔抬头发呆',
    look:    '猫猫仔在东张西望',
    groom:   '猫猫仔在洗脸',
    knead:   '猫猫仔在踩奶',
    yawn:    '猫猫仔打了个哈欠',
    perk:    '猫猫仔竖起了耳朵',
    think:   '猫猫仔在琢磨',
    walk:    '猫猫仔在走动',
    stretch: '猫猫仔伸了个懒腰',
  };

  const WALK_V = 30;        // px/s ✓（猫慢慢溜达 ✓；旧版 58px/s = 小跑 ✗）
  const STEP_MS = 720;      // 一步的时间 ✓（慢 ✓；走路时写进 --step-ms ✓）
  const SLEEP_MS = [26000, 74000];   // 睡一觉多久 ✓

  let spot = 'bed';        // 站在哪个站 ✓
  let mood = 'sleep';      // 现在什么心情 ✓（CSS 只认这一个 ✓）
  let mode = 'auto';       // auto = 自己过日子 ✓ / user = 用户的事还没完 ✓
  let x = 0;               // 现在的 --cat-x ✓
  let wokeOnce = false;    // 打开 App 时别先醒一下 ✓（第一个 idle 继续睡 ✓）
  let hidden = document.hidden;

  let stepRaf = 0;         // 正在走的逐帧句柄 ✓（0 = 没在走 ✓）
  let idleTimer = null;    // 下一次自己找事做 ✓
  let actTimer = null;     // 当前这一段（坐多久 / 趴下那 0.9s）✓
  let thinkTimer = null;   // 思考的兜底 ✓

  const clearT = (t) => { if (t) clearTimeout(t); return null; };
  const catW = () => el.offsetWidth || 33;
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ── 位置 ────────────────────────────────────────────────────────────
  // 站哪 = 那个东西的**实测中心** − 猫身上那个点相对猫箱左边的距离 ✓。
  // 身子在 viewBox 的 50/100 ✓（趴窝 ✓）；`friends` 站用它的**右沿** ✓（贴着猪猪坐 ✓）。
  const rectIn = (node) => {
    const r = node.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return { mid: r.left - s.left + r.width / 2, right: r.right - s.left };
  };

  const xFor = (name) => {
    const w = catW();
    const sw = stage.clientWidth || 320;
    let px;
    if (name === 'friends') {
      // 第九版：坐在**猪猪右手边** ✓ —— 猫的左沿离它 2px ✓（猪猪 30–48、猫 33 宽
      // → 50–83 ✓）。320px 下名字左沿 ≈81 ✓，会压住一点点 ✓ —— 和走过去时一样 ✓，
      // 猫本来就压在名字前面 ✓（用户要的 ✓，别调回去 ✗）。
      px = pigEl ? rectIn(pigEl).right + 2 : sw * 0.15;
    } else if (name === 'bed') {
      px = rectIn(bedEl).mid - w * 0.5;
    } else if (name === 'mid1') {
      px = sw * 0.36 - w * 0.5;
    } else {                                  // mid2
      px = sw * 0.60 - w * 0.5;
    }
    // ★ 左边放宽到 0 ✓（旧版卡在 2px → 脸对不准碗 ✓；现在朋友们在 5–48 ✓，
    //   `friends` 站要贴着猪猪 ✓ —— 卡死左边就会把它推歪 ✓）
    return Math.max(0, Math.min(sw - w - 2, px));
  };

  const setX = (px) => {
    x = px;
    el.style.setProperty('--cat-x', px + 'px');
    maybeToy();          // ★ 第八版：走到玩具底下就扒一下 ✓（见下面 maybeToy ✓）
    maybeFriends();      // ★ 第九版：走到猪猪 / 鸭鸭旁边 → 它俩高兴一下 ✓
  };

  // ── 墙上那只挂着的猫猫玩具（2026-10-31 第八版）────────────────────────
  // 用户：「可以在合适位置摆放一个挂起来的猫猫玩具，我觉得可以放在群昵称和饭的中间」✓
  // 位置和长相全在 index.html / app.css 里 ✓；这里只管**什么时候动** ✓：
  // 猫走到玩具底下（路过 / 去朋友们那儿）→ 给玩具挂 `.swish` 荡一下 ✓。
  // ⚠️ 只在**刚进入范围**那一下触发 ✓（`toyIn` 闩住 ✓），不是每帧都挂 ✗。
  // ⚠️ 两次之间隔 9s ✓ —— 不然猫停在底下，玩具会一直叮当响 ✗。
  // ⚠️ 减弱动效 / 睡着的时候**不动** ✓（趴着睡还扒玩具就不像猫了 ✓）。
  let toyC = 0, catHalf = 16.5;
  let toyIn = false, toyRest = 0, toyTimer = null;
  const TOY_NEAR = 34;      // 猫身中心离玩具多近算"扒得到" ✓
  const TOY_COOL = 9000;    // 两次之间至少隔 9s ✓
  const TOY_SWISH_MS = 2500; // 跟 app.css 的 2 段 × 1.2s 对得上 ✓

  // ── 猪猪 / 鸭鸭（2026-10-31 第九版）─────────────────────────────────
  // 猫一走近（或者挨着它们坐下）→ 给两只挂 `.happy` ✓（原地蹦一下 + 冒爱心 ✓，
  // 动画在 app.css ✓）。这里只管**什么时候高兴** ✓：
  // ⚠️ 同样只在**刚进入范围**那一下触发 ✓（`frIn` 闩住 ✓）；两次隔 11s ✓。
  // ⚠️ 只有 walk / awake / look 时才高兴 ✓ —— 睡着 / 想事情 / 洗脸时不算"走过来了" ✓。
  // ⚠️ 减弱动效时**不挂** ✓（CSS 里也关了 ✓）。
  let pigC = 0;
  let frIn = false, frRest = 0, frTimer = null;
  const FRIEND_NEAR = 44;     // 猫身中心离猪猪中心多近算"过来了" ✓（猪猪中心 ≈39 ✓）
  const FRIEND_COOL = 11000;  // 两次之间至少隔 11s ✓
  const FRIEND_HAPPY_MS = 1600; // 和 app.css 的 frHop(2×.62s) / frLove(1.5s) 对得上 ✓

  /** 量一次玩具 / 猪猪的中心 + 猫半宽 ✓（resize 时重来 ✓）—— 逐帧别再读布局 ✗。 */
  const measureScene = () => {
    catHalf = catW() / 2;
    if (toyEl) toyC = toyEl.offsetLeft + toyEl.offsetWidth / 2;
    // ★ 猪猪和猫都住在 `#catStage` 里 ✓ → offsetLeft 是同一个原点 ✓
    //   （`#catWall` 和 `#catStage` 都是 inset:0 ✓，跟 toyC 比也成立 ✓）。
    if (pigEl) pigC = pigEl.offsetLeft + pigEl.offsetWidth / 2;
  };

  const maybeToy = () => {
    if (!toyEl) return;
    const d = Math.abs(toyC - (x + catHalf));
    if (d > TOY_NEAR) { toyIn = false; return; }   // 走开了 ✓ → 下次进来还能触发 ✓
    if (toyIn) return;                             // 还在范围里 ✓ → 不重复挂 ✓
    toyIn = true;
    if (reduce()) return;
    if (mood !== 'walk' && mood !== 'awake' && mood !== 'look') return;
    const now = performance.now();
    if (now < toyRest) return;
    toyRest = now + TOY_COOL;
    toyEl.classList.add('swish');
    toyTimer = clearT(toyTimer);
    toyTimer = setTimeout(() => {
      toyTimer = null;
      toyEl.classList.remove('swish');
    }, TOY_SWISH_MS);
  };

  const maybeFriends = () => {
    if (!pigEl) return;
    const d = Math.abs(pigC - (x + catHalf));
    if (d > FRIEND_NEAR) { frIn = false; return; }  // 走开了 ✓ → 下次进来还能高兴 ✓
    if (frIn) return;                              // 还在范围里 ✓ → 不重复蹦 ✓
    frIn = true;
    if (reduce()) return;
    if (mood !== 'walk' && mood !== 'awake' && mood !== 'look') return;
    const now = performance.now();
    if (now < frRest) return;
    frRest = now + FRIEND_COOL;
    friendEls.forEach((n) => { if (n) n.classList.add('happy'); });
    frTimer = clearT(frTimer);
    frTimer = setTimeout(() => {
      frTimer = null;
      friendEls.forEach((n) => { if (n) n.classList.remove('happy'); });
    }, FRIEND_HAPPY_MS);
  };

  // ── 心情 ────────────────────────────────────────────────────────────
  const setMood = (m) => {
    mood = m;
    if (el.getAttribute('data-mood') !== m) el.setAttribute('data-mood', m);
    const label = LABEL[m] || LABEL.sleep;
    if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
    // ★ 第九版：`data-act` 没用了 ✓（水波 / 猫粮那些跟着碗一起删了 ✓）。
    // ★ 第六版：地板也要知道心情 ✓ —— 猫窝垫子只在**睡着**的时候贴着呼吸起伏 ✓
    //   （CSS 那边用 `#catStage[data-mood="sleep"]` 挑 ✓；别用 `:has()` ✗，
    //    老一点儿的 WebView 不认 ✓）
    if (stage.dataset.mood !== m) stage.dataset.mood = m;
  };

  // ── 走过去 ──────────────────────────────────────────────────────────
  const stopWalk = () => {
    if (stepRaf) { cancelAnimationFrame(stepRaf); stepRaf = 0; }
    el.classList.remove('walking');
  };

  /** 速度曲线 ✓：起步 0.38s 加速 → **30px/s 匀速** ✓ → 0.55s 收尾 ✓。
   *  ★ 不能用 smoothstep 走全程 ✗ —— 它的中段速度是平均值的 1.5 倍 ✓，
   *    走远路时中段就变成 45px/s ✓（= 又一次小跑 ✗，用户这次就是要它慢 ✓）。
   *  太近了就不巡航 ✓（三角速度曲线 ✓，峰值按距离压下来 ✓）。 */
  const walkProfile = (dist) => {
    const ACC = 0.38, DEC = 0.55;
    let v = WALK_V;
    const vTri = (2 * dist) / (ACC + DEC);
    let cruise;
    if (vTri < v) { v = vTri; cruise = 0; }
    else cruise = dist / v - (ACC + DEC) / 2;
    const total = ACC + cruise + DEC;
    const at = (t) => {
      if (t <= 0) return 0;
      if (t >= total) return dist;
      if (t < ACC) return 0.5 * (v / ACC) * t * t;
      if (t < ACC + cruise) return 0.5 * v * ACC + v * (t - ACC);
      const u = t - ACC - cruise;
      return 0.5 * v * ACC + v * cruise + v * u - 0.5 * (v / DEC) * u * u;
    };
    return { total, at };
  };

  /** 走到 `target` 之后做 `done` ✓。
   *  ★ 逐帧写坐标 ✓ —— 慢起 → 匀速 → 慢收 ✓，这才是真猫起步 / 停下的样子 ✓。
   *  时长按距离算 ✓（30px/s ✓），走远了只会**更久** ✓ 不会更快 ✗。 */
  const walkTo = (target, done) => {
    stopWalk();
    idleTimer = clearT(idleTimer);
    actTimer = clearT(actTimer);
    spot = target;
    const from = x;
    const to = xFor(target);
    const dist = Math.abs(to - from);

    if (reduce() || dist < 1.5) {          // 减弱动态：直接站过去 ✓（不滑 ✗）
      setX(to);
      if (done) done();
      return;
    }

    const dir = to > from ? 1 : -1;
    el.dataset.dir = dir > 0 ? 'r' : 'l';
    el.style.setProperty('--step-ms', STEP_MS + 'ms');
    el.classList.add('walking');
    setMood('walk');

    const prof = walkProfile(dist);
    const t0 = performance.now();
    const tick = (now) => {
      const t = (now - t0) / 1000;
      setX(from + dir * prof.at(t));
      if (t < prof.total) {
        stepRaf = requestAnimationFrame(tick);
        return;
      }
      stepRaf = 0;
      el.classList.remove('walking');
      if (done) done();
    };
    stepRaf = requestAnimationFrame(tick);
  };

  /** 半路被打断（用户发消息了 ✓）：就地站住 ✓，不许"滑"到目的地 ✗。
   *  坐标本来就是逐帧写的 ✓，所以这里只要把 rAF 停掉 ✓。 */
  const freeze = () => {
    if (!stepRaf) return;
    stopWalk();
    if (mood === 'walk') setMood('awake');
  };

  // ── 自己过日子 ──────────────────────────────────────────────────────
  const clearAuto = () => {
    idleTimer = clearT(idleTimer);
    actTimer = clearT(actTimer);
  };

  /** 睡 `ms` 之后醒来 ✓（不传就 26–74s ✓） */
  const scheduleSleep = (ms) => {
    idleTimer = clearT(idleTimer);
    if (hidden || reduce() || mode !== 'auto') return;
    idleTimer = setTimeout(wakeUp, ms == null ? rnd(SLEEP_MS[0], SLEEP_MS[1]) : ms);
  };

  /** 趴下（0.9s 过渡 ✓）再睡 ✓。 */
  const settleAndSleep = (ms) => {
    actTimer = clearT(actTimer);
    setMood('settle');
    actTimer = setTimeout(() => {
      actTimer = null;
      if (mode !== 'auto') return;
      setMood('sleep');
      scheduleSleep(ms);
    }, 900);
  };

  /** 醒了 ✓：多半先伸个懒腰 / 打个哈欠 / 竖一下耳朵 ✓，再决定干嘛 ✓。 */
  const wakeUp = () => {
    idleTimer = null;
    if (hidden || reduce() || mode !== 'auto') return;
    if (mood !== 'sleep' && mood !== 'settle') { decide(); return; }

    const r = Math.random();
    const m = r < 0.34 ? 'stretch' : r < 0.62 ? 'yawn' : 'perk';
    const t = m === 'stretch' ? 1900 : m === 'yawn' ? 2000 : 620;
    setMood(m);
    actTimer = clearT(actTimer);
    actTimer = setTimeout(() => {
      actTimer = null;
      if (mode !== 'auto') return;
      setMood('awake');
      actTimer = setTimeout(() => {
        actTimer = null;
        if (mode !== 'auto') return;
        decide();
      }, rnd(700, 1600));
    }, t);
  };

  /** 原地干点什么 ✓（望风 / 洗脸 / 踩奶 ✓）然后**六成**接着睡 ✓。
   *  猫不会一直有事做 ✓ —— 这就是治"多动症"的那一半 ✓。 */
  const doIdle = () => {
    const r = Math.random();
    const m = r < 0.42 ? 'look' : r < 0.72 ? 'groom' : 'knead';
    const ms = m === 'groom' ? 3600
             : m === 'look' ? rnd(5200, 8800)
             : rnd(4400, 7700);
    setMood(m);
    actTimer = clearT(actTimer);
    actTimer = setTimeout(() => {
      actTimer = null;
      if (mode !== 'auto') return;
      setMood('awake');
      actTimer = setTimeout(() => {
        actTimer = null;
        if (mode !== 'auto') return;
        if (Math.random() < 0.6) settleAndSleep(); else decide();
      }, rnd(600, 1300));
    }, ms);
  };

  /** 挑下一个地方 ✓：**近的更容易被挑中** ✓（懒 ✓）。
   *  `friends` 给得比其它都重一点 ✓ —— 不然它老是睡在窝里 ✓，
   *  左边那两位一整天都没猫陪 ✓（第九版加这个站就是为了"陪伴" ✓）。 */
  const pickSpot = () => {
    const pool = [
      { name: 'mid1',   w: 1.6 },
      { name: 'mid2',   w: 1.3 },
      { name: 'friends', w: 2.6 },
      { name: 'bed',    w: 1.1 },
    ].filter((t) => t.name !== spot && t.w > 0);
    if (!pool.length) return 'mid1';

    let total = 0;
    const weights = pool.map((t) => {
      const d = Math.abs(xFor(t.name) - x);
      const w = t.w / (1 + d / 120);
      total += w;
      return w;
    });
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) return pool[i].name;
    }
    return pool[pool.length - 1].name;
  };

  /** 到站以后干什么 ✓。 */
  const arrive = () => {
    if (mode !== 'auto') return;

    if (spot === 'friends') {
      // 挨着猪猪 / 鸭鸭坐一会儿 ✓（发呆 → 望望风 ✓）→ 回中间趴下 ✓
      setMood('awake');
      actTimer = clearT(actTimer);
      actTimer = setTimeout(() => {
        actTimer = null;
        if (mode !== 'auto') return;
        setMood('look');
        actTimer = setTimeout(() => {
          actTimer = null;
          if (mode !== 'auto') return;
          const back = Math.random() < 0.7 ? 'mid1' : 'mid2';
          walkTo(back, () => { if (mode === 'auto') settleAndSleep(); });
        }, rnd(2400, 4200));
      }, rnd(2200, 3600));
      return;
    }

    if (spot === 'bed') { settleAndSleep(); return; }

    // 中间两块地：坐一会儿 ✓，有时顺带洗个脸 / 望望风 ✓，然后趴下 ✓
    const r = Math.random();
    if (r < 0.5) {
      setMood('awake');
      actTimer = clearT(actTimer);
      actTimer = setTimeout(() => {
        actTimer = null;
        if (mode !== 'auto') return;
        if (Math.random() < 0.3) doIdle(); else settleAndSleep();
      }, rnd(2400, 4600));
      return;
    }
    if (r < 0.75) {
      setMood('groom');
      actTimer = clearT(actTimer);
      actTimer = setTimeout(() => {
        actTimer = null;
        if (mode !== 'auto') return;
        settleAndSleep();
      }, 3600);
      return;
    }
    setMood('look');
    actTimer = clearT(actTimer);
    actTimer = setTimeout(() => {
      actTimer = null;
      if (mode !== 'auto') return;
      settleAndSleep();
    }, rnd(4200, 6400));
  };

  /** 决定下一步 ✓：四成挪个地方 ✓，六成就在原地做点什么 ✓。 */
  const decide = () => {
    idleTimer = null;
    if (hidden || reduce() || mode !== 'auto' || stepRaf) return;
    if (mood === 'sleep' || mood === 'settle') { wakeUp(); return; }

    if (Math.random() < 0.4) {
      const target = pickSpot();
      // 从窝里出发：一半先伸个懒腰 ✓（真猫下床的样子 ✓）
      if (spot === 'bed' && Math.random() < 0.5) {
        setMood('stretch');
        actTimer = clearT(actTimer);
        actTimer = setTimeout(() => {
          actTimer = null;
          if (mode !== 'auto') return;
          walkTo(target, arrive);
        }, 1900);
        return;
      }
      walkTo(target, arrive);
      return;
    }
    doIdle();
  };

  // ── 用户那边的事 ────────────────────────────────────────────────────
  /** 想事情 ✓。`ms` 是兜底时长 ✓（服务端断了也不能永远在想 ✗）。 */
  const think = (ms) => {
    wokeOnce = true;
    mode = 'user';
    clearAuto();
    stopWalk();
    setMood('think');
    thinkTimer = clearT(thinkTimer);
    thinkTimer = setTimeout(() => {
      thinkTimer = null;
      if (mood === 'think') userAwake(6000);
    }, ms || 60000);
  };

  /** 醒着但不冒泡泡 ✓。`ms` 到了以后就地趴下 / 从朋友们那儿回家 ✓。 */
  const userAwake = (ms) => {
    mode = 'user';
    clearAuto();
    thinkTimer = clearT(thinkTimer);
    stopWalk();
    setMood('awake');
    actTimer = setTimeout(() => {
      actTimer = null;
      if (mode !== 'user') return;
      mode = 'auto';
      if (spot === 'friends') {
        walkTo('mid1', () => { if (mode === 'auto') settleAndSleep(); });
      } else {
        settleAndSleep();
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
      if (mood === 'think' || stepRaf) return;   // 让它把手上的事做完 ✓
      mode = 'auto';
      if (mood === 'sleep' || mood === 'settle') { scheduleSleep(); return; }
      settleAndSleep();
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
    if (hidden) { clearAuto(); freeze(); return; }
    if (mode !== 'auto') return;
    if (mood === 'walk' || mood === 'look' || mood === 'groom' ||
        mood === 'knead' || mood === 'stretch' || mood === 'yawn') {
      setMood('sleep');
    }
    scheduleSleep(mood === 'sleep' ? rnd(2500, 6500) : rnd(5000, 9000));
  });

  // ── 尺寸变了（转屏 / 分屏 ✓）→ 重新站到那个东西前面 ✓ ──────────────
  let lastW = 0;
  const replace = () => {
    const w = stage.clientWidth;
    if (w === lastW) return;
    lastW = w;
    if (w < 40) return;           // 这一屏还没显示出来 ✓（等它显示 ✓）
    freeze();
    measureScene();               // ★ 第八 / 九版：玩具、猪猪的中心 + 猫半宽 跟着屏宽重量 ✓
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
  scheduleSleep(rnd(12000, 22000));
})();
