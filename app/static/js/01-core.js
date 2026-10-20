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
                        'anim-drop', 'anim-lift', 'anim-corner', 'anim-corner-out'];


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
    //   ⚠️ **两个聊天都要** ✗→✓：主群聊 `#msgs` ✓ + 组件对话 `#wsMsgs` ✓
    //      （组件那边以前**一次都没滚过** ✓ —— 键盘弹起来它纹丝不动 ✓）。
    const kbJustOpened = bottom > lastKbBottom + 1;
    lastKbBottom = bottom;
    r.setProperty('--inset-bottom', bottom + 'px');
    r.setProperty('--kb', '0px');
    if (kbJustOpened) { scrollDown(true); scrollWsDown(); }
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
  //    这一下能兜住 ✓。两个聊天各一个输入框 ✓。
  //    ⚠️ 延后 260ms：键盘的升降有动画 ✓，立刻滚会在动画中途算高度 ✓（不准 ✓）。
  ['#text', '#wsText'].forEach((sel) => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('focusin', () => {
      setTimeout(() => { scrollDown(true); scrollWsDown(); }, 260);
    });
  });

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
          + '--p-accent:#6ea8ff;--p-accent-bg:#1e3a5f' },
    { id: 'cream', name: '奶霜', desc: '暖白与焦糖，像一杯温牛奶',
      color: '#f6f0e4', light: true,
      vars: '--p-bg:#f6f0e4;--p-panel:#fffcf5;--p-panel2:#efe7d8;'
          + '--p-line:#e4d8c5;--p-text:#2d2822;--p-muted:#706658;'
          + '--p-accent:#9a5b2e;--p-accent-bg:#f2e1cb' },
    { id: 'forest', name: '林深', desc: '深林与苔绿，沉静而有生气',
      color: '#12231a', light: false,
      vars: '--p-bg:#12231a;--p-panel:#1a2f22;--p-panel2:#233a2b;'
          + '--p-line:#2e4836;--p-text:#e6efe3;--p-muted:#90a794;'
          + '--p-accent:#8be4a0;--p-accent-bg:#2f5739' },
  ];
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

  const api = async (path, opts = {}) => {
    const r = await fetch('/api' + path, {
      ...opts,
      credentials: 'same-origin',   // 带上 Cookie。同源本来就默认带，写明是为了别被将来改错
      headers: { 'Content-Type': 'application/json',
                 ...(opts.headers || {}) }
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
    requestAnimationFrame(() => requestAnimationFrame(res));
  });

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
    const finish = () => {
      if (fired) return;
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
  const openSettings = () => pushScreen('settings');
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
    const top =
      others.some(s => $(s) && $(s).classList.contains('on')) ? ''
      : ($('#compView').classList.contains('on') && skip !== '#compView') ? 'comp'
      : ($('#workshop').classList.contains('on') && skip !== '#workshop') ? 'wall'
      : 'chat';
    tellNative(top === 'chat' ? 'chat' : 'settings');
  };

  const pushScreen = (id, from) => {
    const s = $('#' + id);
    s.classList.remove(...ANIM_CLASSES);          // ★ 先全清，见上面那段 ✓
    const cls = from === 'top'    ? 'anim-drop'
              : from === 'corner' ? 'anim-corner'
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
    s.classList.remove(...ANIM_CLASSES);          // ★ 先全清 ✓
    const cls = how === 'top'    ? 'anim-lift'
              : how === 'corner' ? 'anim-corner-out'
              : 'anim-out';                       // 默认：从右边退回去 ✓
    s.classList.add(cls);
    void s.offsetWidth;                           // 同理，连点两次也要重放 ✓
    afterAnim(s, () => s.classList.remove(cls, 'on'));
    // ★ **按"它已经没了"来报** ✓（不能等动画收尾再报 ✗ —— 那中间有 200ms
    //   原生还以为是别的屏 ✓，返回键在这 200ms 里按下去就会走错 ✓）。
    tellTop(id);
  };

  // ── 屏①：列表 ─────────────────────────────────────────────────────
