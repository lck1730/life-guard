  // ── 模型（2026-10-11 从独立的「模型服务」并进来；2026-10-22 改成「远程CC」那一版）
  //
  // 用户 2026-10-22：设置页做成和「远程CC」一样；只保留商汤；模型名列表一致。
  //   · 一行 = 一套方案；点一行换过去（后端 role="model" 一次写 chat+aux）
  //   · 编辑板子里模型是一个下拉；每个名字能单独测；上下文跟着方案走
  //   · 没有常驻提示文字（用户明确要求去掉「点一行换过去…」）
  //
  // ⚠️ 这一屏只由「设置 → 模型」进入；闸门在服务端 require_admin。
  let MODELS = null;
  // 03 用量与签到（魔搭）✓ —— 上一次查到的余额/签到、没查到的原因、正在查 ✓
  let MAGIC = null, MAGIC_ERR = '', MAGIC_LOADING = false, MAGIC_TS = 0;

  const openModels = () => { pushScreen('models', 'settings'); renderModels(); };

  const mHint = (t, bad) => mkel('div', 'mhint' + (bad ? ' bad' : ''), t);
  const mBtn = (t, cls, fn) => { const b = mkel('button', 'mbtn' + (cls ? ' ' + cls : ''), t); b.onclick = fn; return b; };

  /** 262144 → 256K / 1048576 → 1M */
  const fmtCtx = (n) => {
    const v = parseInt(n || '0', 10);
    if (!v) return '';
    return v >= 1048576 ? (v / 1048576).toFixed(v % 1048576 ? 1 : 0) + 'M'
                        : Math.round(v / 1024) + 'K';
  };

  /** 铅笔（feather edit-2）—— 和远程CC 那颗同一个形状 */
  const mPencil = () => {
    const s = mkel('span');
    s.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>';
    return s;
  };

  /** 测试按钮：未测=脉冲，通过=对号，失败=叉号；和远程CC 同一个形状 */
  const mTestIcon = (ok) => {
    const s = mkel('span');
    const head = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
    if (ok === true) {
      s.innerHTML = head + '<polyline points="20 6 9 17 4 12"/></svg>';
    } else if (ok === false) {
      s.innerHTML = head + '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    } else {
      s.innerHTML = head + '<polyline points="2 12 7 12 10 5 14 19 17 12 22 12"/></svg>';
    }
    return s;
  };

  /** 哪一套在用：chat 槽（换的时候两个槽一起写） */
  const activeId = (d) => ((((d || MODELS || {}).roles || {}).chat || {}).id) || '';

  /** 换过去后把窗口大小也排一次队（profile 归 root，只能排队） */
  const queueCtx = async (v) => {
    const n = parseInt(v || '0', 10);
    if (!n) return;
    try {
      await api('/models/context', { method: 'POST', body: JSON.stringify({ group: 'chat', tokens: n }) });
    } catch (e) { toast('模型换了，但上下文没排上队'); }
  };

  /** 极客风分块标题 ✓ —— `01 // 文本 ────── [4]`。
   *  用户 2026-10-23：「模型界面两块，一个文本，一个图像。用极客//风格分块」✓。
   *  ⚠️ 用户 2026-10-23 补：「就行了，不要后面的模型池、读图模型字样」✗→✓ ——
   *    块头只留「文本」「图像」两个字 ✓，别再加上用途后缀 ✓。
   *  `idx` = 序号 ✓，`meta` = 右边那枚状态/计数牌 ✓（`[4]` / `[ON]` ✓）。 */
  const mHead = (idx, title, meta, on) => {
    const h = mkel('div', 'mhead');
    h.appendChild(mkel('span', 'mh-i', idx));
    h.appendChild(mkel('span', 'mh-t', '// ' + title));
    h.appendChild(mkel('span', 'mh-rule'));
    h.appendChild(mkel('span', 'mh-m' + (on ? ' on' : ''), meta));
    return h;
  };

  /** 把一份名单画出来 ✓（`renderModels` 的两条路——先画缓存 / 刷新后重画——共用）。
   *  ★ 2026-10-23：**分成两块** ✓ —— 文本 = 模型池 ✓，图像 = 读图模型 ✓。
   *    两块**永远都在** ✓：池子空着也一样 ✓（否则读图那一块会跟着"消失" ✗，
   *    用户看着像坏了 ✓）。 */
  const paintModels = (d) => {
    const body = $('#modelsBody');
    if (!body) return;
    body.textContent = '';
    const on = activeId(d);
    const list = (d && Array.isArray(d.configs)) ? d.configs : [];
    const v = vTarget(d);

    // ── 01 文本 ──
    body.appendChild(mHead('01', '文本', '[' + list.length + ']'));
    if (!list.length) {
      body.appendChild(mHint('还没有模型。点右上角「＋」加一套。'));
    } else {
      list.forEach(c => body.appendChild(mRow(c, c.id === on)));
    }

    // ── 02 图像 ──
    // ★ 2026-10-23：读图并进这一屏 ✓ —— 原先放在名单下面 ✓，现在自成一块 ✓。
    body.appendChild(mHead('02', '图像',
      v.id ? '[ON]' : '[--]', !!v.id));
    body.appendChild(visionRow(d));

    // ── 03 用量与签到（魔搭）──
    body.appendChild(magicBlock());
  };

  const renderModels = async () => {
    const body = $('#modelsBody');
    if (!body) return;
    loadMagicube(false);   // 后台查 ✓（和模型名单那趟并行 ✓；失败不影响上半屏 ✓）
    // ★★ **再进来时先用上一份名单铺上** ✗→✓（2026-10-23）——
    //   用户报「从模型界面切出后，再进入偶尔会黑屏」✓。
    //   原来每次都先 `textContent=''` 只留一句「正在读…」✗：
    //   请求快的时候看不见 ✓，可 WireGuard 一慢 / 偶尔卡一下 ✓，
    //   那一屏就只剩深色空底 ✓ —— 看着就是"黑了" ✓。
    //   名单本来就在内存里（`MODELS` ✓），先同步画上 ✓，后台再刷新 ✓
    //   （和工坊外观 `preloadWallCss` 那条同一个道理 ✓）。
    const cached = (MODELS && Array.isArray(MODELS.configs)) ? MODELS : null;
    if (cached) {
      paintModels(cached);
    } else {
      body.textContent = '';
      body.appendChild(mHint('正在读…'));
    }
    let d;
    try {
      d = await api('/models/configs');
    } catch (e) {
      // 手里有旧名单就留着 ✓ —— 这一趟没刷新上，不该把看得见的东西抹掉 ✗
      if (cached) { toast('模型名单没刷新：' + ((e && e.message) || e)); return; }
      body.textContent = '';
      body.appendChild(mHint('读不到模型池：' + ((e && e.message) || e), true));
      return;
    }
    MODELS = d;
    paintModels(d);
  };

  /** 一套方案 = 一行；整行可点，右边一颗铅笔 */
  const mRow = (c, on) => {
    const row = mkel('div', 'mrow' + (on ? ' on' : ''));
    row.appendChild(mkel('span', 'mk', on ? '●' : '○'));
    const mid = mkel('div', 'mid');
    mid.appendChild(mkel('div', 'nm', c.name || '(没名字)'));
    // ★ 2026-10-23：**没数就写 —**，不拿别套的数充数 ✓。
    const sub = [c.model, fmtCtx(c.context) || '—'].filter(Boolean).join(' · ');
    mid.appendChild(mkel('div', 'sub', sub || '（没填模型）'));
    row.appendChild(mid);
    const ed = mkel('button', 'edit');
    ed.setAttribute('aria-label', '改');
    ed.appendChild(mPencil());
    ed.onclick = (ev) => { ev.stopPropagation(); editForm(c); };
    row.appendChild(ed);
    row.onclick = on ? null : () => switchTo(c);
    return row;
  };

  const switchTo = async (c) => {
    let r;
    try {
      r = await api('/models/roles', { method: 'POST', body: JSON.stringify({ role: 'model', id: c.id }) });
    } catch (e) { toast((e && e.message) || '换不了'); return; }
    await queueCtx(c.context);
    toast('换成「' + ((r && r.roles && r.roles.chat && r.roles.chat.name) || c.name) + '」，下一句话生效');
    renderModels();
  };

  // 新建 / 改一套 —— key 留空 = 不改
  const editForm = (c) => {
    const isNew = !c;
    const panel = $('#sheetPanel');
    panel.textContent = '';
    if (isNew) panel.appendChild(mkel('div', 'msec', '加一套模型'));

    const form = mkel('div', 'mform');
    const mk = (label, val, ph) => {
      form.appendChild(mkel('label', null, label));
      const i = mkel('input', 'field');
      i.value = val || '';
      i.placeholder = ph || '';
      i.autocapitalize = 'off'; i.autocomplete = 'off'; i.spellcheck = false;
      form.appendChild(i);
      return i;
    };
    const iName = mk('名字', isNew ? '' : c.name, '如：商汤');
    const iUrl = mk('接口地址', isNew ? '' : c.base_url, 'https://…/v1');
    // 密钥用 text，绝不用 password（用户明确要求，安全键盘输入太累）
    const iKey = mk('密钥' + (isNew ? '' : '（留空 = 不改）'), '',
                    isNew ? 'sk-…' : (c.has_key ? '••••••' + (c.key_tail || '') : '（还没填）'));
    iKey.type = 'text';
    const iCtx = mk('上下文长度（留空 = 不改）', isNew ? '' : (c.context || ''), '如 262144');
    iCtx.inputMode = 'numeric';

    form.appendChild(mkel('label', null, '模型'));
    const pick = mkel('div', 'mpick');
    form.appendChild(pick);

    const ST = { model: isNew ? '' : (c.model || '') };
    const rows = (c && Array.isArray(c.models) ? c.models : []).map(x => ({ ...x }));
    if (ST.model && !rows.some(r => r.id === ST.model)) {
      rows.unshift({ id: ST.model, ctx: parseInt((c && c.context) || 0, 10) || 0,
                     ok: null, at: 0, msg: '' });
    }

    const acts = mkel('div', 'acts');
    if (!isNew) {
      acts.appendChild(mBtn('删除', 'danger', async () => {
        const yes = await confirmBox({
          title: '删掉「' + (c.name || '') + '」？',
          body: '它的密钥只存在这儿，删了就找不回来了。', danger: true, ok: '删掉' });
        if (!yes) return;
        closeSheet();
        try {
          const r = await api('/models/configs/' + c.id, { method: 'DELETE' });
          if (r && r.freed && r.freed.length) toast('删了 —— 现在没有模型可用了');
          // 缓存里也摘掉 ✓ —— 否则 `renderModels` 会先把**已经删掉的那一行**
          // 同步画一下 ✓，等刷新回来才消失（网慢时看着像没删掉 ✓）。
          if (MODELS && Array.isArray(MODELS.configs)) {
            MODELS.configs = MODELS.configs.filter(x => x.id !== c.id);
          }
          renderModels();
        } catch (e) { toast((e && e.message) || '没删掉'); }
      }));
    }
    acts.appendChild(mBtn('保存', 'pri', async () => {
      const payload = {
        name: iName.value.trim(), base_url: iUrl.value.trim(),
        api_key: iKey.value.trim(), model: ST.model,
        context: iCtx.value.trim(), models: rows,
      };
      if (!payload.name) { toast('得有个名字'); return; }
      if (!payload.model) { toast('选一个模型'); return; }
      if (payload.context && !/^\d+$/.test(payload.context)) { toast('上下文长度得是数字'); return; }
      if (!c && !payload.api_key) { toast('新建要填密钥'); return; }
      let saved;
      try {
        saved = c
          ? await api('/models/configs/' + c.id, { method: 'PATCH', body: JSON.stringify(payload) })
          : await api('/models/configs', { method: 'POST', body: JSON.stringify(payload) });
      } catch (e) { toast((e && e.message) || '没存上'); return; }
      closeSheet();
      const id = c ? c.id : (saved && saved.id);
      const wasActive = c ? (activeId() === c.id) : true;
      if (!c && id) {
        try { await api('/models/roles', { method: 'POST', body: JSON.stringify({ role: 'model', id }) }); }
        catch (e) { /* 存上了就行 */ }
      }
      if (wasActive) await queueCtx(payload.context);
      renderModels();
      toast('存好了');
    }));
    acts.appendChild(mBtn('取消', '', () => closeSheet()));
    form.appendChild(acts);
    panel.appendChild(form);
    openSheet();
    // 不自动聚焦（不要一点开就弹键盘）
    loadAvail(pick, { url: iUrl, key: iKey, ctx: iCtx }, c, rows, ST);
  };

  /** 模型下拉：默认收着；点开才展开。已存过的方案先问一次供应商。 */
  const loadAvail = async (box, inputs, c, rows, ST) => {
    box.textContent = '';
    const head = mkel('button', 'mpicktoggle');
    head.type = 'button';
    const body = mkel('div', 'mpickbody');
    body.hidden = true;
    head.onclick = () => { body.hidden = !body.hidden; head.classList.toggle('on', !body.hidden); };
    box.appendChild(head);
    box.appendChild(body);

    const cur = () => (ST.model || '').trim();

    async function testRow(r) {
      try {
        const d = await api('/models/ping', { method: 'POST', body: JSON.stringify({
          cid: (c && c.id) || '',
          base_url: (inputs.url.value || '').trim(),
          api_key: (inputs.key.value || '').trim(),
          model: r.id,
        }) });
        r.ok = !!d.ok; r.at = Date.now() / 1000; r.msg = d.message || '';
      } catch (e) {
        r.ok = false; r.at = Date.now() / 1000; r.msg = (e && e.message) || '测不了';
      }
      toast((r.ok ? '通了' : '不通') + ' · ' + r.id + (r.msg ? '（' + r.msg + '）' : ''));
    }

    function paint() {
      head.textContent = '';
      head.appendChild(mkel('span', 'cur', cur() || '选一个模型'));
      head.appendChild(mkel('span', 'arr', '›'));
      body.textContent = '';
      rows.forEach(r => {
        const row = mkel('div', 'mpickrow' + (r.id === cur() ? ' on' : ''));
        const pk = mkel('button', 'mpk');
        pk.type = 'button';
        pk.appendChild(mkel('span', 'mpid', r.id));
        if (r.ctx) pk.appendChild(mkel('span', 'mpctx', fmtCtx(r.ctx)));
        pk.onclick = () => {
          ST.model = r.id;
          if (r.ctx) inputs.ctx.value = String(r.ctx);
          paint();
        };
        row.appendChild(pk);

        const tb = mkel('button', 'ptest' + (r.ok === true ? ' good' : r.ok === false ? ' bad' : ''));
        tb.type = 'button';
        tb.setAttribute('aria-label', '测一下');
        tb.appendChild(mTestIcon(r.ok));
        if (r.msg) tb.title = r.msg;
        tb.onclick = async (ev) => {
          ev.stopPropagation();
          tb.disabled = true; tb.textContent = '…';
          await testRow(r);
          paint();
        };
        row.appendChild(tb);

        const del = mkel('button', 'pdel', '×');
        del.type = 'button';
        del.onclick = (ev) => {
          ev.stopPropagation();
          const i = rows.indexOf(r);
          if (i >= 0) rows.splice(i, 1);
          if (ST.model === r.id) ST.model = '';
          paint();
        };
        row.appendChild(del);
        body.appendChild(row);
      });

      const add = mkel('div', 'padd');
      const inp = mkel('input', 'field');
      inp.placeholder = '加一个模型名…';
      inp.autocomplete = 'off'; inp.spellcheck = false;
      const ab = mkel('button', 'paddbtn', '＋');
      ab.type = 'button';
      const go = () => {
        const v = (inp.value || '').trim();
        if (!v) return;
        if (!rows.some(x => x.id === v)) rows.push({ id: v, ctx: 0, ok: null, at: 0, msg: '' });
        ST.model = v;   // 加完就选中它
        inp.value = '';
        paint();
      };
      ab.onclick = go;
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      add.appendChild(inp);
      add.appendChild(ab);
      body.appendChild(add);
    }

    paint();

    // 已存过、但没有清单 → 问一次供应商；之后就只认他自己那份（删掉的不会回来）
    if (c && c.id && !(Array.isArray(c.models) && c.models.length)) {
      try {
        const d = await api('/models/available', { method: 'POST',
                                                   body: JSON.stringify({ cid: c.id }) });
        ((d && d.list) || []).forEach(x => {
          const have = rows.find(r => r.id === x.id);
          if (have) {
            if (x.context) have.ctx = x.context;
          } else {
            rows.push({ id: x.id, ctx: x.context || 0, ok: null, at: 0, msg: '' });
          }
        });
        paint();
      } catch (e) { /* 问不到就算了，手填也能用 */ }
    }
  };

  $('#modelsBack').onclick = () => popScreen('models');
  $('#modelsAdd').onclick = () => editForm(null);


  // ── 聊天背景（2026-10-19）───────────────────────────────────────────
  //
  // ★ 每个空间一张图 ✓（服务端在 `var/background/g<群号>/` 里存 ✓，
  //   `group.background` 跟着群这一行走 ✓ → bootstrap / `/groups` 都有 ✓）。
  //   ⚠️ 这里**不缓存**那张图 ✓ —— 地址里带版本号 ✓（换图换 URL ✓），
  //      所以"有没有背景"永远以 `group.background` 为准 ✓。
  //
  // ⚠️ 上传**不能用 `api()`** ✗ —— 它固定发 JSON ✓；
  //    这里要 `FormData` ✓，所以照头像那两处（`uploadAgentAvatarFile` ✓）
  //    直接 `fetch` ✓，失败时自己把 `detail` 读出来 ✓。
  let bgBusy = false;

  const openBgSet = () => { pushScreen('bgSet', 'settings'); renderBgSet(); };

  const renderBgSet = () => {
    const body = $('#bgBody');
    if (!body) return;
    body.textContent = '';
    const url = group && group.background;

    // 预览：**画成竖的那种** ✓（手机相册里大多数是竖图 ✓）
    // ⚠️ 主群聊已经贴上的那张就用**本机缓存那份** ✓ —— 不然一进这一屏
    //    又要把 5.6MB 原图从 WireGuard 上拉一遍 ✓（预览只要看得见就行 ✓）。
    const prev = document.createElement('div');
    prev.className = 'bgprev';
    if (url) prev.style.backgroundImage =
      `url("${(bgKey === url && bgObjUrl) ? bgObjUrl : url}")`;
    else {
      const none = document.createElement('span');
      none.className = 'bgempty';
      none.textContent = bgBusy ? '正在上传…' : '还没有设置背景';
      prev.appendChild(none);
    }
    body.appendChild(prev);

    const pick = document.createElement('button');
    pick.className = 'bgbtn';
    pick.textContent = url ? '换一张图片' : '选择图片';
    pick.disabled = bgBusy;
    pick.onclick = () => { if (!bgBusy) $('#fileBg').click(); };
    body.appendChild(pick);

    // 「移除」只在有背景时出现 ✓ —— 没背景时摆一颗红按钮只是吓人 ✓
    if (url) {
      const del = document.createElement('button');
      del.className = 'bgbtn danger';
      del.textContent = '移除背景';
      del.disabled = bgBusy;
      del.onclick = removeBg;
      body.appendChild(del);
    }

    const hint = document.createElement('div');
    hint.className = 'bghint';
    hint.textContent = '支持 jpg / png / webp / gif，最大 12MB。';
    body.appendChild(hint);
  };

  const uploadBg = async (file) => {
    if (!file || !group) return;
    // 前端先挡一道只是**省一趟** ✓ —— 真正的闸门在服务端 ✓
    //（能被绕过的检查等于没有 ✓，这条是这个项目的老规矩 ✓）。
    if (file.size > 12 * 1024 * 1024) { toast('图片太大（上限 12MB）'); return; }
    bgBusy = true; renderBgSet(); toast('正在上传…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(`/api/groups/${group.id}/background`,
                            { method: 'POST', body: fd, credentials: 'same-origin' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || ('上传失败 ' + r.status));
      // ⚠️ 拿服务端回来的地址 ✓（别自己拼 ✓）—— 版本号只有它知道 ✓。
      group.background = (d && d.background) || null;
      renderHeader(); renderSettings();
      toast('背景已换好');
    } catch (e) {
      toast((e && e.message) || '没上传上');
    } finally {
      bgBusy = false; renderBgSet();
    }
  };

  const removeBg = async () => {
    const yes = await confirmBox({
      title: '移除背景？',
      body: '移除后群聊会回到默认的底色。',
      ok: '移除', danger: true,
    });
    if (!yes) return;
    bgBusy = true; renderBgSet();
    try {
      await api(`/groups/${group.id}/background`, { method: 'DELETE' });
      group.background = null;
      renderHeader(); renderSettings();
      toast('背景已移除');
    } catch (e) {
      toast((e && e.message) || '没移除掉');
    } finally {
      bgBusy = false; renderBgSet();
    }
  };

  $('#bgBack').onclick = () => popScreen('bgSet');
  // ⚠️ 选完**马上把 input 清空** ✓ —— 不然同一张图再选一次不会触发 `change` ✓，
  //    用户看到的是"点了没反应"✓。
  $('#fileBg').onchange = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) uploadBg(f);
  };

  // ── 主题（2026-10-19）───────────────────────────────────────────────
  //
  // ★ 三套：夜阑（深色，默认）/ 奶霜（奶白）/ 林深（深林绿）✓。
  // ⚠️ 主题**不进服务端** ✓ —— 存在本机 localStorage、按用户 id 分开 ✓
  //    （底层在 `01-core.js` 的 `applyTheme` / `syncThemeForUser` ✓）。
  //    所以「群内用户背景不共享」不是靠服务端过滤 ✓：**根本没人上传** ✓，
  //    别的成员既看不到也改不了 ✓。
  // ⚠️ 预览卡用的是**那套主题自己的颜色** ✓（`THEMES[i].vars` → `--p-*` ✓）——
  //    和当前 `data-theme` 无关 ✓，站在林深里也看得见奶霜长什么样 ✓。
  const openThemeSet = () => { pushScreen('themeSet', 'settings'); renderThemeSet(); };

  const renderThemeSet = () => {
    const body = $('#themeBody');
    if (!body) return;
    const cur = document.documentElement.dataset.theme || THEME_DEFAULT;
    body.textContent = '';

    THEMES.forEach(t => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'tcard' + (t.id === cur ? ' on' : '');
      card.dataset.themePick = t.id;
      card.setAttribute('aria-pressed', t.id === cur ? 'true' : 'false');
      card.setAttribute('style', t.vars);   // 预览用这套主题的颜色 ✓

      // 迷你聊天：顶栏 / 一问一答 / 输入条 ✓ —— 只看形和配色，不写长句 ✓
      const prev = document.createElement('div');
      prev.className = 'tprev';
      const top = document.createElement('div');
      top.className = 'tptop';
      const av = document.createElement('span'); av.className = 'tpav';
      const title = document.createElement('span'); title.className = 'tptitle';
      const time = document.createElement('span'); time.className = 'tptime';
      top.append(av, title, time);
      prev.appendChild(top);

      const pbody = document.createElement('div');
      pbody.className = 'tpbody';
      const a = document.createElement('div');
      a.className = 'tpbub agent'; a.textContent = '今晚想记点什么？';
      const m = document.createElement('div');
      m.className = 'tpbub mine'; m.textContent = '记一笔晚饭';
      pbody.append(a, m);
      const input = document.createElement('div');
      input.className = 'tpinput';
      input.append(document.createElement('i'), document.createElement('b'));
      pbody.appendChild(input);
      prev.appendChild(pbody);
      card.appendChild(prev);

      // 名字 + 一句话 + 右边的选中点（选中的再加「使用中」✓）
      const meta = document.createElement('div');
      meta.className = 'tmeta';
      const txt = document.createElement('div');
      txt.className = 'ttxt';
      const name = document.createElement('div');
      name.className = 'tname';
      name.appendChild(document.createTextNode(t.name));
      if (t.id === cur) {
        const badge = document.createElement('span');
        badge.className = 'tbadge';
        badge.textContent = '使用中';
        name.appendChild(badge);
      }
      const desc = document.createElement('div');
      desc.className = 'tdesc';
      desc.textContent = t.desc;
      txt.append(name, desc);
      const dot = document.createElement('span');
      dot.className = 'tocardot';
      meta.append(txt, dot);
      card.appendChild(meta);

      card.onclick = () => {
        applyTheme(t.id);     // 立即生效 + 记住 ✓
        renderSettings();     // 这一屏会跟着重画（见下面那行 ✓），设置页右边也换掉 ✓
      };
      body.appendChild(card);
    });
  };

  $('#themeBack').onclick = () => popScreen('themeSet');

  // ── 读图（2026-10-23）—— **并进「模型」这一屏** ✓
  //
  // 用户：「读图模型放在模型里面 ✓，并且要真的能读图的才能进 ✓，
  //        你负责把关并配置好 ✓，界面简洁别介绍那么多废话 ✓」✓。
  //
  // ★ 谁够格 ✗→✓：`models.json` 每个模型行上的 `img` ✓ —— 只有拿内置那张
  //   （上红下蓝、答案固定 ✓）当场问出来、两块颜色都答对 ✓ 才是 `true` ✓。
  //   后端 `POST /api/models/vision` **只收 `img===true` 的** ✓
  //   （闸门在服务端 ✓，不是靠界面上把按钮藏起来 ✓）。
  // ★ 存的是「哪一套 + 哪个模型」✓（`vision = {cid, model}` ✓），
  //   Hermes 那边只写用途名 `vision` ✓ → 换它不改 `/root/.hermes` ✓、不重启 ✓。
  //
  // ⚠️ 测试结果**不跨图保留** ✓ —— 换了图就清掉 ✓，免得把上一张的结论当成
  //    "它现在也行" ✗。
  // ★ 2026-10-23：**常驻测试图** ✓（用户：「可以选择常驻的测试图并且显示出来，
  //   然后可以随时替换，默认红蓝图」✓）——
  //   存在服务端 `var/vision/test.img` ✓，换一次存一次 ✓、大家看到同一张 ✓；
  //   没有这个文件时服务端吐内置红蓝图 ✓ →「恢复默认」就是把它删掉 ✓。
  //   ⚠️ 和以前那个"临时选一张测完就不管"不一样 ✗：现在是**长期留着**的 ✓。
  let vImgUrl = '';        // 常驻图的预览（object URL ✓）
  let vImgKind = '';       // 'builtin' | 'custom' | ''（还没读到）
  let vImgErr = '';        // 读图失败的原因（显示在预览的位置 ✓）
  let vImgSeq = 0;         // 拉图序号 —— 慢请求回来时别把新图盖掉 ✓
  let vPrompt = '';        // 输入框里的字（重画时得留着）
  let vBusy = false;       // 正在测 / 正在换图
  let vVerifying = '';     // 正在验的「cid|model」
  let vRes = null;         // 上一次测试的结果
  // 厂家手风琴：**一次只展开一个** ✓（用户：「展开一个自动折叠其他」✓）。
  // `undefined` = 还没定过 → 进来自动展开“现在用的那家” ✓；
  // `null` = 用户自己全收起来了 ✓ → 别在下次重画时又给他展开 ✗。
  let vOpen;

  /** 读图现在指着谁 ✓（没单独配时服务端回"跟着聊天模型"的那个 ✓）。 */
  const vTarget = (d) => {
    const v = (d && d.vision) || {};
    return { id: v.id || '', model: v.model || '', name: v.name || '',
             label: v.label || '', set: !!v.set };
  };

  /** 一套配置下能选的模型名 ✓ —— 清单里的 + 顶层那个（不在清单里才补 ✓），去重 ✓。
   *  ★ 带上 `img` 资格 ✓：true = 验过能读图；false = 验过读不了；null = 没验过。
   *  ⚠️ **清单先走** ✗→✓（2026-10-23）—— 原来顶层 `c.model` 先加、`img` 记 `null` ✗，
   *     于是「当前在用的那个」只要正好是顶层模型 ✓，清单里那行 `img:true` 就被
   *     去重挡掉 ✗ → 按响当当的"只留能读图的"一筛，它自己反而不见了 ✓
   *     （Agnes 的 `agnes-2.5-flash` 就是这么丢的 ✓）。 */
  const vModelsOf = (c) => {
    const seen = new Set(), out = [];
    const add = (id, ctx, img) => {
      const k = String(id || '').trim();
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push({ id: k, ctx: parseInt(ctx || 0, 10) || 0,
                 img: typeof img === 'boolean' ? img : null });
    };
    (Array.isArray(c.models) ? c.models : []).forEach(m => add(
      typeof m === 'string' ? m : (m && m.id),
      (m && typeof m === 'object') ? m.ctx : 0,
      (m && typeof m === 'object') ? m.img : null));
    if (c.model) add(c.model, c.context, null);
    return out;
  };

  /** 测试用的图先缩一道 ✓ —— 手机原图五六兆 ✓，走 WireGuard 慢 ✓、
   *  上游也未必收 ✓。失败就**原样发** ✓（宁可慢，别把测试弄没 ✓）。 */
  const vShrink = async (f) => {
    try {
      if (!f || f.size < 900 * 1024 || typeof createImageBitmap !== 'function') return f;
      if (f.type === 'image/gif') return f;          // 动图不碰 ✓
      const bmp = await createImageBitmap(f);
      const k = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * k));
      const h = Math.max(1, Math.round(bmp.height * k));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
      try { bmp.close(); } catch (e) {}
      const out = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
      return (out && out.size && out.size < f.size) ? out : f;
    } catch (e) { return f; }
  };

  /** 把常驻图拉回来显示 ✓ —— 每次开板子拉一次（可能别的设备换过 ✓）。
   *  ⚠️ 带序号 ✗→✓：连点两下"换一张"时，先发的那趟可能后回来 ✓，
   *     不认序号就会拿**旧图**盖掉新的 ✓（预览和实际测试对不上 ✗）。 */
  const loadVisionImage = async () => {
    const seq = ++vImgSeq;
    try {
      const r = await fetch('/api/models/vision/image',
        { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const blob = await r.blob();
      const kind = (r.headers.get('X-Image-Kind') || '').trim();
      if (seq !== vImgSeq) return;   // 这中间又换过 → 这份作废 ✓
      if (vImgUrl) { try { URL.revokeObjectURL(vImgUrl); } catch (e) {} }
      vImgUrl = URL.createObjectURL(blob);
      vImgKind = kind === 'custom' ? 'custom' : 'builtin';
      vImgErr = '';
    } catch (e) {
      if (seq !== vImgSeq) return;
      vImgErr = '测试图读不出来：' + ((e && e.message) || e);
    }
    if ($('#vSheet')) renderVisionSheet(MODELS);
  };

  /** 换常驻图 ✓ —— 先缩一道（手机原图五六兆 ✓，走 WireGuard 慢 ✓）。 */
  const replaceVisionImage = async (f) => {
    if (!f || vBusy) return;
    vBusy = true; vRes = null;
    renderVisionSheet(MODELS);
    try {
      const small = await vShrink(f);
      if (small.size > 8 * 1024 * 1024) throw new Error('图太大了（最多 8 MB）');
      const fd = new FormData();
      fd.append('file', small, small.name || 'test.jpg');
      const r = await fetch('/api/models/vision/image',
        { method: 'POST', body: fd, credentials: 'same-origin' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || ('换不了 ' + r.status));
      vRes = null;                    // 换了图，上一次的结论不作数 ✓
      await loadVisionImage();
      toast('测试图换好了');
    } catch (e) {
      toast('换不了：' + ((e && e.message) || e));
    } finally {
      vBusy = false;
      if ($('#vSheet')) renderVisionSheet(MODELS);
    }
  };

  /** 恢复默认红蓝图 ✓（删掉服务端那张常驻图 ✓）。 */
  const resetVisionImage = async () => {
    if (vBusy) return;
    vBusy = true; vRes = null;
    renderVisionSheet(MODELS);
    try {
      const r = await fetch('/api/models/vision/image',
        { method: 'DELETE', credentials: 'same-origin' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || ('恢复不了 ' + r.status));
      await loadVisionImage();
      toast('已恢复红蓝图');
    } catch (e) {
      toast('恢复不了：' + ((e && e.message) || e));
    } finally {
      vBusy = false;
      if ($('#vSheet')) renderVisionSheet(MODELS);
    }
  };

  /** 只刷新池子（资格标记在服务端 ✓），模型屏和板子都跟着重画 ✓。 */
  const refreshModelPool = async () => {
    let d;
    try { d = await api('/models/configs'); } catch (e) { return; }
    MODELS = d;
    paintModels(d);
    if ($('#vSheet')) renderVisionSheet(d);
  };

  /** 「图像」那一块里的一行：读图现在用谁 ✓，点开换 / 测 ✓。
   *  ★ 2026-10-23：标题已经写在块头上（`// 图像` ✓），这一行就不再
   *    重复「读图」两个字 ✓ —— 直接报“现在用谁” ✓。没单独配时点一句
   *    「跟着聊天」✓，不然他会以为这块没生效 ✓。 */
  const visionRow = (d) => {
    const v = vTarget(d);
    const row = mkel('div', 'mrow vrow');
    row.appendChild(mkel('span', 'mk', '◉'));
    const mid = mkel('div', 'mid');
    mid.appendChild(mkel('div', 'nm', v.id ? v.name : '还没配'));
    mid.appendChild(mkel('div', 'sub', v.id
      ? (v.model + (v.set ? '' : ' · 跟着聊天'))
      : '点进去选一个能读图的'));
    row.appendChild(mid);
    row.appendChild(mkel('span', 'vchev', '›'));
    row.onclick = () => openVisionSheet();
    return row;
  };

  // ── 03 用量与签到（魔搭） ★ 2026-10-23 ──────────────────────────────
  //
  // 用户：「魔塔需要每天登录获取魔粒值，为魔塔专门开辟魔粒值显示和每日快速
  //       登录的入口。具体就放在 03，用量与签到」✓。
  //
  // ⚠️ **「领」不在这一屏里做** ✗ —— 魔搭每日 200 是**网页登录**发的 ✓，
  //    阿里 passport 那一步带验证码 ✗，服务器拿用户名密码登不进去 ✓。
  //    这里只做两件事：**把余额 / 今日状态显示出来** ✓、**一键打开魔搭** ✓
  //    （手机系统浏览器里登录着的会话，打开首页就会到账 ✓）。
  //    回来点「刷新」看结果 ✓ —— 数字来自后端 `/models/magicube` ✓（只读 ✓）。
  const MS_HOME = 'https://modelscope.cn/home';

  /** 手机壳只留同 host ✓ —— modelscope.cn 是外链 ✓，交给系统浏览器打开 ✓。 */
  const magicOpen = () => { location.href = MS_HOME; };

  // ★ 2026-10-23 用户：「界面再简洁一些，跳转、刷新用 svg，不显示签到的详细
  //   魔粒值，只需要显示当前账户魔粒值以及是否签到，刷新图标和跳转图标即可，
  //   并且已签不能在 03 显示，因为后续可能有别的平台，03 只显示平台数就行」✓。
  //   ⇒ 块头只报**平台数** ✓；条目里只剩 名字 / 魔粒值 / 是否签到 / 两颗图标 ✓。
  const MG_GO_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>';
  const MG_RF_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/></svg>';
  const MG_PLATFORMS = 1;   // 现在只有魔塔 ✓；以后加平台，这里跟着加 ✓

  const magicIcon = (svg, label, fn, spin) => {
    const b = mBtn('', 'mgic', fn);
    b.title = label;
    b.innerHTML = svg;
    if (spin && b.classList) b.classList.add('spin');
    return b;
  };

  const magicBlock = () => {
    const box = mkel('div', 'mgwrap');
    box.id = 'mgWrap';
    box.appendChild(mHead('03', '用量与签到', '[' + MG_PLATFORMS + ']'));

    const row = mkel('div', 'mrow');
    row.appendChild(mkel('span', 'mk', '◉'));
    const mid = mkel('div', 'mid');
    mid.appendChild(mkel('div', 'nm', '魔塔'));

    let sub, signed = false;
    if (MAGIC && MAGIC.ok) {
      signed = !!MAGIC.signed;
      sub = signed ? '已签到' : '未签到';
    } else if (MAGIC && !MAGIC.ok) {
      sub = MAGIC.why || '查不到';
    } else {
      sub = MAGIC_LOADING ? '正在问魔搭…' : '还没查';
    }
    mid.appendChild(mkel('div', 'sub' + (signed ? ' mgon' : ''), sub));
    row.appendChild(mid);

    const num = mkel('div', 'mgnum');
    num.appendChild(mkel('div', 'mgval',
      (MAGIC && MAGIC.ok) ? String(MAGIC.available) : '--'));
    num.appendChild(mkel('div', 'mglab', '魔粒'));
    row.appendChild(num);

    const acts = mkel('div', 'macts');
    acts.appendChild(magicIcon(MG_GO_SVG, '跳转魔搭', () => magicOpen()));
    acts.appendChild(magicIcon(MG_RF_SVG, '刷新', () => loadMagicube(true), MAGIC_LOADING));
    row.appendChild(acts);

    box.appendChild(row);
    if (MAGIC_ERR) box.appendChild(mHint(MAGIC_ERR, true));
    return box;
  };

  /** 只换 03 那一块 ✓ —— 不重画上面两块（免得闪 / 丢滚动位置 ✓）。 */
  const paintMagic = () => {
    const old = $('#mgWrap');
    if (!old || !old.parentNode) return;
    old.parentNode.replaceChild(magicBlock(), old);
  };

  const loadMagicube = async (force) => {
    if (MAGIC_LOADING) return;
    MAGIC_LOADING = true;
    paintMagic();
    try {
      MAGIC = await api('/models/magicube' + (force ? '?refresh=1' : ''));
      MAGIC_ERR = '';
    } catch (e) {
      MAGIC_ERR = '没查到：' + ((e && e.message) || '网络没通');
    } finally {
      MAGIC_LOADING = false;
      MAGIC_TS = Date.now();
      paintMagic();
    }
  };

  // ★ 2026-10-23：点「跳转」去系统浏览器，回来时页面重新可见 ✓ ——
  //   这里自动补查一次 ✓（用户就真的只要点「跳转」✓）；15 秒内不重复查 ✓。
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (!MAGIC_TS || Date.now() - MAGIC_TS < 15000) return;
      if (!$('#mgWrap')) return;          // 不在模型这一屏就别查 ✓
      loadMagicube(true);
    });
  }

  const openVisionSheet = async () => {
    // ⚠️ **`openSheet()` 一定要在两条路都走到的地方** ✗→✓（2026-10-23）——
    //    原来它只写在 `else`（`MODELS` 还没读到时 ✓）里 ✗：
    //    正常进这一屏时 `MODELS` 早就有值了 ✓ → 只往**关着的**板子里填了内容 ✓，
    //    `#sheet` 从来没拿到 `.on` ✗ → 点那一行**什么都不发生** ✓（用户报的"点不开"✓）。
    if (MODELS) renderVisionSheet(MODELS);
    else {
      const panel = $('#sheetPanel');
      panel.textContent = '';
      panel.appendChild(mHint('正在读…'));
    }
    openSheet();
    loadVisionImage();   // 常驻图每次开都拉一张 ✓（别的设备可能刚换过 ✓）
    let d;
    try { d = await api('/models/configs'); }
    catch (e) {
      if (!MODELS) toast('读不到模型池：' + ((e && e.message) || e));
      return;
    }
    MODELS = d;
    paintModels(d);
    if ($('#vSheet')) renderVisionSheet(d);
  };

  /** 点一个模型：**没验过的先当场验** ✓（内置红蓝图 ✓）；过了才让它当读图 ✓。
   *  ⚠️ 验不过就**停在这儿** ✓ —— 不写 `vision` ✓（后端也不收 ✓）。 */
  const pickVision = async (c, m, key) => {
    if (vBusy || vVerifying) return;
    if (m.img !== true) {
      vVerifying = key; vRes = null;
      renderVisionSheet(MODELS);
      let pass = false, why = '', verdict = null;
      try {
        const fd = new FormData();
        fd.append('cid', c.id);
        fd.append('model', m.id);
        // ⚠️ **验资格必须用内置红蓝图** ✗→✓（2026-10-23）—— 用户换了常驻图之后，
        //    默认会拿那张去测 ✓，可照片里有什么我们不知道 ✓ → 判不了对错 ✓ →
        //    新模型永远盖不上「能读图」的章 ✗，也就永远进不了这一屏 ✗。
        fd.append('use', 'builtin');
        const r = await fetch('/api/models/vision/test',
          { method: 'POST', body: fd, credentials: 'same-origin' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.detail || ('验不了 ' + r.status));
        verdict = d.verified;
        pass = verdict === true;
        why = (d.result && (d.result.error || d.result.text)) || '';
      } catch (e) { why = (e && e.message) || '没验成'; }
      vVerifying = '';
      if (!pass) {
        // ⚠️ **判不了 ≠ 读不了** ✗→✓：429 / 超时 / 连不上这一趟说明不了什么 ✓，
        //    别拿它给模型下结论 ✓（后端的 `img` 也没动 ✓）。
        const brief = why ? '（' + String(why).split('\n')[0].slice(0, 40) + '）' : '';
        toast(verdict === false ? ('「' + m.id + '」读不了图' + brief)
                                : ('「' + m.id + '」没验成' + brief));
        await refreshModelPool();
        return;
      }
    }
    try {
      const r = await api('/models/vision',
        { method: 'POST', body: JSON.stringify({ cid: c.id, model: m.id }) });
      if (MODELS) MODELS.vision = (r && r.vision) || MODELS.vision;
      toast('读图 → ' + m.id);
    } catch (e) { toast((e && e.message) || '换不了'); }
    await refreshModelPool();
  };

  const runVisionTest = async () => {
    const t = vTarget(MODELS);
    if (!t.id || !t.model) { toast('先配一个模型'); return; }
    vBusy = true; vRes = null;
    renderVisionSheet(MODELS);
    try {
      const fd = new FormData();
      fd.append('cid', t.id);
      fd.append('model', t.model);
      const p = (vPrompt || '').trim();
      if (p) fd.append('prompt', p);
      // 图不在这儿传 ✓ —— 服务端直接用常驻那张 ✓（没换过就是内置红蓝图 ✓）。
      // 换图是另一件事（`POST /vision/image` ✓），**存下来**，不是一次性的 ✓。
      const r = await fetch('/api/models/vision/test',
        { method: 'POST', body: fd, credentials: 'same-origin' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.detail || ('测试失败 ' + r.status));
      vRes = d;
      // 内置图那一发会顺手验一次资格 ✓ —— 刷一下池子里的标记 ✓
      if (d.verified !== null && d.verified !== undefined) await refreshModelPool();
    } catch (e) {
      vRes = { ok: false, error: (e && e.message) || '没测成' };
    } finally {
      vBusy = false;
      if ($('#vSheet')) renderVisionSheet(MODELS);
    }
  };

  const renderVisionSheet = (d) => {
    const panel = $('#sheetPanel');
    if (!panel) return;
    panel.textContent = '';
    const wrap = mkel('div');
    wrap.id = 'vSheet';
    panel.appendChild(wrap);
    // ★ 2026-10-23 用户：「读图模型点击后，顶部的：读图模型，现在用**** 去掉」✓
    //   ⇒ 板子顶上**不再写标题、也不写「现在用 xxx」** ✓
    //   （当前用的是哪个，列表里本来就有「使用中」✓，够看了 ✓）。
    if (!d || !Array.isArray(d.configs)) { wrap.appendChild(mHint('正在读…')); return; }
    const t = vTarget(d);

    // ★ 2026-10-23：**这一屏只留验过能读图的** ✓（用户：「里面只留有识图能力的
    //   模型」✓，「去掉不支持的而不影响外面」✓）—— 过滤只发生在板子里 ✓，
    //   模型页外面那份名单一个不少 ✓。没验过的（`img:null`）也不进来 ✓：
    //   「验」那一堆正是他说的那点丑 ✓。
    const groups = d.configs
      .map(c => ({ c, ms: vModelsOf(c).filter(m => m.img === true) }))
      .filter(g => g.ms.length);

    // 展开哪一家：优先“现在用的那家” ✓；没有就第一家 ✓；用户全收着（null）就保持 ✓
    const fallback = () => (groups.some(g => g.c.id === t.id) ? t.id
                          : (groups[0] ? groups[0].c.id : null));
    if (vOpen === undefined) vOpen = fallback();
    else if (vOpen !== null && !groups.some(g => g.c.id === vOpen)) vOpen = fallback();

    if (!groups.length) wrap.appendChild(mHint('还没有验过能读图的模型。'));

    // ── 厂家手风琴：点标题展开 / 收起 ✓，开一家自动折其他 ✓ ──
    groups.forEach(({ c, ms }) => {
      const open = vOpen === c.id;
      const cur = ms.find(m => t.set && t.id === c.id && t.model === m.id);
      const box = mkel('div', 'vacc' + (open ? ' on' : ''));

      const head = mkel('button', 'vacc-h');
      head.type = 'button';
      head.appendChild(mkel('span', 'vacc-n', c.name || '(没名字)'));
      if (cur) head.appendChild(mkel('span', 'vacc-tag', '使用中'));
      else head.appendChild(mkel('span', 'vacc-c', ms.length + ' 个'));
      head.appendChild(mkel('span', 'vacc-chev', '›'));
      head.onclick = () => {
        if (vBusy || vVerifying) return;
        vOpen = open ? null : c.id;
        renderVisionSheet(MODELS);
      };
      box.appendChild(head);

      if (open) {
        const bd = mkel('div', 'vacc-b');
        ms.forEach(m => {
          const on = t.set && t.id === c.id && t.model === m.id;
          const key = c.id + '|' + m.id;
          const row = mkel('button', 'vr' + (on ? ' on' : ''));
          row.type = 'button';
          row.appendChild(mkel('span', 'vdot', on ? '●' : '○'));
          row.appendChild(mkel('span', 'vname', m.id));
          if (on) row.appendChild(mkel('span', 'vok', '使用中'));
          row.disabled = vBusy || !!vVerifying;
          row.onclick = () => pickVision(c, m, key);
          bd.appendChild(row);
        });
        box.appendChild(bd);
      }
      wrap.appendChild(box);
    });

    // ── 常驻测试图（默认红蓝图 ✓；换一张就**存下来** ✓，不是一次性的 ✓）──
    if (!t.id) { wrap.appendChild(mHint('先选一个能读图的模型。')); return; }
    const testBox = mkel('div', 'vtest');
    const lab = mkel('div', 'vlab');
    lab.appendChild(mkel('span', null, '常驻测试图'));
    lab.appendChild(mkel('span', 'vkind',
      vImgKind === 'custom' ? '自己换的'
        : (vImgKind === 'builtin' ? '默认红蓝图' : '读图中…')));
    testBox.appendChild(lab);

    if (vImgUrl) {
      const img = mkel('img', 'vimg');
      img.src = vImgUrl;
      img.alt = '常驻测试图';
      testBox.appendChild(img);
    } else {
      testBox.appendChild(mHint(vImgErr || '正在读测试图…', !!vImgErr));
    }

    const line = mkel('div', 'vtline');
    const pick = mBtn('换一张', '', () => { if (!vBusy) $('#fileVision').click(); });
    pick.disabled = vBusy;
    line.appendChild(pick);
    if (vImgKind === 'custom') {
      const clr = mBtn('恢复红蓝图', '', () => resetVisionImage());
      clr.disabled = vBusy;
      line.appendChild(clr);
    }
    testBox.appendChild(line);

    const inp = mkel('input', 'field vprompt');
    inp.type = 'text';
    inp.value = vPrompt;
    inp.maxLength = 500;
    inp.placeholder = '想让它做什么（可留空）';
    inp.oninput = () => { vPrompt = inp.value; };
    testBox.appendChild(inp);

    const go = mBtn(vBusy ? '正在问…' : '测一下', 'pri', () => {
      if (!vBusy) runVisionTest();
    });
    go.disabled = vBusy || !t.id;
    testBox.appendChild(go);

    if (vRes) {
      const r = vRes, res = r.result || {};
      const box = mkel('div', 'vres' + (r.ok ? '' : ' bad'));
      box.textContent = r.ok
        ? ((res.text) || '(它回了个空)')
        : ('没测成：' + (r.error || res.error || '不知道'));
      testBox.appendChild(box);
      // `image_tokens === 0` 是**图没送进去**的硬证据 ✓（上游不报时是 null ✓，不冤枉它 ✓）
      const it = res.usage ? res.usage.image_tokens : null;
      if (r.ok && it === 0) {
        testBox.appendChild(mkel('div', 'vbad', '图 token 是 0 —— 图很可能没送进去。'));
      }
    }
    wrap.appendChild(testBox);
  };

  // 选完清空 input ✓ —— 同一张图再选一次才会再触发 `change` ✓（和背景那张一个坑 ✓）。
  // 选了就**传给服务端存下来** ✓（常驻 ✓），测试时不用再带图 ✓。
  $('#fileVision').onchange = (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) replaceVisionImage(f);
  };

  const renderSettings = () => {
    const eGname = $('#vGname'); if (eGname) eGname.textContent = group?.name || '';
    // 「聊天背景」右边：只说有没有 ✓ —— 缩略图不塞进这一行 ✓（行太窄 ✓）。
    const eBg = $('#vBg');
    if (eBg) eBg.textContent = (group && group.background) ? '已设置' : '默认';
    // 背景设置页开着时，群一刷新（比如别的成员换了图 ✓）它也得跟着重画 ✓
    if ($('#bgSet').classList.contains('on')) renderBgSet();
    // ★ 2026-10-19：「主题」右边写**当前这套的名字** ✓（夜阑 / 奶霜 / 林深 ✓）。
    const eTheme = $('#vTheme');
    if (eTheme) eTheme.textContent = themeById(document.documentElement.dataset.theme || THEME_DEFAULT).name;
    // 主题页开着时，选完主题要重画（把「使用中」挪到新卡上 ✓）
    if ($('#themeSet').classList.contains('on')) renderThemeSet();
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
  //      （和其它没有入口的老屏一样留着不删 ✓，理由见 `openMeSheet` 上面那段 ✓）。
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
      // ★ 2026-10-19：「聊天背景」—— 推开这一屏 ✓（上传 / 移除都在它里面 ✓）
      else if (act === 'bg') openBgSet();
      // ★ 2026-10-19：「主题」—— 夜阑 / 奶霜 / 林深 ✓（只影响这台设备 ✓）
      else if (act === 'theme') openThemeSet();
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
    // ⚠️ 本机那份"上次的样子"也要清 ✓ —— 下一个人登录时不该先闪出上一个人的聊天 ✓。
    _clearBoot();
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
  //      （`#meAccount` 现在**没有入口了** ✓，和 `#space` 一样留着不删 ✓）。
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
    // ★ 2026-10-14：原来保存下面还放了一颗「取消」✗（`swap` + `b`）——
    //   返回手势能干同样的事，那颗是多余的 ✓，整块 `swap` 拿掉 ✓。
    //   用户原话：「上面一个大保存按钮，下面一个小取消或者放回按钮……统一将取消或返回按钮去掉」✓。
    //   `closeMeEdit` 仍由 `__goBack` 在 meEdit 屏那一支调用 ✓（02-agent.js ✓），不用按钮。
    // ★ 头像那一页**按钮单独一张卡** ✓（壳那版就是两张：一张装头像、一张装按钮 ✓）；
    //   别的几页一页一张卡 ✓。
    // ⚠️ `err` 挂在**按钮那张卡**里 ✓（壳那版特意挪过来的）——
    //    挂在上面那张卡里的话，空着时要占 `min-height` + `margin-top` ≈ 30px 死空间 ✓，
    //    用户会以为"下面的间距太大" ✓（他当时就是这么说那个间距的 ✓）。
    const btnCard = (kind === 'avatar') ? mkel('div', 'card') : card;
    btnCard.append(btn, err);
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
    // ★ 2026-10-14：原来保存下面还放了一颗「返回」✗（`swap` + `b`）——
    //   返回手势能干同样的事，那颗是多余的 ✓，整块 `swap` 拿掉 ✓。
    //   `closePeer` 仍由 `__goBack` 在 peer 屏那一支调用 ✓（02-agent.js ✓），不用按钮。
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
  //   回到群聊全靠右滑，目的:提供一个纯粹的界面，不受限制」✓。
  //
  // 所以两件事：
  //    主群聊 --左滑--> [组件收纳页] --点一下--> [单个组件页]
  //    回来**逐层右滑**（单个组件 → 收纳页 → 群聊 ✓，iOS 那种手感 ✓）
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
  //: ★ **右滑引用**的阈值 ✓（2026-10-11 用户：「将引用变为右滑消息」）——
  //:   ⚠️ 比左滑那个(96) **小得多** ✗ —— 它们不是一类动作 ✓：
  //:      左滑是**换一整个界面** ✓（要拉得够、要那条跟手提示走满格 ✓）；
  //:      右滑是**给这条消息挂个引用** ✓（一次干脆的短划 ✓，要拉 96px 手很累 ✓）。
  //:   ⚠️ 它同时是"行跟手时能走多远"的**上限** ✓（拖到这儿就顶住 ✓）——
  //:      和左滑那个数一个道理 ✓：改它**同时改两件事**（阈值 + 行程 ✓），
  //:      别只按"阈值"去调 ✓。
  const QUOTE_TRIG = 56;
  let pgSw = null;
  //: 跟手那一下正在挪的是哪一行 ✓ —— 松手 / 取消 / 被别的手势接管，
  //: **都得把它收回原位** ✓（留一行歪在那儿，比什么都不做更让人犯嘀咕 ✓）。
  let qDragRow = null;

  /** 把跟手那行收回原位 ✓（三条路都走它 ✓：松手 ✓、取消 ✓、换一行 ✓）。 */
  const _endQuoteDrag = () => {
    const r = qDragRow;
    qDragRow = null;
    if (!r) return;
    r.classList.remove('swiping', 'quoteready');
    // ⚠️ 给一段**短回弹** ✓ —— 直接"啪"地归位太生硬 ✓，
    //    而且那一段正好是"我刚才那下没够"的收尾 ✓。
    r.style.transition = 'transform .17s cubic-bezier(.22,1,.36,1)';
    r.style.transform = '';
  };

  // ⚠️ `#msgcard` 从这一串里**去掉了** ✗→✓（2026-10-11）—— 那张长按小卡片整个删了 ✓。
  //    留着它**不会报错** ✓（`$(s)` 是 null ✓、`.some` 直接跳过 ✓），
  //    但那就是**一个永远为假的判断** ✓ —— 下一个人读到会以为"世上还有这么个东西" ✓。
  const _overlayOn = () =>
    ['#sheet', '#modal'].some(s => $(s) && $(s).classList.contains('on'));

  //: 除了这三屏之外，**其余任何一屏开着就不认手势** ✓（用户 2026-10-09：
  //: 「[组件沙箱]界面，只有在主群聊时右滑才出现，不能到处出现」✓）。
  //:
  //: ⚠️ 原来这里只问"这三屏开没开" ✗ —— 而主群聊是**垫在所有屏底下**的 ✓
  //:    （打开设置页时它照样 `on` ✓）→ 于是在**设置页、我的、组件对话…**
  //:    上左滑也会把收纳页推上来 ✗✓（用户看到的就是"到处都能滑出来" ✓）。
  //:    判据改成"**最上面那一屏**是不是这三屏之一" ✓。
  const _OTHER_SCREENS = [
    '#settings', '#bgSet', '#themeSet', '#me', '#meAccount', '#space',
    '#peer', '#selfIntro', '#agent', '#agentEdit', '#login', '#init',
  ];

  const _whichScreen = () => {
    if (_OTHER_SCREENS.some(s => $(s) && $(s).classList.contains('on'))) return '';
    if ($('#compView').classList.contains('on')) return 'comp';
    if ($('#workshop').classList.contains('on')) return 'wall';
    if ($('#chat').classList.contains('on')) return 'chat';
    return '';
  };

  //: 左滑提示的后半句 ✓。
  const _pullHintText = () => '进入创意工坊';

  /** 顶部那条提示 —— **跟着手指浮现** ✓（`p` 0→1 就是"拉了多少" ✓）。
   *
   *  ⚠️ `trig` 就是本方向的阈值 ✓ —— 条子走到满格的行程要和它一致 ✓
   *    （"该松手了"正是靠变色告诉他的 ✓）。
   */
  const showPullHint = (tail, dist, trig, side) => {
    const el = $('#pullHint');
    if (!el) return;
    const p = Math.max(0, Math.min(1, (dist || 0) / (trig || 1)));
    if (!p) { hidePullHint(); return; }
    // ★ **两段文案** ✓（用户 2026-10-10 定的 ✓）：
    //   还差一点 → 「继续左滑 / 继续下滑 …」✓（在催他接着拉 ✓）
    //   拉够了   → 「松开 …」✓（在催他松手 ✓）
    //   ⚠️ 分界就是 `p >= 1` ✓ —— 而那根条**同一个点变蓝** ✓（见 `.ready` ✓）：
    //      "变色"和"换字"是**同一件事的两个说法** ✓，别只改一个 ✗。
    el.textContent = (p >= 1 ? '松开' : '继续左滑') + tail;
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
    // ★ **起手按着的是哪一条消息** ✗→✓（2026-10-11）—— 右滑引用要用它 ✓。
    //   ⚠️ 必须**在这一刻**抓 ✗ —— 等判出方向再去 `closest` 就晚了 ✓：
    //      那会儿手指已经移开 ✓，`ev.target` 是**那一刻手指底下那个元素** ✓
    //      （早就不是刚按下去那一条了 ✓，最常见的是滑到了隔壁行 ✓）。
    const row = ev.target && ev.target.closest
      ? ev.target.closest('#msgs .row[data-id]') : null;
    pgSw = { x0: x, y0: y, dir: '', d: 0, row };
  }, { passive: true });

  document.addEventListener('touchmove', (ev) => {
    if (!pgSw) return;
    const p = ev.touches[0];
    const dx = p.clientX - pgSw.x0, dy = p.clientY - pgSw.y0;
    // ⚠️ **正在拖选文字 → 这根本不是滑动手势** ✗→✓（2026-10-11）——
    //   气泡现在**可以选中**了 ✓（长按出系统那套 ✓，见 app.css 那段 ✓），
    //   而"按住选完、再拖两头那个手柄"**也是一次横向 move** ✓ →
    //   不判的话：拖手柄会把右滑点亮 ✓ → 下面 `preventDefault` ✓ →
    //   **手柄当场拖不动** ✓ —— 一项新功能把另一项弄坏 ✓，
    //   而且症状离真因极远 ✗（"复制的时候选不中"✓，谁会怀疑到手势引擎头上 ✓）。
    //   ⚠️ 必须判在**每一次还没定方向的 move** 上 ✗ —— 不能只在 `touchstart` 判 ✓：
    //      选区是**长按之后**才冒出来的 ✓，那会儿这个手势早就开始了 ✓。
    if (!pgSw.dir) {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) { pgSw = null; hidePullHint(); return; }
    }
    if (!pgSw.dir) {
      if (Math.abs(dx) < SW_MIN2 && Math.abs(dy) < SW_MIN2) return;
      // ② 方向要**明确**才认 ✓（斜着划不算 ✓）
      if (Math.abs(dx) > Math.abs(dy) * 1.2) pgSw.dir = dx < 0 ? 'L' : 'R';
      else if (Math.abs(dy) > Math.abs(dx) * 1.2) pgSw.dir = dy > 0 ? 'D' : 'U';
      else { pgSw = null; hidePullHint(); return; }
      // ③ 这一屏上这个方向有没有意义？没有就把手势丢掉 ✓（免得吃掉正常滚动 ✓）
      const s = _whichScreen();
      const ok = (pgSw.dir === 'L' && s === 'chat')
              || (pgSw.dir === 'R' && s === 'comp')
              // ★ 2026-10-14：**右滑 `'wall'`（组件界面）不再认** ✗→✓ ——
              //   组件界面现在是**可横滑的卧室场景** ✓，右滑要拿来**平移看别处** ✓。
              //   认了的话 `preventDefault` 会把原生横滚吃掉 ✗ → 滑不动 ✗。
              //   退出改走**点猫 → 回主群聊** ✓ + 系统返回 ✓（见 `06-workshop.js:catNode` ✓）。
              // ★ **右滑引用** ✗→✓（2026-10-11）—— 两个条件**缺一不可** ✓：
              //   ① 屏幕是群聊 ✓
              //   ② **起手按着的是一条消息** ✓（`pgSw.row` ✓）
              //   ⚠️ 少了② 的话：在**顶栏、输入框、空白处**右滑也会被认下 ✓ →
              //      `preventDefault` 吃掉那一下 ✓、松手又什么都没发生 ✓
              //      —— 用户在那些地方右滑本来是有用的（比如选字 ✓），
              //      被我们白白吞掉 ✓。**认了就得给个交代** ✓，给不出就别认 ✓。
              || (pgSw.dir === 'R' && !!pgSw.row && s === 'chat');
      // ★ 2026-10-13：**下拉那一条撤了** ✗→✓ —— 只留群聊右上角一个入口进统一聊天 ✓
      //   （用户：「只留右上角入口」✓）。'D' 不再算手势 ✓ —— 下拉回到正常滚动 ✓。
      if (!ok) { pgSw = null; hidePullHint(); return; }
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
    if (pgSw.dir === 'L') showPullHint(_pullHintText(), -dx, SW_TRIG, true);
    // ★ **右滑那一条：行跟着手走一点** ✗→✓（2026-10-11）——
    //   ⚠️ **不跟手是不行的** ✗：右滑是个"短划" ✓，划完手指就抬了 ✓，
    //      中间没有任何反馈的话，用户根本分不清"我是划了还是滚了一下"✓
    //      （这个项目最烦的"做了像没做"✓）。
    //   ⚠️ 跟**一半不到**、而且**封顶** ✓ —— 走到 `QUOTE_TRIG` 就顶住不再走 ✓：
    //      再走就会把行推出屏幕 ✓（而那时候他其实已经可以松手了 ✓）。
    //   ⚠️ 那条跟手提示（`#pullHint`）**不给它** ✗ —— 那是给"换一个界面"用的 ✓
    //      （要拉得够、要那句话催他接着拉 ✓）；引用是**一次短划** ✓，
    //      在屏幕边上再浮出一行字，重得不相称 ✓。反馈由**行自己**给 ✓。
    else if (pgSw.dir === 'R' && pgSw.row) {
      if (qDragRow !== pgSw.row) { _endQuoteDrag(); pgSw.row.style.transition = 'none'; qDragRow = pgSw.row; }
      const d = Math.max(0, Math.min(QUOTE_TRIG, dx));
      qDragRow.classList.add('swiping');
      qDragRow.classList.toggle('quoteready', d >= QUOTE_TRIG);
      qDragRow.style.transform = d ? `translateX(${d}px)` : '';
    }
  }, { passive: false });

  const _endSwipe = () => {
    const s = pgSw;
    pgSw = null;
    // ⚠️ **一进门就收掉那根条** ✗→✓ —— 它是"手上正在做的那件事"的一部分 ✓，
    //    松手那一刻就该没 ✓（留着会变成"我刚才是不是滑过头了"这个疑问 ✓）。
    //    原来只在 `'D'` 那条分支里收 ✓ → 左滑也加提示之后就会**留在屏幕上** ✗。
    hidePullHint();
    // ⚠️ **跟手那行无论成不成都要收回原位** ✓ —— 见 `_endQuoteDrag` 那段 ✓。
    _endQuoteDrag();
    if (!s || !s.dir) return;
    // ★ **右滑 = 引用手里那条** ✗→✓（2026-10-11 用户：「将引用变为右滑消息」）——
    //   排在最前面 ✓：它和下面几条**按屏幕互斥** ✓（有 `row` 就一定是消息列表 ✓），
    //   写在最前头最不容易看错 ✓。
    if (s.dir === 'R' && s.row) {
      if (Math.abs(s.dx || 0) >= QUOTE_TRIG) {
        quoteChatMsg(Number(s.row.dataset.id));
      }
      return;
    }
    const far = Math.abs(s.dx || 0) >= SW_TRIG;
    if (!far) return;
    const scr = _whichScreen();
    if (s.dir === 'L' && scr === 'chat') { openWorkshop(); return; }
    if (s.dir === 'R' && scr === 'comp') { closeComp(); return; }
  };
  document.addEventListener('touchend', _endSwipe);
  // ⚠️ 取消（来电、系统抢手势…）也要**把那行收回原位** ✓ —— 不然它会**永远歪着** ✓
  //    （`touchend` 不一定会来 ✓，这种"少一个事件"的坑这个项目栽过 ✓）。
  document.addEventListener('touchcancel', () => { pgSw = null; hidePullHint(); _endQuoteDrag(); });

  // ★ DIY 助手整套已经撤掉 ✓ —— 工坊只剩组件展示 / 管理 ✓，
  //   组件和界面外观的修改现在由管理员在服务端做 ✓。

  // ★ 群聊右上角那颗「重新加载」（2026-10-20 从设置页挪过来的 ✓）。
  //
  //   ⚠️ 2026-10-23 换掉了原来的 `location.reload()` ✗ ——
  //      用户报"点刷新卡在加载页、只能划掉重进" ✓。走 `_appReload`：
  //      在 App 里重建 WebView（= 划掉重进那条路 ✓），浏览器里才 reload ✓。
  //      连点两下别开两次 ✓（重建那一两百毫秒里按钮还挂在那儿 ✓）。
  const _rb = $('#reloadBtn');
  let _rbBusy = false;
  if (_rb) _rb.onclick = () => {
    if (_rbBusy) return;
    _rbBusy = true;
    try { _rb.disabled = true; } catch (e) {}
    _appReload();
  };

  // ── 创意工坊（2026-10-07，右上角那个入口）────────────────────────────
