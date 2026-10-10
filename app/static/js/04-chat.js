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
        // ★ **工坊那条也得补** ✗→✓（2026-10-11）—— 见 `wsResync` 那段：
        //   原来重连只补群聊 ✓，工坊丢掉的收尾消息**永远回不来** ✓，
        //   而流式气泡**只有它才会被摘掉** ✓ → 屏幕上卡着半截回复 ✗。
        wsResync();
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
        // ★ **`reset`：把那个脏气泡整个摘掉** ✗→✓（2026-10-11）——
        //   服务端发现这一轮**只吐了"天书"**（`<dots_function_call>…` ✓）时会
        //   补问一轮干净的 ✓，补之前先推这一帧 ✓。
        //   ⚠️ 不摘的话，补出来的话会**接在天书后面** ✓ → 屏幕上还是那坨 ✓
        //      （用户看到的就是"回复有问题"✓）。
        //   ⚠️ 只摘**流式那条** ✓（还在跑的那个气泡 ✓）—— 落库的历史一条都不动 ✓。
        if (d.reset) {
          if (wsCur.streaming) {
            const row = wsCur.streaming.closest('.mkrow');
            if (row) row.remove();
            wsCur.streaming = null;
          }
          return;
        }
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
