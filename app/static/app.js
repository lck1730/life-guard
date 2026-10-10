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
  //   ⚠️ 只管**能滚的那几屏**（`.abody` ✓，管家那几屏就是 ✓）；
  //      两个聊天的输入框不在 `.abody` 里 ✓，它们走上面那条"键盘留白"的路 ✓。
  //   ⚠️ 弹层（`#sheetPanel`）有它自己那套 ✓（就在下面 ✓），不在这儿重复管 ✗。
  document.addEventListener('focusin', (ev) => {
    const t = ev.target;
    if (!t || !t.tagName) return;
    if (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') return;
    if (t.closest('#sheetPanel')) return;
    if (!t.closest('.abody')) return;
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
  const applyTheme = (t) => {
    document.documentElement.dataset.theme = t;
    localStorage.setItem('lg_theme', t);
    $$('[data-theme-set]').forEach(b => b.classList.toggle('on', b.dataset.themeSet === t));
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = t === 'light' ? '#f5f6fa' : '#0f1115';
    // 让原生同步状态栏图标的明暗，否则浅色主题下白图标会看不见
    try { window.LifeGuardNative?.setLightStatusBar?.(t === 'light'); } catch {}
  };
  applyTheme(localStorage.getItem('lg_theme') || 'dark');
  $$('[data-theme-set]').forEach(b => b.onclick = () => applyTheme(b.dataset.themeSet));

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

  // ★ 开机那圈转：**延迟 200ms 才亮** ✗→✓ —— 2026-10-06。
  //
  //   它原来是**写死在 HTML 里**的 ✓ → 第一帧就在屏幕上 ✓ →
  //   而这一趟加载往往一百多毫秒就完了 ✓ → 转圈**只闪了那么一下** ✓
  //   —— 用户说的"从我的进来会闪一下"，多半就是它 ✓
  //   （从「设置」回来不闪 ✓，因为那压根没换文档 ✓）。
  //
  //   现在：先藏着 ✓，200ms 还没好才亮 ✓ ——
  //   **快的时候它根本不出现** ✓，慢的时候它照常兜住"别让人对着空白等" ✓。
  let bootTimer = setTimeout(() => {
    const b = $('#boot');
    if (b) b.hidden = false;
  }, 200);

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
    // 第一屏出现的那一刻，才把开机占位收掉（否则会先闪一下空白/登录页）
    const boot = $('#boot');
    if (boot) boot.hidden = true;
    if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
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
  const renderAgent = () => {
    const m = $('#agentBody');
    if (!m) return;
    m.textContent = '';

    // 资料块：**点它进"改管家资料"那一屏** ✓
    //   （用户 2026-10-06："不要下面的点一下换头像，而是点击进去后
    //     进入类似于我的进头像也一样" ✓）
    const prof = mkel('div', 'prof');
    const av = mkel('div', 'av', '管');
    applyAgentAvatar(av);
    prof.appendChild(av);
    const who = mkel('div', 'who');
    who.appendChild(mkel('div', 'n', agentName()));
    prof.appendChild(who);
    prof.appendChild(mkel('div', 'go', '›'));
    prof.onclick = openAgentEdit;
    m.appendChild(prof);

    m.appendChild(mkel('div', 'sec', '状态显示'));
    const g1 = mkel('div', 'grp');
    ['idle', 'thinking', 'silent'].forEach((k) => {
      const b = mkel('button', 'row');
      b.appendChild(mkel('span', 'rl', KIND_LABEL[k]));
      // ⚠️ 右边原来写的是**四个字**「点击编辑」✗→✓（2026-10-09 用户定的：
      //   「管家那里的三个状态的点击编辑替换为 `>` 吧」✓）——
      //   换成那个 `›` ✓，和这一页的资料卡、我的那三行、设置页那几行**同一个记号** ✓
      //   （`›` 在整个 App 里就是"点得进去"✓；写成四个字反而是这里独有的形状 ✓）。
      b.appendChild(mkel('span', 'go', '›'));
      b.onclick = () => openStateScreen(k);
      g1.appendChild(b);
    });
    m.appendChild(g1);

    m.appendChild(mkel('div', 'sec', '性格'));
    const g2 = mkel('div', 'grp');
    g2.appendChild(promptBlock());
    m.appendChild(g2);
  };

  // ── 性格：**直奔一个文本框** ✓（用户："不要给管家的话，直接一个文本框" ✓）──
  //
  // 平时只露**前两行** ✓（`-webkit-line-clamp:2` ✓），点开才展开编辑 ✓。
  let promptEditing = false;

  /**
   * ★ **一段「能收能展」的长文本** ✓ —— 管家那边的「性格」和「我的」里的
   *   「自我介绍」**长得一模一样** ✓（用户 2026-10-09：
   *   「将字数上限设为800，然后将**同样配置在我的也做一份**，在我的那里叫自我介绍」✓）
   *   → 所以**只写一份** ✗→✓（"同一件事两处写"这个项目栽过好几次 ✓）。
   *
   *   `get()` 拿现在的文本 ✓、`save(text)` 存 ✓、`max` 字数上限 ✓、
   *   `onEditing(v)` 可选 ✓（管家那边要拿它告诉 `patchGroup`「我在编辑，先别重画」✓）。
   *
   *   ⚠️ 收起态的规矩写在 CSS 那段里（三行 + 末尾 `…` + 第三行淡出 + 居中朝下的箭头 ✓）。
   *   ⚠️「展示不完」是**量出来的** ✗→✓（`scrollHeight > clientHeight` ✓），不是猜的 ✓ ——
   *      短文本不该被白蒙一层 ✓。
   */
  const collapsibleText = ({ get, save, placeholder, max, onEditing }) => {
    const wrap = mkel('div', 'pwrap');
    let editing = false;
    const setEditing = (v) => { editing = v; if (onEditing) onEditing(v); };
    const draw = () => {
      wrap.textContent = '';
      const cur = get() || '';
      if (!editing) {
        const box = mkel('div', 'pbox' + (cur ? '' : ' empty'));
        const txt = mkel('div', 'pt', cur || placeholder);
        // ⚠️ 那个箭头**单独一行、居中** ✓（原来贴在文字右边 ✗，见 CSS 那段 ✓）
        const more = mkel('div', 'pmore');
        more.appendChild(mkel('span', 'chev', '›'));
        box.append(txt, more);
        box.onclick = () => { setEditing(true); draw(); };
        wrap.appendChild(box);
        requestAnimationFrame(() => {
          if (txt.scrollHeight > txt.clientHeight + 1) txt.classList.add('fade');
        });
        return;
      }
      const ta = mkel('textarea', 'ptext');
      ta.value = cur;
      ta.maxLength = max;
      const foot = mkel('div', 'pfoot');
      const cnt = mkel('span', 'cnt', cur.length + ' / ' + max);
      ta.oninput = () => { cnt.textContent = ta.value.length + ' / ' + max; };
      const cancel = mkel('button', null, '取消');
      cancel.style.color = 'var(--muted)';
      cancel.onclick = () => { setEditing(false); draw(); };
      const sv = mkel('button', null, '保存');
      sv.onclick = () => {
        // ⚠️ **先收起、再存** ✓（和原来那条规矩一样 ✓）——
        //    存失败时也不会把他卡在编辑态 ✓（原因从那句话里出来 ✓）。
        setEditing(false);
        draw();
        save(ta.value.trim());
      };
      foot.append(cnt, cancel, sv);
      wrap.append(ta, foot);
      // ⚠️ 聚焦之后"把它滚进看得见的地方"那件事，统一由上面那个 `focusin` 管 ✓，
      //    这里只负责聚焦 ✓。
      setTimeout(() => { try { ta.focus(); } catch (e) {} }, 60);
    };
    draw();
    return wrap;
  };

  /**
   * 「我的」里的**自我介绍** ✓ —— 同一套块 ✓（用户 2026-10-09：
   * 「将同样配置在我的也做一份，**在我的那里叫自我介绍**」✓）。
   * ⚠️ 它走的是另一条接口 ✓（`POST /api/me/self-intro` ✓）——
   *    存的是**这个人自己**的自我介绍 ✓（`group_members.self_intro` ✓），
   *    每轮对话由服务端注进管家看到的成员名单里 ✓（见 `_group_persona` ✓）。
   */
  const selfIntroBlock = () =>
    collapsibleText({
      get: () => (me && me.self_intro) || '',
      save: async (t) => {
        try {
          const out = await api('/me/self-intro', {
            method: 'POST', body: JSON.stringify({ text: t }),
          });
          me.self_intro = out.self_intro;
          renderMe();                 // 收起态那一块要跟着变成新文本 ✓
          toast(out.self_intro ? '保存了，它下次开口就带着这个' : '擦掉了');
        } catch (e) { toast((e && e.message) || '没保存上'); }
      },
      placeholder: '想让管家知道点什么？比如你习惯什么时候起床、'
                 + '喜欢什么、最近在忙什么。不写也行。',
      max: 800,
    });

  /** 管家的「性格」= 上面那个通用块 ✓（`promptEditing` 是给 `patchGroup` 看的 ✓）。 */
  const promptBlock = () =>
    collapsibleText({
      get: () => (group && group.agent_user_prompt) || '',
      save: (t) => patchGroup({ agent_user_prompt: t }),
      placeholder: '描述一下管家的性格…',
      max: 800,
      onEditing: (v) => { promptEditing = v; },
    });

  const openAgentSettings = () => {
    promptEditing = false;
    normalizeStatus();
    renderAgent();
    pushScreen('agent');
  };
  const closeAgentSettings = () => popScreen('agent');

  // ── 屏②：改管家资料（头像 + 昵称，**一起保存** ✓）────────────────
  //
  // 版式**照壳「我的」进头像那一页** ✓（`卡片(大头像+点击头像替换)` +
  // `卡片(昵称 + 保存)` + 卡片**外面**的「取消」✓）——
  // 用户 2026-10-06 明确要求"类似于我的进头像也一样"、
  // "在点击头像替换的下方、保存的上方再加一个昵称条" ✓、"底下还是取消" ✓。
  let editFile = null;

  const openAgentEdit = () => {
    editFile = null;
    renderAgentEdit();
    pushScreen('agentEdit');
  };
  const closeAgentEdit = () => popScreen('agentEdit');

  const renderAgentEdit = () => {
    const m = $('#agentEditBody');
    if (!m) return;
    m.textContent = '';

    // 卡片一：头像
    const card = mkel('div', 'card avcard');
    const f = mkel('input');
    f.type = 'file';
    f.accept = 'image/*';
    f.style.display = 'none';           // 原生文件框太丑，藏起来 ✓
    const big = mkel('div', 'bigav');
    const av = mkel('div', 'av', '管');
    applyAgentAvatar(av);
    av.onclick = () => f.click();       // **头像本身就是那个按钮** ✓，不多放按钮 ✓
    f.onchange = () => {
      const file = f.files && f.files[0];
      if (!file) return;
      // 选完**先在本地显示出来** ✓ —— 不然用户点完"看不到变化" ✓，
      // 会以为没选上、再点一次 ✓（压缩本来就要做 ✓，顺手画出来 ✓）。
      shrinkToJpeg(file, 320).then(blob => {
        editFile = new File([blob], 'a.jpg', { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        av.textContent = '';
        av.style.backgroundImage = "url('" + url + "')";
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
    nm.value = agentName();
    nm.maxLength = 32;
    card2.appendChild(nm);
    const err = mkel('div', 'err', '');
    card2.appendChild(err);
    const save = mkel('button', 'btn-save', '保存');
    card2.appendChild(save);
    m.appendChild(card2);

    // 卡片**外面**的取消 ✓ —— 夹在卡片里会跑到「保存」上面去 ✗（壳那边栽过 ✓）
    const back = mkel('div', 'swap');
    back.appendChild(mkel('b', null, '取消'));
    back.onclick = () => closeAgentEdit();
    m.appendChild(back);

    save.onclick = async () => {
      save.disabled = true;
      err.textContent = '';
      try {
        // ★ **最后一起保存** ✓（用户定的 ✓）：先传头像 ✓，再存昵称 ✓。
        if (editFile) await uploadAgentAvatarFile(editFile);
        const name = nm.value.trim();
        if (name && name !== agentName()) {
          const g = await api(`/groups/${group.id}`,
                              { method: 'PATCH', body: JSON.stringify({ agent_name: name }) });
          if (g) group = g;
        }
        editFile = null;
        toast('已保存');
        closeAgentEdit();
        await refreshGroup();
      } catch (e) {
        err.textContent = e.message || '没存上';
        save.disabled = false;
      }
    };
  };

  // ── 屏③：编一档状态（**底部半屏 + 三块板** ✓）────────────────────
  //
  // 用户 2026-10-06 第二次提的：从整屏**改回下方的半屏** ✓
  // ——键盘那一套（`#sheetPanel` 上的 ResizeObserver + focusin 滚动 ✓）本来就是
  //   挂在弹层上的 ✓，用弹层是**白拿** ✓；而且描述起来也更像"改一个小设置"✓。
  //
  // 三块板（"板块化会美观些" ✓）：
  //     待机显示 = ① 开关 + ② 状态区/添加 + ③ 轮换间隔
  //     思考中   = ②（**没有开关** ✓）
  //     保持沉默 = ① + ②
  //
  // **这一屏没有保存按钮** ✓（版式里没有 ✓）→ 改动**自动存** ✓：
  //   开关、删除、添加 → 立刻 ✓；打字 → **防抖 900ms** ✓
  //   （一个请求一个字是灾难 ✗）；关掉弹层再兜一次 ✓（靠 `sheetCloseHook` ✓）。
  let stKind = 'idle';
  let stLines = [];
  let stOn = true;
  let stTimer = null;
  let stEvery = 600;          // 草稿值（秒 ✓）
  let stEveryTimer = null;

  const stEveryMin = () => Math.round((stEvery || 600) / 60);

  /** 存轮换间隔 ✓。和文字一样走防抖 ✓ —— 边打字边存等于一个字一次请求 ✗。 */
  const flushEvery = () => {
    if (stEveryTimer) { clearTimeout(stEveryTimer); stEveryTimer = null; }
    if (stEvery < 60 || stEvery > 86400) return;
    if (stEvery === ((agentCfg().idle || {}).every || 600)) return;   // 没变就别发 ✓
    commitCfg(c => { c.idle = Object.assign({}, c.idle, { every: stEvery }); });
  };
  const touchEvery = (minutes) => {
    stEvery = minutes * 60;
    if (stEveryTimer) clearTimeout(stEveryTimer);
    stEveryTimer = setTimeout(flushEvery, 900);
  };

  const flushState = () => {
    if (stTimer) { clearTimeout(stTimer); stTimer = null; }
    const clean = stLines.map(x => String(x || '').trim()).filter(Boolean);
    // 全删空 → **不存** ✓。服务端会把空池子填回默认 ✓，
    // 存进去等于"我就是要一条都不留"✗ —— 那不是这个意思 ✓。
    if (!clean.length) return;
    commitCfg((c) => {
      c[stKind] = Object.assign({}, c[stKind], { lines: clean });
      if (stKind !== 'thinking') c[stKind].on = stOn;
    });
  };
  const touchState = () => {
    if (stTimer) clearTimeout(stTimer);
    stTimer = setTimeout(flushState, 900);
  };

  const openStateScreen = (kind) => {
    stKind = kind;
    const it = agentCfg()[kind] || {};
    stLines = (it.lines || []).slice();
    stOn = it.on !== false;
    stEvery = (agentCfg().idle || {}).every || 600;
    renderStateSheet();
    openSheet();
    // ★ 弹层一关就兜一次存 ✓ —— 这一屏没有保存按钮 ✓，
    //   而"打完最后一个字直接滑走"是最常见的动作 ✓，不兜就丢字 ✓。
    sheetCloseHook = () => { flushState(); flushEvery(); };
  };

  const renderStateSheet = () => {
    const p = $('#sheetPanel');
    if (!p) return;
    p.textContent = '';
    // ⚠️ 这里原来还有一个 `<h3>待机显示</h3>` ✗ —— 去掉 ✓。
    //   板① 左边写的就是**这一档的名字** ✓（用户 2026-10-06 定的 ✓），
    //   同一屏里同一个名字写两遍是重复 ✓。

    // 板①：开关（思考中**没有** ✓）
    if (stKind !== 'thinking') {
      const b1 = mkel('div', 'sblk');
      const r = mkel('div', 'hrow');
      // 左边 = **这一档的名字** ✓（原来是"显示这条状态条" ✓，用户要换掉 ✓）
      r.appendChild(mkel('span', 't', KIND_LABEL[stKind]));
      const seg = mkel('span', 'seg');
      const on = mkel('button', null, '开');
      const off = mkel('button', null, '关');
      const paint = () => { on.classList.toggle('on', stOn); off.classList.toggle('on', !stOn); };
      on.onclick = () => { stOn = true; paint(); flushState(); };
      off.onclick = () => { stOn = false; paint(); flushState(); };
      seg.appendChild(on);
      seg.appendChild(off);
      paint();
      r.appendChild(seg);
      b1.appendChild(r);
      p.appendChild(b1);
    }

    // 板②：状态区（**固定三行**，超出滚动）+ 添加一条
    const b2 = mkel('div', 'sblk');
    const list = mkel('div', 'slist2');
    const draw = () => {
      list.textContent = '';
      stLines.forEach((s, i2) => {
        const r = mkel('div', 'srow2');
        const inp = mkel('input');
        inp.value = s;
        inp.maxLength = 40;
        inp.placeholder = '写一句…';
        inp.oninput = () => { stLines[i2] = inp.value; touchState(); };
        inp.onblur = flushState;
        const del = mkel('button', 'del', '✕');
        del.onclick = () => {
          if (stTimer) { clearTimeout(stTimer); stTimer = null; }
          stLines.splice(i2, 1);
          draw();
          flushState();
        };
        r.appendChild(inp);
        r.appendChild(del);
        list.appendChild(r);
      });
    };
    draw();
    b2.appendChild(list);
    const add = mkel('button', 'addline2', '＋ 添加一条');
    add.onclick = () => {
      if (stLines.length >= 20) { toast('最多 20 条'); return; }
      if (stTimer) { clearTimeout(stTimer); stTimer = null; }
      stLines.push('');
      draw();
      flushState();
      const ins = list.querySelectorAll('input');
      if (ins.length) {
        ins[ins.length - 1].focus();
        list.scrollTop = list.scrollHeight;   // 新加的那条要在视野里 ✓
      }
    };
    b2.appendChild(add);
    p.appendChild(b2);

    // 板③：轮换间隔（**只有待机有** ✓）
    //
    // **就地一个输入框** ✓ —— 用户 2026-10-06："点击直接编辑输入框，不用额外的界面" ✓。
    // 原来点一下会弹 `promptText` ✓ —— 为了一个数字跳一趟界面太重 ✓，
    // 而且弹层换掉之后**回不来** ✗（得手动再点一次"点击编辑" ✓）。
    if (stKind === 'idle') {
      const b3 = mkel('div', 'sblk');
      const r = mkel('div', 'intvrow');
      r.appendChild(mkel('span', 't', '轮换间隔'));
      const inp = mkel('input');
      inp.type = 'number';
      inp.min = '1';
      inp.max = '1440';
      inp.value = String(stEveryMin());
      inp.oninput = () => {
        const n = Math.round(Number(inp.value));
        // 打到一半 / 越界 → **先什么都不做** ✓（不要一边打字一边报错 ✓，
        // 也不要把一个半成的值写上去 ✗）。松手/失焦时下面那个兜底会兜住 ✓。
        if (!n || n < 1 || n > 1440) return;
        touchEvery(n);
      };
      inp.onblur = flushEvery;
      r.appendChild(inp);
      r.appendChild(mkel('span', 'u', '分钟'));
      b3.appendChild(r);
      p.appendChild(b3);
    }
    // 底部那几行小字解释**去掉了** ✓（用户 2026-10-06）——
    // "重开 App 不会重置"那种话是**实现细节** ✓，说一次就够 ✓，
    // 每次打开这块板都念一遍就成了噪音 ✓。
  };

  // ── 换管家头像 ────────────────────────────────────────────────────
  //
  // ⚠️ **必须先在手机上缩** ✗ —— 手机原图 3~8MB ✓，
  //   而 `/api/groups/{id}/agent-avatar` 限 **2MB** ✗ → 不缩必然 413 ✗
  //   （报错还是"图片不能超过 2MB"✓，用户只会觉得莫名其妙 ✓）。
  // ⚠️ **在手机上缩，不在服务器上缩** ✗ —— 手机原图 3~8MB ✓，
  //   传上去再缩等于白占一趟网络 ✓，而且服务端要为此引一个图像库 ✗
  //   （壳的生存策略是"只用标准库"✓，照它那份写一份 ✓）。
  const shrinkToJpeg = (file, max) => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('读不了这个文件'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('这不是一张能打开的图'));
      img.onload = () => {
        const s = Math.min(1, (max || 256) / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * s));
        cv.height = Math.max(1, Math.round(img.height * s));
        cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
        cv.toBlob(b => b ? resolve(b) : reject(new Error('缩不了这张图')), 'image/jpeg', 0.85);
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });

  const uploadAgentAvatarFile = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(`/api/groups/${group.id}/agent-avatar`,
                          { method: 'POST', body: fd, credentials: 'same-origin' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.detail || ('上传失败 ' + r.status));
    }
    // ★ 缓存是**故意**的 ✓（一次开 App 只探一次 ✓）→ 换了图必须手动清 ✓，
    //   否则整屏都还是旧那张 ✓，而用户只会说"换了没反应" ✗。
    resetAgentAvatar();
    repaintAgentAvatars();
  };

  /** 换完头像，**已经在屏幕上的**气泡也得跟着变 ✓ —— 它们不会自己更新 ✗。 */
  const repaintAgentAvatars = () => {
    document.querySelectorAll('#msgs .row.agent .av').forEach(applyAgentAvatar);
  };

  /** 原生返回键调这个。返回 true 表示"我处理了，别退出应用"。 */
  //
  // ⚠️ 顺序不能换 ✗ —— 弹层在最上 ✓，三屏是**一层压一层** ✓
  //   （编状态 > 改资料 > 列表 > 群设置 ✓），得从上往下关 ✓。
  window.__goBack = () => {
    // ⚠️ **确认框排最前面** ✓ —— 它在最上面（z-index 60 > 弹层 50 > 各屏 20 几 ✓），
    //    所以按返回该先关它 ✓（顺序就是"从上往下"✓，见下面那段 ✓）。
    if ($('#modal').classList.contains('on')) { if (modalClose) modalClose(); return; }
    // 长按消息的小卡片（z 58 ✓）：在确认框(60)之下、弹层(50)之上 ✓
    if ($('#msgcard').classList.contains('on')) { closeMsgCard(); return; }
    // ★ **自由复制那个文本框**（z 57 ✓，就在小卡片下面一档 ✓）——
    //   它开着的时候按返回 = "不复制了" ✓（和点空白是同一件事 ✓）。
    if ($('#copyfield')) { endFreeCopy(); return; }
    if ($('#sheet').classList.contains('on')) { closeSheet(); return; }
    // ★ 创意工坊那几屏（2026-10-07）—— **压在管家那三屏上面** ✓：
    //   diy 助手 > 组件页 > 聊天 > 导航 > 工坊 > 编状态 > 改资料 > 管家列表 > 群设置 ✓。
    // ⚠️ **顺序必须严格等于 z-index 从大到小** ✗→✓（2026-10-08 重排过一次）——
    //    它是"先关最上面那一屏"的意思 ✓；写反了的话按一下返回会**隔着两层
    //    关掉底下那层** ✓（屏幕上那一屏不动 ✓ —— 用户看到的是"按了没反应"✓）。
    //    这天报的两个毛病都是这条：`#diySet` 从 25 提到 27 ✓、
    //    `#compView`（26）从 `#wsChat`（25）**后面**挪到**前面** ✓
    //    （点上方组件名进组件页时，两屏是**同时开着**的 ✓ —— 原来会隔着它
    //     把下面的聊天关掉 ✓）。
    //    加新屏时**照 z-index 插进来** ✓，别凭感觉往后面追加 ✗。
    // ★★ **2026-10-09：`#me` 那一族提到 30/31** ✗→✓ —— 它们现在**比工坊那一摞还高** ✓
    //    （用户报的"在组件聊天里点我的头像没反应"就是这条 ✓，见 CSS 那一段 ✓）。
    //    → 所以这一族要挪到**这里**（表的最前面）✓，不能再留在下面 ✗。
    if ($('#meEdit').classList.contains('on')) { closeMeEdit(); return; }
    if ($('#me').classList.contains('on')) { closeMe(); return; }
    if ($('#peer').classList.contains('on')) { closePeer(); return; }
    if ($('#diySet').classList.contains('on')) { closeDiySet(); return; }
    // ⚠️ **`#wsChat`（28）现在在 `#compView`（26）上面** ✗→✓（2026-10-09）——
    //    这两行的**先后跟着 z-index 反过来了** ✓（见 CSS 那段：组件页要留在
    //    底下开着 ✓，聊天压在它上面 ✓）。写反了还是老毛病：按一下返回
    //    **隔着聊天把底下那个组件页关掉** ✓，屏幕上聊天纹丝不动 ✓。
    if ($('#wsChat').classList.contains('on')) { closeWsChat(); return; }
    if ($('#compView').classList.contains('on')) { closeComp(); return; }
    if ($('#workshop').classList.contains('on')) { closeWorkshop(); return; }
    if ($('#agentEdit').classList.contains('on')) { closeAgentEdit(); return; }
    if ($('#agent').classList.contains('on')) { closeAgentSettings(); return; }
    // ★ 2026-10-08 新加的两屏（`#meAccount` 13 > `#me` 12 > `#settings` 10 ✓）——
    //   照旧**按 z-index 从大到小**插 ✓（这条铁律写在上面那段里 ✓）。
    // ⚠️ 初始化屏（`#init`）**要在这儿** ✗→✓（2026-10-09）——
    //   它在最底下 ✓（`show()` 那一类 ✓），但**必须有个出路** ✓：
    //   退一步 = 回登录页 ✓（那一页会把票清掉 ✓ = 登出 ✓）。
    //   原来它不在这个表里 ✗ → 返回键落到原生那个"再滑一次退出 App" ✓ →
    //   用户的感觉是"进退两难" ✓（他报的就是这个 ✓）。
    if ($('#init').classList.contains('on')) { location.href = '/login'; return; }
    if ($('#settings').classList.contains('on')) { closeSettings(); return; }
    // ⚠️ `#login` / `#init` **刻意不列在这儿** ✗ —— 它们是**根屏** ✓：
    //   在它们上面按返回键，该走原生那条"再滑一次退出 App" ✓。
    //   列进来的话，`__goBack` 会把返回键吃掉却什么都不做 ✗ ——
    //   那正好是这个项目最讨厌的那种"死按钮" ✓。
  };

  // ── 登录 ──
  //
  // ★ **这个页面不再有"登录"这回事** ✓ —— 2026-10-06。
  //
  //   登录页只有一个 ✓，住在壳上（`8730/login` ✓）。
  //   服务端那条 `/auth/login` 也早就是 **410** 了 ✓（`routes_auth.py` 写着：
  //   留着是为了给旧界面一句人话，**不再接受密码** ✓ —— 它是这次重构
  //   要消灭的"第二条登录路径" ✗）。
  //
  //   但页面这边还留着一套输入框 + 按钮 ✗ → 真点到了就撞 410 ✓ →
  //   看到"入口已经搬走了" ✓ —— 那是**一个死胡同** ✗，不是一条路 ✗。
  //   所以：**按钮直接把人送到该去的地方** ✓。
  //
  //   （这个屏现在还留着，但只在**网络不通**时出现 ✓ —— 那时候往壳跳也跳不过去 ✓，
  //    总得让人看见一句话 ✓。彻底删掉这个屏是后面的事，记在待办里 ✓。）
  //
  //   ⚠️ 名字**不能删** ✗：`tools/check-page.sh` 把 `doLogin` 列为关键标记 ✓，
  //   它守的是"内联脚本没被某个字面量提前截断" ✓。
  //
  // ★ 2026-10-08 合并那次：**它真的开始登录了** ✗→✓。
  //   原来它只是把人送去壳的登录页 ✓（那时候登录归壳管 ✓）；
  //   现在登录就在这个服务里 ✓（`POST /api/login` ✓），
  //   所以这一屏从"一个死胡同"变成了**真正的入口** ✓
  //   （用户 2026-10-08 定的第一条就是"不再区分壳和生活管家，包括最开始的登录"✓）。
  //
  //   注册是**同一屏的另一个状态** ✓（`registering` ✓）—— 内测码是闸门 ✓。
  let registering = false;

  const _authErr = (msg) => { $('#loginErr').textContent = msg || ''; };

  // ★ 2026-10-09：文案和布局**照壳那一版** ✗→✓（用户说"和之前保持一致"✓）。
  const _setAuthMode = (on) => {
    registering = on;
    $$('#login .regonly').forEach(el => { el.hidden = !on; });
    $('#doLogin').textContent = on ? '注册并登录' : '登录';
    $('#authSwap').textContent = on ? '已有账号，去登录' : '还没有账号？创建一个';
    _authErr('');
  };

  const doLogin = async () => {
    const btn = $('#doLogin');
    const u = $('#u').value.trim(), p = $('#p').value;
    if (!u || !p) { _authErr('用户名和密码都要填'); return; }
    if (registering && !$('#betaCode').value.trim()) { _authErr('请填写内测码'); return; }
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = registering ? '注册中…' : '登录中…';
    try {
      if (registering) {
        // 记住上次输的用户名 ✓（壳那一版有这个：`window.__lastUser` ✓）——
        // 手机上打字贵 ✓，注册没成功再回来不用重打 ✓。
        try { window.__lastUser = u; } catch (e) {}
        await api('/register', {
          method: 'POST',
          body: JSON.stringify({ code: $('#betaCode').value.trim(), username: u,
                                 password: p, password2: $('#p2').value }),
        });
      } else {
        await api('/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) });
      }
      // ★ 登录成功之后**换地址、不换页面** ✓ —— `history.replaceState` 而不是
      //   `location.href='/'` ✗：后者会把整页重新下一遍 ✓（100KB ✓ 白屏一下 ✓），
      //   而我们手上已经有全部代码了 ✓。
      //   ⚠️ 但**登出必须真导航** ✗（要清 httpOnly cookie ✓，见 `logout()` ✓）。
      try { history.replaceState(null, '', '/'); } catch (e) {}
      await enterApp();
    } catch (e) {
      _authErr(e && e.message ? e.message : '连不上服务器');
      btn.disabled = false;
      btn.textContent = was;
    }
  };
  try {
    if (window.__lastUser) $('#u').value = window.__lastUser;
    else if (localStorage.getItem('lg_last_user')) $('#u').value = localStorage.getItem('lg_last_user');
  } catch (e) {}
  $('#u').addEventListener('change', () => {
    try { localStorage.setItem('lg_last_user', $('#u').value.trim()); } catch (e) {}
  });
  $('#doLogin').onclick = doLogin;
  $('#authSwap').onclick = () => _setAuthMode(!registering);
  $('#p').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('#p2').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

  // ── 初始化：还没有生活空间的人停在这一屏 ────────────────────────────
  //
  // 形状是用户 2026-10-08 定的 ✓：居中一句欢迎 + 一个蓝按钮 ✓；
  // **点按钮才浮出介绍卡** ✓（他要"在这个界面居中浮空一个提示小框"✓）。
  // 建 / 加入之后**重走一次 `enterApp`** ✓ —— 那条路最后一次走是
  // "没有空间" ✓，现在有了 ✓，它自己会落到主群聊 ✓（不用手写跳转 ✓）。
  // ★ 错了就**弹一张居中的小卡** ✓（用户 2026-10-10 定的 ✓）——
  //   几秒后自己消失 ✓、不用点 ✓、也不会把卡片里的东西顶下去 ✓
  //   （内嵌那行红字以前一出现，下面两颗框和按钮全跟着往下挪一下 ✓）。
  // ⚠️ 时长 **3.6 → 2 秒** ✓（同一条指示 ✓）；
  //    它只有一行字、而且人会立刻再试一次 ✓，两秒够看清了 ✓。
  const _initErr = (msg) => { if (msg) showNotice(msg, 2000, 'err'); };

  // ★ 2026-10-09：**没有介绍卡了** ✓（用户："对空间的介绍去掉，界面简洁"✓）——
  //   点这个按钮**直接进表单** ✓。
  $('#initGo').onclick = () => {
    // ⚠️ **每次浮出来都是干净的一份** ✗→✓：上一次没填完的值还留着 ✓的话，
    //    两个框的互斥状态也就跟着是旧的 ✓（他看到的会是"另一个框怎么锁着"✓）。
    $('#spaceName').value = '';
    $('#joinCode').value = '';
    syncSpaceForm();                   // 两个都空 → 那颗按钮该是灰的 ✓
    $('#init').classList.add('formopen');    // 藏掉这一屏自己那三行 ✓
    $('#introCard').hidden = false;
    $('#initGo').hidden = true;        // 表单出来了，那个入口就该让位 ✓
    _initErr('');
    setTimeout(() => { try { $('#spaceName').focus(); } catch (e) {} }, 80);
  };

  /**
   * ★ **两个框互斥 + 底部那颗按钮亮不亮** ✓（用户 2026-10-10 定的 ✓）：
   *   · 哪个框先有内容 ✓，另一个就**锁上** ✓（他说"自动不能填写"✓）——
   *     空回来的时候会自己解锁 ✓（因为他把内容删了 ✓）。
   *   · 两个都空 → 按钮**灰的** ✓；任意一个填了 → 可点 ✓。
   *
   * ⚠️ 它挂在 `input` 上 ✓（不是 `change` ✗）—— `change` 要等失焦才发 ✓，
   *    那样"删空之后按钮还亮着" ✓（点了会走进一个没填的分支 ✓）。
   */
  const syncSpaceForm = () => {
    const nm = $('#spaceName').value.trim();
    const cd = $('#joinCode').value.trim();
    $('#spaceName').disabled = !!cd;
    $('#joinCode').disabled = !!nm;
    $('#spaceGo').disabled = !nm && !cd;
  };
  ['#spaceName', '#joinCode'].forEach((sel) => {
    $(sel).addEventListener('input', syncSpaceForm);
  });

  const _spaceAction = async (btn, busy, fn) => {
    const was = btn.textContent;
    btn.disabled = true;
    btn.textContent = busy;
    _initErr('');
    try {
      await fn();
      await enterApp();
    } catch (e) {
      // ⚠️ **服务端那句话原样给他看** ✓ —— 它说得比"操作失败"清楚得多 ✓
      //   （"你已经有一个生活空间了" / "这个生活空间已经满了（最多 3 个人）" ✓）。
      _initErr(e && e.message ? e.message : '没成功，再试一次');
      btn.disabled = false;
      btn.textContent = was;
    }
  };

  // ★ **一颗按钮管两条路** ✓ —— 填了邀请码就走"加入" ✓，填了名字就走"新建" ✓
  //   （两个框互斥 ✓，所以到这儿**最多只有一个有内容** ✓，不用判"两个都填了怎么办" ✓）。
  $('#spaceGo').onclick = async () => {
    const nm = $('#spaceName').value.trim();
    const cd = $('#joinCode').value.trim();
    const btn = $('#spaceGo');
    if (cd) {
      await _spaceAction(btn, '加入中…', () =>
        api('/workspaces/join', { method: 'POST', body: JSON.stringify({ code: cd }) }));
    } else if (nm) {
      // ⚠️ 「正在开通…（约 6 秒）」那句话是有用的 ✓ —— 开通要起一个 Hermes profile ✓，
      //    真会等好几秒 ✓；不写就等于让人对着不动的按钮猜 ✓。
      await _spaceAction(btn, '正在开通…（约 6 秒）', () =>
        api('/workspaces', { method: 'POST', body: JSON.stringify({ name: nm }) }));
    }
    // 失败时 `_spaceAction` 已经把按钮还原了 ✓ —— 这里再按当前内容算一遍 ✓
    //（不能直接 `disabled = false` ✗：两个框都空的时候它**就该是灰的** ✓）
    btn.textContent = '加入空间';
    syncSpaceForm();
  };
  ['#spaceName', '#joinCode'].forEach((sel) => {
    $(sel).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('#spaceGo').click(); }
    });
  });

  const enterApp = async () => {
    // ★ **一趟拿齐。** 原来是 /auth/me → /groups → /members → /messages
    //   **连着四趟**，每趟都要过 WireGuard —— 开 App 时那片"黑屏"就是它 ✗
    //   现在一次往返搞定（服务端 /bootstrap 把四样一起给）。
    // 注意路径：这个接口注册在 groups 那个 router 下（它要复用群那套查询），
    // 前缀是 /api/groups —— 所以是 /api/groups/bootstrap，不是 /api/bootstrap ✗
    const b = await api('/groups/bootstrap?limit=50');
    me = b.me;
    // ★ 备注跟着这一趟一起下来 ✓（`{peer_id: 备注}` ✓）——
    //   它决定**每条消息画什么名字** ✓，晚一步到就会先按真名画一遍再被覆盖 ✓（看得见的闪 ✓）。
    notes = b.notes || {};
    if (!b.group) {
      // 账号一个空间都没有 ✓ → **初始化界面** ✓（用户 2026-10-08 定的形状：
      //   「居中写上"欢迎使用生活管家！继续使用请先"，然后按钮放在下方」✓）。
      //
      //   原来是回壳的「我的」✗（那时候那是唯一能"新建或加入"的地方 ✓）；
      //   现在那一屏就在这儿 ✓（`#init` ✓），不用再跨服务跳 ✓。
      //
      //   ⚠️ 报给原生的屏名是 **'chat'** ✗ —— 它是**根屏之一** ✓：
      //      在这里按返回键该走"再滑一次退出 App" ✓，而不是"交给网页处理" ✓
      //      （报 'settings' 的话，原生会把返回键交给 `window.__goBack` ✓，
      //       而这一屏**不该**列进 `__goBack` ✓ → 那就是个死按钮 ✓）。
      show('init', 'fade');        // ④ 平级替换：淡入 ✓
      $('#introCard').hidden = true;   // 每次进来都从"只有按钮"那个状态开始 ✓
      $('#init').classList.remove('formopen');   // 那三行该回来了 ✓
      $('#initGo').hidden = false;
      // ★ 2026-10-09：报 **'settings'**（原来报 'chat' ✗）—— 意思是"返回键交给网页" ✓，
      //   而这一屏的返回 = **回登录页** ✓（用户：「目前进这个界面后没法退出，
      //   应该支持返回手势退到登录界面」✓）。见 `__goBack` 里那一支 ✓。
      tellNative('settings');
      $('#introCard').hidden = true;     // 每次进来都从"只有按钮"那个状态开始 ✓
      $('#init').classList.remove('formopen');
      _initErr('');
      return;
      return;
    }
    group = b.group;
    members = b.members || [];
    renderHeader();
    $('#msgs').innerHTML = '';
    // ★ **先让界面出来，再灌历史消息。**
    //   200 条消息的渲染有实打实的耗时（实测那份数据 80KB），而这段时间里
    //   用户看的是转圈 ✗ 先 show 再渲染，观感就变成"一下就进来了、消息跟着刷出来" ✓
    show('chat', 'fade'); tellNative('chat');   // ④ 平级替换：淡入 ✓
    const first = b.messages || [];
    // ⚠️ **必须包一层箭头函数。** 写成 `first.forEach(addMsg)` 的话，
    //    forEach 会把 `(元素, 下标, 数组)` 三个参数一起传进去 ✗ ——
    //    而下标正好落在 addMsg 的第二个参数 `prepend` 上 ✗
    //    → 第 0 条 append、第 1 条往后全 prepend → **整个列表倒过来** ✗
    //    （实测：开 App 看到 400 在最上面、355 在最下面。用户一眼就看出来了。）
    first.forEach(m => addMsg(m));               // 首屏：最近 50 条
    oldestId = first.length ? first[0].id : 0;   // 往回翻的游标
    historyDone = first.length < 50;             // 不够 50 条 → 就这么多历史了
    scrollDown(true);   // 首屏**强制**到底（之后图片撑开会自己再跟，见 scrollDown）
    normalizeStatus(); renderSettings(); connectWS();
    // ★ 组件名的那份索引 ✓ —— 消息里的组件名要靠它才能标蓝 ✓
    //   （`renderContent` 要用 ✓）。**不等它** ✓：历史消息先渲染 ✓，
    //   索引回来之后下一批消息就带色了 ✓（顶多最近几条没色 ✓，不值得为它卡开屏 ✓）。
    refreshCompIndex();
    tailReady = true;   // 到这儿才允许"滚到顶往回加载"（否则开屏时会误触发）
    _fire('ready');   // agent 的 ui/app.js 在这里接手（历史消息已经渲染完了）
    // ★ 2026-10-08：这里原来有一段 `sessionStorage['lg_back_to']` 的还原 ✓ ——
    //   **删掉了** ✗→✓。它当初是为了修"从「我的」回来落到群聊首页" ✓，
    //   而根子是：**去「我的」是一次真导航（跨服务）** ✓，回来时壳不知道
    //   你刚才在工坊的哪条对话 ✓，只好用一个一次性标记把这件事带回来 ✓。
    //
    //   合并之后「我的」是**这一页里的一屏** ✓（`#me` ✓）——
    //   进出根本不离开这个页面 ✗，也就**没有"回来"这回事**了 ✓，
    //   标记连同它的一整族问题一起消失 ✓。
    //   （同一个道理在 `memory/route-not-flag.md` 里写着：
    //     当一个东西得靠附带信号才不出错，那是**模型错了** ✓，不是信号丢了 ✓。）
  };

  const agentName = () => group?.agent_name || '管家';
  // ⚠️ 这份**只是兜底** ✓ —— 正常情况下文案全来自服务端的配置 ✓
  //   （`group.agent_status` ✓，形状与默认值定义在 `app/agent_status.py` ✓）。
  //   留着它是因为两种边角：老服务端、以及 `typing` 这一档不在新配置里 ✓
  //   —— 少了它，"正在输入"会变成一个**空的状态条** ✗。
  const STATUS_TEXT = { idle:'正在窥屏…', thinking:'正在思考…', typing:'正在输入…', lurking:'打算继续窥屏…' };

  const renderHeader = () => { $('#gname').textContent = group?.name || ''; setStatus(curStatus); };

  // ★ 三档文案的分工（2026-10-06，见 app/agent_status.py 那段）：
  //   · 思考中 / 不打算说话 → 服务端在**事件**里挑好一句发下来 ✓
  //   · 待机 → **客户端按时钟轮换** ✓ —— 它是个钟，不是事件 ✓，
  //     服务端不必每十分钟推一次消息 ✓
  let statusCfg = null;
  let idleTimer = null;

  const normalizeStatus = () => {
    // 服务端存的是 JSON **字符串** ✓（列是 TEXT ✓）。
    try { statusCfg = group && group.agent_status ? JSON.parse(group.agent_status) : null; }
    catch (e) { statusCfg = null; }         // 坏字符串 → 当没配置 ✓，别把状态条弄没 ✗
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (curStatus === 'idle') setStatus('idle');
  };

  /** 待机那一句 —— **从时钟直接算** ✓。 */
  //
  // ⚠️ 这么算的**好处**：重启 App **天然不重置** ✓ ——
  //    它不是"从打开那一刻开始数"✗，它根本不数 ✓，它看钟 ✓。
  //    `+ group.id` 是让不同群的换气点**错开** ✓
  //    （不然所有群会在同一秒一起变 ✗，看着像系统在刷新 ✓）。
  const idleLine = () => {
    const it = (statusCfg && statusCfg.idle) || {};
    const lines = it.lines || [];
    if (!it.on || !lines.length) return null;
    const every = Math.max(60, Number(it.every) || 600) * 1000;
    // 相位 = 群号 + **rev** ✓。rev 每存一次 +1（服务端加的 ✓）
    // → **改完点保存，屏幕上立刻换一条** ✓。
    // 少了 rev 这一项，用户改完可能十分钟里看不到任何变化 ✗，
    // 于是他会得出"保存没生效" ✓，然后反复点保存 ✓。
    const phase = ((group && group.id) || 0) + (Number(statusCfg.rev) || 0);
    const i = Math.floor(Date.now() / every + phase) % lines.length;
    return lines[i];
  };

  /** 排下一次换气 ✓ —— 用完就重排 ✓（不是每秒轮询 ✗，空转是白烧电）。 */
  const scheduleIdle = () => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    const it = (statusCfg && statusCfg.idle) || {};
    if (!it.on || !(it.lines || []).length) return;
    const every = Math.max(60, Number(it.every) || 600) * 1000;
    const now = Date.now();
    const wait = (Math.floor(now / every) + 1) * every - now;
    idleTimer = setTimeout(() => {
      if (curStatus === 'idle') setStatus('idle');
      scheduleIdle();
    }, wait + 50);
  };

  // 状态**只出现在顶栏**。早期版本还在消息列表里插一条"正在输入"，
  // 结果和顶栏重复，还占消息流的位置。
  const setStatus = (s, text) => {
    curStatus = s;
    const el = $('#status'), tx = $('#statusText');
    let line = text;
    if (!line) {
      if (s === 'idle') line = idleLine();
      else {
        // 服务端没带文字（重连后补状态那条 ✓、老服务端 ✓）→ 自己从配置里随机挑 ✓
        const k = s === 'lurking' ? 'silent' : s;
        const it = (statusCfg && statusCfg[k]) || {};
        const lines = (it.on && it.lines) || [];
        line = lines.length ? lines[Math.floor(Math.random() * lines.length)]
                            : (STATUS_TEXT[s] || null);
      }
    }
    // ★ **这一档关掉 → 整条收起来** ✓（用户 2026-10-06 定的 ✓）：
    //   待机显示关掉之后，屏幕上就只剩群名 ✓，而不是留一条空的 ✗。
    if (!line) { el.hidden = true; return; }
    el.hidden = false;
    el.className = 'status s-' + s;
    tx.textContent = agentName() + line;
    if (s === 'idle') scheduleIdle();
  };
  let revertTimer = null;
  const setStatusTimed = (s, text) => {
    clearTimeout(revertTimer);
    setStatus(s, text);
    if (s === 'lurking') revertTimer = setTimeout(() => setStatus('idle'), 4000);
  };

  // ── 消息 ──
  // ★ 只在"用户还在底部"时才自动跟到底。
  //
  // 踩过：`scrollDown()` 只在渲染完执行一次 ✗ —— 而图片是**异步加载**的，
  // 加载完高度才撑开，那一次"滚到底"早就不是底部了 ✗
  // 于是开 App 停在最旧的那一条上（用户原话：怎么是昨天 19 点的）。
  //
  // 所以：记住"他是不是还在底部" ✓ 图片一加载完就再跟一次 ✓
  // 他要是自己往上翻了，就别打扰他 ✗
  let stickBottom = true;
  const scrollDown = (force) => {
    const m = $('#msgs');
    if (force) stickBottom = true;
    if (stickBottom) m.scrollTop = m.scrollHeight;
  };

  /**
   * **组件对话那个列表也滚到底** ✓（用户 2026-10-09：「组件聊天和主聊天，
   * 聊天的**输入法要能够顶起最新的消息**」✓）。
   * ⚠️ 它**不学** `#msgs` 那套"贴不贴底"的判断 ✗ —— 组件对话本来就是
   *    "它当着你的面在做东西" ✓，新内容永远该跟着看 ✓
   *    （那边别处也都是**硬滚** ✓，见流式那段 ✓），这里跟它们保持一致 ✓。
   */
  const scrollWsDown = () => {
    const m = $('#wsMsgs');
    if (m) m.scrollTop = m.scrollHeight;
  };
  const fmtTime = s => {
    if (!s) return '';
    const d = new Date(s * 1000);
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  };

  // 把正文里的 @某人 高亮出来，让"我 @ 了谁"一眼可见
  //: 这个群**真有的**组件，`[{name, slug}]` ✓ —— 消息里的名字靠它标蓝可点 ✓。
  //:
  //: ⚠️ **只有存在的才标** ✗ —— 组件还在做的名字（"开始做「X」…"那条 ✓）点不了 ✓，
  //:    那是对的 ✓：点了会 404 ✓，比不标更糟 ✓。
  let compIndex = [];

  const refreshCompIndex = async () => {
    if (!group) return;
    try {
      const d = await api(`/components?group_id=${group.id}`);
      compIndex = (d.components || [])
        .map(c => ({ name: String(c.title || c.slug || ''), slug: c.slug }))
        .filter(c => c.name);
    } catch (e) { /* 拉不到就不标 ✓ —— 退化成"普通文字" ✓，不是故障 ✓ */ }
  };

  const _escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const renderContent = (el, text, isMine, noLink) => {
    el.textContent = '';
    if (!text) return;
    if (noLink) { el.textContent = text; return; }   // ★ 这一条**不标蓝**：见下面那段 ✓
    const names = [...new Set(
      members.filter(m => !m.is_agent).map(m => m.nickname).concat([agentName()])
    )].filter(Boolean);
    // ★ **两套"名字"要一起扫** ✗→✓（2026-10-07 深夜用户定的 ✓）：
    //   ① 群里的人 → 蓝色（@ 他）✓
    //   ② **这个群真有的组件** → 蓝色**可点直达** ✓
    //   ⚠️ 分开扫会互相吃掉 ✓（同一条消息里既有 @某人 又有组件名 ✓），
    //      所以拼成一个正则、一次走完 ✓。
    //   ⚠️ **长的排前面** ✗ —— 组件叫"记账"、另一个叫"记账面板"时，
    //      短的先把长的吃掉一半 ✓（"记账面板"会变成[记账][面板]✓）。
    const alts = [];
    names.forEach(n => alts.push({ s: '@' + n, kind: 'at', name: n }));
    // ★ **组件名可跳** ✓ —— 但调用方可以关掉（`noLink` ✓）：
    //   「开始做…」那条里的名字**现在还不是个东西** ✓（改已有的组件时才存在 ✓），
    //   标蓝点过去看到的是**老的**那一版 ✓ ✗ —— 用户定的：「做好后才标」✓。
    compIndex.forEach(c => alts.push({ s: c.name, kind: 'comp', slug: c.slug, name: c.name }));
    if (!alts.length) { el.textContent = text; return; }
    alts.sort((a, b) => b.s.length - a.s.length);
    const byStr = new Map(alts.map(a => [a.s, a]));
    const re = new RegExp(alts.map(a => _escRe(a.s)).join('|'), 'g');
    let last = 0, m;
    while ((m = re.exec(text)) !== null) {
      const hit = byStr.get(m[0]);
      if (!hit) continue;
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      const span = document.createElement('span');
      span.className = hit.kind === 'at' ? 'at' : 'clink';
      span.textContent = m[0];
      if (hit.kind === 'comp') {
        // ⚠️ **`stopPropagation`** ✓ —— 气泡上还挂着长按（引用）✓，
        //    不拦的话点一下会同时触发那一套 ✓。
        span.onclick = (ev) => { ev.stopPropagation(); openComp(hit.slug, hit.name); };
      }
      el.appendChild(span);
      last = m.index + m[0].length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  };

  // ── 管家的头像 ────────────────────────────────────────────────────
  //
  // `/ui/avatar.png` 是**它自己可以换的**（那个目录归它所有）。存在就用它、
  // 不存在就退回名字首字——所以它随时换随时生效，写坏了也只是回到首字。
  //
  // ⚠️ **别再往这上面挂时间戳** ✗ —— 见下面那段（2026-10-06 的教训 ✓）：
  //   防缓存的戳会把版本号带来的缓存**全部作废** ✓。
  // 一次开 App 只探测一次（多个气泡共用一个 Promise），不是每个气泡都去问。
  // ── 头像：**现在只有一个来源了** ✗→✓（2026-10-08 合并那次）─────────
  //
  // 原来头像住在**壳**那边（8730）✓，而这一页在 8741 ✓ → 所以这里要
  // 拼一个 `http://<同一台机器>:8730/avatars/2?v=…` 出来 ✓
  // （靠"cookie 按主机共享"跨端口取图 ✓，实测带票 200 / 不带票 401 ✓）。
  //
  // 合并之后**同源了** ✓ —— `shellURL` 退化成"原样返回" ✓。
  //   · 那些绝对地址（`http://…` 开头的 ✓，库里老数据里可能有 ✓）仍然原样放行 ✓
  //   · 相对路径原样返回 ✓ → 浏览器按**当前源**取 ✓ = 现在这个服务自己 ✓
  //     （它上面就有 `GET /avatars/{id}` ✓，见 `routes_shell.py` ✓）
  //
  // ⚠️ 函数名**不改** ✗ —— 它有十几处调用点 ✓，改名只有"看起来整齐"这一个好处 ✓，
  //    换来的是"漏改一处就有一处头像不显示" ✗。**留个名字，改个实现** ✓。
  const shellURL = (p) => {
    if (!p) return '';
    return p;                              // 同源了：原样 ✓
  };

  // 给一个头像盒子刷图 ✓。没有 / 取不到 → **退回昵称首字** ✓
  //（留个空框比首字难看得多 ✓）。
  const paintAvatar = (el, path, fallback) => {
    if (!el) return;
    const ch = String(fallback || '?').slice(0, 1);
    el.style.backgroundImage = '';
    el.textContent = ch;
    if (!path) { el.dataset.av = ''; return; }
    if (el.dataset.av === path) return;                     // 同一张，别重复探测 ✓
    el.dataset.av = path;
    const url = shellURL(path);
    const probe = new Image();
    probe.onload = () => {
      el.textContent = '';
      el.style.backgroundImage = "url('" + url + "')";
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
    };
    probe.onerror = () => { el.dataset.av = ''; };          // 取不到就保持首字 ✓
    probe.src = url;
  };

  // 管家的头像：**群自己那张优先** ✓（`group.agent_avatar` = `avatars/g7.png` ✓），
  // 没配才退回服务端那张全局的 `/ui/avatar.png` ✓。
  let agentAvatarUrl = null;      // null=还没探测；false=没有；字符串=可用
  let agentAvatarProbe = null;

  /** 换了头像之后调它 ✓ —— 否则整屏都还是旧的那张（缓存是故意的 ✓，见下）。 */
  const resetAgentAvatar = () => { agentAvatarUrl = null; agentAvatarProbe = null; };

  const applyAgentAvatar = (av) => {
    if (!av) return;
    const paint = () => {
      if (!agentAvatarUrl) return;           // 没有就保持名字首字
      av.textContent = '';
      av.style.backgroundImage = "url('" + agentAvatarUrl + "')";
      av.style.backgroundSize = 'cover';
      av.style.backgroundPosition = 'center';
    };
    if (agentAvatarUrl !== null) { paint(); return; }
    if (!agentAvatarProbe) {
      // 群自己那张 → 没有就全局那张 ✓。两个都试过才算"没有" ✓。
      const mine = (group && group.agent_avatar) ? ('/ui/' + group.agent_avatar) : '';
      const cands = (mine ? [mine] : []).concat(['/ui/avatar.png']);
      agentAvatarProbe = (async () => {
        for (const c of cands) {
          // ⚠️⚠️ **这里原来挂着一个 `?t=<当前毫秒>`** ✗✗ —— 2026-10-06 找到的：
          //   那是"防缓存"用的 ✓，但它**每次都造出一个全新的 URL** ✓
          //   → 浏览器认不出是同一条 ✓ → **每次都重新下载** ✗
          //   → 管家的头像**每次都闪** ✓（用户的头像不闪 ✗，因为它走的是另一条路 ✓）。
          //
          //   而这句是**我加缓存之前**写的 ✗ —— 那会儿头像不带宽版本号 ✓，
          //   只能靠时间戳绕过缓存 ✓；现在版本号已经写在 URL 里了 ✓
          //   （`/ui/avatars/g3.jpg?v=1791288428` ✓），
          //   时间戳就只剩坏处了 ✗。
          //   **"防缓存"和"能缓存"是相反的** ✓ —— 两个一起写，后者永远赢不了 ✓。
          const url = c;
          const ok = await new Promise(res => {
            const img = new Image();
            img.onload = () => res(true);
            img.onerror = () => res(false);
            img.src = url;
          });
          if (ok) { agentAvatarUrl = url; return; }
        }
        agentAvatarUrl = false;
      })();
    }
    agentAvatarProbe.then(paint);
  };

  // ── 引用 ──────────────────────────────────────────────────────────
  //
  // 引用是**输入状态**的一部分，不是消息的固有属性（微信也是这样）：
  // 长按气泡 → 引用 → 输入框上方冒出一条 → 发完就没了。
  let pendingQuote = null;
  /** id → 消息对象。长按拿到的是 DOM 行，要引用得回头找那条消息的完整信息。 */
  const _msgs = new Map();

  // ── ★ 备注（2026-10-08）：**"我私下怎么叫他"** ✓ ─────────────────────
  //
  //   用户定的一句话说清了它和昵称的区别：「备注后群聊里显示就会替换为备注内容，
  //   **对方不感知**」✓。所以：
  //     · 它**只走这个函数** ✓（显示层唯一出口 ✓）—— 一处改，处处生效 ✓；
  //       散着改（气泡里一处、@ 菜单里一处、放大头像里一处）迟早漏一个 ✓。
  //     · **绝不进 prompt** ✗（服务端根本不把它发给模型 ✓，见 `_group_persona` ✓）。
  //     · 也**不改** `m.sender_nickname` ✗（那是"他的真名" ✓，
  //       引用、@ 菜单、发出去的字都要用它 ✓）—— 只有**画出来**的时候换成备注 ✓。
  //
  //   ⚠️ 空 → 回落到真名 ✓（备注可以取消 ✓，见「他的详情」那一屏 ✓）。
  const dispName = (m) => {
    if (!m) return '';
    if (m.sender_type === 'agent') return agentName();
    const note = m.sender_id != null ? (notes && notes[String(m.sender_id)]) : '';
    return note || m.sender_nickname || '';
  };
  let notes = {};      // `{peer_id: 备注}` ✓ —— 开 App 那一趟带回来的（见 bootstrap ✓）

  const quoteWho = m => m.sender_type === 'agent' ? agentName() : (dispName(m) || '某人');
  const quoteText = m => {
    if (m.msg_type === 'image') return '[图片]';
    if (m.msg_type === 'voice') return '[语音] ' + (m.content || '');
    if (m.msg_type === 'audio') return '[音频] ' + (m.content || '');
    if (m.msg_type === 'file') {
      const meta = m.media_meta || {};
      return '[文件] ' + (meta.original_name || '') + (m.content ? ' ' + m.content : '');
    }
    return (m.content || '').slice(0, 60);
  };

  const setQuote = m => {
    pendingQuote = m;
    $('#qwho').textContent = quoteWho(m);
    $('#qtext').textContent = quoteText(m);
    $('#qbar').hidden = false;
    $('#text').focus();
  };
  const clearQuote = () => { pendingQuote = null; $('#qbar').hidden = true; };
  /** agent 用：按消息 id 挂引用。找不到就返回 false，别悄悄什么都不做。 */
  const quoteById = (id) => {
    const m = _msgs.get(Number(id));
    if (!m) return false;
    setQuote(m);
    return true;
  };
  $('#qclose').onclick = clearQuote;
  /** 发消息时统一取这个，不用在两处各写一遍 */
  const quoteField = () => (pendingQuote ? { reply_to: pendingQuote.id } : {});

  /** 气泡里那块引用条 */
  const buildQuoteEl = (q) => {
    const el = document.createElement('div');
    el.className = 'quote';
    const who = document.createElement('div'); who.className = 'qwho';
    who.textContent = quoteWho(q);
    const tx = document.createElement('div'); tx.className = 'qtext';
    tx.textContent = q.content || '';
    el.append(who, tx);
    el.onclick = (ev) => {
      ev.stopPropagation();
      const target = $('#msgs').querySelector(`[data-id="${q.id}"]`);
      if (!target) { toast('那条消息不在当前列表里'); return; }
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.add('flash');
      setTimeout(() => target.classList.remove('flash'), 1200);
    };
    return el;
  };

  /** 渲染一条。
   *
   * `prepend` = 这是"往回翻"取到的更早的消息，要插到**最前面**，
   * 而且**不能碰滚动位置**（否则你刚翻上去就被弹到底部 ✗）。
   */
  const addMsg = (m, prepend) => {
    if ($('#msgs').querySelector(`[data-id="${m.id}"]`)) return;
    if (!prepend) clearStream();
    // 系统提示：目前只有"被点名了却没能回复"这种故障通告。
    // 渲染成居中的灰字条，**和普通消息长得完全不一样**——就是怕它被当成
    // 管家说的一句话，那样故障会被无声地消费掉（和那次提醒事故一个道理：
    // 系统没做到却不吭声，用户只能自己发现）。
    if (m.sender_type === 'system') {
      const sys = document.createElement('div');
      sys.className = 'sysrow';
      sys.dataset.id = m.id;
      // ★ 系统消息也要走渲染 ✓ —— 因为**组件那两条就是系统消息** ✓
      //   （"开始做「X」…" / "X 做完了，快去看看吧。"✓），而里面的名字要标蓝可点 ✓
      //   （用户定的"提到存在的组件就标蓝"✓）。原来这里是 `textContent = 原文` ✗。
      const put = () => {
        sys.textContent = '';
        renderContent(sys, m.content || '', false,
                      !!(m.media_meta && m.media_meta.no_link));
        const t = document.createElement('span');
        t.textContent = ' · ' + fmtTime(m.created_at);
        sys.appendChild(t);
      };
      put();
      // ⚠️ **刷一次再重画** ✗→✓ —— 系统消息到达时，组件列表**正好变了** ✓：
      //    "做完了"那条到的时候，那个组件**刚刚落成** ✓ ——
      //    拿旧索引画的话，它自己的名字**不会变蓝** ✓（而那正是最该点的那一次 ✓）。
      refreshCompIndex().then(put);
      if (prepend) $('#msgs').prepend(sys);
      else { $('#msgs').appendChild(sys); scrollDown(); }
      return;
    }
    const mine = m.sender_id !== null && m.sender_id === me.id;
    const isAgent = m.sender_type === 'agent';
    const row = document.createElement('div');
    row.className = 'row' + (mine ? ' mine' : '') + (isAgent ? ' agent' : '');
    row.dataset.id = m.id;
    const av = document.createElement('div');
    av.className = 'av';
    // ★ 2026-10-06：**和「我的」用同一张图** ✓。
    //   原来这里直接把 `m.sender_avatar`（壳那边的**相对**路径 ✓）
    //   当 URL 用 ✗ → 在 8741 上必然 404 ✓ → 于是全群只有首字 ✗。
    if (isAgent) {
      av.textContent = '管';
      applyAgentAvatar(av);
      // 点管家头像 → 管家设置 ✓（2026-10-06 用户要的 ✓）
      av.onclick = (ev) => {
        ev.stopPropagation();
        if (pressFired) return;         // 长按引用那一下 ✓，不是点头像 ✓
        openAgentSettings();
      };
    } else {
      paintAvatar(av, m.sender_avatar, dispName(m) || '?');   // 没头像时用首字 ✓，也走备注 ✓
      // 点头像分三种去向 ✓（用户 2026-10-07 定的）：
      //   · 我自己的 → 回「我的」✓
      //   · 群里的别人 → **把他的头像放大看** ✓（点周围空白退 ✓）
      //   · 管家 → 管家设置 ✓（在上面那个分支里 ✓）
      // ⚠️ `stopPropagation` 是必须的 ✓：消息行上还挂着长按 ✓，
      //   不拦的话点一下会同时触发那一套 ✓。
      av.onclick = (ev) => {
        ev.stopPropagation();
        if (pressFired) return;         // 长按那一下不算点击 ✓
        if (mine) { openMe(); return; }
        // ★ 2026-10-08：别人 → **他的那一屏** ✓（用户定的："对于群里非自己和管家的头像，
        //   点击后，会出现该用户的界面，这个界面上面依旧是头像昵称，和[我的]以及[管家]
        //   一致，不同的是，下面可以设置备注"✓）。
        //   ⚠️ 原来这里是"把头像放大看" ✗ —— 那个 `openAvatarBig` 现在没人调了 ✓，
        //      留着是死代码 ✓（`check-shell-page.py` 只查"调用未定义"✓，
        //      查不出"定义了没人用"✗ —— 所以得自己删 ✓）。
        openPeer(m.sender_id);
      };
    }
    const w = document.createElement('div'); w.className = 'wrap2';
    const who = document.createElement('div'); who.className = 'who';
    who.textContent = dispName(m);        // ★ 备注在这里生效 ✓（显示层唯一出口 ✓）
    const b = document.createElement('div'); b.className = 'bubble';
    // ⚠️ **引用条不能在正文之前挂** ✗→✓（2026-10-07 深夜，用户报的：
    //    「虽然引用了吗，但是聊天界面看不出来」✓）。
    //
    //    原因只有一句：下面渲染正文的 `renderContent` **第一句就是
    //    `el.textContent = ''`** ✓ —— 先挂上去的引用条会被它**一起擦掉** ✗。
    //    数据一路都是对的（库里存着 ✓、接口返回着 ✓、`m.quote` 也有 ✓），
    //    最后被**自己的下一句**抹掉了 ✓ —— 这种错最难查 ✓：每一层单看都没问题 ✓。
    //    所以改成**正文画完再插到最前面** ✓（`insertBefore(…, firstChild)` ✓ =
    //    "引用条在气泡最上面" ✓，效果一样 ✓）。
    _msgs.set(m.id, m);          // 长按引用时要回头找这条消息的完整信息
    if (m.msg_type === 'image' && m.media_path) {
      b.classList.add('media');
      const img = document.createElement('img');
      img.src = '/media/' + m.media_path;
      img.loading = 'lazy';
      // 图片撑开高度会改变"底部"，所以在底部时跟着再滚一次（见 scrollDown 的说明）
      img.onload = () => scrollDown();
      img.onclick = () => openLightbox(img.src);
      b.appendChild(img);
    } else if (m.msg_type === 'file' && m.media_path) {
      b.classList.add('media');
      b.appendChild(fileCard(m));
    } else if (m.msg_type === 'audio' && m.media_path) {
      b.classList.add('media');
      b.appendChild(audioBar(m));
    } else if (m.msg_type === 'voice') {
      const v = document.createElement('div');
      v.className = 'vmsg';
      v.innerHTML = '<span class="bars">▮▮▮</span>';
      const dur = document.createElement('span');
      dur.className = 'dur';
      dur.textContent = ((m.media_meta && m.media_meta.duration) || 0) + "''";
      v.appendChild(dur);
      // 点一下重放。用 <audio> 而不是自绘播放器——够用，且不引额外代码。
      if (m.media_path) {
        v.onclick = () => { try { new Audio('/media/' + m.media_path).play(); } catch {} };
      }
      b.appendChild(v);
      if (m.content) {
        const sub = document.createElement('div');
        sub.className = 'vsub';
        sub.textContent = m.content;   // 转写文字，让语音也能被"读到"
        b.appendChild(sub);
      } else if (m.media_meta && m.media_meta.transcript_failed) {
        const sub = document.createElement('div');
        sub.className = 'vsub';
        sub.textContent = '（没听清）';
        b.appendChild(sub);
      }
    } else {
      renderContent(b, m.content || '[' + m.msg_type + ']', mine);
    }
    // ★ **正文画完了才挂引用条** ✓（见上面那段 ✓）—— 插到最前面 ✓。
    if (m.quote) b.insertBefore(buildQuoteEl(m.quote), b.firstChild);
    const t = document.createElement('div'); t.className = 'time'; t.textContent = fmtTime(m.created_at);
    w.append(who, b, t); row.append(av, w);
    if (prepend) $('#msgs').prepend(row);
    else { $('#msgs').appendChild(row); scrollDown(); }
    _fire('message', m, row);   // agent 的 ui/app.js 可以给这一条挂东西
  };

  // ── 往回翻历史 ─────────────────────────────────────────────────────
  //
  // 首屏只装**最近 50 条**。以前是 200 条、80KB ✗ —— 群里消息只会越来越多，
  // "每次进去全量拉"这件事迟早会拖垮开屏（用户原话：总不能全部加载吧）。
  //
  // 滚到接近顶部时再往回取一批 ✓ 并把**滚动位置补回去**——否则你刚从底部
  // 翻上来，下一秒就被弹回底部 ✗
  let oldestId = 0, loadingOlder = false, historyDone = false, tailReady = false;

  const loadOlder = async () => {
    if (loadingOlder || historyDone || !oldestId || !tailReady) return;
    loadingOlder = true;
    const box = $('#msgs');
    const beforeH = box.scrollHeight, beforeTop = box.scrollTop;
    try {
      const older = await api(`/groups/${group.id}/messages?before=${oldestId}&limit=50`);
      if (!older.length) { historyDone = true; return; }
      // **倒着 prepend**：每 prepend 一次都插在最前，所以要从新到旧反着来，
      // 最终顺序才是正的。
      for (let i = older.length - 1; i >= 0; i--) addMsg(older[i], true);
      oldestId = older[0].id;
      if (older.length < 50) historyDone = true;
      // 把"新增的高度"补进滚动位置 —— 视觉上停在你原来那条消息上，不跳
      box.scrollTop = beforeTop + (box.scrollHeight - beforeH);
    } catch (e) {
      console.warn('往回翻失败', e);   // 不烦用户：他还能再往上滚试一次
    } finally {
      loadingOlder = false;
    }
  };
  $('#msgs').addEventListener('scroll', () => {
    const b = $('#msgs');
    // 离底部 80px 以内就算"还在底部" → 之后新消息/图片撑开高度时继续跟着
    stickBottom = (b.scrollHeight - b.scrollTop - b.clientHeight) < 80;
    if (b.scrollTop < 60) loadOlder();      // 滚到顶 → 往回翻历史
  });

  // ── 长按消息 → 引用 ────────────────────────────────────────────────
  //
  // 挂**事件委托**在 #msgs 上，而不是每条消息各挂一个：气泡是动态加的，
  // 逐个挂就得在 addMsg 里挂、消息一多还要清理。
  let pressTimer = null;
  const PRESS_MS = 450;

  const cancelPress = () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  };

  // ── 长按：头像 → @ 他；气泡 → 小卡片（复制 / 引用）✗→✓（2026-10-08）──
  //
  // ★ 用户这次定的形状（原话）：「引用的触发回归长按消息，长按消息时会在消息旁边
  //   弹出一个小卡片，里面暂时有，自由复制和引用，自由复制就是小卡片收起，
  //   调用系统复制功能，点击引用就是正常引用，小卡片不是在底部，而是在消息旁边，
  //   类似微信」✓。
  //
  // ⚠️ **这是一次行为回退，得说清楚** ✗：2026-10-07 那次是**故意**把气泡上的长按
  //    让给浏览器的 ✓（长按选中文字 → 系统那套自由复制 ✓）。现在收回来自己处理 ✓
  //    —— 换来的是"复制整条 + 引用"两个明确动作 ✓（卡片第一项仍然叫"自由复制"✓，
  //    只是从"选几个字"变成"复制整条"✓）。用户要的就是这个 ✓。
  //    代价：气泡里**选不中单个字**了 ✓ —— 所以 CSS 里把长按呼出和选择都关了 ✓
  //    （`-webkit-touch-callout:none` / `user-select:none` ✓，见气泡那条 ✓）。
  const onPressStart = (e) => {
    if (!e.target.closest) return;
    const row = e.target.closest('#msgs .row[data-id]');
    if (!row) return;
    cancelPress();
    pressFired = false;
    const onAvatar = !!e.target.closest('.av');
    pressTimer = setTimeout(() => {
      pressTimer = null;
      pressFired = true;
      if (onAvatar) atFromRow(row);       // 头像 → @ 他 ✓（这一条没变 ✓）
      // ★ **这一条刚点过"自由复制"** → 它的长按**归系统** ✓（2026-10-09）——
      //   系统那排（复制/全选/搜索…）就是他此刻要的东西 ✓，
      //   我们再弹一张卡片只会挡着它 ✓（而且他也没法"再复制一次" ✓）。
      else if (row.querySelector('.bubble.seltext')) { /* 让给系统 ✓ */ }
      else openMsgCard(row);              // 气泡 → 小卡片 ✓
    }, PRESS_MS);
  };

  /** 长按头像 → 把这个人 @ 进输入框 ✓。 */
  const atFromRow = (row) => {
    const m = _msgs.get(Number(row.dataset.id));
    if (!m) return;
    const nm = m.sender_type === 'agent' ? agentName() : (m.sender_nickname || '');
    if (!nm) return;
    closeAtMenu();
    insertMention(nm);
    toast('已 @ ' + nm);
  };

  // ── ⚠️ **左右滑引用整个撤了** ✗→✓（2026-10-08）────────────────────────
  //
  //   它在这儿待过两天（判据、阻尼、"↩ 引用"那个提示条 ✓，都挺好看 ✓），
  //   但它**和用户要的东西冲突** ✗：
  //     · 引用改成长按了 ✓ → 这个手势就没人用了 ✓
  //     · 更关键的是**横滑要腾出来** ✓ ——「组件界面」是**左滑进、右滑出** ✓（P7 ✓），
  //       而消息级的横滑会跟它抢同一个方向 ✓（同一个手指、同一个屏幕 ✓）。
  //   ⚠️ 所以这一条**不能单独上线** ✗：撤掉它就必须同时把长按卡片接上 ✓
  //      （不然"引用"这个功能会消失 ✓）—— 这就是这两件事绑在一次的原因 ✓。
  //
  //   （`.swhint` / `.swiping` 那几条 CSS 也一起删了 ✓ —— 留着是死代码 ✓。）

  // ── 消息旁边的小卡片（微信那种 ✓）────────────────────────────────────
  //
  // 定位：贴着气泡 ✓，优先放**上面** ✓，上面放不下翻到下面 ✓，
  //       水平跟着气泡中线走、再夹进视口 ✓。
  // 收起：点别处 ✓、滚动 ✓、安卓返回键 ✓（`__goBack` ✓）。
  //
  // ⚠️ 它**不是从底部弹的** ✗ —— 用户点名了这一点 ✓（底部弹的是 `+` 那个 sheet ✓，
  //    两件事没关系 ✓）。
  let msgCardM = null;          // 卡片正对着哪条消息 ✓（复制/引用要用 ✓）
  let msgCardOpenedAt = 0;      // 刚弹出来的那一瞬间，别被"紧接着那次 click"关掉 ✓

  const closeMsgCard = () => {
    const c = $('#msgcard');
    if (!c || !c.classList.contains('on')) return;
    c.classList.remove('on');
    msgCardM = null;
  };

  // ⚠️ **收起的三条路**（用户没点名 ✓，但不开就是"卡片关不掉"✗）：
  //    点别处 ✓、滚动 ✓、返回键（`__goBack` ✓）。
  //
  //    ⚠️ 用"刚弹出来 350ms 内不关"来挡长按那一下**自带的 click** ✗→✓ ——
  //       长按触发之后浏览器仍会补一次 click ✓（和头像那个 `pressFired` 是同一个现象 ✓）。
  //       用时间窗比用标志位稳 ✓：不依赖两个事件的先后 ✓。
  document.addEventListener('click', (ev) => {
    // ★ **点别处（或者点那一段文字自己）→ 自由复制那个状态就结束** ✗→✓
    //   （2026-10-09 用户定的：「**复制完或者点击空白后，自由复制状态就改结束了**」✓）
    //   ⚠️ 放在这一支里是因为**它的判据正好是"点在别处"** ✓（点卡片里不算 ✓）。
    //      它比下面那个"关卡片"的判断**更宽** ✓ —— 卡片早就关了的时候，
    //      这个状态还挂着 ✓，正是上一版"再也弹不出小卡片"的成因 ✓。
    // ⚠️ **那个复制文本框里的一下也不算"点别处"** ✗→✓ —— 他要在里面
    //    **按住、拖两头的光标** ✓；那几下都会冒泡成 click ✓ →
    //    不豁免的话，**一碰就把它自己收掉了** ✗（那这功能就没法用了 ✓）。
    if (ev.target.closest && (ev.target.closest('#msgcard') ||
                              ev.target.closest('#copyfield'))) return;
    endFreeCopy();
    const c = $('#msgcard');
    if (!c || !c.classList.contains('on')) return;
    if (Date.now() - msgCardOpenedAt < 350) return;
    closeMsgCard();
  }, true);
  $('#msgs').addEventListener('scroll', () => { closeMsgCard(); endFreeCopy(); }, { passive: true });
  // ★ **他点了系统那排的"复制"** → 这一趟就完事了 ✓（收尾 ✓）。
  //   ⚠️ 这是"复制完了"唯一的可观测信号 ✓ —— 系统那排工具是**它自己**的 ✓，
  //      我们既叫不出来也收不回去 ✓，只能等这个 `copy` 事件 ✓
  //      （点"全选""搜索"那几个不会有 ✓，那种情况归"点别处/滚动"那两条 ✓）。
  document.addEventListener('copy', () => { endFreeCopy(); });

  const openMsgCard = (row, opts) => {
    const m = opts && opts.get ? opts.get(row) : _msgs.get(Number(row.dataset.id));
    if (!m) return;
    msgCardOpenedAt = Date.now();
    // ⚠️ **把上一条"交给系统选择"的状态收回来** ✗→✓（2026-10-09）——
    //    那一条现在长按归系统 ✓（见 `freeCopyBubble` 和 `onPressStart` 里那一支 ✓）；
    //    不收的话，他复制完 A、又长按 B 弹出卡片 ✓，而 A 从此**永远弹不出卡片** ✗
    //    （只剩"系统选择"一种行为 ✓ —— 那种"某条消息跟别的不一样"最难解释 ✓）。
    $$('#msgs .bubble.seltext').forEach(x => x.classList.remove('seltext'));
    const card = $('#msgcard'), box = card.querySelector('.box');
    msgCardM = m;
    box.textContent = '';
    const mk = (label, fn) => {
      const b = mkel('button', 'mi', label);
      b.onclick = () => { closeMsgCard(); fn(); };
      return b;
    };
    // ⚠️ 允许调用方**自己给两项** ✓ —— 组件格子那个卡片用的是同一套壳 ✓
    //    （同一个组件、同一套定位 ✓），它要的两项是「和它对话」而不是复制/引用 ✓。
    //    不给 `items` 就是默认那两项 ✓（消息那边 ✓）。
    if (opts && opts.items) {
      opts.items.forEach(([label, fn]) => box.appendChild(mk(label, fn)));
      msgCardPlace(row, card, box, opts);
      return;
    }
    box.appendChild(mk('自由复制', () => freeCopyBubble(row)));
    box.appendChild(mk('引用', () => {
      if (opts && opts.quote) opts.quote(m); else setQuote(m);
    }));

    msgCardPlace(row, card, box, opts);
  };

  /**
   * ★ **「自由复制」= 在气泡上盖一个真的文本框** ✗→✓（2026-10-09 第三次改这条 ✓）。
   *
   *   他截图上看到的：点完之后**只有一层高亮** ✓ —— 两头没有可以拖的光标 ✗、
   *   系统那排工具也没出来 ✗，原话「**现在啥也不是**」✓。
   *
   *   ⚠️ **为什么高亮有、手柄没有** ✗（这次是实测出来的，不是猜 ✓）：
   *      `user-select:text` + 程序化 `Selection` 只让浏览器**把字画成选中** ✓；
   *      而"两头那两个可以拖的光标 + 复制/全选那排"是**安卓给"正在编辑的
   *      文本框"画的东西** ✓ —— 它只跟着**表单控件**走 ✗，对普通元素的选中
   *      **一个手柄都不给** ✓（上一版就是这么凉的 ✓）。
   *
   *   → 所以做法换成：**在气泡上面盖一个真的 `<textarea>`** ✓，
   *     里面的字和气泡里一模一样 ✓（同一套字体/行高/内边距/颜色 ✓，透明底 ✓），
   *     `focus()` 之后整段选中 ✓ → 安卓就把它当"一个正在编辑的输入框" ✓ →
   *     **两头的手柄 + 系统那排自己就出来了** ✓✓（这次是它**该**出现的场合 ✓）。
   *
   *   ⚠️ `inputmode="none"` 是**必须的** ✗ —— 不写的话，focus 一个可编辑文本框
   *      会把**软键盘顶上来** ✓（屏幕直接废一半 ✓）。它只说"别弹键盘" ✓，
   *      不影响选中和手柄 ✓。
   *   ⚠️ 盖的位置 = **气泡那一段的矩形** ✓；点别处 / 滚动 / 复制完 / 按返回
   *      都要收掉 ✓（同一个 `endFreeCopy` ✓）—— 它是 `position:fixed` 的 ✓，
   *      不收就会**跟着屏幕不动** ✗：列表一滚，它就"浮"在别处 ✓。
   */
  const freeCopyBubble = (row) => {
    const bub = row.querySelector('.bubble') || row;
    // 文字**不含引用条** ✓ —— 引用条是"上一句是什么"的提示 ✓，
    // 不是这条消息的内容 ✓（连它一起复制出来，粘到别处就是一堆莫名其妙的字 ✓）。
    const text = [...bub.childNodes]
      .filter(n => !(n.nodeType === 1 && n.classList && n.classList.contains('quote')))
      .map(n => n.textContent).join('').trim();
    if (!text) return;                       // 空的（纯图片那种）→ 别开 ✓
    endFreeCopy();
    // ★★ **颜色必须在「藏字」之前量** ✗→✓（2026-10-09 用户报的：
    //   「为啥字体是黑色，**光标不选中时，其他文字直接看不见了**」✓）
    //   ⚠️ 因为「藏字」那一招就是**把这一条的字变成透明** ✓
    //     （`color:transparent !important` ✓，见 CSS 那段 ✓）——
    //     而我把这一步放在了**量颜色之前** ✗ → `getComputedStyle` 量到的
    //     是 `rgba(0,0,0,0)` ✓✓ → 原样抄给文本框 ✓ → **文本框里的字是透明的** ✗ →
    //     屏幕上只剩「被选中那一段」（选区自己有底色 ✓）看得见 ✓
    //     —— 他描述得一字不差 ✓。**先量、后改** ✓，这条对任何「量了再动手」都成立 ✓。
    const r = bub.getBoundingClientRect();
    const cs = getComputedStyle(bub);
    const ta = document.createElement('textarea');
    ta.id = 'copyfield';
    ta.value = text;
    ta.readOnly = false;                     // ⚠️ **不能设 readonly** ✗ —— 只读的
                                             //    文本框在有些 WebView 上**不给手柄** ✓
                                             //    （那正是我们要的东西 ✓）；键盘靠
                                             //    `inputmode=none` 挡 ✓，不靠只读 ✓。
    ta.setAttribute('inputmode', 'none');
    ta.setAttribute('spellcheck', 'false');
    ta.setAttribute('autocapitalize', 'off');
    ta.setAttribute('autocomplete', 'off');
    ta.style.left = Math.round(r.left) + 'px';
    ta.style.top = Math.round(r.top) + 'px';
    ta.style.width = Math.round(r.width) + 'px';
    ta.style.height = Math.round(r.height) + 'px';
    // 把气泡那身字**原样搬过来** ✓ —— 差一点都会看出来（多出一个白框就完了 ✓）
    ta.style.font = cs.font;
    ta.style.lineHeight = cs.lineHeight;
    ta.style.padding = cs.padding;
    ta.style.borderRadius = cs.borderRadius;
    ta.style.color = cs.color;
    // ⚠️ **`-webkit-text-fill-color` 才是 WebKit 里真正决定字色那个** ✗→✓ ——
    //    只写 `color` 的话可能被别处的 fill 盖住 ✓（本页里就有一条 ✓，见 CSS ✓）。
    ta.style.webkitTextFillColor = cs.color;
    ta.style.textAlign = cs.textAlign;
    // ★★ **`getComputedStyle` 返回的东西是「活的」** ✗→✓（2026-10-09，第二次栽在这条上）——
    //   上面那句 `const cs = getComputedStyle(bub)` 只是**拿了个句柄** ✓，
    //   真正读 `.color` 是在**下面这几行** ✗ —— 而那会儿我**已经把 `.seltext`
    //   加上了** ✓（那一加就把字变透明 ✓，见 CSS ✓）→ 读出来的还是**透明** ✗✓
    //   （所以我"把测量挪到前面"那一版**一点用没有** ✓：挪的是**取句柄**那一步 ✗）。
    //   → 现在把 `classList.add('seltext')` 挪到**所有样式都抄完之后** ✓：
    //     它只影响气泡自己的观感 ✓（虚线边 / 藏字 ✓），不影响版面 ✓
    //     （`outline` 不占位置 ✓），所以晚一点加完全等价 ✓。
    document.body.appendChild(ta);
    bub.classList.add('seltext');            // 一圈虚线边 = 它现在在可复制状态 ✓
    // ⚠️ 焦点+全选：**这是"叫出手柄"的全部** ✓（顺序不能反 ✓）。
    // ⚠️⚠️ **一次不够** ✗→✓（2026-10-09 用户实测："也没出现光标啊，必须手点一下才可以"✓）——
    //    刚 append 的元素**还没排过版** ✓，有些 WebView 这一下不吃焦点 ✗
    //    → 光标不出来 ✓、手柄当然也不出来 ✓，得他自己点一下才成 ✓。
    //    所以：**先强制一次排版** ✓，再聚焦一次 ✓；
    //    然后**隔一帧再补一次** ✓（那一帧之后元素是真的在屏幕上了 ✓）。
    const grab = () => {
      try {
        ta.focus({ preventScroll: true });
        ta.setSelectionRange(0, ta.value.length);
      } catch (e) { /* 叫不出来也还留着可长按的状态 ✓ —— 他按住那段字照样能出 ✓ */ }
    };
    void ta.offsetHeight;                 // ★ 强制排版（就这一行治"光标不出来"✓）
    grab();
    setTimeout(grab, 60);                 // ★ 再补一枪 ✓
    // 焦点一走（点别处）→ 收掉 ✓
    ta.onblur = () => setTimeout(() => { if (document.activeElement !== ta) endFreeCopy(); }, 0);
  };

  /**
   * **结束"自由复制"那个状态** ✓ —— 用户原话：
   *   「复制完或者**点击空白后，自由复制状态就改结束了**」✓。
   *
   *   ⚠️ 上一版**漏了这一半** ✗：状态挂上就再也没摘过 ✓ →
   *      那条消息**从此长按只出系统那排、再也不出我们的小卡片** ✗。
   *   ⚠️ 所以三件事一起做 ✓：收掉那个文本框 ✓、摘掉虚线边 ✓、
   *      清掉浏览器那层高亮 ✓（只收文本框不清选择的话，屏幕上还留着一片蓝 ✗）。
   */
  const endFreeCopy = () => {
    const f = $('#copyfield');
    if (f) f.remove();
    let any = false;
    $$('#msgs .bubble.seltext, .mkrow .mkbub.seltext').forEach(el => {
      el.classList.remove('seltext');
      any = true;
    });
    if (any) {
      try { window.getSelection().removeAllRanges(); } catch (e) { /* 没有就算了 ✓ */ }
    }
  };

  /** 把小卡片摆到**锚点旁边** ✓（默认锚点是气泡 ✓，可以指定别的 ✓）。 */
  const msgCardPlace = (row, card, box, opts) => {
    card.classList.add('on');
    const sel = (opts && opts.anchorSel) || '.bubble';
    const anchor = row.querySelector(sel) || row;
    const r = anchor.getBoundingClientRect();
    const cw = box.offsetWidth, ch = box.offsetHeight;
    let left = r.left + r.width / 2 - cw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - cw - 8));
    let top = r.top - ch - 10;
    if (top < 8) top = Math.min(r.bottom + 10, window.innerHeight - ch - 8);
    box.style.left = Math.round(left) + 'px';
    box.style.top = Math.round(top) + 'px';
  };

  window.__closeMsgCard = closeMsgCard;

  $('#msgs').addEventListener('touchstart', onPressStart, { passive: true });
  // 手指一动就是在滚动，不是长按——**必须取消** ✓，否则滑列表会到处误弹 ✓
  $('#msgs').addEventListener('touchmove', cancelPress, { passive: true });
  $('#msgs').addEventListener('touchend', cancelPress);
  $('#msgs').addEventListener('touchcancel', cancelPress);
  // 桌面浏览器调试用
  $('#msgs').addEventListener('mousedown', onPressStart);
  $('#msgs').addEventListener('mouseup', cancelPress);
  $('#msgs').addEventListener('mouseleave', cancelPress);

  // ── ★ 文件 / 音频那两种气泡（2026-10-08）─────────────────────────────
  //
  // 用户定的："两处的＋都新增**文件**（常规txt，pdf，word，excel，json等）与**音频**；
  // 暂不支持视频"✓。
  //
  // ⚠️ **两处共用这一个函数** ✗→✓ —— 群聊和组件对话各画一份的话，
  //    迟早只改一处 ✓（这个项目为"同一件事两处实现"栽过好几次 ✓）。
  const MEDIA_ICON = { '.pdf': '📕', '.doc': '📄', '.docx': '📄', '.xls': '📊',
                       '.xlsx': '📊', '.csv': '📊', '.json': '🧾', '.txt': '📃',
                       '.md': '📝' };

  /** 文件卡片 ✓ —— 点一下打开/下载 ✓。 */
  const fileCard = (m) => {
    const meta = m.media_meta || {};
    const name = meta.original_name || (m.media_path || '文件').split('/').pop();
    const ext = ('.' + String(name).split('.').pop()).toLowerCase();
    const size = Number(meta.size || 0);
    const box = mkel('div', 'filecard');
    box.append(mkel('span', 'fi', MEDIA_ICON[ext] || '📎'));
    const col = mkel('span', 'fc');
    col.append(mkel('span', 'fn', name));
    col.append(mkel('span', 'fs', size ? (size / 1024).toFixed(0) + ' KB' : ''));
    box.appendChild(col);
    // ⚠️ 链接要**带上地址** ✓（点它是"打开/下载"✓）—— 同源 ✓，浏览器自己带 cookie ✓
    const a = document.createElement('a');
    a.href = '/media/' + m.media_path;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = '打开';
    a.className = 'fo';
    box.appendChild(a);
    return box;
  };

  /** 音频条 ✓（上传的音频文件 ✓ —— 按住说的那个是另一种样子 ✓）。 */
  const audioBar = (m) => {
    const box = mkel('div', 'audiobar');
    const au = document.createElement('audio');
    au.controls = true;
    au.preload = 'none';
    au.src = '/media/' + m.media_path;
    box.appendChild(au);
    if (m.content) box.appendChild(mkel('div', 'vsub', m.content));
    return box;
  };

  const clearStream = () => { if (streamEl) { streamEl.closest('.row').remove(); streamEl = null; } streamBuf = ''; };
  const appendStream = d => {
    streamBuf += d || '';
    if (!streamBuf.trim()) return;
    if (!streamEl) {
      const row = document.createElement('div');
      row.className = 'row agent';
      row.innerHTML = '<div class="av">管</div><div class="wrap2"><div class="who"></div><div class="bubble"></div></div>';
      // 这一行原来**硬编码了「管」** ✗ —— 别的气泡都走 applyAgentAvatar ✓，
      // 只有它没有 ✓ → 管家一开口，头像会从图**跳回**一个「管」字 ✗。
      const sav = row.querySelector('.av');
      applyAgentAvatar(sav);
      sav.onclick = (ev) => {
        ev.stopPropagation();
        if (pressFired) return;
        openAgentSettings();
      };
      row.querySelector('.who').textContent = agentName();
      $('#msgs').appendChild(row);
      streamEl = row.querySelector('.bubble');
    }
    streamEl.textContent = streamBuf; scrollDown();
  };

  // ── WebSocket ──
  const connectWS = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    // 令牌不再进 URL：同源握手会自动带上 Cookie。
    // （早先放 URL 里还有第二个坏处——`?token=` 会进访问日志。）
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onmessage = ev => {
      if (ev.data === 'pong') return;
      let pkt; try { pkt = JSON.parse(ev.data); } catch { return; }
      const d = pkt.data || {};
      // 连上/重连后：把真实状态捞回来，并补拉断线期间漏掉的消息。
      // 退出重进、锁屏、网络抖动都会丢事件——不补的话顶栏会显示"窥屏"，
      // 而服务器那边可能还在思考。
      if (pkt.type === 'ready') {
        const st = (d.agent_status || {})[String(group && group.id)];
        if (st) setStatusTimed(st);        // 重连补状态：文字自己从配置挑 ✓
        syncMissed();
        return;
      }
      if (pkt.type === 'message') { if (d.group_id === group.id) addMsg(d); }
      // ★ `d.text` 要带上 ✗→✓ —— 服务端**已经挑好了**那一句 ✓
      //   （思考中/不打算说话是随机挑的 ✓）。丢了它就等于白挑 ✓。
      else if (pkt.type === 'agent_status') { if (d.group_id === group.id) setStatusTimed(d.state, d.text); }
      else if (pkt.type === 'agent_stream') {
        if (d.group_id !== group.id) return;
        if (d.done) { clearStream(); setStatus('idle'); } else appendStream(d.delta);
      }
      // ★ 工坊那三个（2026-10-07）—— **只在对话屏开着、而且是对的那条对话时**才理 ✓。
      //   群聊页对这几个类型是**直接忽略**的 ✓（未知类型落空 ✓）——
      //   所以工坊里说的话，群聊那边一个字都不会冒出来 ✓。
      //
      // ⚠️ **判据是 task_id，不是 slug** ✗→✓（2026-10-07）——
      //   对话的钥匙换成了任务 ✓（见 routes_workshop.py 那段 ✓）。
      //   而且**必须逐个对任务号** ✓：切换之后，被掐掉的那一轮还会推几条收尾消息 ✓
      //   （它的 `finally` 里那条 `idle` ✓）—— 不对任务号的话，
      //   那些会**落在刚打开的那条对话上** ✓（用户看到"它明明没在跑，却说在跑" ✗）。
      else if (pkt.type === 'ws_message') {
        if (!$('#wsChat').classList.contains('on')) return;
        if (d.group_id !== group.id) return;
        if (Number(d.task_id) !== Number(wsCur.task)) return;
        if (d.sender_type === 'agent') {
          // ⚠️ **先把流式那条摘掉** ✗→✓ —— 2026-10-07 用户报的「回复两句重复的，
          //    刷新过后只会留一句」✓：流式过程中已经画了一条气泡 ✓，
          //    落库之后 `ws_message` 又画一条 ✓ → 两条一模一样的 ✓；
          //    刷新时只从库里读 ✓ → 只剩一条 ✓。**这就是那个症状的全部原因** ✓。
          if (wsCur.streaming) {
            const r = wsCur.streaming.closest('.mkrow');
            if (r) r.remove();
            wsCur.streaming = null;
          }
          setWsStatus('idle');
        }
        addWsMsg(d);
      }
      else if (pkt.type === 'ws_stream') {
        if (!$('#wsChat').classList.contains('on')) return;
        if (d.group_id !== group.id) return;
        if (Number(d.task_id) !== Number(wsCur.task)) return;
        // ⚠️ **第一片是空的就先别开气泡** ✗→✓（2026-10-07 深夜，用户报的：
        //    「思考的时候先返回了一个空消息占位」✓）。
        //    服务端那边也堵了（空片段不推 ✓），这里再堵一道 ✓ ——
        //    因为"第一片"完全可能只是**一个换行** ✓（`''.trim()` 拦住它 ✓），
        //    那种照样会开出一个看着像坏了的空气泡 ✓。
        const piece = d.delta || '';
        if (!wsCur.streaming) {
          if (!piece.trim()) return;          // 还全是空白 ✓ → 等有字再开 ✓
          wsCur.streaming = addWsMsg({ sender_type: 'agent', content: '' });
        }
        wsCur.streaming.textContent += piece;
        const box = $('#wsMsgs'); box.scrollTop = box.scrollHeight;
      }
      else if (pkt.type === 'ws_status') {
        if (!$('#wsChat').classList.contains('on')) return;
        if (d.group_id !== group.id) return;
        // ⚠️ `task_id` 是 null 的是**广播**（迁移前的老路径 ✓，见服务端那段 ✓）——
        //    那种情况没法认人 ✓，照收 ✓（宁可多显示一行状态，也不要漏掉"它开始做了" ✓）。
        if (d.task_id != null && Number(d.task_id) !== Number(wsCur.task)) return;
        setWsStatus(d.state);
      }
      else if (pkt.type === 'group_update') { if (d.group_id === group.id) refreshGroup(); }
      else if (pkt.type === 'unauthorized') logout();
    };
    ws.onclose = () => setTimeout(connectWS, 1500);
  };

  /** 补拉断线期间漏掉的消息。WebSocket 只保证在线投递，断了就是断了。 */
  const syncMissed = async () => {
    if (!group) return;
    try {
      const last = Math.max(0, ...$$('#msgs [data-id]').map(e => Number(e.dataset.id) || 0));
      const msgs = await api(`/groups/${group.id}/messages?after=${last}&limit=200`);
      // 同样要包一层：不包的话 forEach 会把下标传进来当 `prepend` ✗（见首屏那段的说明）
      msgs.forEach(m => addMsg(m));
    } catch {}
  };

  const refreshGroup = async () => {
    try {
      const gs = await api('/groups');
      if (gs.length) {
        // ⚠️ **不能取 `gs[0]`** ✗→✓ —— 2026-10-06 用户实测：
        //   「在空间『测试』里把名字改了，它**自己变成了『测试2』**」✓。
        //
        //   真因：`/groups` 是 `ORDER BY id DESC` ✓（新的排前面 ✓），
        //   而这个人**同时在两个空间里** ✓ → `gs[0]` 拿到的是**另一个空间** ✗
        //   → 于是页面上显示的名字、以及接下来要改的那个，全是别人的 ✗。
        //
        //   为什么平时看不出来：进 App 走的是 `/bootstrap` ✓，
        //   那条路按"**你从哪个空间进来的**"排 ✓（见 routes_groups.bootstrap ✓）
        //   ——**只有保存后这一次刷新**会串 ✓。
        //   两处口径不一致，是这个 bug 最难查的地方 ✓。
        //
        //   改法：**认住自己那个 id** ✓。列表怎么排都不影响 ✓。
        group = gs.find(g => g.id === group.id) || gs[0];
        members = await api(`/groups/${group.id}/members`);
        // ★ 群一刷新就**重算状态配置** ✓ —— 唯一的入口 ✓。
        //   少这一句的后果：在「管家」里存完，状态条要等下次进 App 才变 ✗。
        if (typeof normalizeStatus === 'function') normalizeStatus();
        renderHeader(); renderSettings();
        // ⚠️ 正在写「性格」的时候**不要重画** ✗ —— renderAgent 会把 textarea
        //    整个重建 ✓ → 刚打的字全没了 ✓（而且用户会觉得"打字打一半跳了一下" ✓）。
        if ($('#agent').classList.contains('on') && !promptEditing) renderAgent();
      }
    } catch {}
  };

  // ── @ 自动补全 ──
  //
  // 设计改过一轮：早期是"点按钮 → 弹列表 → 选人 → 完成"，太重了。
  // 现在就是**打字时打 @ 直接出候选项，选中即插入**——和微信一致。
  // 想 @ 多个人就再打一次 @。发送时从正文里解析出 @ 了谁。
  let atQueryStart = -1;

  const closeAtMenu = () => { $('#atMenu').classList.remove('on'); atQueryStart = -1; };

  const openAtMenu = (query) => {
    const q = query.toLowerCase();
    const cands = members.filter(m => !q || m.nickname.toLowerCase().includes(q));
    const menu = $('#atMenu');
    menu.innerHTML = '';
    if (!cands.length) { closeAtMenu(); return; }
    cands.forEach(m => {
      const el = document.createElement('div');
      el.className = 'pick';
      el.innerHTML = `<div class="av"></div><div class="nm"></div>`;
      // ★ 管家的头像也要用**它自己那张** ✗→✓ —— 2026-10-07 用户截图指出的：
      //   "列表里显示的管家的昵称对了，头像没更新" ✓。
      //   原来这里对管家写死了一个「管」字 ✗（和气泡里那个老毛病同一个 ✓），
      //   而它自己的头像走的是 `group.agent_avatar` ✓ ——
      //   所以这里必须调 `applyAgentAvatar` ✓，不是 paintAvatar ✗
      //   （`paintAvatar` 画的是**用户**头像那套地址 ✓）。
      //   顺带：members 接口里管家那一行的 avatar 是 null ✗（它不属于用户表 ✓），
      //   所以确实只能从群那边取 ✓。
      if (m.is_agent) { el.querySelector('.av').textContent = '管'; applyAgentAvatar(el.querySelector('.av')); }
      else paintAvatar(el.querySelector('.av'), m.avatar, m.nickname || '?');
      el.querySelector('.nm').textContent = m.nickname;
      // ⚠️ 这里原来还有一句 `'@它 → 必回'` ✗ —— 2026-10-07 用户要去掉 ✓。
      //   那句话是**我们替它许的诺** ✓（"必回" ✓）：它其实可以决定不接话 ✓，
      //   而屏幕上写着"必回"就变成了对用户的承诺 ✓ ——
      //   真不接的时候，用户会觉得是坏了 ✓。**不写比写错好** ✓。
      //   （`hint` 那一格留着不填 ✓ —— 别人那几行本来就是空的 ✓，
      //     CSS 里 `.hint` 的样式也还归别的弹层用 ✓。）
      el.onmousedown = e => { e.preventDefault(); insertMention(m.nickname); };
      el.ontouchstart = e => { e.preventDefault(); insertMention(m.nickname); };
      menu.appendChild(el);
    });
    menu.classList.add('on');
  };

  const insertMention = (nickname) => {
    const ta = $('#text');
    const before = ta.value.slice(0, atQueryStart);
    const after = ta.value.slice(ta.selectionStart);
    ta.value = before + '@' + nickname + ' ' + after;
    const pos = before.length + nickname.length + 2;
    ta.setSelectionRange(pos, pos);
    ta.focus();
    closeAtMenu();
    autoGrow(); syncSendBtn(ta.value);
  };

  /** agent 用：往输入框光标处插一段文字（比如 `@刘猪猪 `），并聚焦。
   *  和上面的 insertMention 分开：那个依赖 `atQueryStart`（@ 菜单打开时才有的状态），
   *  外部直接调会切错位置。 */
  const insertText = (text) => {
    const ta = $('#text');
    const s = ta.selectionStart ?? ta.value.length;
    const e = ta.selectionEnd ?? s;
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    const pos = s + text.length;
    ta.setSelectionRange(pos, pos);
    ta.focus(); autoGrow(); syncSendBtn(ta.value);
  };

  /** 发送时从正文解析 @ 了谁——比单独维护一份名单更不容易错位。 */
  const parseMentions = (text) => {
    const out = new Set();
    for (const m of members) {
      const key = m.is_agent ? 'agent' : String(m.id);
      if (text.includes('@' + m.nickname)) out.add(key);
    }
    return [...out];
  };

  $('#text').addEventListener('input', () => {
    const ta = $('#text');
    const caret = ta.selectionStart;
    const upto = ta.value.slice(0, caret);
    const at = upto.lastIndexOf('@');
    // @ 之后不能有空格，否则说明这个 @ 已经写完了
    if (at >= 0 && !/[\s]/.test(upto.slice(at + 1))) {
      atQueryStart = at;
      openAtMenu(upto.slice(at + 1));
    } else {
      closeAtMenu();
    }
    autoGrow();
    syncSendBtn(ta.value);
  });

  /**
   * 有内容 → 显示发送、藏起 +（照微信）。
   * 这个状态挂在 body 上而不是按钮自己身上，是因为要同时控制两个元素
   * （#send 和 #pickMedia）的显隐，挂在共同祖先最省事。
   */
  const syncSendBtn = (value) => {
    document.body.classList.toggle('hasText', !!String(value || '').trim());
  };

  const send = async () => {
    const ta = $('#text');
    const t = ta.value.trim();
    const items = pending.slice();          // 快照 ✓：发的过程里队列会变 ✓
    if (!t && !items.length) return;
    closeAtMenu();
    ta.value = ''; ta.style.height = 'auto';
    syncSendBtn('');
    pending.length = 0; syncPending();      // 先清空 ✓；发失败再放回去 ✓
    try {
      // ★ **附件在前、文字在后** ✓ —— 就是"先选的先发" ✓（也符合直觉：
      //   配文通常是在图之后补上的 ✓）。
      let first = true;
      for (const it of items) {
        // ⚠️ **引用只跟着第一条** ✗ —— 不然每张图都会带一遍引用条 ✓，
        //   发三张就冒出三条一模一样的引用 ✓。
        const ok = await sendMedia(it.file, it.kind, it.meta, it.url, first);
        URL.revokeObjectURL(it.url);
        if (!ok) {
          // 发失败：**把还没发出去的放回待发区** ✓（已经发出去的那几张不用放 ✓），
          // 打字的内容也还给你 ✓ —— 不然用户得从头再选一遍 ✓。
          items.slice(items.indexOf(it)).forEach(x => {
            // ⚠️ **要重新造一个预览地址** ✗ —— 上面刚 `revokeObjectURL` 过它 ✓，
            //   旧地址已经作废了 ✓（放回去的那张缩略图会变成裂图 ✓）。
            //   `File` 本身还在 ✓，重新 create 一个就行 ✓。
            pending.push(Object.assign({}, x, { url: URL.createObjectURL(x.file) }));
          });
          syncPending();
          ta.value = t; syncSendBtn(t);
          return;
        }
        first = false;
      }
      if (t) {
        await api(`/groups/${group.id}/messages`, {
          method:'POST',
          body: JSON.stringify(Object.assign(
            { msg_type:'text', content:t, mentions: parseMentions(t) },
            items.length ? {} : quoteField()))     // 引用已经跟着第一张走了 ✓
        });
        clearQuote();
      }
    } catch (e) { toast(e.message); ta.value = t; syncSendBtn(t); }
  };
  $('#send').onclick = send;

  // ── 图片 ──────────────────────────────────────────────────────────
  //
  // 上传要单独写一个：api() 固定发 Content-Type: application/json，
  // 而文件上传得让浏览器自己带 multipart 边界，不能覆盖。
  const uploadFile = async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch('/api/media/upload', {
      method: 'POST',
      credentials: 'same-origin',   // 走 Cookie
      // 不要设 Content-Type —— 让浏览器自己带 multipart 边界
      body: fd,
    });
    const text = await r.text();
    let d = null;
    try { d = text ? JSON.parse(text) : null; } catch { d = text; }
    if (!r.ok) throw new Error(explain(d, r.status));
    return d;
  };

  // ── 待发附件（选了先不发 ✓）──────────────────────────────────────
  //
  // 用户 2026-10-06：`+` 里选的图和文件**不该立刻发出去** ✗ ——
  // 先停在输入框上方 ✓，还能接着打字 ✓，点一次「发送」一起走 ✓。
  //
  // ⚠️ 上传**推迟到发送那一刻** ✗→✓ —— 选完就传的话，
  //    用户删掉的那张也白传了一趟 ✓（而这趟要过 WireGuard ✓，不便宜 ✓）。
  //
  // ⚠️ 语音**不走这条路** ✗ —— 「按住说话、松手就发」本来就是一个完整的动作 ✓，
  //    中间插一层"待发"反而怪 ✓。
  const pending = [];

  const syncPending = () => {
    const bar = $('#pendbar');
    if (!bar) return;
    bar.textContent = '';
    pending.forEach((it, i) => {
      const box = document.createElement('div');
      box.className = 'pend';
      if (it.kind === 'image') {
        const im = document.createElement('img');
        im.src = it.url;
        box.appendChild(im);
      } else {
        const f = document.createElement('div');
        f.className = 'fchip';
        f.textContent = (it.file && it.file.name) || '文件';
        box.appendChild(f);
      }
      const x = document.createElement('button');
      x.className = 'px';
      x.textContent = '✕';
      x.onclick = () => removePending(i);
      box.appendChild(x);
      bar.appendChild(box);
    });
    bar.hidden = pending.length === 0;
    document.body.classList.toggle('hasPending', pending.length > 0);
  };

  /** 选完一个附件 → 按 `pickFor` 决定进哪个待发区 ✓（2026-10-08）✓。 */
  const pickAdd = (file, kind, meta) => {
    if (!file) return;
    if (pickFor === 'ws') setWsPending(file, kind);
    else addPending(file, kind, meta);
  };

  /** 组件对话那个待发框：**同时只有一张** ✓（见 `#fileWs` 那段说明 ✓）。 */
  const setWsPending = (file, kind) => {
    if (wsPending) URL.revokeObjectURL(wsPending.url);
    wsPending = { file, kind: kind || 'image', url: URL.createObjectURL(file) };
    syncWsPending();
    syncWsSend();
  };

  const addPending = (file, kind, meta) => {
    if (!file || !group) return;
    pending.push({ file, kind: kind || 'image', meta: meta || {},
                   url: URL.createObjectURL(file) });
    syncPending();
    scrollDown();
  };

  const removePending = (i) => {
    const it = pending[i];
    if (!it) return;
    URL.revokeObjectURL(it.url);
    pending.splice(i, 1);
    syncPending();
  };

  $('#fileCamera').addEventListener('change', e => { pickAdd(e.target.files[0], 'image'); e.target.value = ''; });
  $('#fileGallery').addEventListener('change', e => { pickAdd(e.target.files[0], 'image'); e.target.value = ''; });
  // ★ 文件 / 音频 ✓ —— 和相册那条同一个套路 ✓（选完**先不发**，进待发区 ✓）。
  //   ⚠️ 去处看 `pickFor` ✗：群聊进 `pending` 队列 ✓、组件对话进 `wsPending`（单个 ✓）。
  $('#fileDoc').addEventListener('change', e => { pickAdd(e.target.files[0], 'file'); e.target.value = ''; });
  $('#fileAudio').addEventListener('change', e => { pickAdd(e.target.files[0], 'audio'); e.target.value = ''; });

  // ★ 这个 ＋ 面板**两处共用** ✗→✓（2026-10-08）——
  //   用户定的：「组件聊天界面里，底部聊天框右边的照片还是要改成[主群聊]同款+，
  //   并且支持相机和相册」✓ → 那就**同一块面板** ✓，
  //   靠 `pickFor` 记住"这次是给谁挑的" ✓（两边选完之后的去处不一样 ✓）。
  let pickFor = 'chat';       // 'chat' | 'ws'
  const openPickSheet = (who) => { pickFor = who; $('#pickMedia').click(); };

  $('#pickMedia').onclick = () => {
    const p = $('#sheetPanel');
    // 微信的排布：横向一排，圆角方块图标 + 下方小字。顺序也是 相册 在前、拍摄 在后。
    p.innerHTML = `
      <div class="plus-grid" style="margin-top:4px">
        <!-- ⚠️ 这里原来有第三块「创意工坊」✗→✓（2026-10-08 挪去右上角了 ✓）——
             用户：「原先，创意工坊在底部聊天框的➕里，现在来到[主群聊]右上角」✓。 -->
        <button class="plus-item" id="pkGallery">
          <span class="ico">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor"
                 stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4.5" width="18" height="15" rx="2.5"/>
              <circle cx="8.5" cy="9.5" r="1.4"/>
              <path d="M3.5 16.5l4.6-4.3a1.6 1.6 0 0 1 2.2 0l3.2 3 2-1.8a1.6 1.6 0 0 1 2.2 0l3.3 3.1"/>
            </svg>
          </span>
          <span class="lbl">相册</span>
        </button>
        <button class="plus-item" id="pkCamera">
          <span class="ico">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor"
                 stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 8h3l1.4-2h7.2L17 8h3a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 19H4a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 4 8z"/>
              <circle cx="12" cy="13.2" r="3.2"/>
            </svg>
          </span>
          <span class="lbl">拍摄</span>
        </button>
        <button class="plus-item" id="pkDoc">
          <span class="ico">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor"
                 stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13.5 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10A1.5 1.5 0 0 0 18.5 19V8.5z"/>
              <polyline points="13.5 3.5 13.5 8.5 18.5 8.5"/>
            </svg>
          </span>
          <span class="lbl">文件</span>
        </button>
        <button class="plus-item" id="pkAudio">
          <span class="ico">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor"
                 stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 18V6l10-2v12"/>
              <circle cx="6.6" cy="18" r="2.4"/><circle cx="16.6" cy="16" r="2.4"/>
            </svg>
          </span>
          <span class="lbl">音频</span>
        </button>
      </div>
      <div class="actions"><button class="btn-ghost" id="pkCancel">取消</button></div>`;
    // 拍照必须走原生：`<input capture>` 在 MIUI 上会被忽略，点开是相册。
    p.querySelector('#pkCamera').onclick = () => {
      closeSheet();
      if (isNative && window.LifeGuardNative.takePhoto) window.LifeGuardNative.takePhoto();
      else $('#fileCamera').click();          // 浏览器里退回原生 input
    };
    p.querySelector('#pkGallery').onclick = () => { closeSheet(); $('#fileGallery').click(); };
    // ★ 文件 / 音频（2026-10-08）✓
    p.querySelector('#pkDoc').onclick = () => { closeSheet(); $('#fileDoc').click(); };
    p.querySelector('#pkAudio').onclick = () => { closeSheet(); $('#fileAudio').click(); };
    p.querySelector('#pkCancel').onclick = closeSheet;
    openSheet();
  };

  // ── 表情包（占位）──────────────────────────────────────────────────
  //
  // 位置先留着。后面内置表情包时，只要往 STICKERS 里塞条目、
  // 点选后走 **addPending** ✓（`sendImage` 已经没了 ✗ —— 2026-10-06 改成
  // "选了先停在待发区、点发送才走" ✓）。表情包本质就是张图片 ✓，一样停在待发区 ✓。
  const STICKERS = [];   // 例如 { name:'抱抱', path:'emoji/hug.webp' }

  $('#pickSticker').onclick = () => {
    const p = $('#sheetPanel');
    if (!STICKERS.length) {
      p.innerHTML = `<h3>表情</h3>
        <div style="color:var(--muted);font-size:14px;line-height:1.7;padding:12px 0">
          这里以后会放内置表情包。<br>入口先留着。</div>
        <div class="actions"><button class="btn-solid" id="stOk">知道了</button></div>`;
      p.querySelector('#stOk').onclick = closeSheet;
      openSheet();
      return;
    }
    // 有表情包之后的渲染（现在走不到）
    p.innerHTML = '<h3>表情</h3><div id="stGrid" style="display:flex;flex-wrap:wrap;gap:10px"></div>';
    STICKERS.forEach(s => {
      const img = document.createElement('img');
      img.src = '/media/' + s.path;
      img.style.cssText = 'width:64px;height:64px;border-radius:10px;object-fit:cover;cursor:pointer';
      img.onclick = async () => {
        closeSheet();
        try {
          await api(`/groups/${group.id}/messages`, {
            method: 'POST',
            body: JSON.stringify({ msg_type: 'image', media_path: s.path,
                                   media_meta: { sticker: true } }),
          });
        } catch (e) { toast(e.message); }
      };
      p.querySelector('#stGrid').appendChild(img);
    });
    openSheet();
  };

  const openLightbox = (src) => {
    $('#lightboxTxt').hidden = true;
    $('#lightboxImg').hidden = false;
    $('#lightboxImg').src = src;
    $('#lightbox').classList.add('on');
  };

  /** 看某个人的头像（放大）✓ —— 2026-10-07 用户："如果是群里其他人，
      则是查看其头像放大，点击旁边空白退出查看" ✓。
      没传过头像的人 → 给一个**大号的字** ✓，别让点按变成没反应 ✗。 */
  // ── 语音（按住说话，照微信）──────────────────────────────────────
  let recorder = null, chunks = [], recStart = 0, holding = false;

  const setVoiceMode = (on) => {
    document.body.classList.toggle('voiceMode', on);
    localStorage.setItem('lg_voice', on ? '1' : '0');
    closeAtMenu();
  };

  $('#modeToggle').onclick = () => setVoiceMode(!document.body.classList.contains('voiceMode'));
  if (localStorage.getItem('lg_voice') === '1') setVoiceMode(true);

  /** base64 → File，好复用同一条上传路径 */
  const b64ToFile = (b64, mime, name) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], name, { type: mime });
  };

  // ── 先上屏、后上传（照微信）──────────────────────────────────────
  //
  // 之前是"传完才显示"，用户按住发完什么都看不到，要等上传+转写+广播全走完
  // ——感知上就是"卡住了"。微信的做法是**立刻把本地内容画上去**，
  // 后台慢慢传，传完再用服务器返回的正式消息替换掉。
  const _temps = new Map();

  const addTempBubble = (id, kind, url, meta, file) => {
    const row = document.createElement('div');
    row.className = 'row mine';
    row.dataset.temp = id;
    const av = document.createElement('div');
    av.className = 'av';
    // 自己发的那条（先上屏、后上传 ✓）—— 用**自己的头像** ✓，没有才退回首字 ✓
    paintAvatar(av, me && me.avatar, (me && me.nickname) || '我');
    av.onclick = (ev) => { ev.stopPropagation(); if (!pressFired) openMe(); };
    const w = document.createElement('div'); w.className = 'wrap2';
    const b = document.createElement('div'); b.className = 'bubble';
    if (kind === 'image') {
      b.classList.add('media');
      const img = document.createElement('img');
      img.src = url;                       // 本地 blob，零延迟
      img.onclick = () => openLightbox(url);
      b.appendChild(img);
    } else if (kind === 'file' || kind === 'audio') {
      // 上传中：先画一个"正在传"的壳 ✓（文件名立刻看得见 ✓，别让人以为没选上 ✗）
      b.classList.add('media');
      const chip = mkel('div', 'filecard');
      chip.append(mkel('span', 'fi', kind === 'audio' ? '🎵' : '📎'),
                  mkel('span', 'fc', (file && file.name) || ''));
      b.appendChild(chip);
    } else {
      const v = document.createElement('div'); v.className = 'vmsg';
      v.innerHTML = '<span class="bars">▮▮▮</span>';
      const d = document.createElement('span'); d.className = 'dur';
      d.textContent = ((meta && meta.duration) || 0) + "''";
      v.appendChild(d);
      b.appendChild(v);
    }
    const st = document.createElement('div'); st.className = 'vsub';
    st.textContent = '发送中…';
    b.appendChild(st);
    w.appendChild(b); row.appendChild(av); row.appendChild(w);
    $('#msgs').appendChild(row);
    _temps.set(id, row);
    return row;
  };

  const removeTempBubble = (id) => {
    const row = _temps.get(id);
    if (row) row.remove();
    _temps.delete(id);
  };

  /** 发一条媒体 ✓。**返回 true/false** ✓ —— 调用方（`send` ✓）要靠它决定
      要不要把剩下的待发项放回去 ✓。 */
  const sendMedia = async (file, kind, meta, localUrl, useQuote = true) => {
    const tempId = 'tmp' + Date.now() + Math.random().toString(36).slice(2, 6);
    const url = localUrl || URL.createObjectURL(file);
    addTempBubble(tempId, kind, url, meta, file);
    scrollDown();
    try {
      const up = await uploadFile(file);
      const msg = await api(`/groups/${group.id}/messages`, {
        method: 'POST',
        body: JSON.stringify(Object.assign({
          msg_type: kind,
          media_path: up.path,
          // ⚠️ `original_name` 是**服务端给的**（它从 multipart 里读的 ✓）——
          //    前端的 `file.name` 也能用 ✓，但以服务端那份为准更省心 ✓（两边一致 ✓）。
          media_meta: { ...(meta || {}), size: up.size,
                        original_name: up.original_name || (file && file.name) },
        }, useQuote ? quoteField() : {})),
      });
      if (useQuote) clearQuote();
      // 正式消息可能已经从 WebSocket 先到了
      if (!$('#msgs').querySelector(`[data-id="${msg.id}"]`)) addMsg(msg);
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    } finally {
      removeTempBubble(tempId);
      if (!localUrl) URL.revokeObjectURL(url);
    }
  };

  // 原生拍完照回调这里
  window.__onPhoto = (b64, mime) => {
    if (!b64) return;              // 用户取消了
    // ★ 拍照也**先停在待发区** ✓ —— 和相册选图一致 ✓
    //   （用户 2026-10-06："点击添加后，照片或文件只是停留在待发送状态" ✓）。
    addPending(b64ToFile(b64, mime || 'image/jpeg', 'photo.jpg'), 'image');
  };

  // 原生录完音回调这里
  window.__onVoice = (b64, mime, secs) => {
    if (recCancelled) { recCancelled = false; return; }
    if (!b64) { toast('录音失败'); return; }
    sendMedia(b64ToFile(b64, mime || 'audio/mp4', 'voice.m4a'), 'voice', { duration: secs || 0 });
  };

  let recCancelled = false;

  const startRec = async () => {
    if (holding) return;

    // App 里走原生录音。网页的 getUserMedia 在 http://局域网IP 下不可用——
    // 那个 API 只在安全上下文（HTTPS / localhost）才存在。
    if (isNative && window.LifeGuardNative.startRecord) {
      holding = true; recCancelled = false;
      const btn = $('#holdTalk');
      btn.classList.add('rec'); btn.textContent = '松开 发送';
      window.LifeGuardNative.startRecord();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorder = new MediaRecorder(stream);
      chunks = [];
      recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const secs = Math.max(1, Math.round((Date.now() - recStart) / 1000));
        const type = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type });
        const btn = $('#holdTalk');
        btn.classList.remove('rec'); btn.textContent = '按住 说话';
        if (secs < 1) { toast('说话时间太短'); return; }
        try {
          toast('发送中…');
          const up = await uploadFile(new File([blob], 'voice', { type }));
          await api(`/groups/${group.id}/messages`, {
            method: 'POST',
            body: JSON.stringify({ msg_type: 'voice', media_path: up.path, media_meta: { duration: secs } }),
          });
        } catch (e) { toast(e.message); }
      };
      recorder.start();
      recStart = Date.now();
      holding = true;
      const btn = $('#holdTalk');
      btn.classList.add('rec'); btn.textContent = '松开 发送';
    } catch (e) {
      // 权限被拒 / 没有麦克风
      toast('拿不到麦克风权限，检查系统设置');
      console.warn(e);
    }
  };

  const stopRec = (cancel) => {
    if (!holding) return;
    holding = false;

    if (isNative && window.LifeGuardNative.stopRecord) {
      recCancelled = !!cancel;
      const btn = $('#holdTalk');
      btn.classList.remove('rec'); btn.textContent = '按住 说话';
      window.LifeGuardNative.stopRecord();
      return;
    }

    if (!recorder) return;
    if (cancel) { chunks = []; recorder.onstop = () => {}; }
    try { recorder.stop(); } catch {}
  };

  const holdBtn = $('#holdTalk');
  holdBtn.addEventListener('touchstart', e => { e.preventDefault(); startRec(); }, { passive: false });
  holdBtn.addEventListener('touchend', e => { e.preventDefault(); stopRec(false); }, { passive: false });
  holdBtn.addEventListener('touchcancel', () => stopRec(true));
  // 桌面浏览器调试用
  holdBtn.addEventListener('mousedown', startRec);
  holdBtn.addEventListener('mouseup', () => stopRec(false));
  holdBtn.addEventListener('mouseleave', () => stopRec(true));

  $('#text').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !$('#atMenu').classList.contains('on')) {
      e.preventDefault(); send();
    }
    if (e.key === 'Escape') closeAtMenu();
  });
  const autoGrow = () => { const t = $('#text'); t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; };

  // ── 设置 ──
  // ── 模型池（2026-10-11 从独立的「模型服务」并进来）────────────────────
  //
  // 原来整套（池子 / 三个用途槽 / 上下文长度）住在 8722 那个独立网页里 ✓，
  // 现在搬进这个 App 的一屏 ✓ —— **管理员专属** ✓。
  //
  // ⚠️ 这一屏**只由「设置 → 模型」那一行进** ✓（那一行按 `me.is_admin` 显示 ✓）。
  //    **藏入口只是体验** ✓，闸门在服务端（`/api/models/*` 的 `require_admin` ✓）。
  //    所以这里**每一处都假设自己可能拿到 403** ✓ → 如实报出来 ✓，
  //    别装作"池子是空的" ✗（那会让人以为模型丢了 ✓）。
  let MODELS = null;                 // 最近一次读到的池子
  const M_LABEL = { chat: '生活管家·chat', diy: '生活管家·diy', aux: '辅助·压缩' };

  const openModels = () => { pushScreen('models', 'settings'); renderModels(); };

  const mSec = (t) => mkel('div', 'msec', t);
  const mHint = (t, bad) => mkel('div', 'mhint' + (bad ? ' bad' : ''), t);
  const mBtn = (t, cls, fn) => { const b = mkel('button', 'mbtn' + (cls ? ' ' + cls : ''), t); b.onclick = fn; return b; };

  // 状态点：没测过 / 通 / 不稳 / 不通 —— **和原来那个界面同一套口径** ✓
  const mStateOf = (c) => {
    if (!c.test) return { cls: '', text: '还没测过' };
    const t = c.test;
    if (!t.ok) return { cls: 'bad', text: '不通 · ' + (t.error || '').slice(0, 42) };
    const ms = t.connect_ms ? ' · ' + t.connect_ms + 'ms' : '';
    if (t.tools) return { cls: 'ok', text: '通 ✓ 调工具 ' + (t.tools_hits || '') + ms };
    if (t.tools_any) return { cls: 'warn', text: '调工具不稳 ' + (t.tools_hits || '') + ms };
    return { cls: 'warn', text: '调不了工具 ' + (t.tools_hits || '') + ms };
  };

  const renderModels = async () => {
    const body = $('#modelsBody');
    if (!body) return;
    body.textContent = '';
    body.appendChild(mHint('正在读…'));
    try {
      MODELS = await api('/models/configs');
    } catch (e) {
      body.textContent = '';
      body.appendChild(mHint('读不到模型池：' + ((e && e.message) || e), true));
      return;
    }
    const d = MODELS;
    body.textContent = '';

    // ① 用途分配：三行，点一行挑一个模型 ✓
    body.appendChild(mSec('用途分配'));
    Object.keys(M_LABEL).forEach(k => {
      const r = (d.roles || {})[k] || {};
      const row = mkel('div', 'mitem');
      row.appendChild(mkel('span', 'k', M_LABEL[k]));
      row.appendChild(mkel('span', 'v' + (r.name ? '' : ' empty'), r.name || '还没选'));
      row.appendChild(mkel('span', 'chev', '›'));
      row.onclick = () => pickRole(k);
      body.appendChild(row);
    });

    // ② 模型池
    body.appendChild(mSec('模型池'));
    if (!d.configs.length) body.appendChild(mHint('池子是空的 —— 点右上角「＋」加一个。'));
    d.configs.forEach(c => body.appendChild(mCard(c)));

    // ③ 上下文长度
    body.appendChild(mSec('上下文长度'));
    body.appendChild(mCtx(d.context));

    body.appendChild(mHint('三个用途各挑一个模型：chat 负责聊天、diy 负责做组件、'
                           + 'aux 负责压缩和起标题。没选的那一档会哑。'));
  };

  const mCard = (c) => {
    const box = mkel('div', 'mcard');
    const top = mkel('div', 'top');
    const st = mStateOf(c);
    top.appendChild(mkel('span', 'mdot ' + st.cls));
    top.appendChild(mkel('span', 'nm', c.name || '(没名字)'));
    box.appendChild(top);
    box.appendChild(mkel('div', 'meta', (c.model || '') + ' · ' + (c.base_url || '')));
    box.appendChild(mkel('div', 'meta', st.text + (c.has_key ? ' · key …' + (c.key_tail || '') : ' · 没填 key')));
    const acts = mkel('div', 'acts');
    acts.appendChild(mBtn('测一下', '', () => testModel(c.id)));
    acts.appendChild(mBtn('改', '', () => editForm(c)));
    acts.appendChild(mBtn('删', 'danger', () => delModel(c)));
    box.appendChild(acts);
    return box;
  };

  // 挑某个用途用哪个模型 —— 一张底部弹层 ✓（测过通的排前面 ✓）
  const pickRole = (role) => {
    const d = MODELS || { configs: [] };
    const panel = $('#sheetPanel');
    panel.textContent = '';
    panel.appendChild(mkel('div', 'msec', M_LABEL[role]));
    const sorted = d.configs.slice().sort((a, b) =>
      ((b.test && b.test.ok) ? 1 : 0) - ((a.test && a.test.ok) ? 1 : 0));
    sorted.forEach(c => {
      const row = mkel('div', 'mitem');
      row.appendChild(mkel('span', 'k', c.name || '(没名字)'));
      const st = mStateOf(c);
      row.appendChild(mkel('span', 'mdot ' + st.cls));
      row.onclick = async () => {
        try { await api('/models/roles', { method: 'POST', body: JSON.stringify({ role, id: c.id }) }); }
        catch (e) { closeSheet(); toast((e && e.message) || '没选上'); return; }
        closeSheet(); renderModels();
      };
      panel.appendChild(row);
    });
    const none = mkel('div', 'mitem');
    none.appendChild(mkel('span', 'k empty', '（这一档不选）'));
    none.onclick = async () => {
      try { await api('/models/roles', { method: 'POST', body: JSON.stringify({ role, id: '' }) }); }
      catch (e) { closeSheet(); toast((e && e.message) || '没改成'); return; }
      closeSheet(); renderModels();
    };
    panel.appendChild(none);
    openSheet();
  };

  // 新建 / 改一个模型 —— 同一张表单 ✓（**key 留空 = 不改** ✓，见后端那段说明 ✓）
  const editForm = (c) => {
    const panel = $('#sheetPanel');
    panel.textContent = '';
    panel.appendChild(mkel('div', 'msec', c ? '改这一套' : '加一套'));
    const form = mkel('div', 'mform');
    const mk = (label, val, ph) => {
      form.appendChild(mkel('label', null, label));
      const i = mkel('input', 'field');
      i.value = val || ''; i.placeholder = ph || '';
      form.appendChild(i);
      return i;
    };
    const iName = mk('名字（自己认的）', c && c.name, '如：商汤');
    const iUrl = mk('接口地址', c && c.base_url, 'https://…/v1');
    const iModel = mk('模型名', c && c.model, '如：sensenova-6.8-flash-lite');
    const iKey = mk('密钥' + (c ? '（留空 = 不改）' : ''), '', c ? '' : 'sk-…');
    const acts = mkel('div', 'acts');
    acts.appendChild(mBtn('取消', '', () => closeSheet()));
    acts.appendChild(mBtn('保存', 'pri', async () => {
      const payload = { name: iName.value.trim(), base_url: iUrl.value.trim(),
                        model: iModel.value.trim(), api_key: iKey.value.trim() };
      if (!c && !payload.api_key) { toast('新建要填密钥'); return; }
      try {
        if (c) await api('/models/configs/' + c.id, { method: 'PATCH', body: JSON.stringify(payload) });
        else await api('/models/configs', { method: 'POST', body: JSON.stringify(payload) });
      } catch (e) { toast((e && e.message) || '没存上'); return; }
      closeSheet(); renderModels();
    }));
    form.appendChild(acts);
    panel.appendChild(form);
    openSheet();
  };

  const delModel = async (c) => {
    const yes = await confirmBox({
      title: '删掉「' + (c.name || '') + '」？',
      body: '它的密钥只存在这儿，删了就找不回来了。', danger: true, ok: '删掉' });
    if (!yes) return;
    try {
      const r = await api('/models/configs/' + c.id, { method: 'DELETE' });
      if (r && r.freed && r.freed.length) toast('删了 —— 这几个用途现在是空的：' + r.freed.join('、'));
      renderModels();
    } catch (e) { toast((e && e.message) || '没删掉'); }
  };

  // 测一套：**要好几秒** ✓ —— 轮询 `/progress` 把"现在在干什么"显示出来 ✓
  //（不给反馈的话用户会以为卡死了 ✓，这是原来那个界面的教训 ✓）。
  const testModel = async (cid) => {
    const body = $('#modelsBody');
    const line = mHint('正在测…');
    let timer = null;
    const stop = () => { if (timer) clearInterval(timer); timer = null; };
    try {
      timer = setInterval(async () => {
        try {
          const p = await api('/models/progress');
          if (p && p.text) line.textContent = p.text;
        } catch (e) { /* 轮询失败就算了 ✓，别打断测试 */ }
      }, 600);
      await api('/models/configs/' + cid + '/test', { method: 'POST' });
    } catch (e) {
      stop(); toast((e && e.message) || '测不了'); return;
    }
    stop();
    line.remove();
    renderModels();
  };

  // 上下文长度：**只知道排队了、不知道成没成** ✓ —— root 写完之后状态文件里才有 ✓。
  // 所以这里点完要**轮询一会儿** ✓（原来那个界面就是这么干的 ✓）。
  const mCtx = (ctx) => {
    const box = mkel('div', 'mform');
    const cur = ((ctx && ctx.groups && ctx.groups.chat) || {});
    const vals = Object.keys(cur).map(k => cur[k]);
    const now = vals.length ? Math.round(vals[0] / 1000) + 'k' : '还没同步过';
    box.appendChild(mkel('label', null, '生活管家这一档（现在：' + now + '）'));
    const i = mkel('input', 'field');
    i.type = 'number'; i.min = '64'; i.max = '2000'; i.placeholder = '填 k，如 128';
    box.appendChild(i);
    const line = mHint(ctx && ctx.last && ctx.last.note
      ? ('上次：' + (ctx.last.group || '') + ' → ' + Math.round((ctx.last.want || 0) / 1000)
         + 'k，' + (ctx.last.ok ? '成了' : '没成') + (ctx.last.note ? '（' + ctx.last.note + '）' : ''))
      : '');
    const acts = mkel('div', 'acts');
    acts.appendChild(mBtn('保存', 'pri', async () => {
      const k = parseInt(i.value, 10);
      if (!k || k < 64 || k > 2000) { toast('填 64 ~ 2000 之间的数（单位 k）'); return; }
      try { await api('/models/context', { method: 'POST', body: JSON.stringify({ group: 'chat', tokens: k * 1000 }) }); }
      catch (e) { toast((e && e.message) || '没排上队'); return; }
      toast('排上队了，root 那边改完才生效');
      // 轮询一会儿看它成没成（root 的 worker 是几秒量级 ✓）
      for (let n = 0; n < 12; n++) {
        await new Promise(r => setTimeout(r, 1500));
        try {
          const d = await api('/models/configs');
          MODELS = d;
          const last = d.context && d.context.last;
          if (last && last.ok !== null && last.ok !== undefined) break;
        } catch (e) { break; }
      }
      renderModels();
    }));
    box.appendChild(acts);
    if (line.textContent) box.appendChild(line);
    return box;
  };

  $('#modelsBack').onclick = () => popScreen('models');
  $('#modelsAdd').onclick = () => editForm(null);

  const renderSettings = () => {
    const eGname = $('#vGname'); if (eGname) eGname.textContent = group?.name || '';
    const eAname = $('#vAname'); if (eAname) eAname.textContent = agentName();
    // ⚠️ 这里原来还给「群昵称」那一行填值 ✓（`#vMy` ✓）——
    //    **那一行和这个 DOM 都删了** ✗→✓（2026-10-08：一个人的名字只有一个 ✓）。
    //    留着这段代码不会报错（`if (eMy)` 兜着 ✓），但它会让人以为
    //    "界面上还有那一行、只是没显示" ✗ —— 死代码比没有更坏 ✓。
    // 「我的」右边写昵称 —— 这一行点进去就是"我"那一页，
    // 写着名字才像"我的"。
    const eMe = $('#vMe');
    if (eMe) eMe.textContent = (me && (me.nickname || me.username)) || '';
    // 「邀请码」右边 = **码本身** ✓ / 满员了 = 「空间已满」✓
    // ★ **这一格是异步填的** ✗→✓（2026-10-09）—— "满没满"要问服务端算的
    //   `full` ✓（`bootstrap` 的 `group` 里没有它 ✗），所以这里**发一趟就走** ✓，
    //   不 await（`renderSettings` 是同步的 ✓，而且它被调得很勤 ✓）。
    refreshSpaceInfo();
    const av = $('#vAppVer');
    if (av) {
      const v = (window.LifeGuardNative && LifeGuardNative.appVersion) ? LifeGuardNative.appVersion() : '';
      av.textContent = v ? 'v' + v : '（浏览器）';
    }
    // ★ 2026-10-11：「模型」这一行**只有管理员看得见** ✓ ——
    //   藏入口只是体验 ✓，闸门在服务端（`/api/models/*` 的 `require_admin` ✓）。
    const rm = $('#rowModels');
    if (rm) rm.style.display = (me && me.is_admin) ? '' : 'none';
  };
  const promptText = (title, value, hint, onOk) => {
    const p = $('#sheetPanel');
    p.innerHTML = `<h3></h3><input class="field" id="sInput">
      <div class="hint" style="font-size:12px;color:var(--muted);margin-bottom:4px"></div>
      <div class="actions"><button class="btn-ghost" id="sCancel">取消</button>
      <button class="btn-solid" id="sOk">保存</button></div>`;
    p.querySelector('h3').textContent = title;
    // ★ **标题/说明可以是空的** ✗→✓（2026-10-09 用户定的：点「空间」改名时
    //   「"空间名字"和"群聊顶部那个名字**"去掉」✓）——
    //   ⚠️ 空着的时候要**真的不占位置** ✗（`textContent=''` 还留着那条 h3 的
    //      上下外边距 ✓，看着就是"顶上莫名其妙空了一块" ✓）→ 直接 `display:none` ✓。
    //   ⚠️ 用 `style.display` 而不是 `hidden` 属性 ✗ —— 样式表里给 h3 定了
    //      `display` 的话，`[hidden]` 会被它盖过去 ✓（这个坑在登录页那两格上踩过 ✓）。
    if (!title) p.querySelector('h3').style.display = 'none';
    const inp = p.querySelector('#sInput'); inp.value = value || '';
    if (hint) p.querySelector('.hint').textContent = hint;
    else p.querySelector('.hint').style.display = 'none';
    p.querySelector('#sCancel').onclick = closeSheet;
    p.querySelector('#sOk').onclick = () => { const v = inp.value.trim(); if (v) { closeSheet(); onOk(v); } };
    openSheet(); setTimeout(() => inp.focus(), 120);
  };

  // 复制到剪贴板。**不能用 navigator.clipboard** ✗ —— 它是安全上下文专有的 ✓，
  // 而我们走的是 http（内网、隧道本身加密）✓，调它只会拿到 undefined ✓，
  // 而且失败得很安静 ✓。所以用那个老办法：临时插一个 textarea 再选中复制 ✓。
  const copyText = (s) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select(); ta.setSelectionRange(0, s.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  };

  // ⚠️ 「改群昵称」那个弹层**整个删了** ✗→✓（2026-10-08）——
  //    群昵称这个概念被撤了 ✓（「一个人的名字只有一个」✓，改在「我的」里 ✓）。
  //    留着一个没人调的函数比删掉更坏 ✗：下一个人会以为界面上还有个入口 ✓。
  //    （后端那条 `PATCH /groups/{id}/me` 也要删 ✓ —— 排在 P4 ✓。）


  const saveGroup = patch =>
    api(`/groups/${group.id}`, { method:'PATCH', body: JSON.stringify(patch) })
      .then(refreshGroup).then(() => toast('已保存')).catch(e => toast(e.message));

  // ── 空间那三件事：**只有这一处实现** ✓ ──────────────────────────────
  //
  // ★ 2026-10-09 用户定的 ✓（原话：「空间的话，拆到设置里吧，**不单独进入了**，
  //   **点击空间依旧只修改空间名**；然后邀请码和退出当前空间（红色字体居中在
  //   退出登录上面）回到设置页」✓）。
  //
  //   ⚠️ 这三件事原来住在 `#space` 那一屏里 ✓ —— 那一屏**现在没有入口了** ✗
  //      （和 `#wsNav` 一样留着不删 ✓，理由见 `openMeSheet` 上面那段 ✓）。
  //      所以我特意把它们**抽成函数**（而不是在设置页重写一份 ✗）：
  //      `renderSpace` 也调同一批 ✓（"同一件事两处实现"是这个项目反复栽过的 ✓）。

  //: 「这个空间现在什么样」：`full`（满员没有 ✓）、`invite_code`、`alone`（只剩我一个 ✓）。
  //: ⚠️ **必须问服务端** ✗ —— `bootstrap` 回来那个 `group` **没有** `full` 这一项 ✓
  //:   （它是每次算出来的 ✓，见 `join_space` ✓）。
  let spaceInfo = null;

  /** 拉一次空间信息，顺手把设置页那两格刷新 ✓（异步、不等到结果 ✓）。 */
  const refreshSpaceInfo = async () => {
    try {
      const d = await api('/workspaces/mine');
      spaceInfo = (d && d.space) || null;
    } catch (e) { spaceInfo = null; }
    const el = $('#vInvite');
    if (el) {
      el.textContent = !spaceInfo ? ''
        : (spaceInfo.full ? '空间已满' : (spaceInfo.invite_code || '—'));
    }
    // 「退出当前空间」那一行：只剩我一个时才是亮的 ✓（能不能退**服务端还要再判一次** ✓）
    const lv = document.querySelector('.item[data-act="leave"]');
    if (lv) lv.style.opacity = (spaceInfo && !spaceInfo.alone) ? '.45' : '';
    return spaceInfo;
  };

  /** 改空间名 —— 设置页那一行、`#space` 那张卡、**都走它** ✓。
   *
   *  ⚠️ **标题和那句说明都不要** ✗→✓（2026-10-09 用户定的 ✓）——
   *    他要的就是"点了只有一格名字 + 保存" ✓（格子里本来就写着现在的名字 ✓，
   *    再顶上写一句「空间名字」是废话 ✓，底下那句"顶栏也会跟着变"也是废话 ✓）。
   */
  const renameSpace = () => {
    promptText('', (group && group.name) || '', '',
      async (v) => {
        try {
          await api('/workspaces/rename', { method: 'POST', body: JSON.stringify({ name: v }) });
          // ⚠️ 群聊顶栏那个名字也要跟着变 ✓（不然退回去还是旧的 ✓，用户会以为没保存 ✓）
          try {
            const b = await api('/groups/bootstrap?limit=1');
            if (b.group) group = b.group;
          } catch (e) { /* 刷不到就算了：下次开页会重新拉 ✓ */ }
          renderHeader(); renderSettings();
          toast('已保存');
        } catch (e) { toast((e && e.message) || '没保存上'); }
      });
  };

  /** 点「邀请码」= 复制 ✓ —— 满员时说人话，别的啥也不做 ✓。 */
  const inviteCodeNow = async () => {
    // ⚠️ **现问一次** ✗→✓（不吃缓存 ✓）—— 缓存里的 `full` 可能已经过时 ✓，
    //    而"满没满"正是这一步要判的东西 ✓。
    const s = await refreshSpaceInfo();
    if (!s) { toast('读不到空间'); return; }
    if (s.full) { toast('空间已经满了，暂时进不来新人'); return; }
    const code = s.invite_code || '';
    if (!code) { toast('这个空间没有邀请码'); return; }
    // ⚠️ 复制不了的时候要**把码念出来** ✓（老 WebView 没 execCommand 时会走到这儿 ✓）
    //    —— 静默失败会让人以为"点了没反应" ✓。
    toast(copyText(code) ? '邀请码已复制' : '复制不了，手动记一下：' + code);
  };

  /**
   * **退出当前空间**（连记忆一起删 ✓）—— 设置页那一行和 `#space` 都走它 ✓。
   *
   * ⚠️ **"能不能退"由服务端算** ✗（`GET /api/workspaces/mine` 回 `alone` ✓）——
   *    这里灰不灰、说不说那句话只是体验 ✓；服务端在 `leave_space` 里**再判一次** ✓
   *    （能被绕过的检查等于没有 ✓，这条是老规矩 ✓）。
   * ⚠️ 所以这里**每次都现问一次** ✓，不吃 `spaceInfo` 缓存 ✗ ——
   *    这一步是要删东西的 ✓，值一次网络往返 ✓（"刚刚有人加进来"那种情况，
   *    缓存会让他先听到一句错的解释 ✓）。
   */
  const confirmLeaveSpace = async () => {
    let d;
    try { d = await api('/workspaces/mine'); }
    catch (e) { toast((e && e.message) || '读不到空间'); return; }
    const s = d && d.space;
    if (!s) { toast('你还没有生活空间'); return; }
    // ★ 措辞照用户 2026-10-09 的原话 ✓（他要的是这一句 ✓）：
    // ★ 断行照用户 2026-10-09 给的两行 ✓（第一行「当前人数超过1人，」
    //   第二行「暂不支持退出」✓）—— ⚠️ 它这次把「空间」两个字去掉了 ✓，
    //   就按他写的来 ✓（要加回来说一声 ✓）。
    //   ⚠️ 换行靠【反斜杠 + n 两个字符】+ CSS 的 white-space:pre-line ✓（见 .toast 那段 ✓）。
    //   ⚠️⚠️ **这条注释里不能写裸反引号** ✗→✓（我刚写的，当场被 node --check 抓住 ✓）：
    //      抽脚本那一步是**按字符扫**的 ✓，看到一个反引号就以为「模板字符串开始了」✓ → 后面整段被当成字符串吃掉 ✓。
    //      这个坑**这个文件顶上就写着** ✓ —— 我又踩了一次 ✓。
    if (!s.alone) { toast('当前人数超过1人，\n暂不支持退出'); return; }
      // ★ **二次防呆** ✓（用户点名要的 ✓）—— 而且**把代价说全** ✓。
      // ★ 文案照用户 2026-10-09 的原话 ✓（他给的是**一整句**，我没改写它 ✗）——
      //   那句以「注意！」开头 ✓，正好是这段提示的**抬头** ✓ → 抬头进 title ✓、
      //   后半句进 body ✓，一个字没动 ✓。
      // ⚠️ 旧文案里写着 **永久删除** ✗，而 confirmBox 是 textContent 渲染的 ✓
      //    → markdown 不生效 ✓，屏幕上会**原样带两个星号** ✓（趁这次一起没了 ✓）。
    const yes = await confirmBox({
      title: '注意！',
      body: '此操作将会永久删除该空间的所有组件和记录，是否继续？',
      ok: '退出并删除', danger: true,
    });
    if (!yes) return;
    try {
      await api('/workspaces/leave', { method: 'POST' });
      toast('正在退出…');
      // 空间已经对我不可见了 ✓ → 重走一次落地 ✓ → 会落到初始化屏 ✓
      //（`enterApp` 里那条"没有空间"的分支 ✓，而且 `show()` 会顺手把
      //  设置页那一层的 `.on` 全清掉 ✓ —— 不用手动一层层退 ✓）。
      await enterApp();
    } catch (e) { toast((e && e.message) || '没退成'); }
  };

  $$('.item[data-act]').forEach(el => {
    el.onclick = () => {
      const act = el.dataset.act;
      // ★ **点「空间」只改名** ✗→✓（2026-10-09 用户定的 ✓ —— 原来它推开 `#space` ✓）
      if (act === 'gname') renameSpace();
      else if (act === 'invite') inviteCodeNow();
      // ★ **退出当前空间**（红字居中，就在「退出登录」上面 ✓）—— 二次确认在它里面 ✓
      else if (act === 'leave') confirmLeaveSpace();
      else if (act === 'agentprofile') {
        // ★ 2026-10-06：打开**这一屏自己的**管家设置 ✓。
        //   原来调的是 `window.openAgentPanel` ✗ —— 那个函数属于一个
        //   **没部署上来的扩展** ✓（`ui/` 目录是空的 ✓），
        //   于是这一行一直是"点不动的按钮"✗（还不报错 ✓）。
        openAgentSettings();
      }
      else if (act === 'aname') promptText('管家昵称', agentName(), '改完它自己也会用这个名字', v => saveGroup({ agent_name: v }));
      else if (act === 'update') {
        if (window.LifeGuardNative && LifeGuardNative.checkUpdate) LifeGuardNative.checkUpdate();
        else toast('浏览器里没有这一项——回 App 里点');
      }
      else if (act === 'shell') openMe();
      // ★ 2026-10-11：「模型」—— 只对管理员显示 ✓（那一行在 renderSettings 里控制 ✓）
      else if (act === 'models') openModels();
      // ⚠️ 原来这里有一条 `act === 'plugins' → openComponents()` ✗→✓ ——
      //    它是条**死路**：设置里那一行 DOM 早就被拿掉了 ✓（用户"后续我自有安排"✓），
      //    所以那个分支永远不会被触发 ✓，只会让人以为"有个组件入口在设置里" ✗。
      //    2026-10-07 创意工坊搬到群聊右上角 ✓，这条删掉 ✓。
      else if (act === 'logout') logout();
    };
  });

  // ── 组件：管家自己做的小面板 ───────────────────────────────────────
  //
  // 它们跑在**沙箱 iframe** 里（`srcdoc` + `sandbox="allow-scripts"`，
  // **故意不给 `allow-same-origin`**）。所以那是个**不透明源**：
  //
  //   · 读不到 localStorage / Cookie —— 拿不到你们的登录态
  //   · 碰不到这个页面 —— 改不了界面
  //   · 它写什么代码都只影响那一小块画布
  //
  // 代价是**它自己也没法来取数据**（跨源请求被拦）。所以数据是这一侧
  // 取好了塞进去的——**数据流单向下发**，组件那边碰不到任何接口。
  //
  // 这就是"让它随便画"的前提：分界线不是"能不能写代码"，是"写的东西跑在哪个源里"。
  // （这儿原来有一大段"服务选择：管家 / 对讲机 / 模型"的说明 ✗ ——
  //   2026-10-06 那条路撤了 ✓：**路由归壳** ✓，这一页不再列服务 ✗。
  //   注释留着比代码还危险 ✗ —— 下一个人（或者 agent）会照着它去改 ✗。）
  // ── 「我的」：现在**是这一页里的一屏** ✗→✓（2026-10-08 合并那次）──────
  //
  // ★ 这一段原来叫 `backToShell` ✓ —— 它的活儿是"把人送去壳的 `/me`" ✓，
  //   为此要跨服务真导航 ✓，来回一趟丢了状态还得补标记（补过两次 ✗）✓。
  //
  //   合并之后「我的」就在这一页里 ✓（`#me` ✓）→
  //   **整个函数连同它的一族问题一起没了** ✓：
  //     · 不用记"我刚才在工坊哪条对话" ✓（页面根本没离开 ✓）
  //     · 不用管 `SHELL_PORT` ✓（不再跨端口 ✓）
  //     · 也不用担心"壳不知道我在哪" ✓
  //   （这是这次合并最大的收益之一 ✓ —— 不是功能变多，是**要维护的东西变少** ✓。）
  //
  // ⚠️ **只有登出还是一次真导航** ✗ —— 它必须由服务端清 httpOnly cookie ✓，
  //    顺便把整页内存状态丢掉 ✓（用户换了账号，页面上不该留着上一个人的东西 ✓）。
  const logout = () => {
    // 先让服务端把票作废 ✓（`POST /api/logout` ✓），再真导航去登录页 ✓ ——
    // ⚠️ 顺序不能反 ✗：先跳的话那次清票请求可能还没发出去 ✓，
    //    而 `/login` 那一页**自己也会清一次票** ✓（服务端那一条 ✓），所以两道都在 ✓。
    api('/logout', { method: 'POST' })
      .catch(() => {})
      .finally(() => { location.href = '/login'; });
  };
  window.__logout = logout;

  /**
   * ★ **「我的」= 一整屏** ✓ —— 形状照**壳那版 `paintHome` / `renderEdit`** 来
   *   （2026-10-09 用户第三次点这一块 ✓）。
   *
   *   他原话：「你再回忆一下，是**我给你提出重构 app、将管理员的服务从生活管家
   *   去除之前的那版**，你目前给的这版**更古老**，不对」✓。
   *   → 那一版在 `tools/lifeguard-shell.py` 的 `paintHome()` 里还活着 ✓
   *     （这段是**对着它一字一句抄的** ✓，不是凭印象 ✓）：
   *       ① **资料卡**：**横排** —— 左头像 + 右「昵称 / @用户名」✓
   *          点**整张卡** = 改头像 ✓
   *       ② 「账号」一组三行：**昵称 / 用户名 / 密码** ✓
   *          右边写着**现在的值** ✓（密码那行空着 ✓），**各点各的** ✓
   *   ⚠️ **我上一版又做错了** ✗：我做成了**底部弹层** ✓（`myProfileSheet` ✓）——
   *      那是壳**更早**的一版 ✓，和这一版"长得像、但不是同一个东西" ✓。
   *      他说"更古老"说得准 ✓ —— 那一版是先有的 ✓，`paintHome` 是后来重做的 ✓。
   *   ⚠️ **没有「退出登录」** ✗ —— 壳那版只在"一个空间都没有"时才给 ✓
   *      （那种人在合并后落到**初始化屏** ✓）；平时它在**设置页** ✓。
   */
  const renderMe = () => {
    const body = $('#meBody');
    if (!me) { body.textContent = '读不到你的资料，刷新一下试试'; return; }
    body.textContent = '';

    // ① 资料卡：**横排** ✓（壳那版 `.prof` 就是横的 ✓ ——
    //    竖着摆一个大头像那种是更早的版式 ✗）
    const prof = mkel('div', 'prof');
    const av = mkel('div', 'av');
    paintAvatar(av, shellURL(me.avatar), me.nickname || me.username || '我');
    const who = mkel('div', 'who');
    who.appendChild(mkel('div', 'n', me.nickname || me.username || ''));
    who.appendChild(mkel('div', 'u', '@' + (me.username || '')));
    // ★ 右侧那个 `›` ✓（2026-10-09 用户：「我的，头像栏右侧加上 >，和管家那里对齐」✓）——
    //   管家那一屏的资料卡（`renderAgent`）本来就有 ✓，
    //   两屏是**同构**的 ✓（同一套 `.prof` 样式 ✓，`.go` 自带 `margin-left:auto` ✓）。
    prof.append(av, who, mkel('span', 'go', '›'));
    prof.onclick = () => openMeEdit('avatar');
    body.appendChild(prof);

    // ② 账号：三行 ✓（右边那一格就是**现值** ✓ —— 一眼看全，不用点进去才知道 ✓）
    body.appendChild(mkel('div', 'sec', '账号'));
    const grp = mkel('div', 'grp');
    grp.appendChild(meRow('昵称', me.nickname || '', () => openMeEdit('nickname')));
    grp.appendChild(meRow('用户名', me.username || '', () => openMeEdit('username')));
    grp.appendChild(meRow('密码', '', () => openMeEdit('password')));
    body.appendChild(grp);

    // ③ 自我介绍 ✓（2026-10-09 用户定的 ✓）—— 和管家的「性格」**同一个形状** ✓
    //    （可收可展、三行封顶、居中的朝下箭头 ✓，见 `collapsibleText` ✓）
    body.appendChild(mkel('div', 'sec', '自我介绍'));
    const g3 = mkel('div', 'grp');
    g3.appendChild(selfIntroBlock());
    body.appendChild(g3);
  };

  /** 「我的」里的**一行** ✓（左标题、右现值、最右 `›` ✓）。 */
  const meRow = (label, value, fn) => {
    const b = mkel('button', 'row');
    b.append(mkel('span', 'rl', label), mkel('span', 'rv', value), mkel('span', 'go', '›'));
    b.onclick = fn;
    return b;
  };

  const openMe = () => {
    if (!$('#me').classList.contains('on')) {
      if ($('#chat').classList.contains('on')) pushScreen('me');   // 从群聊/设置进来 ✓
      else show('me');                                            // 直接落在 /me 上 ✓
    }
    renderMe();
  };
  const closeMe = () => {
    // ⚠️ **不能再写死 `tellNative('chat')`** ✗→✓（2026-10-09 用户报的：
    //   「返回后回到组件聊天也没问题，但再次返回就提示再滑一次退出了，
    //    但这不是主群聊，**此时返回应该按照来时路返回对应组件才对**」✓）。
    //   「我的」现在能从**组件对话**里点开头像进来 ✓ —— 那种情况下退回去
    //   该报的是 `'settings'` ✓（底下是组件对话 ✓，不是群聊 ✓）。
    //   → 交给 `popScreen` → `tellTop('me')` **现算** ✓。
    // 底下有群聊 → 退回去 ✓；没有（直接从 `/me` 这个地址进来的 ✓）→ 回主群聊 ✓。
    if ($('#chat').classList.contains('on')) popScreen('me');
    else location.href = '/';
  };

  /**
   * 改完之后**到处都跟着变** ✓ —— 群聊顶栏、成员名单、设置页那几格，
   * 还有**已经画出来的那些气泡** ✗（它们不会自己更新：名字和头像取的都是
   * 画那一刻的值 ✓）。
   */
  const refreshMembers = async () => {
    try {
      const b = await api('/groups/bootstrap?limit=1');
      if (b.group) group = b.group;
      if (b.members) members = b.members;
    } catch (e) { /* 刷不到就先这样 ✓ —— 下次开页会重新拉 ✓ */ }
    renderHeader(); renderSettings();
    $$('#msgs .row[data-id]').forEach(row => {
      const m = _msgs.get(Number(row.dataset.id));
      if (!m || m.sender_id !== me.id) return;
      m.sender_nickname = me.nickname;
      const w = row.querySelector('.who');
      if (w) w.textContent = me.nickname || '';
      const a = row.querySelector('.av');
      if (a) paintAvatar(a, shellURL(me.avatar), me.nickname || '我');
    });
  };

  // ── 编辑页：**一面屏，按 kind 分四种** ✓（壳那版的 `renderEdit(kind, me)` ✓）──
  //
  //   kind = `'avatar'` / `'nickname'` / `'username'` / `'password'` ✓
  //   ⚠️ 壳那版**一个函数全包** ✓ —— 这段也照做 ✓。
  //      原来这里是两屏 ✗（`#meEdit` 管头像和昵称、`#meAccount` 管账号密码 ✓）——
  //      那是 2026-10-08 合并时**我自己分的** ✗，不是他要的形状 ✓
  //      （`#meAccount` 现在**没有入口了** ✓，和 `#space`/`#wsNav` 一样留着不删 ✓）。
  let meEditKind = 'nickname';
  const openMeEdit = (kind) => {
    meEditKind = kind || 'nickname';
    if (!$('#meEdit').classList.contains('on')) pushScreen('meEdit');
    renderMeEdit();
  };
  const closeMeEdit = () => popScreen('meEdit');

  const renderMeEdit = () => {
    const body = $('#meEditBody');
    body.textContent = '';
    const kind = meEditKind;
    const T = { nickname: '修改昵称', username: '修改用户名',
                password: '修改密码', avatar: '修改头像' };
    body.appendChild(mkel('div', 'mh', T[kind] || '修改'));

    const card = mkel('div', 'card');
    const err = mkel('div', 'err', '');
    let save;

    if (kind === 'avatar') {
      // 头像页：**一个大头像 + 一行小字** ✓（壳那版 2026-10-06 就这么简化过：
      //   没有"选择图片"按钮 ✓、没有"方形图效果最好"那句 ✓ ——
      //   多一个按钮就多一步"该点哪个" ✓，而缩放/转格式是**我们的事** ✓）
      const f = mkel('input');
      f.type = 'file'; f.accept = 'image/*'; f.style.display = 'none';
      const big = mkel('div', 'bigav');
      const av = mkel('div', 'av');
      paintAvatar(av, shellURL(me.avatar), me.nickname || '我');
      big.appendChild(av);
      av.onclick = () => f.click();          // **头像本身就是那个按钮** ✓
      card.classList.add('avcard');          // 这一张装头像，上下留白大一点 ✓
      card.append(f, big, mkel('div', 'tip', '点击头像替换'));
      save = async () => {
        const file = f.files && f.files[0];
        if (!file) throw new Error('先点一下头像，选一张图');
        // 形状要和服务端**对上** ✗：它只收 `data:image/jpeg;base64,…`
        const blob = await shrinkToJpeg(file, 320);
        const data = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.onerror = () => rej(new Error('这张图读不出来'));
          r.readAsDataURL(blob);
        });
        const out = await api('/avatar', { method: 'POST', body: JSON.stringify({ data }) });
        me.avatar = out.avatar;
      };
    } else if (kind === 'nickname') {
      card.appendChild(mkel('label', null, '昵称'));
      const i = mkel('input', 'field');
      i.value = me.nickname || '';
      i.maxLength = 24;
      card.appendChild(i);
      save = async () => {
        const v = i.value.trim();
        if (!v) throw new Error('昵称不能空着');
        if (v === (me.nickname || '')) return;
        const out = await api('/me', { method: 'PATCH', body: JSON.stringify({ nickname: v }) });
        me.nickname = out.nickname;
      };
    } else if (kind === 'username') {
      card.appendChild(mkel('label', null, '用户名'));
      const i = mkel('input', 'field');
      i.value = me.username || '';
      i.maxLength = 24;
      card.appendChild(i);
      card.appendChild(mkel('label', null, '当前密码'));
      const cp = mkel('input', 'field');
      cp.type = 'password'; cp.autocomplete = 'current-password';
      card.appendChild(cp);
      save = async () => {
        const v = i.value.trim();
        if (!v) throw new Error('用户名不能空着');
        const out = await api('/me', { method: 'PATCH',
          body: JSON.stringify({ username: v, current_password: cp.value }) });
        me = { ...me, ...out };
      };
    } else {
      // 改密码：**输两遍** ✓（壳那版就这么做的 —— 打错了没法回头 ✓）
      card.appendChild(mkel('label', null, '当前密码'));
      const c = mkel('input', 'field'); c.type = 'password';
      c.autocomplete = 'current-password';
      card.appendChild(c);
      card.appendChild(mkel('label', null, '新密码'));
      const a = mkel('input', 'field'); a.type = 'password';
      a.autocomplete = 'new-password';
      card.appendChild(a);
      card.appendChild(mkel('label', null, '重复新密码'));
      const b = mkel('input', 'field'); b.type = 'password';
      b.autocomplete = 'new-password';
      card.appendChild(b);
      save = async () => {
        if (!a.value) throw new Error('新密码不能空着');
        if (a.value !== b.value) throw new Error('两次输入的新密码不一样');
        await api('/me', { method: 'PATCH',
          body: JSON.stringify({ password: a.value, current_password: c.value }) });
      };
    }

    const btn = mkel('button', 'btn-save', '保存');
    const swap = mkel('div', 'swap');
    const back = mkel('b', null, '取消');
    back.onclick = closeMeEdit;
    swap.appendChild(back);
    // ★ 头像那一页**按钮单独一张卡** ✓（壳那版就是两张：一张装头像、一张装按钮 ✓）；
    //   别的几页一页一张卡 ✓。
    // ⚠️ `err` 挂在**按钮那张卡**里 ✓（壳那版特意挪过来的）——
    //    挂在上面那张卡里的话，空着时要占 `min-height` + `margin-top` ≈ 30px 死空间 ✓，
    //    用户会以为"下面的间距太大" ✓（他当时就是这么说那个间距的 ✓）。
    const btnCard = (kind === 'avatar') ? mkel('div', 'card') : card;
    btnCard.append(btn, err, swap);
    body.appendChild(card);
    if (btnCard !== card) body.appendChild(btnCard);

    btn.onclick = async () => {
      btn.disabled = true;
      err.textContent = '';
      try {
        await save();
        await refreshMembers();
        closeMeEdit();      // 保存成功 → **回「我的」** ✓（壳那版也是改完就回主页 ✓）
        renderMe();
        toast('已保存');
      } catch (e) {
        err.textContent = (e && e.message) || '没保存上';
        btn.disabled = false;
      }
    };
  };
  // ── 别人的那一屏：头像 + 昵称（和「我的」「管家」同构 ✓）+ 备注 ──────
  //
  // ★ 用户 2026-10-08 定的 ✓（原话见 `dispName` 上面那段 ✓）。
  //   备注**只影响显示** ✓、**对方不感知** ✓ —— 所以这一屏的措辞也得跟着这个来 ✓
  //   （不能写成"给他改个名字"✓，那听着像对方会知道 ✓）。
  const openPeer = (uid) => {
    if (uid == null) return;
    if (!$('#peer').classList.contains('on')) pushScreen('peer');
    renderPeer(uid);
  };
  const closePeer = () => popScreen('peer');

  const renderPeer = (uid) => {
    const body = $('#peerBody');
    const p = (members || []).find(m => Number(m.id) === Number(uid)) || {};
    const real = p.nickname || '这位';
    const cur = (notes && notes[String(uid)]) || '';
    body.textContent = '';

    // 卡片一：头像（**只读** ✓ —— 你不该能改别人的头像 ✓）
    const av = mkel('div', 'card avcard');
    const big = mkel('div', 'bigav');
    const circle = mkel('div', 'av');
    circle.style.cursor = 'default';        // 头像是别人的 → 不是按钮 ✓
    big.appendChild(circle);
    paintAvatar(circle, p.avatar, real);
    // ★ 头像下面那个名字要**大一点** ✗→✓（2026-10-09 用户：「头像下面的昵称字体大一些」✓）——
    //   原来借用的是 `.tip` ✓（12.5px 的灰色小字 ✓，那是"提示"的字号 ✗），
    //   而**名字**在别处（管家、我的）都是 19px/600 ✓ → 这里自己也起一个类 ✓（见 CSS ✓）。
    av.append(big, mkel('div', 'pname', real));
    body.appendChild(av);

    // 卡片二：备注
    const card = mkel('div', 'card');
    card.appendChild(mkel('label', null, '备注'));
    const ni = mkel('input', 'field');
    ni.maxLength = 24;
    ni.value = cur;
    // ★ 空的时候那句提示 ✓（2026-10-09 用户：「备注如果为空就提示：暂未设置备注」✓）
    //   ⚠️ 它同时是**输入框的占位** ✓ —— 有备注时框里就是那段备注 ✓，这句自然看不见 ✓。
    ni.placeholder = '暂未设置备注';
    card.appendChild(ni);
    // ⚠️ 这里原来有一句「只有你自己看得见 —— 他不会知道，管家也不会知道」✗→✓
    //    （2026-10-09 用户：「底下的"只有你自己看得见"去掉」✓）——
    //    那句话本身**还是真的** ✓（备注只改渲染出口 ✓，不进 prompt ✓，
    //    见 `dispName` 那一段 ✓），只是他不需要在这儿被念一遍 ✓。
    //    保存成功那句 toast 里还留着一半 ✓（一次性的 ✓，不占版面 ✓）。
    const err = mkel('div', 'err', '');
    const save = mkel('button', 'btn-save', '保存');
    save.onclick = async () => {
      save.disabled = true;
      try {
        const out = await api('/notes', {
          method: 'POST', body: JSON.stringify({ peer_id: Number(uid), note: ni.value }),
        });
        notes = notes || {};
        // 空 = 取消备注 ✓（服务端把那一行删了 ✓，这里也把它从本地表里去掉 ✓）
        if (out.note) notes[String(uid)] = out.note; else delete notes[String(uid)];
        closePeer();
        // ⚠️ **整屏重画一遍群聊** ✗→✓：备注决定每条消息**画什么名字** ✓，
        //    而已经画好的气泡不会自己变 ✓ —— 只重画那几条可惜（改哪几条不好算 ✓），
        //    整屏重来最简单 ✓（50 条而已 ✓，而且用户刚在另一屏上，看不见这一下 ✓）。
        rerenderMessages();
        toast(out.note ? '备注好了 —— 只有你看得见' : '备注取消了');
      } catch (e) { err.textContent = (e && e.message) || '没保存上'; }
      save.disabled = false;
    };
    card.append(err, save);
    body.appendChild(card);

    const swap = mkel('div', 'swap');
    const b = mkel('b', null, '返回');
    b.onclick = closePeer;
    swap.appendChild(b);
    body.appendChild(swap);
  };

  /** 把当前这一屏消息**按现在的备注重画一遍** ✓（备注一改就得用 ✓）。 */
  const rerenderMessages = () => {
    const box = $('#msgs');
    if (!box) return;
    const all = [..._msgs.values()].sort((a, b) => (a.id || 0) - (b.id || 0));
    box.innerHTML = '';
    all.forEach(m => addMsg(m));      // 走同一条渲染路 ✓（备注在 `dispName` 里 ✓）
    scrollDown(true);
  };

  // ── ★ 屏之间那一套手势（用户 2026-10-08 定的）─────────────────────────
  //
  // 用户原话：「(8)…这个界面叫[组件]，但是顶部没有任何字，左上角也没有任何按钮，
  //   回到群聊全靠右滑，目的:提供一个纯粹的界面供用户diy，不受限制」✓；
  //   以及「这两种页，都可以有个特殊的动作进入组件聊天页，那就是从上往下滑」✓。
  //
  // 所以三件事：
  //    主群聊 --左滑--> [组件收纳页] --点一下--> [单个组件页]
  //    回来**逐层右滑**（单个组件 → 收纳页 → 群聊 ✓，iOS 那种手感 ✓）
  //    **在任一个组件页往下拉** → 进它的那条对话 ✓
  //
  // ## 三条硬规矩（都是踩过才有的）
  //
  // ① **离屏幕边缘 24px 以内的起手不认** ✗ —— 安卓 10+ 的系统返回手势是
  //    "从左边缘往里滑" ✓，而且**系统抢在前面、网页根本收不到** ✓ →
  //    贴边起手的滑动不会到我们这儿 ✓，也不会误触 ✓。
  // ② **横向要明显压过纵向**（1.2 倍 ✓）—— 否则滚动列表会被吃掉 ✓。
  // ③ **只在这三屏开着的时候认** ✓（弹层/确认框/小卡片开着时不认 ✓，
  //    设置页那些屏也不认 ✓ —— 那是另一类导航 ✓，有它们自己的返回 ✓）。
  //
  // ⚠️ 这一版是**过阈值才触发** ✓（不看手指跟手 ✓）——
  //    更花的做法是整屏跟着手指走 ✓，那要 `transform` 实时跟手 + 松手判定 ✓，
  //    这一版先把"能进能出"做扎实 ✓（用户要的是这两条 ✓）。
  const SW_EDGE = 24;      // 边缘留给系统 ✓
  const SW_MIN2 = 10;      // 超过它才判方向 ✓
  //: 横滑（主群聊左滑进收纳页 ✓）：拉过这么多才算数 ✓。
  //: ★ **70 → 96**（2026-10-09 用户定的 ✓）—— 和下拉那条**同一个道理** ✓：
  //:   它现在也要**跟手出一条提示**（「继续左滑进入创意工坊」✓）✓，
  //:   所以这个数同时是"阈值"和"那根条走满格的行程" ✓。
  const SW_TRIG = 96;
  //: ★ 下拉：拉过这么多就进那条对话 ✓（2026-10-09）。
  //:   ⚠️ 比横滑那个**大一档** ✗→✓ —— 下拉是一根**要跟手**的手势 ✓：
  //:      从 0 拉到这个数，顶部那条提示才从"看不见"走到"看得见、并且变色" ✓
  //:      （见 `showPullHint` ✓）。给小了就是"手一动就跳进去" ✓，
  //:      用户根本没机会看见那行字 ✓ —— 而提示正是他点名要的 ✓。
  //:   ★ **96 → 144**（2026-10-09 用户上手试过之后定的 ✓）——
  //:      他要的是"**拉得足够靠下才进去**" ✓（手感他觉得已经对了 ✓，
  //:      所以只动这一个数 ✓，动画一个字没改 ✓）。
  //:      ⚠️ 这个值同时决定"提示条走到满格要拉多远" ✓ —— 它俩是同一个数 ✓，
  //:      改它同时改两件事（阈值 + 那根条的行程 ✓），别只按"阈值"想 ✓。
  const PULL_TRIG = 144;
  let pgSw = null;

  const _overlayOn = () =>
    ['#msgcard', '#sheet', '#modal'].some(s => $(s) && $(s).classList.contains('on'));

  //: 除了这三屏之外，**其余任何一屏开着就不认手势** ✓（用户 2026-10-09：
  //: 「[组件沙箱]界面，只有在主群聊时右滑才出现，不能到处出现」✓）。
  //:
  //: ⚠️ 原来这里只问"这三屏开没开" ✗ —— 而主群聊是**垫在所有屏底下**的 ✓
  //:    （打开设置页时它照样 `on` ✓）→ 于是在**设置页、我的、组件对话…**
  //:    上左滑也会把收纳页推上来 ✗✓（用户看到的就是"到处都能滑出来" ✓）。
  //:    判据改成"**最上面那一屏**是不是这三屏之一" ✓。
  const _OTHER_SCREENS = [
    '#settings', '#me', '#meAccount', '#space', '#peer', '#selfIntro',
    '#agent', '#agentEdit', '#diySet', '#wsNav', '#wsChat', '#login', '#init',
  ];

  const _whichScreen = () => {
    if (_OTHER_SCREENS.some(s => $(s) && $(s).classList.contains('on'))) return '';
    if ($('#compView').classList.contains('on')) return 'comp';
    if ($('#workshop').classList.contains('on')) return 'wall';
    if ($('#chat').classList.contains('on')) return 'chat';
    return '';
  };

  //: 收纳页**滚到顶了没有** ✓ —— 下拉那一条**只在顶上认** ✗→✓。
  //:   ⚠️ 不判的话，组件一多、列表滚到一半时往下一拉 ✗ →
  //:      本该是"往回滚" ✓ 却会一路把编辑页拉出来 ✓（滚都滚不动了 ✓）。
  //:   （`overscroll-behavior:contain` 让容器**不橡皮筋** ✓，所以 `scrollTop`
  //:     在顶上就是 0 ✓，判断很干净 ✓。）
  const _wallAtTop = () => {
    const b = $('#wsBody');
    return !b || b.scrollTop <= 0;
  };

  //: 顶部那条提示写什么 ✓ —— **按手势方向说各自的话** ✓
  //:   （用户 2026-10-09 定的原话：「继续左滑进入创意工坊」✓ /
  //:     「下滑以编辑该界面」/「下滑以编辑该组件」✓）。
  const _pullHintText = (dir) => {
    // ⚠️ **只回后半句** ✗→✓（2026-10-10 用户：「阈值未到时是"**继续**左滑/继续下滑…"，
    //   到了阈值后应该变成"**松开**…"」✓）—— 前半句由 `showPullHint` 按进度现拼 ✓。
    // ⚠️ 「下滑以编辑」里的那个「以」也去掉了 ✓（他的原话：「那个"以编辑"的以字去掉」✓）。
    if (dir === 'L') return '进入创意工坊';
    return _whichScreen() === 'comp' ? '编辑该组件' : '编辑该界面';
  };

  /** 顶部那条提示 —— **跟着手指浮现** ✓（`p` 0→1 就是"拉了多少" ✓）。
   *
   *  ⚠️ `trig` 要**跟着方向传** ✗→✓（2026-10-09：左滑那条也用它 ✓）——
   *    横滑是 96 ✓、下拉是 144 ✓，条子走到满格的行程得跟本方向一致 ✓
   *    （用死一个数的话：其中一个方向**永远到不了变色那一步** ✗，
   *      而"该松手了"正是靠变色告诉他的 ✓）。
   */
  const showPullHint = (tail, dist, trig, side) => {
    const el = $('#pullHint');
    if (!el) return;
    const p = Math.max(0, Math.min(1, (dist || 0) / (trig || PULL_TRIG)));
    if (!p) { hidePullHint(); return; }
    // ★ **两段文案** ✓（用户 2026-10-10 定的 ✓）：
    //   还差一点 → 「继续左滑 / 继续下滑 …」✓（在催他接着拉 ✓）
    //   拉够了   → 「松开 …」✓（在催他松手 ✓）
    //   ⚠️ 分界就是 `p >= 1` ✓ —— 而那根条**同一个点变蓝** ✓（见 `.ready` ✓）：
    //      "变色"和"换字"是**同一件事的两个说法** ✓，别只改一个 ✗。
    el.textContent = (p >= 1 ? '松开' : (side ? '继续左滑' : '继续下滑')) + tail;
    el.classList.toggle('side', !!side);      // ★ 竖排贴右边（横滑那条 ✓）
    el.style.opacity = String(p);
    if (side) {
      // 从**右边**滑进来 ✓ —— 它和手势是同一个方向 ✓（往左滑，条子从右往里走 ✓）
      el.style.transform = 'translate(' + ((1 - p) * 130) + '%, -50%)';
    } else {
      // 从上面"掉"下来 ✓ —— 往上收着的那一截随 `p` 归零 ✓
      el.style.transform = 'translate(-50%, ' + (-140 + p * 140) + '%)';
    }
    el.classList.toggle('ready', p >= 1);
  };
  const hidePullHint = () => {
    const el = $('#pullHint');
    if (!el) return;
    el.classList.remove('ready', 'side');
    el.style.opacity = '';
    el.style.transform = '';
  };

  document.addEventListener('touchstart', (ev) => {
    if (ev.touches.length !== 1) { pgSw = null; return; }
    if (_overlayOn()) { pgSw = null; return; }
    const x = ev.touches[0].clientX, y = ev.touches[0].clientY;
    // ① 贴边的滑动归系统 ✓
    if (x < SW_EDGE || x > window.innerWidth - SW_EDGE) { pgSw = null; return; }
    pgSw = { x0: x, y0: y, dir: '', d: 0 };
  }, { passive: true });

  document.addEventListener('touchmove', (ev) => {
    if (!pgSw) return;
    const p = ev.touches[0];
    const dx = p.clientX - pgSw.x0, dy = p.clientY - pgSw.y0;
    if (!pgSw.dir) {
      if (Math.abs(dx) < SW_MIN2 && Math.abs(dy) < SW_MIN2) return;
      // ② 方向要**明确**才认 ✓（斜着划不算 ✓）
      if (Math.abs(dx) > Math.abs(dy) * 1.2) pgSw.dir = dx < 0 ? 'L' : 'R';
      else if (Math.abs(dy) > Math.abs(dx) * 1.2) pgSw.dir = dy > 0 ? 'D' : 'U';
      else { pgSw = null; hidePullHint(); return; }
      // ③ 这一屏上这个方向有没有意义？没有就把手势丢掉 ✓（免得吃掉正常滚动 ✓）
      const s = _whichScreen();
      const ok = (pgSw.dir === 'L' && s === 'chat')
              || (pgSw.dir === 'R' && (s === 'wall' || s === 'comp'))
              || (pgSw.dir === 'D' && ((s === 'wall' && _wallAtTop()) || s === 'comp'));
      if (!ok) { pgSw = null; hidePullHint(); return; }
      // ★ **手里正拎着一个格子**（长按 ≥450ms 之后在拖动换位置 ✓）→ 别认下拉 ✗→✓
      //   （2026-10-09 想到的一个交界处 ✓）：不然"把一个格子往下拖"会
      //   **同时**被当成这条手势 ✓ —— 松手既换了位置 ✓、又把编辑页拉了出来 ✓
      //   （两件事都对 ✓，合在一起就没人说得清发生了什么 ✗）。
      //   ⚠️ 判方向发生在那一下"动"的时候 ✓：正常下拉在 450ms 之内就动了 ✓
      //      （那时 `wsDrag` 还是 null ✓ → 不受影响 ✓）；
      //      而"长按再拖"是**先按住不动 450ms** ✓ → 到它动的时候 `wsDrag` 已经在了 ✓。
      if (pgSw.dir === 'D' && wsDrag) { pgSw = null; hidePullHint(); return; }
      ev.preventDefault();      // ★ 认了之后**才**拦 ✓（早了会把滚动卡死 ✗）
    } else {
      ev.preventDefault();
    }
    pgSw.dx = dx;
    pgSw.dy = dy;
    // ★ 顶部那条提示**跟着手指出** ✓（见 `showPullHint` ✓）
    // ★ **左滑那条也要** ✗→✓（用户 2026-10-09：「从群聊主界面左滑进入组件界面时，
    //    也要有提示"继续左滑进入创意工坊"和滑入阈值」✓）。
    // ⚠️ `'R'`（右滑退出那两条）**不给** ✓ —— 用户没要 ✓，
    //    而且"退出"是往回走 ✓ 不需要一句"继续滑"来鼓励 ✓。
    if (pgSw.dir === 'D') showPullHint(_pullHintText('D'), dy, PULL_TRIG, false);
    else if (pgSw.dir === 'L') showPullHint(_pullHintText('L'), -dx, SW_TRIG, true);
  }, { passive: false });

  const _endSwipe = () => {
    const s = pgSw;
    pgSw = null;
    // ⚠️ **一进门就收掉那根条** ✗→✓ —— 它是"手上正在做的那件事"的一部分 ✓，
    //    松手那一刻就该没 ✓（留着会变成"我刚才是不是滑过头了"这个疑问 ✓）。
    //    原来只在 `'D'` 那条分支里收 ✓ → 左滑也加提示之后就会**留在屏幕上** ✗。
    hidePullHint();
    if (!s || !s.dir) return;
    if (s.dir === 'D') {
      if ((s.dy || 0) >= PULL_TRIG) openCompChat();
      return;
    }
    const far = Math.abs(s.dx || 0) >= SW_TRIG;
    if (!far) return;
    const scr = _whichScreen();
    if (s.dir === 'L' && scr === 'chat') { openWorkshop(); return; }
    if (s.dir === 'R' && scr === 'comp') { closeComp(); return; }
    if (s.dir === 'R' && scr === 'wall') { closeWorkshop(); return; }
  };
  document.addEventListener('touchend', _endSwipe);
  document.addEventListener('touchcancel', () => { pgSw = null; hidePullHint(); });

  /**
   * **下拉 → 进这条对话** ✓（收纳页和单个组件页都走这里 ✓）。
   *
   * 收纳页下拉 = 进**它自己**那条对话 ✓ —— 也就是「组件界面diy」✓
   * （`wall` 这个 slug ✓，它跟别的组件一样有对话 ✓，见 `routes_internal` 那段 ✓）。
   * ⚠️ 这一条是**写死**的 ✗（用户原话："可以将这个能力写死，因为这是和组件沙箱外部的
   *    创意工坊互通，不在用户可定义范围内"✓）—— 组件里面怎么自由都行 ✓，
   *    但这一个动作通到沙箱外面 ✓，所以由我们定 ✓。
   */
  const openCompChat = () => {
    const scr = _whichScreen();
    // ⚠️ **`'top'` = 从上面滑进来** ✓（用户 2026-10-09 定的："从上面滑入" ✓）——
    //    这个参数一路传到 `pushScreen` ✓，退场也会顺着它**往上收** ✓。
    if (scr === 'comp') {
      if (compCur) openTaskForSlug(compCur.slug, compCur.title, 'top');
      return;
    }
    if (scr === 'wall') openTaskForSlug(WALL_SLUG, '组件界面diy', 'top');
  };

  // ★ **组件里面往下拉**那一条（沙箱里听不到 ✓，由注入的小桥报信 ✓）
  //
  // ⚠️ 2026-10-09 改成**报进度** ✗→✓（原来只在"拉够了"的那一下报一嗓子 ✓）——
  //    用户要的是"顶部**慢慢**出现一个提示" ✓，那就必须**跟手** ✓，
  //    而跟手需要中间那些值 ✓（只报一个"成了"是画不出渐变来的 ✗）。
  //    所以小桥现在发三种信 ✓：`pull` 带 dy ✓ / `pullend` / `pullcancel` ✓。
  let _pullDy = 0;
  window.addEventListener('message', (ev) => {
    const d = ev && ev.data;
    if (!d || typeof d.lg !== 'string') return;
    if (_whichScreen() !== 'comp') return;   // 只在看组件的时候认 ✓
    if (d.lg === 'pull') {
      _pullDy = Number(d.dy) || 0;
      showPullHint('编辑该组件', _pullDy);      // 后半句 ✓，前半句它自己拼 ✓
      return;
    }
    if (d.lg === 'pullend') {
      const far = _pullDy >= PULL_TRIG;
      _pullDy = 0;
      hidePullHint();
      if (far) openCompChat();
      return;
    }
    if (d.lg === 'pullcancel') { _pullDy = 0; hidePullHint(); }
  });

  /** 改账号（用户名 / 密码）✓ —— 和「我的」同构的一屏 ✓。 */
  const _rb = $('#reloadBtn');
  if (_rb) _rb.onclick = () => location.reload();

  // ── 创意工坊（2026-10-07，右上角那个入口）────────────────────────────
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
  const applyWallCss = async () => {
    const old = $('#wall-diy');
    if (old) old.remove();
    try {
      const d = await api(`/wall-css?group_id=${group.id}`);
      if (!d || !d.css || !d.css.trim()) return;      // 没改过 → 默认样子 ✓
      const st = document.createElement('style');
      st.id = 'wall-diy';
      st.textContent = d.css;
      document.head.appendChild(st);
    } catch (e) {
      // 读不到就当没有自定义外观 ✓ —— 这一屏照常能用 ✓（别让外观把界面挡住 ✗）
    }
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

  /** 打开一个格子 ✓ —— 点一下就进**这个组件**那一屏 ✓。
   *
   *  ⚠️ 这里原来有一支 `if (c.slug === WALL_SLUG) openCompChat()` ✗→✓（2026-10-09）——
   *    「组件界面diy」那一格**不再画出来**了 ✓（用户：「组件收纳界面不要有
   *    组件界面diy这个图标和入口，它本身点进去不是一个独立组件」✓，
   *    它在服务端就被筛掉了 ✓，见 `main.py:_scan_components` ✓），
   *    所以这一支永远进不来 ✓ —— 留着是死代码 ✓（下一个人会照着它以为
   *    "收纳页上还有那一格" ✓）。**去那条对话现在是下拉** ✓（见 `openCompChat` ✓）。
   */
  const openCell = (c) => {
    if (!c) return;
    openComp(c.slug, c.title);
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
  const openComp = async (slug, title) => {
    const wrap = $('#compWrap');
    wrap.innerHTML = '';
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
    // ★ **沙箱外那侧的桥：下拉** ✗→✓（2026-10-08 用户定的 ✓）——
    //   用户原话：「这两种页，都可以有个特殊的动作进入组件聊天页，那就是从上往下滑，
    //   虽然这些组件展示完全自由，但是可以将这个能力写死，因为这是和组件沙箱外部的
    //   创意工坊互通，不在用户可定义范围内，先写死」✓。
    //
    //   ⚠️ 为什么必须**注入到 iframe 里** ✗：组件跑在 `sandbox="allow-scripts"`
    //      （**不透明源** ✓）里，它的触摸事件**传不到外面的页面** ✓ ——
    //      外面那层听不到"在组件里往下拉" ✗（`postMessage` 是通的 ✓，所以由它报信 ✓）。
    //   ⚠️ 只看**页面滚到顶了还继续往下拉** ✓ ——「滚动中往下拉」是正常滚动 ✓，
    //      不能拿它当手势 ✗（不然滚长组件就会一直触发 ✓）。
    //   ⚠️ 2026-10-09：它改成**一路报进度** ✗→✓（见下面那段 message 监听 ✓）——
    //      外面那条提示要跟着手指浮现 ✓，只报"拉够了"那一下是画不出渐变来的 ✓。
    //      仍然**只看"滚到顶了还继续往下拉"** ✓（滚动中往下拉是正常滚动 ✗）。
    //      ⚠️ 一旦里层滚起来了（`st>0`）就**撒手**（报 pullcancel ✓）——
    //         那是"他在滚组件" ✓，不是"他想编辑" ✓；不撒手的话，
    //         滚到一半手感会变得很怪 ✓（提示跟着乱闪 ✓）。
    const bridge = S
      + 'var _y0=null;'
      + 'var _say=function(o){try{parent.postMessage(o,"*")}catch(_){}};'
      + 'addEventListener("touchstart",function(e){'
      + '_y0=(e.touches.length===1)?e.touches[0].clientY:null;},{passive:true});'
      + 'addEventListener("touchmove",function(e){if(_y0===null)return;'
      + 'var st=(document.scrollingElement||document.documentElement).scrollTop;'
      + 'if(st>0){_y0=null;_say({lg:"pullcancel"});return;}'
      + 'var dy=e.touches[0].clientY-_y0;'
      + '_say({lg:"pull",dy:dy});},{passive:true});'
      + 'var _end=function(ok){if(_y0===null)return;_y0=null;'
      + '_say({lg:ok?"pullend":"pullcancel"});};'
      + 'addEventListener("touchend",function(){_end(true)});'
      + 'addEventListener("touchcancel",function(){_end(false)});'
      + E;
    const inject = S + `window.__LG_DATA__=${JSON.stringify(d.data)};` + E + bridge;
    const ifr = document.createElement('iframe');
    ifr.setAttribute('sandbox', 'allow-scripts');   // ★ 没有 allow-same-origin
    ifr.setAttribute('referrerpolicy', 'no-referrer');
    ifr.srcdoc = inject + (d.html || '');
    wrap.appendChild(ifr);

    // ★ 这一屏**到此为止** ✗→✓（2026-10-07 晚上用户定的）——
    //   「里面不要有任何的提示和设置选项，也不要有什么取消保留，继续改组件
    //     以及删除组件的功能，这样界面就被压缩了」✓。
    //   所以底下那一栏**整个删掉了** ✓（连同那一行 "v2 · 未固化" 的事实行 ✓ ——
    //   它也是"信息"，用户要的是压缩 ✓）。那些动作全在工坊里 ✓。
    //
    //   ★ 去那条对话的入口，2026-10-08 改成**下拉** ✓（原来顶上有个气泡图标 ✓，
    //     而这一屏现在一个 chrome 都没有 ✓）——
    //     拉下去由上面那段桥报信回来 ✓，落到 `openTaskForSlug` ✓。
    //   ⚠️ 它**带的是 slug，不是 task_id** ✓ —— 因为从这一屏进来时
    //     "我有没有为它开过对话"这件事前端并不知道 ✓，
    //     交给 `openTaskForSlug` 去查/去开 ✓（见下 ✓）。
  };

  //: 当前正在看的那个组件 ✓（下拉进对话要用它的 slug ✓）
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
                  streaming: null, seen: {}, tasks: [] };

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
    //    现在：**名字优先** ✓ —— 有名字就写名字 ✓，没名字才退回"做一个新的" ✓。
    t.textContent = wsCur.task
      ? (wsCur.title || wsCur.slug || '做一个新的')
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
    if (more) more.style.visibility = isWall ? 'hidden' : '';
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
  const paintDiyAvatar = () => {
    const url = wsCur.assistant.avatar || '';
    const ch = (wsCur.assistant.name || '助').slice(0, 1);
    [$('#wsDiyAv'), $('#diyAv')].forEach(el => {
      if (el) paintZhi(el, url, ch);
    });
  };

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
    if (!$('#wsChat').classList.contains('on')) pushScreen('wsChat', from);
    try {
      const d = await api(`/workshop/${group.id}/tasks/${tid}/open`, { method: 'POST' });
      showTask(d);
    } catch (e) {
      toast('这条对话打不开：' + e.message);
      closeWsChat();
    }
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
  const openTaskForSlug = async (slug, title, from) => {
    // ★ 2026-10-09：**不再动底下那两屏** ✗→✓ ——
    //   原来这里先把组件页关掉（`closeComp` ✓）、再把导航屏补上（`pushScreen('wsNav')`✓），
    //   因为"从组件页进聊天"时**聊天必须压在组件页上面** ✓，而当时 `#compView`(26)
    //   比 `#wsChat`(25) **高** ✗ → 只能先关掉它 ✓。
    //   ⚠️ 用户这一轮改了规矩：「在具体组件内时…下滑进入各自组件的编辑页，
    //      **且返回时回到各自组件**」✓ —— 那么组件页就**必须一直开着** ✓
    //      （关掉它，"返回回到各自组件"就无从谈起 ✗）。
    //      z-index 已经把它理顺了（28 > 26 ✓，见 CSS 那段）→
    //      这一屏现在只做一件事：**把那条对话（我自己的）找出来、打开** ✓。
    //      返回落到哪一屏，由"底下原来是什么"决定 ✓ —— 那正是用户要的 ✓。
    await wsReloadTasks();
    const mine = wsCur.tasks.find(x => x.slug === slug);
    if (mine) { await openTaskById(mine.id, from); return; }
    // ⚠️ 新开的那条**名字也是对的** ✓ —— 服务端在 `_my_tasks` 里会给它
    //    兜上"那个组件现在的标题" ✓（不然顶上会写着个英文 slug ✓，很难认 ✓）。
    if (await wsNewTask(slug)) pushScreen('wsChat', from);
  };

  /** 开一条新的 ✓（只置状态，不推屏 ✓ —— 推屏由调用方决定 ✓）。返回成没成 ✓。 */
  const wsNewTask = async (slug, title) => {
    try {
      const t = await api(`/workshop/${group.id}/tasks`, {
        method: 'POST',
        body: JSON.stringify({ slug: slug || '', title: title || '' }),
      });
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
      //   （见 `openTaskForSlug` 那段）→ 不挪过来的话，气泡上那个名字和头像
      //   会一直是**默认的**「diy 小助手」✓（改了名也不变 ✓ —— 而那看起来
      //   像"改了没保存" ✓）。
      if (d.assistant) wsCur.assistant = d.assistant;
      wsCur.editing = d.editing || {};
      paintDiyAvatar();
      return d;
    } catch (e) { return null; }   // 拉不到不影响正在看的这一条 ✓
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

  /**
   * ★ **群聊右上角那个按钮** ✓ —— 2026-10-09 改成**直接进"新建组件"的对话** ✗→✓。
   *
   *   用户原话：「主群聊右上角的按钮进入的不再是导航页，而是新建组件的聊天界面，
   *   如果在这个界面没有做出组件，下次点击**自动进去上次没生成组件的聊天**，
   *   一旦建立了组件，退出下次进入时就是新建组件的界面，这样省去了导航界面的麻烦」✓。
   *
   *   ⚠️ **"上次没生成组件的那条"是服务端算的** ✗→✓（`updated_at` 最近的那条、
   *      且**还没做出组件** ✓）—— 不放 localStorage ✓（壳里的存储会被清 ✓、
   *      换手机就没了 ✓，而这件事本来就该跟着人走 ✓）。
   *   ⚠️ 判断"没有组件"用的是 `t.slug` **空** ✓ —— 那是服务端在 `_my_tasks`
   *      里算好的 ✓（`workshop_tasks.slug` + 它做出来的组件的 slug ✓）。
   *      ⚠️ 「组件界面diy」那条**不算** ✓（它的 slug 是 `wall` ✓，非空 ✓）。
   *   ⚠️ 最多只会有**一条**这样的对话 ✓ —— 因为每次进来都**续着那条** ✓，
   *      不会再开第二条 ✓（老数据可能留了几条，那些够不着了；无所谓 ✓）。
   */
  const openNewCompChat = async () => {
    await wsReloadTasks();
    const unfinished = wsCur.tasks.find(t => !t.slug);
    if (unfinished) {
      // 续上上次那条 ✓，并且**在屏幕正中短暂说一句** ✗→✓（用户 2026-10-09 原话：
      //   「上次进去没做组件就退，则直接进上次，进入后在界面居中一个小卡片短暂提醒，
      //     **上次退出时未做出组件，已自动恢复**」✓）。
      // ⚠️ 那句话是**提醒他去哪儿了** ✓ —— 不然他按了右上角、突然进到一条
      //    上次的半成品里 ✓，会以为"怎么又回来了" ✓。
      await openTaskById(unfinished.id, 'corner');
      // ⚠️ **时间短一点** ✗→✓（2026-10-10 用户：「如果触发恢复，其提示小卡片
      //   时间短一些」✓；给了 2000 之后他又说「1s 吧」✓ → **1000ms** ✓。
      //   ⚠️ 这条只剩一秒，但该有的信息还在 ✓（它就是「我刚才替你续上了」✓）；
      //      再短就来不及读了 ✗，别改到几百毫秒去 ✓。
      showNotice('上次退出时未做出组件，已自动恢复', 1000);
      return;
    }
    // ★ **新的那条：先起个名字再进去** ✗→✓（用户 2026-10-09 定的：
    //   「如果是新进入，会弹出界面**先起个名字**再进去新的组件聊天」✓）。
    //   ⚠️ 上一轮我把它去掉了 ✗（当时按"少一步"理解的 ✓）—— 他这一版明确要它 ✓。
    //   名字**不是白问的** ✓：它一路走到 `component_save`（以他起的为准 ✓），
    //   也是这条对话的标题 ✓。⚠️ 起名那个弹层**是异步的** ✓ ——
    //   "进哪条对话"要在 `save` 回调里做 ✓，别在这儿写（那时名字还没有 ✓）。
    // ★ 措辞照用户 2026-10-10 的原话 ✓（他看截图说的两张字 ✓）：
    //   抬头「打算做个啥组件？」✓、小字「随便起个名字就行，后面随时可以改」✓。
    //   ⚠️ 他要的那句问的是「**做个啥**」✓ —— 比原来那句「它叫什么？」更贴
    //      "这是新建那条路" ✓（改名那条路走的是另一处 ✓，抬头是「重命名」✓）。
    //   ⚠️ 老的导航屏里**还留着一份旧措辞** ✓（那一屏没有入口 ✓，
    //      回头清理时一起带走就行 ✓ —— 别为了它把这里抄两份 ✗）。
    openNameSheet({
      heading: '打算做个啥组件？',
      initial: '',
      cta: '开始做',
      hint: '随便起个名字就行，后面随时可以改',
      save: async (name) => {
        // ⚠️ **先把弹层收掉，再开对话** ✗→✓ —— 弹层是 50 档 ✓、聊天屏才 28 ✓，
        //    不收的话它**压在聊天上面** ✓，那条"从右上角弹出"的动效
        //    会被它挡个正着 ✓（用户点名要这个动效 ✓，那就别让它白播 ✓）。
        //    两个动画同时跑（弹层往下收 + 对话从右上角进 ✓）本来就自然 ✓。
        closeSheet();
        if (await wsNewTask('', name)) pushScreen('wsChat', 'corner');
      },
    });
  };

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

  const fillBubble = (el, text) => {
    el.textContent = '';
    const lines = String(text == null ? '' : text).split('\n');
    lines.forEach((line, i) => {
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

  /** 气泡里那块引用条 ✓ —— 和群聊那份**同一套 class** ✓（`.quote` ✓）。 */
  const buildWsQuoteEl = (q) => {
    const el = document.createElement('div');
    el.className = 'quote';
    const who = document.createElement('div'); who.className = 'qwho';
    who.textContent = q.sender_type === 'agent'
      ? (wsCur.assistant.name || 'diy 小助手') : '你';
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
    $('#wsQwho').textContent = wsQuote.sender_type === 'agent'
      ? (wsCur.assistant.name || 'diy 小助手') : '你';
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
    const mine = m.sender_type === 'user';
    // ⚠️ 长按要回头找这条消息的完整信息 ✓（引用用 ✓）—— 和群聊那边同一张表 ✓。
    if (m && m.id != null) _wsById.set(m.id, m);
    const row = document.createElement('div');
    row.className = 'mkrow ' + (mine ? 'mine' : 'agent');
    if (m && m.id != null) row.dataset.id = String(m.id);
    // ★ 头像（2026-10-07 深夜 ✓）—— 用户定的「组件聊天界面也需要有用户区别」✓。
    //   你那边用**你自己的头像** ✓（和群聊里同一张 ✓，一眼认得出是自己 ✓）；
    //   它那边用小助手那张 ✓（没设就是一个首字 ✓）。
    const av = document.createElement('div');
    av.className = 'av';
    if (mine) paintZhi(av, shellURL(me && me.avatar), (me && me.nickname) || '我');
    else paintZhi(av, wsCur.assistant.avatar, wsCur.assistant.name || '助');
    // ★ **点头像进详情** ✗→✓（用户定的："比如点击头像进入详情啊"✓）——
    //   和群聊那边**同一条去向** ✓：它 → **小助手的设置** ✓（名字头像都在这儿改 ✓）；
    //   你 → 回壳的「我的」 ✓（那才是"你自己的详情" ✓，这儿没有第二份 ✓）。
    // ⚠️ 回壳时**要带上 `'wsChat'`** ✗→✓（2026-10-08）—— 带上了，
    //   从「我的」按返回才会**回到这条对话** ✓；不带的话回的是群聊首页 ✗
    //   （用户原话："点击自己头像进入我的，但是返回的却是生活管家聊天界面"✓）。
    av.onclick = (ev) => {
      ev.stopPropagation();
      if (mine) openMe(); else openDiySet();
    };
    const wrap = document.createElement('div');
    wrap.className = 'wrap2';
    if (!mine) {
      // ⚠️ 名字**只挂在它那边** ✓ —— 你的名字你自己知道 ✓，
      //    而**它叫什么随时能改** ✓（改了要立刻看得见 ✓）。
      const who = document.createElement('div');
      who.className = 'who';
      who.textContent = wsCur.assistant.name || 'diy 小助手';
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

  // ── 长按消息 → 同一张小卡片 ✓（2026-10-08 改）────────────────────────
  //
  // ★ 原来这边也是"左右滑引用" ✓（和群聊同一套判据 ✓）。现在两处一起改成
  //   **长按弹小卡片** ✓（用户定的形状 ✓，见群聊那边那一大段 ✓）。
  //
  // ⚠️ **这边照旧不做 @** ✗ —— 原来的理由还在 ✓：这里只有你和助手两个人 ✓，
  //    @ 谁都是它 ✓，做了只会往输入框塞一个没意义的例子 ✓。
  //    现在长按**空出来了** ✓，但空着是对的 ✓（卡片里那两项就是这边要的全部 ✓）。
  $('#wsMsgs').addEventListener('touchstart', (ev) => {
    const row = ev.target.closest && ev.target.closest('.mkrow[data-id]');
    if (!row) return;
    cancelPress();
    pressFired = false;
    pressTimer = setTimeout(() => {
      pressTimer = null;
      pressFired = true;
      openMsgCard(row, {
        get: (r) => _wsById.get(Number(r.dataset.id)),
        quote: (m) => { wsQuote = m; setWsQuoteBar(); $('#wsText').focus(); },
      });
    }, PRESS_MS);
  }, { passive: true });
  $('#wsMsgs').addEventListener('touchmove', cancelPress, { passive: true });
  $('#wsMsgs').addEventListener('touchend', cancelPress);
  $('#wsMsgs').addEventListener('touchcancel', cancelPress);
  $('#wsMsgs').addEventListener('scroll', closeMsgCard, { passive: true });

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
    // ★ **「组件界面diy」那条没有 ⋯** ✗→✓（2026-10-09 用户定的：
    //   「组件界面diy的界面，没有右上角三个点，没有重命名，没有删除组件，
    //    啥都没有，默认不可编辑，只能编辑界面」✓）。
    //   按钮已经藏了 ✓（见 `setWsHead` ✓），这一句是**防"从别处按到它"** ✓
    //   （它是个 async 函数 ✓，将来多一条调用点也不会漏 ✓）。
    if (wsCur.slug === WALL_SLUG) return;
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
    //   现在这个菜单就**两件事**：重命名 ✓、删除 ✓（用户点名的那两件 ✓）。
    if (t && t.slug) {
      mk('重命名', () => openRenameSheet(t.slug, t.title || ''));
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
    } else {
      // ★ **还没做出组件的也能改名** ✗→✓（2026-10-07 深夜，用户问的：
      //   「还没做出组件为啥连重命名都没有」✓）。
      //   ⚠️ 走的是**另一个接口** ✓：名字这时候住在**对话**上 ✓
      //      （`workshop_tasks.title` ✓ —— 就是他开做时起的那个 ✓），
      //      组件那行的名字要等它真的做出来才存在 ✓（`components.title` ✓）。
      //      同名的两件事、分两个阶段 ✓，所以两个都要能改 ✓。
      mk('重命名', () => openNameSheet({
        heading: '重命名',
        initial: (t && t.title) || '',
        cta: '保存',
        save: async (name) => {
          const r = await api(`/workshop/${group.id}/tasks/${wsCur.task}/title`,
                              { method: 'PATCH', body: JSON.stringify({ title: name }) });
          wsCur.title = (r.task && r.task.title) || name;
          setWsHead();
          await wsReloadTasks();
          toast('改好了');
        },
      }));
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
    paintDiyAvatar();
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
        paintDiyAvatar();
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
    paintDiyAvatar();
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
  // ★ diy 小助手：导航右上角那颗头像 → 设置屏 ✓（用户 2026-10-07 深夜定的 ✓）
  $('#wsDiy').onclick = openDiySet;
  $('#diyBack').onclick = closeDiySet;
  $('#wsBack').onclick = closeWsChat;
  // ⚠️ ⋯ **自己会先刷一次列表** ✗→✓ —— 菜单上"保留这一版（v几）"那几个字
  //    是从列表里算出来的 ✓：刚做完一个组件、还没刷的话，它会显示**上一版**的号 ✓
  //    （"我明明刚做完 v3，它说我保留的是 v2" ✓ —— 那是很难说得清的一种错 ✓）。
  $('#wsMore').onclick = openWsMenu;
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