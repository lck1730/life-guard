  //
  // 展示**这个群自己**的组件 —— 服务端按 `group_id` 分目录 ✓
  // （`/api/components?group_id=`），所以别的群的东西**根本不会出现在这儿** ✓；
  // 这一点**不靠前端过滤** ✓（过滤是能绕过的 ✗）。
  //
  // ★ 2026-10-07 用户重新定的形状 ✗→✓：
  //     · **不分区了** ✓（"不需要分实验区和使用区，右上角点击进入就只是单纯地
  //       罗列组件" ✓ —— 理由他自己给了：都在沙箱里、组件之间本来就隔离 ✓）
  //     · 这一屏**只剩"列出来"** ✓：一行一个组件 ✓，未固化的挂个标识 ✓
  //     · **"做"挪到了输入框的 ＋** ✓ —— 那里现在进的是**导航屏**（`openWsNav` ✓）
  // ── ★ 「组件界面」自己的外观（2026-10-08）─────────────────────────────
  //
  // 由**「组件界面diy」那条对话**写出来的一段 CSS ✓（存 `var/wall/g<群>/style.css` ✓，
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
  const _SCREEN_SEL = /^(#workshop|#wsChat|#compView|\.screen|body|html|:root)$/i;
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
    const old = $('#wall-diy');
    if (old) old.remove();
    if (!css || !css.trim()) return;                 // 没改过 → 默认样子 ✓
    const st = document.createElement('style');
    st.id = 'wall-diy';
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

  const openWorkshop = () => {
    pushScreen('workshop');
    applyWallCss();
    // ⚠️ **先推屏、再画** ✗→✓ —— 画要发请求（几十毫秒 ✓）；
    //    反过来的话那几十毫秒里这一屏是空的 ✓，看着像"点了没反应" ✓。
    renderWorkshop();
  };

  const closeWorkshop = () => {
    // ⚠️ 原来这里要"退出调整模式" ✓（模式是隐藏状态 ✓，最容易被忘 ✓）——
    //    **那个模式没有了** ✓（2026-10-08 ✓），所以这一段也空了 ✓：
    //    长按拖动没有"模式"可言 ✓，进来什么样、出去还是什么样 ✓。
    // ⚠️ 那件外套要**摘掉** ✓（见 `applyWallCss` 那段：它只在看这一屏时该生效 ✓）
    const st = $('#wall-diy');
    if (st) st.remove();
    popScreen('workshop');
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

  const paintCanvas = () => {
    const box = $('#wsBody');
    box.innerHTML = '';                       // 下面全部走 createElement，不进 innerHTML ✓
    if (!wsCanvas.length) {
      // ★ 空状态那句话 ✓（2026-10-08 用户给的原话：
      //   「当没有组件的时候只会在界面居中位置提示：当前还没有组件，
      //     去创意工坊创建一个组件吧」✓）。
      // ⚠️ **后半句改了** ✗→✓（2026-10-09）——「去创意工坊」那个入口**没有了** ✓
      //    （用户：「主群聊右上角的按钮进入的不再是导航页，而是新建组件的
      //    聊天界面」✓）→ 留着那句话就是在**指一条走不通的路** ✓
      //    （而且他现在看到这一屏的**第一眼**多半就是它 ✓：新空间里一个组件都没有 ✓）。
      const em = document.createElement('div');
      em.className = 'wsempty';
      em.textContent = '当前还没有组件，去群里右上角让他做一个吧';
      box.appendChild(em);
      return;
    }
    // ⚠️ 这里原来有一句"按住一个拖到别处"的提示 ✓（只在调整模式里出现 ✓）——
    //    调整模式没了 ✓，那句话跟着没了 ✓（这一屏**一句提示都不该有** ✓，
    //    除非用户在拉 —— 那种短提示在 `bindWallDrag` 里临时画 ✓）。
    const g = document.createElement('div');
    g.className = 'canvas';
    wsCanvas.forEach((c, i) => g.appendChild(canvasCell(c, i)));
    box.appendChild(g);
    // ★ **平时一句提示都不放** ✗→✓ —— 2026-10-07 晚上用户定的：
    //   「将群聊右上角点开的界面做成**纯粹的展示界面**，里面**不要有任何的提示
    //     和设置选项**」✓。"未固化"那颗点是**状态**，留着 ✓；
    //   而"要去哪儿做新的""点保留才算数"那些话是**说明**，一律不放 ✓。
    //   唯一的例外是**调整模式里那一句** ✓（见上 ✓）。
  };

  /** 画布上的一格 —— **组件自己声明长什么样** ✓（`spot` ✓，见 main.py 的 `_spot_of` ✓）。 */
  const canvasCell = (c, i) => {
    const sp = c.spot || {};
    const el = document.createElement('div');
    el.className = 'cell';
    el.dataset.i = String(i);
    // ⚠️ **格子数要夹在 1..3** ✓ —— 服务端已经夹过一次了 ✓，
    //    这里再夹一次是**防前端自己**：万一以后哪条路传进来一个 99 ✓，
    //    那一格会占满整屏 ✓，而"排不下"是**看不出来**的（别的都不见了 ✓）。
    el.style.gridColumn = 'span ' + Math.max(1, Math.min(3, +(sp.w || 1)));
    el.style.gridRow = 'span ' + Math.max(1, Math.min(3, +(sp.h || 1)));
    if (sp.tint) el.style.background = sp.tint;
    const ic = document.createElement('span');
    // ⚠️ 这里原来有一颗「未固化」的小黄点 ✓ —— 2026-10-07 深夜跟着"固化"
    //    整套一起删了 ✓（用户定的："组件聊天没有所谓的固化和非固化概念了"✓）。
    ic.className = 'ico';
    setIcon(ic, c.icon);
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = c.title || c.slug;
    el.append(ic, nm);
    return el;
  };

  // ── 拖一下换位置 ✓：**长按才拎起来** ✗→✓（2026-10-08）──────────────
  //
  // 原来入口是右上角一个十字图标（"调整模式" ✓）—— 那个按钮没了 ✓，
  // 所以改成**直接在格子上长按** ✓。用户说位置要能调 ✓，而这一屏不能有按钮 ✓，
  // 这两条合起来只有这一个做法 ✓。
  //
  // ⚠️ **拖动用 Pointer 事件，不用 HTML5 那套** ✗（`dragstart/drop` 在触摸屏上
  //    基本不触发 ✓，而这一屏全在手机上 ✓）。
  // ⚠️ **拖的时候不重排，只高亮** ✗→✓ —— 一边拖一边重渲染的话，
  //    被手指按住的那个元素会被**销毁重建** ✓ → 指针捕获当场丢掉 ✓ →
  //    拖着拖着就不动了 ✓。所以拖动时只改 `transform` ✓，松手才改数组 ✓。
  //
  // ⚠️ 一个手指在格子上有**三种结局** ✗（这是这一屏最容易做拧的地方 ✓）：
  //     · 短按（<450ms）        → 进这个组件 ✓
  //     · 长按后**动了**         → 换位置 ✓（松手才落库 ✓）
  //     · 长按后**没动**         → 弹小卡片（去它那条对话 ✓）——
  //       这是**第二条路** ✓：用户指定的那条是**下拉** ✓（两条都通 ✓，
  //       长按那条只是顺手，免得"长按了却什么都没发生" ✓）。

  // ★ 一个格子上有**两种**结局，不是三种 ✗→✓（2026-10-08 实测改的）：
  //
  //     · **没动过**（不管按多久） → 打开这个组件 ✓
  //     · **动过**                 → 换位置 ✓（松手才落库 ✓）
  //
  //   ⚠️ 原来还有第三种"长按不动 → 弹小卡片" ✗ —— 那是我想的 ✓，用户没要 ✓，
  //      而且它**正好吃掉了点击** ✗：真机上"有意地点一下"很容易超过 450ms ✓ →
  //      计时器先到 ✓ → 判成"拎起来" ✓ → 松手弹的是那张卡片 ✗ →
  //      用户看到的就是**点了没反应** ✓（他报的就是这一条 ✓）。
  //
  //   ⚠️ 所以现在**只有一条判定路**：`pointerdown` 起计时器 ✓、`pointerup` 定结局 ✓，
  //      并且**不看 click 事件** ✗（pointer 事件鼠标和手指都发 ✓，
  //      两套都听会**开两次** ✗ —— 这正是"点击/长按"这类代码最容易出的错 ✓）。
  let wsDrag = null;
  let wsPressTimer = null;
  let wsPressAt = null;

  const saveArrangement = async () => {
    try {
      await api(`/components/spots?group_id=${group.id}`, {
        method: 'POST',
        body: JSON.stringify({ order: wsCanvas.map(c => c.slug) }),
      });
    } catch (e) {
      // ⚠️ **存不上要说** ✓ —— 不说的话用户拖了半天、退出去再进来，
      //    东西全回到原位 ✓，而那看起来像"它自己变回去了" ✓（像见鬼 ✓）。
      toast('位置没存上：' + e.message);
    }
  };

  const cellUnder = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const cell = el && el.closest ? el.closest('#wsBody .cell') : null;
    return cell && cell !== (wsDrag && wsDrag.el) ? cell : null;
  };

  /** 打开一个格子 ✓ —— 点一下就进**这个组件**那一屏（纯预览 ✓）。
   *
   *  ⚠️ 「组件界面diy」那一格不画出来 ✓（用户：「组件收纳界面不要有
   *    组件界面diy这个图标和入口，它本身点进去不是一个独立组件」✓，
   *    服务端就筛掉了 ✓，见 `main.py:_scan_components` ✓）。
   *  ★ 2026-10-13：要改组件回群聊点右上角、进统一聊天说 ✓ —— 下拉进编辑那套
   *    整个撤了 ✓，这一屏只剩预览 ✓。
   */
  const openCell = (c) => {
    if (!c) return;
    // ★ 把这一格的底色一起带进去 ✓ —— 组件页滑进来的头一帧就刷它 ✓
    //   （见 `openComp` 里那句 ✓）。没有 tint 的组件给空串 ✓（那它就还是原底色 ✓）。
    openComp(c.slug, c.title, (c.spot && c.spot.tint) || '');
  };

  const endDrag = (commit) => {
    const d = wsDrag;
    wsDrag = null;
    if (!d) return;
    d.el.classList.remove('drag');
    d.el.style.transform = '';
    d.el.style.pointerEvents = '';           // ★ 拖的时候关掉它，见下面那段 ✓
    document.querySelectorAll('#wsBody .cell.over').forEach(e => e.classList.remove('over'));
    if (!commit) return;
    // ★ **没动过 = 点它** ✗→✓（见上面那段：原来这里弹卡片 ✗）
    if (!d.moved) { openCell(d.c); return; }
    const to = d.over == null ? d.from : d.over;
    if (to !== d.from) {
      const [item] = wsCanvas.splice(d.from, 1);
      wsCanvas.splice(to, 0, item);
      paintCanvas();
      saveArrangement();
    }
  };

  $('#wsBody').addEventListener('pointerdown', (ev) => {
    const cell = ev.target.closest('#wsBody .cell');
    if (!cell) return;
    wsPressAt = { x: ev.clientX || 0, y: ev.clientY || 0 };
    clearTimeout(wsPressTimer);
    // ⚠️ 这里**不 preventDefault** ✗ —— 那会把"从格子上起手的滚动"也掐掉 ✓
    //    （组件多了就滚不动了 ✓）。拦横向是 CSS 的 `pan-y` 在管 ✓。
    wsPressTimer = setTimeout(() => {
      wsPressTimer = null;
      const c = wsCanvas[Number(cell.dataset.i) || 0];
      if (!c) return;
      wsDrag = { el: cell, c, from: Number(cell.dataset.i) || 0, over: null,
                 moved: false, x0: wsPressAt.x, y0: wsPressAt.y };
      cell.classList.add('drag');
      // ★ **被拖的那一个要从"命中测试"里摘出去** ✗→✓ ——
      //   不摘的话，`elementFromPoint` 在手指底下永远先撞到**它自己** ✓
      //   （它就在手指那儿 ✓），于是"落在谁身上"永远是 null ✓ →
      //   整个拖动看着能拖、松手却**什么都没发生** ✓（最难查的那种"没坏但没用"✓）。
      cell.style.pointerEvents = 'none';
      try { cell.setPointerCapture(ev.pointerId); } catch (e) { /* 没有捕获也能拖 ✓ */ }
    }, 450);
  });

  $('#wsBody').addEventListener('pointermove', (ev) => {
    if (!wsDrag) {
      // 还没拎起来就动了 → 那多半是在**滚动** ✓（或手指滑开了 ✓）→ 别判成长按 ✓
      if (wsPressTimer && wsPressAt) {
        const dx = Math.abs((ev.clientX || 0) - wsPressAt.x);
        const dy = Math.abs((ev.clientY || 0) - wsPressAt.y);
        if (dx > 6 || dy > 6) { clearTimeout(wsPressTimer); wsPressTimer = null; wsPressAt = null; }
      }
      return;
    }
    const dx = ev.clientX - wsDrag.x0, dy = ev.clientY - wsDrag.y0;
    if (!wsDrag.moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) wsDrag.moved = true;
    wsDrag.el.style.transform = `translate(${dx}px, ${dy}px)`;
    const under = cellUnder(ev.clientX, ev.clientY);
    document.querySelectorAll('#wsBody .cell.over').forEach(e => {
      if (e !== under) e.classList.remove('over');
    });
    if (under) {
      under.classList.add('over');
      wsDrag.over = Number(under.dataset.i);
    }
  });

  $('#wsBody').addEventListener('pointerup', (ev) => {
    const wasTimer = !!wsPressTimer;
    if (wsPressTimer) { clearTimeout(wsPressTimer); wsPressTimer = null; }
    if (wsDrag) { endDrag(true); return; }
    if (!wasTimer) return;                    // 已经被 pointermove 判成"滚动了" ✓
    // ★ **短按**（计时器还没到）→ 直接开 ✓ —— 不等 click 事件 ✓（只留一条路 ✓）
    const cell = ev.target.closest('#wsBody .cell');
    if (cell) openCell(wsCanvas[Number(cell.dataset.i) || 0]);
  });
  $('#wsBody').addEventListener('pointercancel', () => {
    if (wsPressTimer) { clearTimeout(wsPressTimer); wsPressTimer = null; }
    endDrag(false);
  });

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
    //   ★ 2026-10-13：进统一聊天**只留群聊右上角一个入口** ✓ —— 下拉那套撤了 ✓
    //     （用户定的 ✓）。这一屏现在是**纯预览** ✓：要改它，回群聊点右上角、
    //     在统一聊天里说就行 ✓（组件知识已在 system prompt 里注入 ✓）。
  };

  //: 当前正在看的那个组件 ✓（`setWsHead` 点名字跳组件页时判"是不是同一个"用 ✓）
  let compCur = null;

  const closeComp = () => {
    compCur = null;
    popScreen('compView');
    // ⚠️ **退回工坊要重画一次** ✗→✓ —— 不然刚才改过的东西还挂在旧样子上 ✓，
    //    用户会以为"点了没用" ✓（这就是那种"明明成功了却像失败"的毛病 ✓）。
    if ($('#workshop').classList.contains('on')) renderWorkshop();
  };

  // ── 对话屏：工坊里的那段对话（2026-10-07，入口在输入框的 ＋）──────────
  //
  // ⚠️ **和群聊那段不是一套东西** ✗→✓：群聊是"群里好几个人在说话、它自己决定要不要插嘴" ✓，
  //    那边有判断闸、缓冲合并、说话前复审 ✓；这里是**你一个人对着它** ✓ —— 那些一个都不要 ✓
  //    （留着只会带来「它怎么又不理我」✓，App 管家那边已经得过这个结论 ✓）。
  //
  // ★ 服务端那边是**三层分开**的 ✗→✓（2026-10-07 重写过 ✓）：
  //     · 记忆（profile）**共用** ✓ —— 它记得群里的事 ✓（用户点名要的 ✓）
  //     · 会话（Hermes 那边的历史）**每条对话一份** ✓（`…-diy-u<你>-t<任务>` ✓）
  //     · 气泡（`workshop_messages`）同样按对话分 ✓
  //   于是群聊一个字都不会多 ✓，而**做 A 时说的话不会跑进 B 的上下文里** ✓。
  //   只有两个关键节点会往群里发系统消息（开工 / 做好 ✓）——那是服务端发的 ✓。
  //
  // ★ 用户 2026-10-07 定的还有两条，都落在这一屏上：
  //     · **默认进来是上一次那条对话** ✓（服务端按 `updated_at` 算 ✓，不用本地存储 ✓）
  //     · **点顶栏中间换一条 / 开一条新的** ✓；**切走就掐掉上一轮** ✓（含子代理 ✓）

  //: 当前这条对话。`task` 是钥匙 ✓（`null` = 还没打开任何一条 ✓）。
  //: ⚠️ **`seen` 只在同一条对话里有效** ✗ —— 换对话时要清 ✓（不然两条对话里
  //:    恰好 id 相同的那种情况会被误判成"画过了" ✓ —— 虽然理论上不会撞 ✓，
  //:    但清一下是零成本的 ✓，而"以为画过了所以没画"是最难查的一类毛病 ✓）。
  //: ⚠️ `kept`（固化了没有）**2026-10-07 深夜删掉了** ✗→✓ —— 用户定了
  //:    「组件聊天没有所谓的固化和非固化概念了」✓。前端一个字都不再提它 ✓。
  //: `assistant` = diy 小助手的名字和头像 ✓（气泡上要用 ✓）。
  const wsCur = { task: null, slug: '', title: '',
                  assistant: { name: 'diy 小助手', avatar: '' },
                  streaming: null, streamBuf: '', seen: {}, tasks: [] };

  //: 这条对话里的消息，按 id 存一份 ✓ —— **左右滑引用**要回头找它的完整信息 ✓
  //: （滑动拿到的是 DOM 行 ✓，而行里只有个 id ✓）。和群聊的 `_msgs` 同一个用途 ✓。
  //: ⚠️ **换对话时要清** ✗ —— 不清的话 id 是**表级自增** ✓、两条对话不冲突 ✓
  //:    但会一直涨 ✓（一条长对话翻完能存几百条 ✓，纯属白占 ✓）。
  const _wsById = new Map();

  /**
   * 输入框里那句浅浅的占位提示 ✓（**没打字的时候才看得见** ✓，一打字就没了 ✓）。
   *
   * ★ 2026-10-09 用户定的两条文案（原话）：
   *     · 「组件界面diy」那条 → **「想怎么修改组件界面？」**
   *     · 别的组件            → **「想怎么diy？，先改，改完再看」**
   *   ⚠️ 文案**照他写的原样抄** ✗ —— 中间那个逗号看着像顺手打的 ✓，
   *      但"改用户给的字"这件事不该我自作主张 ✓（要改让他说一声 ✓）。
   *   ⚠️ 它跟着"**当前是哪一条对话**"变 ✓ → 由 `setWsHead` 统一刷 ✓
   *      （换对话的入口四五处 ✓，每处各写一遍迟早漏一处 ✓）。
   */
  const setWsPlaceholder = () => {
    const el = $('#wsText');
    if (!el) return;
    el.placeholder = wsCur.slug === WALL_SLUG
      ? '想怎么修改组件界面？'
      : '想怎么diy？';        // ⚠️ 2026-10-09 用户定的：**只要这四个字** ✗→✓
                              //    （原来是「想怎么diy？，先改，改完再看」✓ ——
                              //      后半句是我照他上一条原样抄的 ✓，他这一版说不要 ✓）
  };

  const setWsHead = () => {
    setWsPlaceholder();
    const t = $('#wsTitle');
    // ⚠️ **这里是"有没有 slug"在决定标题** ✗→✓（2026-10-07 深夜，用户报的：
    //    「起了个名字叫功德木鱼…但是主界面显示的竟然是做一个新的」✓）。
    //
    //    原来那一句是 `slug ? (title || slug) : '做一个新的'` ✗ ——
    //    意思是"还没做成组件 → 就叫'做一个新的'" ✓。可**你现在是能给它起名字的** ✓
    //    （点「新建组件」时先问名字 ✓）—— 于是"起了名字、还没做出来"这个**正常状态**
    //    被它当成了"没起名" ✓，名字被**丢掉** ✗。
    //    （重命名弹层里显示的是对的 ✓ —— 因为那边读的是 `wsCur.title` ✓，
    //      数据一直是好的 ✓，只是**这一行没看它** ✓。）
    //
    //    现在：**名字优先** ✓ —— 有名字就写名字 ✓。
    //    ★ 2026-10-13：统一聊天里（没 slug、不是 wall ✓）顶上写**助手名** ✓ ——
    //    不再是「做一个新的」✗（那是"一组件一对话"那会儿的词 ✓，现在是一条连续的聊天 ✓）。
    //    wall 那条照旧写它自己的名字 ✓（「组件界面diy」✓）；做成组件的旧对话照旧写组件名 ✓。
    const diyName = (wsCur.assistant && wsCur.assistant.name) || 'diy 小助手';
    t.textContent = wsCur.task
      ? (wsCur.title || wsCur.slug || diyName)
      : '创意工坊';
    // 这里原来挂过一枚「未固化」的小牌子 ✓ —— 跟着"固化"整套一起去掉了 ✓（见上 ✓）。
    // ★ **「组件界面diy」那条：右上角什么都没有** ✗→✓（2026-10-09 用户定的：
    //   「组件界面diy的界面，没有右上角三个点，没有重命名，没有删除组件，
    //    啥都没有，默认不可编辑，只能编辑界面」✓）。
    //   ⚠️ 用 `visibility` 而不是 `display`/`hidden` ✗ —— `header.sub h2` 是
    //      `flex:1` 靠**两边各占 40px** 才居中的 ✓：把右边那颗按钮抽走，
    //      标题会往右偏 ✓（占位留着才居得中 ✓）。
    //   ⚠️ 服务端那两道闸门**早就有了** ✓（`task_rename` / `component_delete`
    //      都对 `wall` 报 403 ✓）—— 这里藏按钮是**不给人一个按了会挨骂的按钮** ✓，
    //      不是安全边界 ✓（边界在服务端 ✓）。
    const isWall = wsCur.slug === WALL_SLUG;
    const more = $('#wsMore');
    // ★ 2026-10-11：组件页那条**也开了 ⋯** ✗→✓ —— 用户改了主意 ✓（原话：
    //   「组件页面统计，新增右上角三个点，和普通组件聊天比没有删除功能，
    //    重名的加上吧，自由度高一些，反正只是显示」✓）。
    //   差别不在「有没有 ⋯」上 ✓，在**菜单里有什么**上 ✓ ——
    //   组件页没有「删除组件」✓（服务端那道闸门还在 ✓，见 `component_delete` ✓）。
    if (more) more.style.visibility = '';
    // ★ 名字**点不动** ✓ —— 点它的意思是"去看这个组件" ✓，而它**不是一个组件** ✓
    //   （点进去会是一个空白的沙箱页 ✓，那比不可点更让人犯嘀咕 ✓）。
    t.disabled = !wsCur.slug || isWall;
    t.onclick = () => {
      if (!wsCur.slug || isWall) return;
      // ★ 点名字 → **去看这个组件** ✓。
      // ⚠️ 2026-10-09：`#wsChat` 现在**严格压在** `#compView`（28 > 26 ✓）上面了 ✓
      //    （见 CSS 那段）—— 所以这里**先关掉这一屏再推**的那套**不用了** ✓。
      //    而且如果底下**已经就是它**（下拉进来的那条路 ✓，组件页一直开着 ✓），
      //    就不必再推一次 ✓ —— 推了等于把同一个组件页**重画一遍** ✓
      //    （沙箱 iframe 会白一下 ✓，看着像闪了一下 ✓）。
      const sameComp = $('#compView').classList.contains('on')
                    && compCur && compCur.slug === wsCur.slug;
      closeWsChat();
      if (!sameComp) openComp(wsCur.slug, wsCur.title || wsCur.slug);
    };
  };

  /** 落地一条对话的全部界面状态（历史 + 标题 + 谁在改）✓。 */
  const showTask = (d) => {
    wsCur.task = Number(d.task_id ?? d.id ?? (d.task && d.task.id)) || null;
    const t = (d.task && d.task) || d;
    wsCur.slug = t.slug || '';
    wsCur.title = t.title || '';
    if (d.assistant) wsCur.assistant = d.assistant;
    wsCur.streaming = null;
    wsCur.streamBuf = '';
    wsCur.seen = {};
    // ⚠️ **换对话要把输入状态清干净** ✗→✓ —— 待发的图和引用都是**这条对话**的事 ✓：
    //    带到另一条去，用户会看到"我明明没选那张图"✓（而它其实是从上一条跟过来的 ✓）。
    _wsById.clear();
    if (wsPending) { URL.revokeObjectURL(wsPending.url); wsPending = null; }
    wsQuote = null;
    syncWsPending();
    setWsQuoteBar();
    setWsHead();
    const box = $('#wsMsgs');
    box.innerHTML = '';
    // ★ 这块位置原来有**两条说明文字** ✗→✓（2026-10-09 用户定的：
    //   「用户第一次进入新的组件聊天**不要有**"说说你想要什么***"和
    //     "这条对话还是空的"提示」✓；第 4 条也说了「组件聊天界面…**就只需要
    //     在聊天框里提示**」✓）——
    //   所以**两种都不要了** ✓：
    //     · 全新的那条 → 由**它自己先开口** ✓（那条问候是服务端插的真消息 ✓，
    //       见 `_greeting` ✓）；之前那段"说说你想要什么"就多余了 ✓。
    //     · 改已有组件的那种 → 输入框里那一句就够了 ✓（见下 ✓）。
    //   ⚠️ 别在这里补"解说" ✗ —— 用户对这两条的原话就是**嫌它们碍事** ✓。
    setWsPlaceholder();
    const list = (d.messages || []);
    list.forEach(m => addWsMsg(m));
    box.scrollTop = box.scrollHeight;
    // ⚠️ **进来的时候它可能还在做** ✗→✓ —— 服务端把状态一起给了 ✓
    //    （切回来、退出重进、刷新 ✓ —— push 早就过去了 ✓，只能**读** ✓）。
    //    `making`（在等子代理交付 ✓）优先于 `busy`（这一轮在跑 ✓）：
    //    前者要**一直挂着** ✓，后者是短的 ✓。
    setWsStatus(d.making ? 'working' : (d.busy ? 'thinking' : 'idle'));
    // ★ **别人正在改它** ✗→✓（2026-10-07 深夜用户定的 ✓）：
    //   「如果有个组件某个用户正在创建和修改…**此时其他用户进入时会被提示**」✓。
    //   ⚠️ 服务端**只报别人** ✓（自己那条正在跑是正常状态 ✓，
    //      界面上那个转圈就是它 ✓ —— 再弹一句只会让人莫名其妙 ✓）。
    if (d.editing && d.editing.nickname) {
      toast('⚠️ ' + d.editing.nickname + ' 正在改这个组件 —— '
            + '你这边改的不会丢，但两个人同时动它容易撞上');
    }
  };
  const setIcon = (el, icon) => {
    const v = String(icon || '');
    el.textContent = '';
    if (v.startsWith('data:image/')) {
      const im = document.createElement('img');
      im.src = v;                      // ★ 内联的 ✓ —— 组件在沙箱里，图不能联网取 ✓
      im.alt = '';
      el.classList.add('imgi');
      el.appendChild(im);
    } else {
      el.classList.remove('imgi');
      el.textContent = v || '🧩';
    }
  };

  /** 把 diy 小助手的头像画到几个地方 ✓ —— 顶栏那颗、气泡旁边、设置屏里 ✓。 */

  /**
   * 按**一个已经拼好的 URL** 画头像 ✓（`/ui/...` 那种 ✓）。
   *
   * ⚠️ **不能用群聊那个 `paintAvatar`** ✗ —— 它会把相对路径拼到**壳**的域名上 ✓
   *    （用户的头像住在壳那边 ✓）。而小助手的头像住在这个服务自己的
   *    `/ui/` 下 ✓ —— 拼错了就是**取不到、只剩一个首字** ✓，
   *    而"头像没显示"看起来永远像"还没设置" ✓（不会有人想到是拼错了域名 ✓）。
   */
  const paintZhi = (el, url, fallback) => {
    const ch = String(fallback || '?').slice(0, 1);
    el.textContent = ch;
    el.style.backgroundImage = '';
    if (!url) return;
    const probe = new Image();
    probe.onload = () => {
      el.textContent = '';
      el.style.backgroundImage = "url('" + url + "')";
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
    };
    probe.src = url;
  };
  const openTaskById = async (tid, from) => {
    // ★ **先问"能不能进"，再推屏** ✗→✓（2026-10-11）——
    //   ⚠️ 顺序不能反 ✗：先推再被服务端拒掉的话，用户看到的是
    //     "那一屏推进来又退回去" ✓ —— 正是这个项目最怕的"点了像坏了"✓。
    //   ⚠️ 这一趟 `wsReloadTasks` 顺便把**别人的**改动也捞回来 ✓（`editing` ✓），
    //     一顿往返买两样 ✓；代价是每次进对话多约 20ms ✓，值 ✓。
    if (tid != null) {
      await wsReloadTasks();
      const hint = wsBusyHint(tid);
      if (hint) { toast(hint); return false; }
    }
    if (!$('#wsChat').classList.contains('on')) pushScreen('wsChat', from);
    try {
      const d = await api(`/workshop/${group.id}/tasks/${tid}/open`, { method: 'POST' });
      // ★ **服务端那道闸才是判据** ✓ —— 前端这份可能已经旧了 ✓（见 `wsBusyHint` ✓）。
      if (d && d.ok === false) { toast(d.error || '现在打不开这条'); return false; }
      showTask(d);
      return true;
    } catch (e) {
      toast('这条对话打不开：' + e.message);
      closeWsChat();
      return false;
    }
  };

  /**
   * ★ **断线回来把工坊这条也补上** ✗→✓（2026-10-11）。
   *
   *   原来重连**只补群聊** ✓（`syncMissed` 打的是 `/groups/{id}/messages` ✓），
   *   工坊**一个字都不补** ✗ →
   *     · 断线窗口里丢掉的那条收尾 `ws_message` **永远回不来** ✓，
   *       而流式气泡**只有它才会被摘掉** ✓（见 `04-chat.js` 那段 ✓）→
   *       屏幕上**卡着半截回复** ✓，下一轮的话还会**接着往它上面写** ✗。
   *
   *   ⚠️ **不做增量补** ✗，直接把这条**重开一次** ✓（`openTaskById` ✓ 重新拉历史 ✓）：
   *      一条工坊对话就 200 条以内 ✓，重拉最省心 ✓；
   *      而且它顺手把 `wsCur.streaming` 复位 ✓ —— 那正是要治的东西 ✓。
   *   ⚠️ **只在"这一屏开着"的时候做** ✓（没开就不管 ✓ —— 进来的时候自然会拉 ✓）。
   *   ⚠️ 它**不推屏** ✓（`openTaskById` 里那句"已经 on 了就不推"✓）——
   *      重连不该让人看见屏幕动一下 ✓。
   */
  const wsResync = async () => {
    if (!$('#wsChat').classList.contains('on')) return;
    if (!wsCur.task) return;
    await openTaskById(wsCur.task);
  };

  /**
   * 从**组件页那个图标**进来：找我**自己**为这个组件开过的对话 ✓；
   * 没有就现开一条**冲着它去**的 ✓。
   *
   *
   * ⚠️ **先把组件页关掉** ✗→✓ —— 用户定的是"每个组件界面左上角 < 用于返回
   *    **导航界面**" ✓：所以从预览页那个图标进来之后，返回应该落到导航 ✓，
   *    而不是落回**刚才那一页** ✓（那里可能刚刚被你删掉了 ✓ ——
   *    回到一个已经不存在的组件的预览上，是最难解释的一种错 ✓）。
   */
  /** ★ 进**那条统一的 diy 聊天** ✓（2026-10-13）—— 一群一条、连续着聊 ✓。
   *    组件不再各开一条对话了 ✗→✓：claude 桥路径下做完一个组件**不会把对话钉成那个组件的**
   *    （MCP `confirm_component` 不带 task_id ✓ → 票 task_id 为空 ✓ → `components_save` 里那句
   *    `UPDATE workshop_tasks SET slug` 因 `if task_id:` 直接跳过 ✓），所以那条 NULL-slug
   *    的对话就是**统一的**那条 ✓ —— 群聊右上角每次都进它 ✓。
   *    `prefill` 给个开场（别处想带一句进来时用 ✓；角上那条路传空 ✓）。
   *    ⚠️ wall（组件界面本身）也在这条里改 ✓ —— 服务端 `_wall_task_ok` 已松闸 ✓
   *       （task_id 为空 = claude 桥路径 = 放行 ✓）；claude 用 `set_wall_style` MCP 工具改 ✓。 */
  const openUnifiedChat = async (prefill, from) => {
    await wsReloadTasks();
    const hint = wsBusyHint(null);
    if (hint) { toast(hint); return; }
    const uni = wsCur.tasks.find(t => !t.slug);   // null / 空串都算「统一那条」✓
    let opened = false;
    if (uni) {
      opened = await openTaskById(uni.id, from || 'corner');
    } else {
      // 第一次进：建那条统一的（**不起名** ✓ —— 名字等真做出组件时由 agent 定 ✓）。
      //   ⚠️ 服务端会替它先开口一句问候 ✓（`_greeting` ✓，见 `tasks_new` ✓）。
      opened = await wsNewTask('', '');
      if (opened) pushScreen('wsChat', from || 'corner');
    }
    if (opened && prefill) {
      // 只在**输入框还空着**时填 ✓ —— 别把他打到一半的字冲掉 ✓。
      const ta = $('#wsText');
      if (ta && !ta.value) { ta.value = prefill; syncWsSend(); ta.focus(); }
    }
  };

  // ★ 2026-10-13：`openTaskForSlug` 撤了 ✗→✓ —— 下拉进编辑那套整个没了 ✓
  //   （只留群聊右上角进统一聊天 ✓）。进哪条都走 `openUnifiedChat` ✓。

  /** 开一条新的 ✓（只置状态，不推屏 ✓ —— 推屏由调用方决定 ✓）。返回成没成 ✓。 */
  const wsNewTask = async (slug, title) => {
    try {
      const t = await api(`/workshop/${group.id}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ slug: slug || '', title: title || '' }),
      });
      // ⚠️ **"正占着"是 200 + ok:false** ✗→✓（2026-10-11）—— 不是 HTTP 错误 ✓
      //    （`api()` 只在非 2xx 时抛 ✓）→ 不接的话会拿着 undefined 去 `showTask` ✗
      //    （同 `sendWs` 里那条注释 ✓，两处一个形状 ✓）。
      //    ★ **服务端这道闸必须留着** ✓ —— 只靠前端挡的话，绕一下就能开第二条 ✓
      //      （右上角那条路本来就是"先建再进"✓），那道闸就等于没有 ✓。
      if (t && t.ok === false) {
        wsCur.doing = t.doing || wsCur.doing;
        toast(t.error || '现在不能开新的');
        return false;
      }
      showTask(t);
      await wsReloadTasks();
      return true;
    } catch (e) {
      // ⚠️ **额度那句话要原样给他看** ✓ —— 它是服务端写的、说清了"手上是哪几个、
      //    下一步能干什么" ✓。糊成"操作失败"他就只能来问我们了 ✓。
      toast(e.message);
      return false;
    }
  };

  const wsReloadTasks = async () => {
    try {
      const d = await api(`/workshop/${group.id}/tasks`);
      wsCur.tasks = d.tasks || [];
      // ★ **顺手把小助手和"谁正在改"也带上** ✗→✓（2026-10-09）——
      //   这两样原来是 `renderWsNav` 捎带刷的 ✓，而导航屏**没有入口了** ✓
      //   （下拉进编辑那套撤了 ✓，进哪条都走群聊右上角 → `openUnifiedChat` ✓）
      //   → 不挪过来的话，气泡上那个名字和头像
      //   会一直是**默认的**「diy 小助手」✓（改了名也不变 ✓ —— 而那看起来
      //   像"改了没保存" ✓）。
      if (d.assistant) wsCur.assistant = d.assistant;
      wsCur.editing = d.editing || {};
      // ★ 顺手把「**现在正占着哪条**」也带上 ✗→✓（2026-10-11）——
      //   它由**服务端**算 ✓（后端 `_doing_for` ✓），这边只是拿它挡一下 ✓。
      wsCur.doing = d.doing || null;
      return d;
    } catch (e) { return null; }   // 拉不到不影响正在看的这一条 ✓
  };

  /**
   * ★ **能不能进这条对话** ✗→✓（2026-10-11 用户定的规矩，见后端 `_doing_for` 那段）。
   *
   *   它正在做/改某一条的时候，**别的都进不去** ✓，话照用户给的原话 ✓：
   *   「[diy 助手昵称]正在[组件名称]，不能分心哦」✓。
   *   ⚠️ 这一条替掉了原来的「打开另一条 → 把你正在跑的那轮掐掉」✗→✓。
   *
   *   ⚠️ 这一份只是"**别让他白点一下**" ✓ —— **判据在服务端** ✓：
   *      这边这份可能已经旧了 ✓（另一台设备上刚开的活，这边不知道 ✓）。
   *      所以两处都要有 ✓：这里挡在**推屏之前**（屏不闪 ✓），服务端兜底（真拦得住 ✓）。
   *   ⚠️ `tid` 是**它自己那条**时要放行 ✓ —— 界面每次进这一屏都会"打开一次" ✓，
   *      那不是分心 ✓（判据是任务号 ✓）。
   *   ⚠️ `tid` 传 `null` = "我要**开一条新的**" ✓ —— 那种只要有人在跑就挡 ✓
   *      （主群聊右上角走的就是这条路 ✓）。
   */
  const wsBusyHint = (tid) => {
    const d = wsCur.doing;
    if (!d) return '';
    if (tid != null && Number(d.task_id) === Number(tid)) return '';
    const name = (wsCur.assistant && wsCur.assistant.name) || 'diy 小助手';
    return name + '正在「' + (d.title || '一个组件') + '」，不能分心哦';
  };

  /** 按照务器的当前值，把顶栏那个名字刷一遍 ✓（改名之后用 ✓）。 */
  const refreshCurrent = async () => {
    const d = await wsReloadTasks();
    if (!d) return;
    const t = wsCur.tasks.find(x => Number(x.id) === Number(wsCur.task));
    if (!t) return;
    wsCur.slug = t.slug || '';
    wsCur.title = t.title || '';
    setWsHead();
  };

  /** 退出这条对话 ✓ —— **回到它底下原来那一屏** ✓（收纳页 / 组件页 / 群聊 ✓）。
   *
   *  ★ 2026-10-09：原来这里退的是**导航屏** ✗→✓ —— 现在底下是什么就回什么 ✓
   *    （用户：「在组件收纳页…此时如果手势返回还是要进入组件收纳页」✓；
   *     「在具体组件内时…返回时回到各自组件」✓）。这两条**都是"回底下那一屏"** ✓，
   *     所以这一屏不用判断自己是从哪儿来的 ✓ —— `popScreen` 本来就是那个意思 ✓。
   */
  const closeWsChat = () => {
    popScreen('wsChat');
    // ⚠️ 底下的收纳页要**重画 + 重挂外观** ✗→✓ —— 说不定刚刚
    //    （a）做好了一个组件 ✓（b）删了一个 ✓（c）让管家把这一屏改了个样 ✓。
    //    不重挂的话（c）最要命 ✓：他刚让管家改完界面，退出来**还是老样子** ✓
    //    → "说了半天没改" ✓（这个项目里最常见的那种"看着像没做" ✓）。
    if ($('#workshop').classList.contains('on')) {
      applyWallCss();
      renderWorkshop();
    }
  };

  /** ★ **群聊右上角那个按钮** ✗→✓（2026-10-13）—— 直接进**那条统一的 diy 聊天** ✓。
   *
   *   原来「一组件一对话」那会儿：没做出组件就续上次那条、做出来了就开新的（先起名）✓。
   *   现在**一条连续的聊天** ✓：claude 桥做完一个组件不会把对话钉成那个组件的 ✓
   *   （见 `openUnifiedChat` 那段 ✓），所以那条 NULL-slug 的对话**永远是统一的**那条 ✓
   *   —— 角上每次都进它 ✓，不再起名、不再「已自动恢复」✗（那是"一组件一对话"才有的概念 ✓）。
   *   要做个新组件：在聊天里说就行 ✓（组件知识已在 system prompt 里注入 ✓）。
   */
  const openNewCompChat = () => openUnifiedChat('', 'corner');

  // ── 正文的渲染（2026-10-07）─────────────────────────────────────────
  //
  // 两件事，都是用户报的：
  //   ① 「回答的时候有些渲染不出来，出现一堆 `**`」✓ —— 它写的是 markdown ✓，
  //      而原来这里是 `textContent = ...` ✗ → 原样显示 ✓。
  //   ② 「问问题最好可视化：一共几个、一个一个问」✓ —— 它在问题前面写
  //      `[问 2/3]` 或 `[问 追问]` ✓（人格里约定的 ✓）→ 这里画成小标签 ✓。
  //
  // ⚠️ **全程 createElement + textContent** ✗→✓ —— 这是**模型写的字** ✓，
  //    进 `innerHTML` 就是注入 ✓（群聊那边也是这么办的 ✓，同一个规矩 ✓）。
  const fmtInline = (el, text) => {
    // ⚠️ **别在这个正则里写裸的反引号** ✗→✓ —— 2026-10-07 撞的：
    //    部署前那道"检查未定义名字"的闸会**剥字符串** ✓，而它按字符扫描 ✓，
    //    看到一个裸反引号就以为"模板字符串开始了" ✗ → 把**后面整段代码**当字符串吃掉 ✓
    //    → 于是 `openSheet` / `logout` 这些定义在它眼里**凭空消失** ✓
    //    → 报一堆"调用了但没定义" ✗ → **部署被自己的误报挡住** ✓。
    //    用 `\x60` 写反引号 ✓，扫过去就是个普通转义 ✓。
    const re = /(\*\*[^*\n]+\*\*|[\x60][^\x60\n]+[\x60])/g;
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      const raw = m[0];
      const s = document.createElement(raw.startsWith('**') ? 'b' : 'code');
      s.textContent = raw.startsWith('**') ? raw.slice(2, -2) : raw.slice(1, -1);
      el.appendChild(s);
      last = m.index + raw.length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  };

  // ★ 2026-10-12：**代码块搬上来了** ✗→✓（用户：「代码渲染搬上来吧」✓）——
  //   diy 小助手张口就是代码 ✓，原来 ``` 围栏只会原样躺成一堆反引号 ✗。
  //   切成一段段：普通文字走原来那套（粗体/行内代码/问题标签/列表 ✓），
  //   代码段画成**终端窗口**（三个窗点 + 语言名 + 复制按钮 ✓）。
  //   ⚠️ **流式半途围栏没闭合** ✓ —— 最后那段没等来回合 ``` 的也当代码画 ✓，
  //      不然流式全程代码都以纯文本漏着、闭合那一刻才"跳变" ✗。
  const MC_ICON = {
    dots: '<svg viewBox="0 0 38 10" width="38" height="10"><circle cx="5" cy="5" r="4" fill="#ff5f57"/><circle cx="19" cy="5" r="4" fill="#febc2e"/><circle cx="33" cy="5" r="4" fill="#28c840"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    done: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12.5 9.5 18 20 6.5"/></svg>',
  };
  const splitCode = (text) => {
    const fence = '\x60\x60\x60';    // ⚠️ 别写裸反引号 ✗（部署闸会剥字符串 ✓，见 fmtInline ✓）
    const out = [];
    let rest = String(text == null ? '' : text);
    while (rest) {
      const i = rest.indexOf(fence);
      if (i < 0) { out.push({ t: 'text', body: rest }); break; }
      const head = rest.slice(0, i).replace(/\n+$/, '');
      if (head) out.push({ t: 'text', body: head });
      rest = rest.slice(i + 3);
      const nl = rest.indexOf('\n');
      const j = rest.indexOf(fence);
      if (j < 0) {                   // 没闭合：第一行当语言名、剩下都是代码 ✓
        const lang = nl < 0 ? rest.trim() : rest.slice(0, nl).trim();
        out.push({ t: 'code', lang, body: nl < 0 ? '' : rest.slice(nl + 1) });
        break;
      }
      const hasLang = nl >= 0 && nl < j;
      out.push({ t: 'code',
                 lang: hasLang ? rest.slice(0, nl).trim() : '',
                 body: (hasLang ? rest.slice(nl + 1, j) : rest.slice(0, j)).replace(/\n$/, '') });
      rest = rest.slice(j + 3).replace(/^\n/, '');
    }
    return out;
  };

  /** 一块代码 → 一个终端窗口 ✓（全程 createElement/textContent ✓，模型写的字不进 innerHTML ✓）。 */
  const mkCodeCard = (lang, body) => {
    const card = document.createElement('div');
    card.className = 'mcode';
    const head = document.createElement('div');
    head.className = 'mchead';
    const dots = document.createElement('span');
    dots.className = 'mcdots';
    dots.innerHTML = MC_ICON.dots;              // 静态 SVG ✓（不是模型写的 ✓）
    head.appendChild(dots);
    const lg = document.createElement('span');
    lg.className = 'mclang';
    lg.textContent = lang || 'code';
    head.appendChild(lg);
    const cp = document.createElement('button');
    cp.className = 'mccopy';
    cp.setAttribute('aria-label', '复制代码');
    cp.innerHTML = MC_ICON.copy;
    cp.onclick = (ev) => {
      ev.stopPropagation();
      // `copyText` = 05-settings.js 里那个老办法 ✓（clipboard API 在 http 下是哑的 ✓）
      const ok = copyText(body);
      if (!ok) { toast('复制不了 —— 长按自己选'); return; }
      cp.innerHTML = MC_ICON.done; cp.classList.add('done');
      setTimeout(() => { cp.innerHTML = MC_ICON.copy; cp.classList.remove('done'); }, 1600);
    };
    head.appendChild(cp);
    const pre = document.createElement('pre');
    pre.className = 'mcbody';
    pre.textContent = body;
    card.append(head, pre);
    return card;
  };

  const fillBubble = (el, text) => {
    el.textContent = '';
    splitCode(text).forEach((part) => {
      if (part.t === 'code') { el.appendChild(mkCodeCard(part.lang, part.body)); return; }
      part.body.split('\n').forEach((line, i) => {
        if (i) el.appendChild(document.createElement('br'));
        const q = line.match(/^\s*\[问\s*([0-9]{1,2}\/[0-9]{1,2}|追问)\]\s*(.*)$/);
        if (q) {
          const chip = document.createElement('span');
          chip.className = 'qchip';
          chip.textContent = /^[0-9]/.test(q[1]) ? ('问题 ' + q[1]) : '追问';
          el.appendChild(chip);
          fmtInline(el, q[2]);
          return;
        }
        const li = line.match(/^\s*[-*]\s+(.*)$/);
        if (li) {
          const dot = document.createElement('span');
          dot.className = 'mli';
          el.appendChild(dot);
          fmtInline(el, li[1]);
          return;
        }
        fmtInline(el, line);
      });
    });
  };

  // ── 那条对话的输入状态（待发的图 / 引用）✓ ──────────────────────────
  //
  // ★ 2026-10-07 深夜：和生活管家**同一套规矩** ✓ ——
  //   图片选完先停在待发区 ✓、引用是**输入状态**的一部分 ✓（发完就没了 ✓）。
  //   ⚠️ 但**一条消息只发一次** ✗→✓（和群聊不一样 —— 群聊是"图一条、字一条"✓，
  //      而工坊**每发一次就起一轮对话** ✗：发两条 = 第二轮撞上"它手上还有活" ✓）。
  //      所以这里的图和字**合成一条**走 ✓（正好也是用户说的"一起发送"✓）。
  let wsPending = null;      // {file, url}
  let wsQuote = null;        // {id, sender_type, msg_type, content}

  /** 引用条上的「谁」—— **三种可能** ✓（2026-10-12 ✓）：
      · 小助手 ✓（名字是群级设置、随时能改 ✓，所以每次现取 ✓）
      · **我** · **群里另一个人** ✓（各自的真昵称 ✓）
      ⚠️ 原来只判 `sender_type`、人的那一支一律写「你」✗ ——
         那是「这条对话里只有你和我」那套 ✓。
         对话改成**群共享**之后，被引用的那条可能是**另一个人**发的 ✗
         → 引用条上写着「你」✗（其实是你自己没说过那句话 ✗）。 */
  const wsQuoteWho = (q) => q.sender_type === 'agent'
    ? (wsCur.assistant.name || 'diy 小助手')
    : ((q && q.sender_nickname) || '某人');

  /** 气泡里那块引用条 ✓ —— 和群聊那份**同一套 class** ✓（`.quote` ✓）。 */
  const buildWsQuoteEl = (q) => {
    const el = document.createElement('div');
    el.className = 'quote';
    const who = document.createElement('div'); who.className = 'qwho';
    who.textContent = wsQuoteWho(q);
    const tx = document.createElement('div'); tx.className = 'qtext';
    tx.textContent = q.msg_type === 'image' ? '[图片]' : (q.content || '');
    el.append(who, tx);
    return el;
  };

  const wsQuoteText = (m) => (m.msg_type === 'image' ? '[图片]'
                             : (m.content || '').slice(0, 60));

  const setWsQuoteBar = () => {
    const el = $('#wsQbar');
    if (!el) return;
    if (!wsQuote) { el.hidden = true; return; }
    $('#wsQwho').textContent = wsQuoteWho(wsQuote);
    $('#wsQtext').textContent = wsQuoteText(wsQuote);
    el.hidden = false;
  };

  /** 待发那张图的缩略图 ✓ —— 选完**不立刻发** ✓（用户定的 ✓）。 */
  const syncWsPending = () => {
    const box = $('#wsPend');
    if (!box) return;
    box.textContent = '';
    if (!wsPending) { box.hidden = true; return; }
    box.hidden = false;
    const pv = document.createElement('div');
    pv.className = 'pv';
    // ★ 2026-10-08：附件可能是文件/音频了 ✓ → 不再是"一律一张缩略图" ✗
    //   （音频拿 `<img src=blob>` 会画出一个裂图 ✓，那看着像坏了 ✓）。
    let img;
    if ((wsPending.kind || 'image') === 'image') {
      img = document.createElement('img');
      img.src = wsPending.url;
    } else {
      img = mkel('div', 'fchip', (wsPending.file && wsPending.file.name) || '附件');
    }
    const rm = document.createElement('div');
    rm.className = 'rm';
    rm.textContent = '✕';
    rm.onclick = () => {
      URL.revokeObjectURL(wsPending.url);
      wsPending = null;
      syncWsPending();
      syncWsSend();
    };
    pv.append(img, rm);
    box.appendChild(pv);
  };

  const addWsMsg = (m) => {
    if (m && m.id != null) {
      if (wsCur.seen[m.id]) return;      // WS 推回来的 + 本地先画的那条，只算一次 ✓
      wsCur.seen[m.id] = 1;
    }
    const box = $('#wsMsgs');
    // ⚠️ **「这条是不是我自己发的」要拿 `user_id` 比** ✗→✓（2026-10-12，用户实测报的）——
    //   对话改成**群共享**之后，一条对话里可能有**好几个成员**发的话 ✓。
    //   原来只判 `sender_type === 'user'` ✗，于是群里另一个人打开这条对话时，
    //   **别人发的那条也被当成「我发的」** ✗，而且错得很像坏了：
    //   · 画在**我这一侧** ✗
    //   · 挂的是**我的头像、我自己的昵称** ✗（用户原话：
    //     「群里谁发的就是谁发的，不该混淆」✓）
    //   · 而且**头顶不挂名字** ✗ —— 因为名字"只挂在它那边"，
    //     那一侧正好被算成了「我的」✗ → 谁发的**彻底看不出来** ✗
    //   和群聊那边**同一个判据** ✓（`04-chat.js` 的 `m.sender_id === me.id` ✓）。
    const isUser = m.sender_type === 'user';
    const mine = isUser && m.user_id != null && !!me && m.user_id === me.id;
    const peer = isUser && !mine;          // 群里另一个人发的 ✓
    // ⚠️ 长按要回头找这条消息的完整信息 ✓（引用用 ✓）—— 和群聊那边同一张表 ✓。
    if (m && m.id != null) _wsById.set(m.id, m);
    const row = document.createElement('div');
    row.className = 'mkrow ' + (mine ? 'mine' : 'agent');
    if (m && m.id != null) row.dataset.id = String(m.id);
    // ★ 头像（2026-10-07 深夜 ✓）—— 用户定的「组件聊天界面也需要有用户区别」✓。
    //   三方各自那张图 ✓：我 → 我自己的 ✓；群里另一个人 → **他自己的** ✓
    //   （2026-10-12 ✓）；小助手 → 它那张 ✓。没头像时都是一个首字兜 ✓。
    //   ⚠️ **成员的头套用 `shellURL`** ✗→✓ —— 用户头像住在壳那边 ✓，
    //      小助手那张住在本服务的 `/ui/` 下 ✓（见 `paintZhi` 那段 ✓）；
    //      拼错了就是"取不到、只剩一个首字"✗，看着永远像"还没设置"✗。
    const av = document.createElement('div');
    av.className = 'av';
    if (mine) paintZhi(av, shellURL(me && me.avatar), (me && me.nickname) || '我');
    else if (peer) paintZhi(av, shellURL(m.user_avatar), m.user_nickname || '?');
    else paintZhi(av, wsCur.assistant.avatar, wsCur.assistant.name || '助');
    // ★ **点头像进详情** ✗→✓（用户定的："比如点击头像进入详情啊"✓）——
    //   和群聊那边**同一条去向** ✓：它 → **小助手的设置** ✓（名字头像都在这儿改 ✓）；
    //   我 → 回壳的「我的」 ✓（那才是"你自己的详情" ✓，这儿没有第二份 ✓）；
    //   群里另一个人 → **他的那一屏** ✓（可设备注 ✓）—— 和群聊那个头像同款 ✓。
    // ⚠️ 回壳时**要带上 `'wsChat'`** ✗→✓（2026-10-08）—— 带上了，
    //   从「我的」按返回才会**回到这条对话** ✓；不带的话回的是群聊首页 ✗
    //   （用户原话："点击自己头像进入我的，但是返回的却是生活管家聊天界面"✓）。
    av.onclick = (ev) => {
      ev.stopPropagation();
      if (mine) openMe();
      else if (peer) openPeer(m.user_id);
      else openDiySet();
    };
    const wrap = document.createElement('div');
    wrap.className = 'wrap2';
    if (!mine) {
      // ⚠️ 名字**只挂在不属于我的那些气泡上** ✓ ——
      //   我自己的名字我自己知道 ✓；
      //   别人的名字**必须写出来** ✓（否则分不清是谁发的 ✗）；
      //   小助手那个名字**随时能改** ✓，所以每次现取 ✓。
      const who = document.createElement('div');
      who.className = 'who';
      who.textContent = peer ? (m.user_nickname || '?')
                             : (wsCur.assistant.name || 'diy 小助手');
      wrap.appendChild(who);
    }
    const b = document.createElement('div');
    b.className = 'mkbub';
    if (m && m.msg_type === 'file' && m.media_path) {
      b.classList.add('media');
      b.appendChild(fileCard(m));
    } else if (m && m.msg_type === 'audio' && m.media_path) {
      b.classList.add('media');
      b.appendChild(audioBar(m));
    } else if (m && m.msg_type === 'image' && m.media_path) {
      b.classList.add('media');
      const img = document.createElement('img');
      img.src = '/media/' + m.media_path;
      img.onclick = () => openLightbox(img.src);
      b.appendChild(img);
      if ((m.content || '').trim()) {
        const cap = document.createElement('div');
        cap.className = 'cap';
        fillBubble(cap, m.content);
        b.appendChild(cap);
      }
    } else {
      fillBubble(b, (m && m.content) || '');   // ★ 渲染（粗体/代码/列表/问题标签 ✓），不进 innerHTML ✓
    }
    // ⚠️ **引用条要在正文之后挂** ✗→✓ —— `fillBubble` 第一句就是
    //    `el.textContent = ''` ✓，先挂上去的会被它一起擦掉 ✓
    //    （群聊那边就是这么坏了很久的 ✓，见 `addMsg` 那段注释 ✓）。
    //    插到最前面 = "引用条在气泡最上面" ✓，和微信一样 ✓。
    if (m && m.quote) b.insertBefore(buildWsQuoteEl(m.quote), b.firstChild);
    wrap.appendChild(b);
    row.append(av, wrap);
    box.appendChild(row);
    box.scrollTop = box.scrollHeight;
    // ⚠️ 返回的是**气泡**（不是整行 ✓）—— 流式那一段拿它往里追加字 ✓
    //    （`wsCur.streaming.textContent += …` ✓）。
    return b;
  };

  const setWsStatus = (state) => {
    const el = $('#wsStatus');
    if (!el) return;
    // ★ 2026-10-07 深夜用户定的**两种**状态 ✓：
    //   · 平时 →「**{它的名字}** 思考中…」✓ —— 名字是**它会变的那个** ✓，
    //     所以每次现取 ✓（写死"diy 小助手"的话，改完名字这儿还写着旧的 ✓）
    //   · 派了子代理去写组件时 →「**组件制作中…**」✓ —— 那一段最长（十几分钟 ✓），
    //     而且**性质不一样** ✓：那不是在"想"，是在**干活** ✓，用户等的东西也不同 ✓。
    //
    //   状态由**服务端在准确的那一刹那推** ✓（`components/confirm` 里 ✓），
    //   我们这边只是换个说法 ✓（见 `push_workshop_status` ✓）。
    const name = wsCur.assistant.name || 'diy 小助手';
    const text = { thinking: name + ' 思考中…',
                   working: '组件制作中…',
                   done: '做好了', idle: '' }[state] || '';
    // ★ 两档**分得开** ✓（见 CSS 那段 ✓）：思考是转圈 ✓，"在做"是稳的点 + 强调色 ✓。
    el.classList.toggle('busy', state === 'working');
    // ⚠️ 写那个 **`<span>`**，不是外层 ✗→✓ —— 外层里还有个转圈的 `<i>` ✓，
    //    往外层写 textContent 会**把转圈一起抹掉** ✓（文字有了、圈没了 ✓，看着像卡住 ✓）。
    $('#wsStatusText').textContent = text;
    el.hidden = !text;
    // ★ **「停掉」只在"有活在手上"的时候露** ✗→✓（2026-10-11）——
    //   见 `#wsStop` 那段：`thinking` / `working` 才停得掉 ✓；
    //   `done` / `idle` 没东西可停 ✓ → 藏起来 ✓。
    //   ⚠️ 一个"点了没反应"的按钮**比没有按钮更让人犯嘀咕** ✓（这个项目的老结论 ✓）。
    const stop = $('#wsStop');
    if (stop) stop.hidden = !(state === 'thinking' || state === 'working');
  };

  const sendWs = async () => {
    const ta = $('#wsText');
    const t = (ta.value || '').trim();
    const pic = wsPending;
    if (!t && !pic) return;
    if (!wsCur.task) { toast('先开一条对话'); return; }
    ta.value = ''; ta.style.height = 'auto';
    wsPending = null; syncWsPending();
    const q = wsQuote; wsQuote = null; setWsQuoteBar();
    syncWsSend();
    try {
      // ⚠️ **图和字合成一条** ✗→✓（见上面那段 ✓）——
      //    分两条发的话，第二条会撞上"它手上还有一个在做"✓（每一发就是一轮 ✓）。
      let mediaPath = '';
      if (pic) {
        const up = await uploadFile(pic.file);   // 复用群聊那个上传 ✓
        mediaPath = up.path;
        URL.revokeObjectURL(pic.url);
      }
      const d = await api(`/workshop/${group.id}/tasks/${wsCur.task}/chat`, {
        method: 'POST',
        body: JSON.stringify({
          content: t,
          // ⚠️ **类型要跟着附件走** ✗→✓ —— 原来写死 `'image'` ✓，
          //    而现在附件可能是文件/音频 ✓（写死的话它们会被当成图片 ✓，
          //    管家那边就只看到一张不存在的图 ✗）。
          msg_type: pic ? (pic.kind || 'image') : 'text',
          media_path: mediaPath,
          reply_to: q ? q.id : null,
        }),
      });
      // ⚠️ **"它手上还有活"是 200 + ok:false** ✗→✓ —— 不是 HTTP 错误 ✓
      //    （`api()` 只在非 2xx 时抛 ✓）→ 不单独接的话，这里会拿着 undefined 去画 ✗。
      //    它本来就是一条**给用户看的话** ✓，所以原样显示、并把输入还给他 ✓。
      if (d && d.ok === false) {
        toast(d.error || '它现在没法接这一句');
        ta.value = t; syncWsSend();
        return;
      }
      addWsMsg(d.message);                // 先画出来 ✓（WS 也会推一次，靠 id 去重 ✓）
    } catch (e) {
      toast('没发出去：' + e.message);
      ta.value = t; syncWsSend();
    }
  };

  const syncWsSend = () => {
    const ta = $('#wsText');
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(120, ta.scrollHeight) + 'px';
    // ★ **右边那个按钮：有字显示发送、没字显示加图** ✓（用户定的 ✓）——
    //   待发区有图时也要能发 ✓（图发出去不用配字是允许的 ✓）。
    const typed = !!(ta.value || '').trim();
    $('#wsSend').style.display = typed ? 'flex' : 'none';
    $('#wsPick').style.display = typed ? 'none' : 'flex';
  };

  // ── 长按 → **交给系统**；引用 → **右滑** ✗→✓（2026-10-11）──────────────
  //
  // ★ 和群聊那边**同一条规矩**（用户：「长按消息不再有小卡片，就是默认系统的
  //   复制行为」✓、「将引用变为右滑消息」✓）—— **两处必须一起改** ✗：
  //   同一条消息在两个地方长按出不同的结果，是最难解释的一种 ✓。
  //
  // ⚠️ **长按那个监听整个删了** ✗ —— 群聊那边还留着一个（头像 → @ 他 ✓），
  //   而这边**连 @ 都不做** ✓：这里只有你和助手两个人 ✓，@ 谁都是它 ✓，
  //   做了只会往输入框塞一个没意义的例子 ✓ → 一个监听都不需要 ✓。
  //   ⚠️ **不要为了"对称"在这边补一个空监听** ✗ —— 系统那套是由 CSS 打开的
  //      （见 app.css 那段 ✓），JS 这边**本来就该什么都不做** ✓。

  /** ★ **把工坊里一条消息变成引用** ✓ —— 右滑那条手势的落点（见 `05-settings.js` ✓）。
   *
   *  ⚠️ **工坊的引用状态和群聊是两套** ✗（`wsQuote` vs `pendingQuote` ✓）——
   *    这里只动工坊那一套 ✓：两条对话**可能同时开着** ✓
   *    （组件页底下压着群聊 ✓），碰错了就是"在 A 里滑了一下、引用条出现在 B 上"✓。
   */
  const quoteWsMsg = (id) => {
    const m = _wsById.get(Number(id));
    if (!m) return;
    wsQuote = m;
    setWsQuoteBar();
    $('#wsText').focus();
  };

  /**
   * 顶栏那个 ⋯ —— 用户 2026-10-07 晚上定的两件事：**删除组件**、**重命名组件** ✓
   *（"不仅可以删除组件，也可以重命名组件，重命名会同步所有地方"✓）。
   * 另外两样（保留 / 取消保留）放在这儿，是因为**组件页现在是一屏纯预览** ✓ ——
   * 那个动作得有个地方做 ✓，而这里就是"这个组件的事都在这儿"的地方 ✓。
   *
   * ⚠️ **没做出组件的那种对话，菜单里没有重命名** ✓ —— 名字是 agent 定名时给的 ✓
   *（它得同时定 slug ✓，那是目录名 ✓）。那种对话只有"删掉这次对话"✓。
   */
  const openWsMenu = async () => {
    // ★ 组件页（`wall`）那条**也开 ⋯** 了 ✗→✓ —— 2026-10-09 那轮把它整个关掉的
    //   规矩，用户 2026-10-11 改了主意 ✓（「自由度高一些，反正只是显示」✓）。
    //   差别只有一条：**没有「删除组件」** ✓ —— 服务端那道闸门也没撤 ✓
    //   （`component_delete` 对 `wall` 照样报 403 ✓）。
    await wsReloadTasks();
    const t = wsCur.tasks.find(x => Number(x.id) === Number(wsCur.task));
    const p = $('#sheetPanel');
    p.innerHTML = '';
    // ⚠️ **顶上那个组件名去掉了** ✗→✓（用户 2026-10-07 深夜看着截图定的：
    //    「组件名不显示」✓）。它就在顶栏上写着 ✓，这里再来一行是多余的 ✓ ——
    //    而且它和下面那两行长得一样 ✓，看着像三个都能点的条目 ✗。
    const grp = document.createElement('div');
    grp.className = 'wsmenu';
    p.appendChild(grp);

    const mk = (label, fn, danger) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = fn;
      if (danger) b.style.color = '#e06a6a';
      grp.appendChild(b);
      return b;
    };

    // ★ 2026-10-07 深夜：原来这里还有「保留这一版 / 取消保留」两项 ✗→✓ ——
    //   用户定了「组件聊天没有所谓的固化和非固化概念了」✓，一起删掉了 ✓。
    //   2026-10-11 又加了两项：**导出 / 导入** ✓（用户点名的 ✓），
    //   于是现在是**重命名 ✓、导出 ✓、导入 ✓、删除**（组件页少一条删除 ✓）。
    if (t && t.slug) {
      // ★ 组件页（`wall`）的**重命名要改两处** ✗→✓ —— 名字住在**两个地方** ✓：
      //   对话上（`workshop_tasks.title` ✓ —— 顶栏上写的那个 ✓）和
      //   组件上（`components.title` ✓ —— 收纳页 / 组件界面上写的那个 ✓）。
      //   各改一处就会出现"两个地方各叫各的"✗。改名本来就是「反正只是显示」✓，
      //   那就**两处都改成同一个** ✓。
      //   ⚠️ 对话那个改了**不回滚** ✓ —— 两个都是显示名 ✓，第二个没跟上
      //   顶多是一处暂时没同步 ✓，比"用户点了保存、什么都没变"好得多 ✓。
      const isWallChat = t.slug === WALL_SLUG;
      mk('重命名', () => {
        if (!isWallChat) return openRenameSheet(t.slug, t.title || '');
        openNameSheet({
          heading: '重命名',
          initial: t.title || '',
          cta: '保存',
          save: async (name) => {
            const r = await api(`/workshop/${group.id}/tasks/${wsCur.task}/title`,
                                { method: 'PATCH', body: JSON.stringify({ title: name }) });
            wsCur.title = (r.task && r.task.title) || name;
            try {
              await api(`/components/${WALL_SLUG}/rename?group_id=${group.id}`,
                        { method: 'POST', body: JSON.stringify({ title: name }) });
            } catch (e) { toast('名字改好了（组件那一份没跟上）'); return; }
            await refreshCurrent();
            if ($('#workshop').classList.contains('on')) renderWorkshop();
            toast('改好了');
          },
        });
      });
      // ★ **导出 / 导入** ✗→✓（2026-10-11 用户定的）——
      //   「每个组件存三份」的上限一加上 ✓，"想留一份"就只能**出仓库**了 ✓，
      //   这两个入口就是那个口子 ✓。
      mk('导出当前版本', () => wsExport(t.slug));
      mk('导入新版本', () => wsImport(t.slug));
      // ★ 「删除组件等于删除对话」✓ —— 所以删的是**整块**（不传版本号 ✓），
      //   服务端会把文件、所有版本、这条对话一起收掉 ✓。
      // ⚠️ **`danger=true` 那个参数原来漏了** ✗→✓（2026-10-07 深夜，用户看着截图
      //    报的："删除组件红色字体" ✓）—— `mk()` 的第三个参数没传 ✓，
      //    于是那一行**跟别的长得一模一样** ✓（红色根本就没设上 ✓）。
      //    这类"样式没生效"从代码上很难一眼看出来 ✓（那行确实有一句
      //    `if (danger) …红色` ✓，只是**没人给它 danger** ✓）。
      //
      // ★ 代价改由**确认框**说 ✓（用户定的："弹出个框提示一下，二次确认就行"✓）——
      //   菜单里那一行**干干净净三个字** ✓，点下去才弹框 ✓。
      //   ⚠️ **先把菜单关了再弹** ✓ —— 不关的话那个从底下升上来的菜单
      //      会**压在确认框下面** ✓（z-index 虽然够 ✓，但视觉上是两层东西叠着 ✓）。
      // ★ **组件页（`wall`）没有这一条** ✗→✓（2026-10-11 用户定的：
      //   「和普通组件聊天比没有删除功能」✓）。
      //   ⚠️ **服务端那道闸门也没撤** ✓ —— `component_delete` 对 `wall`
      //   照样报 403 ✓（它是唯一能改组件界面外观的入口 ✓）。
      if (!isWallChat) {
        mk('删除组件', async () => {
          closeSheet();
          const ok = await confirmBox({
            title: '删除组件',
            // ★ 措辞照用户 2026-10-10 的原话 ✓（他看截图说的 ✓）——
            //   原来那句「删掉之后…都会没，撤不回来」是我写的 ✓，他换成这一句 ✓。
            body: '将会删除这个组件以及这个对话',
            ok: '删除',
            danger: true,
          });
          if (!ok) return;
          try {
            await api(`/components/${encodeURIComponent(t.slug)}?group_id=${group.id}`,
                      { method: 'DELETE' });
          } catch (e) { toast('没删掉：' + e.message); return; }
          toast('删了');
          backToWall();
        }, true);
      }
    } else {
      // ★ 2026-10-13：统一聊天这条**没有"当前组件"** ✓ —— 组件的改名/导出/导入/删除
      //   全收进「管理组件」✓（列一份清单、点哪个进哪个的动作 ✓）。
      //   原来「重命名」改的是**这条对话的名字** ✓ —— 统一聊天里顶栏写的是助手名 ✓
      //   （见 `setWsHead` ✓），对话名没意义了 ✗ → 去掉 ✗→✓。
      mk('管理组件', () => openCompManager());
      // ★ 菜单里那一行的名字 ✓（2026-10-10 用户：「是**重命名下面那个按钮**是
      //   删除对话」✓）—— 原来叫「删掉这次对话」✓，改成「删除对话」✓。
      mk('删除对话', async () => {
        closeSheet();
        const ok = await confirmBox({
          // ★ 抬头和正文都照用户 2026-10-10 的原话 ✓（他看截图说的 ✓）：
          //   抬头「删除对话」✓、正文「将会删除这个对话」✓ ——
          //   和「删除组件」那条并排看，两条的语气这才一致 ✓。
          title: '删除对话',
          body: '将会删除这个对话',
          // ★ 按钮是**「删除」两个字** ✓（2026-10-10 用户：「**二次确认的应该是删除**」✓）。
          //   ⚠️ 我上一条把它写成了「删除对话」✗ —— 那是**理解反了** ✓：
          //      菜单那一行（重命名下面那个）= 说清楚删什么（「删除对话」✓）；
          //      二次确认那颗按钮 = 就是那个动词（「删除」✓）✓。
          ok: '删除',
          danger: true,
        });
        if (!ok) return;
        try {
          await api(`/workshop/${group.id}/tasks/${wsCur.task}`, { method: 'DELETE' });
        } catch (e) { toast('没删掉：' + e.message); return; }
        toast('删了');
        backToWall();
      }, true);
    }

    const cancel = document.createElement('div');
    cancel.className = 'actions';
    const cbtn = document.createElement('button');
    cbtn.className = 'btn-ghost';
    cbtn.textContent = '取消';
    cbtn.onclick = closeSheet;
    cancel.appendChild(cbtn);
    p.appendChild(cancel);
    openSheet();
  };

  /** ⋯ 里的「管理组件」✓（2026-10-13）—— 统一聊天里没有"当前组件"了 ✓，
   *  组件的改名/导出/导入/删除全收在这里 ✓。列一份组件清单，点哪个进哪个的动作 ✓。
   *  ⚠️ wall **不在这儿管** ✓ —— 它那条对话自己有 ⋯（重命名走的是另一处 ✓）。 */
  const openCompManager = async () => {
    let comps = [];
    try {
      comps = (await api(`/components?group_id=${group.id}`)).components || [];
    } catch (e) { toast('打不开组件列表：' + e.message); return; }
    comps = comps.filter(c => c.slug !== WALL_SLUG);
    const p = $('#sheetPanel');
    p.innerHTML = '';
    p.appendChild(mkel('h3', null, comps.length ? '管理组件' : '还没有组件'));
    const grp = mkel('div', 'wsmenu');
    comps.forEach((c) => {
      const row = mkel('button', null, c.title || c.slug);
      row.onclick = () => openCompActions(c.slug, c.title || c.slug);
      grp.appendChild(row);
    });
    p.appendChild(grp);
    const acts = mkel('div', 'actions');
    const back = mkel('button', 'btn-ghost', '返回');
    back.onclick = openWsMenu;          // 回上一层 ⋯ ✓
    acts.appendChild(back);
    p.appendChild(acts);
    openSheet();
  };

  /** 一个组件的动作页 ✓（改名/导出/导入/删除 ✓）—— 「管理组件」里点哪格进它 ✓。 */
  const openCompActions = (slug, title) => {
    const p = $('#sheetPanel');
    p.innerHTML = '';
    p.appendChild(mkel('h3', null, title || slug));
    const grp = mkel('div', 'wsmenu');
    const mk = (label, fn, danger) => {
      const b = mkel('button', null, label);
      b.onclick = fn;
      if (danger) b.style.color = '#e06a6a';
      grp.appendChild(b);
    };
    mk('重命名', () => openRenameSheet(slug, title));
    mk('导出当前版本', () => wsExport(slug));
    mk('导入新版本', () => wsImport(slug));
    mk('删除组件', async () => {
      closeSheet();
      const ok = await confirmBox({
        title: '删除组件',
        body: '将会删除这个组件',
        ok: '删除',
        danger: true,
      });
      if (!ok) return;
      try {
        await api(`/components/${encodeURIComponent(slug)}?group_id=${group.id}`,
                  { method: 'DELETE' });
      } catch (e) { toast('没删掉：' + e.message); return; }
      toast('删了');
      openCompManager();              // 删完刷新清单 ✓
    }, true);
    p.appendChild(grp);
    const acts = mkel('div', 'actions');
    const back = mkel('button', 'btn-ghost', '返回');
    back.onclick = openCompManager;   // 回上一层 ✓
    acts.appendChild(back);
    p.appendChild(acts);
    openSheet();
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

  /**
   * 一个"起名字"的弹层 ✓ —— **两处都在用** ✓：新建组件时问名字 ✓、⋯ 里的重命名 ✓。
   *
   * ⚠️ 抽成一个是因为**它俩一模一样** ✓（一个输入框、两个按钮 ✓）——
   *    抄一份的话，将来"名字不能超过几个字""空名字怎么办"这类规矩
   *    就会在两处各说各话 ✓（这个项目在别的地方吃过这个亏 ✓）。
   *
   * ⚠️ 输入框的值走 `.value` **不进 innerHTML** ✓ —— 那是用户打的字 ✓。
   */
  const openNameSheet = ({ heading, initial, cta, hint, save }) => {
    const p = $('#sheetPanel');
    p.innerHTML = '';
    const h = document.createElement('h3');
    h.textContent = heading;
    p.appendChild(h);
    if (hint) {
      const d = document.createElement('div');
      d.className = 'rnhint';
      d.textContent = hint;
      p.appendChild(d);
    }
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.maxLength = 40;
    inp.value = initial || '';
    inp.placeholder = '比如：记账面板';
    inp.className = 'rninput';
    p.appendChild(inp);
    const acts = document.createElement('div');
    acts.className = 'actions';
    const cancel = document.createElement('button');
    cancel.className = 'btn-ghost';
    cancel.textContent = '取消';
    cancel.onclick = closeSheet;
    const go = document.createElement('button');
    go.className = 'btn-solid';
    go.textContent = cta || '保存';
    const submit = async () => {
      const name = (inp.value || '').trim();
      if (!name) { toast('先起个名字'); inp.focus(); return; }
      go.disabled = true;
      try {
        await save(name);
      } catch (e) {
        go.disabled = false;
        toast('没成：' + e.message);
        return;
      }
      closeSheet();
    };
    go.onclick = submit;
    inp.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } };
    acts.append(cancel, go);
    p.appendChild(acts);
    openSheet();
    setTimeout(() => inp.focus(), 120);      // 省一次点击 ✓（和别的弹层一个做法 ✓）
  };

  /** 把一份文本当**文件下载**下来 ✓（手机 WebView 上唯一可靠的方式 ✓）。 */
  const downloadText = (filename, text, mime) => {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // ⚠️ **晚一拍再收回 URL** ✗ —— 点击之后下载是异步起头的 ✓，
    //    立刻 `revokeObjectURL` 有机会把那次下载掐断 ✓。
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** ⋯ 里的**导出当前版本** ✓ —— 把一个 HTML 文件交到用户手里 ✓。 */
  const wsExport = async (slug) => {
    closeSheet();
    let text, ver;
    try {
      const r = await fetch(`/api/components/${encodeURIComponent(slug)}?group_id=${group.id}`,
                            { credentials: 'same-origin' });
      if (!r.ok) { toast('没拿到：' + (await r.text())); return; }
      text = await r.text();
      ver = (JSON.parse(text) || {}).version;
    } catch (e) { toast('没拿到：' + e.message); return; }
    downloadText(`${slug}-v${ver || 'latest'}.html`, text,
                 'text/html;charset=utf-8');
    toast('导出了一份文件');
  };

  /** ⋯ 里的**导入新版本** ✓ —— 挑一份文件，当**新一版**落进仓库 ✓。 */
  const wsImport = (slug) => {
    closeSheet();
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.html,.htm,text/html';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      // ⚠️ **40 万字符** 和后端那个上限对齐 ✓ —— 不先拦一道的话，
      //    手机上读一个几十兆的 HTML 到内存里 ✓，然后才被服务端拒掉 ✗。
      if (f.size > 400000) {
        toast('太大了（40 万字符以内）');
        return;
      }
      const text = await f.text();
      try {
        const d = await api(`/components/${encodeURIComponent(slug)}/import?group_id=${group.id}`,
                            { method: 'POST', body: JSON.stringify({ html: text }) });
        toast('导入成功：现在是 v' + d.version);
        // ★ 顶一下之后**把这条对话重新拉一遍** ✓ —— 服务端往里面写了句提示 ✓
        //   （或者忙的时候没写上 ✓），两种情况都靠这一次刷新看到 ✓。
        await refreshCurrent();
      } catch (e) {
        // ⚠️ **服务端原话直接给出来** ✗ —— 它说的是"哪一条不行" ✓
        //    （缺 html/body ✓、引了外部脚本 ✓…），不是笼统的"数据不可用"✗。
        toast('导入失败：' + e.message);
        // 失败的时候服务端**也在对话里留了一句** ✓（不发起模型回合 ✓），
        //   拉一遍让人看见 ✓。
        await refreshCurrent().catch(() => {});
      }
      inp.value = '';
    };
    inp.click();
  };

  /** ⋯ 里的重命名 ✓ —— 「重命名会同步所有地方」✓（用户 2026-10-07 晚上定的 ✓）。 */
  const openRenameSheet = (slug, current) => openNameSheet({
    heading: '重命名',
    initial: current,
    cta: '保存',
    save: async (name) => {
      await api(`/components/${encodeURIComponent(slug)}/rename?group_id=${group.id}`,
                { method: 'POST', body: JSON.stringify({ title: name }) });
      // ★ 服务端把**每一版**的标题一起改了 ✓，所以这里只要把**已经画出来的
      //   那一堆**重新拉一遍就行 ✓：本屏的标题 ✓、导航那一列 ✓、
      //   右上角那屏的格子名 ✓、以及 agent 下次 `component_list` 读到的名字 ✓
      //   （它读的就是同一个字段 ✓）。
      await refreshCurrent();
      if ($('#workshop').classList.contains('on')) renderWorkshop();
      toast('改好了');
    },
  });

  // ── diy 小助手的设置 ✓（2026-10-07 深夜）────────────────────────────
  //
  // 用户定的：「agent 叫 diy 小助手，这个小助手的信息可以在导航界面右上角进入，
  // 右上角展示头像，点击进去后可以设置头像，昵称和一些其他规则，
  // **暂时只有头像和昵称**」✓。而且「这个助手**每个组件里通用**」✓
  // —— 所以它存在**群**上（`groups.diy_name` / `diy_avatar` ✓），
  //    不是每条对话一份 ✓（那样改八遍也改不齐 ✓）。

  //: 选好但**还没上传**的头像 ✓ —— 和管家那边一个做法：
  //: 选完先在本地显示出来 ✓，点「保存」才真传 ✓（用户："最后一起保存"✓）。
  let diyFile = null;

  const openDiySet = async () => {
    diyFile = null;
    if (!$('#diySet').classList.contains('on')) pushScreen('diySet');
    await renderDiySet();
  };
  const closeDiySet = () => {
    diyFile = null;
    popScreen('diySet');
  };

  /**
   * diy 小助手的设置屏 ✓（2026-10-07 深夜用户定的：
   * 「我觉得 diy 助手点击后**可以参考管家的这个界面去布局**」✓）。
   *
   * ⚠️ **版式整个照抄改管家资料那一屏** ✗→✓ —— 不是"看着像" ✓，
   *    是**同一批 class**（`.card.avcard` / `.bigav` / `.tip` / `.field` /
   *    `.btn-save` / `.swap` ✓）→ 两边永远一起变 ✓。
   *    自己另写一套的话，用户改一边的间距、另一边的不会跟着动 ✓
   *    —— 而那是他**看得见**的不一致 ✓。
   *    那批数值（150px 头像、30px 的 tip 间距 ✓）是他 2026-10-06
   *    量着截图来回调出来的 ✓（CSS 里那句注释写着"别再自己发明"✓）。
   */
  const renderDiySet = async () => {
    const m = $('#diyBody');
    let d;
    try { d = await api(`/workshop/${group.id}/assistant`); }
    catch (e) { m.textContent = '打不开：' + e.message; return; }
    wsCur.assistant = d;
    m.textContent = '';

    // 卡片一：头像
    const card = mkel('div', 'card avcard');
    const f = mkel('input');
    f.type = 'file';
    f.accept = 'image/*';
    f.style.display = 'none';           // 原生文件框太丑，藏起来 ✓
    const big = mkel('div', 'bigav');
    const av = mkel('div', 'av');
    paintZhi(av, wsCur.assistant.avatar, wsCur.assistant.name || '助');
    av.onclick = () => f.click();       // **头像本身就是那个按钮** ✓，不多放按钮 ✓
    f.onchange = () => {
      const file = f.files && f.files[0];
      if (!file) return;
      // 选完**先在本地显示出来** ✓ —— 不然用户点完"看不到变化" ✓，
      // 会以为没选上、再点一次 ✓。
      shrinkToJpeg(file, 320).then(blob => {
        diyFile = new File([blob], 'a.jpg', { type: 'image/jpeg' });
        av.textContent = '';
        av.style.backgroundImage = "url('" + URL.createObjectURL(blob) + "')";
      }).catch(e => toast(e.message));
    };
    big.appendChild(av);
    card.appendChild(f);
    card.appendChild(big);
    card.appendChild(mkel('div', 'tip', '点击头像替换'));
    m.appendChild(card);

    // 卡片二：昵称 + 保存
    const card2 = mkel('div', 'card');
    card2.appendChild(mkel('label', null, '昵称'));
    const nm = mkel('input', 'field');
    nm.value = wsCur.assistant.name || '';
    nm.maxLength = 24;
    card2.appendChild(nm);
    const err = mkel('div', 'err', '');
    card2.appendChild(err);
    const save = mkel('button', 'btn-save', '保存');
    card2.appendChild(save);
    m.appendChild(card2);

    // 卡片**外面**的取消 ✓ —— 夹在卡片里会跑到「保存」上面去 ✗
    //（管家那边就是这么定的 ✓，两屏保持一致 ✓）。
    const back = mkel('div', 'swap');
    back.appendChild(mkel('b', null, '取消'));
    back.onclick = () => closeDiySet();
    m.appendChild(back);

    save.onclick = async () => {
      save.disabled = true;
      err.textContent = '';
      try {
        // ★ **最后一起保存** ✓（管家那边同一条规矩 ✓）：先传头像、再存昵称 ✓。
        if (diyFile) await uploadDiyAvatar(diyFile);
        const name = nm.value.trim();
        if (name && name !== wsCur.assistant.name) {
          wsCur.assistant = await api(`/workshop/${group.id}/assistant`,
                                      { method: 'PATCH', body: JSON.stringify({ name }) });
        }
        diyFile = null;
        toast('已保存');
        // ⚠️ **退回导航** ✓（管家那边改完也是退回去 ✓）——
        //    而且导航上那颗头像和气泡上的名字都得跟着变 ✓。
        closeDiySet();
      } catch (e) {
        err.textContent = e.message || '没存上';
        save.disabled = false;
      }
    };
  };

  /** 上传选好的头像 ✓ —— 只被「保存」调 ✓（见 `renderDiySet` 那段 ✓）。 */
  const uploadDiyAvatar = async (file) => {
    const fd = new FormData();
    // ⚠️ **缩完就是 JPEG** ✓（`shrinkToJpeg` 那个名字就是这么来的 ✓）——
    //    文件名还写 `.png` 的话，服务端按**内容**判类型 ✓ 但按**扩展名**存盘 ✓，
    //    于是会存出一个叫 `.png`、其实是 jpeg 的文件 ✓（能显示 ✓，但下一个人
    //    看目录时一定会以为哪儿写错了 ✓）。缩不了才可能真是 png ✓。
    fd.append('file', file, file.type === 'image/jpeg' ? 'a.jpg' : 'a.png');
    const r = await fetch(`/api/workshop/${group.id}/assistant-avatar`,
                          { method: 'POST', body: fd, credentials: 'same-origin' });
    if (!r.ok) throw new Error((await r.text()) || r.status);
    wsCur.assistant = await r.json();
  };

  /** 删掉一个组件（或一条对话）之后**退回收纳页** ✓。
   *
   *  ★ 2026-10-09 改：原来是"退回导航屏" ✗→✓ —— 导航屏**没有入口了** ✓
   *    （用户：「省去了导航界面的麻烦」✓），而组件本来就住在收纳页上 ✓
   *    （那才是"组件都在这儿"的那一屏 ✓）。
   *  ⚠️ **组件页也得关掉** ✗ —— 它底下那个组件**刚被删了** ✓，
   *     留着就是"回到一个已经不存在的组件上" ✓（最难解释的一种错 ✓）。
   */
  const backToWall = () => {
    wsCur.task = null;
    if ($('#wsChat').classList.contains('on')) popScreen('wsChat');
    if ($('#compView').classList.contains('on')) { compCur = null; popScreen('compView'); }
    if (!$('#workshop').classList.contains('on')) pushScreen('workshop');
    applyWallCss();
    renderWorkshop();
  };

  $('#openSettings').onclick = openSettings;
  // ★ 创意工坊（2026-10-07）—— 六个入口：右上角列组件 / ＋ 里进工坊 /
  //   导航屏退 / 组件页退 / 对话屏退 / 对话屏的 ⋯ ✓
  // ★ 右上角那个四格图标 ✓ —— 图标和位置**从头到尾没动过** ✓，
  //   变的一直是它去哪儿 ✓：
  //     · 2026-10-07：进收纳页 ✓
  //     · 2026-10-08：进「创意工坊」导航屏 ✓（收纳页改成左滑进 ✓）
  //     · **2026-10-09：进"新建组件"的那条对话** ✓（导航屏整个不用了 ✓，
  //        见 `openNewCompChat` 那段 ✓）—— 用户原话：「省去了导航界面的麻烦」✓。
  $('#openWorkshop').onclick = openNewCompChat;
  // ⚠️ 这里原来还有一句 `$('#wsDiy').onclick = openDiySet;` ✗→✓（2026-10-11）——
  //    `#wsDiy`（导航屏右上角那颗「助」头像）**随导航屏一起删了** ✓，
  //    而这一句还在 ✓ → `null.onclick = …` **加载即抛异常** ✗。
  //    ⚠️ **diy 设置没丢** ✓：它另有入口 —— 工坊里那颗 diy 头像（下面 `openDiySet` ✓）。
  $('#diyBack').onclick = closeDiySet;
  $('#wsBack').onclick = closeWsChat;
  // ⚠️ ⋯ **自己会先刷一次列表** ✗→✓ —— 菜单上"保留这一版（v几）"那几个字
  //    是从列表里算出来的 ✓：刚做完一个组件、还没刷的话，它会显示**上一版**的号 ✓
  //    （"我明明刚做完 v3，它说我保留的是 v2" ✓ —— 那是很难说得清的一种错 ✓）。
  $('#wsMore').onclick = openWsMenu;

  // ★ **「停掉这一轮」** ✗→✓（2026-10-11，用户选的 ✓）——
  //   把"切换即终止"改成"占用即拒绝进入"之后 ✓，出口必须**显式** ✓
  //   （见后端 `task_stop` 那段：不补这个，模型卡住时人会被**永久关在门外** ✓）。
  //
  //   ⚠️ **不能在客户端"装作停掉了"** ✗ —— 必须等服务端回话 ✓：
  //      真正要断的是**服务端那条流** ✓（`asyncio.Task.cancel()` ✓），
  //      前端清一下状态是**没有用**的 ✓（下一片 delta 照样会推过来 ✓）。
  //   ⚠️ **服务端写的那句"（这一轮被你停掉了）"要当场画上** ✗ —— 它不走 WebSocket ✓
  //      （是这次请求的返回值 ✓，见 `task_stop` ✓），等下一轮同步才画＝**看不到** ✓。
  $('#wsStop').onclick = async () => {
    const tid = wsCur.task;
    if (!tid) return;
    const btn = $('#wsStop');
    btn.disabled = true;                       // 连按两下 = 两次取消 ✓，挡一下 ✓
    try {
      const d = await api(`/workshop/${group.id}/tasks/${tid}/stop`, { method: 'POST' });
      if (d && d.message) addWsMsg(d.message);
      setWsStatus('idle');
      await wsReloadTasks();                   // 占用的登记也要跟着放掉 ✓
    } catch (e) {
      toast('没停掉：' + e.message);
    } finally {
      btn.disabled = false;
    }
  };
  $('#wsSend').onclick = sendWs;
  // ★ 加图那个按钮 ✓ —— 选完先停在待发区 ✓（用户定的 ✓）。
  // ★ 2026-10-08：从"一个图片按钮"改成**和主群聊同款的 ＋** ✓
  //   （用户：「组件聊天界面里，底部聊天框右边的照片还是要改成[主群聊]同款+，
  //     并且支持相机和相册」✓）。
  $('#wsPick').onclick = () => openPickSheet('ws');
  // 原来那个隐藏的 `#fileWs`（只管图片 ✓）不走了 ✓ —— 留着是为了不破坏老引用 ✓
  // （它是 `input` ✓，没人点它也没关系 ✓）。
  $('#fileWs').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    // ⚠️ **同时只留一张** ✗→✓（这一版）—— 群聊那边能排队好几张 ✓，
    //    而这边**发一次就是一轮对话** ✗，堆太多没有意义 ✓。
    //    再选一张就是**换掉**上一张 ✓（换的时候要把上一张的预览地址收掉 ✓，
    //    不收的话每换一次漏一个 blob ✓）。
    if (wsPending) URL.revokeObjectURL(wsPending.url);
    wsPending = { file, kind: 'image', url: URL.createObjectURL(file) };
    syncWsPending();
    syncWsSend();
  });
  $('#wsQclose').onclick = () => { wsQuote = null; setWsQuoteBar(); };
  $('#wsText').oninput = syncWsSend;
  $('#wsText').onkeydown = (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); sendWs(); } };
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
      me = await api('/me');
    } catch (e) {
      if (e && e.status === 401) { location.href = '/login'; return; }
      show('login');
      $('#loginErr').textContent = (e && e.message) || '连不上服务器';
      return;
    }
    // ★ **`/me` 现在也是"进 App + 弹出我的"** ✗→✓（2026-10-09）——
    //   「我的」变成弹层之后它不再是"一屏" ✓，而这个地址的意义**没变** ✓：
    //   **到了就让你看见你的资料** ✓（"去向由地址决定"那条记忆里的规矩 ✓）。
    try { await enterApp(); } catch (e) {
      if (e && e.status === 401) { location.href = '/login'; return; }
      show('login'); tellNative('chat');
      if (e) $('#loginErr').textContent = e.message;
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
    reload: () => location.reload(),

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