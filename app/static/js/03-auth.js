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
    // ★ 2026-10-11：**顺手把组件收纳页那段外观取回来** ✗→✓ ——
    //   那段 CSS 原来（改之前）是**进那一屏时才异步取**的 ✓ → 取回来之前先按
    //   默认底色画了一帧 ✓ → 那一帧就是用户报的"黑屏一闪" ✓（进组件界面/工坊时）。
    //   现在开机就取好 ✓、进屏时**同步**挂上 ✓ → 不闪 ✓。
    //   ⚠️ **不等它** ✓（`preloadWallCss` 自己吞异常 ✓）：这是预热 ✓，
    //      不该挡住"进 App"这件事 ✓。
    preloadWallCss();
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

  /** 把这个空间的背景贴到主群聊上 ✓（没有就摘掉 ✓）。
   *
   *  ⚠️ 只改 `#chat` 上的一个 class + 一个 CSS 变量 ✓ —— **不重建节点** ✓
   *    （换背景时消息列表不该闪一下 ✓）。
   *  ⚠️ 地址**只认服务端给的** `group.background` ✓（它带版本号 ✓，
   *    换图必然换 URL ✓）—— 前端不自己拼 ✓。
   */
  const applyChatBackground = () => {
    const chat = $('#chat');
    if (!chat) return;
    const url = group && group.background;
    if (url) {
      chat.style.setProperty('--chat-bg', `url("${url}")`);
      chat.classList.add('has-bg');
    } else {
      chat.classList.remove('has-bg');
      chat.style.removeProperty('--chat-bg');
    }
  };

  const renderHeader = () => {
    $('#gname').textContent = group?.name || '';
    setStatus(curStatus);
    applyChatBackground();
  };

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
