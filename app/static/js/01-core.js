(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];

  //: ★ 「组件收纳页」那一格 / 那条对话的 slug ✓（2026-10-08 定的保留字 ✓）。
  //:
  //:   ⚠️ **它必须声明在文件最前面** ✗ —— 上一次它写在中间 ✓，
  //:   后来一次"删掉旧代码块"的编辑把它连声明一起删了 ✓ →
  //:   点组件时 `Uncaught ReferenceError: WALL_SLUG is not defined` ✓ →
  //:   **点了什么都不发生** ✓✓（用户报的那个"点组件没反应"就是它 ✓）。
  //:   ⚠️ 而且**两道检查当时都抓不到** ✗：语法是对的 ✓；
  //:   `tools/check-shell-page.py` 只查"被调用的名字"✓，而它是当**值**用的 ✗
  //:   （已给那个检查器补了一条"全大写常量"的扫描 ✓，见它的注释 ✓）。
  const WALL_SLUG = 'wall';

  //: 屏上所有"进/出场动画"的类名 ✓ —— 换动画之前**必须全清掉** ✓。
  //:
  //:   ⚠️⚠️ **这一条是真踩过的** ✗→✓（2026-10-09 用户报的："从群聊右上角进入时
  //:   动效**还是页面从上出现**，退出时**没动效**"）：原来 `pushScreen` 只
  //:   `remove('anim-out')` ✓、`popScreen` 只 `remove('anim-in')` ✓ ——
  //:   于是"下拉进来留下的 `anim-drop`"**一直挂在那一屏上没人摘** ✗。
  //:   两个类都写 `animation` 属性 ✓ → 后写的那条规则赢（CSS 源顺序）✓ →
  //:   **之后每一次进/出它都在播"从上滑入"** ✓✓：
  //:   进的时候看着"从上出现"（该从右边推的 ✓）、退出时原地播一遍入场 ✗ →
  //:   看着就像"没有退场动效" ✓。**症状离根因很远**（这正是这个项目最怕的那种）✓。
  //:   → 所以改成"**先全清、再按方向加一个**" ✓，以后加新动画不用再改这两行 ✓。
  //:   ⚠️ 和 `WALL_SLUG` 一样**必须声明在文件最前面** ✗（`show()` 要用它 ✓ ——
  //:      `show()` 在启动那几步就会被调 ✓，写在后面就是 TDZ 当场炸 ✓）。
  const ANIM_CLASSES = ['anim-in', 'anim-out', 'anim-fade',
                        'anim-drop', 'anim-lift', 'anim-corner', 'anim-corner-out',
                        // ★ 2026-10-29：从左滑入 / 缩回左边 ✓（设置页现在靠右滑进 ✓）
                        'anim-left', 'anim-left-out'];


  // ── 给 agent 的扩展点 ──
  //
  // 这个 IIFE 把内部函数全关在里面了（`addMsg`、`show`、`enterApp` 外面都够不着）。
  // 那是**故意的**——但那样一来，agent 写的 `ui/app.js` 就什么也做不了，只能干瞪眼。
  //
  // 所以这里开一个**很小、很明确**的口子：几个钩子 + 几个工具函数，挂在
  // `window.LifeGuard` 上（见文件末尾）。不是通用插件系统，就是够它用。
  //
  // **钩子里的异常必须吞掉**：agent 写的代码报错，不能让整个界面跟着挂。
  const _hooks = { ready: [], message: [] };
  const _fire = (name, ...args) => {
    for (const fn of _hooks[name]) {
      try { fn(...args); }
      catch (e) { console.error('[LifeGuard hook ' + name + ']', e); }
    }
  };
  const _hook = name => fn => { if (typeof fn === 'function') _hooks[name].push(fn); };
  // ★ **这里原本是 `let token = localStorage.getItem('lg_token')`。已经删掉了。**
  //
  // 令牌现在住在 **httpOnly Cookie** 里：浏览器自动带上，而**这段 JS 读不到它**
  // ——这正是重点。页面上任何一段 JS 都摸不到凭证（包括 agent 写的
  // `ui/app.js`），所以"让它能写前端"才敢做。
  //
  // 所以：这里没有 token 变量，请求也不用再加 Authorization 头。
  // 判断"登录了没"不再是"本地有没有 token"，而是**打一次 /auth/me 看返不返 401**。
  let me = null, group = null, members = [], curStatus = 'idle';
  // ★ "刚才那一下是**长按**，不是点击" ✓ —— 2026-10-06 加。
  //
  // ⚠️ 为什么非要它 ✗：长按引用挂在 `touchstart` 上 ✓（`passive:true` ✓，
  //   没 preventDefault ✓），所以**手指抬起来之后浏览器照样会发一个 click** ✗。
  //   而头像上刚挂了"点一下进「我的」/进管家" ✓ →
  //   **长按引用会顺带把人带出聊天页** ✗，而且看起来完全莫名其妙 ✓。
  let pressFired = false;
  let ws = null, streamEl = null, streamBuf = '';

  // ── 系统留白 ──
  //
  // 原生壳只负责**上报数字**（状态栏多高、键盘多高），排版由这里决定。
  // 这样调布局改这个文件就行，不用让用户重装 App。
  // 浏览器里没有原生壳，CSS 的 env() 会兜住。
  const isNative = !!(window.LifeGuardNative && window.LifeGuardNative.isNative && window.LifeGuardNative.isNative());

  //: 上一次报上来的"底部留白" ✓ —— 用它判断**键盘是不是刚弹起来** ✓（见下面 ✓）。
  let lastKbBottom = 0;

  const applyInsets = (i) => {
    if (!i || typeof i !== 'object') return;
    // ★ 单位换算：原生报的是**物理像素**，CSS 用的是**逻辑像素**，
    //   必须除以设备像素比。不换算的话顶部会空出近三倍的距离——
    //   （同一个数字在原生 setPadding 里是对的，搬到 CSS 里就错了。）
    const dpr = window.devicePixelRatio || 1;
    const r = document.documentElement.style;
    r.setProperty('--inset-top', ((i.top || 0) / dpr) + 'px');
    // 原生报上来的 bottom 已经把键盘算进去了，所以 App 里不需要再额外加 --kb，
    // 否则键盘弹出时会留出双倍空白。
    const bottom = (i.bottom || 0) / dpr;
    // ★★ **键盘一弹起来，就把最新那条顶上来** ✗→✓（2026-10-09 用户定的：
    //   「组件聊天和主聊天，聊天的**输入法要能够顶起最新的消息**」✓）。
    //   ⚠️ 判据是「底部留白**变大了**」✓ —— 那正是键盘弹起来那一下 ✓
    //      （原生把键盘高度算进 `bottom` 里报上来 ✓，见上面那段注释 ✓）。
    //      只在**弹起**时强拉到底 ✓；收键盘时**不**强拉 ✗
    //      （不然他正翻着上面的记录、一收键盘就被拽到底 ✓）。
    const kbJustOpened = bottom > lastKbBottom + 1;
    lastKbBottom = bottom;
    r.setProperty('--inset-bottom', bottom + 'px');
    r.setProperty('--kb', '0px');
    if (kbJustOpened) scrollDown(true);
    else scrollDown();
  };
  window.__onInsets = applyInsets;

  if (isNative) {
    // 页面可能在原生首次派发之后才加载完，主动拉一次
    try { applyInsets(JSON.parse(window.LifeGuardNative.insets())); } catch {}
  } else if (window.visualViewport) {
    // 浏览器里的键盘兜底
    const onVV = () => {
      const vv = window.visualViewport;
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', kb + 'px');
      if (kb > 0) scrollDown();
    };
    window.visualViewport.addEventListener('resize', onVV);
    window.visualViewport.addEventListener('scroll', onVV);
  }

  // ⚠️ **再补一道兜底** ✗→✓（2026-10-09）：**聚焦输入框**那一下也滚一次 ——
  //    万一原生那次 insets 报得不够及时 ✓（或者浏览器里根本没有原生 ✓），
  //    这一下能兜住 ✓。
  //    ⚠️ 延后 260ms：键盘的升降有动画 ✓，立刻滚会在动画中途算高度 ✓（不准 ✓）。
  const chatText = $('#text');
  if (chatText) {
    chatText.addEventListener('focusin', () => {
      setTimeout(() => scrollDown(true), 260);
    });
  }

  // ⚠️ **聚焦一个输入框之后，把它滚进看得见的地方** ✗→✓（2026-10-09 用户定的：
  //   「展开后，顺便打开了编辑，此时**输入法也该顶起**」✓）——
  //   键盘一弹起来会把那一屏压矮 ✓，而刚展开的那个文本框往往正好在**键盘底下** ✗。
  //   ⚠️ 只管**能滚的那几屏**（`.abody` ✓，管家那几屏就是 ✓；
  //      2026-10-12 补上 `#modelsBody` ✗→✓ —— 模型池的「上下文长度」输入框
  //      也在滚动体里、也在键盘底下 ✗，同一条路 ✓）；
  //      两个聊天的输入框不在这些里面 ✓，它们走上面那条"键盘留白"的路 ✓。
  //   ⚠️ 弹层（`#sheetPanel`）有它自己那套 ✓（就在下面 ✓），不在这儿重复管 ✗。
  document.addEventListener('focusin', (ev) => {
    const t = ev.target;
    if (!t || !t.tagName) return;
    if (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') return;
    if (t.closest('#sheetPanel')) return;
    if (!t.closest('.abody, #modelsBody')) return;
    // ⚠️ 延后 300ms：键盘的升降有动画 ✓，立刻滚算的是**旧高度** ✓（不准 ✓）。
    setTimeout(() => {
      try { t.scrollIntoView({ block: 'center' }); } catch (e) { /* 滚不动就算了 ✓ */ }
    }, 300);
  });

  // 底部面板：键盘弹起时自动滚到聚焦输入框
  const _panelEl = $('#sheetPanel');
  if (_panelEl) {
    new ResizeObserver(() => {
      const f = document.activeElement;
      if (f && _panelEl.contains(f) && (f.tagName === 'INPUT' || f.tagName === 'TEXTAREA')) {
        f.scrollIntoView({ block: 'center' });
      }
    }).observe(_panelEl);
    _panelEl.addEventListener('focusin', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        setTimeout(() => e.target.scrollIntoView({ block: 'center' }), 500);
      }
    });
  }

  // ── 主题 ──
  //
  // ★ 2026-10-19：三套主题 —— 夜阑（黑）/ 奶霜（奶白）/ 林深（深林绿）。
  // ⚠️ 主题是**个人的** ✓ —— 只存在这台设备的 localStorage 里 ✓，而且按
  //    用户 id 分开存（`lg_theme:u<id>` ✓）→ 同一个群里两个人各用各的 ✓，
  //    换账号登录也不会把上一个人的主题带过去 ✓。服务端完全不知道这件事 ✓。
  const THEMES = [
    { id: 'dark', name: '夜阑', desc: '墨黑与夜蓝，安静得刚好',
      color: '#0f1115', light: false,
      vars: '--p-bg:#0f1115;--p-panel:#171a21;--p-panel2:#1e222b;'
          + '--p-line:#262b36;--p-text:#e6e8ee;--p-muted:#8b93a7;'
          + '--p-accent:#6ea8ff;--p-accent-bg:#1e3a5f;'
          + '--p-accent-line:#35507a;--p-accent-soft:rgba(90,140,255,.10)' },
    { id: 'cream', name: '奶霜', desc: '暖白与焦糖，像一杯温牛奶',
      color: '#f6f0e4', light: true,
      vars: '--p-bg:#f6f0e4;--p-panel:#fffcf5;--p-panel2:#efe7d8;'
          + '--p-line:#e4d8c5;--p-text:#2d2822;--p-muted:#706658;'
          + '--p-accent:#9a5b2e;--p-accent-bg:#f2e1cb;'
          + '--p-accent-line:#d8be9e;--p-accent-soft:rgba(154,91,46,.10)' },
    { id: 'forest', name: '林深', desc: '深林与苔绿，沉静而有生气',
      color: '#12231a', light: false,
      vars: '--p-bg:#12231a;--p-panel:#1a2f22;--p-panel2:#233a2b;'
          + '--p-line:#2e4836;--p-text:#e6efe3;--p-muted:#90a794;'
          + '--p-accent:#8be4a0;--p-accent-bg:#2f5739;'
          + '--p-accent-line:#477552;--p-accent-soft:rgba(139,228,160,.14)' },
  ];
  // ★ 2026-10-27：三套**气泡皮肤** —— 鸭鸭 / 猪猪 / 猫猫 ✓。
  //
  // ⚠️ 它不是第四套主题 ✗：底色 / 正文 / 顶栏一行都不动 ✓，
  //    只换**气泡本身**的形状和配色 ✓（我说的 / 别人说的 / 管家说的 ✓）。
  //
  // ★★ **气泡是「人」的，不是这台设备的** ✗→✓（用户 2026-10-27 纠正过 ✓）：
  //    雅雅选了猪猪 ✓，**我这边的界面上她的消息就是猪猪** ✓；
  //    我选的她那边同样看得见 ✓；管家的那款**群里谁都能改** ✓。
  //    所以它必须**进服务端** ✓（`group_members.bubble` / `groups.agent_bubble` ✓，
  //    见 `app/core/bubbles.py` ✓），和主题那套 localStorage 完全是两回事 ✗。
  //    → 这个文件里只剩下"名字"和"一条消息该用哪款" ✓，**没有本地存档** ✓。
  //
  // ⚠️ 形状做在 CSS 里（`app.css` 的 `.row[data-bubble=…]` ✓）——
  //    这里只留名字和一句话 ✓，两边各写一份形状必对不上 ✓。
  const BUBBLES = [
    { id: 'plain', name: '默认', desc: '清清爽爽，跟着主题走' },
    { id: 'duck',  name: '鸭鸭',  desc: '鹅黄贴纸，鸭鸭趴在角上' },
    { id: 'pig',   name: '猪猪',  desc: '樱粉贴纸，猪猪趴在角上' },
    { id: 'cat',   name: '猫猫',  desc: '奶油贴纸，猫猫趴在角上' },
  ];
  const BUBBLE_DEFAULT = 'plain';
  const bubbleById = (id) => BUBBLES.find(b => b.id === id) || BUBBLES[0];
  const normBubble = (id) => (BUBBLES.some(b => b.id === id) ? id : BUBBLE_DEFAULT);
  /** 给人看的名字（「我的」「管家」里那一行显示它 ✓）。 */
  const bubbleName = (id) => bubbleById(normBubble(id)).name;

  /** 某个成员**此刻**的气泡（不在成员表里 → 默认 ✓）。 */
  const bubbleOfMember = (uid) => {
    const mb = (members || []).find(x => x.id != null && Number(x.id) === Number(uid));
    return normBubble(mb ? mb.bubble : '');
  };

  /** 一条消息该用哪款 —— ★ **按现在的成员表查**，不用消息里那个快照 ✓。
   *
   *  消息里确实也带了一份 `sender_bubble` ✓（见 `core/messages.py` ✓），
   *  那是**开页/断线补拉那一下**的快照 ✓：成员表还没到的时候先用它画 ✓
   *  （第一帧就大致是对的 ✓）。成员表一到，就以成员表为准 ✓ ——
   *  换气泡**不重发历史消息** ✓，靠 `repaintBubbles()` 把在屏上的行重贴一遍 ✓。
   */
  const bubbleForMsg = (m) => {
    if (!m) return BUBBLE_DEFAULT;
    if (m.sender_type === 'agent') return normBubble(group && group.agent_bubble);
    const mb = (members || []).find(x => x.id != null && Number(x.id) === Number(m.sender_id));
    return mb ? normBubble(mb.bubble) : normBubble(m.sender_bubble);
  };

  /** 给一行贴上气泡 + **记住这行是谁的** ✓（重画时只认这个 ✓，不靠消息表 ✓）。
   *
   *  ⚠️ `data-bubble` 挂在**每一行**上，不挂 `#msgs` / `<html>` ✗→✓（用户第二轮定的）：
   *     一个群里同时可能有三款气泡 ✓（我鸭鸭 / 她猪猪 / 管家猫猫 ✓）——
   *     挂在容器上就只能全群一款 ✗。挂在行上，各画各的 ✓，
   *     预览卡也不会再被真界面的属性染到 ✓（那个坑见记忆 ✓）。
   */
  const setRowBubble = (row, m) => {
    if (!row) return;
    row.dataset.bubble = bubbleForMsg(m);
    row.dataset.bubbleBy = (!m) ? ''
      : m.sender_type === 'agent' ? 'agent'
      : (m.sender_id != null ? 'u' + m.sender_id : '');
  };

  /** 把**已经在屏上的**每一行按"现在的"成员表重贴一遍 ✓。
   *
   *  什么时候调：成员表/群设置刷新之后 ✓（`refreshGroup` ✓）、
   *  以及自己换完气泡 ✓。历史消息不动数据库 ✓、不重发 ✓。
   */
  const repaintBubbles = () => {
    $$('#msgs .row[data-bubble-by]').forEach(row => {
      const by = row.dataset.bubbleBy || '';
      row.dataset.bubble = by === 'agent' ? normBubble(group && group.agent_bubble)
        : (by.charAt(0) === 'u' ? bubbleOfMember(by.slice(1)) : BUBBLE_DEFAULT);
    });
  };

  const THEME_ALIAS = { light: 'cream' };   // 旧版本存过 'light'，别让老用户掉回默认
  const THEME_DEFAULT = 'dark';
  const themeById = (id) => THEMES.find(t => t.id === id) || THEMES[0];
  const themeOfUser = () => {
    const uid = me && (me.id ?? me.username);
    return (uid === undefined || uid === null || uid === '') ? '' : 'lg_theme:u' + uid;
  };

  const applyTheme = (t) => {
    t = THEME_ALIAS[t] || t;
    const id = THEMES.some(x => x.id === t) ? t : THEME_DEFAULT;
    const theme = themeById(id);
    document.documentElement.dataset.theme = id;
    try {
      localStorage.setItem('lg_theme', id);          // 这台设备上次用的（登录前兜底）
      const k = themeOfUser();
      if (k) localStorage.setItem(k, id);           // 这个账号自己的
    } catch (e) { /* 隐私模式存不了就算了，主题照样生效 */ }
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = theme.color;
    // 让原生同步状态栏图标的明暗：奶霜是浅底，另外两套是深底
    try { window.LifeGuardNative?.setLightStatusBar?.(!!theme.light); } catch {}
    return id;
  };

  /** 登录/换账号后调用：把这个账号自己选的主题贴回来。
   *  ⚠️ 这个账号**没选过**就回默认的夜阑 ✓ —— **不继承**设备上一个人留下的
   *     那套 ✓（同一台手机换账号登录时，"这是谁的选择"才分得干净 ✓）。
   *     登录前那一下用的是设备值 ✓（只为避免闪屏 ✓，见 index.html 里那段 ✓）。 */
  const syncThemeForUser = () => {
    let saved = '';
    try {
      const k = themeOfUser();
      saved = k ? (localStorage.getItem(k) || '') : '';
    } catch (e) {}
    applyTheme(saved || THEME_DEFAULT);
  };

  applyTheme(localStorage.getItem('lg_theme') || THEME_DEFAULT);

  const explain = (data, status) => {
    if (!data) return '请求失败 ' + status;
    if (typeof data === 'string') return data;
    const d = data.detail !== undefined ? data.detail : data;
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map(i => {
      if (typeof i === 'string') return i;
      const f = (i.loc || []).filter(x => x !== 'body').join('.');
      const label = { username:'用户名', password:'密码', current_password:'当前密码',
                      new_password:'新密码', nickname:'昵称', name:'名称', content:'内容' }[f] || f;
      return (label ? label + '：' : '') + (i.msg || '');
    }).join('；');
    return JSON.stringify(d);
  };

  /**
   * `opts.timeout`（毫秒，可选）—— **只有开屏这种"卡住就很显眼"的请求才传** ✓。
   *
   * ★ 2026-10-23 加 ✓：用户报"点刷新卡在加载页，只能划掉重进" ✓。
   *   `fetch` 在 WebView 里**没有自带的超时** ✗ —— 连接被网络栈攥住时，
   *   这个 Promise 可以永远不返回 ✓ → `enterApp()` 永远走不到 `_bootReady()` ✓
   *   → 加载页一直转 ✓。默认不设超时（发消息这些慢操作不能误杀 ✓），
   *   只在开屏那几趟点名传 ✓。
   */
  const api = async (path, opts = {}) => {
    const { timeout, ...rest } = opts;
    let ctl = null, tid = 0;
    if (timeout && typeof AbortController !== 'undefined') {
      ctl = new AbortController();
      tid = setTimeout(() => { try { ctl.abort(); } catch (e) {} }, timeout);
    }
    try {
      const r = await fetch('/api' + path, {
        ...rest,
        credentials: 'same-origin',   // 带上 Cookie。同源本来就默认带，写明是为了别被将来改错
        signal: ctl ? ctl.signal : rest.signal,
        headers: { 'Content-Type': 'application/json',
                   ...(rest.headers || {}) }
      });
      const text = await r.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!r.ok) {
        const err = new Error(explain(data, r.status));
        err.status = r.status;   // 启动时要靠它分辨"没登录(401)"和"网络坏了"
        throw err;
      }
      return data;
    } catch (e) {
      // abort 之后 `fetch` / `r.text()` 抛的是 AbortError，不是我们那种带 status 的错 ✓
      if (ctl && ctl.signal.aborted && !(e && e.status)) {
        const err = new Error('服务器一直没回应（超时了）');
        err.status = 0;
        err.timeout = true;
        throw err;
      }
      throw e;
    } finally {
      if (tid) clearTimeout(tid);
    }
  };

  // ── 开局加载页的退场（2026-10-20）────────────────────────────────────
  //
  // ★ 用户要的形状 ✓：**最短亮 0.5 秒；最长一直等到真的加载完** ✓。
  //   "加载完"不只是 `/bootstrap` 回来 ✓，还要：
  //     · 消息已经画进 DOM ✓
  //     · 聊天背景图已经取到 / 缩好 / **解码完** ✓（见 03-auth 的
  //       `ensureChatBackground` ✓）—— 否则撤掉加载页的第一帧里背景还是空的 ✓，
  //       用户会看到它"过一下才铺上来" ✓，那正是这次要消掉的 ✓
  //     · 再等两帧 ✓，确保浏览器真把这一屏画出来了 ✓
  //   然后才淡出 ✓（淡出 400ms ✓ —— 底下已经是完整画面了 ✓，不是空屏 ✓）。
  //
  // ⚠️ **它不再由 `show()` 收掉** ✗ —— `show('chat')` 只是"这一屏该显示了" ✓，
  //   这时候消息 / 背景往往还没就位 ✓；收得太早 = 又回到"先空白一下" ✓。
  //   现在只有 `_bootReady()` 能收它 ✓（各处成功 / 失败的出口各调一次 ✓）。
  const BOOT_MIN_MS = 1000;
  const _bootT0 = performance.now();
  let _bootOff = null;

  const _afterPaint = () => new Promise(res => {
    // ⚠️ **两帧 rAF 不一定来** ✗ —— 页面切到后台 / 这次导航没有合成帧时，
    //    rAF 会被按住 ✓ → `_bootReady()` 就永远停在第一行 ✓。补一个兜底 ✓。
    let done = false;
    const fin = () => { if (!done) { done = true; res(); } };
    requestAnimationFrame(() => requestAnimationFrame(fin));
    setTimeout(fin, 400);
  });

  /** 让一个 Promise **最多等 ms 毫秒**（超时就算了，活儿在后台照跑 ✓）。 */
  const _within = (p, ms) => Promise.race([
    Promise.resolve(p).catch(() => {}),
    new Promise(r => setTimeout(r, ms)),
  ]);

  /** 底下那一屏已经准备好了 → 加载页等满 0.5s 后淡出 ✓（重复调只认第一次 ✓）。 */
  const _bootReady = () => {
    if (_bootOff) return _bootOff;
    _bootOff = (async () => {
      await _afterPaint();                      // 先让底下的界面真画一帧 ✓
      const left = BOOT_MIN_MS - (performance.now() - _bootT0);
      if (left > 0) await new Promise(r => setTimeout(r, left));
      const b = $('#boot');
      if (!b || b.hidden) return;
      b.classList.add('boot-out');
      await new Promise(r => setTimeout(r, 400));
      b.hidden = true;
    })();
    return _bootOff;
  };

  // ★★ 2026-10-23：**加载页绝不能无限期挂着** —— 用户报的那条 bug ✓。
  //
  //   正常出口每个都调 `_bootReady()` ✓，但"每个出口都调了"不等于"一定会调到" ✗：
  //   只要有一处 await 永远不返回（`fetch` / IndexedDB / 字体 ✓），
  //   人就只能看着转圈 ✓，唯一出路是划掉 App 重进 ✓（= 重建 WebView ✓）。
  //
  //   这里是**最后一道兜底** ✓：到点不管卡在哪一步，都把加载页收掉 ✓。
  //   · 底下已经有屏（最典型：本机缓存那一份群聊 ✓）→ 直接露出来 ✓
  //   · 底下什么都没有 → 摆登录页 + 一句实话 ✓（别让人对着空屏猜 ✓）
  //
  //   ⚠️ 放在这里（01-core）而不是 06 的派发后面 ✗ —— 万一后面某个文件
  //      顶层就抛了 ✓，06 根本执行不到 ✓，这道兜底也就没人挂 ✓。
  const BOOT_HANG_MS = 10000;
  setTimeout(() => {
    const b = $('#boot');
    if (!b || b.hidden) return;
    try {
      if (!$('.screen.on')) {
        show('login');
        tellNative('chat');
        const el = $('#loginErr');
        if (el) el.textContent = '加载太久没反应 —— 网络可能断了，点重新加载再试';
      }
      _bootReady();
    } catch (e) {
      try { b.hidden = true; } catch (e2) {}   // 连兜底都出错 → 至少把这块布摘掉
    }
  }, BOOT_HANG_MS);

  // ── 从后台切回来时，逼 WebView 重画一帧（2026-10-23）───────────────────
  //
  // 用户报「从生活管家的模型界面切出后，再进入偶尔会黑屏」✓ ——
  // **"切出 / 再进入"按"切到别的 App / 切回来"理解** ✓
  // （同一族症状这个项目见过：`d6bee6f`「缩短长时间挂后台回来时的黑屏间隙」✓）。
  //
  // ⚠️ **这不是 DOM 的问题** ✗ —— 网页这边状态都好好的 ✓；是 Android WebView
  //    切后台时**合成层的纹理被回收了** ✓，回来那一帧整块画布还是空的 ✓。
  //    而壳给的底色就是 `#0F1115`（深色 ✓）→ 看着就是"黑屏" ✓。
  //    常见兜法：让它**重新合成一次** ✓ —— 抖一下最上面那一屏的 opacity ✓，
  //    0.999 肉眼看不出来 ✓，两帧之后复原 ✓。
  //
  // ⚠️ 诚实说一句：**这台机器没有安卓，我没法复现那个黑面** ✗ ——
  //    这是按症状加的兜底 ✓，不是"验证过有效" ✓。要是还黑，就得动壳：
  //    `MainActivity.onResume` 里给 `web` 补一次 `invalidate()`（或重建合成层）。
  const _kickRepaint = () => {
    const on = Array.prototype.slice.call(document.querySelectorAll('.screen.on'));
    if (!on.length) return;
    on.forEach(el => { el.style.opacity = '0.999'; });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      on.forEach(el => { el.style.opacity = ''; });
    }));
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _kickRepaint();
  });
  window.addEventListener('pageshow', (ev) => { if (ev.persisted) _kickRepaint(); });

  const toast = (m) => {
    const t = $('#toast'); t.textContent = m; t.classList.add('on');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), 1800);
  };

  /**
   * **屏幕正中的一张小卡片，几秒后自己消失** ✓（用户 2026-10-09 定的 ✓）。
   *
   * 用在"**进来的时候就发生了某件事**"上 ✓ —— 眼下只有一处：
   * 从右上角进来、**续上了上次那条没做完的** ✓
   * （「上次退出时未做出组件，已自动恢复」✓）。
   * ⚠️ 和 `toast` 分开 ✗（理由写在 CSS 里 `.notice` 那段 ✓）。
   * ⚠️ **不用点、也不该挡手** ✓（CSS 里 `pointer-events:none` ✓）——
   *    它只是"说一声" ✓，不是要人做决定 ✓（要做决定的那些走 `confirmBox` ✓）。
   */
  const showNotice = (m, ms, kind) => {
    const el = $('#notice');
    if (!el) return;
    el.textContent = m;
    // ★ `kind` 可选 ✓（2026-10-10 加的 ✓）：报错就用 `err` ✓（红字 ✓，见 CSS ✓）。
    //   ⚠️ 用 `className =` 一把写 ✓，不是 `classList.add` ✗ —— 上一条可能是
    //     `err` ✓、这一条是普通提示 ✓，不覆盖就会**红字留在下一条提示上** ✗。
    el.className = 'notice on' + (kind ? ' ' + kind : '');
    clearTimeout(el._t);
    // ⚠️ 默认时长 **3.2 → 2 秒** ✗→✓（2026-10-10 用户：「其他地方改成 2s」✓）——
    //   各处的调用可以自己传更短/更长的值 ✓（恢复那张就是 1 秒 ✓，见它那行 ✓）。
    el._t = setTimeout(() => el.classList.remove('on'), ms || 2000);
  };
  /**
   * **整屏替换**（平级切换 ✓）—— 带一个可选的淡入 ✓。
   *
   * ★ 2026-10-08：加了第二个参数 ✗→✓。用途只有一处 ✓：
   *   ④ 首启那几步（启动 → 登录 → 初始化 → 主群聊 ✓）——
   *   它们之间**没有深浅关系** ✓，所以不能用"从右边推进来" ✗
   *   （那会暗示"我进到了一个更深的地方" ✓，而其实只是换了个状态 ✓）。
   *   交叉淡入最贴切 ✓（用户要的"按场景分类、同类同一种" ✓）。
   */
  const show = (id, anim) => {
    // ⚠️ 这里**不碰加载页** ✗ —— 由 `_bootReady()` 统一收 ✓（见上面那段说明 ✓）。
    $$('.screen').forEach(s => {
      s._popToken = (s._popToken || 0) + 1;   // 平级切换 → 之前没跑完的退场收尾一律作废 ✓
      s.classList.remove(...ANIM_CLASSES);
      s.classList.toggle('on', s.id === id);
    });
    // 整屏替换 = 之前那一摞**全没了** ✓ → "这屏是怎么进来的"那张表也一并清 ✓
    // （不清的话，下次它被"从上面滑入"进来时，退场会**往上收** ✗ —— 而它是
    //  从右边推进来的 ✓，方向就对不上了 ✓）。
    _enterAnim.clear();
    if (anim === 'fade') {
      const s = $('#' + id);
      if (s) { void s.offsetWidth; s.classList.add('anim-fade'); }
    }
  };

  // 告诉原生"我现在在哪个界面"，它据此决定返回键是"退回聊天"还是"退出应用"。
  // 网页里的界面切换不会进 WebView 历史，原生光靠 canGoBack 判断不出来。
  const tellNative = (name) => {
    try { window.LifeGuardNative?.setScreen?.(name); } catch {}
  };

  // ── 「重新加载」这颗按钮该干什么（2026-10-23 改）──────────────────────
  //
  // ★ 用户报的 bug：**在 App 里点刷新 → 卡在加载页 → 只能划掉 App 重进** ✓。
  //
  //   服务端日志里那一次是这样的 ✓：`GET /` 来了两趟 ✓ 都 200 ✓，
  //   但**之后 `app.js` / `bootstrap` 一趟都没有** ✗，**旧的 WebSocket 也没断** ✗
  //   —— 说明 `location.reload()` 这次导航**根本没落地** ✓，
  //   WebView 卡在"旧的还没卸干净、新的还没跑起来"的中间态 ✓。
  //   划掉重进之所以好使 ✓，是因为那等于**把整个 WebView 销毁重建** ✓。
  //
  //   → **在 App 里就别再 `location.reload()` 了** ✗：走原生现成的
  //     `setServer(serverUrl())` ✓ —— `MainActivity.openUi()` 会
  //     `web.destroy()` 再新建一个 ✓，和手动划掉重进**是同一条路** ✓
  //     （0.7.0 的壳里就有这个口子 ✓，不用等新版 App ✓）。
  //     ⚠️ 它是"换服务器地址"用的接口 ✓，这里传的是**地址本身** ✓
  //     —— 地址不变、效果是重建 ✓；不去改壳，也就不引入新版才有的方法 ✓。
  //
  //   ⚠️ 浏览器里（没有原生桥）照旧 `location.reload()` ✓。
  //
  //   另外：**先主动关掉 WebSocket** ✓ —— 旧页面被重建时，它那条 WS
  //   在日志里是"没断"的 ✓；关一下，服务端那边立刻干净 ✓（不依赖导航去收拾 ✓）。
  const _appReload = () => {
    try { if (ws) { try { ws.onclose = null; ws.close(); } catch (e) {} } } catch (e) {}
    try {
      const N = window.LifeGuardNative;
      if (N && typeof N.serverUrl === 'function' && typeof N.setServer === 'function') {
        const u = String(N.serverUrl() || '');
        if (/^https?:\/\//i.test(u)) { N.setServer(u); return; }
      }
    } catch (e) {}
    location.reload();
  };

  /**
   * 等一次退场动画结束 ✓ —— 但**不指望它一定会来** ✗→✓（2026-10-08）。
   *
   * ⚠️ 这一段原来是"只听 `animationend`" ✗（设置页 ✓ 和三屏 ✓ 各写了一遍 ✓）。
   *    一旦那个事件不来，那个屏就会**永远留着 `anim-out` 且不摘 `on`** ✗
   *    —— 表现是"退不出去" ✓，而且**看起来像卡住** ✓。
   *    什么时候会不来 ✓：元素当时已经不可见 ✓、动画被浏览器合并掉 ✓、
   *    系统开了"减弱动态效果" ✓（那一条最现实 —— 谁知道用户手机上开没开 ✓）。
   *
   *    ⚠️ 诚实说一句：**我没见它发作过** ✓ —— 这是读这段代码时看出来的隐患 ✓，
   *      不是踩过的坑 ✓。加兜底只要三行 ✓，而万一发作，症状是"界面退不出去" ✓，
   *      那种错最难查 ✓（因为看着像"点了没反应"✓）。
   */
  const afterAnim = (el, done) => {
    let fired = false;
    const finish = (ev) => {
      if (fired) return;
      // ⚠️ **子元素的动画冒泡上来不算数** ✗→✓（2026-10-23）——
      //   这个监听挂在整屏上 ✓，屏里任何一个元素（脉冲、加载条…）动画结束
      //   都会冒到这儿 ✓；不认 target 的话，那一屏会被**提前**收掉 ✓。
      if (ev && ev.target !== el) return;
      fired = true;
      clearTimeout(timer);
      el.removeEventListener('animationend', finish);
      done();
    };
    const timer = setTimeout(finish, 400);     // 兜底：比最长那条动画（240ms）宽裕 ✓
    el.addEventListener('animationend', finish);
  };

  // ★ 2026-10-08：**设置页并进同一套原语** ✗→✓。
  //
  //   它原来单独写了一份 ✓（`openSettings`/`closeSettings` ✓），
  //   理由是"它要保留聊天页垫在底下" ✓ —— 可 `pushScreen` 本来就是
  //   "叠加一层、不清别人" ✓，**两件事本来就是同一件事** ✓。
  //   两份写法 = 迟早只改一处（这个项目为"同一件事两处实现"栽过好几次 ✓）。
  //   合并之后：进设置页也走 `pushScreen` ✓，只有"退出时把返回键交回原生"
  //   这一句是它特有的 ✓（`tellNative('chat')` ✓）。
  // ★ 2026-10-29：设置页**从左边滑进来** ✓（用户：「右滑从左边进入设置页」✓）。
  const openSettings = () => pushScreen('settings', 'left');
  const closeSettings = () => {
    // ⚠️ 这里原来还有一句补报 `tellNative('chat')` ✗→✓（2026-10-09）——
    //    `popScreen` 现在是**按"它已经没了"现算**的 ✓（见 `tellTop` ✓），
    //    出来的就是 'chat' ✓（设置页底下就是群聊 ✓）→ 那句成了第二处真相 ✓，
    //    而"同一件事两处写"迟早走岔 ✓。
    popScreen('settings');
    scrollDown();
  };

  // ══════════════════════════════════════════════════════════════════
  // 管家设置 —— 三屏：列表 / 改资料 / 编一档状态
  // ══════════════════════════════════════════════════════════════════
  //
  // ⚠️ **报给原生的屏名一律是 `'settings'`** ✗→✓ ——
  //   `MainActivity.kt:582` 只认这一个字符串 ✓，
  //   而且它**根本不看 `__goBack` 的返回值** ✗（我原来以为看 ✓）。
  //   报一个新名字的后果是：**界面开着，第一次返回什么都不发生 ✗，
  //   第二次直接退出 App** ✗ —— 而这三屏都是"没有返回箭头、全靠手势" ✗。

  const mkel = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };
  const KIND_LABEL = { idle: '待机显示', thinking: '思考中', silent: '保持沉默' };

  // ★ 2026-10-24：**一行一枚小图标** ✓ —— 「我的 / 管家 / 设置」这几屏的行前面
  //   原来一个字都不带 ✓（用户：「按钮不要朴素」✓）。画的还是 App 里那一套：
  //   细描边、圆端点、`currentColor` ✓（和顶栏 ☰ / 刷新、`go` 那个尖同一个画法 ✓）。
  //   ⚠️ **只画形、不写颜色** ✗ —— 颜色由 `.row .ico` / `.item .ico` 给 ✓（主题一换就跟着换 ✓）。
  const ICO = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
    space: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.2l1.8 2h7A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-12A2.5 2.5 0 0 1 3 16.5z"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5"/>',
    palette: '<path d="M12 3a9 9 0 0 0 0 18c1.5 0 2-1 1.4-1.9-.7-1 .1-2.1 1.4-2.1H17a4 4 0 0 0 4-4c0-5.5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5l-4.5-4-6 7"/>',
    bot: '<rect x="4.5" y="8" width="15" height="11" rx="3"/><path d="M12 4.5V8"/><circle cx="9.5" cy="13.2" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="13.2" r="1" fill="currentColor" stroke="none"/><path d="M9.8 16.2h4.4"/>',
    layers: '<path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M4.5 12.6l7.5 4 7.5-4"/><path d="M4.5 16.6l7.5 4 7.5-4"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><polyline points="20 4.5 20 9 15.5 9"/>',
    chev: '<polyline points="9.5 5.5 16 12 9.5 18.5"/>',
    exit: '<path d="M14.5 4.5h3A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5h-3"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h9"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    talk: '<path d="M20.5 12a8.5 8.5 0 0 1-8.5 8.5H4.5V12a8.5 8.5 0 1 1 16 0z"/><circle cx="9" cy="12" r=".9" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r=".9" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r=".9" fill="currentColor" stroke="none"/>',
    mute: '<path d="M4 5.5l16 13"/><path d="M11 5.5 6.5 9H4v6h2.5L11 18.5z"/><path d="M15 9a4 4 0 0 1 1.6 3"/>',
    // ★ 2026-10-27：「气泡」那一行 ✓ —— 两个气泡，小的那个带尾巴 ✓（就是这一项本身 ✓）。
    chat: '<path d="M3.5 12.5A6.5 6.5 0 0 1 10 6h4.5a6 6 0 0 1 0 12H8.2L4.5 20.7V18A6.5 6.5 0 0 1 3.5 12.5z"/><circle cx="9" cy="12" r=".9" fill="currentColor" stroke="none"/><circle cx="12.2" cy="12" r=".9" fill="currentColor" stroke="none"/><circle cx="15.4" cy="12" r=".9" fill="currentColor" stroke="none"/>',
  };

  /** 一枚行内图标 ✓（`cls` 给 SVG 自己用 —— 只有「性格」那个朝下箭头要它 ✓）。 */
  const ico = (name, cls) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    if (cls) n.setAttribute('class', cls);
    n.setAttribute('viewBox', '0 0 24 24');
    n.setAttribute('fill', 'none');
    n.setAttribute('stroke', 'currentColor');
    n.setAttribute('stroke-width', '1.75');
    n.setAttribute('stroke-linecap', 'round');
    n.setAttribute('stroke-linejoin', 'round');
    n.innerHTML = ICO[name] || '';
    return n;
  };
  /** 行首那个**图标框** ✓（`.ico` ✓）—— 没有名字时给个空框里的点 ✓，别留个破洞 ✗。 */
  const icoBox = (name) => {
    const b = mkel('span', 'ico');
    b.appendChild(ico(name || 'chev'));
    return b;
  };

  // 服务端那份配置（`group.agent_status` 是个 JSON **字符串** ✓）。
  const agentCfg = () => statusCfg || {
    idle: { on: true, lines: ['正在窥屏…'], every: 600 },
    thinking: { on: true, lines: ['正在思考…'] },
    silent: { on: true, lines: ['打算继续窥屏…'] },
  };

  /** 改配置**只有一个出口** ✓ —— 整份发上去（服务端是整份替换 ✓）。 */
  const commitCfg = (mutate) => {
    const cfg = JSON.parse(JSON.stringify(agentCfg()));
    mutate(cfg);
    return patchGroup({ agent_status: cfg }, true);
  };

  /** 改群设置。`quiet` = 不弹「已保存」✓ —— 打字时防抖存的那一次次弹会烦死人 ✗。 */
  const patchGroup = async (patch, quiet) => {
    try {
      const g = await api(`/groups/${group.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
      if (g) group = g;                       // 服务端回的就是那一行 ✓，直接用 ✓
      normalizeStatus();
      renderHeader(); renderSettings();
      if ($('#agent').classList.contains('on') && !promptEditing) renderAgent();
      if (!quiet) toast('已保存');
    } catch (e) { toast(e.message || '没存上'); }
  };

  // ── **所有屏的进与出**：就这两条路 ✗→✓（2026-10-08 并成一套）────────
  //
  //   `pushScreen` = 压一层 ✓（新的从右边推进来 ✓，底下的屏**不清** ✓）
  //   `popScreen`  = 退一层 ✓（往右边退回去 ✓，退完把那层摘掉 ✓）
  //
  //   要"整屏替换"（登录 → 初始化 → 主群聊那种平级切换 ✓）用 `show()` ✓，
  //   它不带位移 ✓ —— 那几条之间没有深浅关系 ✓（见上面那四类 ✓）。
  //: ★ **这一屏是怎么进来的** ✓ —— 退场要**顺着来路** ✓：
  //:   右滑来的往右退 ✓、下拉来的往上收 ✓、右上角来的收回右上角 ✓。
  //:   ⚠️ 不记的话只有一条退场方向 ✗（那种错说不清，但一眼就觉得别扭 ✓）。
  const _enterAnim = new Map();

  /**
   * **告诉原生"现在最上面那一屏是谁"** ✓ —— 只有主群聊报 `'chat'` ✓，
   * 别的屏一律报 `'settings'` ✓（`MainActivity` 只认这两个字符串 ✓，
   * 而且**根本不看 `__goBack` 的返回值** ✗ —— 见那条"屏名约定"的注释 ✓）。
   *
   * ⚠️ **`skipId` 这个参数是必须的** ✗→✓（2026-10-09 用户报的：
   *   「返回后回到组件聊天也没问题，但**再次返回就提示再滑一次退出了**，
   *    但这不是主群聊，此时返回应该**按照来时路返回对应组件**才对」✓）。
   *
   *   真因：退场有 200ms 动画 ✓，那期间被退的那一屏**仍然 `.on`** ✗ →
   *   当场算出来的"最上面"还是**它自己** ✓ → 报成 `'settings'` ✗
   *   （而 `closeMe` 那边更早：它是**写死 `tellNative('chat')`** ✗）→
   *   原生就以为"我在群聊里" ✓ → 下一次返回走的是**"再滑一次退出 App"** ✗，
   *   而不是把返回键交回网页 ✓（网页那边本来能一路退回组件页 ✓）。
   *
   *   → 所以退屏时按"**当作它已经没了**"来算 ✓（`skipId` ✓）。
   *     这条规矩的根子是：**"谁在最上面"永远得现算** ✗，
   *     写死一个名字迟早撞上"我是从别处来的"✓。
   */
  const tellTop = (skipId) => {
    const skip = skipId ? '#' + skipId : '';
    const others = _OTHER_SCREENS.filter(s => s !== skip);
    // ⚠️ 2026-10-29：`#settings` 从 `_OTHER_SCREENS` 里拿掉了（手势要用它判屏名 ✓）——
    //    所以这里得**自己认它** ✓。不认的后果：设置页开着还报 'chat' ✗ →
    //    安卓返回键走"再按一次退出" ✗，而不是 `__goBack` 滑回群聊 ✗。
    //    抽屉同理：它盖在群聊上，但按返回键要**先收抽屉** ✓（见 02 `__goBack` ✓）。
    const top =
      others.some(s => $(s) && $(s).classList.contains('on')) ? ''
      : ($('#settings').classList.contains('on') && skip !== '#settings') ? 'settings'
      : ($('#compView').classList.contains('on') && skip !== '#compView') ? 'comp'
      : ($('#drawer').classList.contains('on') && skip !== '#drawer') ? 'drawer'
      : 'chat';
    tellNative(top === 'chat' ? 'chat' : 'settings');
  };

  const pushScreen = (id, from) => {
    const s = $('#' + id);
    // ★★ **推回来 = 作废上一次退场的收尾** ✗→✓（2026-10-23）——
    //   2026-10-23 用户报「从模型界面切出后，再进入偶尔会黑屏」✓，顺手查出来的：
    //   退场动画还没走完（180ms ✓）就又把它推回来了 ✗ →
    //   `pushScreen` 把动画类全清掉 ✓ → 那条退场动画**被取消** ✓ →
    //   **`animationend` 永远不会来** ✗；可 `afterAnim` 那个 400ms 兜底还在 ✓ →
    //   它在**新的这一屏**上补跑收尾 ✓ → 把刚推上来的屏 `on` 摘掉 ✗
    //   （人看到的是"刚进去又自己弹回去了 / 露底" ✓，深色主题下很容易被说成黑屏 ✓）。
    //   取号：谁最后推/退的，谁说了算 ✓；旧号码的回调一律作废 ✓。
    s._popToken = (s._popToken || 0) + 1;
    s.classList.remove(...ANIM_CLASSES);          // ★ 先全清，见上面那段 ✓
    const cls = from === 'top'    ? 'anim-drop'
              : from === 'corner' ? 'anim-corner'
              : from === 'left'   ? 'anim-left'
              : 'anim-in';
    if (from) _enterAnim.set(id, from); else _enterAnim.delete(id);
    s.classList.add('on', cls);
    void s.offsetWidth;                 // 强制重排，否则连续开关时动画不重放 ✓
    tellTop();                          // ★ 报"现在最上面是谁" ✓，见 `tellTop` 那段
  };
  const popScreen = (id) => {
    const s = $('#' + id);
    const how = _enterAnim.get(id);
    _enterAnim.delete(id);
    const token = (s._popToken = (s._popToken || 0) + 1);   // 见 `pushScreen` 那段 ✓
    s.classList.remove(...ANIM_CLASSES);          // ★ 先全清 ✓
    const cls = how === 'top'    ? 'anim-lift'
              : how === 'corner' ? 'anim-corner-out'
              : how === 'left'   ? 'anim-left-out'
              : 'anim-out';                       // 默认：从右边退回去 ✓
    s.classList.add(cls);
    void s.offsetWidth;                           // 同理，连点两次也要重放 ✓
    afterAnim(s, () => {
      if (s._popToken !== token) return;          // 中间又被推回来 / 又退了一次 → 作废 ✓
      s.classList.remove(cls, 'on');
    });
    // ★ **按"它已经没了"来报** ✓（不能等动画收尾再报 ✗ —— 那中间有 200ms
    //   原生还以为是别的屏 ✓，返回键在这 200ms 里按下去就会走错 ✓）。
    tellTop(id);
  };

  // ── 屏①：列表 ─────────────────────────────────────────────────────
