  // 三种状态各一枚小图标 ✓（2026-10-24）—— 待机=钟 ✓ / 思考=对话泡里的点 ✓ /
  // 沉默=静音 ✓。只为了"扫一眼分得开"✓，不解释含义 ✓。
  const STATE_ICO = { idle: 'clock', thinking: 'talk', silent: 'mute' };

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
    // ★ 2026-10-24：右边那个尖换成**真描边 svg** ✓（原来是 `›` 文字字符 ✓ ——
    //   粗细和头像那边对不上 ✓，见 01-core.js 的 `arrow` ✓）。
    const go = mkel('span', 'go'); go.appendChild(ico('chev'));
    prof.appendChild(go);
    prof.onclick = openAgentEdit;
    m.appendChild(prof);

    // ★ 2026-10-24：一组行 = 一张卡 + 组头 ✓（`secG` / `icoBox` 在 05-settings.js ✓）。
    const rows1 = [];
    ['idle', 'thinking', 'silent'].forEach((k) => {
      const b = mkel('button', 'row');
      b.appendChild(icoBox(STATE_ICO[k]));
      b.appendChild(mkel('span', 'rl', KIND_LABEL[k]));
      // ⚠️ 右边原来写的是**四个字**「点击编辑」✗→✓（2026-10-09 用户定的：
      //   「管家那里的三个状态的点击编辑替换为 `>` 吧」✓）——
      //   换成那个 `›` ✓，和这一页的资料卡、我的那三行、设置页那几行**同一个记号** ✓
      //   （`›` 在整个 App 里就是"点得进去"✓；写成四个字反而是这里独有的形状 ✓）。
      const go = mkel('span', 'go'); go.appendChild(ico('chev'));
      b.appendChild(go);
      b.onclick = () => openStateScreen(k);
      rows1.push(b);
    });
    m.appendChild(secG(null, rows1));

    // ★ 管家的气泡（2026-10-27）✓ —— 入口在**这一屏** ✓（用户：「我的」和「管家」✓）。
    //   ⚠️ 它是**群级**的 ✓：管家没有账号 ✓，所以挂在群上 ✓；
    //      群里**谁都能改** ✓（用户原话：「管家的我们俩谁设置都可以」✓）。
    //      存的是 `groups.agent_bubble` ✓，改完广播 `group_update` ✓ → 两边一起变 ✓。
    m.appendChild(secG(null, [
      meRow('chat', '气泡', bubbleName(group && group.agent_bubble),
            () => openBubbleSet('agent')),
    ]));

    m.appendChild(secG(null, [promptBlock()]));
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

    // ★ 2026-10-14：原来保存下面还放了一颗「取消」✗ ——
    //   返回手势（右滑 / 原生返回）能干同样的事，那颗是多余的 ✓，整块 `swap` 拿掉。
    //   用户原话：「上面一个大保存按钮，下面一个小取消或者放回按钮……统一将取消或返回按钮去掉」✓。
    //   （`closeAgentEdit` 仍由 `__goBack` 在 agentEdit 屏那一支调用 ✓，不用按钮。）
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
    // ★★ **大图（灯箱）排最最前面** ✗→✓（2026-10-11）——
    //    它 `z-index:80` ✓，比确认框(60)还高 ✓ → 照"从上往下关"这条铁律 ✓，
    //    它必须排第一 ✓。
    //    ⚠️ **原来这一支根本没有** ✗ —— 灯箱一开 ✓，返回键就一路落到**底下那几屏**上 ✓，
    //      于是"屏幕一次次变、那张图纹丝不动" ✓ ——
    //      用户看到的就是「返回主群聊变成了那张图片」✓。**关不掉**才是最要命的那半 ✓。
    if ($('#lightbox').classList.contains('on')) { closeLightbox(); return; }
    // ⚠️ **确认框排最前面** ✓ —— 它在最上面（z-index 60 > 弹层 50 > 各屏 20 几 ✓），
    //    所以按返回该先关它 ✓（顺序就是"从上往下"✓，见下面那段 ✓）。
    if ($('#modal').classList.contains('on')) { if (modalClose) modalClose(); return; }
    // ⚠️ 这里原来有两支：长按那张小卡片（z 58 ✓）和"自由复制"那个文本框（z 57 ✓）——
    //    **2026-10-11 两个一起没了** ✓（用户：「长按消息不再有小卡片，就是默认系统的
    //    复制行为」✓）→ 返回键也就没有它们要关的了 ✓。
    // ★ 2026-10-28（P2/P3）：三张新弹层 ✓ —— 托盘 57 > 工具扇 56 > 管家面板 51 ✓，
    //   都**比弹层（sheet 50）高** ✓ → 照铁律排在 sheet 上面 ✓。
    //   ⚠️ 少一支的话，返回键会**隔着托盘把底下的屏关掉** ✓
    //     （屏幕上托盘纹丝不动 ✓ —— 又是"按了没反应"那个形状 ✓）。
    if ($('#tray').classList.contains('on')) { closeTray(); return; }
    if ($('#toolFan').classList.contains('on')) { closeToolFan(); return; }
    if ($('#butler').classList.contains('on')) { closeButler(); return; }
    if ($('#sheet').classList.contains('on')) { closeSheet(); return; }
    // ★ 创意工坊那几屏（2026-10-07）—— **压在管家那三屏上面** ✓：
    //   组件页 > 工坊 > 编状态 > 改资料 > 管家列表 > 群设置 ✓。
    // ⚠️ **顺序必须严格等于 z-index 从大到小** ✗→✓（2026-10-08 重排过一次）——
    //    它是"先关最上面那一屏"的意思 ✓；写反了的话按一下返回会**隔着两层
    //    关掉底下那层** ✓（屏幕上那一屏不动 ✓ —— 用户看到的是"按了没反应"✓）。
    //    加新屏时**照 z-index 插进来** ✓，别凭感觉往后面追加 ✗。
    // ★★ **2026-10-09：`#me` 那一族提到 30/31** ✗→✓ —— 它们现在**比工坊那一摞还高** ✓
    //    （用户报的"在组件聊天里点我的头像没反应"就是这条 ✓，见 CSS 那一段 ✓）。
    //    → 所以这一族要挪到**这里**（表的最前面）✓，不能再留在下面 ✗。
    // ★★ **气泡要排在「我的」那一族前面** ✗→✓（2026-10-27 晚）——
    //    它是从「我的」推进来的 ✓，而「我的」在 z 30 ✓、它自己 32 ✓（见 CSS 那段 ✓）。
    //    照"z-index 从大到小"这条铁律 ✓，它必须**排在 #meEdit / #me 之前** ✓：
    //    写在后头的话（一开始就是 ✗），返回键会先关掉**下面那层「我的」** ✓，
    //    气泡页留在屏幕上纹丝不动 ✓ —— 又是"按了没反应"那个形状 ✓。
    //    ⚠️ 现在它是**所有屏里最高的一层** ✓（32 ✓），所以在屏里排第一 ✓；
    //      以后再有比 32 高的屏，记得插到它上面 ✓。
    if ($('#bubbleSet').classList.contains('on')) { popScreen('bubbleSet'); return; }
    if ($('#meEdit').classList.contains('on')) { closeMeEdit(); return; }
    if ($('#me').classList.contains('on')) { closeMe(); return; }
    if ($('#peer').classList.contains('on')) { closePeer(); return; }
    if ($('#compView').classList.contains('on')) { closeComp(); return; }
    // ★ 2026-10-29：阁楼（z 25 ✓）—— 从屋里那扇小门 / 设置页那一行推进来的 ✓，
    //   压在提醒账本回忆墙(24)上面 ✓、在组件页(26)下面 ✓ → 照铁律插在这两行之间 ✓。
    //   ⚠️ 它里面还有一层（ARCH 的详情页 ✓）—— 后退的**第一下**要先退那一层 ✓，
    //     所以走 `atticBack()` ✓：它会先问 `contentWindow.__goBack()` ✓，
    //     里面说"我这儿还有一层"就停住 ✓（见 06-workshop.js 那个函数 ✓）。
    if ($('#attic').classList.contains('on')) { atticBack(); return; }
    // ★ 2026-10-28（P2）：提醒 / 账本 / 回忆墙（z 24 ✓）—— 从屋里点物件推进来的 ✓，
    //   压在今日(23)/工坊(22)上面 ✓、在组件页(26)下面 ✓ → 照铁律插在这两行之间 ✓。
    //   ⚠️ 三屏互不同时开 ✓（都从屋里推 ✓），谁开着关谁 ✓。
    if ($('#clock').classList.contains('on')) { hLeave('clock'); return; }
    if ($('#ledgerBook').classList.contains('on')) { hLeave('ledgerBook'); return; }
    if ($('#memoryWall').classList.contains('on')) { hLeave('memoryWall'); return; }
    // ★ 2026-10-28：今日明信片（z 23 ✓）—— 从屋里点窗推进来的 ✓，
    //   压在工坊(22)上面 ✓、在组件页(26)下面 ✓ → 照铁律插在这两行之间 ✓。
    if ($('#today').classList.contains('on')) { closeToday(); return; }
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
    // ★ **模型池那一屏** ✗→✓（2026-10-11）—— 它从设置页推出来 ✓，
    //   排在**设置之前** ✓（从哪进来就按哪儿的顺序退 ✓，和别的屏一个规矩 ✓）。
    //   ⚠️ 原来这一支**没有** ✗ —— 在模型页按返回会**落到设置页那一支** ✓，
    //     把设置关掉 ✓ → 用户看到的是"退多了" ✓（本该回到设置，结果回到了群聊 ✓）。
    // ★ **聊天背景**（2026-10-19）—— 和模型池一样从设置页推出来 ✓，
    //   所以排在**设置之前** ✓（从哪进来就按哪儿的顺序退 ✓）。
    if ($('#bgSet').classList.contains('on')) { popScreen('bgSet'); return; }
    // ★ **主题**（2026-10-19）—— 同样从设置页推出来 ✓，排在设置之前 ✓。
    //   ⚠️ 没这一支的话，在主题页按返回会**隔着它把设置关掉** ✓
    //      （屏幕不动、人退到了群聊 ✓ —— 见 `android-back-key-only-knows-settings` ✓）。
    if ($('#themeSet').classList.contains('on')) { popScreen('themeSet'); return; }
    // ★ 2026-10-23：读图不再是整屏子页 ✓ —— 它现在在 `#models` 里开半屏板子 ✓，
    //   返回键走上面那支 `#sheet` ✓（`closeSheet` ✓）。
    if ($('#models').classList.contains('on')) { popScreen('models'); return; }
    if ($('#settings').classList.contains('on')) { closeSettings(); return; }
    // ⚠️ `#login` / `#init` **刻意不列在这儿** ✗ —— 它们是**根屏** ✓：
    //   在它们上面按返回键，该走原生那条"再滑一次退出 App" ✓。
    //   列进来的话，`__goBack` 会把返回键吃掉却什么都不做 ✗ ——
    //   那正好是这个项目最讨厌的那种"死按钮" ✓。
  };

  // ── 登录 ──
