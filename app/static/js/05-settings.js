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
