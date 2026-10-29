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
  // ★ 2026-10-29：小屋下线之后**没有"浅色小屋"这一屏了** ✓ ——
  //   这个函数只剩"按用户主题还原状态栏图标"一件事 ✓。
  //   ⚠️ 不能再碰 `$('#workshop')` ✗ —— 那个元素已经不在 DOM 里 ✓，
  //      一碰就是 undefined.classList ✗（而且是异步调用的，整页不会当场报错）。
  const _syncStatusBar = () => {
    let light = false;
    try { light = !!themeById(document.documentElement.dataset.theme).light; } catch (e) {}
    try { window.LifeGuardNative?.setLightStatusBar?.(light); } catch (e) {}
  };

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
      '</defs>' +
      // ★ 内层 <image> 用 **meet**（不是 slice！）✓ —— 图本身 900×1600，
      //   放进同尺寸盒子是 1:1 精确贴合，meet 即满、slice 在某些 WebView 上
      //   会把 <image> 渲成黑块/不铺满 ✗（实测黑边根因 ✓）。真正填满屏幕的是
      //   **外层 svg 的 slice** ✓，内层只管把图原样贴进 viewBox。
      '<image href="/static/flat-room.svg" x="0" y="0" width="900" height="1600" ' +
        'preserveAspectRatio="xMidYMid meet"/>' +
      // 环境动效（光/尘/花瓣）✓ 压在屋子上、猫下面 ✓
      '<g pointer-events="none">' + flatFxSvg() + '</g>' +
      // 账本热区（桌上摊开的账本 ✓）—— 透明、可点 → 进记账。
      //   ⚠️ <image> 引的 svg 没法点子元素 ✓，所以盖一块透明 rect 当入口 ✓。
      '<rect class="ws-obj" data-slug="bookkeeping-panel" x="318" y="1028" ' +
        'width="268" height="92" fill="transparent" style="cursor:pointer"/>' +
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
        'stroke-width="80" opacity=".05" pointer-events="none"/>';

    svg.querySelectorAll('.ws-obj').forEach(function (el) {
      el.addEventListener('click', function () {
        const c = wsCanvas.find(function (x) { return x.slug === 'bookkeeping-panel'; });
        if (c) openComp(c.slug, c.title || '记账', (c.spot && c.spot.tint) || '');
      });
    });

    // ★ 点猫 → 先让它蹦一下（爱心 + 瞪眼 ✓），再回主群聊 ✓
    //   ⚠️ 不能直接 closeWorkshop ✗ —— 那一下动作就看不见了 ✓。
    //   ⚠️ 连点两下要挡住 ✗ —— 会 pop 两次 ✓，把主群聊也退掉 ✓。
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
        setTimeout(function () { closeWorkshop(); }, 520);   // 动作播完再走 ✓
      });
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
    // ⚠️ 2026-10-29：小屋下线 ✓ —— 退回的地方现在是**群聊** ✓，没有"工坊"要重画了 ✓。
    //    原来这句 `renderWorkshop()` 会去碰 `$('#wsBody')`（null）✗ → 关组件页时炸 ✓。
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

  // ⚠️ 2026-10-29：`#backChat` 那个返回箭头**从 index.html 里删掉了** ✓
  //    （用户定的：设置页只靠右滑 / 返回键回去）—— 所以这里那行
  //    `$('#backChat').onclick = closeSettings` 也一起删 ✓。
  //    留着会**直接炸** ✓：`$()` 拿到 null ✓，`.onclick =` 抛 TypeError ✓，
  //    后面整段初始化都不跑了 ✓（不是"少个按钮"，是整页哑掉 ✓）。

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
    try { await enterApp(); } catch (e) {
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