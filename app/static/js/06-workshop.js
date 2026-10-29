  //
  // 展示**这个群自己**的组件 —— 服务端按 `group_id` 分目录 ✓
  // （`/api/components?group_id=`），所以别的群的东西**根本不会出现在这儿** ✓；
  // 这一点**不靠前端过滤** ✓（过滤是能绕过的 ✗）。
  //
  // ★ 2026-10-07 用户重新定的形状 ✗→✓：
  //     · **不分区了** ✓（"不需要分实验区和使用区，右上角点击进入就只是单纯地
  //       罗列组件" ✓ —— 理由他自己给了：都在沙箱里、组件之间本来就隔离 ✓）
  //     · 这一屏**只剩"列出来"** ✓：一行一个组件 ✓
  //     · ★ 2026-10-22：**管理也不做了** ✓ —— 右上角 ⋯（改名/导入/导出/删除）
  //       连同对应接口一起删了 ✓。这一屏现在是**纯展示** ✓：
  //       点开看内容 ✓，改组件由服务器管家在服务端做 ✓。
  // ── ★ 「组件界面」自己的外观（2026-10-08）─────────────────────────────
  //
  // 由服务端写入的一段 CSS ✓（存 `var/wall/g<群>/style.css` ✓，
  // 服务端按群分开存 ✓）。进来时套上 ✓、离开时摘掉 ✓。
  //
  // ⚠️ **不能常驻** ✗ —— 它有可能会改到别的屏（用户写的那段 CSS 不保证只认 #workshop ✓），
  //    常驻就等于"某一屏的外观污染了整个 App" ✓。所以只在**这一屏开着的时候**挂着 ✓。
  // ⚠️ 注入的 `<style>` 挂在 `<head>` 上 ✓（不是这一屏里面 ✓）—— 放屏里面也会全局生效 ✓，
  //    那是 `<style>` 的语义 ✓，所以只能靠"进出时挂/摘"来限定时间 ✓。
  //: ★ **骨架属性** ✗→✓（2026-10-11 用户抓到的一个真 bug）——
  //:   那段 CSS 是 **agent 自己写的** ✓，而它写了
  //:   `#workshop { position: relative !important; }` ✗ —— 那一句**把整屏的定位掀了** ✓：
  //:   `.screen` 靠 `position:fixed; inset:0` 盖住整个视口 ✓ → 变成 `relative` 之后
  //:   **它不再盖住** ✓ → 底下的群聊露出来（连输入框一起 ✓）、**页面还变得能滚** ✓
  //:   （用户："向上滑成这样了，本来向上滑不该有任何触发"✓）。
  //:
  //:  ⚠️ **这又一次是"提示词 vs 闸门"** ✓：告诉 agent"别动布局"是**请求** ✗；
  //:     `!important` + id 选择器还会赢过样式表里那些普通规则 ✓ ——
  //:     **光在 CSS 里加 `!important` 也拦不住** ✗（id 的选择器更具体 ✓，
  //:      两边都 important 时按出现顺序 ✓，而这段是**后注入**的 ✓ → 它赢 ✗）。
  //:     所以闸门只能设在这里：**注入之前把它摘掉** ✓。
  //:
  //:  ⚠️ 只对**"屏本身"那个选择器**动手 ✗ —— `#workshop .cell { … }` 那种
  //:     （改里头的卡片长什么样 ✓）**一个字都不动** ✓，那是它该干的活 ✓。
  const _LAYOUT_PROP = /^(position|inset|top|right|bottom|left|z-index|display|overflow|overflow-[xy]|height|min-height|max-height|width|min-width|max-width|transform|visibility|opacity|pointer-events|contain|isolation)$/i;
  const _SCREEN_SEL = /^(#workshop|#compView|\.screen|body|html|:root)$/i;
  const sanitizeWallCss = (css) => css
    // ⚠️ **先把注释剥掉** ✗→✓ —— 第一版没剥 ✓，于是选择器那段捕获到的是
    //    `/* 收纳页 … */\n#workshop` ✓（**带着注释** ✓）→ `^#workshop$` 匹配不上 ✓ →
    //    闸门**一个字都没拦** ✓。我拿真 CSS 跑了一遍才看见 ✗（"看着写了闸门"≠"闸门拦得住"✓）。
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/([^{}]+)\{([^{}]*)\}/g, (whole, sel, body) => {
      const hits = sel.split(",").map((s) => s.trim()).filter((s) => _SCREEN_SEL.test(s));
      if (!hits.length) return whole;                   // 不是在动"屏本身" → 原样放行 ✓
      const kept = body.split(";").filter((d) => {
        const name = d.split(":")[0].trim();
        return !name || !_LAYOUT_PROP.test(name);       // 骨架属性摘掉 ✓，配色之类留着 ✓
      });
      return sel + "{" + kept.join(";") + "}";
    });

  //: ⚠️ **那段外观要"开机就取好"** ✗→✓（2026-10-11 用户："进组件界面/工坊容易黑屏一闪"）——
  //:   原来是**进屏那一刻才异步取** ✗ → 取回来之前先按默认底色画了一帧 ✓ →
  //:   那一段就是"黑屏一闪" ✓（主群聊 ⇄ 设置不闪 ✓，因为那两屏的主色**在样式表里** ✓，
  //:   而这一屏的主色是**取回来的** ✓）。
  //:   现在：开机（进 App 时）**预取一次** ✓ 缓存在这儿 ✓ → 进屏时**同步**挂上 ✓ → 不闪 ✓。
  let _wallCss = null;        // null = 还没取过；'' = 取过了、没有自定义外观

  const _paintWallCss = (css) => {
    const old = $('#wall-custom');
    if (old) old.remove();
    if (!css || !css.trim()) return;                 // 没改过 → 默认样子 ✓
    const st = document.createElement('style');
    st.id = 'wall-custom';
    st.textContent = sanitizeWallCss(css);           // ★ 过闸 ✓（见上面那段）
    document.head.appendChild(st);
  };

  const applyWallCss = () => {
    if (_wallCss !== null) { _paintWallCss(_wallCss); return; }   // ★ **同步** ✓ 不闪 ✓
    api(`/wall-css?group_id=${group.id}`)
      .then((d) => { _wallCss = (d && d.css) || ''; _paintWallCss(_wallCss); })
      .catch(() => { _wallCss = ''; });              // 读不到就当没有 ✓（这一屏照常能用 ✓）
  };

  //: 开机预热 ✓ —— `enterApp` 进完 App 调它一次 ✓（见 03-auth.js ✓）。
  const preloadWallCss = async () => {
    try {
      const d = await api(`/wall-css?group_id=${group.id}`);
      _wallCss = (d && d.css) || '';
    } catch (e) { _wallCss = ''; }
  };

  // ★ 2026-10-20：小屋铺满整屏之后，**状态栏正压在小屋上** ✓ ——
  //   小屋是浅奶油底 ✓，深色主题下原来那套浅色状态栏图标会**看不见** ✗。
  //   所以这一摞屏里：停在小屋 → 深色图标 ✓；进组件 / 对话 → 按用户主题还原 ✓。
  //   ⚠️ 壳那边没有这个 API 时（浏览器里）静默跳过 ✓。
  //
  // ★ 2026-10-28（P2/P3）：浅底又多了三屏 ✓（提醒 / 账本 / 回忆墙 ✓）——
  //   它们和今日明信片一样是**纸** ✓，停在上头就得是深色图标 ✓。
  //   夜灯亮着时反过来 ✓（整间屋子都暗了 ✓）。判据只有一处 ✓，别处都调它 ✓。
  const _syncStatusBar = () => {
    let light = true;
    try { light = !!themeById(document.documentElement.dataset.theme).light; } catch (e) {}
    // ★ 2026-10-29：阁楼是**深底** ✓（ARCH 本来就是深色 ✓）—— 它压在最上面时
    //   不算"停在纸上" ✓，而且要**反过来**：深色图标落在深底上 = 看不见 ✗。
    const onAttic = $('#attic').classList.contains('on');
    const onPaper = ['#workshop', '#today', '#clock', '#ledgerBook', '#memoryWall']
      .some((s) => { const el = $(s); return !!el && el.classList.contains('on'); })
      && !$('#compView').classList.contains('on')
      && !onAttic;
    let lamp = false;
    try { lamp = localStorage.getItem('lg_lamp') === '1'; } catch (e) {}
    try {
      window.LifeGuardNative?.setLightStatusBar?.(
        onAttic ? false : (onPaper ? true : (lamp ? false : light)));
    } catch (e) {}
  };
  // 新三屏在 **04 / 05 / 02** 那边也要能用这一下 ✓（它们都在同一个 IIFE 里 ✓，
  // 在那边直接调也行 ✓；挂个 window 是为了以后拆文件时别断 ✓）。
  window.__syncStatusBar = _syncStatusBar;

  // ── 进空间：**跟着手指拉** ✗→✓（2026-10-24 用户定的）────────────────────
  //
  // 用户原话：「滑多少空间界面展示多少，依旧超过阈值松开后弹进来，
  //   不超过时缩回去，但没有提示了，全靠手感」✓。
  //
  // 所以进门这条路**不再有"提示条 + 过阈值才动"** ✗：
  //   · 拖的时候这一屏**按手指走了多远**实时跟 ✓（`peekWorkshop` ✓）
  //   · 松手过阈值 → 收进来 ✓；没过 → 缩回右边 ✓（`endWorkshopPeek` ✓）
  //
  // ⚠️ **不能借 `pushScreen`** ✗ —— 它一上来就放 `anim-in` ✓，
  //    和跟手那条 `transform` 会**打架** ✓（两条动画抢同一个属性 ✓）。
  //    所以这里自己挂 `.on` + 清掉动画类 + `transition:none` ✓，
  //    收尾也自己来 ✓（计号防串台，和 `pushScreen` 的 `_popToken` 一个道理 ✓）。
  //
  // ⚠️ **拖到一半不算"进来了"** ✗ —— `tellTop` / 状态栏只在**松手过阈值**
  //    那一刻改 ✓；缩回去那一路原生那边始终以为在群聊 ✓（返回键不会被带偏 ✓）。
  let wsPeekTok = 0;
  //: 这一手是不是正拉着 ✓ —— 缩回去的那 200ms 里又拉一下时，旧收尾必须作废 ✓。
  let wsPeekOn = false;

  /** 手指往左走了 `travel` px → 这一屏就露多少 ✓。 */
  const peekWorkshop = (travel) => {
    const scr = $('#workshop');
    const W = window.innerWidth || 1;
    if (!wsPeekOn) {
      wsPeekOn = true;
      wsPeekTok++;
      scr.classList.remove(...ANIM_CLASSES);
      scr.classList.add('on');
      scr.style.transition = 'none';
      scr.style.willChange = 'transform';
      // ⚠️ **内容和外观先备好** ✗→✓ —— 松手就是成品 ✓，不用等那几十毫秒的请求 ✓。
      applyWallCss();
      renderWorkshop();
    }
    const d = Math.max(0, Math.min(W, travel));
    scr.style.transform = 'translateX(' + (W - d) + 'px)';
  };

  /** 松手：`open`（过了阈值）→ 弹进来 ✓；否则缩回右边 ✓。 */
  const endWorkshopPeek = (open) => {
    const scr = $('#workshop');
    if (!wsPeekOn) return;                 // 没在跟手 → 这一手根本没发生 ✓
    wsPeekOn = false;
    const tok = ++wsPeekTok;
    const W = window.innerWidth || 1;
    void scr.offsetWidth;                  // 让上面那条 `transition:none` 先落地 ✓
    scr.style.transition = open
      ? 'transform .26s cubic-bezier(.16,1,.3,1)'
      : 'transform .2s cubic-bezier(.4,0,1,1)';
    scr.style.transform = open ? 'translateX(0)' : 'translateX(' + W + 'px)';
    if (open) {
      tellTop();                           // ★ 松手才算进来 ✓（见上面那段 ✓）
      _syncStatusBar();
    }
    setTimeout(() => {
      if (tok !== wsPeekTok) return;       // 中间又拉了一下 → 这次收尾作废 ✓
      scr.style.transition = '';
      scr.style.transform = '';
      scr.style.willChange = '';
      if (open) return;
      scr.classList.remove('on');
      // ⚠️ 那段外观**跟着这一屏走** ✓ —— 缩回去了就得摘掉 ✓，
      //    不然它会继续挂在头上影响别的屏 ✓（同 `closeWorkshop` ✓）。
      const st = $('#wall-custom');
      if (st) st.remove();
    }, 300);
  };

  /** 开 App **落进屋** ✓（2026-10-29 用户问"登录进来还是直接进主群聊吗"✓）。
   *
   *  他要的第一眼是**屋子** ✓（提案：「打开 App 不是进列表，是进屋」✓），
   *  坐下才是聊天 ✓ —— 所以开屏停在屋里 ✓，点桌上那本信簿 = 落座 ✓。
   *
   *  ⚠️ **不走 `show('workshop')`** ✗ —— `show` 会把别的屏的 `.on` 全摘掉 ✓，
   *     而小屋是**压在聊天上面**的一屏 ✓（z22 ✓，聊天在底下一直 `.on` 着 ✓）；
   *     摘了它，退屋（`closeWorkshop` → `popScreen`）之后底下就**没人了** ✗。
   *     所以照 `peekWorkshop` 那个走法：只给这一屏加 `.on` ✓。
   *
   *  ⚠️ **不做位移动画** ✗ —— 开机那一下没有手指 ✓，"从右边滑进来"会暗示
   *     一次不存在的手势 ✓；`anim-fade` 才是"本来就在这儿" ✓。
   */
  const openWorkshopNow = () => {
    const scr = $('#workshop');
    if (!scr || scr.classList.contains('on')) return;
    applyWallCss();        // 外观先备好 ✓（同 `peekWorkshop` ✓）
    renderWorkshop();      // ★ 不 await ✓ —— 屋子本体不等组件那一趟 ✓
    scr.classList.remove(...ANIM_CLASSES);
    scr.classList.add('on');
    void scr.offsetWidth;  // 让 `on` 先落地再挂动画 ✓（不然淡入不跑 ✓）
    scr.classList.add('anim-fade');
    tellTop();
    _syncStatusBar();
  };

  /** 等屋子那张图**解码完** ✓ —— 加载页要等它 ✓，不然幕一揭开是块空白 ✓。
   *  ⚠️ 出错也 resolve ✓（图挂了就别卡开屏了 ✓，屋子照样进得去 ✓）。 */
  const preloadRoomArt = () => new Promise((res) => {
    const im = new Image();
    im.onload = im.onerror = () => res();
    im.src = '/static/flat-room.svg';
  });

  const closeWorkshop = () => {
    // ⚠️ 原来这里要"退出调整模式" ✓（模式是隐藏状态 ✓，最容易被忘 ✓）——
    //    **那个模式没有了** ✓（2026-10-08 ✓），所以这一段也空了 ✓：
    //    长按拖动没有"模式"可言 ✓，进来什么样、出去还是什么样 ✓。
    // ⚠️ 那件外套要**摘掉** ✓（见 `applyWallCss` 那段：它只在看这一屏时该生效 ✓）
    const st = $('#wall-custom');
    if (st) st.remove();
    // ★ 3D 视图（2026-10-15）：离开工坊必须卸掉 ✓ —— 否则 rAF 一直跑、
    //    canvas 残在 DOM 里、GPU 不停 ✗。
    if (ws3DOn) { try { window.Room3D && window.Room3D.unmount(); } catch (e) {} ws3DOn = false; }
    if (wsFlatOn) { wsFlatOn = false; }   // 平面预览也复位 ✓
    popScreen('workshop');
    // 退场动画还有 ~200ms 才摘 `.on` ✓ → 等它收完再按"最上面是谁"报一次 ✓
    setTimeout(_syncStatusBar, 220);
  };

  // ── 平面小屋（2026-10-20 重画）────────────────────────────────────
  // ★ 用户定的新方向：**平面二维 + 宫崎骏式暖光 + 浪漫小屋** ✓，
  //   并且**铺满整屏** ✓（`#workshop .abody` 的 padding 已经撤掉 ✓）。
  // <image> 引静态 svg（小屋 + 蔷薇 + 灯火），不进 app.js 拼接 ✓。
  // 账本是唯一热区（点 → 记账 ✓）；其它组件物件的管线以后再接 ✓。
  //
  // ★ 2026-10-20 第二轮：**猫从 flat-room.svg 里搬出来了** ✓ ——
  //   用户要「猫猫会有动作」「点它回主群聊」「整体更生动」✓。
  //   ⚠️ `<image>` 是一整块 ✗：里面的猫既**点不到** ✓（事件进不了被引文档 ✓），
  //      也没法**单独加动作** ✗（改 rsvg 只能改整张图 ✓）。
  //   → 猫画在**外层 SVG** 里 ✓，坐标还是 (682,1444) ✓（和地毯同一套 ✓），
  //     于是 SMIL 动作、点击、爱心都能直接挂 ✓。
  //   ⚠️ 搬出来之后它压在 <image> 的**暗角上方** ✓ → 末尾补一层同样的暗角 ✓，
  //      不然猫会比屋里其它东西亮一档 ✓（见下面 `wsVignette` 注释 ✓）。
  //   动作（全 SMIL ✓ —— WebView 里比 CSS transform-box 稳 ✓）：
  //     · 呼吸（整只上下 1.8）· 尾巴左右甩 + 尾巴尖单独抖 · 两只耳朵轮流抖
  //     · 睡着时踩奶（前爪轻轻转）· 胡须偶尔抖 ✓（2026-10-20 他说「动作多一些」✓）
  //     · 每 12 秒醒一次：抬头 + 睁眼 + 左右看看 + **打哈欠**（挤眼 ✓ 嘴真的张开 ✓）
  //       + 盯住飞过来的小蝴蝶 ✓ + 蝴蝶落鼻尖时斗鸡眼 ✓ + 甩头把它赶走 ✓ 再睡回去 ✓
  //     · Zzz 慢慢飘（醒着时退场 ✓）· 身边偶尔闪小星星（不写字 ✓ 不用提示 ✓）
  //     · 身上的暖光晕跟着呼吸明暗 ✓ · 背脊一线窗光 ✓
  //     · **点一下：整只猫蹦起来 + 爱心 + 瞪大眼 → 0.52 秒后回主群聊** ✓
  const flatCatSvg = function () {
    const T = 'translate(682,1444) scale(1.16)';
    // 时间轴：24s 一轮（睡 → 醒/伸懒腰 → 舔爪 → 踩奶 → 看四周/摇尾 → 蝴蝶 → 洗脸 → 打哈欠 → 睡）
    const _A = function (attr, pairs, dur, tail) {
      return '<animate attributeName="' + attr + '" values="' +
        pairs.map(function (p) { return p[1]; }).join(';') + '" keyTimes="' +
        pairs.map(function (p) { return p[0]; }).join(';') + '" dur="' + dur +
        's" repeatCount="indefinite"' + (tail ? ' ' + tail : '') + '/>';
    };
    const _T = function (type, pairs, dur, tail) {
      return '<animateTransform attributeName="transform" type="' + type + '" values="' +
        pairs.map(function (p) { return p[1]; }).join(';') + '" keyTimes="' +
        pairs.map(function (p) { return p[0]; }).join(';') + '" dur="' + dur +
        's" repeatCount="indefinite"' + (tail ? ' ' + tail : '') + '/>';
    };

    let s = '<g class="ws-cat" transform="' + T + '" style="cursor:pointer">' +
      // 点击热区 —— 猫小，热区比它宽一圈
      '<rect x="-104" y="-98" width="204" height="148" fill="transparent" pointer-events="all"/>' +
      // 暖光晕
      '<ellipse cx="-6" cy="-8" rx="112" ry="64" fill="url(#wsCatGlow)" opacity=".5">' +
        '<animate attributeName="opacity" values=".38;.62;.38" keyTimes="0;.5;1" ' +
        'dur="4.2s" repeatCount="indefinite"/></ellipse>' +
      // 地上的软影
      '<ellipse cx="2" cy="26" rx="76" ry="15" fill="#6a4530" opacity=".22" ' +
        'filter="url(#wsSoft)"/>';

    // ── 点击：蹦一下 + 歪头 ───────────────────────────────────────────
    s += '<g class="cat-jump">' +
      '<animateTransform id="wsCatJump" attributeName="transform" type="translate" ' +
      'values="0 0;0 -22;0 -27;0 -5;0 0" keyTimes="0;.28;.5;.75;1" dur=".52s" ' +
      'begin="indefinite" fill="freeze"/>' +
      '<g class="cat-tilt">' +
      '<animateTransform id="wsCatTilt" attributeName="transform" type="rotate" ' +
      'values="0 -28 16;-4 -28 16;3 -28 16;0 -28 16" keyTimes="0;.3;.65;1" ' +
      'dur=".52s" begin="indefinite" fill="freeze"/>';

    // ── 呼吸 + 身体轻晃（踩奶/被蝴蝶痒到）────────────────────────────
    s += '<g class="cat-breathe">' +
      _T('translate', [[0, '0 0'], [0.5, '0 -1.5'], [1, '0 0']], 4.2) +
      '<g class="cat-sway">' +
      _T('rotate', [
        [0, '0 0 24'], [0.39, '0 0 24'],
        [0.405, '2.2 0 24'], [0.425, '0 0 24'], [0.445, '-2.2 0 24'],
        [0.465, '0 0 24'], [0.485, '2 0 24'], [0.505, '0 0 24'],
        [0.525, '-1.8 0 24'], [0.54, '0 0 24'],
        [0.555, '1 0 24'], [0.60, '-.6 0 24'], [0.655, '0 0 24'],
        [0.715, '0 0 24'], [0.725, '-1.6 0 24'], [0.74, '1.2 0 24'], [0.752, '0 0 24'],
        [1, '0 0 24']
      ], 24);

    // ── 尾巴（在身体后面）─────────────────────────────────────────────
    s += '<g class="cat-tail">' +
      // 基础慢摆
      _T('rotate', [[0, '0 48 12'], [0.25, '-4 48 12'], [0.5, '0 48 12'],
        [0.75, '4 48 12'], [1, '0 48 12']], 3.6) +
      '<g class="cat-tail-wag">' +
      _T('rotate', [
        [0, '0 48 12'],
        [0.39, '0 48 12'], [0.415, '2 48 12'], [0.44, '-2 48 12'],
        [0.465, '2 48 12'], [0.49, '-2 48 12'], [0.515, '1.5 48 12'], [0.54, '0 48 12'],
        [0.55, '0 48 12'], [0.568, '8 48 12'], [0.586, '-9 48 12'], [0.604, '8 48 12'],
        [0.622, '-9 48 12'], [0.64, '7 48 12'], [0.658, '-5 48 12'], [0.665, '0 48 12'],
        [0.70, '0 48 12'], [0.715, '14 48 12'], [0.73, '-12 48 12'], [0.745, '8 48 12'],
        [0.755, '0 48 12'], [1, '0 48 12']
      ], 24) +
      '<g class="cat-tail-tip">' +
      _T('rotate', [[0, '0 66 -14'], [0.30, '0 66 -14'], [0.35, '-5 66 -14'],
        [0.39, '3 66 -14'], [0.43, '0 66 -14'], [1, '0 66 -14']], 2.9) +
      '<g class="cat-tail-reaction">' +
      _T('rotate', [[0, '0 66 -14'], [0.705, '0 66 -14'], [0.72, '-9 66 -14'],
        [0.735, '6 66 -14'], [0.75, '0 66 -14'], [1, '0 66 -14']], 24) +
      '<path d="M 44 13 C 66 19 81 5 78 -9 C 76 -22 62 -26 56 -15" fill="none" ' +
      'stroke="#a8845a" stroke-width="16" stroke-linecap="round"/>' +
      '<path d="M 44 13 C 66 19 81 5 78 -9 C 76 -22 62 -26 56 -15" fill="none" ' +
      'stroke="#fffaf0" stroke-width="13" stroke-linecap="round"/>' +
      '<path d="M 48 12 C 66 17 78 5 75 -8" fill="none" stroke="#ffffff" ' +
      'stroke-width="2.8" stroke-linecap="round" opacity=".5"/>' +
      '<path d="M 74 -14 q 4 3 2 7" fill="none" stroke="#e7cba4" stroke-width="2.4" ' +
      'stroke-linecap="round" opacity=".8"/>' +
      '</g></g></g>';

    // 尾巴甩起来的动势线（只在摇尾那段出现）
    s += '<g class="cat-tail-lines" pointer-events="none" opacity="0">' +
      _A('opacity', [[0, 0], [0.552, 0], [0.56, 1], [0.655, 1], [0.666, 0], [1, 0]], 24) +
      '<path d="M 85 -4 q 7 1 9 6" fill="none" stroke="#fff6de" stroke-width="2.2" ' +
      'stroke-linecap="round" opacity=".7">' +
        '<animate attributeName="opacity" values="0;.8;0" keyTimes="0;.5;1" ' +
        'dur="1.1s" repeatCount="indefinite"/></path>' +
      '<path d="M 82 -14 q 8 0 12 4" fill="none" stroke="#fff6de" stroke-width="1.8" ' +
      'stroke-linecap="round" opacity=".6">' +
        '<animate attributeName="opacity" values=".7;0;.7" keyTimes="0;.5;1" ' +
        'dur="1.4s" repeatCount="indefinite"/></path></g>';

    // ── 身体（趴成一团）──────────────────────────────────────────────
    s += '<g class="cat-body-stretch">' +
      _T('scale', [[0, '1 1'], [0.19, '1 1'], [0.222, '1.045 .962'], [0.248, '1.045 .962'],
        [0.262, '1.01 1'], [0.276, '1 1'], [1, '1 1']], 24) +
      '<g class="cat-body">' +
      '<path d="M -36 20 C -39 4 -33 -14 -18 -21 C 0 -28 26 -27 42 -20 ' +
      'C 54 -14 58 -2 55 10 C 52 21 42 24 30 24 L -22 24 C -30 24 -34 23 -36 20 Z" ' +
      'fill="url(#wsCatFur)" stroke="#a8845a" stroke-width="2.4"/>' +
      // 背脊上的一线暖光
      '<path d="M -32 -10 C -26 -20 -8 -25 12 -24 C 30 -23 44 -18 50 -9" fill="none" ' +
      'stroke="#fffdf6" stroke-width="2.6" stroke-linecap="round" opacity=".55"/>' +
      // 胸口的浅色毛
      '<path d="M -30 22 C -34 10 -30 0 -20 -4 C -12 -6 -8 0 -9 10 ' +
      'C -10 18 -16 22 -22 23 Z" fill="#fffdf8" opacity=".92"/>' +
      // 背上的虎斑（很浅，不破坏奶油色）
      '<g fill="none" stroke="#e8cfa8" stroke-width="3" stroke-linecap="round" opacity=".65">' +
        '<path d="M 24 -19 q 5 7 2 13"/><path d="M 35 -15 q 4 5 2 10"/></g>' +
      // 后脚
      '<ellipse cx="44" cy="23" rx="10" ry="5.5" fill="#fdf6e8" stroke="#b08c5f" ' +
      'stroke-width="1.6"/>' +
      '<path d="M 40 21 q 2.4 -2 4.6 0 M 46 21 q 2.4 -2 4.6 0" fill="none" ' +
      'stroke="#c9a97e" stroke-width="1.2" stroke-linecap="round"/>' +
      '</g></g>';

    // ── 远侧前爪（伸懒腰 / 踩奶）────────────────────────────────────
    s += '<g class="cat-paw-far">' +
      _T('translate', [
        [0, '0 0'], [0.155, '0 0'], [0.195, '-7 0'], [0.213, '-15 1'],
        [0.248, '-15 1'], [0.26, '-6 0'], [0.274, '0 0'],
        [0.405, '0 0'], [0.418, '3 0'], [0.432, '-4 0'], [0.446, '3 0'],
        [0.460, '-4 0'], [0.474, '3 0'], [0.488, '-4 0'], [0.502, '3 0'],
        [0.516, '-4 0'], [0.53, '0 0'],
        [0.78, '0 0'], [0.84, '0 0'], [1, '0 0']
      ], 24) +
      '<ellipse cx="-32" cy="21" rx="8.5" ry="6" fill="#fbf3e3" stroke="#ab8557" ' +
      'stroke-width="1.8"/>' +
      '<path d="M -36 19 q 2.5 -2 5 0 M -31 19 q 2.5 -2 5 0" fill="none" ' +
      'stroke="#c7a476" stroke-width="1.2" stroke-linecap="round"/>' +
      '</g>';


    // ── 头 + 脸（气泡猫那条「耳朵和脸一条轮廓」的曲线，缩到 0.9）────
    s += '<g class="cat-head">' +
      _T('translate', [
        [0, '0 3'], [0.145, '0 3'],
        [0.162, '0 -3'], [0.182, '-1 -7'], [0.208, '-1 -7'], [0.222, '-1 -2'],
        [0.238, '-1 4'], [0.252, '0 5'], [0.262, '0 1'],
        [0.285, '0 .8'], [0.33, '0 1.5'], [0.38, '0 1'],
        [0.395, '0 -2'], [0.45, '0 -3.5'], [0.53, '0 -3.5'], [0.548, '0 -5'],
        [0.60, '0 -6.5'], [0.655, '0 -6'], [0.67, '-1 -7.5'], [0.695, '-2 -9'],
        [0.715, '-1 -8'], [0.73, '0 -8'], [0.748, '0 -4'],
        [0.765, '0 .2'], [0.80, '0 1'], [0.845, '0 .2'],
        [0.862, '0 -5'], [0.895, '0 -7'], [0.925, '0 -2.5'], [0.948, '0 1'], [0.965, '0 3'],
        [1, '0 3']
      ], 24) +
      '<g class="cat-head-tilt">' +
      _T('rotate', [
        [0, '-2 -18 2'], [0.145, '-2 -18 2'], [0.162, '0 -18 2'],
        [0.19, '-3 -18 2'], [0.245, '-2 -18 2'], [0.258, '0 -18 2'],
        [0.285, '4 -18 2'], [0.33, '8 -18 2'], [0.38, '8 -18 2'], [0.395, '0 -18 2'],
        [0.415, '-1.5 -18 2'], [0.455, '1 -18 2'], [0.495, '-1 -18 2'],
        [0.535, '0 -18 2'], [0.56, '-5 -18 2'], [0.60, '4 -18 2'], [0.64, '-3 -18 2'],
        [0.663, '0 -18 2'], [0.688, '-2 -18 2'], [0.712, '-7 -18 2'],
        [0.73, '6 -18 2'], [0.746, '-3 -18 2'], [0.758, '0 -18 2'],
        [0.772, '5 -18 2'], [0.80, '10 -18 2'], [0.825, '6 -18 2'], [0.85, '9 -18 2'],
        [0.862, '0 -18 2'], [0.885, '-5 -18 2'], [0.92, '-2 -18 2'],
        [0.948, '0 -18 2'], [0.968, '-2 -18 2'], [1, '-2 -18 2']
      ], 24) +
      '<g transform="translate(-66.08,-76.48) scale(.96)">';

    // 头（含耳朵）—— 与气泡猫同一块轮廓；内耳也同一对
    s += '<path d="M21.5 49.3 L19.77 36.14 Q18.33 25.23 28.49 29.45 L42.8 35.4 ' +
      'A30 27 0 0 1 53.2 35.4 L67.51 29.45 Q77.67 25.23 76.23 36.14 L75.5 49.3 ' +
      'A30 27 0 1 1 21.5 49.3 Z" fill="url(#wsCatHead)" stroke="#a8845a" ' +
      'stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<path d="M36.6 36.1 L27.5 32.7 Q22.8 31.0 23.3 36.0 L24.1 43.6 Z" fill="#f9c6c3"/>' +
      '<path d="M59.4 36.1 L68.5 32.7 Q73.2 31.0 72.7 36.0 L71.9 43.6 Z" fill="#f9c6c3"/>' +
      // 腮红
      '<ellipse cx="26" cy="73" rx="5.5" ry="3.4" fill="#f8b8b4" opacity=".9"/>' +
      '<ellipse cx="70" cy="73" rx="5.5" ry="3.4" fill="#f8b8b4" opacity=".9"/>';

    // 胡须（会轻轻抖）
    s += '<g class="cat-whisker">' +
      _T('rotate', [
        [0, '0 48 70'], [0.19, '0 48 70'], [0.22, '1.5 48 70'], [0.255, '0 48 70'],
        [0.32, '0 48 70'], [0.35, '1.4 48 70'], [0.38, '0 48 70'],
        [0.60, '0 48 70'], [0.63, '1.4 48 70'], [0.66, '0 48 70'],
        [0.705, '0 48 70'], [0.725, '2.2 48 70'], [0.75, '0 48 70'],
        [0.80, '0 48 70'], [0.83, '1.4 48 70'], [0.86, '0 48 70'], [1, '0 48 70']
      ], 24) +
      '<path d="M13 62 h8 M13 69 l8 -2.5 M83 62 h-8 M83 69 l-8 -2.5" fill="none" ' +
      'stroke="#a8845a" stroke-width="1.5" stroke-linecap="round"/></g>';

    // 睡着的眼睛（向下弯）
    s += '<g class="cat-eyes-sleep">' +
      _A('opacity', [[0, 1], [0.146, 1], [0.156, 0], [0.928, 0], [0.945, 1], [1, 1]], 24) +
      '<path d="M31 61 q6 5 12 0" fill="none" stroke="#4b3a2e" stroke-width="2.3" ' +
      'stroke-linecap="round"/>' +
      '<path d="M53 61 q6 5 12 0" fill="none" stroke="#4b3a2e" stroke-width="2.3" ' +
      'stroke-linecap="round"/></g>';

    // 睁着的眼睛（气泡猫的圆眼珠；会眨）
    s += '<g class="cat-eyes-open" opacity="0">' +
      _A('opacity', [[0, 0], [0.155, 0], [0.162, 1], [0.168, 1], [0.176, 0],
        [0.248, 0], [0.256, 1], [0.272, 1], [0.28, 0],
        [0.54, 0], [0.548, 1], [0.746, 1], [0.755, 0],
        [0.93, 0], [1, 0]], 24) +
      '<g transform="translate(48 61)"><g>' +
      _T('scale', [[0, '1 1'], [0.595, '1 1'], [0.600, '1 .1'], [0.607, '1 .1'],
        [0.612, '1 1'], [0.695, '1 1'], [0.700, '1 .1'], [0.707, '1 .1'],
        [0.712, '1 1'], [1, '1 1']], 24) +
      '<g transform="translate(-48 -61)">' +
        '<g class="cat-pupil-l">' +
        _T('translate', [[0, '0 0'], [0.548, '0 0'], [0.565, '-1.4 -.6'],
          [0.60, '1.5 -.8'], [0.64, '-1 -.4'], [0.675, '0 0'], [0.70, '1.8 0'],
          [0.72, '0 0'], [0.746, '0 0'], [1, '0 0']], 24) +
        '<circle cx="37" cy="61" r="4.6" fill="#4b3a2e"/>' +
        '<circle cx="35.5" cy="59.3" r="1.5" fill="#fff"/></g>' +
        '<g class="cat-pupil-r">' +
        _T('translate', [[0, '0 0'], [0.548, '0 0'], [0.565, '1.4 -.6'],
          [0.60, '-1.5 -.8'], [0.64, '1 -.4'], [0.675, '0 0'], [0.70, '-1.8 0'],
          [0.72, '0 0'], [0.746, '0 0'], [1, '0 0']], 24) +
        '<circle cx="59" cy="61" r="4.6" fill="#4b3a2e"/>' +
        '<circle cx="57.5" cy="59.3" r="1.5" fill="#fff"/></g>' +
      '</g></g></g></g>';

    // 开心的眯眼（舔爪 / 踩奶 / 洗脸）
    s += '<g class="cat-eyes-happy" opacity="0">' +
      _A('opacity', [[0, 0], [0.28, 0], [0.288, 1], [0.535, 1], [0.545, 0],
        [0.765, 0], [0.775, 1], [0.852, 1], [0.862, 0], [1, 0]], 24) +
      '<path d="M31 62 q6 -5 12 0" fill="none" stroke="#4b3a2e" stroke-width="2.3" ' +
      'stroke-linecap="round"/>' +
      '<path d="M53 62 q6 -5 12 0" fill="none" stroke="#4b3a2e" stroke-width="2.3" ' +
      'stroke-linecap="round"/></g>';

    // 打哈欠时挤起来的眼睛
    s += '<g class="cat-eyes-squint" opacity="0">' +
      _A('opacity', [[0, 0], [0.176, 0], [0.184, 1], [0.246, 1], [0.256, 0],
        [0.866, 0], [0.874, 1], [0.92, 1], [0.929, 0], [1, 0]], 24) +
      '<path d="M31 61 q6 -5 12 0" fill="none" stroke="#4b3a2e" stroke-width="2.5" ' +
      'stroke-linecap="round"/>' +
      '<path d="M53 61 q6 -5 12 0" fill="none" stroke="#4b3a2e" stroke-width="2.5" ' +
      'stroke-linecap="round"/>' +
      '<path d="M29 57 l-2 -1.5 M67 57 l2 -1.5" fill="none" stroke="#4b3a2e" ' +
      'stroke-width="1.2" opacity=".55" stroke-linecap="round"/></g>';

    // 鼻子 + 平时的小嘴
    s += '<path d="M44.5 67.5 L51.5 67.5 L48 71.5 Z" fill="#f2a3a0"/>' +
      '<g class="cat-mouth-rest">' +
      _A('opacity', [[0, 1], [0.17, 1], [0.178, 0], [0.241, 0], [0.249, 1],
        [0.859, 1], [0.868, 0], [0.92, 0], [0.929, 1], [1, 1]], 24) +
      '<path d="M48 71.5 v2.2 M48 73.7 q-3.6 3.4 -6.6 0 M48 73.7 q3.6 3.4 6.6 0" ' +
      'fill="none" stroke="#4b3a2e" stroke-width="1.7" stroke-linecap="round"/></g>';

    // 打哈欠的嘴（两段：伸懒腰时 + 睡前）
    s += '<g class="cat-yawn" opacity="0">' +
      _A('opacity', [[0, 0], [0.17, 0], [0.178, 1], [0.238, 1], [0.248, 0],
        [0.86, 0], [0.87, 1], [0.918, 1], [0.929, 0], [1, 0]], 24) +
      '<g transform="translate(48 74)"><g>' +
      _T('scale', [[0, '.6 .35'], [0.178, '.6 .35'], [0.19, '.85 .75'], [0.20, '1 1'],
        [0.23, '1 1.08'], [0.238, '.8 .6'], [0.248, '.6 .35'],
        [0.87, '.6 .35'], [0.88, '.9 .8'], [0.89, '1 1'], [0.915, '1 1.05'],
        [0.92, '.8 .6'], [0.929, '.6 .35'], [1, '.6 .35']], 24) +
      '<path d="M-7 -1 Q0 -3.4 7 -1 Q8 2.6 0 5 Q-8 2.6 -7 -1 Z" fill="#7e4147" ' +
      'stroke="#5f2f36" stroke-width=".9"/>' +
      '<ellipse cx="0" cy="2.9" rx="4.4" ry="1.8" fill="#e79aa0"/>' +
      '</g></g></g>';

    // 舔爪时伸出来的小舌头（朝右下，碰到抬起的肉垫）
    s += '<g class="cat-tongue" opacity="0" transform="translate(48 74) rotate(30)">' +
      _A('opacity', [[0, 0], [0.306, 0], [0.313, 1], [0.373, 1], [0.381, 0], [1, 0]], 24) +
      '<g><animateTransform attributeName="transform" type="scale" ' +
      'values=".7 .55;.7 .55;1.05 1.15;.7 .55;1.05 1.15;.7 .55;1.05 1.15;.7 .55" ' +
      'keyTimes="0;.315;.322;.33;.338;.346;.354;.362" dur="24s" repeatCount="indefinite"/>' +
      '<path d="M-3.2 0 Q0 -1.8 3.2 0 Q4 7.4 0 9.2 Q-4 7.4 -3.2 0 Z" fill="#f4a7ad" ' +
      'stroke="#d97f8a" stroke-width=".85" stroke-linejoin="round"/>' +
      '<path d="M0 .8 v6.4" stroke="#dc8e95" stroke-width=".7" opacity=".7"/></g></g>';

    // 点下去瞪大的眼睛（只在蹦起那一下）
    s += '<g class="cat-eyes-pop" opacity="0">' +
      '<animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.2;.7;1" ' +
      'dur=".55s" begin="wsCatJump.begin" fill="freeze"/>' +
      '<ellipse cx="37" cy="60" rx="8" ry="9" fill="#fffef5" stroke="#3a2a1c" ' +
      'stroke-width="1.2"/>' +
      '<ellipse cx="59" cy="60" rx="8" ry="9" fill="#fffef5" stroke="#3a2a1c" ' +
      'stroke-width="1.2"/>' +
      '<circle cx="37" cy="61" r="3.6" fill="#4b3a2e"/>' +
      '<circle cx="59" cy="61" r="3.6" fill="#4b3a2e"/>' +
      '<circle cx="35" cy="58" r="1.7" fill="#fff"/>' +
      '<circle cx="57" cy="58" r="1.7" fill="#fff"/></g>';

    s += '</g></g></g>';   // /face /head-tilt /head

    // ── 近侧前腿（抬起来舔爪 / 洗脸）────────────────────────────────
    s += '<g class="cat-arm-lift">' +
      _T('rotate', [
        [0, '0 -4 10'], [0.272, '0 -4 10'], [0.288, '12 -4 10'], [0.305, '76 -4 10'],
        [0.375, '76 -4 10'], [0.388, '22 -4 10'], [0.398, '0 -4 10'],
        [0.405, '0 -4 10'], [0.418, '-14 -4 10'], [0.432, '10 -4 10'],
        [0.446, '-14 -4 10'], [0.460, '10 -4 10'], [0.474, '-14 -4 10'],
        [0.488, '10 -4 10'], [0.502, '-14 -4 10'], [0.516, '10 -4 10'],
        [0.53, '0 -4 10'],
        [0.752, '0 -4 10'], [0.772, '92 -4 10'],
        [0.788, '90 -4 10'], [0.803, '96 -4 10'], [0.818, '89 -4 10'],
        [0.833, '95 -4 10'], [0.847, '92 -4 10'],
        [0.86, '12 -4 10'], [0.872, '0 -4 10'], [1, '0 -4 10']
      ], 24) +
      '<g class="cat-arm-stretch">' +
      _T('translate', [
        [0, '0 0'], [0.155, '0 0'], [0.195, '-7 0'], [0.213, '-15 1'],
        [0.248, '-15 1'], [0.26, '-6 0'], [0.274, '0 0'], [1, '0 0']
      ], 24) +
      '<path d="M -4 11 C -7 15 -9 18 -10 21" fill="none" stroke="#a8845a" ' +
      'stroke-width="12" stroke-linecap="round"/>' +
      '<path d="M -4 11 C -7 15 -9 18 -10 21" fill="none" stroke="#fffaf0" ' +
      'stroke-width="9.6" stroke-linecap="round"/>' +
      '<ellipse cx="-11" cy="22" rx="7.6" ry="5.6" fill="#fffaf0" stroke="#a8845a" ' +
      'stroke-width="1.8"/>' +
      '<path d="M -16 20 q 2.4 -2 4.8 0 M -11 19.6 q 2.4 -2 4.8 0" fill="none" ' +
      'stroke="#c7a476" stroke-width="1.2" stroke-linecap="round"/>' +
      // 抬起来才看得到的肉垫
      '<g class="cat-paw-pad" opacity="0">' +
        _A('opacity', [[0, 0], [0.30, 0], [0.312, 1], [0.38, 1], [0.392, 0],
          [0.772, 0], [0.782, 1], [0.85, 1], [0.862, 0], [1, 0]], 24) +
        '<ellipse cx="-10.5" cy="23.4" rx="3.4" ry="2.7" fill="#f3b4ad"/>' +
        '<circle cx="-13.5" cy="20.6" r="1.35" fill="#f3b4ad"/>' +
        '<circle cx="-9.4" cy="19.4" r="1.35" fill="#f3b4ad"/>' +
        '<circle cx="-5.8" cy="21" r="1.35" fill="#f3b4ad"/>' +
      '</g></g></g>';

    // 踩奶时爪子边冒出的小星星
    s += '<g class="cat-paw-spark" pointer-events="none" fill="#ffe7a8" opacity="0">' +
      _A('opacity', [[0, 0], [0.398, 0], [0.406, 1], [0.528, 1], [0.538, 0], [1, 0]], 24) +
      '<path d="M-24 12 l1.6 4 4 1.6 -4 1.6 -1.6 4 -1.6 -4 -4 -1.6 4 -1.6 Z">' +
        '<animate attributeName="opacity" values=".9;.4;.9" keyTimes="0;.5;1" ' +
        'dur="1.3s" repeatCount="indefinite"/></path>' +
      '<path d="M-2 8 l1.3 3.2 3.2 1.3 -3.2 1.3 -1.3 3.2 -1.3 -3.2 -3.2 -1.3 ' +
      '3.2 -1.3 Z">' +
        '<animate attributeName="opacity" values=".35;.95;.35" keyTimes="0;.5;1" ' +
        'dur="1.6s" repeatCount="indefinite"/></path>' +
      '<path d="M-14 -6 l1.1 2.8 2.8 1.1 -2.8 1.1 -1.1 2.8 -1.1 -2.8 -2.8 -1.1 ' +
      '2.8 -1.1 Z">' +
        '<animate attributeName="opacity" values=".8;0;.8" keyTimes="0;.5;1" ' +
        'dur="1.9s" repeatCount="indefinite"/></path></g>';

    // Zzz（睡着时才有）
    s += '<g class="cat-zzz" pointer-events="none" fill="#ffe9b8" font-family="serif" ' +
      'font-weight="bold">' +
      _A('opacity', [[0, 1], [0.142, 1], [0.158, 0], [0.933, 0], [0.952, 1], [1, 1]], 24) +
      '<text x="-58" y="-62" font-size="12" text-anchor="middle">Z' +
        '<animate attributeName="opacity" values="0;.85;.85;0" keyTimes="0;.18;.72;1" ' +
        'dur="4.6s" begin="-1.5s" repeatCount="indefinite"/>' +
        '<animateTransform attributeName="transform" type="translate" values="0 0;7 -11" ' +
        'dur="4.6s" begin="-1.5s" repeatCount="indefinite"/></text>' +
      '<text x="-50" y="-78" font-size="15" text-anchor="middle">Z' +
        '<animate attributeName="opacity" values=".9;.9;0;.9" keyTimes="0;.2;.7;1" ' +
        'dur="5.4s" begin="-3.1s" repeatCount="indefinite"/>' +
        '<animateTransform attributeName="transform" type="translate" values="0 0;8 -12" ' +
        'dur="5.4s" begin="-3.1s" repeatCount="indefinite"/></text>' +
      '<text x="-42" y="-94" font-size="18" text-anchor="middle">Z' +
        '<animate attributeName="opacity" values="0;.95;.95;0" keyTimes="0;.15;.7;1" ' +
        'dur="6.1s" begin="-4.6s" repeatCount="indefinite"/>' +
        '<animateTransform attributeName="transform" type="translate" values="0 0;9 -14" ' +
        'dur="6.1s" begin="-4.6s" repeatCount="indefinite"/></text></g>';

    // 身边偶尔闪的小星星
    s += '<g class="cat-spark" pointer-events="none" fill="#ffe7a8">' +
      '<path d="M 62 -46 l 2.2 5.6 5.6 2.2 -5.6 2.2 -2.2 5.6 -2.2 -5.6 -5.6 -2.2 ' +
      '5.6 -2.2 Z" opacity="0">' +
        '<animate attributeName="opacity" values="0;0;.9;0;0" keyTimes="0;.45;.50;.57;1" ' +
        'dur="6.2s" repeatCount="indefinite"/></path>' +
      '<path d="M -72 -40 l 1.7 4.4 4.4 1.7 -4.4 1.7 -1.7 4.4 -1.7 -4.4 -4.4 -1.7 ' +
      '4.4 -1.7 Z" opacity="0">' +
        '<animate attributeName="opacity" values="0;0;.8;0;0" keyTimes="0;.24;.29;.36;1" ' +
        'dur="7.4s" repeatCount="indefinite"/></path>' +
      '<path d="M 34 14 l 1.5 3.8 3.8 1.5 -3.8 1.5 -1.5 3.8 -1.5 -3.8 -3.8 -1.5 ' +
      '3.8 -1.5 Z" opacity="0">' +
        '<animate attributeName="opacity" values="0;0;.75;0;0" keyTimes="0;.63;.68;.75;1" ' +
        'dur="8.1s" repeatCount="indefinite"/></path></g>';

    // 点击时冒出来的两颗爱心
    s += '<g class="cat-hearts" pointer-events="none">' +
      '<g transform="translate(-16,-56)"><path d="M 0 4 C -8 -4 -14 -10 -7 -14 ' +
      'C -3 -16 0 -12 0 -10 C 0 -12 3 -16 7 -14 C 14 -10 8 -4 0 4 Z" fill="#f18b9b" ' +
      'stroke="#d96f80" stroke-width="1" opacity="0">' +
        '<animate attributeName="opacity" values="0;.95;.95;0" keyTimes="0;.2;.65;1" ' +
        'dur=".65s" begin="wsCatJump.begin" fill="freeze"/>' +
        '<animateTransform attributeName="transform" type="translate" values="0 0;-2 -24" ' +
        'dur=".65s" begin="wsCatJump.begin" fill="freeze"/></path></g>' +
      '<g transform="translate(14,-64)"><path d="M 0 3.4 C -6.8 -3.4 -12 -8.5 -6 -12 ' +
      'C -2.6 -13.6 0 -10.2 0 -8.5 C 0 -10.2 2.6 -13.6 6 -12 C 12 -8.5 6.8 -3.4 0 3.4 Z" ' +
      'fill="#f7a8b4" stroke="#d96f80" stroke-width=".9" opacity="0">' +
        '<animate attributeName="opacity" values="0;.9;.9;0" keyTimes="0;.25;.7;1" ' +
        'dur=".7s" begin="wsCatJump.begin" fill="freeze"/>' +
        '<animateTransform attributeName="transform" type="translate" values="0 0;4 -20" ' +
        'dur=".7s" begin="wsCatJump.begin" fill="freeze"/></path></g></g>';

    s += '</g></g></g></g></g></g>';   // /hearts /sway /breathe /tilt /jump /cat
    return s;
  };

  // 环境动效 ✓ —— 用户要的「整体更生动」：暖光在呼吸、空气里的灰尘在飘、
  //   偶尔落两片花瓣 ✓。全部 `pointer-events:none` ✓，不会抢账本/猫的点击 ✓。
  const _fxMote = function (x, y, r, dur, begin, dx, dy) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#ffe9a8" opacity="0">' +
      '<animate attributeName="opacity" values="0;.55;0" keyTimes="0;.5;1" dur="' +
      dur + 's" begin="' + begin + 's" repeatCount="indefinite"/>' +
      '<animateTransform attributeName="transform" type="translate" values="0 0;' +
      dx + ' ' + dy + ';' + (dx * 2) + ' ' + (dy * 2) + '" keyTimes="0;.5;1" dur="' +
      dur + 's" begin="' + begin + 's" repeatCount="indefinite"/></circle>';
  };
  // 空气里被光照亮的大颗光斑 ✓（径向渐变，不用滤镜 ✓ 手机上省 ✓）
  const _fxBokeh = function (x, y, r, dur, begin, dx, dy) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="url(#wsBokeh)" opacity="0">' +
      '<animate attributeName="opacity" values="0;.58;.3;0" keyTimes="0;.22;.62;1" dur="' +
      dur + 's" begin="' + begin + 's" repeatCount="indefinite"/>' +
      '<animateTransform attributeName="transform" type="translate" values="0 0;' +
      dx + ' ' + dy + ';' + (dx * 1.7) + ' ' + (dy * 1.5) + '" keyTimes="0;.55;1" dur="' +
      dur + 's" begin="' + begin + 's" repeatCount="indefinite"/></circle>';
  };
  // 萤火 ✓ —— 一小团暖光，慢慢飘、慢慢明灭 ✓
  const _fxFirefly = function (x, y, r, dur, begin, dx, dy) {
    return '<g opacity="0">' +
      '<animate attributeName="opacity" values="0;.9;.22;.85;0" keyTimes="0;.2;.46;.72;1" dur="' +
      dur + 's" begin="' + begin + 's" repeatCount="indefinite"/>' +
      '<animateTransform attributeName="transform" type="translate" values="0 0;' +
      dx + ' ' + dy + ';' + (dx * .4) + ' ' + (dy * 1.6) + ';' + (dx * 1.5) + ' ' + (dy * .5) +
      '" keyTimes="0;.3;.66;1" dur="' + dur + 's" begin="' + begin + 's" ' +
      'repeatCount="indefinite"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="' + (r * 3.4) + '" fill="url(#wsFly)"/>' +
      '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#fff6cf" opacity=".9"/></g>';
  };
  // 花瓣 ✓ —— 带一点左右摇曳 ✓；fall = 整段下落多远 ✓（高的那两片从窗光里穿下来 ✓）
  const _fxPetal = function (x, y, rx, ry, fill, dur, begin, fall) {
    const f = fall || 420;
    return '<g opacity="0">' +
      '<animate attributeName="opacity" values="0;.78;.78;0" keyTimes="0;.12;.88;1" dur="' +
      dur + 's" begin="' + begin + 's" repeatCount="indefinite"/>' +
      '<animateTransform attributeName="transform" type="translate" values="' +
      x + ' ' + y + ';' + (x + 14) + ' ' + (y + f * .34) + ';' +
      (x - 10) + ' ' + (y + f * .68) + ';' + (x + 8) + ' ' + (y + f) +
      '" keyTimes="0;.34;.68;1" dur="' + dur + 's" begin="' + begin + 's" ' +
      'repeatCount="indefinite"/>' +
      '<ellipse cx="0" cy="0" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '">' +
      '<animateTransform attributeName="transform" type="rotate" values="0;-90;-190;-290" ' +
      'keyTimes="0;.34;.68;1" dur="' + dur + 's" begin="' + begin + 's" ' +
      'repeatCount="indefinite"/></ellipse></g>';
  };
  const flatFxSvg = function () {
    return '' +
      // 窗光落在地上的一整片暖意 ✓ —— 几层叠着慢慢明暗 ✓
      '<ellipse cx="305" cy="500" rx="430" ry="380" fill="url(#wsWarm)" opacity=".06">' +
      '<animate attributeName="opacity" values=".04;.09;.04" dur="8s" ' +
      'repeatCount="indefinite"/></ellipse>' +
      // 两束斜斜落下来的窗光 ✓ —— 拉长 + 微微旋转 ✓，像真的从窗口斜下来 ✓
      '<ellipse cx="278" cy="1010" rx="140" ry="470" fill="url(#wsWarm)" opacity=".09" ' +
      'transform="rotate(10 278 1010)">' +
      '<animate attributeName="opacity" values=".05;.11;.05" dur="11s" begin="-3.4s" ' +
      'repeatCount="indefinite"/></ellipse>' +
      '<ellipse cx="438" cy="1050" rx="100" ry="430" fill="url(#wsWarm)" opacity=".08" ' +
      'transform="rotate(15 438 1050)">' +
      '<animate attributeName="opacity" values=".04;.09;.04" dur="9.4s" begin="-6.1s" ' +
      'repeatCount="indefinite"/></ellipse>' +
      '<ellipse cx="380" cy="1290" rx="315" ry="135" fill="url(#wsWarm)" opacity=".08">' +
      '<animate attributeName="opacity" values=".05;.1;.05" dur="7.6s" begin="-1.8s" ' +
      'repeatCount="indefinite"/></ellipse>' +
      // 空气里被光照亮的小光斑 ✓（大颗、很淡 ✓）
      _fxBokeh(250, 700, 10, 13, -2.6, 16, -34) +
      _fxBokeh(392, 618, 7, 10.5, -7.2, -12, -26) +
      _fxBokeh(472, 792, 12, 14.5, -4.4, 14, -40) +
      _fxBokeh(300, 946, 9, 12, -9.1, -10, -30) +
      _fxBokeh(548, 968, 6.5, 11.2, -1.6, 18, -24) +
      _fxBokeh(206, 1082, 8, 15, -6.8, 12, -36) +
      _fxBokeh(622, 884, 10, 12.8, -3.1, -14, -28) +
      _fxBokeh(438, 1176, 7, 13.6, -8.4, 10, -22) +
      // 空气里的浮尘 ✓
      _fxMote(300, 860, 3, 11, -3.2, 14, -34) +
      _fxMote(420, 940, 2.4, 9.5, -6.1, -10, -28) +
      _fxMote(520, 820, 2.8, 13, -1.4, 12, -40) +
      _fxMote(240, 1000, 2.2, 12, -8.3, -8, -26) +
      _fxMote(620, 960, 2.6, 10.5, -4.7, 16, -30) +
      _fxMote(700, 1120, 2.2, 14, -9.6, -12, -36) +
      _fxMote(360, 1120, 2, 15, -7.2, 10, -22) +
      _fxMote(540, 1060, 2.6, 11.8, -2.1, 18, -32) +
      // 飘落的花瓣 ✓ —— 高的那两片从窗光里穿下来 ✓
      _fxPetal(250, 980, 7, 3.2, '#e9a7a4', 15, -6, 460) +
      _fxPetal(650, 960, 6, 2.8, '#f0c4bb', 18, -11, 430) +
      _fxPetal(430, 1010, 6.5, 3, '#e3a4a2', 13, -2.5, 380) +
      _fxPetal(302, 350, 6, 2.6, '#f2b8b4', 26, -9, 1030) +
      _fxPetal(455, 292, 5.5, 2.4, '#e8a7ab', 30, -17, 1060) +
      // 地毯附近的萤火 ✓（在猫后面 ✓）
      _fxFirefly(560, 1322, 2.2, 7.2, -2.4, -12, -10) +
      _fxFirefly(792, 1300, 1.8, 8.6, -5.1, -16, 8) +
      _fxFirefly(262, 1392, 2, 9.4, -7.3, 14, -12);
  };
  const flatFgFxSvg = function () {
    // 前景的两只萤火 ✓ —— 压在猫上面 ✓，近处更亮 ✓（有前后层，画面才深 ✓）
    return _fxFirefly(646, 1382, 1.7, 6.8, -1.2, -9, 12) +
      _fxFirefly(776, 1470, 2, 8.2, -4.6, -14, -8);
  };

  // 一只来找二狗玩的小蝴蝶 ✓ —— 和猫同一条 **24 秒** 时间轴 ✓：
  //   14 秒左右飞进来 → 绕脑袋一圈 → 17.5 秒停在鼻尖前 → 猫一甩头它就跑 ✓。
  //   用 SMIL ✓（WebView 里比 CSS transform 稳 ✓）；pointer-events:none ✓ 不挡点击。
  const flatButterflySvg = function () {
    const wing = function (dir) {
      const px = dir * 2.2, py = -3.2;
      return '<g transform="translate(' + px + ',' + py + ')"><g>' +
        '<animateTransform attributeName="transform" type="scale" ' +
        'values="1 1;.28 1;1 1;.28 1;1 1" dur=".26s" repeatCount="indefinite"/>' +
        '<ellipse cx="' + (dir * 4.8) + '" cy="-1.6" rx="5.6" ry="4.4" fill="#f3b3bc" ' +
        'stroke="#c4868f" stroke-width=".85" transform="rotate(' + (dir * -16) + ' ' +
        (dir * 4.8) + ' -1.6)"/>' +
        '<ellipse cx="' + (dir * 3.8) + '" cy="3.6" rx="3.9" ry="3.1" fill="#ffe4bd" ' +
        'stroke="#c4868f" stroke-width=".75" transform="rotate(' + (dir * 12) + ' ' +
        (dir * 3.8) + ' 3.6)"/>' +
        '<circle cx="' + (dir * 5.4) + '" cy="-2.6" r="1.15" fill="#ffe9cf" opacity=".85"/>' +
      '</g></g>';
    };
    return '<g class="ws-butterfly" pointer-events="none">' +
      '<animateTransform attributeName="transform" type="translate" ' +
      'values="470 1560;470 1560;535 1512;572 1478;600 1445;610 1405;625 1372;' +
      '668 1358;704 1374;708 1408;684 1432;662 1437;660 1438;663 1438;' +
      '680 1415;724 1380;782 1332;838 1288;884 1256" ' +
      'keyTimes="0;.575;.596;.612;.629;.646;.6625;.679;.696;.708;.717;.723;' +
      '.729;.7375;.748;.758;.775;.792;1" ' +
      'dur="24s" repeatCount="indefinite"/>' +
      '<g opacity="0" transform="scale(1.3)">' +
        '<animate attributeName="opacity" values="0;0;1;1;0;0" ' +
        'keyTimes="0;.588;.602;.782;.798;1" dur="24s" repeatCount="indefinite"/>' +
        '<ellipse cx="0" cy="0" rx="11" ry="9" fill="url(#wsBokeh)" opacity=".45"/>' +
        wing(-1) + wing(1) +
        '<ellipse cx="0" cy="1.4" rx="1.5" ry="4.6" fill="#6f5138"/>' +
        '<circle cx="0" cy="-3.6" r="1.9" fill="#6f5138"/>' +
        '<path d="M -1 -5 q -3 -4 -5 -5 M 1 -5 q 3 -4 5 -5" fill="none" ' +
        'stroke="#6f5138" stroke-width=".8" stroke-linecap="round"/>' +
      '</g></g>';
  };

  // ── 屋子会长（2026-10-29）────────────────────────────────────────
  // ★ 屋里**用过什么，就多出点什么** ✓ —— 三样，都是**只加、不藏** ✓：
  //   · 记过一笔账 → 桌角多一只**攒硬币的玻璃罐** ✓
  //   · 设过一个提醒 → 桌上多一只**黄铜小闹钟** ✓
  //   · 钉过一张回忆 → 墙上多**两张拍立得** ✓
  // ⚠️ 屋里原本那本账 / 那只挂钟 / 那幅画**照旧都在** ✓ —— 那是**入口** ✓，
  //   藏起来就少了一个入口 ✓。这里加的是"用过之后留下的痕迹" ✓。
  // ⚠️ **一个数都不存** ✓ —— 每次从 `/digest` 现数 ✓（管家面板走同一个口子 ✓）。
  // ⚠️ 这个文件里**不写模板字符串** ✓（见 2150 那段注释那个坑 ✓）。
  let houseGrow = null;        // { records, reminders, memories } ✓；null = 还没数上来 ✓

  const growFade = '<animate attributeName="opacity" from="0" to="1" ' +
    'dur=".6s" begin=".15s" fill="freeze"/>';

  // 攒硬币的玻璃罐 ✓ —— 桌角、那摞书左边 ✓（书 210..305 ✓，罐子 152..208 ✓）
  const coinJarSvg = function () {
    return '<g opacity="0" pointer-events="none">' + growFade +
      '<ellipse cx="180" cy="1029" rx="27" ry="5.5" fill="#6a4530" opacity=".16"/>' +
      // 罐身
      '<path d="M160 986 q-4 6 -4 12 v18 q0 8 6 8 h32 q6 0 6 -8 v-18 q0 -6 -4 -12 z" ' +
        'fill="#fffdf7" fill-opacity=".6" stroke="#c1a073" stroke-width="1.4"/>' +
      // 硬币
      '<ellipse cx="172" cy="1017" rx="8" ry="4" fill="#e8c07a" stroke="#b98c48" stroke-width="1"/>' +
      '<ellipse cx="172" cy="1012" rx="8" ry="4" fill="#f0cf94" stroke="#b98c48" stroke-width="1"/>' +
      '<ellipse cx="188" cy="1016" rx="6.4" ry="3.4" fill="#e8c07a" stroke="#b98c48" stroke-width="1"/>' +
      '<ellipse cx="182" cy="1020" rx="5.4" ry="2.8" fill="#f0cf94" stroke="#b98c48" stroke-width=".9"/>' +
      // 瓶口 + 软木塞
      '<rect x="161" y="976" width="38" height="12" rx="4" fill="#f7ecd8" stroke="#c1a073" stroke-width="1.3"/>' +
      '<rect x="169" y="966" width="22" height="11" rx="3.5" fill="#d3a86f" stroke="#a97c42" stroke-width="1.2"/>' +
      // 一道高光 ✓
      '<path d="M166 992 q-2 10 1 22" fill="none" stroke="#ffffff" stroke-opacity=".85" ' +
        'stroke-width="2.4" stroke-linecap="round"/>' +
    '</g>';
  };

  // 黄铜小闹钟 ✓ —— 桌上右边 ✓（挂钟底下那块空桌面 ✓，不压火漆信 590..674 ✓）
  const brassClockSvg = function () {
    return '<g opacity="0" pointer-events="none">' + growFade +
      '<ellipse cx="723" cy="1030" rx="19" ry="4" fill="#6a4530" opacity=".16"/>' +
      // 两只小脚
      '<path d="M708 1022 l-5 9 M738 1022 l5 9" fill="none" stroke="#a97c42" ' +
        'stroke-width="2.4" stroke-linecap="round"/>' +
      // 顶上的小铃
      '<path d="M711 984 q1 -11 12 -11 q11 0 12 11 z" fill="#d8a460" stroke="#a97c42" stroke-width="1.2"/>' +
      '<path d="M715 975 q8 -8 16 0" fill="none" stroke="#a97c42" stroke-width="2.2" stroke-linecap="round"/>' +
      // 钟身 + 表盘
      '<circle cx="723" cy="1002" r="21" fill="#e8c07a" stroke="#a97c42" stroke-width="1.6"/>' +
      '<circle cx="723" cy="1002" r="15.4" fill="#fffdf7" stroke="#c8a86f" stroke-width="1"/>' +
      '<path d="M723 991 v11 M723 1002 l8 4.6" fill="none" stroke="#8d5a24" ' +
        'stroke-width="1.8" stroke-linecap="round"/>' +
      '<circle cx="723" cy="1002" r="1.9" fill="#8d5a24"/>' +
    '</g>';
  };

  // 一张拍立得 ✓（空白的 ✓ —— 照片里只画远山和太阳 ✓，跟窗外那幅景一个调子 ✓）
  const polaroidSvg = function (cx, cy, w, h, rot, sky, hill) {
    const x = cx - w / 2, y = cy - h / 2;
    const pw = w - 16, px = x + 8, py = y + 8;
    return '<g transform="rotate(' + rot + ' ' + cx + ' ' + cy + ')" opacity="0">' + growFade +
      '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3" ' +
        'fill="#fffdf7" stroke="#d9c8a4" stroke-width="1.4"/>' +
      '<rect x="' + px + '" y="' + py + '" width="' + pw + '" height="' + pw + '" fill="' + sky + '"/>' +
      '<circle cx="' + (px + pw * 0.72) + '" cy="' + (py + pw * 0.26) + '" r="' + (pw * 0.13) + '" ' +
        'fill="#ffcf7a"/>' +
      '<path d="M' + px + ' ' + (py + pw) + ' L' + (px + pw * 0.28) + ' ' + (py + pw * 0.56) +
        ' L' + (px + pw * 0.52) + ' ' + (py + pw * 0.84) + ' L' + (px + pw * 0.74) + ' ' + (py + pw * 0.5) +
        ' L' + (px + pw) + ' ' + (py + pw) + ' Z" fill="' + hill + '"/>' +
      // 顶上那道胶带 ✓
      '<rect x="' + (cx - 13) + '" y="' + (y - 6) + '" width="26" height="12" rx="1.5" ' +
        'fill="#e2c48c" opacity=".55"/>' +
    '</g>';
  };

  // 两张拍立得 ✓ —— 挂在**画框下面**那面空墙 ✓（画框 632..840 × 538..702 ✓）
  const polaroidsSvg = function () {
    return polaroidSvg(706, 806, 108, 126, -3.5, '#ffe9c6', '#a9c48a') +
      polaroidSvg(776, 886, 88, 106, 4.5, '#ffdfd0', '#9dbb84');
  };

  const houseGrowSvg = function () {
    if (!houseGrow) return '';
    let s = '';
    if (houseGrow.records > 0) s += coinJarSvg();
    if (houseGrow.reminders > 0) s += brassClockSvg();
    if (houseGrow.memories > 0) s += polaroidsSvg();
    return s;
  };

  // ── 便签（2026-10-29 · 纸上小屋 5.8「小屋 · 便签」）──────────────────
  //
  // ★ 两个人贴在墙上的一句话 ✓ —— **共享** ✓（谁都能看 ✓，谁写的谁撕 ✓，
  //   闸门在 home.py 那三个接口里 ✓）。
  //   ⚠️ 设计稿 5.8 写的是「贴在桌沿」✗→ 这里挪到**窗下那面空墙** ✓：
  //      桌沿那块面板只有 ~94 个 SVG 单位高 ✓，字缩到手机上只剩 5px 左右 ✓
  //      （390pt 宽的手机 ≈ 0.53 倍 ✓），那不是便签是花纹 ✗。
  //      窗下这块空墙有 200 多单位 ✓（窗台 762 到踢脚线 1005 ✓），字能落到 ~11px ✓。
  //   ⚠️ 屋里最多画**三张** ✓（再多就成糊墙纸了 ✓）—— 要看完 / 要写 / 要撕，
  //      点一下 → openNotes() 那张弹层 ✓。
  //   ⚠️ **不进提示词、不进记忆** ✓ —— 和配饰、气泡同一档：屋子里的东西 ✓，
  //      管家不听不看 ✓。
  //   ⚠️ 这一段**不用模板字符串** ✓（规矩和上面的 SVG 一样 ✓）。
  let houseNotes = null;      // [{id,text,created_by,created_at,nickname}] ✓；null = 还没取 ✓
  const notesKey = function (a) {
    return (a || []).map(function (n) { return n.id; }).join(',');
  };
  const noteEsc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  };
  // 一行放几个字 ✓ —— 中文算 1 ✓、字母数字算 0.55 ✓（不量像素 ✓，够用 ✓）。
  //   超出行数就截断 + 省略号 ✓：屋里那张是**贴着看个大概** ✓，全文在弹层里 ✓。
  const noteBreak = function (text, per, max) {
    const out = [];
    const chars = Array.from(String(text || ''));
    let line = '', w = 0;
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      const cw = c.charCodeAt(0) > 255 ? 1 : 0.55;
      if (w + cw > per) { out.push(line); line = ''; w = 0; }
      line += c; w += cw;
    }
    if (line) out.push(line);
    if (out.length > max) {
      out.length = max;
      out[max - 1] = out[max - 1].slice(0, Math.max(1, out[max - 1].length - 1)) + '…';
    }
    return out;
  };

  const oneNoteSvg = function (n, cx, cy, rot, mine) {
    const W = 180, H = 170;
    const x = cx - W / 2, y = cy - H / 2;
    const fill = mine ? '#fbe7b2' : '#fdf8ec';
    const edge = mine ? '#e0bd76' : '#b9cf9f';
    const ink = mine ? '#6b4a1f' : '#4f5c3c';
    const soft = mine ? '#f3d894' : '#e7efdb';
    let s = '<g class="ws-note" style="cursor:pointer">' +
      // 影子 + 纸
      '<rect x="' + (x + 3) + '" y="' + (y + 4) + '" width="' + W + '" height="' + H +
        '" rx="3" fill="#6a4530" opacity=".10"/>' +
      '<rect x="' + x + '" y="' + y + '" width="' + W + '" height="' + H +
        '" rx="3" fill="' + fill + '" stroke="' + edge + '" stroke-width="1.6"/>' +
      // 右下折角
      '<path d="M' + (x + W - 26) + ' ' + (y + H) + ' h26 v-26 z" fill="' + soft +
        '" stroke="' + edge + '" stroke-width="1.2"/>' +
      // 顶上那道胶带 ✓
      '<rect x="' + (cx - 23) + '" y="' + (y - 7) + '" width="46" height="13" rx="1.5" ' +
        'fill="#e2c48c" opacity=".55" transform="rotate(-4 ' + cx + ' ' + y + ')"/>';
    const lines = noteBreak(n.text, 7, 5);
    for (let i = 0; i < lines.length; i++) {
      s += '<text x="' + (x + 14) + '" y="' + (y + 48 + i * 24) +
        '" class="ws-note-t" fill="' + ink + '">' + noteEsc(lines[i]) + '</text>';
    }
    return '<g transform="rotate(' + rot + ' ' + cx + ' ' + cy + ')">' + s + '</g>';
  };

  const houseNotesSvg = function () {
    if (!houseNotes || !houseNotes.length) return '';
    // 最新那张**贴中间** ✓（一眼先看见 ✓），旧的两张往两边让 ✓。
    //   ⚠️ 右边留到 650 为止 ✓ —— 再过去就是拍立得那块墙 ✓（652..820 ✓）。
    const SLOT = [[375, 1.4], [190, -2.2], [560, -1.4]];
    const myId = Number(me && me.id);
    let s = '';
    const n = Math.min(3, houseNotes.length);
    for (let i = 0; i < n; i++) {
      const it = houseNotes[i];
      s += oneNoteSvg(it, SLOT[i][0], 885, SLOT[i][1], Number(it.created_by) === myId);
    }
    return s;
  };

  // ── 阁楼的小门 + 绳梯（2026-10-29）✓ ───────────────────────────────
  //
  // 位置是**算过的** ✓：窗框右缘 552 ✓、闹钟左缘 652 ✓、书架顶 360 ✓ ——
  //   中间这条 x 552..652 的墙是空的 ✓（拍立得 / 便签 / 挂画都不在这一块 ✓）。
  //   梯子下端收在 **354** ✓ —— 刚好搭在书架顶上 ✓（"踩着书架爬上去" ✓），
  //   也不压书架那块热区（y ≥ 360 ✓）。
  // ⚠️ 整组 `pointer-events:none` ✓ —— 点的是盖在上面的那块透明 rect ✓
  //   （`.ws-attic` ✓，见 `buildFlatScene` ✓），别让画的东西把点击吃掉 ✗。
  // ⚠️ 绳子**轻轻晃** ✓（±1.4° ✓）—— 屋子是活的 ✓；晃的是**整组** ✓
  //   （两根绳 + 横档一起 ✓），上端钉在门口 ✓（rotate 的圆心在门框下沿 ✓）。
  const houseAtticSvg = function () {
    // 横档一根一根拼 ✓（174 → 349 ✓，间距一样 ✓）
    let rungD = '';
    for (let y = 174; y <= 349; y += 25) rungD += 'M587 ' + y + ' H621 ';
    return '<g class="ws-attic-door" pointer-events="none">' +
      // 门缝里漏下来的光 ✓ —— 最先画 ✓，垫在门框和梯子底下 ✓
      '<ellipse cx="604" cy="196" rx="74" ry="52" fill="url(#wsWarm)" opacity=".42"/>' +
      // 小房子顶 ✓ —— 这一间在**屋顶上** ✓（屋里那扇门就是它的小门 ✓）
      '<path d="M544 54 L604 12 L664 54 Z" fill="#cf8a5b" stroke="#a9683f" ' +
        'stroke-width="2.5" stroke-linejoin="round"/>' +
      '<path d="M604 20 V18" stroke="#a9683f" stroke-width="2.5" stroke-linecap="round"/>' +
      '<rect x="540" y="49" width="128" height="11" rx="5.5" fill="#b06a40"/>' +
      // 门框 ✓
      '<rect x="554" y="55" width="100" height="93" rx="8" fill="#b57b47"/>' +
      '<rect x="554" y="55" width="100" height="93" rx="8" fill="none" ' +
        'stroke="#8f5c33" stroke-width="2"/>' +
      // 门洞 ✓ —— 往上越来越暗 ✓（里面是往上走的楼梯 ✓）
      '<rect x="562" y="63" width="84" height="78" rx="6" fill="url(#wsAtticIn)"/>' +
      // 门洞里那几级**往上走的台阶** ✓（越往上越窄 ✓ = 透视 ✓）
      '<g fill="#f6d6a2">' +
        '<rect x="568" y="132" width="72" height="6" rx="3" opacity=".95"/>' +
        '<rect x="572" y="118" width="64" height="6" rx="3" opacity=".82"/>' +
        '<rect x="576" y="104" width="56" height="6" rx="3" opacity=".68"/>' +
        '<rect x="580" y="90" width="48" height="6" rx="3" opacity=".52"/>' +
      '</g>' +
      // 楼上一盏小灯 ✓（那一点暖光就是它 ✓）
      '<circle cx="604" cy="78" r="17" fill="url(#wsWarm)" opacity=".55"/>' +
      '<path d="M604 66 V73" stroke="#6b4226" stroke-width="1.6" stroke-linecap="round"/>' +
      '<circle cx="604" cy="77" r="4" fill="#ffe6b6" stroke="#a87943" stroke-width="1"/>' +
      // 门槛 ✓ —— 梯子就挂在这道边上 ✓
      '<rect x="552" y="146" width="104" height="9" rx="4.5" fill="#8f5c33"/>' +
      // 绳梯 ✓ —— 两根麻绳 + 八根横档 ✓，整体会晃 ✓
      '<g class="ws-rope">' +
        '<animateTransform attributeName="transform" type="rotate" ' +
          'values="-1.2 604 151;1.2 604 151;-1.2 604 151" ' +
          'dur="7s" repeatCount="indefinite" calcMode="spline" ' +
          'keyTimes="0;.5;1" keySplines=".45 0 .55 1;.45 0 .55 1"/>' +
        // 先压一层深色 ✓（绳子有厚度 ✓），再提一道高光 ✓
        '<g fill="none" stroke="#a87943" stroke-width="5.2" stroke-linecap="round">' +
          '<path d="M586 153 V354"/><path d="M622 153 V354"/>' +
          '<path d="' + rungD + '" stroke-width="4.6"/>' +
        '</g>' +
        '<g fill="none" stroke="#e9cf9d" stroke-width="1.6" stroke-linecap="round" opacity=".85">' +
          '<path d="M586 153 V354"/><path d="M622 153 V354"/>' +
          '<path d="' + rungD + '" stroke-width="1.3"/>' +
        '</g>' +
      '</g>' +
      // 两个绳结 ✓（挂在门槛下沿 ✓）
      '<circle cx="586" cy="153" r="3.8" fill="#a87943"/>' +
      '<circle cx="622" cy="153" r="3.8" fill="#a87943"/>' +
    '</g>';
  };

  const loadNotes = async function () {
    try {
      const d = await api('/groups/' + group.id + '/notes');
      return (d && d.items) || [];
    } catch (e) { return null; }
  };
  // ★ 数变了才重画 ✓（和屋子会长同一个规矩 ✓）。
  const refreshHouseNotes = async function () {
    const list = await loadNotes();
    if (list === null) return;                // 取不上来就按老样子画 ✓（墙照旧能点 ✓）
    const before = notesKey(houseNotes);
    houseNotes = list;
    if (before !== notesKey(houseNotes) && $('#workshop').classList.contains('on')) paintCanvas();
  };

  // 便签弹层 ✓ —— 屋里点便签、设置里点「便签」都走这一处 ✓（只有这一份实现 ✓）。
  //   ⚠️ 每贴一张 / 撕一张都**整张重画** ✓（列表短 ✓，不值得做局部更新 ✓）。
  //   ⚠️ 写完不关弹层 ✓ —— 想连写两张的人不用再点进来一次 ✓。
  const repaintHouseIfOn = function () {
    if ($('#workshop').classList.contains('on')) paintCanvas();
  };
  const renderNotesSheet = function () {
    const p = $('#sheetPanel');
    if (!p) return;
    p.innerHTML = '<h3>便签</h3><div class="nt-list" id="ntList"></div>' +
      '<div class="nt-write">' +
        '<textarea class="field nt-inp" id="ntInp" rows="2" maxlength="60" ' +
          'placeholder="写一句，贴到墙上"></textarea>' +
        '<button class="btn-solid nt-add" id="ntAdd">贴上</button>' +
      '</div>';
    const box = p.querySelector('#ntList');
    const list = houseNotes || [];
    const myId = Number(me && me.id);
    if (!list.length) {
      box.appendChild(mkel('div', 'h-empty', '墙上还空着。'));
    }
    list.forEach(function (n) {
      const mine = Number(n.created_by) === myId;
      const row = mkel('div', 'nt-row' + (mine ? ' mine' : ''));
      row.appendChild(mkel('div', 'nt-text', n.text));
      const meta = mkel('div', 'nt-meta');
      meta.appendChild(mkel('span', 'nt-who', mine ? '你' : (n.nickname || '对方')));
      row.appendChild(meta);
      // ⚠️ 「撕掉」**只在自己写的那张上露** ✓ —— 服务端也拦 ✓（403 ✓），
      //   这里藏起来只是别让人白点一下 ✓（闸门不在前端 ✓）。
      if (mine) {
        const del = mkel('button', 'nt-del', '撕掉');
        del.onclick = function () { tearNote(n); };
        row.appendChild(del);
      }
      box.appendChild(row);
    });
    const inp = p.querySelector('#ntInp');
    const add = p.querySelector('#ntAdd');
    const submit = async function () {
      const v = String(inp.value || '').replace(/\s+/g, ' ').trim();
      if (!v) { inp.focus(); return; }
      if (add.disabled) return;
      add.disabled = true;
      try {
        const out = await api('/groups/' + group.id + '/notes', {
          method: 'POST', body: JSON.stringify({ text: v }),
        });
        houseNotes = [out].concat(houseNotes || []).slice(0, 40);
        inp.value = '';
        sfx('paper'); haptic('soft');
        renderNotesSheet();
        repaintHouseIfOn();
      } catch (e) { toast(e.message || '没贴上'); }
      add.disabled = false;
    };
    add.onclick = submit;
    // 手机上在输入框里按回车 = 换行 ✓（那是对的 ✓）；
    // 想不收手就贴上的，按 Ctrl/⌘ + 回车 ✓。
    inp.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); submit(); }
    });
  };
  const tearNote = async function (n) {
    const yes = await confirmBox({
      title: '撕掉这张便签？', body: n.text || '', ok: '撕掉', danger: true,
    });
    if (!yes) return;
    try {
      await api('/groups/' + group.id + '/notes/' + n.id, { method: 'DELETE' });
      houseNotes = (houseNotes || []).filter(function (x) { return x.id !== n.id; });
      sfx('paper'); haptic('soft');
      renderNotesSheet();
      repaintHouseIfOn();
    } catch (e) { toast(e.message || '没撕下来'); }
  };
  const openNotes = async function () {
    if (!houseNotes) houseNotes = [];
    renderNotesSheet();                       // 先给壳 ✓，不等网络 ✓
    openSheet();
    const list = await loadNotes();
    if (list === null) return;
    // ⚠️ 和手里那份**一样就不重画** ✓ —— 重画会把已经打进去的字冲掉 ✓
    //   （网络慢的时候人已经开始写了 ✓）。
    const before = notesKey(houseNotes);
    houseNotes = list;
    if (before !== notesKey(houseNotes) && $('#sheetPanel').querySelector('#ntList')) {
      renderNotesSheet();
    }
    repaintHouseIfOn();
  };

  // ★ 第一次进屋的**手写标签** ✓（2026-10-29）——
  //   屋里东西不少，头一回进来未必知道哪个能点 ✓；写几个字最省事 ✓。
  //   ⚠️ 只写**东西的名字** ✓（聊天/账本/提醒/回忆/我们的家 ✓）——
  //     不写"点这里可以…"那种**说明功能的句子** ✓（他明确不要 ✓）。
  //   ⚠️ 字画在 **SVG 里** ✓ —— 摆在外层 div 上的话 `slice` 一裁就错位 ✓。
  //   ⚠️ 看一眼就够 ✓：7 秒后自己淡掉 ✓，点一下也立刻淡掉 ✓，看过就再不出现 ✓。
  const labelsKey = function () {
    const uid = me && (me.id ?? me.username);
    return (uid === undefined || uid === null || uid === '') ? '' : 'lg_house_labels:u' + uid;
  };
  const labelsSeen = function () {
    try {
      const k = labelsKey();
      return !k || localStorage.getItem(k) === '1';
    } catch (e) { return true; }
  };
  const markLabelsSeen = function () {
    try { const k = labelsKey(); if (k) localStorage.setItem(k, '1'); } catch (e) {}
  };

  // [字, 字x, 字y, 箭头起点x, 箭头起点y, 箭头终点x, 箭头终点y] ✓
  const houseLabelsSvg = function () {
    const L = [
      ['聊天',   452, 1214, 452, 1198, 452, 1096],
      ['账本',   766, 512,  744, 498,  700, 472],
      ['提醒',   715, 206,  715, 220,  715, 240],
      ['回忆',   572, 632,  596, 632,  628, 632],
      ['我们的家', 552, 1172, 560, 1158, 594, 1146],
      // ★ 2026-10-29：阁楼 ✓ —— 挂在门右边一点 ✓（那儿的墙是空的 ✓，
      //   闹钟在 y ≥ 240 ✓，字在 86 这一行压不着它 ✓）。
      ['阁楼',   704, 86,   690, 106,  656, 96],
    ];
    let s = '<g class="ws-labels" pointer-events="none">';
    for (let i = 0; i < L.length; i++) {
      const t = L[i];
      // ⚠️ 虚线**先描一道白** ✓ —— 底下的画什么颜色都有（桌面是棕的 ✓、
      //   墙是米黄的 ✓）。只画一圈琥珀，落在桌面上就跟桌面糊成一片 ✓
      //   （我照着第一版截图看出来的 ✓，聊天那条线几乎看不见 ✓）。
      const seg = 'M' + t[3] + ' ' + t[4] + ' L' + t[5] + ' ' + t[6];
      s += '<g class="ws-lbl" style="animation-delay:' + (0.45 + i * 0.12) + 's">' +
        '<path d="' + seg + '" fill="none" stroke="#fffdf7" stroke-opacity=".85" ' +
          'stroke-width="5" stroke-linecap="round" stroke-dasharray="1 7"/>' +
        '<path d="' + seg + '" fill="none" ' +
          'stroke="#a97c42" stroke-width="2.1" stroke-linecap="round" stroke-dasharray="1 7"/>' +
        '<circle cx="' + t[5] + '" cy="' + t[6] + '" r="2.6" fill="#a97c42" ' +
          'stroke="#fffdf7" stroke-width="1.4"/>' +
        '<text x="' + t[1] + '" y="' + t[2] + '" text-anchor="middle" class="ws-lbl-t">' +
          t[0] + '</text>' +
      '</g>';
    }
    return s + '</g>';
  };

  // 标签淡掉 ✓ —— 淡完再摘 ✓（`remove` 太早会"啪"地消失 ✓）
  const dropLabels = function (wrap) {
    if (!wrap) return;
    const g = wrap.querySelector('.ws-labels');
    if (!g || g.classList.contains('bye')) return;
    g.classList.add('bye');
    markLabelsSeen();
    setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 700);
  };

  const buildFlatScene = function () {
    const wrap = document.createElement('div');
    wrap.className = 'ws-scene';
    // ★ 竖幅 900×1600（贴手机竖屏 ✓）。preserveAspectRatio **slice** ✓ ——
    //   场景按高度铺满、左右对称裁边 ✓，不产生滚动 ✓。
    //   ⚠️ 画面里的关键东西都留在 x=90..810 内 ✓（20:9 的手机也不会裁到它们✓）。
    const svg = _svg('svg', { viewBox: '0 0 900 1600',
      preserveAspectRatio: 'xMidYMid slice', class: 'ws-flat' });
    svg.innerHTML =
      // ★ 猫用到的渐变/滤镜 ✓（id 都带 ws 前缀 ✓，不和屋里的 rb* 撞 ✓）
      '<defs>' +
        '<filter id="wsSoft" x="-30%" y="-60%" width="160%" height="220%">' +
          '<feGaussianBlur stdDeviation="5"/></filter>' +
        '<radialGradient id="wsCatFur" cx="38%" cy="26%" r="78%">' +
          '<stop offset="0" stop-color="#fffdf8"/><stop offset=".62" stop-color="#f7e9cf"/>' +
          '<stop offset="1" stop-color="#ecd8b4"/></radialGradient>' +
        '<radialGradient id="wsCatHead" cx="42%" cy="26%" r="80%">' +
          '<stop offset="0" stop-color="#fffefb"/><stop offset=".62" stop-color="#fdf3df"/>' +
          '<stop offset="1" stop-color="#f2dfbe"/></radialGradient>' +
        '<radialGradient id="wsWarm" cx="50%" cy="50%" r="50%">' +
          '<stop offset="0" stop-color="#ffe3a0" stop-opacity=".9"/>' +
          '<stop offset=".6" stop-color="#ffe3a0" stop-opacity=".35"/>' +
          '<stop offset="1" stop-color="#ffe3a0" stop-opacity="0"/></radialGradient>' +
        '<radialGradient id="wsBokeh" cx="50%" cy="50%" r="50%">' +
          '<stop offset="0" stop-color="#fff4cf" stop-opacity=".7"/>' +
          '<stop offset=".45" stop-color="#ffe7ad" stop-opacity=".28"/>' +
          '<stop offset="1" stop-color="#ffdc94" stop-opacity="0"/></radialGradient>' +
        '<radialGradient id="wsFly" cx="50%" cy="50%" r="50%">' +
          '<stop offset="0" stop-color="#fffbe6" stop-opacity=".95"/>' +
          '<stop offset=".3" stop-color="#ffe9a8" stop-opacity=".6"/>' +
          '<stop offset="1" stop-color="#ffd678" stop-opacity="0"/></radialGradient>' +
        '<radialGradient id="wsCatGlow" cx="50%" cy="50%" r="50%">' +
          '<stop offset="0" stop-color="#ffdda0" stop-opacity=".55"/>' +
          '<stop offset=".65" stop-color="#ffd18a" stop-opacity=".2"/>' +
          '<stop offset="1" stop-color="#ffc878" stop-opacity="0"/></radialGradient>' +
        '<radialGradient id="wsDream" cx="50%" cy="47%" r="74%">' +
          '<stop offset="0" stop-color="#fff6e0" stop-opacity="0"/>' +
          '<stop offset=".72" stop-color="#f6dfba" stop-opacity="0"/>' +
          '<stop offset="1" stop-color="#7a4a2e" stop-opacity=".1"/></radialGradient>' +
        // ★ 2026-10-29：阁楼门洞里那道光 ✓（下亮上暗 ✓ —— 看着像**往上**去 ✓）
        '<linearGradient id="wsAtticIn" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0" stop-color="#7d4e2a"/>' +
          '<stop offset=".55" stop-color="#c08a4e"/>' +
          '<stop offset="1" stop-color="#f3cd93"/>' +
        '</linearGradient>' +
      '</defs>' +
      // ★ 内层 <image> 用 **meet**（不是 slice！）✓ —— 图本身 900×1600，
      //   放进同尺寸盒子是 1:1 精确贴合，meet 即满、slice 在某些 WebView 上
      //   会把 <image> 渲成黑块/不铺满 ✗（实测黑边根因 ✓）。真正填满屏幕的是
      //   **外层 svg 的 slice** ✓，内层只管把图原样贴进 viewBox。
      '<image href="/static/flat-room.svg" x="0" y="0" width="900" height="1600" ' +
        'preserveAspectRatio="xMidYMid meet"/>' +
      // ★ 屋子会长（2026-10-29）✓ —— 用过才长出来的三样 ✓（压在屋子图上、环境光下面 ✓）
      '<g pointer-events="none">' + houseGrowSvg() + '</g>' +
      // ★ 阁楼的小门 + 绳梯（2026-10-29）✓ —— 压在屋子图上 ✓、光/尘下面 ✓
      //   （尘和暗角盖过去一点才像屋里的一件东西 ✓，不像贴上去的 ✗）。
      houseAtticSvg() +
      // ★ 便签（2026-10-29）✓ —— 贴在窗下那面空墙上 ✓；**能点** ✓（不裹在
      //   pointer-events:none 里 ✓），点一下 = 看全部 / 写一张 / 撕掉 ✓。
      houseNotesSvg() +
      // 环境动效（光/尘/花瓣）✓ 压在屋子上、猫下面 ✓
      '<g pointer-events="none">' + flatFxSvg() + '</g>' +
      // ★ 2026-10-28：桌上摊开那本现在是**信簿** ✓ —— 点它 = **落座** ✓
      //   （镜头俯冲进书页 → 聊天 ✓，见下面 `ws-chatbook` 那段 ✓）。
      //   ⚠️ <image> 引的 svg 没法点子元素 ✓，所以盖一块透明 rect 当入口 ✓。
      '<rect class="ws-chatbook" x="318" y="1028" ' +
        'width="268" height="92" fill="transparent" style="cursor:pointer"/>' +
      // 账本搬到**书架**上 ✓（桌上那本让给聊天了 ✓）。
      //   热区比那排书放大一圈 ✓ —— 书上只有 ~59×58 CSS px ✓，照原样太难点准 ✓。
      // ★ 2026-10-28（P2）：**改指向原生账本屏** ✓（`#ledgerBook` ✓）——
      //   原来是开管家做的 `bookkeeping-panel` 组件 ✓。两边**同一张表** ✓，
      //   老面板那条路没断 ✓（账本屏底下留了一颗按钮 ✓，见上面的 `openLedger` ✓）。
      '<rect class="ws-shelf" x="580" y="360" width="112" height="110" ' +
        'fill="transparent" style="cursor:pointer" role="button" aria-label="账本"/>' +
      // ★ 2026-10-28：**那扇窗** ✓ —— 点它 = 今日明信片 ✓（IA「点窗 → 今日」✓）。
      //   窗框 58..552 × 118..762 ✓，热区往里收一圈 ✓（别压到窗台外 ✓）。
      //   和账本那排书（x≥580）、闹钟（708,296）、画框（632,538）都不挨着 ✓。
      '<rect class="ws-window" x="96" y="156" width="420" height="548" ' +
        'fill="transparent" style="cursor:pointer" role="button" aria-label="今日"/>' +
      // ★ 2026-10-28（P2）：屋里**三样东西各开一屏** ✓ ——
      //   挂钟 → 提醒 ✓（钟点就是时间 ✓）；挂画 → 回忆墙 ✓（挂着的是回忆 ✓）；
      //   火漆信 → 「我们的家」✓（信里是两个人过日子的事 ✓）。
      //   ⚠️ 热区**贴着物本身** ✓，不另加看得见的按钮 ✓（屋里不放第二层 UI ✓）。
      '<rect class="ws-clock" x="652" y="240" width="112" height="112" ' +
        'fill="transparent" style="cursor:pointer" role="button" aria-label="提醒"/>' +
      '<rect class="ws-paint" x="632" y="538" width="208" height="164" ' +
        'fill="transparent" style="cursor:pointer" role="button" aria-label="回忆"/>' +
      '<rect class="ws-mail" x="590" y="1090" width="84" height="64" ' +
        'fill="transparent" style="cursor:pointer" role="button" aria-label="我们的家"/>' +
      // ★ 2026-10-29：阁楼 ✓ —— 热区**包住小门和整架梯子** ✓
      //   （小门只有 94×136 ✓、梯子更细 ✓，照原样点不准 ✓）。
      //   ⚠️ 右缘 656 不能过 652 ✗（闹钟热区从 652 起 ✓）；下沿到 360 为止 ✓
      //      （书架热区从 360 起 ✓）—— 两边都只是**贴着**，不重叠 ✓。
      '<rect class="ws-attic" x="544" y="6" width="112" height="354" ' +
        'fill="transparent" style="cursor:pointer" role="button" aria-label="阁楼"/>' +
      // 二狗 ✓ —— 点它回主群聊 ✓
      flatCatSvg() +
      // 来找它玩的小蝴蝶 ✓ —— 画在猫上面 ✓，停在鼻尖时不会被挡住 ✓
      flatButterflySvg() +
      // 前景的萤火 ✓ —— 给画面一点前后层次 ✓
      '<g pointer-events="none">' + flatFgFxSvg() + '</g>' +
      // 很淡的暖色晕影 ✓ —— 四周略收一点 ✓
      '<rect x="0" y="0" width="900" height="1600" fill="url(#wsDream)" ' +
        'pointer-events="none"/>' +
      // ★ 补一层和 rsvg 末尾相同的暗角 ✓ —— 猫是搬出来的 ✓，
      //   不补的话它会比屋里别的角落亮一档 ✓（看着像贴上去的 ✗）。
      '<rect x="0" y="0" width="900" height="1600" fill="none" stroke="#8a5a3a" ' +
        'stroke-width="80" opacity=".05" pointer-events="none"/>' +
      // ★ 头一回进屋的手写标签 ✓ —— 压在最上面 ✓，暗角也别盖住字 ✓
      (labelsSeen() ? '' : houseLabelsSvg());

    // ★ 2026-10-28（P2）：屋里**每个物开自己那一屏** ✓ ——
    //   书架的账本 → 账本屏 ✓；挂钟 → 提醒 ✓；挂画 → 回忆墙 ✓；火漆信 → 我们的家 ✓。
    //   热区都在物身上 ✓（见上面那几块透明 rect ✓），屋里照样**一个按钮都不多** ✓。
    const wire = function (sel, fn) {
      const el = svg.querySelector(sel);
      if (el) el.addEventListener('click', function (ev) { ev.stopPropagation(); fn(); });
    };
    wire('.ws-shelf', function () { openLedger(); });
    wire('.ws-clock', function () { openClock(); });
    wire('.ws-paint', function () { openMemoryWall(); });
    // ★ 点墙上的便签 → 便签弹层 ✓（2026-10-29 ✓）。一张一张挂监听 ✓ ——
    //   便签是**动态的** ✓（`wire` 那套按选择器只捞一个 ✓，这里可能 0~3 张 ✓）。
    svg.querySelectorAll('.ws-note').forEach(function (g) {
      g.addEventListener('click', function (ev) { ev.stopPropagation(); openNotes(); });
    });
    // 信 → 我们的家 ✓。⚠️ 设置是 z10、屋子是 z22 ✓ —— **先退屋再进设置** ✓，
    //   不然设置页会藏在屋子底下 ✗（看着像"点了没反应"✓）。
    wire('.ws-mail', function () {
      closeWorkshop();
      setTimeout(function () { openSettings(); }, 260);
    });
    // ★ 阁楼 ✓（2026-10-29）—— 推在屋子**上面** ✓（z 25 ✓），退回来还是这间屋 ✓
    //   （和账本 / 提醒 / 回忆墙一个走法 ✓，所以**不用**先退屋 ✓）。
    wire('.ws-attic', function () { openAttic(); });

    // ★ 点桌上的信簿 → **落座** ✓（3.1）—— 镜头俯冲进书页，收尾就是聊天 ✓。
    //   · `transform-origin` 打在**书心**上 ✓ → 缩放时书心不动 ✓；
    //   · 再用 `translate` 把书心挪到**屏幕正中** ✓ → 看着像人俯下去 ✓；
    //   · 位置**现算** ✓（`getScreenCTM` ✓）—— 换手机、换高度都对 ✓。
    //   ⚠️ 连点要挡住 ✗ —— 会 `closeWorkshop` 两次 ✓，把聊天也退掉 ✓。
    //   ⚠️ `animationend` **不能** `{once:true}` ✗ —— 屋里别的 CSS 动画
    //      （萤火/蝴蝶… ✓）冒泡上来会先把监听摘掉 ✓ → 这一下就永远等不到 ✓。
    const book = svg.querySelector('.ws-chatbook');
    if (book) {
      let sitting = false;
      book.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (sitting) return;
        sitting = true;
        const scr = $('#workshop');
        try {
          const r = wrap.getBoundingClientRect();
          const pt = svg.createSVGPoint();
          pt.x = 452; pt.y = 1074;           // 桌上这本摊开书的中心 ✓
          const p = pt.matrixTransform(svg.getScreenCTM());
          const ox = p.x - r.left, oy = p.y - r.top;
          wrap.style.setProperty('--sit-ox', ox.toFixed(1) + 'px');
          wrap.style.setProperty('--sit-oy', oy.toFixed(1) + 'px');
          wrap.style.setProperty('--sit-dx', (r.width / 2 - ox).toFixed(1) + 'px');
          wrap.style.setProperty('--sit-dy', (r.height / 2 - oy).toFixed(1) + 'px');
        } catch (e) { /* 算不出来就原地放大 ✓，落座照走 ✓ */ }
        wrap.classList.add('ws-sit');
        // ★ 整屏淡出要挂在**这一屏**上 ✓ —— 只淡 `.ws-scene` 的话，底下露出来的是
        //   这一屏自己的米色底 ✗，不是聊天 ✓（看着像闪了一下白 ✓）。
        if (scr) scr.classList.add('ws-sitting');
        let done = false;
        const go = function () {
          if (done) return;
          done = true;
          wrap.removeEventListener('animationend', onEnd);
          closeWorkshop();
          // ⚠️ 退场动画（~200ms ✓）走完再摘 ✓；早摘会在中途闪回小屋 ✗。
          setTimeout(function () {
            if (scr) scr.classList.remove('ws-sitting');
            wrap.classList.remove('ws-sit');
          }, 320);
        };
        const onEnd = function (e) { if (e.target === wrap) go(); };
        wrap.addEventListener('animationend', onEnd);
        setTimeout(go, 760);                 // 不派发 animationend 的兜底 ✓
      });
    }

    // ★ 点猫 → 先让它蹦一下（爱心 + 瞪眼 ✓），再回主群聊 ✓
    //   ⚠️ 不能直接 closeWorkshop ✗ —— 那一下动作就看不见了 ✓。
    //   ⚠️ 连点两下要挡住 ✗ —— 会 pop 两次 ✓，把主群聊也退掉 ✓。
    // ★ 点窗 → **今日明信片** ✓（2026-10-28 ✓，IA「点窗 → 今日」✓）。
    //   这一屏是推在屋子**上面**的 ✓（z 23 > 22 ✓）—— 退回来还是这间屋 ✓。
    const win = svg.querySelector('.ws-window');
    if (win) {
      win.addEventListener('click', function (ev) {
        ev.stopPropagation();
        openToday();
      });
    }

    // ★ 2026-10-28（P2）：点二狗 → **管家面板** ✓（原来是"蹦一下回聊天"✓）。
    //   蹦那一下留着 ✓（它应一声 ✓），落点换成面板 ✓ —— 屋里找管家就该跟管家说话 ✓，
    //   而不是把人一脚踢回聊天 ✓（那条路一直有 ✓：桌上的信簿 = 落座进聊天 ✓）。
    const cat = svg.querySelector('.ws-cat');
    if (cat) {
      let leaving = false;
      cat.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (leaving) return;
        leaving = true;
        const jump = svg.querySelector('#wsCatJump');
        if (jump && jump.beginElement) jump.beginElement();
        const tilt = svg.querySelector('#wsCatTilt');
        if (tilt && tilt.beginElement) tilt.beginElement();
        setTimeout(function () { leaving = false; openButler(); }, 520);  // 动作播完再开 ✓
      });
    }
    // ★ 头一回进屋的手写标签 ✓ —— 看一眼就够 ✓：
    //   7 秒自己淡掉 ✓；**点哪儿都先淡掉** ✓（capture 抢在下面那些热区前面 ✓，
    //   但不拦 ✓ —— 该开的屏照开 ✓，别让人多点一下 ✓）。
    if (svg.querySelector('.ws-labels')) {
      setTimeout(function () { dropLabels(wrap); }, 7000);
      svg.addEventListener('pointerdown', function () { dropLabels(wrap); }, true);
    }

    wrap.appendChild(svg);
    return wrap;
  };
  let wsFlatOn = false;
  const toggleFlatScene = function (box) {
    if (!wsFlatOn) {
      wsFlatOn = true;
      var g = document.getElementById('ws-debug-g'); if (g) g.remove();
      box.innerHTML = '';
      box.appendChild(buildFlatScene());
    } else {
      wsFlatOn = false;
      paintCanvas();
    }
  };

  // ── 今日明信片（2026-10-28，纸上小屋 · IA「点窗 → 今日」）─────────────
  //
  // 从屋里那扇窗推进来的一张**撕边纸片** ✓：猫爪邮票 / 当天邮戳 /
  // 管家三行 / 一个问题 / 两个动作 ✓（见 docs/ui-redesign-2026-10-28.md 3.3 ✓）。
  //
  // ★ **数据只从眼前这屏聊天里数** ✓ —— 提醒/账本还只有内部票 ✓，
  //   公开接口一个都没有 ✓（`/records/*`、`/reminders/*` 都要内部票 ✓）。
  //   所以措辞是「我数到」✓，不假装是全天全量 ✓。
  //   ⚠️ 接上公开接口之后，把 `pcCount` 换掉就行 ✓（下面这些行不用动 ✓）。
  //
  // ⚠️ **别另起一个 08-today.js** ✗ —— 整个前端是一个 IIFE ✓，
  //   它在 `06-workshop.js` 末尾就关掉了 ✓（`07-scene.js` 在外面 ✓）。
  //   新文件拿不到 `$` / `pushScreen` / `toast` / `openComp` / `wsCanvas` ✓。
  //   所以这段必须**留在这个 IIFE 里** ✓、在 `window.LifeGuard` 导出之前 ✓。

  const PC_QUESTIONS = [
    '第一次一起吃饭，吃的是什么？',
    '今天有哪一分钟，你想再看一遍？',
    '最近一次一起大笑，是因为什么？',
    '这周想做、却还没做的一件小事，是什么？',
    '如果今天能重来一个小时，你想回到哪一段？',
    '对方今天说的哪句话，你想留下来？',
    '明天想一起吃什么？',
    '还记得你们第一次一起出门，是去哪吗？',
  ];

  /** 今天 0 点（本地 ✓，和 `fmtTime` 一个时区 ✓）。 */
  const pcDayStart = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  /** 从聊天 DOM 里数今天：条数 / 最早 / 最晚 / 各类媒体 ✓。 */
  const pcCount = () => {
    const start = pcDayStart();
    const out = { n: 0, first: 0, last: 0, photo: 0, sticker: 0, voice: 0, file: 0 };
    // ⚠️ 擦痕不算"今天说的一条" ✓（和管家那份摘要同口径 ✓：`deleted_at IS NULL` ✓）——
    //    否则今日卡说"12 条" ✓，屏幕上却只有 11 句 + 一道擦痕 ✓（2026-10-29）。
    document.querySelectorAll('#msgs .row[data-ts]:not(.gone)').forEach(function (r) {
      const ts = (Number(r.dataset.ts) || 0) * 1000;
      if (!ts || ts < start) return;
      out.n++;
      if (!out.first || ts < out.first) out.first = ts;
      if (!out.last || ts > out.last) out.last = ts;
      const b = r.querySelector('.bubble');
      if (!b) return;
      if (b.classList.contains('photo')) out.photo++;
      else if (b.classList.contains('sticker')) out.sticker++;
      else if (b.classList.contains('voice-note')) out.voice++;
      else if (b.classList.contains('file-note')) out.file++;
    });
    return out;
  };

  const pcHHMM = (ms) => {
    const d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' +
           String(d.getMinutes()).padStart(2, '0');
  };

  /** 三行短句 ✓ —— 不抒情过头 ✓，只说眼前数得到的东西 ✓。 */
  const pcLines = (s) => {
    if (!s.n) return ['今天还没有人开口。', '窗台上的光很好。', '我替你们守着纸和笔。'];
    const L = ['今天，我数到 ' + s.n + ' 张字条。'];
    if (s.first && s.last && s.first !== s.last)
      L.push('最早 ' + pcHHMM(s.first) + '，最晚 ' + pcHHMM(s.last) + '。');
    else if (s.first)
      L.push('都在 ' + pcHHMM(s.first) + ' 前后。');
    else
      L.push('都收在纸上了。');
    const bits = [];
    if (s.photo) bits.push(s.photo + ' 张照片');
    if (s.sticker) bits.push(s.sticker + ' 个表情');
    if (s.voice) bits.push(s.voice + ' 条语音');
    if (s.file) bits.push(s.file + ' 份文件');
    L.push(bits.length ? '夹着 ' + bits.join('、') + '。' : '只有字，没有图。');
    return L;
  };

  /** 一天一个问题 ✓ —— 按"第几天"取模 ✓，同一天开几次都是同一句 ✓。 */
  const pcQuestion = () => {
    const d = new Date();
    const seed = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    return PC_QUESTIONS[seed % PC_QUESTIONS.length];
  };

  const renderToday = () => {
    const lines = pcLines(pcCount());
    ['#pcL1', '#pcL2', '#pcL3'].forEach(function (sel, i) {
      const el = $(sel);
      if (el) el.textContent = lines[i] || '';
    });
    const q = $('#pcAsk');
    if (q) q.textContent = pcQuestion();
    // 邮戳里那两行：月.日 + 周几 ✓（`b`/`i` 是样式钩子 ✓，不是强调语义 ✓）
    const el = $('#pcDate');
    if (el) {
      const d = new Date();
      el.textContent = '';
      const b = document.createElement('b');
      b.textContent = (d.getMonth() + 1) + '.' + d.getDate();
      const i = document.createElement('i');
      i.textContent = '周' + '日一二三四五六'[d.getDay()];
      el.appendChild(b);
      el.appendChild(i);
    }
  };

  // ── 今日卡翻面（2026-10-28）：背面 =「今天的小事」────────────────────
  //
  // ★ 三路数据：眼前这屏的字条（DOM ✓）+ 今天记的账 / 今天的提醒 / 今天钉的墙
  //   （公开接口 ✓，就在这个文件下面 ✓）。
  // ⚠️ 字条只数**这一屏载着的** ✓（往上翻更早的历史不在 DOM 里 ✓）——
  //   所以一条都没有时说的是"这屏里还没有" ✓，**不是**"今天没有" ✗。
  // ⚠️ 账的时间用 `created_at` ✓ —— `spent_at` 是管家写账那天 0 点（UTC）
  //   = 北京 08:00 ✓，拿它排时间线每笔都是 08:00 ✓（账本那段踩过 ✓）。
  const pcCut = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

  const pcMsgEvents = () => {
    const start = pcDayStart();
    const out = [];
    // ⚠️ 擦痕不算一件事 ✓（它有 `data-ts` ✓，但没有 `who` / `bubble` ✓ ——
    //    混进来会变成一条"…"✓，2026-10-29）。
    document.querySelectorAll('#msgs .row[data-ts]:not(.gone)').forEach(function (r) {
      const ts = (Number(r.dataset.ts) || 0) * 1000;
      if (!ts || ts < start) return;
      const whoEl = r.querySelector('.who');
      const who = whoEl ? (whoEl.textContent || '').trim() : '';
      const b = r.querySelector('.bubble');
      let what = '';
      if (b) {
        if (b.classList.contains('photo')) what = '发了一张照片';
        else if (b.classList.contains('sticker')) what = '发了一个表情';
        else if (b.classList.contains('voice-note')) what = '发了一条语音';
        else if (b.classList.contains('file-note')) what = '发了一份文件';
        else if (b.classList.contains('media')) what = '发了一份附件';
        else what = (b.textContent || '').replace(/\s+/g, ' ').trim();
      }
      out.push({ ts: ts, text: (who ? who + '：' : '') + (what || '…') });
    });
    return out;
  };

  const renderTodayBack = async () => {
    const list = $('#pcList');
    if (!list) return;
    const d = new Date();
    const bd = $('#pcBackDate');
    if (bd) bd.textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日 · 周' +
      '日一二三四五六'[d.getDay()];
    list.innerHTML = '';
    list.appendChild(mkel('li', 'pc-li pc-li-empty', '…'));

    const events = pcMsgEvents();
    const today0 = h0();
    try {
      const r = await Promise.all([
        api(`/groups/${group.id}/records?kind=bookkeeping&limit=300`)
          .catch(function () { return null; }),
        api(`/groups/${group.id}/reminders`)
          .catch(function () { return null; }),
        api(`/groups/${group.id}/memories?limit=200`)
          .catch(function () { return null; }),
      ]);
      const recs = r[0], rems = r[1], mems = r[2];
      ((recs && recs.items) || []).forEach(function (it) {
        if (!it.created_at || hDay(it.created_at) !== today0) return;
        const f = it.fields || {};
        const note = String(f.note || f.category || '一笔账');
        const amt = (Number(f.amount) < 0 ? '+' : '') + hMoney(f.amount);
        events.push({ ts: it.created_at * 1000,
                      text: '记了一笔 · ' + pcCut(note, 18) + ' ' + amt });
      });
      ((rems && rems.items) || []).forEach(function (it) {
        if (!it.fire_at || hDay(it.fire_at) !== today0) return;
        const when = hHM(it.fire_at);
        events.push({ ts: it.fire_at * 1000,
                      text: '提醒 · ' + when + ' ' + pcCut(String(it.text || ''), 22) });
      });
      ((mems && mems.items) || []).forEach(function (it) {
        if (!it.created_at || hDay(it.created_at) !== today0) return;
        const t = String(it.text || '').trim();
        events.push({ ts: it.created_at * 1000,
                      text: '钉上墙 · ' + (t ? '「' + pcCut(t, 18) + '」' : '一张照片') });
      });
    } catch (e) { /* 接口没回来就只列字条 ✓ —— 别让整面翻不过来 ✗ */ }

    events.sort(function (a, b) { return a.ts - b.ts; });
    list.innerHTML = '';
    if (!events.length) {
      list.appendChild(mkel('li', 'pc-li pc-li-empty', '这屏里还没有小事。窗台上的光很好。'));
      return;
    }
    events.forEach(function (e) {
      const li = mkel('li', 'pc-li');
      li.appendChild(mkel('span', 'pc-lt', pcHHMM(e.ts)));
      li.appendChild(mkel('span', 'pc-lx', e.text));
      list.appendChild(li);
    });
  };

  let pcFlipT = 0;
  const pcShowFace = (back) => {
    const front = $('#pcFaceFront'), b = $('#pcFaceBack');
    if (!front || !b) return;
    front.classList.toggle('on', !back);
    b.classList.toggle('on', back);
    front.setAttribute('aria-hidden', back ? 'true' : 'false');
    b.setAttribute('aria-hidden', back ? 'false' : 'true');
  };
  /** 翻面 ✓ —— 中点换那面 ✓（2D 横向挤一下 ✓，不用 3D ✓）。 */
  const pcFlipTo = (back) => {
    const box = $('#pcFlipBox');
    if (!box) return;
    const nowBack = box.dataset.face === 'back';
    if (nowBack === !!back) return;
    box.dataset.face = back ? 'back' : 'front';
    if (back) renderTodayBack();
    const reduce = window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { pcShowFace(back); return; }
    clearTimeout(pcFlipT);
    box.classList.add('flipping');
    pcFlipT = setTimeout(function () { pcShowFace(back); }, 190);
    setTimeout(function () { box.classList.remove('flipping'); }, 460);
  };

  const openToday = () => {
    renderToday();            // ⚠️ 每次开都现数 ✓ —— 字条是刚才才落的 ✓
    // 每次开都是**正面** ✓（留着上次翻到背面的状态会让人以为纸没换 ✓）
    // ⚠️ 先掐掉可能还挂着的换面定时器 ✓ —— 翻到一半就退出去的话 ✓，
    //   它会晚 190ms 把背面推出来 ✓（下一次打开就成了背面 ✓）。
    clearTimeout(pcFlipT);
    const box = $('#pcFlipBox');
    if (box && box.dataset.face === 'back') {
      box.dataset.face = 'front';
      box.classList.remove('flipping');
      pcShowFace(false);
    }
    pushScreen('today');
    _syncStatusBar();         // 纸也是浅色 ✓ → 深色状态栏图标 ✓
  };

  const closeToday = () => {
    popScreen('today');
    setTimeout(_syncStatusBar, 220);   // 等退场收完再按"最上面是谁"报 ✓
  };

  /** 写一句 → 退回书桌 → 落座回聊天 → 光标在输入框 ✓。 */
  const pcWrite = () => {
    closeToday();
    setTimeout(function () {
      if ($('#workshop').classList.contains('on')) closeWorkshop();
      setTimeout(function () {
        const t = $('#text');
        if (t) t.focus();
      }, 260);
    }, 210);
  };

  /** 记一笔 → 直接翻到账本那件物 ✓（和点书架上那本同一个出口 ✓）。 */
  const pcBook = () => {
    // ★ 2026-10-28（P2）：今日那颗「记账」→ **原生账本屏** ✓（原来是组件 ✓）。
    //   今日和账本都是 z 23 / 24 ✓ → 先把今日收掉再开 ✓（不然它俩会叠着 ✓）。
    closeToday();
    setTimeout(function () { openLedger(); }, 220);
  };

  if ($('#pcWrite')) $('#pcWrite').addEventListener('click', pcWrite);
  if ($('#pcBook')) $('#pcBook').addEventListener('click', pcBook);
  if ($('#pcFlip')) $('#pcFlip').addEventListener('click', function () { pcFlipTo(true); });
  if ($('#pcFlipBack')) $('#pcFlipBack').addEventListener('click', function () { pcFlipTo(false); });

  // ══ 纸上小屋 · P2：提醒 / 账本 / 回忆墙 / 文具托盘 / 工具扇 / 管家面板 ══
  //
  // ★ **数据只走公开接口** ✓（`/api/groups/<id>/records|reminders|memories` ✓，
  //   cookie 鉴权 ✓，见 `app/api/home.py` ✓）—— 不给网页开内部票那条路 ✓。
  // ★ 账本是**原生**的一屏 ✓，但它和管家做的 `bookkeeping-panel` 组件
  //   **读的是同一张 `records` 表** ✓ —— 两个入口看到的是同一笔账 ✓，
  //   不会"这边记了那边不知道"✓。组件那个入口还在 ✓（账本屏底下留了一条 ✓）。
  // ⚠️ 三屏都要在 `_OTHER_SCREENS` + `__goBack` 里 ✓（z 24 ✓，见 index.html 那段 ✓）。
  // ⚠️ 这段必须留在 IIFE 里 ✓、在 `window.LifeGuard` 导出之前 ✓
  //   （理由和今日明信片那段一模一样 ✓）。

  const h0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const hDay = (ts) => { const d = new Date(ts * 1000); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const hDayLabel = (ts) => {
    const day = hDay(ts), t = h0();
    if (day === t) return '今天';
    if (day === t - 86400000) return '昨天';
    const d = new Date(day);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  };
  const hHM = (ts) => {
    const d = new Date(ts * 1000);
    return String(d.getHours()).padStart(2, '0') + ':' +
           String(d.getMinutes()).padStart(2, '0');
  };
  /** 钱：**两位小数、不带符号** ✓ —— 正负由调用处决定（支出不加、收入加 + ✓）。 */
  const hMoney = (n) => (Math.round(Math.abs(Number(n) || 0) * 100) / 100).toFixed(2);
  const hBtn = (cls, txt, fn) => {
    const b = mkel('button', cls, txt);
    b.type = 'button';
    if (fn) b.onclick = fn;
    return b;
  };
  /** 三屏的进出：**状态栏那一下跟着走** ✓（纸是浅的 → 深色图标 ✓；
   *  灯开着 / 深色主题时又反回来 ✓，判据全在 `_syncStatusBar` ✓）。 */
  const hEnter = (id) => { pushScreen(id); _syncStatusBar(); };
  const hLeave = (id) => {
    popScreen(id);
    setTimeout(_syncStatusBar, 220);
    // ★ 这一趟可能刚记了第一笔 / 设了第一个提醒 / 钉了第一张回忆 ✓ ——
    //   回屋里再数一遍 ✓，该"长出来"的当场就长 ✓（变了才重画 ✓，不会白闪 ✓）。
    setTimeout(function () {
      if ($('#workshop').classList.contains('on')) refreshHouseGrow();
    }, 260);
  };

  // ── 提醒（点墙上的挂钟 / 长按消息「变提醒」/ 工具扇 ✓）───────────────
  let clockRows = [], clockPrefill = '', clockPick = 'm10';
  const CLOCK_WHEN = [
    { k: 'm10', label: '10 分钟', spec: () => ({ in_minutes: 10 }) },
    { k: 'h1',  label: '1 小时',  spec: () => ({ in_minutes: 60 }) },
    { k: 'am8', label: '早上 8 点', spec: () => ({ hour: 8, minute: 0 }) },
    { k: 'pm8', label: '晚上 8 点', spec: () => ({ hour: 20, minute: 0 }) },
  ];

  const renderClock = () => {
    const box = $('#clockBody');
    if (!box) return;
    // ⚠️ 重画前**先记住已经打的字** ✓ —— `loadClock()` 回来还会再画一次 ✓，
    //   直接清空会把「变提醒」带过来的那句话（和用户刚打的字）抹掉 ✓
    //   （2026-10-28 截图里就是这样：托盘点「变提醒」，输入框是空的 ✓）。
    const old = box.querySelector('.rm-quick input');
    const keep = old ? old.value : '';
    box.innerHTML = '';

    const q = mkel('div', 'rm-quick');
    const inp = mkel('input');
    inp.type = 'text';
    inp.maxLength = 80;
    inp.placeholder = '要提醒什么？';
    inp.value = clockPrefill || keep || '';
    clockPrefill = '';
    q.appendChild(inp);

    const when = mkel('div', 'rm-when');
    CLOCK_WHEN.forEach(function (w) {
      const c = hBtn('rm-chip' + (clockPick === w.k ? ' on' : ''), w.label, function () {
        clockPick = w.k;
        haptic('soft');
        // ⚠️ **只在原地换样式** ✓，不整屏重画 ✗ —— 重画会把已经打的字抹掉 ✓。
        when.querySelectorAll('.rm-chip').forEach(function (x) {
          x.classList.toggle('on', x === c);
        });
      });
      when.appendChild(c);
    });
    q.appendChild(when);

    const add = hBtn('rm-add', '定好', async function () {
      const text = inp.value.trim();
      if (!text) { inp.focus(); return; }
      const w = CLOCK_WHEN.find(function (x) { return x.k === clockPick; }) || CLOCK_WHEN[0];
      add.disabled = true;
      try {
        await api(`/groups/${group.id}/reminders`, {
          method: 'POST',
          body: JSON.stringify(Object.assign({ text: text }, w.spec())),
        });
        sfx('bell'); haptic('soft');
        toast('记下了');
        inp.value = '';      // 定好之后这次**该清** ✓（renderClock 会保住已有的字 ✓）
        await loadClock();
      } catch (e) { toast(e.message || '没记上'); }
      add.disabled = false;
    });
    q.appendChild(add);
    box.appendChild(q);

    const list = mkel('div', 'rm-list');
    if (!clockRows.length) {
      list.appendChild(mkel('div', 'h-empty', '还没有提醒。'));
    } else {
      let lastDay = '';
      clockRows.forEach(function (r) {
        const day = hDayLabel(r.fire_at);
        if (day !== lastDay) { lastDay = day; list.appendChild(mkel('div', 'h-sec', day)); }
        const row = mkel('div', 'rm-row' + (r.enabled ? '' : ' off'));
        const clk = mkel('div', 'rm-clock');
        clk.appendChild(mkel('b', null, hHM(r.fire_at)));
        clk.appendChild(mkel('i', null, r.repeat_daily ? '每天' : ''));
        const mid = mkel('div', 'rm-mid');
        mid.appendChild(mkel('div', 'rm-text', r.text || ''));
        if (!r.enabled) mid.appendChild(mkel('span', 'rm-tag', '已停'));
        const del = hBtn('rm-del', '✕', async function () {
          const yes = await confirmBox({
            title: '取消这条提醒？',
            body: r.text || '',
            ok: '取消它',
            danger: true,
          });
          if (!yes) return;
          try {
            await api(`/groups/${group.id}/reminders/${r.id}`, { method: 'DELETE' });
            haptic('soft');
            await loadClock();
          } catch (e) { toast(e.message || '没取掉'); }
        });
        del.setAttribute('aria-label', '取消这条提醒');
        row.append(clk, mid, del);
        list.appendChild(row);
      });
    }
    box.appendChild(list);
  };

  const loadClock = async () => {
    try {
      const d = await api(`/groups/${group.id}/reminders`);
      clockRows = (d && d.items) || [];
    } catch (e) { clockRows = []; }
    renderClock();
  };
  /** `prefill` = 长按消息「变提醒」带过来的那句话 ✓。 */
  const openClock = (prefill) => {
    clockPrefill = prefill || '';
    clockRows = [];
    renderClock();          // 先给壳 ✓，不等网络 ✓
    hEnter('clock');
    loadClock();
  };

  // ── 账本（点书架那本 / 长按消息「记一笔」/ 工具扇 / 今日「记一笔」✓）───
  let ledgerRows = [], ledgerPrefill = '', ledgerKind = 'out', ledgerCat = '餐饮';
  const LG_CATS = ['餐饮', '日用', '交通', '玩乐', '其他'];

  const renderLedger = () => {
    const box = $('#ledgerBody');
    if (!box) return;
    // 和提醒那边同一个坑 ✓：`loadLedger()` 回来会再画一次 ✓，
    // 重画前先把**已经填的金额和备注**留住 ✓（不然「记一笔」带过来的话会消失 ✓）。
    const oldAmt = box.querySelector('.lg-amt input');
    const oldNote = box.querySelector('.lg-note');
    const keepAmt = oldAmt ? oldAmt.value : '';
    const keepNote = oldNote ? oldNote.value : '';
    box.innerHTML = '';

    // ① 本月小结：**只数列表里这些** ✓（limit 300 ✓，正常够用 ✓；
    //   不够的话多出来的不算进合计 ✓ —— 所以口径写的是"这 300 笔"✓）。
    let out = 0, inc = 0;
    ledgerRows.forEach(function (r) {
      const a = Number(r.amount) || 0;
      if (a >= 0) out += a; else inc -= a;
    });
    const sum = mkel('div', 'lg-sum');
    const cell = function (k, v, cls) {
      const d = mkel('div');
      d.appendChild(mkel('div', 'k', k));
      d.appendChild(mkel('div', 'v' + (cls ? ' ' + cls : ''), v));
      return d;
    };
    sum.appendChild(cell('共', String(ledgerRows.length) + ' 笔'));
    sum.appendChild(cell('花掉', '¥' + hMoney(out), 'out'));
    sum.appendChild(cell('进账', '¥' + hMoney(inc), 'in'));
    box.appendChild(sum);

    // ② 记一笔
    const q = mkel('div', 'lg-quick');
    const amtRow = mkel('div', 'lg-amt');
    const kindBtn = hBtn('rm-chip', '支出', function () {
      ledgerKind = ledgerKind === 'out' ? 'in' : 'out';
      kindBtn.textContent = ledgerKind === 'out' ? '支出' : '收入';
      kindBtn.classList.toggle('on', ledgerKind === 'in');
      haptic('soft');
    });
    kindBtn.classList.toggle('on', ledgerKind === 'in');
    amtRow.append(kindBtn, mkel('span', 'cur', '¥'));
    const amtInp = mkel('input');
    amtInp.type = 'text';
    amtInp.inputMode = 'decimal';
    amtInp.placeholder = '0.00';
    amtInp.value = keepAmt;
    amtRow.appendChild(amtInp);
    q.appendChild(amtRow);

    const cats = mkel('div', 'lg-cats');
    LG_CATS.forEach(function (c) {
      const b = hBtn('rm-chip' + (ledgerCat === c ? ' on' : ''), c, function () {
        ledgerCat = c;
        cats.querySelectorAll('.rm-chip').forEach(function (x) {
          x.classList.toggle('on', x === b);
        });
        haptic('soft');
      });
      cats.appendChild(b);
    });
    q.appendChild(cats);

    const note = mkel('input', 'lg-note');
    note.type = 'text';
    note.maxLength = 80;
    note.placeholder = '买了什么';
    note.value = ledgerPrefill || keepNote || '';
    ledgerPrefill = '';
    q.appendChild(note);

    const add = hBtn('lg-add', '记上', async function () {
      const a = Math.abs(Number(String(amtInp.value).replace(',', '.')));
      if (!isFinite(a) || a <= 0) { amtInp.focus(); return; }
      const v = ledgerKind === 'in' ? -Math.round(a * 100) / 100 : Math.round(a * 100) / 100;
      add.disabled = true;
      try {
        await api(`/groups/${group.id}/records`, {
          method: 'POST',
          body: JSON.stringify({
            amount: v,
            category: ledgerCat,
            note: note.value.trim(),
          }),
        });
        sfx('paper'); haptic('soft');
        toast('记上了');
        amtInp.value = ''; note.value = '';   // 记上之后这次**该清** ✓
        await loadLedger();
      } catch (e) { toast(e.message || '没记上'); }
      add.disabled = false;
    });
    q.appendChild(add);
    box.appendChild(q);

    // ③ 流水：**按天分堆** ✓（同一天不重复写日期 ✓）
    // 先按**哪一天**倒序（spent_at 才是"这笔记在哪天"✓），同一天里再按**记下来的先后**倒序 ✓
    // （不能只按 spent_at 排：它同一天全是一个值，前后顺序就靠库返回的顺序凑巧 ✓）
    const rows = ledgerRows.slice().sort(function (a, b) {
      const da = hDay(a.spent_at || a.created_at || 0);
      const db = hDay(b.spent_at || b.created_at || 0);
      if (da !== db) return db - da;
      return ((b.created_at || b.spent_at || 0) - (a.created_at || a.spent_at || 0));
    });
    if (!rows.length) {
      box.appendChild(mkel('div', 'h-empty', '账本还是空的。'));
    } else {
      let lastDay = '';
      rows.forEach(function (r) {
        const ts = r.spent_at || r.created_at || 0;
        if (!ts) return;
        const day = hDayLabel(ts);
        if (day !== lastDay) { lastDay = day; box.appendChild(mkel('div', 'lg-day', day)); }
        const row = mkel('div', 'lg-row');
        row.appendChild(mkel('span', 'cat', r.category || '其他'));
        const nt = mkel('div', 'nt');
        nt.appendChild(document.createTextNode(r.note || '（没写）'));
        // ⚠️ 时间取 `created_at`（记下来的那一刻）✓，**不用 `spent_at`** ✗：
        //   管家写账时把 spent_at 存成**当天 0 点（UTC）** = 北京 08:00 ✓，
        //   拿来显示"几点"会每一笔都是 08:00（2026-10-28 截图里就是这样 ✓）。
        //   分堆仍用 spent_at（那是"哪天的账"✓），只是不显示它的钟点。
        nt.appendChild(mkel('small', null, hHM(r.created_at || ts)));
        row.appendChild(nt);
        const a = Number(r.amount) || 0;
        const amt = mkel('span', 'amt ' + (a >= 0 ? 'out' : 'in'),
          (a >= 0 ? '' : '+') + '¥' + hMoney(a));
        row.appendChild(amt);
        box.appendChild(row);
      });
    }

    // ④ 管家做的那个账本面板 —— **同一张表** ✓，想去老样子看看的还能去 ✓
    const comp = (wsCanvas || []).find(function (x) { return x.slug === 'bookkeeping-panel'; });
    if (comp) {
      const more = hBtn('bs-note', '打开管家的账本面板', function () {
        hLeave('ledgerBook');
        setTimeout(function () { openComp(comp.slug, comp.title || '记账', (comp.spot && comp.spot.tint) || ''); }, 220);
      });
      more.style.marginTop = '22px';
      box.appendChild(more);
    }
  };

  const loadLedger = async () => {
    try {
      const d = await api(`/groups/${group.id}/records?kind=bookkeeping&limit=300`);
      ledgerRows = (d && d.items) || [];
    } catch (e) { ledgerRows = []; }
    renderLedger();
  };
  const openLedger = (prefill) => {
    ledgerPrefill = prefill || '';
    ledgerRows = [];
    renderLedger();
    hEnter('ledgerBook');
    loadLedger();
  };

  // ── 回忆墙（点挂画 / 长按消息「钉上墙」/ 工具扇 ✓）───────────────────
  let memoryRows = [];
  const MW_TILTS = ['-2.2deg', '1.6deg', '2.4deg', '-1.4deg', '1deg', '-2.6deg'];

  const renderMemory = () => {
    const box = $('#memoryBody');
    if (!box) return;
    box.innerHTML = '';
    if (!memoryRows.length) {
      box.appendChild(mkel('div', 'mw-empty', '墙还空着。长按一句话，钉上来。'));
      return;
    }
    const grid = mkel('div', 'mw-grid');
    // ★ 2026-10-28：**按月分段** ✓ —— 接口是 id 倒序 ✓（= 时间倒序 ✓），
    //   所以月份只会往下走 ✓；一跨月就插一行月份 ✓（整行跨两列 ✓）。
    //   ⚠️ 不在这一层排序 ✗ —— 存的行本来就是钉墙的先后 ✓，重排只会打乱同月里
    //      "最近钉的在最上面" ✓。
    let lastMonth = '';
    const curYear = new Date().getFullYear();
    memoryRows.forEach(function (m, i) {
      if (m.created_at) {
        const d = new Date(m.created_at * 1000);
        const key = d.getFullYear() + '-' + d.getMonth();
        if (key !== lastMonth) {
          lastMonth = key;
          const label = (d.getFullYear() === curYear ? '' : d.getFullYear() + ' 年 ') +
            (d.getMonth() + 1) + ' 月';
          grid.appendChild(mkel('div', 'mw-month', label));
        }
      }
      const card = mkel('div', 'mw-card');
      card.style.setProperty('--tilt', MW_TILTS[i % MW_TILTS.length]);
      card.style.setProperty('--tape-tilt', (i % 2 ? '2deg' : '-2deg'));
      if (m.media_path && m.msg_type === 'image') {
        const img = document.createElement('img');
        img.className = 'mw-img';
        img.src = '/media/' + m.media_path;
        img.alt = '';
        img.loading = 'lazy';
        // ★ 点墙上的照片 → 看大图 ✓，那儿有「保存到相册」✓（2026-10-29）。
        //   墙上这张**本身就是回忆** ✓ → 不带 message_id ✓，也就不给「收进回忆」✓。
        img.onclick = function (ev) {
          ev.stopPropagation();
          // ⚠️ 用 `img.src`（**已解析成绝对地址** ✓）而不是手拼的 `/media/...` ✗ ——
          //    灯箱靠 `^https?:` 判断"这张在不在服务器上" ✓，相对路径会被当成
          //    "存不了" ✓ → 「保存到相册」按钮直接藏起来 ✓（2026-10-29 踩过）。
          openLightbox(img.src);
        };
        card.appendChild(img);
      }
      if (m.text) card.appendChild(mkel('div', 'mw-quote', m.text));
      const cap = mkel('div', 'mw-cap');
      cap.appendChild(mkel('span', null, (m.created_at ? hDayLabel(m.created_at) : '')));
      cap.appendChild(mkel('span', null, m.sender_nick || ''));
      card.appendChild(cap);
      const x = hBtn('mw-x', '✕', async function () {
        const yes = await confirmBox({
          title: '从墙上取下这张？',
          body: '取下之后，原来那条消息还在。',
          ok: '取下',
          danger: true,
        });
        if (!yes) return;
        try {
          await api(`/groups/${group.id}/memories/${m.id}`, { method: 'DELETE' });
          haptic('soft');
          await loadMemory();
        } catch (e) { toast(e.message || '没取下来'); }
      });
      x.setAttribute('aria-label', '从墙上取下');
      card.appendChild(x);
      grid.appendChild(card);
    });
    box.appendChild(grid);
  };

  const loadMemory = async () => {
    try {
      const d = await api(`/groups/${group.id}/memories?limit=200`);
      memoryRows = (d && d.items) || [];
    } catch (e) { memoryRows = []; }
    renderMemory();
  };
  const openMemoryWall = () => {
    memoryRows = [];
    renderMemory();
    hEnter('memoryWall');
    loadMemory();
  };

  if ($('#clockClose')) $('#clockClose').onclick = function () { hLeave('clock'); };
  if ($('#ledgerClose')) $('#ledgerClose').onclick = function () { hLeave('ledgerBook'); };
  if ($('#memoryClose')) $('#memoryClose').onclick = function () { hLeave('memoryWall'); };

  // ── 阁楼（2026-10-29）──────────────────────────────────────────────
  //
  // 屋里墙上那扇**小门** ✓（和设置页「阁楼 · 架构」那一行 ✓，同一处入口 ✓）——
  //   爬上去就是 ARCH（架构）✓。
  //
  // ★ **ARCH 的内容一份都不搬进来** ✓（用户 2026-10-27 定的「原样保留」✓）：
  //   五个 tab、笔记 `cc_arch_v3`、配机 `cc_arch_build_v1` 全在 8750 那个服务里 ✓。
  //   这一屏只是一块**同源的地** ✓，里头那张 `static/attic.html`
  //   现场去 8750 取 `app.css` / `arch-data.js` / `arch-diagrams.js` / `arch.js` ✓
  //   —— 那边改了，这儿跟着改 ✓，不用两边同步 ✓（也就不存在"两份会长歪"✗）。
  //
  // ⚠️ 为什么是 iframe 而不是把三支脚本直接引进来 ✗：
  //   · `arch.js` 自己会 `tellNative('chat')` ✓、还会抢 `window.__goBack` ✓ ——
  //     直接引进来就是**两个返回键** ✓，谁先谁后没个准 ✗；
  //   · 在 iframe 里它碰不到壳 ✓（`?'` 空转 ✓），返回键由**我们这一层**转给它 ✓
  //     （`atticBack` ✓），它自己的"详情 → 列表"那一层也还归它 ✓；
  //   · localStorage 仍然挂在**我们这台** ✓ —— 笔记和配机照旧存在这个 App 里 ✓。
  //
  // ⚠️ 8750 没在跑的时候，里头那页会写「阁楼的门没打开」✓ ——
  //   **不假装成功** ✓（这条也写进了 `attic.html` 里 ✓）。
  const ATTIC_SRC = '/static/attic.html';
  let atticReady = false;      // iframe 的 src 给过没有 ✓（给过就复用 ✓，不再重载 ✓）

  /** 原生给的安全区 —— iframe 里读不到，只能现量了拼在 query 上 ✓。 */
  const atticInsets = () => {
    let top = 0, bot = 0;
    try {
      const cs = getComputedStyle(document.documentElement);
      top = Math.round(parseFloat(cs.getPropertyValue('--inset-top')) || 0);
      bot = Math.round(parseFloat(cs.getPropertyValue('--inset-bottom')) || 0);
    } catch (e) {}
    return { top, bot };
  };

  const openAttic = () => {
    const scr = $('#attic');
    const fr = $('#atticFrame');
    if (!scr || !fr) return;
    // 已经开着就别重推 ✓ —— `pushScreen` 会把进场动画**从头再放一遍** ✗。
    if (scr.classList.contains('on')) return;
    // ⚠️ 安全区变了（转屏 / 状态栏高度变了 ✓）→ 重新给一次 src ✓；
    //   没变就复用那一张 ✓（头一回进去要等它现场取脚本 ✓，之后是现成的 ✓）。
    const ins = atticInsets();
    const key = ins.top + 'x' + ins.bottom;
    if (!atticReady || fr.dataset.insets !== key) {
      fr.dataset.insets = key;
      fr.src = ATTIC_SRC + '?top=' + ins.top + '&bottom=' + ins.bottom;
      atticReady = true;
    } else {
      // 上一次是**从里面退出来**的 ✓（ARCH 自己 `closeArch` 过了 ✓）→ 重新开它 ✓。
      //   没装好就算了 ✓ —— 它自己 boot 时会开 ✓。
      try {
        const w = fr.contentWindow;
        if (w && w.__archAlive && typeof w.__openArch === 'function') w.__openArch();
      } catch (e) {}
    }
    sfx('paper'); haptic('soft');
    pushScreen('attic');
    _syncStatusBar();
  };

  /** 收阁楼。`instant` = 立刻摘 ✓（讲完话要**马上**看见聊天框 ✓）。
   *  正常退出走 `popScreen` ✓ —— 和别的纸屏一个节奏 ✓。 */
  const closeAttic = (instant) => {
    const scr = $('#attic');
    if (!scr || !scr.classList.contains('on')) return;
    if (instant) {
      // ⚠️ 取号 + 摘类 ✓ —— 不能 `popScreen` 再自己摘 ✗：
      //   两套收尾撞在一起 ✓，退场动画会跟下面的屏打架 ✓（见 `pushScreen` 那段 ✓）。
      scr._popToken = (scr._popToken || 0) + 1;
      scr.classList.remove(...ANIM_CLASSES, 'on');
      _enterAnim.delete('attic');
      tellTop('attic');
      _syncStatusBar();
      return;
    }
    popScreen('attic');
    setTimeout(_syncStatusBar, 220);
  };

  /** 返回键 / 右滑：**先问里面还有没有一层** ✓（ARCH 的详情页 ✓）。
   *  ⚠️ 这是**同步**调用 ✓ —— 它说 `true` 就是"我这儿退了" ✓：
   *     详情 → 列表 ✓ / 列表 → 它自己关 ✓（关完它会 `postMessage` 回来 ✓）。 */
  const atticBack = () => {
    const fr = $('#atticFrame');
    let took = false;
    try {
      const w = fr && fr.contentWindow;
      if (w && typeof w.__goBack === 'function') took = w.__goBack() === true;
    } catch (e) { took = false; }
    if (took) return;
    closeAttic();
  };

  /** 从阁楼带回一句话 → 填进聊天框 ✓（ARCH 那个「在对话里深挖」✓）。
   *  ⚠️ 三层都要收 ✓（阁楼 → 屋 / 设置 ✓），而且**立刻**收 ✓：
   *     让人马上看见那句话就在输入框里 ✓，不是先看 200ms 动画再猜字去哪儿了 ✗。 */
  const atticHandoff = (text) => {
    const v = String(text || '').replace(/\s+/g, ' ').trim();
    if (!v) return;
    closeAttic(true);
    if ($('#workshop').classList.contains('on')) closeWorkshop();
    if ($('#settings').classList.contains('on')) closeSettings();
    // 等这一帧的布局落地再插字 ✓（输入框还没量出高度时 `autoGrow` 会算错 ✓）。
    setTimeout(() => { insertText(v); }, 60);
  };

  // 里头递出来的口信 ✓ —— 只认**我们那张 iframe**发来的 ✓（`ev.source` ✓），
  //   `ev.origin` 再挡一道 ✓。网页别的地方发什么都不理 ✗。
  window.addEventListener('message', (ev) => {
    if (ev.origin !== location.origin) return;
    const fr = $('#atticFrame');
    if (!fr || ev.source !== fr.contentWindow) return;
    const d = ev.data || {};
    if (d.type === 'lg-attic-close') closeAttic();
    else if (d.type === 'lg-attic-handoff') atticHandoff(d.text);
  });

  // ── 文具托盘（长按一条消息）─────────────────────────────────────────
  //
  // ★ 六个动作**都是真能做的** ✓（引用 / 钉到墙上 / 变成提醒 / 记一笔 / 复制 ✓，
  //   以及**只有自己那条才有的「擦掉」** ✓，2026-10-29 ✓）。
  // ⚠️ 「擦掉」是**软删除** ✓：行留着、正文清空 ✓，两个人都看得见一道擦痕 ✓
  //    （见 `core/messages.py` 的 `erase_message` ✓）。**不是**"无声消失" ✗。
  let trayMsg = null;
  let trayRow = null;          // 「盖章」选完想返回动作条时，要拿它重开一次 ✓

  const trayPreview = (m) => {
    if (!m) return '［消息］';
    if (m.msg_type === 'text') return m.content || '';
    if (m.msg_type === 'sticker') return '［表情］';
    if (m.msg_type === 'image') return '［图片］';
    if (m.msg_type === 'file') {
      const meta = m.media_meta || {};
      return '［文件］' + (meta.original_name || '');
    }
    if (m.msg_type === 'audio' || m.msg_type === 'voice') return '［语音］';
    return '［消息］';
  };

  const closeTray = function () {
    const t = $('#tray');
    if (t) t.classList.remove('on');
    trayMsg = null;
  };

  const openTray = function (row) {
    const m = _msgs.get(Number(row.dataset.id));
    // 擦痕上没有托盘 ✓（长按那层已经拦了 ✓，这儿再拦一道 ✓ —— 别处也可能调进来 ✓）。
    if (!m || m.deleted) return;
    trayMsg = m;
    trayRow = row;
    const who = $('#trayWho');
    if (who) who.textContent = m.sender_type === 'agent' ? agentName() : (m.sender_nickname || '我');
    const txt = $('#trayTxt');
    if (txt) txt.textContent = trayPreview(m);
    const acts = $('#trayActs');
    if (!acts) return;
    acts.innerHTML = '';
    const body = m.msg_type === 'text' ? (m.content || '') : '';
    const A = [
      { ico: 'quote', lbl: '引用', fn: function () { setQuote(m); closeTray(); sfx('paper'); toast('引用它'); } },
      { ico: 'pin', lbl: '钉上墙', fn: function () { pinMemory(m); } },
      { ico: 'clock', lbl: '变提醒', fn: function () { closeTray(); openClock(body); } },
      { ico: 'book', lbl: '记一笔', fn: function () { closeTray(); openLedger(body); } },
      { ico: 'copy', lbl: '复制', fn: function () {
        if (!body) { toast('这条没有字'); return; }
        copyText(body); closeTray();
      } },
    ];
    // ★ 2026-10-29：**擦掉** ✓ —— 只有**自己写的那条**才有这一格 ✓
    //   （服务端也只认自己的 ✓，见 `api/groups.py` 的 `erase` ✓）。
    //   放在最后 ✓：四个"拿去做点什么"在前 ✓，这个"抹掉"单独在末尾 ✓。
    if (m.sender_type === 'user' && m.sender_id != null && me && m.sender_id === me.id) {
      A.push({ ico: 'eraser', lbl: '擦掉', cls: 'danger',
               fn: function () { eraseMsg(m); } });
    }
    A.forEach(function (a) {
      const b = mkel('button', 'tray-act' + (a.ico === 'pin' ? ' warm' : '') + (a.cls ? ' ' + a.cls : ''));
      b.type = 'button';
      const ic = mkel('span', 'ti');
      ic.appendChild(ico(a.ico));
      b.append(ic, mkel('span', 'tl', a.lbl));
      b.onclick = a.fn;
      acts.appendChild(b);
    });
    haptic('soft');
    const t = $('#tray');
    if (t) t.classList.add('on');
  };

  /** ★ 2026-10-29：「盖章」✓ —— 托盘右上角那枚小圆章点开的就是这一条 ✓。
   *
   *  ⚠️ **不是往动作条里再加一格** ✗ —— 动作已经六格了（自己那条七格 ✓），
   *     再加就挤成一排指甲盖 ✓。章另起一排、只在这一下出现 ✓，选完就收 ✓。
   *  ⚠️ 「返回」回到原来那排动作 ✓（不关托盘 ✓）—— 人只是想看看章长什么样 ✓。
   */
  const renderStampPicker = function () {
    if (!trayMsg) return;
    const acts = $('#trayActs');
    if (!acts) return;
    acts.innerHTML = '';
    Object.keys(STAMP_NAME).forEach(function (k) {
      const b = mkel('button', 'tray-act stamp-act');
      b.type = 'button';
      const ic = mkel('span', 'ti');
      ic.appendChild(ico(STAMP_ICON[k]));
      b.append(ic, mkel('span', 'tl', STAMP_NAME[k]));
      b.onclick = function () { pickStamp(k); };
      acts.appendChild(b);
    });
    const back = mkel('button', 'tray-act back');
    back.type = 'button';
    const ic = mkel('span', 'ti');
    ic.appendChild(ico('chev'));
    back.append(ic, mkel('span', 'tl', '返回'));
    back.onclick = function () { if (trayMsg) openTray(trayRow); };
    acts.appendChild(back);
    haptic('soft');
  };

  const pickStamp = function (k) {
    const m = trayMsg;
    closeTray();                       // 先收托盘 ✓ —— 章落在气泡上才看得见 ✓
    if (m) applyStamp(m, k);
  };

  /** ★ 2026-10-29：**擦掉**自己写的一条 ✓。
   *
   *  ⚠️ 只擦**自己**的 ✓（服务端也拦 ✓ —— 界面这层只是别给不该有的那一格 ✓）。
   *  ⚠️ 擦完**两个人都看不见** ✓ —— 所以话得说明白 ✓："只留一道浅浅的擦痕" ✓，
   *     不能让人以为"只有我这边没了" ✗（那是"撤回"的语义 ✓）。
   *  ⚠️ 本地的擦痕**当场画上** ✓（用服务端返回的那一份 ✓）；WS 那条随后也会到 ✓，
   *     `eraseRowLocal` 是幂等的 ✓（已经是擦痕就不再画 ✓）。
   */
  const eraseMsg = async function (m) {
    closeTray();
    const yes = await confirmBox({
      title: '擦掉这一行？',
      body: '两个人都看不见了，只留一道浅浅的擦痕。',
      ok: '擦掉',
      danger: true,
    });
    if (!yes) return;
    try {
      const d = await api(`/groups/${group.id}/messages/${m.id}`, { method: 'DELETE' });
      if (d && d.id) eraseRowLocal(d);
      haptic('soft'); sfx('paper');
      toast('擦掉了');
    } catch (e) { toast(e.message || '没擦掉'); }
  };

  const pinMemory = async function (m) {
    try {
      const d = await api(`/groups/${group.id}/memories`, {
        method: 'POST',
        body: JSON.stringify({ message_id: m.id }),
      });
      sfx('pop'); haptic('soft');
      toast(d && d.duplicated ? '这张已经在墙上了' : '钉到墙上了');
    } catch (e) { toast(e.message || '没钉上'); }
    closeTray();
  };

  if ($('#trayScrim')) $('#trayScrim').onclick = closeTray;
  if ($('#trayStampBtn')) $('#trayStampBtn').onclick = renderStampPicker;

  // ── 工具扇（点 +）───────────────────────────────────────────────────
  //
  // ★ 从 + 那儿**向上展开** ✓ —— 两圈：近的一圈是四样"从手机里拿"✓，
  //   远的一圈是三样"屋子里的东西"✓。位置是**现算的** ✓（按 + 的当前位置 ✓），
  //   换手机 / 键盘弹起都对 ✓。
  // ⚠️ **表情和语音不在扇子里** ✓ —— 它们本来就有自己的按钮 ✓（输入区那排 ✓）。
  const closeToolFan = function () {
    const f = $('#toolFan');
    if (f) f.classList.remove('on');
    fanMark(null);
  };

  // ★ 2026-10-28：**拖拽选** ✓（原来只能点 ✓）——
  //   按住一件往外拖 ✓，指尖落在哪件就近高亮哪件 ✓，松手就选它 ✓。
  //   ⚠️ 点一下照旧能用 ✓：pointerup 时没动过 = 点了原来那件 ✓；
  //      之后那个 click 事件用 `fanGuard` 吞掉 ✓（不然会选两次 ✓）。
  //   ⚠️ 位置一律现算 ✓（每件的 rect ✓）—— 扇面是整体平移过的 ✓，
  //      不能用公式里的圆心反推 ✓。
  let fanItems = [];
  let fanDrag = null;
  let fanGuard = 0;

  const fanHit = function (x, y) {
    const box = $('#tfItems');
    if (!box) return null;
    let best = null, bestD = 0;
    box.querySelectorAll('.tf-item').forEach(function (el) {
      const r = el.getBoundingClientRect();
      const dx = x - (r.left + r.width / 2);
      const dy = y - (r.top + r.height / 2);
      const d = dx * dx + dy * dy;
      if (!best || d < bestD) { best = el; bestD = d; }
    });
    // 半径 80px 以内才算"指着它" ✓（一件是 76×94 ✓）—— 再远就是松手取消 ✓
    return bestD <= 80 * 80 ? best : null;
  };

  const fanMark = function (el) {
    const box = $('#tfItems');
    if (!box) return;
    box.querySelectorAll('.tf-item.hover').forEach(function (n) {
      if (n !== el) n.classList.remove('hover');
    });
    if (el && !el.classList.contains('hover')) el.classList.add('hover');
  };

  const fanFire = function (el) {
    if (!el) return;
    const t = fanItems[Number(el.dataset.i)];
    if (!t) return;
    fanMark(null);
    fanGuard = Date.now() + 350;
    t.fn();
  };

  // 拖拽的手势只挂一次 ✓（每次开扇面只换里面的卡片 ✓）
  if ($('#tfItems') && !$('#tfItems').dataset.drag) {
    const fbox = $('#tfItems');
    fbox.dataset.drag = '1';
    fbox.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const el = e.target.closest ? e.target.closest('.tf-item') : null;
      if (!el) return;
      fanDrag = { id: e.pointerId, el: el, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false };
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
    });
    fbox.addEventListener('pointermove', function (e) {
      const d = fanDrag;
      if (!d || d.id !== e.pointerId) return;
      d.x = e.clientX;
      d.y = e.clientY;
      if (!d.moved) {
        const dx = d.x - d.x0, dy = d.y - d.y0;
        if (dx * dx + dy * dy < 64) return;   // 8px 以内还算"点" ✓
        d.moved = true;
      }
      fanMark(fanHit(d.x, d.y));
      if (e.cancelable) e.preventDefault();
    });
    const fanEnd = function (e) {
      const d = fanDrag;
      if (!d || d.id !== e.pointerId) return;
      fanDrag = null;
      const target = d.moved ? fanHit(e.clientX, e.clientY) : d.el;
      if (!target) { fanMark(null); return; }   // 拖出去松手 = 不选 ✓
      fanFire(target);
    };
    fbox.addEventListener('pointerup', fanEnd);
    fbox.addEventListener('pointercancel', function (e) {
      if (fanDrag && fanDrag.id === e.pointerId) { fanDrag = null; fanMark(null); }
    });
  }

  const openToolFan = function () {
    const btn = $('#pickMedia');
    const box = $('#tfItems');
    if (!btn || !box) return;
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    box.innerHTML = '';
    const fan = $('#toolFan');
    // ★ 两圈弧 ✓：**内圈 4 件**（相册/拍摄/文件/音频，R196 ✓）、
    //   **外圈 3 件**（账本/提醒/回忆，R300 ✓）。
    // ⚠️ 间距是算过的 ✗ **不是随手写的**：一件 76 宽 / 94 高 ✓，
    //   同一圈相邻两件**弦长要 ≥ 80** ✓ → 内圈每件隔 24° ✓、外圈 30° ✓。
    //   （第一版 R118 挤 4 件，弦长才 44 ✓ —— 截图里图标直接摞在一起 ✓。）
    // ⚠️ 角度以 **-90° = 正上** ✓、-180° = 正左 ✓ 量，扇面从**左下扫到右上** ✓。
    const T = [
      { ico: 'image',  lbl: '相册', a: -170, R: 196, tilt: -9,
        fn: function () { closeToolFan(); $('#fileGallery').click(); } },
      { ico: 'camera', lbl: '拍摄', a: -146, R: 196, tilt: -3,
        fn: function () {
          closeToolFan();
          if (isNative && window.LifeGuardNative.takePhoto) window.LifeGuardNative.takePhoto();
          else $('#fileCamera').click();
        } },
      { ico: 'file',   lbl: '文件', a: -122, R: 196, tilt: 3,
        fn: function () { closeToolFan(); $('#fileDoc').click(); } },
      { ico: 'audio',  lbl: '音频', a: -98,  R: 196, tilt: 9,
        fn: function () { closeToolFan(); $('#fileAudio').click(); } },
      { ico: 'book',   lbl: '账本', a: -160, R: 300, tilt: -7,
        fn: function () { closeToolFan(); openLedger(); } },
      { ico: 'clock',  lbl: '提醒', a: -130, R: 300, tilt: 0,
        fn: function () { closeToolFan(); openClock(); } },
      { ico: 'frame',  lbl: '回忆', a: -100, R: 300, tilt: 7,
        fn: function () { closeToolFan(); openMemoryWall(); } },
    ];
    const vw = window.innerWidth || 390, vh = window.innerHeight || 844;
    // 先算全，**再整体平移** ✓ —— 一件一件单夹会把扇面挤变形 ✓
    // （卡片 76 宽 → 左右各让 38 ✓；整件 94 高、图标顶在 y-33 ✓）
    let P = T.map(function (t) {
      const rad = t.a * Math.PI / 180;
      return { x: cx + Math.cos(rad) * t.R, y: cy + Math.sin(rad) * t.R };
    });
    const dx = Math.min(0, (vw - 44) - Math.max.apply(null, P.map(p => p.x)));
    const dx2 = Math.max(0, 44 - Math.min.apply(null, P.map(p => p.x)));
    const dy = Math.min(0, (vh - 108) - Math.max.apply(null, P.map(p => p.y)));
    P = P.map(function (p) { return { x: p.x + dx + dx2, y: p.y + dy }; });
    fanItems = T;
    T.forEach(function (t, i) {
      const { x, y } = P[i];
      const el = mkel('button', 'tf-item');
      el.type = 'button';
      el.setAttribute('aria-label', t.lbl);
      el.style.left = Math.round(x) + 'px';
      el.style.top = Math.round(y - 33) + 'px';
      el.style.transitionDelay = (i * 26) + 'ms, ' + (i * 26) + 'ms';
      const obj = mkel('span', 'tf-obj');
      obj.appendChild(ico(t.ico));
      obj.style.transform = 'rotate(' + t.tilt + 'deg)';
      el.append(obj, mkel('span', 'tf-lbl', t.lbl));
      el.dataset.i = String(i);
      // 键盘（回车/空格）也会走这里 ✓；手指/鼠标那一路由 pointerup 负责 ✓，
      // 随后合成出来的 click 用 fanGuard 吞掉 ✓
      el.onclick = function () {
        if (Date.now() < fanGuard) return;
        t.fn();
      };
      box.appendChild(el);
    });
    haptic('soft');
    if (fan) fan.classList.add('on');
  };

  if ($('#tfScrim')) $('#tfScrim').onclick = closeToolFan;

  // ── 管家面板（点屋里那只二狗 ✓）──────────────────────────────────────
  //
  // ★ 只列**真能做的事** ✓（账本 / 提醒 / 回忆 / 说句话 ✓）和
  //   **屋里真有的数** ✓（空间 / 账本 / 提醒 / 回忆 / 成员 ✓）。
  // ⚠️ **不放模型和提示词** ✓（那是「我们的家 → 管家 / 工作间」✓）；
  // ⚠️ **也不写"我是你的生活管家"** ✗ —— 名字 + 四件事 + 几个数 ✓，
  //    就是这块板的全部 ✓（用户定的「不要介绍性文字」✓）。
  const closeButler = function () {
    const b = $('#butler');
    if (b) b.classList.remove('on');
  };

  // ★ 2026-10-28：三段（它记得 / 它的性子 / 它的身体）之后，数也改成
  //   **一趟 `/digest`** 拿齐 ✓ —— 原来是三趟列表接口 ✓（还各要限 1000 条 ✓）。
  //   ⚠️ 它记得**不是第二套记忆** ✓：一条都不存 ✓，全是当场数出来的 ✓
  //      （真记忆在 Hermes 的 profile 里 ✓，网页看不到也不该看 ✓）。
  const setFact = function (k, v) {
    const el = document.querySelector('#bsFacts [data-fk="' + k + '"]');
    if (el) el.textContent = v;
  };

  const renderRemember = function (g) {
    const box = $('#bsRemember');
    if (!box) return;
    box.innerHTML = '';
    if (!g) { box.appendChild(mkel('div', 'bs-rem-line', '没数上来。')); return; }
    const L = ['一起住了 ' + g.days + ' 天'];
    const c = g.counts || {};
    if (g.messages) L.push('收着 ' + g.messages + ' 张字条');
    if (g.first_message_at)
      L.push('第一句在 ' + hDayLabel(g.first_message_at) + ' ' + hHM(g.first_message_at));
    const lr = g.last_record;
    if (lr && lr.fields) {
      const f = lr.fields;
      const note = String(f.note || f.category || '一笔账');
      const head = note.length > 16 ? note.slice(0, 16) + '…' : note;
      L.push('最近记了「' + head + '」' + (Number(f.amount) < 0 ? '+' : '') + hMoney(f.amount));
    }
    const lm = g.last_memory;
    if (lm) {
      const t = String(lm.text || '').trim();
      L.push(t
        ? '墙上最新一句：「' + (t.length > 16 ? t.slice(0, 16) + '…' : t) + '」'
        : '墙上最新一张是照片');
    }
    if (!g.messages && !(c.memories || 0)) L.push('还什么都没收着呢。');
    L.forEach(function (t) { box.appendChild(mkel('div', 'bs-rem-line', t)); });
  };

  const loadButlerFacts = async function () {
    setFact('mb', (members || []).length + ' 人');
    const g = await api(`/groups/${group.id}/digest`).catch(function () { return null; });
    if (g) {
      const c = g.counts || {};
      setFact('rec', String(c.records || 0) + ' 笔');
      setFact('rem', String(c.reminders || 0) + ' 条');
      setFact('mem', String(c.memories || 0) + ' 张');
    } else {
      setFact('rec', '—'); setFact('rem', '—'); setFact('mem', '—');
    }
    renderRemember(g);
  };

  const openButler = function () {
    const p = $('#butlerPanel');
    if (!p) return;
    p.innerHTML = '';

    const head = mkel('div', 'bs-head');
    const av = mkel('div', 'bs-av');
    const im = document.createElement('img');
    im.src = '/static/erdog.svg';
    im.alt = '';
    av.appendChild(im);
    // 内联一份 → 戴得上配饰 ✓（`<img>` 里的节点够不着 ✓，和纸角那只同一个道理 ✓）
    fetch('/static/erdog.svg').then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (txt) {
        const i = txt ? txt.indexOf('<svg') : -1;
        if (i >= 0 && av.isConnected) {
          av.innerHTML = txt.slice(i);
          applyWear(av, wearNow());
        }
      }).catch(function () {});
    const who = mkel('div', 'bs-who');
    who.appendChild(mkel('div', 'n', agentName()));
    who.appendChild(mkel('div', 's', (group && group.name) || ''));
    head.append(av, who);
    p.appendChild(head);

    const caps = mkel('div', 'bs-caps');
    [
      { ico: 'book', lbl: '账本', fn: function () { closeButler(); openLedger(); } },
      { ico: 'clock', lbl: '提醒', fn: function () { closeButler(); openClock(); } },
      { ico: 'frame', lbl: '回忆', fn: function () { closeButler(); openMemoryWall(); } },
      { ico: 'chat', lbl: '说句话', fn: function () {
        closeButler();
        setTimeout(function () {
          if ($('#workshop').classList.contains('on')) closeWorkshop();
          setTimeout(function () { const t = $('#text'); if (t) t.focus(); }, 260);
        }, 120);
      } },
    ].forEach(function (c) {
      const b = mkel('button', 'bs-cap');
      b.type = 'button';
      b.appendChild(ico(c.ico));
      b.appendChild(mkel('span', null, c.lbl));
      b.onclick = c.fn;
      caps.appendChild(b);
    });
    p.appendChild(caps);

    const facts = mkel('div', 'bs-facts');
    facts.id = 'bsFacts';
    // ⚠️ 不列「空间」那行 ✗ —— 名字已经写在头上那行小字里了 ✓，
    //   同一屏把「大象的鼻子很长」印两遍是废行 ✓（2026-10-28 截图里就是这样 ✓）。
    [
      ['账本', 'rec', '…'],
      ['提醒', 'rem', '…'],
      ['回忆', 'mem', '…'],
      ['成员', 'mb', (members || []).length + ' 人'],
    ].forEach(function (row) {
      const r = mkel('div', 'bs-fact');
      r.appendChild(mkel('span', 'fk', row[0]));
      const v = mkel('span', 'fv', row[2]);
      v.dataset.fk = row[1];
      r.appendChild(v);
      facts.appendChild(r);
    });
    p.appendChild(facts);

    // ── 它记得（2026-10-28）─────────────────────────────────────────────
    // ⚠️ **不是第二套记忆** ✓ —— 一条都不存 ✓，全是 `/digest` 当场数出来的 ✓
    //    （真记忆在 Hermes 的 profile 里 ✓，网页看不到也不该看 ✓）。
    const remember = mkel('div', 'bs-sec');
    remember.appendChild(mkel('div', 'bs-sec-h', '它记得'));
    const rem = mkel('div', 'bs-rem');
    rem.id = 'bsRemember';
    rem.appendChild(mkel('div', 'bs-rem-line', '…'));
    remember.appendChild(rem);
    p.appendChild(remember);

    // ── 它的性子（2026-10-28）──────────────────────────────────────────
    // ⚠️ **只读一份** ✓ —— 就是「管家设置 → 给管家的话」那段 ✓
    //    （`groups.agent_user_prompt` ✓）。**不另存一份、不加三档转盘** ✗：
    //    那是同一个信息两处 ✓（这个项目栽过好几次 ✓）。
    const temper = mkel('div', 'bs-sec');
    const th = mkel('div', 'bs-sec-h');
    th.appendChild(mkel('span', null, '它的性子'));
    const tedit = mkel('button', 'bs-sec-a', '改');
    tedit.type = 'button';
    tedit.onclick = function () { closeButler(); openAgentSettings(); };
    th.appendChild(tedit);
    temper.appendChild(th);
    const tp = String((group && group.agent_user_prompt) || '').trim();
    const tq = mkel('div', 'bs-temper',
      tp ? (tp.length > 96 ? tp.slice(0, 96) + '…' : tp) : '还没设过 —— 按默认的来。');
    if (!tp) tq.classList.add('empty');
    temper.appendChild(tq);
    p.appendChild(temper);

    // ── 它的身体（2026-10-28）──────────────────────────────────────────
    // ⚠️ 配饰**只管长相** ✓：不进提示词、不进记忆 ✓（见 `core/outfits.py` ✓）。
    //    群里谁都能改 ✓（和管家气泡同一套规矩 ✓）。
    const bodySec = mkel('div', 'bs-sec');
    bodySec.appendChild(mkel('div', 'bs-sec-h', '它的身体'));
    const chips = mkel('div', 'bs-wear');
    bodySec.appendChild(chips);
    const WEAR = [
      { id: 'bell', lbl: '铃铛' },
      { id: 'bow', lbl: '蝴蝶结' },
      { id: 'scarf', lbl: '围巾' },
      { id: 'wreath', lbl: '花环' },
    ];
    const renderWear = function () {
      chips.innerHTML = '';
      WEAR.forEach(function (w) {
        const b = mkel('button', 'bs-chip' + (wearNow() === w.id ? ' on' : ''), w.lbl);
        b.type = 'button';
        b.onclick = async function () {
          if (wearNow() === w.id) return;
          // 先换上让人看见 ✓（服务端回来再按那份校正 ✓ —— 被拒了就自己退回去 ✓）
          applyWear($('#ergou'), w.id);
          applyWear(document.querySelector('#butlerPanel .bs-av'), w.id);
          await patchGroup({ agent_outfit: w.id }, true);
          refreshWear();
          renderWear();
          haptic('soft');
        };
        chips.appendChild(b);
      });
    };
    renderWear();
    p.appendChild(bodySec);

    haptic('soft');
    $('#butler').classList.add('on');
    loadButlerFacts();
  };

  if ($('#butler')) {
    $('#butler').addEventListener('click', function (e) {
      if (e.target && e.target.id === 'butler') closeButler();
    });
  }
  // 桌角那只二狗 → 管家面板 ✓（原来是"蹦一下回聊天"✓）。
  //   `buildFlatScene` 里那段已经把"蹦一下"放在了前面 ✓，这里只把落点换掉 ✓。

  // ── 3D 卧室视图（2026-10-15 大升级，M1）──────────────────────────
  // 按需加载 `/static/room3d.js`（925KB three.js ✗ → 不进 app.js ✓，只在用时拉），
  // 挂进 #wsBody。**SVG 屋仍是默认视图** ✓（组件点进 `openComp` 那条路不动 ✓）；
  // 3D 目前是「看效果」的预览态，等 M2 把组件物也搬进 3D 才正式替换。
  let ws3DOn = false;
  const loadRoom3D = () => window.Room3D
    ? Promise.resolve(window.Room3D)
    : new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = '/static/room3d.js?v=' + (window.__room3dV || Date.now());
        s.onload = () => window.Room3D ? res(window.Room3D) : rej(new Error('脚本没定义 Room3D'));
        s.onerror = () => rej(new Error('3D 脚本没加载上'));
        document.head.appendChild(s);
      });
  const toggleRoom3D = async (box) => {
    if (!ws3DOn) {
      ws3DOn = true;
      document.getElementById('ws-debug-g')?.remove();
      try {
        const R = await loadRoom3D();
        R.unmount();
        box.innerHTML = '';
        R.mount(box, { preserveDrawingBuffer: true });
      } catch (e) {
        ws3DOn = false;
        box.textContent = '3D 起不来：' + e.message;
      }
    } else {
      ws3DOn = false;
      try { window.Room3D && window.Room3D.unmount(); } catch (e) {}
      paintCanvas();   // 回到 SVG 屋
    }
  };

  //: 「容纳界面」里当前的顺序 ✓ —— 调整模式就是**在这个数组上拖** ✓，
  //: 拖完一次性交给服务端 ✓（见 `saveArrangement` ✓）。
  let wsCanvas = [];

  // ★ 屋子会长（2026-10-29）✓ —— 数一遍屋里"用过"了几样 ✓；**数变了才重画** ✓。
  //   ⚠️ 不 await ✓：组件那趟照旧先画出来 ✓，数字回来再补一次 ✓
  //      （列表和数字两个口子 ✓，谁也不等谁 ✓）。
  const houseGrowKey = () => (houseGrow
    ? [houseGrow.records, houseGrow.reminders, houseGrow.memories].join(',')
    : '');
  const refreshHouseGrow = async () => {
    let d = null;
    try { d = await api(`/groups/${group.id}/digest`); }
    catch (e) { return; }                     // 数不上来就按老样子画 ✓（屋里东西一样能点 ✓）
    const c = (d && d.counts) || {};
    const before = houseGrowKey();
    houseGrow = { records: c.records || 0, reminders: c.reminders || 0, memories: c.memories || 0 };
    if (before !== houseGrowKey() && $('#workshop').classList.contains('on')) paintCanvas();
  };

  const renderWorkshop = async () => {
    const box = $('#wsBody');
    let list = [];
    try {
      list = (await api(`/components?group_id=${group.id}`)).components || [];
    } catch (e) {
      box.textContent = '打不开：' + e.message;
      return;
    }
    wsCanvas = list;                          // 服务端已经按**排好的位置**给了 ✓
    refreshHouseGrow();                       // ★ 不 await ✓（见上 ✓）
    refreshHouseNotes();                      // ★ 同上 ✓（墙上那几张便签 ✓）
    paintCanvas();
  };

  // ── 卧室场景（2026-10-14）──────────────────────────────────────────
  //
  // 用户要的：组件界面不再是手机格子 ✓，是一间**有空间感的卧室** ✓——
  //   地板、墙、家具 ✓；组件是屋里**能点开的物**（账本躺在桌上 ✓）✓；
  //   屋里还有只 🐱（二狗 ✓）在埋粑粑 ✓，点它 → 回主群聊 ✓。
  //   一屏装不下就**横滑**看别处 ✓（床/墙/抽屉/另一面墙都能塞 ✓）。
  //
  //   ⚠️ **网关没出图模型** ✗（glm-5.2 纯文本 ✗、flash-lite 只会看图 ✗）→
  //      这间屋是**手写 SVG** ✓（不引外部资源 ✓，和组件"单文件"一个规矩 ✓）。
  //      像不像**先发出来** ✓，再靠「截图 → flash-lite 描述 → 调」这条回路磨 ✓
  //      （flash-lite 能看图了 ✓，不再是上一轮的盲猜 ✓）。
  //
  //   ⚠️ **横滑交给原生** ✗→✓：这一屏在手势引擎里叫 `'wall'` ✓，原来右滑 = 退出 ✓
  //      ——会**吃掉横滑** ✗。已松开那道闸 ✓（见 `05-settings.js` ✓）→ 场景里
  //      右滑 = 原生平移 ✓。**退出**走"点猫 → 回主群聊"✓ + 系统返回 ✓。
  //
  //   ⚠️ **不再用 `.cell`** ✗→✓：原来长按拖拽换位那套挂在 `.cell` 上 ✓ ——
  //      `pointerdown` 里 `closest('#wsBody .cell')` 找不到 `.cell` 就直接 return ✓
  //      （不会炸 ✓、也不会误触拖拽 ✓）✓。"拖物到家具上摆"= v2 ✓。
  //
  // ── 组件往哪摆（2026-10-15 换到 `07-scene.js` 的世界坐标）──────────────
  // 槽位不再是屏幕像素 ✓ —— 它是**屋里一张面的位置**：`x/z` = 面上的点，
  //   `y` = 那张面的**高**（床面 0.617 / 桌面 0.778 / 柜顶 / 地板 0 ✓）。
  // 表在 `07-scene.js` 的 `RB_SLOTS` ✓（跟屋子的几何同一个文件 ✓ —— 家具挪了
  //   槽跟着挪 ✓，不会出现「物飘在桌面外面」那类对不上的事 ✓）。
  // ★ 屋里**不放图标、不放名字** ✓（用户 2026-10-14：「家里哪来的字」✓）——
  //   emoji 是扁平色块 ✓，跟这间屋的手绘 SVG 割裂 ✗。所以按**物件**画 ✓：
  //   记账 = 一本账本 ✓，自己传了图标的 = 一张小照片 ✓，别的 = 小盒子 ✓。
  //
  // ⚠️ 下面这几个函数**没有反引号** ✓（`05-settings.js` 顶上那段那个坑 ✓）：
  //   SVG 属性一律**先算好再拼进字符串**，不用模板字符串 ✓。
  // ⚠️ `objNode` 返回的字符串要能落进 DOM ✓ —— 所以 `<image>` / `href` 这些
  //   属性都带引号写全 ✓，不靠 `innerHTML` 之外的解析帮忙 ✓。

  // SVG 命名空间 + 建元素的 helper ✓ —— `buildScene`/`paintDebugLayer` 用它建
  //   `<svg>`/`<g>`/`<line>` 这些（它们要进 DOM、带监听器 ✓，所以不能像 `objNode`
  //   那样只吐字符串 ✗）。
  const NS = 'http://www.w3.org/2000/svg';
  const _svg = (tag, attrs, parent) => {
    const el = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  };

  // 把世界坐标 (x, y, z) 摆一件盒子的**投影尺寸**估出来 ✓ ——
  //   影子要用屏幕里的半径（`RB_SHADOW` 要的是世界的半宽/半深 ✓，所以其实直接给 ✓）。
  //   这里只留一个「世界单位 → 屏幕像素」的比例，给 `<image>` 那类必须写屏幕尺寸的元素用 ✓。
  const _PX = (sx, sy) => {
    const p = RB_PT([sx, sy, 1.1]);
    const q = RB_PT([sx + 0.02, sy, 1.1]);
    return Math.abs(q[0] - p[0]) / 0.02;             // 每米多少像素（局部 ✓）
  };

  /** 记账本 ✓ —— 摊开的一本厚账本，用**真盒子**画 ✓（`RB_BOX` 自己排 5 面 ✓）。
   *  左半（深皮）+ 右半（书页白）+ 一条书签（细红盒，从页角那端垂下来 ✓）。
   *  受光、投影、排序全走引擎 ✓ —— 不用再手写「顶面往回收一点 = 透视」✓。 */
  const drawLedger = (cx, cz, y, rot) => {
    let s = '';
    // 底下压一条软的 ✓（不是椭圆的画 ✗ —— 是**凸包投影** ✓，见 `RB_SHADOW` ✓）
    s += RB_SHADOW(cx, cz, 0.178, 0.142, 0.084, 0.24, y);
    // ⚠️ 原来两半各 0.028 厚 ✗ → 投到屏上整本只有 **8px** 高 ✗
    //    → 认不出是书，也点不进去 ✗（2026-10-15 他问「记账入口在哪」就是这个 ✓）。
    //   这版**加厚**：书皮 0.046 + 书页 0.038 ✓（合计 0.084 ✓），
    //   是一本摊开的厚账本，不是被子上的一道印 ✗。
    //   单位是**世界米** ✓ —— 床面那个深度（z≈1.43 ✗）下 1 单位 ≈ 233 屏单位 ✗。
    // 书皮（深 ✓，左右各半 ✓，在中缝 `cx` 处相接 ✓）
    s += RB_ROT(cx - 0.0825, cz, y, 0.165, 0.270, 0.046, rot, '#7e4f26',
      { stroke: '#63401f', sw: 0.9 });
    s += RB_ROT(cx + 0.0825, cz, y, 0.165, 0.270, 0.046, rot, '#8a5a2c',
      { stroke: '#63401f', sw: 0.9 });
    // 右半摊开的是**书页**（白 ✓ —— 书的标志 ✓）
    s += RB_ROT(cx + 0.0825, cz, y + 0.046, 0.152, 0.256, 0.038, rot, '#f7efdc',
      { stroke: '#d6c6a5', sw: 0.7 });
    // 左半露出一线页边（说明左边也夹着页 ✓）
    s += RB_ROT(cx - 0.0825, cz, y + 0.046, 0.152, 0.256, 0.008, rot, '#e8dcc2',
      { stroke: '#d6c6a5', sw: 0.5 });
    // 页角那道缝（把两半分开 ✓）
    s += RB_ROT(cx, cz, y + 0.084, 0.008, 0.256, 0.004, rot, '#d9c8a4',
      { stroke: '#cdbb95', sw: 0.5 });
    // 书签（从右半的页角端垂下来 ✓）
    s += RB_ROT(cx + 0.140, cz + 0.080, y + 0.004, 0.014, 0.024, 0.030, rot, '#c2485c',
      { stroke: '#9c3547', sw: 0.6 });
    return s;
  };

  // ⚠️ **没 tint 的组件不能长一个样** ✓ —— 名字和图标都去掉之后 ✓，
  //    屋里两件物**全靠颜色分** ✗（之前全是同一个米色盒子 ✓，两件物一模一样 ✗，
  //    而它们点的却是**不同的组件** ✗）。取一组跟这间屋配得上的低饱和色 ✓，按序轮 ✓。
  const CRATE_COLORS = ['#e8dcc4', '#c08756', '#8fa8bf', '#a8b98a', '#c9a3a8', '#d9bc74'];

  /** 通用小物件 ✓ —— 一个立着的盒子（`RB_BOX` ✓，受光 + 投影全在引擎里 ✓）。 */
  const drawCrate = (cx, cz, y, tint, i, rot) => {
    const bd = tint || CRATE_COLORS[i % CRATE_COLORS.length];
    return RB_SHADOW(cx, cz, 0.10, 0.10, 0.24, 0.20, y) +
      RB_ROT(cx, cz, y, 0.21, 0.21, 0.24, rot, bd,
        { stroke: '#a08a68', sw: 1 });
  };

  /** 自己上传了图标图的组件 ✓ —— 一张**立在面上**的小照片（拍立得 ✓）。
   *  白框是真盒子 ✓；图贴在前立面上 ✓（`RB_FACE` 给的是世界里的矩形 ✓，
   *   所以图上跟着透视一起歪 ✓，不是浮在上面的一张贴纸 ✗）。 */
  const drawPolaroid = (cx, cz, y, href) => {
    let s = RB_SHADOW(cx, cz, 0.09, 0.09, 0.26, 0.20, y);
    // 相纸（白框 ✓，有厚度 = 它立着 ✓）
    s += RB_BOX(cx, cz, y, 0.185, 0.024, 0.235, '#f7f1e4', { stroke: '#b9a888', sw: 1.1 });
    // 照片本体（贴在前立面 ✓）
    const P = [cx, y + 0.012, cz + 0.0121];
    s += '<image href="' + href + '" x="' + P[0].toFixed(3) + '" y="' + P[1].toFixed(3) +
      '" width="' + P[2].toFixed(3) + '" height="' + (P[2] * 1.0).toFixed(3) +
      '" preserveAspectRatio="xMidYMid slice"/>';
    return s;
  };

  /** 组件 = 屋里一件物 ✓（点 → 进组件 ✓，和原来点格子一个出口 ✓）。
   *  ★ `s` 是**触点** ✓（物件**底**贴着那张面 ✓，往上长 ✓）—— 见 `RB_SLOTS` ✓。
   *  返回 **SVG 字符串** ✓ —— 由 `buildScene` 统一 `innerHTML` 进 svg ✓。 */
  const objNode = (c, i, s) => {
    const tint = (c.spot && c.spot.tint) || '';
    const ic = String(c.icon || '');
    // ⚠️ 每件物**歪一点点** ✓ —— 全对齐反而像摆拍 ✗（散一点才是「家里的东西」✓）。
    const rot = ((i * 37) % 7 - 3) * 0.022;
    let body;
    if (ic.indexOf('data:image/') === 0) body = drawPolaroid(s.x, s.z, s.y, ic);
    else if (c.slug === 'bookkeeping-panel') body = drawLedger(s.x, s.z, s.y, rot);
    else body = drawCrate(s.x, s.z, s.y, tint, i, rot);
    // ★ 点的入口**单独立一块** ✓ —— 物本身在屏上可能小得离谱 ✗
    //  （摊开的账本本体也就 19px 高 ✗），手指一偏就点空 ✗。
    //   这块**看不见**，但比任何一件物的投影都宽 ✓ → 松松地戳一下也落得进去 ✓。
    //   ⚠️ 用 `RB_Q` 走**世界的四角**投影 ✓ —— 是屏幕上随便糊一个正方形的反面 ✗
    //      （那在远端会明显不对）✗。
    //   ⚠️ **这块必须是「立着的」** ✓ —— 相机自己就在 y≈0.66 ✗，
    //      一张平铺在 y=0.617（床面）上的板，和相机只差 0.04 ✗
    //      → 透视把它压成一条**线** ✗（实测 116×3 px ✗，等于没有入口 ✗）。
    //      换成贴着相机视线的一竖条（`s.z` 恒定 ✗），投影出来就是块真矩形 ✓。
    //   ⚠️ 下面那半截**故意往下探** ✓（`s.y - 0.10` ✗，扎进被子一点）——
    //      物的**名牌**就挂在它脚底下（`labelNode` ✓），
    //      「照着牌子点」是人的第一反应 ✗，那块也得算进入口里 ✗。
    //   ⚠️ SVG 的命中判断是**二维的** ✓ —— z 那一维只负责把它投到对的位置，
    //      不参与"点在不在里面"✗，所以单面就够了 ✗。
    //   ⚠️ 画在 `body` **前面** ✓ —— 它透明，物盖在上面，看着只有物 ✓。
    const p = 0.205;
    // `yb` 不越过地板 ✓ —— 地上的物（`s.y === 0` ✗）别再往下扎 ✗。
    const yb = Math.max(0.002, s.y - 0.10), yT = s.y + 0.26;
    const hit = '<polygon points="' + RB_Q([
      [s.x - p, yb, s.z],
      [s.x + p, yb, s.z],
      [s.x + p, yT, s.z],
      [s.x - p, yT, s.z],
    ]) + '" fill="#000" fill-opacity="0" pointer-events="all"/>';
    return '<g class="ws-obj" data-i="' + i + '">' + hit + body + '</g>';
  };

  /** 屋里那只猫 二狗 ✓ —— 点它 → 回主群聊 ✓（叙事出口 ✓）。
   *  猫**是屏幕空间手绘的**（`RB_CAT` ✓，曲线+耳朵方块凑不出来 ✗），
   *  但它的**位置**是世界坐标 `RB_CAT_AT` ✓ —— 锚在屋里那个角落 ✓。 */
  const catNode = () => '<g class="ws-exit">' + RB_CAT() + '</g>';

  /** 物的**名牌** ✓ —— 屋里不放第二层 UI（`paintCanvas` 那段 ✓），
   *  所以名字是一块**长在物脚下**的小牌子，不是浮在画上面的提示 ✗。
   *
   *  ⚠️ 走**屏幕坐标**、画在所有物**之后** ✓ —— 它是前景控件（和二狗一档）✗：
   *  跟着世界的画家排序走的话，近处的家具会把远处的名牌整块吃掉 ✗，
   *  那就成了"看得见物、看不见名" ✗。2026-10-15 就是栽在这上面 ✓ ——
   *  屋里唯一的物（记账本）没有任何一个字，他问「记账入口在哪」找不到 ✗。
   *
   *  ⚠️ 顺序是**物 → 名牌 → 二狗** ✓ —— 二狗是出口，永远压在最上 ✗。
   *  ⚠️ `pointer-events:none` ✓ —— 牌子是说明、不是新的点击目标 ✗
   *   （物的多边形自己就是入口 ✓，别在这里多一层语义 ✗）。 */
  const labelNode = (title, s) => {
    const t = String(title || '').slice(0, 8);
    if (!t) return '';
    const q = RB_PT([s.x, s.y, s.z]);
    const w = t.length * 12.6 + 17;
    return '<g class="ws-label" pointer-events="none">'
      + '<rect x="' + (q[0] - w / 2).toFixed(1) + '" y="' + (q[1] + 5).toFixed(1)
      + '" width="' + w.toFixed(1) + '" height="18" rx="9"'
      + ' fill="#161c28" fill-opacity="0.72" stroke="#ffffff" stroke-opacity="0.16"/>'
      + '<text x="' + q[0].toFixed(1) + '" y="' + (q[1] + 17.8).toFixed(1)
      + '" text-anchor="middle" font-size="12.5" fill="#f0ece3">' + t + '</text>'
      + '</g>';
  };


  // ── 坐标调试（2026-10-14）──────────────────────────────────────────
  // 用户要的："给界面添加个坐标调试按钮"✓ —— **我俩一起极限微操**的通道 ✓：
  //   点开 → 每个槽位画十字 + 标 `(x,y)` ✓、铺 50px 参考网格 ✓、
  //   点任意位置读出该处 viewBox 坐标（顶上 HUD 显示 ✓）。
  //   调试时**点物不会误进组件** ✓（点用来读坐标 ✓）。
  //   ⚠️ 这是**开发期工具** ✓ —— 之前"这屏不放任何按钮"那条 ✓ 是对**发布态**说的 ✓；
  //      微操完了删掉即可 ✓（`buildScene` 里那段 + 这几个函数 ✓）。
  let wsDebugOn = false;
  const dbgStyle = 'position:absolute;z-index:30;border-radius:999px;'
    + 'background:rgba(20,30,45,0.78);color:#cfe;border:1px solid #3a5680;'
    + 'font-size:12px;padding:4px 10px;touch-action:none;user-select:none;';

  const paintCanvas = () => {
    const box = $('#wsBody');
    box.innerHTML = '';                       // 下面走 createElement ✓（屋是固定串 ✓、物是 DOM 摆 ✓）
    // ★ 2026-10-20：**空的时候也画小屋** ✓ —— 以前空状态是一屏灰字 ✓，
    //   新空间进来第一眼像"没做完" ✗；现在小屋照常在，上面浮一张奶油色小卡片 ✓。
    box.appendChild(buildFlatScene());
    if (!wsCanvas.length) {
      // ★ 空状态那句话 ✓（2026-10-08 用户给的原话）—— 「去创意工坊」入口没了 ✓
      //   （只剩群聊右上角进统一聊天 ✓），后半句改了 ✓。
      const em = document.createElement('div');
      em.className = 'wsempty';
      em.textContent = '当前还没有组件，去群里右上角让他做一个吧';
      box.appendChild(em);
      return;
    }
    // ★ 工坊默认 = 平面小屋（竖幅一屏、不横滑 ✓），
    //   画面里只有**账本**一件物（点 → openComp 记账 ✓）。二狗在毯子上睡着 ✓。
    //   其它组件暂不摆进平面屋（平面物件管线 drawCrate/ledger/polaroid 还没接 ✓），
    //   接好后它们也成画面里的物件。旧的透视 buildScene 留着做 fallback ✓。
  };

  const svgPoint = (svg, ev) => {
    try {
      const pt = svg.createSVGPoint();
      pt.x = ev.clientX || 0;
      pt.y = ev.clientY || 0;
      const m = svg.getScreenCTM();
      if (m) { const p = pt.matrixTransform(m.inverse()); return [p.x, p.y]; }
    } catch (e) { /* 退回比例 ✓ */ }
    const r = svg.getBoundingClientRect();
    return [RB_W * ((ev.clientX || 0) - r.left) / (r.width || 1),
            RB_H * ((ev.clientY || 0) - r.top) / (r.height || 1)];
  };

  //       这是**第二条路** ✓：用户指定的那条是**下拉** ✓（两条都通 ✓，
  //       长按那条只是顺手，免得"长按了却什么都没发生" ✓）。
  const paintDebugLayer = (svg) => {
    document.getElementById('ws-debug-g')?.remove();
    const g = _svg('g', { id: 'ws-debug-g' }, svg);
    g.style.pointerEvents = 'none';
    for (let x = 0; x <= RB_W; x += 50)        // 竖线 ✓
      _svg('line', { x1: x, y1: 0, x2: x, y2: RB_H, stroke: '#000', 'stroke-width': .5, opacity: .12 }, g);
    for (let y = 0; y <= RB_H; y += 50)        // 横线 ✓
      _svg('line', { x1: 0, y1: y, x2: RB_W, y2: y, stroke: '#000', 'stroke-width': .5, opacity: .12 }, g);
    RB_SLOTS.forEach((s, i) => {               // 槽位十字 + 坐标（世界 → 屏幕 ✓）
      const q = RB_PT([s.x, s.y, s.z]);
      _svg('line', { x1: q[0] - 10, y1: q[1], x2: q[0] + 10, y2: q[1], stroke: '#d33', 'stroke-width': 1.5 }, g);
      _svg('line', { x1: q[0], y1: q[1] - 10, x2: q[0], y2: q[1] + 10, stroke: '#d33', 'stroke-width': 1.5 }, g);
      const t = _svg('text', { x: q[0], y: q[1] - 14, 'text-anchor': 'middle',
        'font-size': 11, fill: '#d33', 'font-family': 'monospace' }, g);
      t.textContent = i + '·(' + s.x + ',' + s.y + ',' + s.z + ')';
    });
    svg.insertBefore(g, svg.firstChild);       // 压在家具上面 ✓（十字看得见 ✓）
  };


  const buildScene = () => {
    const wrap = document.createElement('div');
    wrap.className = 'ws-scene';
    const svg = _svg('svg', { viewBox: '0 0 ' + RB_W + ' ' + RB_H,
                              preserveAspectRatio: 'xMidYMid meet', class: 'ws-room' });
    // ⚠️ **画序不能错** ✓：壳（墙/地板）→ 圆毯 → 光的落点 → 家具 ✓
    //    —— 光要**落在毯上** ✗，所以 pool 必须在 rug **之后** ✓；
    //    家具整体压住那两道 ✓。
    svg.innerHTML = RB_DEFS + '\n' + RB_SHELL + '\n' + RB_RUG + '\n' + RB_POOL + '\n' + FURN;

    // ★ 组件按**纵深**排队（画家算法 ✓：远先画、近后画 ✓）—— 否则前排的物会
    //    被后排的物盖掉 ✗（屋里的物件比家具近的时候尤其明显 ✓）。
    const placed = wsCanvas.map((c, i) => {
      const s = RB_SLOTS[i] || RB_SLOTS[RB_SLOTS.length - 1];
      return [RB_Z([s.x, s.y, s.z]), objNode(c, i, s)];
    }).sort((a, b) => b[0] - a[0]);
    svg.innerHTML += placed.map(p => p[1]).join('');

    // ★ 名牌（物名）✓ —— 单独一层，不和物一起排队 ✓（理由见 `labelNode` ✓）。
    //   还是远先画 ✓：两块牌子挨上的时候，近的那块压上去（和物一致 ✓）。
    const labels = wsCanvas.map((c, i) => {
      const s = RB_SLOTS[i] || RB_SLOTS[RB_SLOTS.length - 1];
      return [RB_Z([s.x, s.y, s.z]), labelNode(c.title, s)];
    }).sort((a, b) => b[0] - a[0]);
    svg.innerHTML += labels.map(p => p[1]).join('');

    // 二狗是**前景控件** ✓ —— 不参与排序，永远压在最上 ✓（不然会被书架挡掉 ✗）。
    svg.innerHTML += catNode();
    wrap.appendChild(svg);

    // ★ 点物 → 进组件 ✓（**和原来点格子完全同一个出口** ✓ → 后端那条路不动 ✓）。
    //   `objNode` 只吐字符串、不带监听器 ✓ → 在这里按 `data-i` 挂回去 ✓。
    svg.querySelectorAll('.ws-obj').forEach(el => {
      const c = wsCanvas[+el.getAttribute('data-i')];
      if (!c) return;
      const tint = (c.spot && c.spot.tint) || '';
      el.addEventListener('click', () => openComp(c.slug, c.title, tint));
    });
    svg.querySelectorAll('.ws-exit').forEach(el => {
      el.addEventListener('click', () => closeWorkshop());
    });

    // ★ 坐标调试按钮（右上角小胶囊 ✓）+ HUD（顶上读数 ✓）—— 见上面那段 ✓。
    const hud = document.createElement('div');
    hud.style.cssText = dbgStyle + 'top:8px;left:8px;display:none;font-family:monospace;';
    const btn = document.createElement('div');
    btn.style.cssText = dbgStyle + 'top:8px;right:8px;';
    btn.textContent = '坐标';
    // 调试时点场景 = 读坐标 ✓（**拦截掉进组件**✓）—— 关了就还原成点物进组件 ✓。
    //   ⚠️ 用 **`click` 捕获阶段** ✓：`pointerdown` 拦不住后续的 `click` ✗
    //      → 物的 `click` 还是会进组件 ✗。捕获在 svg 上 ✓、跑在物的冒泡之前 ✓ →
    //      `stopPropagation` 把物的 `click` 摁掉 ✓。
    const onSceneTap = (ev) => {
      if (!wsDebugOn) return;
      ev.stopPropagation(); ev.preventDefault();
      const [x, y] = svgPoint(svg, ev);
      hud.textContent = '(' + Math.round(x) + ', ' + Math.round(y) + ')';
    };
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      wsDebugOn = !wsDebugOn;
      if (wsDebugOn) {
        paintDebugLayer(svg);
        hud.style.display = 'block';
        hud.textContent = '点场景读坐标';
        svg.addEventListener('click', onSceneTap, true);   // capture ✓：拦在点物之前 ✓
      } else {
        document.getElementById('ws-debug-g')?.remove();
        hud.style.display = 'none';
        svg.removeEventListener('click', onSceneTap, true);
      }
    });
    wrap.appendChild(hud);
    wrap.appendChild(btn);
    // ★ 平面预览按钮（2026-10-15 方向调整）✓ —— 跟「坐标」同排 ✓。
    //   点一下看精致平面屋（+ 二狗），再点回默认视图（组件那条路在默认视图里 ✓）。
    const btnFlat = document.createElement('div');
    btnFlat.style.cssText = dbgStyle + 'top:8px;right:64px;';
    btnFlat.textContent = '平面';
    btnFlat.addEventListener('click', function (ev) {
      ev.stopPropagation();
      toggleFlatScene($('#wsBody'));
    });
    wrap.appendChild(btnFlat);
    return wrap;
  };

  // ── 组件页：一个组件自己的页 ✓ ──────────────────────────────────────
  const openComp = async (slug, title, tint) => {
    const wrap = $('#compWrap');
    wrap.innerHTML = '';
    // ★ 立刻把这一屏的底色刷成**你点的那一格的颜色** ✗→✓（2026-10-11）——
    //   `#compView` 是 `.screen`（`background:var(--bg)` ✓ = 近黑 ✓），
    //   而下面那趟网络**还没回来**时屏里是**空的** ✓ → 滑进来的就是**一整屏黑** ✓。
    //   刷成那一格的底色之后：看着像"这一格被推开了" ✓，不像"黑了一下" ✓
    //   （格子本来就是那个颜色 ✓ —— 服务端 `spot.tint` 给的 ✓，见 `canvasCell` ✓）。
    $('#compView').style.background = tint || '';
    pushScreen('compView');
    _syncStatusBar();
    let d;
    try { d = await api(`/components/${encodeURIComponent(slug)}?group_id=${group.id}`); }
    catch (e) { wrap.textContent = '打不开：' + e.message; return; }
    compCur = { slug: d.slug || slug, title: d.title || title || slug };
    // ⚠️ 原来这里有两句 `$('#compTitle').textContent = …`（给顶栏那个标题 ✓）——
    //    **顶栏整个没了** ✓（2026-10-08 ✓）→ 那两句会 `null.textContent` **当场抛** ✗，
    //    而且是"点一个组件就炸" ✓。删干净 ✓。

    // 数据先塞进去（**它自己取不了** —— 沙箱里没有 same-origin ✓）。
    // 下面那两个标签**必须拼出来，不能写成字面量** ✗：
    // HTML 解析器不认识 JS 注释 ✓，本文件是个内联脚本 ✓，
    // 它只要扫到结束标签那几个字符就认为"脚本到此为止" ✓ ——
    // **后面整段 JS 会被当普通文本丢掉** ✓（2026-10-04 就是这么做白屏的 ✓）。
    //
    // ⚠️ 这里**不需要 `<base>`** ✗→✓ —— 组件在 `var/` 里 ✓，
    //    而规范本来就是"单文件、不引外部资源" ✓（2026-10-07）。
    const S = '<' + 'script>', E = '<' + '/script>';
    // ★ 2026-10-13：**下滑进编辑那套整个撤了** ✗→✓ —— 只留群聊右上角一个入口 ✓
    //   （用户：「只留右上角入口」✓）。所以组件 iframe 里**不再注入下拉桥** ✓ ——
    //   它只在沙箱里跑组件自己的东西 ✓，和外面创意工坊的互通走右上角那条统一聊天 ✓。
    const inject = S + `window.__LG_DATA__=${JSON.stringify(d.data)};` + E;
    const ifr = document.createElement('iframe');
    ifr.setAttribute('sandbox', 'allow-scripts');   // ★ 没有 allow-same-origin
    ifr.setAttribute('referrerpolicy', 'no-referrer');
    ifr.srcdoc = inject + (d.html || '');
    wrap.appendChild(ifr);
    // ⚠️ 这里**必须立刻塞** ✗→✓（2026-10-11，试错一轮）——
    //   我先前把它挪到"动画走完之后"干（想的是"别让主线程在动画期间忙" ✓），
    //   用户当场看到的却是**更长的黑屏** ✓：「明显黑了一下，黑屏时间更长了」✓。
    //   真因：这一屏在数据回来之前**本来就是空的** ✓（上面那句 `wrap.innerHTML=''` ✓）→
    //   再往后拖 240ms，就是**白等 240ms 的黑** ✓ —— 比原来更糟 ✗。
    //
    //   ★ 真正该修的**不是"什么时候塞"** ✗，是"**主线程忙的时候动画为什么跟着顿**" ✓：
    //     那条动画是 `transform: translateX` ✓ —— 只要它**在合成器上跑** ✓，
    //     主线程再忙也**影响不到它** ✓。做法在 `app.css`（`.ascreen.anim-*` 那条
    //     `will-change: transform` ✓），不在这个地方 ✓。
    //   再加这一屏的底色**立刻刷成那一格的颜色** ✓（见上面 ✓）→ 那段等待不是黑的 ✓。

    // ★ 这一屏**到此为止** ✗→✓（2026-10-07 晚上用户定的）——
    //   「里面不要有任何的提示和设置选项，也不要有什么取消保留，继续改组件
    //     以及删除组件的功能，这样界面就被压缩了」✓。
    //   所以底下那一栏**整个删掉了** ✓（连同那一行 "v2 · 未固化" 的事实行 ✓ ——
    //   它也是"信息"，用户要的是压缩 ✓）。那些动作全在工坊里 ✓。
    //
    //   ★ 这一屏现在是**纯预览** ✓：要改它，找服务器管家（先不开放给群里做）。
  };

  //: 当前正在看的那个组件 ✓
  let compCur = null;

  const closeComp = () => {
    compCur = null;
    popScreen('compView');
    setTimeout(_syncStatusBar, 220);
    // ⚠️ **退回工坊要重画一次** ✗→✓ —— 不然刚才改过的东西还挂在旧样子上 ✓，
    //    用户会以为"点了没用" ✓（这就是那种"明明成功了却像失败"的毛病 ✓）。
    if ($('#workshop').classList.contains('on')) renderWorkshop();
  };

  /**
   * 一个**居中的确认框** ✓ —— 返回 `Promise<boolean>` ✓（点了删除就是 true ✓）。
   *
   * ⚠️ 2026-10-07 深夜改的 ✗→✓：原来是"再点一下同一个按钮"（按钮上改字 ✓）——
   *    用户说：「不需要这种提示，**只需要删除的时候弹出个框提示一下，
   *    二次确认就行**」✓。
   *    ⚠️ 换过来是对的 ✓：改按钮文字那种做法，**那句话会挤在一行菜单里** ✓
   *    （长一点就被截断 ✓），而弹框是**单独一块地方** ✓ ——
   *    该说的代价能说全 ✓，而且它是一次真正的"停一下" ✓。
   */
  //: 当前那个确认框的"取消"动作 ✓（返回键要能关它 ✓）。没有框开着时是 null ✓。
  let modalClose = null;
  const confirmBox = ({ title, body, ok, danger }) => new Promise((resolve) => {
    const m = $('#modal'), box = $('#modalBox');
    box.innerHTML = '';                      // 里面全是自己建的 ✓，没有用户内容 ✓
    const h = document.createElement('h4');
    h.textContent = title;
    box.appendChild(h);
    if (body) {
      const p = document.createElement('p');
      p.textContent = body;
      box.appendChild(p);
    }
    const acts = document.createElement('div');
    acts.className = 'acts';
    const no = document.createElement('button');
    no.className = 'btn-ghost';
    no.textContent = '取消';
    const yes = document.createElement('button');
    yes.className = 'btn-solid';
    yes.textContent = ok || '确定';
    if (danger) yes.style.background = 'var(--danger)';
    const done = (v) => {
      m.classList.remove('on');
      box.innerHTML = '';
      modalClose = null;
      resolve(v);
    };
    no.onclick = () => done(false);
    yes.onclick = () => done(true);
    m.onclick = (ev) => { if (ev.target === m) done(false); };   // 点框外 = 取消 ✓
    // ⚠️ **安卓返回键也要能取消** ✓ —— 不然返回键会一路退到导航屏去 ✓，
    //    而框还开着 ✓（用户看到的是"框没关，页面变了"✓）。见 `__goBack` ✓。
    modalClose = () => done(false);
    acts.append(no, yes);
    box.appendChild(acts);
    m.classList.add('on');
  });

  $('#openSettings').onclick = openSettings;
  $('#backChat').onclick = closeSettings;

  // ⚠️ **退出登录**那一段的说明留在上面那个 `logout()` 里 ✓（2026-10-08 合并时
  //    并到了一起 ✓）—— 原来这里是第二份 ✗：一份负责调 `/auth/logout` ✓、
  //    再跳壳的登录页 ✓。现在两件事都归上面那一个 ✓。
  //
  //    为什么非删不可 ✗：两个 `const logout` 在**同一个作用域**里 ✓ →
  //    整段脚本会在解析时就报 `Identifier 'logout' has already been declared` ✗
  //    → **整个页面全哑** ✓（不是"退出登录坏了" ✓，是**所有按钮都不动** ✓）。
  //
  //    ⚠️ 这类错 `node --check` **抓得到** ✓（实测：重复的 `const` 是**解析期**的错 ✓，
  //       不是运行期的 ✓）—— 所以 `tools/check-page.sh` 那道闸能拦住它 ✓。
  //       我原来是**想当然**写成"抓不到"的 ✗，当场验了一遍才改过来 ✓
  //       （注释写错比没注释更坏 ✓：下一个人会照着它去信 ✗）。
  //
  //    （它还把 `ws.close()` 和清状态那几句带走了 ✓ —— 那些现在由
  //     `location.href` 整页重载自然做到 ✓：**换页比手动清内存干净** ✓。）

  /** 弹层关掉时要顺手做的事 ✓（"编状态"那一屏没有保存按钮 ✓，靠它兜一次 ✓）。 */
  let sheetCloseHook = null;
  const openSheet = () => { sheetCloseHook = null; $('#sheet').classList.add('on'); };
  const closeSheet = () => {
    $('#sheet').classList.remove('on');
    const h = sheetCloseHook;
    sheetCloseHook = null;
    if (h) { try { h(); } catch (e) {} }
  };
  $('#sheet').onclick = e => { if (e.target.id === 'sheet') closeSheet(); };

  // **启动就是"直接进去试试"。**
  // 以前是 `if (token) …` —— 本地有令牌才进。现在本地什么都没有了，
  // Cookie 是 httpOnly、JS 看不见，所以判断"登录了没"的唯一办法是
  // **打一次 /auth/me**：成了就进，401 就退回登录页。
  // ★ **不再"猜"登录状态，一律问服务器。**
  //
  // 走过一段弯路，记在这儿免得以后又绕回去：
  //
  // 原来这个页面开局就显示**登录页**，等 /auth/me 回来说"其实登录着呢"再跳走
  // ——于是已登录的人每次都被闪一下 ✗。根子是"令牌在 httpOnly Cookie 里，
  // 网页看不见，只能问"。
  //
  // 修法是**把开局那个"还没确定"的状态改成转圈**（见 #boot），而不是去猜。
  // 中间还试过第三条路：让壳用原生 API 读一下 cookie、只告诉网页"有没有"。
  // **做完了发现它买不到东西** ✗ —— 因为转圈一上，"闪"本来就已经没了；
  // 而它唯一的收益是"没登录时少转半圈"，代价却是**读错了会把登录着的用户
  // 踢到登录页** ✗（老 WebView 读 httpOnly 有返回 null 的已知坑）。
  // **宁可多转半圈，不能把人踢出去。**
  //
  // （壳里那个 `hasSession()` 留着，但这种"读错的代价大于收益"的判断，
  //   以后再用它之前得先重新算一遍。）
  // ══════════════════════════════════════════════════════════════════
  // 落地：**去哪儿由地址决定** ✗→✓（2026-10-08 合并那次搬进来）
  // ══════════════════════════════════════════════════════════════════
  //
  // ★ 这一套原来住在**壳**里 ✓（`/` 判去向 · `/login` 清票 · `/me` 到了就画 ✓），
  //   合并时**原样搬过来** ✓ —— 因为它是用户吃过亏才立的规矩 ✓
  //   （`memory/route-not-flag.md` ✓：标记会丢 ✓、地址不会 ✓；
  //    他为这件事补过两次标记 ✗，第三次才改成地址 ✓）。
  //
  //   三条地址，三种含义 ✓：
  //     `/login`  登录页 —— 到了就显示登录 ✓，而且**票由这一页自己清掉** ✓
  //                          （服务端那一条 ✓，见 `main.py:page_login` ✓）
  //     `/me`    「我的」—— 到了就画 ✓，**永不自动跳走** ✓
  //     `/`       只有它判"该去哪儿" ✓ —— 规则**只有这一处** ✗（判两遍迟早走岔 ✓）
  //
  //   ⚠️ 判据是服务端注入的 `window.__ROUTE__` ✓（`main.py:_render_page` ✓）——
  //      **不是 URL 路径** ✗：WebView 里的 `location` 可能带着一堆历史 ✓，
  //      而"这一页是服务端按哪个地址发下来的"才是权威 ✓。
  const ROUTE = window.__ROUTE__ || 'landing';

  // 「我的」也可以**直接落下来**（`/me` 这个地址 ✓）——
  // 那就得先问一句"我是谁" ✓（这一屏要画昵称和头像 ✓）。
  const bootAtMe = async () => {
    try {
      me = await api('/me', { timeout: 7000 });   // 开屏必经之路，卡住也要有头 ✓（2026-10-23）
    } catch (e) {
      if (e && e.status === 401) { location.href = '/login'; return; }
      show('login');
      $('#loginErr').textContent = (e && e.message) || '连不上服务器';
      _bootReady();                    // 连不上就**收掉加载页** ✓，让人看见那句话 ✓
      return;
    }
    // ★ **`/me` 现在也是"进 App + 弹出我的"** ✗→✓（2026-10-09）——
    //   「我的」变成弹层之后它不再是"一屏" ✓，而这个地址的意义**没变** ✓：
    //   **到了就让你看见你的资料** ✓（"去向由地址决定"那条记忆里的规矩 ✓）。
    // ⚠️ `{ room: false }` ✓ —— `/me` 是"到了就让我看见我的资料" ✓，
    //    中间夹一间屋子、再被「我的」压上去，等于白跑一趟 ✓（见 `enterApp` ✓）。
    try { await enterApp({ room: false }); } catch (e) {
      if (e && e.status === 401) { location.href = '/login'; return; }
      show('login'); tellNative('chat');
      if (e) $('#loginErr').textContent = e.message;
      _bootReady();
      return;
    }
    // ⚠️ **落到群聊了才进「我的」** ✓ —— 没有空间的人落的是**初始化屏** ✓，
    //    那种情况该先让他建/进空间 ✓（在初始化屏上再压一屏"我的"没有意义 ✓）。
    if ($('#chat').classList.contains('on')) openMe();
  };

  if (ROUTE === 'login') {
    // 到了就显示登录 ✓，不判、不跳 ✓（票由服务端在这一页清掉 ✓）。
    show('login');
    tellNative('chat');            // **根屏** ✓ → 返回键该走"再滑一次退出 App" ✓
    _bootReady();                  // 登录页是同步画好的 ✓ → 最短 0.5s 后撤 ✓
  } else if (ROUTE === 'me') {
    bootAtMe();
  } else {
    enterApp().catch(e => {
      // ★ **没有票 → 去登录页** ✗→✓ —— 2026-10-06 用户实测那条：
      //   登出之后开 App 进的是**本页自带那个旧登录界面** ✗，而它早就封了 ✓
      //   （点"登录"只会得到"入口已经搬走了"✓）—— 一个**进不去的登录页** ✗。
      //   现在这一页**真的能登录**了 ✓（合并那次接上的 ✓），所以：
      //   401 就直接**导航**过去 ✓ —— 真导航还会把 cookie 清干净 ✓。
      if (e && e.status === 401) { location.href = '/login'; return; }
      // 不是 401（多半是网络不通）→ 就地报出来 ✓：
      // 这时候往登录页跳也跳不过去 ✓（同一个服务 ✓），总得让人看见一句话 ✓。
      show('login');
      tellNative('chat');
      if (e) $('#loginErr').textContent = e.message;
      _bootReady();                  // 失败也要收 ✓ —— 否则人就卡在加载页上了 ✗
    });
  }

  // ── 对外的口子：原生壳，以及 agent 写的 ui/app.js ──
  //
  // **为什么必须开这个口子**：上面的 IIFE 把 `addMsg`/`show`/`enterApp` 全关在里面，
  // 外面一个都够不着。不给它这几个函数，agent 写的 ui/app.js 就只能干瞪眼——
  // 而"让它能改这个界面"正是这个口子存在的理由。
  //
  // **只开小的、明确的**，别长成通用插件系统：它做一件事需要的最小集合就够了。
  // 想加新的之前先问一句"真的缺这个吗"。
  window.LifeGuard = {
    // —— 原生壳用 ——
    logout,
    // ★ 2026-10-23：**别再用 `location.reload()`** ✗（在 App 里会卡死 ✓，见 01-core 的
    //   `_appReload` 说明 ✓）。壳里调用它也走"重建 WebView"那条路 ✓。
    reload: () => _appReload(),

    // —— agent 用：钩子（它在本文件之后加载，注册的回调稍后会被调用）——
    onReady: _hook('ready'),              // 进了聊天页、历史消息都渲染完之后
    onMessage: _hook('message'),          // 每渲染一条消息（历史消息也会挨个触发）

    // —— agent 用：读 ——
    me: () => me,
    group: () => group,
    members: () => members.slice(),
    messages: () => [..._msgs.values()],
    $, $$,

    // —— agent 用：做 ——
    insertText,                           // 往输入框插字（比如 `@刘猪猪 `）
    quote: quoteById,                     // 按消息 id 挂引用条，返回是否找到
    toast,
  };
})();