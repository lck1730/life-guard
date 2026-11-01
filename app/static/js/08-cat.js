/* ═══════════════════════════════════════════════════════════════════════
   顶栏那只猫猫仔（2026-11-01 · 第十四版：各有各的窝）

   第十四版用户原话：
     「全都在左边扎堆了，其实可以最右边的小窝给猪猪和鸭鸭睡觉，
       地毯给猫猫睡觉，他们也可以在其他地方玩和睡觉，不要老是在左边」
   → 三件事：
     ① **最右边那只猫窝归猪猪 / 鸭鸭** ✓ —— 两只现在会**一起去窝里睡** ✓
        （`relocate` / `frZone` ✓，见下面「两只的日子」✓）。
     ② **地毯归猫猫** ✓ —— 猫的睡觉点从窝改成**地毯中心** ✓（`spot='rug'` ✓）；
        另外两块地只是坐着玩 ✓，困了**自己走回地毯**再趴下 ✓（`goSleep` ✓）。
     ③ **不再老在左边** ✓ —— 两只**成对**在「左边老家 / 最右的窝」两块地方
        轮换 ✓（joint outing ✓ —— 故意不各走各的 ✗，不然"多贴"就没了 ✓）；
        碰面也改成**就地碰头** ✓（不再硬拽回左边老家 ✓）。
        ⚠️ 中间**不设站** ✗ —— 群名就在正中间（≈164px ✓），站过去会把它挡掉 ✓。
        猫的 `mid1`（45% ✓）同理删掉 ✓，只留偏左的 `mid2`（20% ✓）。
     ⚠️ 猫去贴贴时，两只若在窝里 → 猫坐**窝左边的地毯沿** ✓，不挤进窝 ✓
        （`xFor('friends')` 按猪猪在不在右半屏分流 ✓）。
     ⚠️ 两只搬家时**不许**搔扰正在走过来贴贴的猫 ✓（`relocate` 见 `spot==='friends'` ✓）。
     ⚠️ 它俩在自己窝里是**轮着打盹**的 ✓ —— 原来"睡着了不许打扰"会让搬家
        一直排不上 ✗（实测 62s 还在窝里 ✓）→ 现在**叫醒再走** ✓（先醒 0.5–1.1s ✓）。
     ⚠️ 地毯上的站位往右偏 **8px** ✓ —— 360 宽时名字正好贴着地毯，
        不偏猫头会压住最后一个字 ✗（仍在地毯上 ✓）。

   第十三版用户原话：
     「猪猪和鸭鸭需要多贴，频率高，猫猫也可以加入，但是频率不要太高，
       然后三小只不要离太远」
   → 三件事（全在这一页 ✓；CSS / DOM 一个没动 ✓）：
     ① **猪猪 / 鸭鸭更黏** ✓ —— 碰面从 26–55s 一次提到 **9–18s** ✓；
        贴住那一段从 ~2.5s 拉到 **4–6s** ✓（中间再软软地蹭一下 ✓）；
        三成直接**挨着睡一小觉** ✓（`frPairNap` ✓）。
     ② **猫猫只偶尔加入** ✓ —— 主动贴贴 32–56s → **75–120s** ✓
        （贴完再等 **150–240s** ✓）；`friends` 站权重 3.6 → **0.8** ✓；
        两只**主动蹭猫**的概率也降到 22% ✓，而且共用 **18–30s 冷却** ✓
        （猫现在常驻它们旁边，不然两只逮着机会就一直蹭 ✗）。
        猫更多是**坐在旁边陪着** ✓（`mid1` / `mid2` 挪到猪猪右边 ✓）。
     ③ **三小只不分开** ✓ —— `mid1` / `mid2` 不再按屏宽取 36% / 60% ✗，
        改成**锚在猪猪右沿** ✓（+4 / +18）—— 猫怎么溜达都在这团人旁边 ✓；
        猫窝权重 1.1 → **0.3** ✓，而且窝里醒来**七成先回 mid1 / mid2** ✓
        （偶尔回去睡，不再一觉睡到最右边 ✓）；
        开局也改成睡在朋友们旁边 ✓（不再从最右边开场 ✓）。
     ⚠️ 碰面现在会被"有一只睡着"挡住 ✓（`tryMeet` ✓）—— 以前硬把睡着的
        拽起来 ✗。所以单只打盹的概率也从 12% 降到 6% ✓，别把碰面饿死 ✓。

   第十二版用户原话：
     「三小只的互动太少，猪猪和鸭鸭挨在一起，猫猫孤零零，
       他们三个需要多一些亲密互动感」
   → 三件事：
     ① **猫更常去左边** ✓ —— `friends` 站的权重 2.6 → 3.6，距离惩罚也放宽 ✓；
        另外有个「贴贴」定时器（`scheduleTrio` ✓）到点主动走过去 ✓。
     ② **凑近是贴在一起** ✓ —— 以前猫站在「猪猪箱子右沿 +2」✓，
        可猫 33px 的盒子里画只占中间 ~18px ✓ → 两只之间实际空了 14px ✗，
        看着就是孤零零地坐在旁边 ✓。现在按**画面**让猫的左沿压到猪猪身右沿 ✓
        （`xFor('friends')` 的 −10 ✓），头挨着头 ✓。
     ③ **多了三种亲密动作** ✓：
        · `snug`（猫蹭蹭 ✓）+ 头顶爱心 ✓ —— 到了就贴着猪猪眯眼蹭 ✓；
        · `cuddle`（猪猪 / 鸭鸭靠过来 ✓）+ 爱心 ✓；
        · `nuzzle`（小伙伴自己蹭猫 ✓）—— 猫醒着待在旁边时，隔一会儿就有
          一只歪头贴上去 ✓；
        · **三只一起午睡** ✓（`settleWithFriends` ✓）—— 猫在左边趴下，
          两只跟着趴下 ✓，底下有一圈暖光 ✓（`#catStage[data-trio]` ✓），
          猫醒 **它们才醒** ✓（`friendsWake` ✓）。
     前提没变 ✓：用户一开口，三只都停 ✓；页面藏起来 / 减弱动效 → 不动 ✓。

   第十一版用户原话：
     「你不觉得猫猫建模很精致，猪猪鸭鸭很粗糙吗，而且个头还没有保持一致。
       另外交互比较生硬」
   → 三件事（长相在 index.html / app.css ✓，这一页只管**动**的第三件 ✓）：
     ① 个头：18px → 28px ✓（见 app.css ✓；这里只把地盘跟着改掉 ✓）。
     ② 建模：重新拆件画 ✓（见 index.html ✓），线宽 2.4 → 3 ✓。
     ③ **动作不再硬** ✓：
        · **眼睛跟着猫走** ✓（`frWatch` 逐帧写 `--fr-gaze` ✓）——
          猫一走近，两只就看着它 ✓；脑袋也轻轻朝它偏 ✓。
        · **猫来时睡着的**：先伸懒腰再高兴 ✓（不再"唰"地坐起来蹦 ✗）。
        · **趴下前先 settle** ✓（0.9s 矮下去 ✓ 再闭眼 ✓ —— 以前是直接切 sleep ✗）。
        · **醒来先 stretch** ✓（34% 概率 ✓）。
        · **碰面重排** ✓：靠过去 → 站定 0.45s → 歪头 → 一起蹦 → 再歪一下 →
          分开前各拍一下（preen ✓）→ 慢慢走回去 ✓。不再"到站就歪头 + 连蹦两下" ✗。
        · 蹦改成**一次软软的** ✓、身子和脑袋一起弹 ✓（`.fr-hop` ✓，见 app.css ✓）。

   第十版用户原话：
     「猪猪和鸭鸭也要和猫猫一样，自己会动，会睡觉，彼此会互动」
   → 两只小伙伴**各有一套作息** ✓（挪两步 / 东张西望 / 拍翅膀或嗅一嗅 /
     自己蹦一下 / 打盹 ✓，见下面「猪猪 / 鸭鸭自己的日子」✓）；
     另外隔二三十秒会**走到中间面对面** ✓（歪头看对方 + 蹦 + 冒爱心 ✓），
     再各回各家 ✓。地盘仍锁在顶栏左边那 58px 让位里 ✓，谁也不穿过谁 ✓。

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
     friends 老家最左边：鸭鸭 + 猪猪 ✓（猫挨着它们坐 = "陪伴" ✓）
     rug 地毯（右半 ✓）：**猫的床** ✓（默认就睡在这儿 ✓）
     nest 最右边的猫窝 ✓：**猪猪 / 鸭鸭的床** ✓（第十四版起 ✓）
     ⚠️ 群名在正中间 ✓ —— 三只都**别停在它底下** ✗（挡字 ✓）

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
  // ★ 第十四版：**地毯归猫猫睡** ✓ —— 它住在 #catWall 里（和 stage 一样 inset:0 ✓），
  //   量中心照样能用 stage 的 rect 减 ✓（见下面 rectIn ✓）。
  const rugEl = document.querySelector('#catWall .cw-rug');
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
    snug:    '猫猫仔在跟小伙伴们贴贴',
  };

  const WALK_V = 30;        // px/s ✓（猫慢慢溜达 ✓；旧版 58px/s = 小跑 ✗）
  const STEP_MS = 720;      // 一步的时间 ✓（慢 ✓；走路时写进 --step-ms ✓）
  const SLEEP_MS = [26000, 74000];   // 睡一觉多久 ✓
  const TRIO_SLEEP_MS = [34000, 70000]; // ★ 第十二版：三只一起午睡，睡久一点 ✓
  // ★ 第十三版：猫主动去贴的节拍（猪猪 / 鸭鸭是 9–18s 一次，猫差一个量级 ✓）
  const TRIO_GAP_MS = [75000, 120000];   // 猫下一次主动贴贴 ✓
  const TRIO_AFTER_MS = [150000, 240000];// 贴完 / 贴完睡醒之后再等多久 ✓

  // ★ 第十四版：开局就睡在**自己的地毯上** ✓（用户：「地毯给猫猫睡觉」✓）——
  //   猪猪 / 鸭鸭在它右边那个窝里 ✓（见下面 frInit ✓），不再全挤左边 ✓。
  let spot = 'rug';        // 站在哪个站 ✓（rug / mid2 / friends ✓）
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
    return {
      left: r.left - s.left,
      mid: r.left - s.left + r.width / 2,
      right: r.right - s.left,
    };
  };

  const xFor = (name) => {
    const w = catW();
    const sw = stage.clientWidth || 320;
    let px;
    if (name === 'friends') {
      // ★ 第十二版：坐到**猪猪真身旁边** ✓，不是坐它盒子的右边 ✓。
      //   · 猫盒 33px，但画面只占中间 ≈7–25 ✓（`viewBox` 两边是空的 ✓）；
      //     猪猪盒 28px，画面 ≈5–23 ✓。以前「盒子右沿 +2」→ 画面之间
      //     实际空了 14px ✗ —— 用户说的「猫猫孤零零」一半是这个 ✓。
      //   · 猫盒左沿 = 猪猪盒右沿 − 10 → 猫脸左边正好贴到猪猪脸右边 ✓
      //     （头挨着头 ✓，猫在 z2、压在前面 ✓，不是在穿模 ✓）。
      //   ★ 第十四版：猪猪要是跑到**右半屏**（窝里去了 ✓）→ 右边没地方站 ✗，
      //     猫改坐**窝左边的窝沿 / 地毯右端** ✓（`bed left − 猫宽 + 12` ✓）——
      //     正好趴在地毯上陪它们 ✓，不挤进 56px 的窝里 ✓。
      if (pigEl && rectIn(pigEl).mid > sw / 2) {
        const bedLeft = bedEl ? rectIn(bedEl).left : sw - 59;
        px = bedLeft - w + 12;
      } else {
        px = pigEl ? rectIn(pigEl).right - 10 : sw * 0.15;
      }
    } else if (name === 'rug') {
      // ★ 第十四版：**地毯中心** ✓（用户：「地毯给猫猫睡觉」✓）
      //   ⚠️ 再往右偏 8px ✓：390 宽有 16px 余量 ✓，360 宽名字正好贴着地毯 ✓
      //   （名字居中、宽 ≈164 ✓），不偏的话猫头会压住最后一个字 ✗。
      //   仍在地毯上 ✓（地毯 64 宽、猫 33 ✓，右边还剩 7px ✓）。
      px = (rugEl ? rectIn(rugEl).mid : sw * 0.7) - w * 0.5 + 8;
    } else {                                  // mid2
      // ★ 第十四版：只留**偏左这一块** ✓（20% ✓）—— 离老家那两只近，
      //   但不压在它们身上 ✓。**不能放中间** ✗ —— 群名就在正中间，
      //   猫蹲在 45% 会把"鼻子"两个字挡掉 ✓（和两只的 mid 一个道理 ✓）。
      px = sw * 0.20 - w * 0.5;
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
    frWatch();           // ★ 第十一版：走到哪儿，它俩的眼睛就跟到哪儿 ✓
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
  // ⚠️ 第十版起两只自己会走动 ✓ → 中心不再用 `offsetLeft`（那是没位移的位置 ✗），
  //    改看它们**现在**走到哪儿了 ✓（见下面 `frCenter` ✓）；睡着的会被叫醒 ✓。
  // ⚠️ 减弱动效时**不挂** ✓（CSS 里也关了 ✓）。
  let frIn = false, frRest = 0;
  const FRIEND_NEAR = 44;     // 猫身中心离猪猪中心多近算"过来了" ✓
                              // （第十一版：猪猪 28px 站 30–58 ✓，中心 ≈44 ✓；
                              //   猫坐 friends 站 = 60–93 ✓，中心 76.5 ✓ → 32.5 ✓ 够近 ✓）
  const FRIEND_COOL = 11000;  // 两次之间至少隔 11s ✓
  const FRIEND_HAPPY_MS = 1800; // 和 app.css 的 frHop(.86s ×1) / frLove(1.7s) 对得上 ✓

  /** 量一次玩具的中心 + 猫半宽 ✓（resize 时重来 ✓）—— 逐帧别再读布局 ✗。 */
  const measureScene = () => {
    catHalf = catW() / 2;
    if (toyEl) toyC = toyEl.offsetLeft + toyEl.offsetWidth / 2;
    // ★ 第十版：猪猪会自己走动 ✓ —— 它的中心改成**量一次"没位移"的左边** ✓，
    //   再跟当前 offset 相加 ✓（见下面 `frMeasure` / `frCenter` ✓）。
    //   `#catWall` 和 `#catStage` 都是 inset:0 ✓，跟 toyC 比也成立 ✓。
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
    if (!pigF) return;
    const d = Math.abs(frCenter(pigF) - (x + catHalf));
    if (d > FRIEND_NEAR) { frIn = false; return; }  // 走开了 ✓ → 下次进来还能高兴 ✓
    if (frIn) return;                              // 还在范围里 ✓ → 不重复蹦 ✓
    frIn = true;
    if (reduce()) return;
    if (mood !== 'walk' && mood !== 'awake' && mood !== 'look') return;
    if (frMeeting) return;                         // 正在碰面 ✓ → 别打断它俩 ✓
    const now = performance.now();
    if (now < frRest) return;
    frRest = now + FRIEND_COOL;
    fr.forEach((f) => {
      if (f.mood === 'sleep' || f.mood === 'settle') {
        // ★ 第十一版：睡着的先**伸懒腰** ✓（0.9s 后再蹦 ✓）——
        //   旧版一睁眼就蹦 ✗，那是"机器人被叫醒"✓，不是小动物 ✓。
        f.timer = clearT(f.timer);
        frMood(f, 'stretch');
        f.timer = setTimeout(() => {
          f.timer = null;
          frMood(f, 'awake');
          frHappy(f);
          frSchedule(f, rnd(5000, 9000));
        }, 900);
        return;                                    // 这次先不蹦 ✓（上面已经排好 ✓）
      }
      frHappy(f);                                  // 各挂各的 ✓（第十版起会自己动 ✓）
    });
  };

  // ── 猪猪 / 鸭鸭自己的日子（2026-10-31 第十版）──────────────────────────
  // 用户：「猪猪和鸭鸭也要和猫猫一样，自己会动，会睡觉，彼此会互动」✓
  // 跟猫一个路子 ✓：**CSS 管长相和动作**（只认 `data-mood` ✓，见 app.css ✓），
  // 这里只管**什么时候干什么** ✓。两只各有一套作息 ✓，互不共用一个节拍器 ✓。
  //
  // 地盘：第十一版两只各 28px ✓ —— 顶栏左边一共只有 58px 让位 ✓，谁也不穿过谁 ✓。
  //   鸭鸭 base 1px  → off −1…+3  （实际 0–32 ✓）
  //   猪猪 base 30px → off −3…+1  （实际 27–59 ✓）
  //   ★ 第十三版：两边各收 1px ✓ —— 两只平时也不会走到"分开站"✗（用户：
  //     "三小只不要离太远"✓）。它们俩本来就该是**一小团** ✓。
  //   碰头：鸭鸭 off +6.5（身右沿 ≈28.6）、猪猪 off −6.5（身左沿 ≈30.4）
  //         → 中间留 ~1.8px ✓（脸稍微挨着 ✓ —— 是在"贴贴"✓，不是穿模 ✓）。
  //   ⚠️ 这两个 offset 是**照着 28px 的身宽**定的 ✓ —— 再改宽度要一起改 ✓。
  //
  // 心情（CSS 见 app.css）：awake 站着 / walk 挪两步 / look 东张西望 /
  //   preen 拍翅膀或嗅一嗅 / sleep 趴下打盹（闭眼 + z z ✓）/ meet 面对面打招呼 ✓。
  //
  // ⚠️ 猫一开口（mode=user）两只就**停下待着** ✓（frHold ✓），猫办完事再接着过 ✓。
  // ⚠️ 页面不可见 / 减弱动效 → 不动 ✓（和猫同一条规矩 ✓）。
  // ⚠️ 猫走到旁边时，睡着的会被**叫醒**蹦一下 ✓（maybeFriends ✓ 照旧 ✓）。
  const FR_V = 16;                  // px/s ✓（比猫的 30 还慢 ✓）
  const FR_NAP_MS = [14000, 32000]; // 小睡一会儿 ✓（比猫短得多 ✓）
  // ★ 第十四版：两只**成对**换地方 ✓ —— 家（左边老家）/ nest（最右边的窝 ✓）。
  //   每 60–100s 换一块 ✓（隔着 330px ✓，40–75s 会变成一半时间都在赶路 ✗）；
  //   换的时候一起走 ✓（不各走各的 ✗ —— 用户之前要的"多贴"就是靠它俩待在一起 ✓）。
  //   ⚠️ **中间那块不要了** ✗ —— 群名就在正中间（≈164px 宽 ✓），
  //   两只站在那儿正好压住头两个字 ✗（80s 截图里"大象"被挡没了 ✓）。
  const ZONE_GAP_MS = [60000, 100000];
  const FR_W = 28;
  const fr = [
    { key: 'duck', el: friendEls[1] },
    { key: 'pig',  el: friendEls[0] },
  ].filter((d) => !!d.el).map((d) => ({
    ...d, base: 0, w: FR_W, off: 0, raf: 0, timer: null, happyT: null,
    mood: 'awake', measured: false, zone: 'home',
  }));
  const duckF = fr.find((f) => f.key === 'duck');
  const pigF = fr.find((f) => f.key === 'pig');
  let frMeeting = false, frMeetTimer = null, frMeetStep = null;
  let nuzzleRest = 0;   // ★ 第十三版：两只蹭猫**共用**的冷却 ✓（见 frAct ✓）
  let frZone = 'home';  // ★ 第十四版：两只现在待在哪块地方 ✓（三选一 ✓）
  let zoneTimer = null; // 下一次一起换地方 ✓

  // ★ 第十二版：三只凑一起 ✓
  //   frSnugging = 猫正在蹭它们 ✓（这会儿两只只负责靠过去眯眼 ✓，不许自己溜达 ✗）
  //   trioTimer  = 下一次主动走过去贴贴 ✓
  //   trioRest   = 刚从「一起午睡」醒来 → 别马上又回去 ✓（时间戳 ✓）
  let frSnugging = false;
  let trioTimer = null, trioRest = 0;
  // ★ 第十三版：40s → 60s ✓（"猫猫也可以加入，但是频率不要太高"✓）
  const TRIO_COOL = 60000;   // 一起睡完至少隔 60s 再主动去 ✓（真要睡它会自己挑 ✓）

  /** 量一次"没位移时的左边" ✓（resize 重来 ✓）—— 逐帧别再读布局 ✗。 */
  const frMeasure = () => {
    if (!fr.length) return;
    const s = stage.getBoundingClientRect();
    if (s.width < 40) return;
    fr.forEach((f) => {
      const r = f.el.getBoundingClientRect();
      if (!r.width) return;
      f.w = r.width;
      // ★ 量的时候可能正在半路 ✓ → 减掉当前的 --fr-x ✓，才是站位的原點 ✓
      if (!f.measured) { f.base = r.left - s.left - f.off; f.measured = true; }
    });
  };
  const frCenter = (f) => f.base + f.off + f.w / 2;
  const frSetX = (f, off) => {
    f.off = off;
    f.el.style.setProperty('--fr-x', off.toFixed(2) + 'px');
  };
  const frTilt = (f, deg) => f.el.style.setProperty('--fr-tilt', deg + 'deg');

  // ── ★ 第十四版：三块地方 ✓ ──────────────────────────────────────────
  // `off` 是相对**老家**的位移 ✓（base 就是 CSS 里那只的 left ✓，见 frMeasure ✓）。
  //   home  : 0        → 鸭 1px / 猪 30px（老站位 ✓）
  //   nest  : 窝里 ✓ —— 鸭 贴窝左沿 +1 ✓ / 猪 再往右一只 ✓（两只正好塞满 56px ✓）
  // ⚠️ 只有这两块 ✓ —— 中间是**群名**（见 ZONE_GAP_MS 上面那条 ✓）。
  const frLeft = (f) => f.base + f.off;
  const zoneTarget = (f, zone) => {
    const sw = stage.clientWidth || 320;
    const second = f.key === 'duck' ? 0 : FR_W + 1;
    if (zone === 'nest') {
      const bedLeft = bedEl ? rectIn(bedEl).left : sw - 59;
      return bedLeft + 1 + second - f.base;
    }
    return 0;                              // home ✓
  };
  /** 在当前这块地方能蹭多远 ✓（窝里几乎不动 ✓，老家能逛几步 ✓）。 */
  const zoneRange = (f) => {
    if (f.zone === 'nest') return [zoneTarget(f, 'nest') - 1, zoneTarget(f, 'nest') + 1];
    return f.key === 'duck' ? [-1, 3] : [-3, 1];   // 老家的老范围 ✓
  };

  /** ★ 第十一版：眼睛（外加一点点脑袋）跟着猫走 ✓ —— 这是"不生硬"最要紧的一条 ✓。
   *  以前它俩只有被碰到的**那一下**才动 ✓（蹦完立刻回原样 ✗），猫在旁边坐半天，
   *  两只正眼都不看它一眼 ✗ —— 用户说的"交互生硬"有一半是这个 ✓。
   *  · 只写两个自定义属性 ✓，**不读布局** ✓（`frCenter` 用的是量好的 base ✓）。
   *  · `--fr-gaze` 是 **SVG 用户单位** ✓（100 的 viewBox ✓，28px 下 1 单位 ≈ 0.28px ✓）。
   *  · 碰面时**不抢** ✓（那会儿两只只看对方 ✓，歪头由 frGreet 排 ✓）。
   *  · 睡着 / settle 时不写 tilt ✓（CSS 也把 tilt 压成 0 ✓）；走远 → 回 0 ✓。
   *  · 滑过去交给 CSS ✓（`.fr-eye` 0.55s / `.fr-head` 0.6s 过渡 ✓，见 app.css ✓）。 */
  const frWatch = () => {
    if (!fr.length || frMeeting || reduce()) return;
    const cc = x + catHalf;
    fr.forEach((f) => {
      // ★ 第十二版：贴贴 / 蹭蹭时歪头角度是 JS 专门给的 ✓，别被"看猫"覆盖 ✗
      if (f.mood === 'cuddle' || f.mood === 'nuzzle') return;
      const dx = cc - frCenter(f);
      const near = Math.abs(dx) < 92;
      const g = near ? Math.max(-2.6, Math.min(2.6, dx / 13)) : 0;
      f.el.style.setProperty('--fr-gaze', g.toFixed(2));
      if (f.mood === 'walk' || f.mood === 'sleep' || f.mood === 'settle') return;
      if (near && Math.abs(dx) < 58) {
        frTilt(f, Math.max(-4.5, Math.min(4.5, dx / 9)).toFixed(1));
      } else if (f.mood !== 'meet') {
        frTilt(f, 0);
      }
    });
  };

  const frMood = (f, m) => {
    if (f.mood === m) return;
    f.mood = m;
    f.el.dataset.mood = m;
  };
  const frStopWalk = (f) => {
    if (f.raf) { cancelAnimationFrame(f.raf); f.raf = 0; }
  };
  const frHappy = (f, ms) => {
    f.el.classList.add('happy');
    f.happyT = clearT(f.happyT);
    f.happyT = setTimeout(() => {
      f.happyT = null;
      f.el.classList.remove('happy');
    }, ms || FRIEND_HAPPY_MS);
  };

  // ── ★ 第十二版：三小只的亲密动作 ─────────────────────────────────────
  /** 猫贴过来 ✓：两只都**靠向猫** ✓（歪头 + 眯眼 + 冒爱心 ✓，CSS 在 app.css ✓）。
   *  ⚠️ 这时候两只的作息全部暂停 ✓（`frSnugging` ✓），免得一边贴贴一边溜达 ✗。 */
  const frCuddleAll = () => {
    frMeeting = false;
    frMeetStep = clearT(frMeetStep);
    fr.forEach((f) => {
      f.timer = clearT(f.timer);
      f.happyT = clearT(f.happyT);
      frStopWalk(f);
      f.el.classList.remove('happy', 'nuzzle');
      frMood(f, 'cuddle');
      const dx = (x + catHalf) - frCenter(f);
      frTilt(f, dx >= 0 ? 8 : -8);
      f.el.style.setProperty('--fr-gaze', dx >= 0 ? 2.6 : -2.6);
      frHappy(f, 1700);          // 就软软地蹦一下 + 一轮爱心 ✓（不连蹦 ✗）
    });
  };

  /** 猫蹭完了 / 要去睡了 → 两只回到自己的日子 ✓。 */
  const frRelease = () => {
    fr.forEach((f) => {
      f.happyT = clearT(f.happyT);
      f.el.classList.remove('happy', 'nuzzle');
      frTilt(f, 0);
      f.el.style.setProperty('--fr-gaze', '0');
      if (f.mood === 'cuddle' || f.mood === 'nuzzle') frMood(f, 'awake');
      frSchedule(f, rnd(1800, 4200));
    });
  };

  /** 小伙伴**自己**蹭猫 ✓（猫醒着待在旁边时偶尔来一下 ✓）。
   *  · 歪头朝猫那边 ✓ + 眯眼 ✓ + 冒一颗爱心 ✓（`data-mood="nuzzle"`，CSS ✓）。
   *  · 2.2–3s 后自己松开 ✓（不是一直贴着不动 ✓）。 */
  const frNuzzle = (f) => {
    if (!f || f.mood === 'sleep' || f.mood === 'settle') return;
    f.timer = clearT(f.timer);
    f.happyT = clearT(f.happyT);
    frStopWalk(f);
    f.el.classList.remove('happy', 'nuzzle');
    const dx = (x + catHalf) - frCenter(f);
    frMood(f, 'nuzzle');
    frTilt(f, dx >= 0 ? 9 : -9);
    f.el.style.setProperty('--fr-gaze', dx >= 0 ? 2.6 : -2.6);
    f.timer = setTimeout(() => {
      f.timer = null;
      if (!frCanAct()) {
        frTilt(f, 0);
        if (f.mood === 'nuzzle') frMood(f, 'awake');
        return;
      }
      frTilt(f, 0);
      f.el.style.setProperty('--fr-gaze', '0');
      if (f.mood === 'nuzzle') frMood(f, 'awake');
      frSchedule(f, rnd(3200, 6800));
    }, rnd(2200, 3000));
  };

  /** 一起午睡醒来 ✓：两只跟着醒（有时先伸个懒腰 ✓）→ 回到自己的日子 ✓。 */
  const friendsWake = () => {
    setTrio(null);
    fr.forEach((f) => {
      f.happyT = clearT(f.happyT);
      f.el.classList.remove('happy', 'nuzzle');
      frTilt(f, 0);
      f.el.style.setProperty('--fr-gaze', '0');
      if (f.mood === 'sleep' || f.mood === 'settle') {
        f.timer = clearT(f.timer);
        frWake(f);
      }
    });
  };

  /** 挪到 `to` ✓（慢起慢收 ✓；就十几像素，中段也不会快到"跑"✓）。 */
  const frWalk = (f, to, done) => {
    frStopWalk(f);
    f.el.classList.remove('nuzzle');
    const from = f.off;
    const dist = Math.abs(to - from);
    if (reduce() || dist < 0.6) {
      frSetX(f, to);
      if (done) done();
      return;
    }
    frMood(f, 'walk');
    const dur = Math.max(0.5, dist / FR_V + 0.3);
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / (dur * 1000));
      const e = t * t * (3 - 2 * t);
      frSetX(f, from + (to - from) * e);
      if (t < 1) { f.raf = requestAnimationFrame(tick); return; }
      f.raf = 0;
      if (done) done();
    };
    f.raf = requestAnimationFrame(tick);
  };

  const frCanAct = () => !hidden && !reduce() && mode === 'auto' && !frMeeting && !frSnugging;
  const frSchedule = (f, ms) => {
    f.timer = clearT(f.timer);
    f.timer = setTimeout(() => { f.timer = null; frAct(f); }, ms);
  };

  /** 睡够了 ✓ → 有时候先伸个懒腰 ✓（第十一版）→ 再醒着待一会儿 ✓。
   *  ⚠️ 伸懒腰时**别同时挂 .happy** ✗ —— 两套动画都写在 `.fr-hop` 上 ✓，
   *     后写的会压掉前一套 ✓（睡着的被叫醒那条路已经改成"先伸完再高兴"✓）。 */
  const frWake = (f) => {
    frTilt(f, 0);
    if (Math.random() < 0.34) {
      frMood(f, 'stretch');
      frSchedule(f, rnd(900, 1100));
      return;
    }
    frMood(f, 'awake');
    frSchedule(f, rnd(1200, 2800));
  };

  /** ★ 第十一版：趴下前先**矮下去** ✓（0.9s ✓，和 app.css 的 `.fr-hop` 过渡一致 ✓），
   *  再闭眼睡 ✓ —— 旧版是直接切 `sleep` ✗，眼睛"啪"一下就没了 ✓，硬 ✓。
   *  ⚠️ 0.9s 里用户一开口 → frHold 会把计时器收掉 ✓ 并把这个状态收成 sleep ✓。 */
  const frSettle = (f) => {
    frMood(f, 'settle');
    f.timer = clearT(f.timer);
    f.timer = setTimeout(() => {
      f.timer = null;
      if (!frCanAct()) return;
      frMood(f, 'sleep');
      frSchedule(f, rnd(FR_NAP_MS[0], FR_NAP_MS[1]));
    }, 900);
  };

  /** 自己找点事做 ✓（懒 ✓：一部分时候干脆什么都不做 ✓）。 */
  const frAct = (f) => {
    if (!frCanAct()) { frSchedule(f, 2200); return; }
    if (f.mood === 'sleep') { frWake(f); return; }

    // ★ 第十二版：猫醒着待在旁边 → 偶尔**主动蹭过去** ✓（这就是"亲密"✓）。
    //   只认猫醒着的三种状态 ✓：猫睡了就别弄醒它 ✓（要一起睡有专门那套 ✓）。
    //   ★ 第十三版：0.34 → 0.22 ✓ —— 猫现在常驻 `mid1`（离猪猪 ~35px ✓），
    //   照旧的概率会变成"两只一直蹭猫"✗（用户要的是"猫偶尔加入"✓）。
    //   ⚠️ 再补一道**共用冷却** ✓（18–30s ✓）—— 光调概率不够：猫醒着坐在旁边时
    //     两只的作息各自每 2–6s 调一次 ✓，22% 叠加起来还是能蹭得很密 ✗。
    const catNear = Math.abs((x + catHalf) - frCenter(f)) < 58;
    if (catNear && (mood === 'awake' || mood === 'look' || mood === 'groom') &&
        f.mood !== 'cuddle' && f.mood !== 'nuzzle' &&
        performance.now() >= nuzzleRest && Math.random() < 0.22) {
      nuzzleRest = performance.now() + rnd(18000, 30000);
      frNuzzle(f);
      return;
    }

    // ★ 第十四版：**在自己窝里**待着 → 多半就趴下睡 ✓（用户：
    //   「最右边的小窝给猪猪和鸭鸭睡觉」✓）。别的地方照旧 ✓。
    if (f.zone === 'nest' && f.mood === 'awake' && Math.random() < 0.35) {
      frSettle(f);
      return;
    }

    const r = Math.random();
    if (r < 0.30) {                                   // 挪两步 ✓
      const lim = zoneRange(f);                       // ★ 第十四版：按当前那块地 ✓
      const to = Math.max(lim[0], Math.min(lim[1], f.off + rnd(-10, 10)));
      if (Math.abs(to - f.off) < 2.2) {
        frMood(f, 'awake');
        frSchedule(f, rnd(2200, 4600));
        return;
      }
      frWalk(f, to, () => { frMood(f, 'awake'); frSchedule(f, rnd(2200, 5200)); });
      return;
    }
    if (r < 0.55) {                                   // 东张西望 ✓
      frMood(f, 'look');
      frSchedule(f, rnd(2200, 4200));
      return;
    }
    if (r < 0.72) {                                   // 拍翅膀 / 嗅一嗅 ✓
      frMood(f, 'preen');
      frSchedule(f, rnd(1800, 3200));
      return;
    }
    if (r < 0.85) {                                   // 自己高兴一下 ✓
      frHappy(f);
      frSchedule(f, rnd(2400, 4800));
      return;
    }
    // ★ 第十三版：0.97 → 0.94 ✓ —— 单只打盹的机会少一点。
    //   `tryMeet` 现在**不会**把睡着的拽起来碰面 ✓ → 两只总有一只在睡的话，
    //   碰面会被一直往后推 ✗（用户要的"多贴"就没了 ✓）。
    if (r < 0.94) {                                   // 打个盹 ✓（先 settle ✓）
      frSettle(f);
      return;
    }
    frMood(f, 'awake');                               // 什么都不干 ✓
    frSchedule(f, rnd(3000, 6000));
  };

  const scheduleMeet = (ms) => {
    frMeetTimer = clearT(frMeetTimer);
    // ★ 第十三版：24–52s → **9–17s** ✓（用户：「猪猪和鸭鸭需要多贴，频率高」✓）
    frMeetTimer = setTimeout(tryMeet, ms == null ? rnd(9000, 17000) : ms);
  };

  const tryMeet = () => {
    frMeetTimer = null;
    if (hidden) return;
    if (reduce() || mode !== 'auto' || frMeeting) {
      scheduleMeet(rnd(6000, 12000));
      return;
    }
    // ★ 第十三版：有一只睡着 / 正要趴下 → **等它醒** ✓。
    //   以前会把睡着的直接拽起来碰面 ✗ —— 那不叫"亲密"，像被点名 ✓。
    if (fr.some((f) => f.mood === 'sleep' || f.mood === 'settle')) {
      scheduleMeet(rnd(5000, 10000));
      return;
    }
    // ★ 第十四版：正在**搬家**（走去窝里 / 走去中间 ✓）→ 到了再碰 ✓；
    //   半路把它俩拦下来会变成永远走不到窝里 ✗。
    if (fr.some((f) => f.mood === 'walk')) {
      scheduleMeet(rnd(3500, 7000));
      return;
    }
    // 猫**正贴着**它们（friends 站）→ 先别挤进去 ✓
    //   ★ 第十三版：55 → 26 ✓ —— 猫改成常驻 `mid1`（离猪猪 ~35px）以后，
    //   旧的 55 会一直挡住碰面 ✗（整段"多贴"就没了 ✓）。
    if (pigF && Math.abs((x + catHalf) - frCenter(pigF)) < 26) {
      scheduleMeet(rnd(8000, 14000));
      return;
    }
    frMeet();
  };

  /** ★ 第十三版：贴够了，干脆**挨着睡一小觉** ✓（用户要的"多贴"✓）。
   *  · 从碰面的贴身位各退 5.5px（6.5 → 1 / −6.5 → −1 ✓）——
   *    这一档截图看过：并排、中间还留一点缝 ✓，不穿模 ✓。
   *  · 先 settle 0.9s 再闭眼 ✓（和单只睡觉同一条路 ✓）。
   *  · 睡 11–20s 各自醒 ✓（醒来各过各的 ✓）；这期间不排碰面 ✓
   *    （`tryMeet` 那条"有一只睡着就等"✓）。
   *  · 猫这时候过来贴贴 → `frCuddleAll` 会把它们叫起来 ✓（这是对的 ✓）。 */
  const frPairNap = () => {
    frMeetStep = null;
    frMeeting = false;
    [duckF, pigF].forEach((f) => {
      if (!f) return;
      f.timer = clearT(f.timer);
      f.happyT = clearT(f.happyT);
      f.el.classList.remove('happy', 'nuzzle');
      frTilt(f, 0);
      f.el.style.setProperty('--fr-gaze', '0');
    });
    let left = 2;
    const settleBoth = () => {
      if (--left) return;
      [duckF, pigF].forEach((f) => { if (f) frMood(f, 'settle'); });
      frMeetStep = setTimeout(() => {
        frMeetStep = null;
        [duckF, pigF].forEach((f) => {
          if (!f) return;
          frMood(f, 'sleep');
          frSchedule(f, rnd(11000, 20000));
        });
      }, 900);
      scheduleMeet(rnd(22000, 32000));   // 睡醒以后再来 ✓（睡着时 tryMeet 会挡 ✓）
    };
    // ★ 第十四版：**就地**各退 5.5px ✓（不再写死老家那两条 1 / −1 ✗）——
    //   在窝里碰完就睡在窝里 ✓；回老家碰完就睡在老家 ✓。
    //   ⚠️ 退开以后还得**在屏内** ✓ —— 窝贴右沿 ✓，猪猪再往右 5.5 会出界 ✗。
    const sw = stage.clientWidth || 320;
    const duckTo = Math.max(1 - duckF.base, duckF.off - 5.5);
    const pigTo = Math.min(sw - 2 - FR_W - pigF.base, pigF.off + 5.5);
    frWalk(duckF, duckTo, settleBoth);
    frWalk(pigF, pigTo, settleBoth);
  };

  /** 两只走到中间面对面 ✓ → 歪头 + 蹦 + 爱心 ✓ → 各回各家 ✓。 */
  const frPart = () => {
    frMeetStep = null;
    frMeeting = false;
    // ★ 第十一版：分开前**各拍一下 / 嗅一下** ✓（0.62s ✓）——
    //   旧版歪头一撤就拔腿走 ✗，像被喊了"解散"✓。
    [duckF, pigF].forEach((f) => {
      if (!f) return;
      frTilt(f, 0);
      f.el.style.setProperty('--fr-gaze', '0');
      frMood(f, 'preen');
    });
    frMeetStep = setTimeout(() => {
      frMeetStep = null;
      [duckF, pigF].forEach((f) => {
        if (!f) return;
        frMood(f, 'awake');
        // ★ 第十四版：回**它们现在待的那块地方** ✓，不再一律回老家 ✗
        frWalk(f, zoneTarget(f, f.zone), () => {
          frMood(f, 'awake');
          frSchedule(f, rnd(2500, 6000));
        });
      });
    }, 620);
    scheduleMeet(rnd(9000, 18000));   // ★ 第十三版：26–55s → 9–18s ✓
  };

  const frGreet = () => {
    if (!frMeeting || !duckF || !pigF) return;
    frMeetStep = clearT(frMeetStep);
    // ① 站定，**眼睛先看过去** ✓（头还没歪 ✓ —— 先看见、再歪头 ✓）
    frMood(duckF, 'meet');
    frMood(pigF, 'meet');
    frTilt(duckF, 0);
    frTilt(pigF, 0);
    duckF.el.style.setProperty('--fr-gaze', '2.6');
    pigF.el.style.setProperty('--fr-gaze', '-2.6');
    // ② 0.45s 后才歪头 ✓（头跟着眼睛走 ✓，这才像"看见对方了"✓）
    frMeetStep = setTimeout(() => {
      if (!frMeeting) return;
      frTilt(duckF, 9);
      frTilt(pigF, -9);
      // ③ 再 0.52s 才蹦 ✓（一次软的 ✓ + 一轮爱心 ✓）
      frMeetStep = setTimeout(() => {
        if (!frMeeting) return;
        frHappy(duckF, 1700);
        frHappy(pigF, 1700);
        // ④ 蹦完再歪深一点 ✓（互相蹭一下 ✓）→ ★ 第十三版：**贴着待 4–6s** ✓
        frMeetStep = setTimeout(() => {
          if (!frMeeting) return;
          frTilt(duckF, 13);
          frTilt(pigF, -13);
          // ⑤ 贴住的中途再软软地蹭一下 ✓（两只一动不动太久会像定格 ✗）
          frMeetStep = setTimeout(() => {
            if (!frMeeting) return;
            frHappy(duckF, 1500);
            frHappy(pigF, 1500);
            frMeetStep = setTimeout(() => {
              if (!frMeeting) return;
              // ⑥ 三成干脆挨着睡一小觉 ✓；不然各回各家 ✓
              if (Math.random() < 0.30) frPairNap(); else frPart();
            }, rnd(1600, 2900));
          }, rnd(1400, 2100));
        }, 900);
      }, 520);
    }, 450);
  };

  /** ★ 第十四版：**就地碰头** ✓ —— 两只现在在哪块地方，就在哪块地方贴 ✓。
   *  · 取它俩**盒子中心的中点**当碰面点 ✓；保持老站位（猪猪盒左沿 = 鸭鸭 +16 ✓，
   *    画出来中间 ~1.8px ✓ 不穿模 ✓）。
   *  · 夹在屏内 ✓（离右沿留 2px ✓）。
   *  · ⚠️ 以前是写死回老家（6.5 / −6.5 ✓）—— 现在它们去中间 / 窝里以后，
   *    那套会变成"每次都横穿全屏回来碰头"✗（用户要的"别老在左边"就白改了 ✓）。 */
  const frMeetPair = () => {
    const sw = stage.clientWidth || 320;
    const c = (frLeft(duckF) + FR_W / 2 + frLeft(pigF) + FR_W / 2) / 2;
    const duckLeft = Math.max(1, Math.min(sw - 46, c - 22));
    return {
      duck: duckLeft - duckF.base,
      pig: duckLeft + 16 - pigF.base,
    };
  };

  const frMeet = () => {
    if (!duckF || !pigF) return;
    frMeeting = true;
    fr.forEach((f) => {
      f.timer = clearT(f.timer);
      f.happyT = clearT(f.happyT);
      f.el.classList.remove('happy');
      frStopWalk(f);
    });
    const m = frMeetPair();
    let left = 2;
    const arrival = () => { left -= 1; if (left === 0) frGreet(); };
    frWalk(duckF, m.duck, arrival);
    frWalk(pigF, m.pig, arrival);
  };

  /** 猫开口了 / 页面藏起来了 → 两只停下待着 ✓（睡觉的照睡 ✓）。 */
  const frHold = () => {
    frMeeting = false;
    frSnugging = false;
    frMeetTimer = clearT(frMeetTimer);
    frMeetStep = clearT(frMeetStep);
    trioTimer = clearT(trioTimer);   // 用户的事优先 ✓；办完 frResume 会重排 ✓
    zoneTimer = clearT(zoneTimer);   // ★ 第十四版：搬家也停下 ✓（同上 ✓）
    fr.forEach((f) => {
      f.timer = clearT(f.timer);
      f.happyT = clearT(f.happyT);
      frStopWalk(f);
      f.el.classList.remove('happy', 'nuzzle');
      frTilt(f, 0);
      f.el.style.setProperty('--fr-gaze', '0');
      // ★ 第十一版：半截状态要收口 ✓ —— settle 收成 sleep ✓
      //   （不然计时器被收掉、它还半蹲着闭着眼 ✓，一直定在那儿 ✓）
      if (f.mood === 'settle') { frMood(f, 'sleep'); return; }
      if (f.mood === 'meet' || f.mood === 'walk' || f.mood === 'stretch' ||
          f.mood === 'cuddle' || f.mood === 'nuzzle') {
        frMood(f, 'awake');
      }
    });
    // 两只还睡着 = 三只午睡中 ✓（暖光留着 ✓）；都醒着 = 贴贴被打断 → 收掉 ✓
    if (!fr.some((f) => f.mood === 'sleep' || f.mood === 'settle')) setTrio(null);
  };

  /** 猫的事办完了 → 接着自己过日子 ✓ */
  const frResume = () => {
    if (hidden) return;
    fr.forEach((f) => {
      if (!f.timer) frSchedule(f, f.mood === 'sleep' ? rnd(8000, 16000) : rnd(2000, 6000));
    });
    scheduleMeet(rnd(8000, 15000));   // ★ 第十三版：两只之间勤快 ✓
    if (!trioTimer) scheduleTrio(rnd(60000, 110000));  // ★ 猫偶尔加入 ✓
    if (!zoneTimer) scheduleZone(rnd(30000, 55000));   // ★ 第十四版：继续换地方 ✓
  };

  // ── ★ 第十二版：三只凑一起 ✓ ─────────────────────────────────────────
  /** 画面状态 ✓：cuddle = 贴着蹭蹭（冒爱心 ✓）/ nap = 一起午睡（一圈暖光 ✓）。
   *  CSS 只认 `#catStage[data-trio]` ✓（见 app.css ✓）。 */
  const setTrio = (s) => {
    if (s) {
      if (stage.dataset.trio !== s) stage.dataset.trio = s;
    } else if (stage.dataset.trio) {
      delete stage.dataset.trio;
    }
  };

  /** 猫在左边趴下 → 猪猪 / 鸭鸭跟着趴下 ✓ → **三只一起午睡** ✓。
   *  · 底下那圈暖光由 `data-trio="nap"` 点亮 ✓（慢慢呼吸 ✓）。
   *  · 猫先 `settle` 0.9s 再真正闭眼 ✓；两只同一条路 ✓（各走各的 ✓）。
   *  · 猫醒 → `friendsWake()` 把它们俩也叫起来 ✓（见 wakeUp ✓）。 */
  const settleWithFriends = () => {
    if (mode !== 'auto') return;
    actTimer = clearT(actTimer);
    idleTimer = clearT(idleTimer);
    spot = 'friends';
    frSnugging = false;
    setMood('settle');
    setTrio('nap');
    fr.forEach((f) => {
      f.happyT = clearT(f.happyT);
      f.el.classList.remove('happy', 'nuzzle');
      frTilt(f, 0);
      f.el.style.setProperty('--fr-gaze', '0');
      if (f.mood !== 'sleep' && f.mood !== 'settle') frSettle(f);
    });
    actTimer = setTimeout(() => {
      actTimer = null;
      if (mode !== 'auto') return;
      setMood('sleep');
      scheduleSleep(rnd(TRIO_SLEEP_MS[0], TRIO_SLEEP_MS[1]));
    }, 900);
  };

  /** 走到朋友们旁边之后：先坐下看看 ✓ → 贴上去蹭蹭 ✓（两只靠过来冒爱心 ✓）
   *  → 多半干脆**一起趴下睡** ✓；不然再坐一会儿，然后回中间 ✓。 */
  const cozyAtFriends = () => {
    if (mode !== 'auto') return;
    stopWalk();
    frMeeting = false;
    frSnugging = false;
    frMeetTimer = clearT(frMeetTimer);
    frMeetStep = clearT(frMeetStep);
    spot = 'friends';
    setMood('awake');
    fr.forEach((f) => {
      f.timer = clearT(f.timer);
      f.happyT = clearT(f.happyT);
      frStopWalk(f);
      f.el.classList.remove('nuzzle');
      if (f.mood === 'walk' || f.mood === 'meet' || f.mood === 'preen') {
        frMood(f, 'awake');
      }
      const dx = (x + catHalf) - frCenter(f);
      f.el.style.setProperty('--fr-gaze', dx >= 0 ? 2.6 : -2.6);
    });

    actTimer = clearT(actTimer);
    actTimer = setTimeout(() => {
      actTimer = null;
      if (mode !== 'auto') return;
      // ① 贴上去蹭蹭 ✓
      setMood('snug');
      frSnugging = true;
      setTrio('cuddle');
      frCuddleAll();
      actTimer = setTimeout(() => {
        actTimer = null;
        frSnugging = false;
        setTrio(null);
        if (mode !== 'auto') return;
        // ② 多半就地一起午睡 ✓（这才是"陪着"✓）；不然再坐一会儿 ✓
        if (Math.random() < 0.68) { settleWithFriends(); return; }
        frRelease();
        setMood('look');
        actTimer = setTimeout(() => {
          actTimer = null;
          if (mode !== 'auto') return;
          walkTo('mid2', arrive);
        }, rnd(3400, 5400));
      }, rnd(3000, 4200));
    }, rnd(900, 1600));
  };

  const scheduleTrio = (ms) => {
    trioTimer = clearT(trioTimer);
    // ★ 第十三版：32–56s → **75–120s** ✓（猫只偶尔加入 ✓）
    trioTimer = setTimeout(tryTrio, ms == null ? rnd(TRIO_GAP_MS[0], TRIO_GAP_MS[1]) : ms);
  };

  /** 到点了：猫**自己**走过去找它们 ✓（用户要的"亲密互动"✓）。
   *  ★ 第十三版：**只在醒着（awake / look）时去** ✓ —— 睡着的、洗脸的、
   *    想事情的都别打断 ✗。而且它现在常驻 `mid1`（离猪猪 ~35px ✓），
   *    所以从"坐在旁边"挪过去贴贴只需要走十几像素 ✓（不是横穿顶栏 ✗）。
   *  ⚠️ 已经**贴住**了（spot=friends ✓）→ 下一次放到 150–240s ✓，
   *    不然 75s 一到又贴上去，等于一直黏着 ✗。 */
  const tryTrio = () => {
    trioTimer = null;
    if (!pigF || hidden) return;
    if (reduce() || mode !== 'auto' || frMeeting || frSnugging) {
      scheduleTrio(rnd(20000, 35000));
      return;
    }
    if (stepRaf) { scheduleTrio(rnd(15000, 25000)); return; }
    // 已经**贴住**了 ✓ → 很久以后再说 ✓（不是"已经坐旁边"✗ —— 旁边还得贴过去 ✓）
    const dPig = Math.abs((x + catHalf) - frCenter(pigF));
    if (spot === 'friends' && dPig < 24) {
      scheduleTrio(rnd(TRIO_AFTER_MS[0], TRIO_AFTER_MS[1]));
      return;
    }
    // 刚从三只午睡里醒来 → 先自己过一会儿 ✓（别一醒就往回跑 ✗）
    const wait = trioRest - performance.now();
    if (wait > 0) { scheduleTrio(wait + rnd(8000, 20000)); return; }
    if (mood !== 'awake' && mood !== 'look') { scheduleTrio(rnd(20000, 35000)); return; }
    clearAuto();
    walkTo('friends', () => { if (mode === 'auto') cozyAtFriends(); });
    scheduleTrio(rnd(TRIO_AFTER_MS[0], TRIO_AFTER_MS[1]));
  };

  // ── ★ 第十四版：两只**成对**换地方 ✓（家 / 名字中间 / 最右边的窝 ✓）────
  // 用户：「最右边的小窝给猪猪和鸭鸭睡觉…他们也可以在其他地方玩和睡觉，
  //         不要老是在左边」✓
  // · 40–75s 换一块 ✓；**两只一起走** ✓（猪猪晚半拍出发 ✓，不并排像列队 ✗）。
  // · 到窝里 → 65% 先坐一下再趴下睡 ✓（`frSettle` ✓，这就是"窝是它俩的"✓）。
  // · 别在这儿抢活儿：猫正走过来贴贴 / 已经贴着 / 正在碰面 / 正在贴 / 半路 → 往后挪 ✓
  //   （**睡着的不算** ✓ —— 叫起来再走 ✓，见下 ✓）。
  // · 换完重排下一次 ✓；用户一开口 `frHold` 会把 `zoneTimer` 收掉 ✓，
  //   `frResume` 再排上 ✓（和碰面、贴贴同一个规矩 ✓）。
  const scheduleZone = (ms) => {
    zoneTimer = clearT(zoneTimer);
    zoneTimer = setTimeout(relocate, ms == null ? rnd(ZONE_GAP_MS[0], ZONE_GAP_MS[1]) : ms);
  };

  /** 下一块地方 ✓（不挑现在这块 ✓；窝稍微偏一点 ✓ —— 那才是"睡觉的地方"✓）。 */
  const pickZone = () => {
    const pool = ['home', 'nest'].filter((z) => z !== frZone);
    const w = { home: 1.0, nest: 1.25 };
    let total = 0;
    const ws = pool.map((z) => { total += w[z]; return w[z]; });
    let r = Math.random() * total;
    for (let i = 0; i < pool.length; i++) { r -= ws[i]; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  };

  const relocate = () => {
    zoneTimer = null;
    if (hidden || reduce() || mode !== 'auto') return;
    // ★ 第十四版：**睡着的也叫得起来** ✓ —— 旧版把 sleep / settle 也当成"别打扰"✗，
    //   可它俩在自己窝里是轮着打盹的 ✓（一只睡、一只醒 ✓）——"两只都醒着"的
    //   窗口几乎没有 ✗，计时器次次被挡 ✓（实测 62s 还没挪窝 ✗）。
    //   现在：先醒 → 半秒 → 走过去 → 到了再睡（到窝里 65% ✓）。
    //   真正不能打断的只剩贴贴 / 碰面 / 半路那几种 ✓（去贴贴的猫也不打扰 ✓）。
    if (frMeeting || frSnugging || stepRaf || spot === 'friends' ||
        fr.some((f) => f.mood === 'cuddle' || f.mood === 'nuzzle' ||
                        f.mood === 'meet' || f.mood === 'stretch' ||
                        f.mood === 'preen' || f.mood === 'walk')) {
      scheduleZone(rnd(4000, 7000));
      return;
    }
    frZone = pickZone();
    fr.forEach((f, i) => {
      f.zone = frZone;
      f.timer = clearT(f.timer);
      f.happyT = clearT(f.happyT);
      f.el.classList.remove('happy', 'nuzzle');
      frTilt(f, 0);
      f.el.style.setProperty('--fr-gaze', '0');
      const walkAway = () => {
        frWalk(f, zoneTarget(f, f.zone), () => {
          if (f.zone !== frZone) return;          // 又换新的了 → 听新的 ✓
          frMood(f, 'awake');
          if (frZone === 'nest' && Math.random() < 0.65) {
            f.timer = clearT(f.timer);
            f.timer = setTimeout(() => {
              f.timer = null;
              if (!frCanAct() || frMeeting || f.zone !== 'nest') return;
              frSettle(f);
            }, rnd(1600, 3400));
            return;
          }
          frSchedule(f, rnd(2400, 5000));
        });
      };
      const go = () => {
        // 睡着 / 正要趴下 → 先站起来醒一下 ✓（别直接从趴着"滑"出去 ✗）
        if (f.mood === 'sleep' || f.mood === 'settle') {
          frMood(f, 'awake');
          f.timer = clearT(f.timer);
          f.timer = setTimeout(() => {
            f.timer = null;
            if (!frCanAct() || f.zone !== frZone) { frSchedule(f, rnd(2000, 4000)); return; }
            walkAway();
          }, rnd(500, 1100));
          return;
        }
        walkAway();
      };
      if (i) {                                    // 猪猪晚半拍 ✓
        f.timer = clearT(f.timer);
        f.timer = setTimeout(() => {
          f.timer = null;
          if (frCanAct()) go(); else frSchedule(f, 2000);
        }, rnd(350, 1500));
      } else {
        go();
      }
    });
    scheduleZone();
  };

  const frInit = () => {
    if (!fr.length) return;
    frMeasure();
    // ★ 第十四版：开场就**睡在最右边的窝里** ✓（用户：「最右边的小窝给
    //   猪猪和鸭鸭睡觉」✓）—— 猫在地毯上，正好是两处不同的床 ✓。
    frZone = 'nest';
    fr.forEach((f) => {
      f.zone = 'nest';
      f.mood = 'sleep';
      f.el.dataset.mood = 'sleep';
      frSetX(f, zoneTarget(f, 'nest'));
      f.el.style.setProperty('--fr-gaze', '0');
      frSchedule(f, rnd(FR_NAP_MS[0], FR_NAP_MS[1]));
    });
    scheduleMeet(rnd(12000, 22000));   // ★ 第十四版：开场都在睡 → 醒了再碰 ✓
    scheduleTrio(rnd(45000, 80000));   // ★ 第十三版：猫头一次贴贴也放晚一点 ✓
    scheduleZone(rnd(30000, 50000));   // ★ 第十四版：睡醒再换地方 ✓
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

    // ★ 第十二版：三只一起午睡 → 猫醒，**两只也跟着醒** ✓（有时各伸个懒腰 ✓）。
    //   然后隔 40s 以上才考虑再去 ✓ —— 不然猫睡醒就往回跑，一天到晚黏在那儿 ✗。
    if (spot === 'friends' && stage.dataset.trio === 'nap') {
      friendsWake();
      trioRest = performance.now() + TRIO_COOL + rnd(0, 40000);
    }

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
   *  ★ 第十四版：**地毯是它的床** ✓（用户：「地毯给猫猫睡觉」✓）——
   *    · `rug` 权重最高 ✓ —— 大部分时间就趴在地毯上 ✓（真猫一天睡十几个小时 ✓）；
   *    · `mid2` 是**玩的地方** ✓（偏左一块 ✓，不在群名底下 ✓），
   *      到了就坐坐、洗脸、望风 ✓，困了**自己走回地毯**再睡 ✓（`goSleep` ✓）；
   *    · `friends` 照旧偶尔去 ✓（0.8 ✓，贴完多半一起午睡 ✓）；
   *    · 老家的 `bed`（窝）**不再是猫的** ✓ —— 归猪猪 / 鸭鸭了 ✓。 */
  const pickSpot = () => {
    const pool = [
      { name: 'rug',    w: 2.6 },
      { name: 'mid2',   w: 1.1 },
      { name: 'friends', w: 0.8, easy: 200 },
    ].filter((t) => t.name !== spot && t.w > 0);
    if (!pool.length) return 'rug';

    let total = 0;
    const weights = pool.map((t) => {
      const d = Math.abs(xFor(t.name) - x);
      const w = t.w / (1 + d / (t.easy || 120));
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

  /** ★ 第十四版：困了 → **回地毯上**再趴下 ✓（用户：「地毯给猫猫睡觉」✓）。
   *  已经在地毯上就原地趴 ✓；在别处玩就慢慢走回去 ✓（30px/s ✓）。 */
  const goSleep = () => {
    if (spot === 'rug') { settleAndSleep(); return; }
    walkTo('rug', () => { if (mode === 'auto') settleAndSleep(); });
  };

  /** 到站以后干什么 ✓。 */
  const arrive = () => {
    if (mode !== 'auto') return;

    if (spot === 'friends') {
      // ★ 第十二版：到了不是"坐一会儿就走" ✗ —— 贴上去蹭蹭 ✓，
      //   多半干脆一起趴下睡 ✓（见 cozyAtFriends ✓）。
      cozyAtFriends();
      return;
    }

    // ★ 第十四版：地毯 = 猫自己的床 ✓ —— 到了直接趴下 ✓。
    if (spot === 'rug') { settleAndSleep(); return; }

    // 名字中间那两块地：坐一会儿 ✓，有时洗个脸 / 望望风 ✓，困了回地毯 ✓
    const r = Math.random();
    if (r < 0.5) {
      setMood('awake');
      actTimer = clearT(actTimer);
      actTimer = setTimeout(() => {
        actTimer = null;
        if (mode !== 'auto') return;
        if (Math.random() < 0.3) doIdle(); else goSleep();
      }, rnd(2400, 4600));
      return;
    }
    if (r < 0.75) {
      setMood('groom');
      actTimer = clearT(actTimer);
      actTimer = setTimeout(() => {
        actTimer = null;
        if (mode !== 'auto') return;
        goSleep();
      }, 3600);
      return;
    }
    setMood('look');
    actTimer = clearT(actTimer);
    actTimer = setTimeout(() => {
      actTimer = null;
      if (mode !== 'auto') return;
      goSleep();
    }, rnd(4200, 6400));
  };

  /** 决定下一步 ✓：四成挪个地方 ✓，六成就在原地做点什么 ✓。 */
  const decide = () => {
    idleTimer = null;
    if (hidden || reduce() || mode !== 'auto' || stepRaf) return;
    if (mood === 'sleep' || mood === 'settle') { wakeUp(); return; }

    // ★ 第十四版：**地毯就是它的床** ✓ —— 醒来不必马上离开 ✓
    //   （它爱睡多久睡多久 ✓；想动的时候 `pickSpot` 自然会挑到别处 ✓）。
    if (Math.random() < 0.4) {
      const target = pickSpot();
      // 从地毯上起身：一半先伸个懒腰 ✓（真猫下床的样子 ✓）
      if (spot === 'rug' && Math.random() < 0.5) {
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
    frHold();                 // ★ 第十版：两只也停下 ✓（别在人说话时溜达 ✓）
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
    frHold();                 // ★ 第十版：回话前后两只陪着待着 ✓
    actTimer = setTimeout(() => {
      actTimer = null;
      if (mode !== 'user') return;
      mode = 'auto';
      frResume();             // ★ 第十版：猫的事完了，两只接着过日子 ✓
      // ★ 第十二版：在朋友旁边就地趴下 ✓（三只继续一起睡 ✓）——
      //   旧版会把它叫回中间 ✗，刚贴热乎就走 ✓。
      if (spot === 'friends') {
        settleWithFriends();
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
      frResume();                                // ★ 第十版：两只也继续过 ✓
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
    if (hidden) { clearAuto(); freeze(); frHold(); return; }
    if (mode !== 'auto') return;
    frResume();                 // ★ 第十版：切回来接着过 ✓
    if (mood === 'walk' || mood === 'look' || mood === 'groom' ||
        mood === 'knead' || mood === 'stretch' || mood === 'yawn' ||
        mood === 'snug') {
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
    measureScene();               // ★ 第八 / 九版：玩具的中心 + 猫半宽 跟着屏宽重量 ✓
    frMeasure();                  // ★ 第十版：两只"没位移时的站位"也量一次 ✓
    // ★ 第十四版：窝和"名字中间"都是按屏宽 / 窝的位置算的 ✓ → 转屏后重站 ✓
    //   （正在半路的不打断 ✓，让它把这一步走完 ✓）
    fr.forEach((f) => {
      if (f.raf) return;
      frSetX(f, zoneTarget(f, f.zone));
    });
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
  frInit();                     // ★ 第十版：两只开始自己过日子 ✓
})();
