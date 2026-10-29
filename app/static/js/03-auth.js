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
      // ⚠️ 登录成功 = 可能换了人 ✓ → 本机那份"上次的样子"作废 ✓，
      //    这一趟照常等网络（就慢这一次 ✓），别把上一个人的聊天闪出来 ✓。
      _clearBoot();
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

  // ★ **上一次的样子先画出来** ✓ —— 2026-10-20。
  //
  //   用户报的："短时间挂后台回来很顺；挂久了回来，界面先很快出来一下、
  //   然后黑一次、又加载出来。" 服务端日志里那一次是**整页重新载入** ✓
  //   （`GET /` + app.js + bootstrap 一整套 ✓）—— 这是安卓壳/系统那边的决定 ✓，
  //   网页拦不住 ✗。但网页能决定**这趟重新载入看起来黑多久** ✓：
  //   原来要等 `/bootstrap` 从（刚醒的）WireGuard 上回来才画第一帧 ✓，
  //   那段时间页面只有夜阑的深色底 ✓ = 他说的"黑一下" ✓。
  //
  //   现在每次 bootstrap 成功就把那份存本机 ✓；下次开页**同步**先画出来 ✓
  //   （localStorage 读 + 渲染 50 条，几十毫秒 ✓），网络那份回来再覆盖 ✓。
  //   → 黑屏的长度从"等一个来回"缩到"等脚本自己跑完" ✓。
  //
  //   ⚠️ 只存**这个人已经看过的群聊内容** ✓ —— 同一台手机自己的 localStorage ✓。
  //   ⚠️ 登出 / 登录成功时清掉 ✓（`logout()` 和 `doLogin()` 里各一句 ✓），
  //      免得换账号时先闪出上一个人的聊天 ✓。
  //   ⚠️ 30 天没开过就作废 ✓ —— 太久以前的样子顶上来反而容易让人误会 ✓。
  const BOOT_CACHE = 'lg_boot_v1';
  let bootCacheUsed = false;

  const _clearBoot = () => {
    try { localStorage.removeItem(BOOT_CACHE); } catch (e) {}
  };

  const _saveBoot = (b) => {
    try {
      if (!b || !b.group) { _clearBoot(); return; }   // 没空间 → 不留旧的了 ✓
      localStorage.setItem(BOOT_CACHE, JSON.stringify({
        at: Date.now(),
        me: b.me,
        group: b.group,
        members: b.members || [],
        notes: b.notes || {},
        messages: (b.messages || []).slice(-50),
      }));
    } catch (e) {}   // 存不下就存不下 ✓ —— 绝不能因此进不了 App ✓
  };

  const _loadBoot = () => {
    try {
      const raw = localStorage.getItem(BOOT_CACHE);
      if (!raw) return null;
      const c = JSON.parse(raw);
      if (!c || !c.me || !c.group) return null;
      if (Date.now() - (Number(c.at) || 0) > 30 * 24 * 3600 * 1000) return null;
      return c;
    } catch (e) { return null; }
  };

  /** 把缓存那一份**照真入口的同一个顺序**画出来 ✓ —— 不联网、不连 WS ✓ */
  const _paintBoot = (c) => {
    me = c.me;
    syncThemeForUser();
    // ⚠️ 这里**没有** `syncBubbleForUser` 了 ✓（2026-10-27）——
    //    气泡不再存在本机 ✓，它跟着 `members` / `group` 一起下来 ✓，
    //    开页第一帧由 `addMsg` 里的 `setRowBubble` 直接画对 ✓。
    notes = c.notes || {};
    group = c.group;
    members = Array.isArray(c.members) ? c.members : [];
    renderHeader();
    $('#msgs').innerHTML = '';
    show('chat', 'fade');
    tellNative('chat');
    const first = Array.isArray(c.messages) ? c.messages : [];
    first.forEach(m => addMsg(m));
    oldestId = first.length ? first[0].id : 0;
    historyDone = first.length < 50;
    scrollDown(true);
    normalizeStatus();
    // ⚠️ 这里**不调 `renderSettings()`** ✓ —— 它顺手会发
    //    `refreshSpaceInfo()`（一趟网络 ✓），而设置屏这会儿根本看不见 ✓；
    //    真入口那一趟回来会调它 ✓。少这一下，第一帧更快 ✓。
  };

  const enterApp = async () => {
    // ★ **先用本机上一次的样子顶上** ✓（只在本页第一次进时用 ✓）
    //   后面的网络那一趟照旧 ✓ —— 它回来会把这些覆盖成最新的 ✓。
    if (!bootCacheUsed) {
      bootCacheUsed = true;
      const c = _loadBoot();
      if (c) { try { _paintBoot(c); } catch (e) {} }
    }
    // ★ **一趟拿齐。** 原来是 /auth/me → /groups → /members → /messages
    //   **连着四趟**，每趟都要过 WireGuard —— 开 App 时那片"黑屏"就是它 ✗
    //   现在一次往返搞定（服务端 /bootstrap 把四样一起给）。
    // 注意路径：这个接口注册在 groups 那个 router 下（它要复用群那套查询），
    // 前缀是 /api/groups —— 所以是 /api/groups/bootstrap，不是 /api/bootstrap ✗
    let b;
    try {
      // ★ 2026-10-23：**这趟必须有超时** ✓ —— 它是开屏唯一的必经之路 ✓，
      //   网络栈卡住时它不返回 = 加载页永远转 ✓（用户报的那条 ✓）。
      //   7 秒远大于正常耗时（本机/隧道都是几十毫秒 ✓）✓。
      b = await api('/groups/bootstrap?limit=50', { timeout: 7000 });
    } catch (e) {
      // 票已经没了 → 本机那份也不该再露 ✓（下一次开页别再顶出来 ✓）
      if (e && e.status === 401) _clearBoot();
      throw e;
    }
    _saveBoot(b);
    me = b.me;
    // ★ 知道是谁了，才能取"这个人自己选的主题" ✓（存在本机、按用户 id 分开 ✓）。
    syncThemeForUser();
    // ⚠️ 气泡**不走本机** ✓（2026-10-27）：`b.me.bubble` / `members[].bubble` /
    //    `group.agent_bubble` 都在这一趟里 ✓，`addMsg` 直接按它们画 ✓。
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
      // ★ 加载页：这一屏是同步画好的 ✓（没有图要等 ✓）→ 走最短 0.5s 后撤 ✓
      _bootReady();
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
    // ⚠️ 2026-10-29：这里原来有一句 `preloadWallCss()` ✓（给小屋预热外观 ✓）——
    //    小屋整屏下线了 ✓，那段 CSS 现在**没有任何屏会用到** ✓ →
    //    删掉这次请求 ✓（开屏少一趟，且不会再往头上挂没用的样式 ✓）。
    // ★ 2026-10-20：**加载页要等这一屏真的"能看"** 再撤 ✓ ——
    //   · 聊天背景图：取到 / 缩好 / **解码完** ✓（`ensureChatBackground` 会复用
    //     缓存那一趟已经发起的请求 ✓，不会重拉 ✓）
    //   · 字体：本机字体几乎立刻 ready ✓，等它只是防"字重先跳一下" ✓
    //   之后再 `_bootReady()` —— 它会再等两帧 + 补足最短 0.5s ✓。
    //   ⚠️ **消息图片不在这里等** ✗：历史里可能有一堆图 ✓，逐张等会把开屏拖到
    //      不可控 ✓；它们本来就是滚到才加载的（`loading=lazy` ✓），不属于
    //      "第一眼就该完整"的那部分 ✓。
    //   ★ 2026-10-23：这两样原来都是**无上限地等** ✗ —— 背景图那趟走
    //     IndexedDB + 网络 + 解码 ✓，任何一环卡住都能把开屏永远按住 ✓。
    //     现在给它们上盖：**等不到就先开 ✓**，背景图回来后再铺上 ✓
    //     （晚铺一下，好过对着加载页 ✓）。
    try { await _within(ensureChatBackground(), 3000); } catch (e) {}
    try {
      if (document.fonts && document.fonts.ready) await _within(document.fonts.ready, 1500);
    } catch (e) {}
    _bootReady();
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

  // ★ 背景图的**本机缓存** ✓ —— 2026-10-20。
  //   服务端那条 `/api/groups/{id}/background/file` 已经带 `?v=` + `immutable` ✓，
  //   但安卓 WebView 的 HTTP 缓存**不保证跨重启还在** ✗ → 每次重进都要
  //   重新走 WireGuard 把那张大图拉一遍 ✓ → 慢 ✓。所以自己在本机存一份原图 ✓。
  //
  //   ⚠️ 用的是 **IndexedDB**，不是 **Cache API** ✓ —— 这条是重点：
  //      `caches` 只在**安全上下文**里存在 ✓（HTTPS / localhost ✓），
  //      而 App 走的是 `http://10.66.66.1:8730` ✓ —— 明文 HTTP + 非 localhost
  //      → 手机 WebView 里 `window.caches` 是 **undefined** ✗
  //      → 上一版（Cache API）实际上**一次都没缓存过** ✓，每次都在重拉 ✓。
  //      IndexedDB 没有这个限制 ✓，http origin 照样能用 ✓。
  //
  //   地址带版本号 ✓ → 换图必然换 key ✓ → 缓存自动失效 ✓；同一个群只留最新
  //   一个版本 ✓（`_bgPut` 里顺手清旧 key ✓，不然每换一次图就多压一份十几 MB ✓）。
  //   ⚠️ 任何一步失败 → 退回挂网络地址 ✓，**绝不因为缓存坏掉就把背景弄没** ✗。
  let bgObjUrl = null;       // 当前贴上的那张的 blob: URL（换图前 revoke ✓）
  let bgKey = null;          // 当前已贴上的版本地址（同一张不重贴 ✓）
  let bgPending = null;      // 正在取的那张（开屏时 renderHeader 会连着调好几次 ✓，
                             //   不挡的话同一张会并发拉两遍 ✓）

  const _bgDb = (() => {
    let p = null;
    return () => {
      if (!window.indexedDB) return Promise.reject(new Error('no idb'));
      if (!p) {
        p = new Promise((res, rej) => {
          const r = indexedDB.open('lg-bg', 1);
          r.onupgradeneeded = () => {
            const db = r.result;
            if (!db.objectStoreNames.contains('img')) db.createObjectStore('img');
          };
          r.onsuccess = () => res(r.result);
          r.onerror = () => { p = null; rej(r.error); };
        });
        p.catch(() => {});       // 别让它在没人接的时候变成 unhandled rejection ✓
      }
      return p;
    };
  })();

  /** 读一条本机缓存 ✓ —— 没有就是 null ✓。 */
  const _bgGet = async (key) => {
    const db = await _bgDb();
    return new Promise((res, rej) => {
      const q = db.transaction('img', 'readonly').objectStore('img').get(key);
      q.onsuccess = () => res(q.result || null);
      q.onerror = () => rej(q.error);
    });
  };

  /** 存一条本机缓存 ✓，顺手把**这个群**的旧版本清掉 ✓（换图后的残骸 ✓）。
   *  key 形如 `/api/groups/5/background/file?v=123` ✓。 */
  const _bgPut = async (key, blob) => {
    const db = await _bgDb();
    await new Promise((res, rej) => {
      const tx = db.transaction('img', 'readwrite');
      tx.objectStore('img').put(blob, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
    try {
      const base = key.split('?')[0];
      const tx = db.transaction('img', 'readwrite');
      const st = tx.objectStore('img');
      const q = st.getAllKeys();
      q.onsuccess = () => {
        for (const k of q.result) {
          if (k !== key && String(k).split('?')[0] === base) st.delete(k);
        }
      };
    } catch (e) {}
  };

  /** 读一张图的宽高 ✓ —— 只解析文件头 ✓，不把几千万像素解进内存 ✓。
   *  认 jpeg / png（背景图基本就这两种 ✓）；认不出来返回 null ✓。 */
  const _imgSize = async (blob) => {
    try {
      const b = new DataView(await blob.slice(0, 65536).arrayBuffer());
      if (b.byteLength >= 24 && b.getUint32(0) === 0x89504e47) {       // PNG
        return { w: b.getUint32(16), h: b.getUint32(20) };
      }
      if (b.byteLength >= 4 && b.getUint16(0) === 0xffd8) {            // JPEG
        let i = 2;
        while (i + 9 < b.byteLength) {
          if (b.getUint8(i) !== 0xFF) { i++; continue; }
          const m = b.getUint8(i + 1);
          if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
          const len = b.getUint16(i + 2);
          if (len < 2) return null;
          if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
            return { w: b.getUint16(i + 7), h: b.getUint16(i + 5) };
          }
          i += 2 + len;
        }
      }
    } catch (e) {}
    return null;
  };

  /** 让一张图**先解码好**再交给 CSS ✓ —— 2026-10-20。
   *
   *  背景图挂在 `#chat` 的 `background-image` 上时 ✓，浏览器是**画到那一帧才解码** ✓；
   *  解码 2000px 的图也要几十毫秒 ✓，而这段时间正好落在"加载页撤掉"那一刻 ✓ →
   *  用户看到的还是"背景晚一步才铺上来" ✓。先拿 `<img>` 预热一遍 ✓，
   *  CSS 再拿到同一张 blob URL 时就直接命中已解码的那份 ✓。
   *
   *  ⚠️ **绝不 reject、也绝不无限等** ✗：图坏了 / 解码慢，最多等 4 秒 ✓ ——
   *     一张背景图不该把开屏永久卡住 ✓（退回 CSS 自己解码即可 ✓）。
   */
  const _decodeImg = (url) => new Promise((res) => {
    let done = false;
    const fin = () => { if (!done) { done = true; res(); } };
    try {
      const im = new Image();
      im.onload = fin;
      im.onerror = fin;
      im.src = url;
      if (im.decode) im.decode().then(fin, fin);
      setTimeout(fin, 4000);
    } catch (e) { fin(); }
  });

  /** 背景图**只留手机用得上那么大** ✓ —— 2026-10-20。
   *
   *  现在这张是 7469×5265（约 3900 万像素、5.6MB）✓。每次重进都要解码一遍 ✓；
   *  后台挂久了、安卓把 WebView 的渲染进程收掉之后 ✓，回来的第一帧就得重新解码 ✓
   *  —— 那一瞬就是他看到的"先黑一下" ✓。缩到长边 2000 之后解码量只剩约 1/14 ✓，
   *  存进 IndexedDB 的也从 5.6MB 变成几百 KB ✓。
   *
   *  ⚠️ **不动服务端那张原图** ✗ —— 这里只换这台手机上的缓存副本 ✓
   *    （服务端没有图像库 ✓；他要是想在别处用原图，原图也还在 ✓）。
   *  ⚠️ 失败 / 不支持就**原样返回** ✓ —— 绝不能因为缩图把背景弄没 ✓。
   */
  const _shrinkBg = async (blob) => {
    try {
      if (!blob || blob.size < 700 * 1024) return blob;   // 已经够小 ✓
      if (blob.type === 'image/gif') return blob;         // 动图不碰 ✓
      if (typeof createImageBitmap !== 'function') return blob;
      const dim = await _imgSize(blob);
      if (!dim || !dim.w || !dim.h) return blob;
      const k = Math.min(1, 2000 / Math.max(dim.w, dim.h));
      if (k >= 0.98) return blob;
      const w = Math.max(1, Math.round(dim.w * k));
      const h = Math.max(1, Math.round(dim.h * k));
      const bmp = await createImageBitmap(blob, {
        resizeWidth: w, resizeHeight: h, resizeQuality: 'high',
      });
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
      try { bmp.close(); } catch (e) {}
      const out = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.85));
      return (out && out.size && out.size < blob.size) ? out : blob;
    } catch (e) {
      return blob;
    }
  };

  /** 把一个版本地址**变成 blob: URL** ✓ —— 命中本机缓存秒回 ✓；
   *  没命中就现取、缩一版再存 ✓。取不到返回 null ✓（调用方退回网络地址 ✓）。 */
  const _materializeBg = async (url) => {
    try {
      let hit = await _bgGet(url);
      if (hit) {
        // 老缓存里可能还躺着那张原图 ✓ → 这次顺手换小 ✓，下次开页就轻了 ✓
        // ⚠️ **按尺寸判断** ✓，不按大小 ✗ —— 2000px 的图也可能有 800KB ✓，
        //    按大小判会每次开页都白缩一遍 ✓。
        if (hit.size > 700 * 1024) {
          const dim = await _imgSize(hit);
          if (dim && Math.max(dim.w, dim.h) > 2000) {
            const small = await _shrinkBg(hit);
            if (small && small !== hit) {
              try { await _bgPut(url, small); } catch (e) {}
              hit = small;
            }
          }
        }
        // ★ 先解码 ✓ —— 加载页要等的正是"这张图能立刻画出来" ✓（见 `_decodeImg` ✓）
        const made = URL.createObjectURL(hit);
        await _decodeImg(made);
        return made;                     // ★ 不上网 ✓
      }
    } catch (e) {}
    try {
      const r = await fetch(url, { credentials: 'same-origin' });
      if (!r.ok) return null;
      const blob = await _shrinkBg(await r.blob());
      try { await _bgPut(url, blob); } catch (e) {}
      const made = URL.createObjectURL(blob);
      await _decodeImg(made);
      return made;
    } catch (e) { return null; }
  };

  /** 把这个空间的背景贴到主群聊上 ✓（没有就摘掉 ✓）。
   *
   *  ⚠️ 只改 `#chat` 上的一个 class + 一个 CSS 变量 ✓ —— **不重建节点** ✓
   *    （换背景时消息列表不该闪一下 ✓）。
   *  ⚠️ 地址**只认服务端给的** `group.background` ✓（它带版本号 ✓，
   *    换图必然换 URL ✓）—— 前端不自己拼 ✓。
   *  ⚠️ **不能先把网络地址挂上去** ✗ —— 一挂就是一次真请求 ✓：本机缓存明明
   *    命中 ✓，也要先把那张 5MB 的图从 WireGuard 上拉一遍 ✓（用户报的
   *    "每次重进都很慢"就是这么来的 ✓）。所以**先查本机缓存** ✓，
   *    只有没命中才退回网络地址 ✓。
   */
  const applyChatBackground = async () => {
    const chat = $('#chat');
    if (!chat) return;
    const url = group && group.background;
    if (!url) {
      chat.classList.remove('has-bg');
      chat.style.removeProperty('--chat-bg');
      if (bgObjUrl) { URL.revokeObjectURL(bgObjUrl); bgObjUrl = null; }
      bgKey = null;
      return;
    }
    if (bgKey === url || bgPending === url) return;   // 同一张，别重贴 / 别重拉 ✓
    bgPending = url;

    const made = await _materializeBg(url);       // 命中本机缓存秒回、不上网 ✓
    if (bgPending === url) bgPending = null;
    if ((group && group.background) !== url) {    // 这期间换图了 → 这张作废 ✓
      if (made) URL.revokeObjectURL(made);
      return;
    }
    if (made) {
      if (bgObjUrl) URL.revokeObjectURL(bgObjUrl);
      bgObjUrl = made;
      chat.style.setProperty('--chat-bg', `url("${bgObjUrl}")`);
      bgKey = url;
    } else {
      // 缓存取不到（第一次 / IndexedDB 坏了）→ 退回网络地址 ✓
      // ⚠️ 也先解码一遍再挂 ✓ —— 与缓存那条路同一个理由（加载页要等它 ✓）。
      await _decodeImg(url);
      chat.style.setProperty('--chat-bg', `url("${url}")`);
    }
    chat.classList.add('has-bg');
  };

  // ★ 2026-10-20：**同一张背景的取图只跑一趟，而且能被 `await`** ✓。
  //
  //   `renderHeader()` 在开机时会连着调好几次 ✓（缓存那一份一次、网络那一份一次 ✓），
  //   而 `applyChatBackground` 原来对"正在取的那张"是**直接 return** ✗ ——
  //   调用方 await 它只会得到 `undefined` ✓，等不到图 ✓。
  //   这里把"这个地址的任务"记下来 ✓：同一个地址再来就直接复用同一个 Promise ✓；
  //   地址变了（换了背景图 ✓）才另起一趟 ✓。
  let bgTask = null, bgTaskKey = null, bgSeq = 0;
  const ensureChatBackground = () => {
    const url = (group && group.background) || '';
    if (bgTask && bgTaskKey === url) return bgTask;
    const seq = ++bgSeq;
    bgTaskKey = url;
    bgTask = applyChatBackground().catch(() => {}).finally(() => {
      // 只清**自己这一趟** ✓ —— 期间换了图的话，新的那趟不能被清掉 ✓。
      if (seq === bgSeq) { bgTask = null; bgTaskKey = null; }
    });
    return bgTask;
  };

  const renderHeader = () => {
    $('#gname').textContent = group?.name || '';
    setStatus(curStatus);
    ensureChatBackground();
  };

  // 管家状态 → **顶栏那只猫猫仔**（2026-10-30，用户定的）：
  //   状态条不要了 ✓，换成一只会打盹 / 伸懒腰 / 走两步的猫 ✓。
  //   `group.agent_status` 那份配置**留着** ✓ —— 01-core 的 `agentCfg()` 还在用它 ✓，
  //   但**那三行"状态文案"设置已经撤了** ✓（没人显示那些字了 ✓，见 02-agent.js）。
  //   `agentCfg()` 认得里面的 thinking/idle 之类，照旧 ✓。
  //   事件 → 心情的翻译在 08-cat.js 里 ✓；这里只负责把事件递过去 ✓。
  let statusCfg = null;

  const normalizeStatus = () => {
    // 服务端存的是 JSON **字符串** ✓（列是 TEXT ✓）。
    try { statusCfg = group && group.agent_status ? JSON.parse(group.agent_status) : null; }
    catch (e) { statusCfg = null; }         // 坏字符串 → 当没配置 ✓
    // 配置只影响文字 ✓；猫脸由事件驱动 ✓，这里不重画 ✓。
  };

  // 状态**只在顶栏表达** ✓ —— 2026-10-30 起它不是字，是猫 ✓。
  const setStatus = (s) => {
    curStatus = s;
    try { if (window.__lgCat) window.__lgCat.set(s); } catch (e) {}
  };

  // ⚠️ **不再有"4 秒后还原"** ✗ —— 以前那是对着文字条的 ✓；
  //    现在猫自己会从 think 落回 sleep ✓（08-cat.js 里带兜底 ✓）。
  //    留着那个定时器反而会**打断**下一轮思考 ✗（lurking 的 4 秒能砍掉刚发的 think ✓）。
  const setStatusTimed = (s) => setStatus(s);

  // ── 消息 ──
