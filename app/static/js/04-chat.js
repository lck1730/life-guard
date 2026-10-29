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

  const fmtTime = s => {
    if (!s) return '';
    const d = new Date(s * 1000);
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  };

  // ── 日期胶带（2026-10-28 · 纸上小屋）──────────────────────────────
  //
  // 每换一天，消息流里插一条「和纸胶带」✓（`#msgs > .daytape` ✓，见 app.css ✓）。
  // 滚动时吸顶是 CSS 的 `position:sticky` 自己做的 ✓ —— 这里只管**什么时候插** ✓。
  //
  // ⚠️ 判断用**本机时区** ✓（和右边那个 `.time` 同一条口径 ✓）：
  //    库里存的是 UTC 秒 ✓，`new Date(s*1000)` 落到本机 ✓。
  //
  // ⚠️ **追加**和**往回翻**是两条路 ✗：
  //    · 追加（首屏 / 新消息）→ 在 `addMsg` 里跟前一条比一下就行 ✓；
  //    · 往回翻（`prepend`）→ 整段插完**重排一遍** ✓（`renderDays` ✓）——
  //      翻历史时是**倒着 prepend** ✓，边插边判会把同一天拆成好几条胶带 ✓。
  const dayKey = s => {
    const d = new Date(s * 1000);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  };
  const dayLabel = s => {
    const d = new Date(s * 1000), now = new Date();
    const same = (a, b) => a.getFullYear() === b.getFullYear()
      && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    const y = new Date(now); y.setDate(now.getDate() - 1);
    const md = (d.getMonth() + 1) + '月' + d.getDate() + '日';
    if (same(d, now)) return '今天 · ' + md;
    if (same(d, y)) return '昨天 · ' + md;
    if (d.getFullYear() !== now.getFullYear()) return d.getFullYear() + '年' + md;
    return md + ' · 周' + '日一二三四五六'[d.getDay()];
  };
  const mkTape = s => {
    const t = document.createElement('div');
    t.className = 'daytape';
    t.dataset.day = String(dayKey(s));
    t.textContent = dayLabel(s);
    return t;
  };
  /** 追加一条之后：跟前一条（跳过胶带和发送中的临时行）比日期，不一样就插一条。 */
  const tapeBefore = (row, ts) => {
    let prev = row.previousElementSibling;
    while (prev && !prev.dataset.ts) prev = prev.previousElementSibling;
    if (!prev || dayKey(+prev.dataset.ts) !== dayKey(ts)) {
      row.parentNode.insertBefore(mkTape(ts), row);
    }
  };
  /** 往回翻之后：把胶带全拆了、按顺序重排一遍（`loadOlder` 里调一次 ✓）。 */
  const renderDays = () => {
    const box = $('#msgs');
    box.querySelectorAll('.daytape').forEach(t => t.remove());
    let last = '';
    for (const el of Array.from(box.children)) {
      if (!el.dataset || !el.dataset.ts) continue;
      const k = String(dayKey(+el.dataset.ts));
      if (k !== last) { box.insertBefore(mkTape(+el.dataset.ts), el); last = k; }
    }
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
    // ★ 2026-10-29：被擦掉的那行只有一个说法 ✓ —— 别再说"[图片]" ✓
    //   （正文已经没了 ✓，说有个图片会让人去找一张不存在的图 ✗）。
    if (m.deleted) return '（这行被擦掉了）';
    if (m.msg_type === 'image') return '[图片]';
    if (m.msg_type === 'sticker') return '[表情] ' + (stickerName(m) || '');
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
    // ★ 2026-10-29：引用的那条**被擦掉了** ✓ —— 引用条跟着变成一句"擦掉了" ✓。
    //   ⚠️ 记下 `qid` ✓：擦除是**后来的**事 ✓，得能回头找到在屏上的这几条 ✓。
    el.className = 'quote' + (q.deleted ? ' quote-gone' : '');
    el.dataset.qid = q.id;
    const who = document.createElement('div'); who.className = 'qwho';
    who.textContent = quoteWho(q);
    const tx = document.createElement('div'); tx.className = 'qtext';
    tx.textContent = q.deleted ? '（这行被擦掉了）' : (q.content || '');
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
    // ★ 2026-10-29：**擦掉的那行** ✓ —— 不画气泡，画一道擦痕 ✓（见 `paintGone` ✓）。
    if (m.deleted) {
      _msgs.set(m.id, m);
      const gone = paintGone(m);
      if (prepend) $('#msgs').prepend(gone);
      else { $('#msgs').appendChild(gone); tapeBefore(gone, m.created_at); scrollDown(); }
      return;
    }
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
      sys.dataset.ts = m.created_at;         // 日期胶带靠它 ✓
      if (prepend) $('#msgs').prepend(sys);
      else { $('#msgs').appendChild(sys); tapeBefore(sys, m.created_at); scrollDown(); }
      return;
    }
    const mine = m.sender_id !== null && m.sender_id === me.id;
    const isAgent = m.sender_type === 'agent';
    const row = document.createElement('div');
    row.className = 'row' + (mine ? ' mine' : '') + (isAgent ? ' agent' : '');
    row.dataset.id = m.id;
    row.dataset.ts = m.created_at;            // 日期胶带靠它 ✓
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
        // ⚠️ 措辞改过 ✗→✓（2026-10-11）：原来写的是"长按**引用**那一下"✓ ——
        //    引用早就不在长按上了 ✓（现在长按头像是 @ 他 ✓、引用是右滑 ✓）。
        //    留着旧说法，下一个人会照着它去找一个不存在的"长按引用"✓。
        if (pressFired) return;         // 长按那一下 ✓，不是点头像 ✓
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
      b.classList.add('media', 'photo');
      const img = document.createElement('img');
      img.src = '/media/' + m.media_path;
      img.loading = 'lazy';
      // 图片撑开高度会改变"底部"，所以在底部时跟着再滚一次（见 scrollDown 的说明）
      img.onload = () => scrollDown();
      img.onclick = () => openLightbox(img.src, m.id);   // ★ 带 id → 可以「收进回忆」✓
      b.appendChild(img);
    } else if (m.msg_type === 'sticker') {
      // ★ 表情（2026-10-27）：**图就是气泡** ✓ —— 没有底板、没有补白 ✓。
      //   路径取消息里存的那一份（带发送时的版本号 ✓），老消息不会被新图换掉 ✓。
      b.classList.add('media', 'sticker');
      const src = stickerUrl(m);
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = stickerName(m);
        img.loading = 'lazy';
        img.onload = () => scrollDown();
        img.onclick = () => openLightbox(src, m.id);   // ★ 带 id → 可以「收进回忆」✓
        b.appendChild(img);
      } else {
        b.textContent = '[表情]';
      }
    } else if (m.msg_type === 'file' && m.media_path) {
      b.classList.add('media', 'file-note');
      b.appendChild(fileCard(m));
    } else if (m.msg_type === 'audio' && m.media_path) {
      b.classList.add('media');
      b.appendChild(audioBar(m));
    } else if (m.msg_type === 'voice') {
      b.classList.add('voice-note');
      const v = document.createElement('div');
      v.className = 'vmsg';
      // ★ 2026-10-28：原来那三个 `▮` 换成一段画出来的声纹 ✓。
      //   高度是一串写死的数 ✓ —— 只做样子，不解码音频 ✓。
      //   撕口由 CSS 画在气泡右边 ✓（`.bubble.voice-note`）。
      const wave = document.createElement('span');
      wave.className = 'wave';
      for (const h of [5, 9, 6, 12, 8, 14, 10, 6, 13, 8, 15, 9, 6, 11, 7, 10]) {
        const bar = document.createElement('i');
        bar.style.height = h + 'px';
        wave.appendChild(bar);
      }
      v.appendChild(wave);
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
    // ★ 盖章（2026-10-29）：章挂在气泡**下面** ✓（不是气泡里面 ✗ ——
    //   塞进气泡会改字距、还会被气泡尾巴切掉 ✓）。
    const st = document.createElement('div');
    st.className = 'stamps';
    paintStampChips(st, m.stamps || [], false);
    w.append(who, b, st, t); row.append(av, w);
    // ★ 气泡（2026-10-27）：**这一行是谁的，就用谁现在选的那款** ✓
    //   （按成员表查 ✓，消息里那份只是成员表还没到时的兜底 ✓，见 `bubbleForMsg` ✓）。
    setRowBubble(row, m);
    if (prepend) $('#msgs').prepend(row);
    else { $('#msgs').appendChild(row); tapeBefore(row, m.created_at); scrollDown(); }
    _fire('message', m, row);   // agent 的 ui/app.js 可以给这一条挂东西
  };

  // ── 擦掉的那一行（2026-10-29）──────────────────────────────────────
  //
  // ★ 擦掉 = **留一道擦痕** ✓，不是让那句话无声消失 ✓。行**留在原位** ✓：
  //   · 引用条 / 日期胶带靠它占位 ✓ —— 抽掉整行下面会整页往上跳 ✗；
  //   · 另一个人得**看得见**"这行不在了" ✓ —— 否则他会以为自己漏看了 / 网断了 ✗。
  //   正文和附件路径在库里已经清空 ✓（见 `core/messages.py` 的 `erase_message` ✓），
  //   这儿画的只是一句"这里曾经有一行" ✓。
  const paintGone = (m) => {
    const row = document.createElement('div');
    row.className = 'row gone';
    row.dataset.id = m.id;
    row.dataset.ts = m.created_at;          // 日期胶带照样认它 ✓
    const line = mkel('div', 'gone-line');
    line.appendChild(ico('eraser', 'gi'));
    line.appendChild(document.createTextNode('这行被擦掉了'));
    row.appendChild(line);
    return row;
  };

  /** 把一条**已经在屏上**的消息原地换成擦痕 ✓（自己擦的 / WS 推来的 / 重连补的 ✓）。 */
  const eraseRowLocal = (m) => {
    if (!m || m.id == null) return;
    const old = $('#msgs').querySelector(`[data-id="${m.id}"]`);
    if (old) old.replaceWith(paintGone(m));
    // `_msgs` 换成擦掉后的那一份 ✓ —— 右滑引用 / 长按 @ 都从这儿取 ✓。
    _msgs.set(m.id, m);
    // 输入框上正挂着它当引用 → 引用条也得改 ✓（不然还显示原来那句话 ✗）
    if (pendingQuote && pendingQuote.id === m.id) {
      pendingQuote = m;
      $('#qtext').textContent = quoteText(m);
    }
    // 别人回复里引用着它 → 那几条引用条一起换 ✓（见 `buildQuoteEl` 的 `qid` ✓）
    $$(`#msgs .quote[data-qid="${m.id}"]`).forEach(q => {
      q.classList.add('quote-gone');
      const tx = q.querySelector('.qtext');
      if (tx) tx.textContent = '（这行被擦掉了）';
    });
  };

  // ── 盖章（2026-10-29 · 纸上小屋 P4「盖章反应」）─────────────────────
  //
  // ★ 一枚章 = (这条消息, 谁, 哪一种) ✓。**自己朱红、对方靛蓝** ✓ ——
  //   同一条上叠着，就像两个人真的在同一张纸上各盖了一下 ✓。
  // ⚠️ 不是"点赞" ✗：这里没有计数、没有排行榜 ✓，只看得见**谁盖的** ✓
  //   （颜色分人 ✓，点一下发下去再点一下拿下来 ✓）。
  // ⚠️ 章**不进提示词、不进记忆** ✓（和配饰 / 气泡 / 便签同一档 ✓）——
  //   这是屋子里的东西 ✓，管家不听不看 ✓。
  const STAMP_ICON = { like: 'heart', paw: 'paw', star: 'star' };
  const STAMP_NAME = { like: '喜欢', paw: '爪印', star: '厉害' };

  /** 画一小排章 ✓。`animate` 只给**刚落下的那一枚**用 ✓（开页时不放动画 ✗）。 */
  const paintStampChips = (host, stamps, animate) => {
    if (!host) return;
    const before = new Set([...host.querySelectorAll('.stamp-chip')].map(c => c.dataset.k));
    host.textContent = '';
    const list = stamps || [];
    list.forEach((s, i) => {
      if (!STAMP_NAME[s.stamp]) return;          // 老数据 / 不认识的章：不画 ✓
      const key = s.user_id + ':' + s.stamp;
      const mine = !!(me && s.user_id === me.id);
      const c = mkel('span', 'stamp-chip' + (mine ? ' mine' : '') + ' s-' + s.stamp);
      c.dataset.k = key;
      c.title = (mine ? '我' : 'TA') + '盖的「' + STAMP_NAME[s.stamp] + '」';
      c.appendChild(ico(STAMP_ICON[s.stamp]));
      // 轻微歪一点 ✓ —— 手盖的章不会笔直 ✓（同一排里角度各不相同 ✓）。
      c.style.setProperty('--tilt', ((-7 + (i * 5) % 13) + 'deg'));
      if (animate && !before.has(key)) c.classList.add('drop');
      host.appendChild(c);
    });
    host.classList.toggle('on', list.length > 0);
  };

  /** 一条消息的章变了（自己盖的 / WS 推来的 ✓）—— 原地换那一小排 ✓。 */
  const updateStamps = (mid, stamps, animate) => {
    const row = $('#msgs').querySelector(`[data-id="${mid}"]`);
    if (!row) return;
    const host = row.querySelector('.stamps');
    if (host) paintStampChips(host, stamps, animate);
  };

  /** 盖一下 / 拿下来 ✓（服务端一开一关 ✓，见 `api/groups.py` 的 `stamp_message` ✓）。 */
  const applyStamp = async (m, stamp) => {
    if (!m || !group) return;
    try {
      const d = await api(`/groups/${group.id}/messages/${m.id}/stamps`, {
        method: 'POST',
        body: JSON.stringify({ stamp: stamp }),
      });
      m.stamps = (d && d.stamps) || [];
      _msgs.set(m.id, m);
      updateStamps(m.id, m.stamps, true);
      if (d && d.mine) { sfx('paper'); haptic('soft'); toast('盖上了「' + (STAMP_NAME[stamp] || '') + '」'); }
      else { haptic('soft'); toast('拿下来了'); }
    } catch (e) { toast(e.message || '没盖上'); }
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
      // ★ 2026-10-28：倒着 prepend 完，把日期胶带整体重排一遍 ✓
      //   （边插边判会把同一天拆成好几条 ✓，见 `renderDays` 的说明 ✓）。
      //   ⚠️ 必须在补滚动位置**之前** ✔ —— 插胶带会改 scrollHeight ✓。
      renderDays();
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
    // ★ 2026-10-28：往上翻了才让红丝带出来 ✓（一条也放不下的时候不出现 ✓）
    $('#ribbon').classList.toggle('on', !stickBottom && b.scrollHeight > b.clientHeight + 120);
    if (b.scrollTop < 60) loadOlder();      // 滚到顶 → 往回翻历史
  });
  // 点红丝带 = 回到底部 ✓（`scrollDown(true)` 会顺手把 stickBottom 扳回 true ✓）
  $('#ribbon').onclick = () => scrollDown(true);

  // ── 夜聊（2026-10-29）──────────────────────────────────────────────
  // ★ 十点以后，聊天自己**关灯** ✓ —— 只关这一屏 ✓。
  //   ⚠️ 挂在 `#chat` 上（不是 body ✓）：设置页 / 屋子 / 回忆墙照样亮 ✓。
  //   ⚠️ **不存** ✓（和"夜灯"不一样 ✓）—— 夜灯是他手动开就一直开 ✓；
  //      夜聊是"这会儿天黑了" ✓，按钟来 ✓，下次打开重新判断 ✓。
  //      大白天推开门是一屋子黑，那不是浪漫，是吓人 ✓。
  //   ⚠️ 只改 `--paper*` / 气泡那几个变量 ✓（和夜灯同一套值 ✓）——
  //      正文颜色不动 ✓，对比度靠 `--text` 撑住 ✓（这条规矩全项目一致 ✓）。
  const NIGHT_HOUSE = {
    '--bg': '#171310', '--panel': '#221b15', '--panel2': '#2b221a',
    '--text': '#f2e7d4', '--muted': '#b8a68a', '--line': '#3a2f24',
    '--accent': '#e0a45e', '--accent-bg': '#3a2a1c', '--on-accent': '#1a1208',
    '--accent-a': 'rgba(224,164,94,.16)', '--accent-line': '#5a4530',
    '--accent-soft': 'rgba(224,164,94,.10)', '--hover': '#2a2119',
    '--avatar-bg': '#332a20', '--quote-bg': 'rgba(224,196,160,.14)',
    '--bubble-bg': 'rgba(48,39,30,.70)', '--bubble-agent-bg': 'rgba(40,32,24,.76)',
    '--bubble-mine-bg': 'rgba(96,62,32,.62)',
    '--danger': '#e08a78', '--danger-soft': 'rgba(224,138,120,.35)',
    '--bg-scrim': 'rgba(0,0,0,.30)', '--ok': '#7fbf8a', '--warn': '#e0b45c',
    '--bad': '#e08578', '--warn2': '#d8b06a',
    '--shadow-md': '0 6px 24px rgba(0,0,0,.40)',
    '--shadow-lg': '0 18px 50px rgba(0,0,0,.52)',
    '--paper': '#241d17', '--paper-2': '#2b231b', '--paper-slip': '#31281f',
    '--paper-edge': '#3d3125', '--paper-rule': 'rgba(214,178,132,.10)',
    '--paper-margin': 'rgba(214,112,92,.24)', '--paper-grain': 'rgba(255,220,180,.03)',
    '--light-glow': 'rgba(255,186,100,.22)', '--light-wash': 'rgba(0,0,0,0)',
  };
  const _nightLight = () => {
    // 白天也点过夜聊的话，主题切走再回来照样是夜里 ✓（所以每次重挂一遍 ✓）
    const c = $('#chat');
    if (!c || !c.classList.contains('nightChat')) return;
    const tid = document.documentElement.dataset.theme || THEME_DEFAULT;
    if (tid !== 'cream' && tid !== 'light') return;   // 深色两套本来就是黑的 ✓，再叠只会糊 ✓
    Object.keys(NIGHT_HOUSE).forEach((k) => c.style.setProperty(k, NIGHT_HOUSE[k]));
  };
  const _nightClear = () => {
    const c = $('#chat');
    if (!c) return;
    Object.keys(NIGHT_HOUSE).forEach((k) => c.style.removeProperty(k));
  };
  const _isNightHour = () => { const h = new Date().getHours(); return h >= 22 || h < 6; };
  const paintNightPill = () => {
    const p = $('#nightPill');
    if (!p) return;
    const on = !!($('#chat') && $('#chat').classList.contains('nightChat'));
    p.classList.toggle('on', on || _isNightHour());
    p.classList.toggle('lit', on);
    p.setAttribute('aria-pressed', on ? 'true' : 'false');
    const t = p.querySelector('.np-t');
    if (t) t.textContent = on ? '开灯' : '夜聊';
    if (on) _nightLight(); else _nightClear();
  };
  if ($('#nightPill')) $('#nightPill').onclick = () => {
    const c = $('#chat');
    const on = !c.classList.contains('nightChat');
    c.classList.toggle('nightChat', on);
    if (on) { sfx('bell'); haptic('soft'); }   // 关灯不出声 ✓ —— 静下来才对 ✓
    paintNightPill();
  };
  paintNightPill();
  // ⚠️ 一个 5 分钟的小定时器足够 ✓（要跨过 22:00 / 6:00 才变 ✓，不必每分钟算 ✓）。
  try { setInterval(paintNightPill, 5 * 60 * 1000); } catch (e) {}
  window.__night = paintNightPill;   // 调试 / 截图钩子 ✓（和 __light 一样 ✓）

  // ── 长按消息 → 引用 ────────────────────────────────────────────────
  //
  // 挂**事件委托**在 #msgs 上，而不是每条消息各挂一个：气泡是动态加的，
  // 逐个挂就得在 addMsg 里挂、消息一多还要清理。
  let pressTimer = null;
  const PRESS_MS = 450;

  const cancelPress = () => {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
  };

  // ── 长按：头像 → @ 他；气泡 → **文具托盘** ✓（2026-10-28，P2）─────────
  //
  // ⚠️ **这条改过四次，把来路写清楚** ✗（不然下次又绕回来）：
  //     · 2026-10-07：让给浏览器 ✓（选中文字 → 系统那套自由复制 ✓）
  //     · 2026-10-08：收回来 ✓（弹一张小卡片：自由复制 / 引用 ✓）
  //     · 2026-10-11：卡片整个不要了 ✓（引用搬去右滑 ✓，长按交还系统 ✓）
  //     · 2026-10-28（现在）：**换成文具托盘** ✓ —— 引用 / 钉到墙上 /
  //       变成提醒 / 记一笔 / 复制 ✓（见 06-workshop.js 的 `openTray` ✓）。
  //
  // ★ 为什么又收回来了 ✓：这四个新动作**系统那排给不了** ✓；
  //   "自由复制"没有丢 ✓ —— 它挪进托盘第五格 ✓（`copyText` ✓，
  //   一键全选复制 ✓，比拖那两根手柄准 ✓）。
  // ⚠️ 气泡上的 `user-select` 跟着**关掉了** ✓（见 home.css 那段 ✓）——
  //   两套一起出来会打架 ✓（安卓的选择手柄还会把托盘压在下面 ✓）。
  const onPressStart = (e) => {
    if (!e.target.closest) return;
    const row = e.target.closest('#msgs .row[data-id]');
    if (!row) return;
    // ★ 2026-10-29：擦痕**不长按** ✓ —— 它上面没有气泡 / 头像 ✓，
    //   弹出"引用 / 钉到墙上"那套只会给出一堆对空白的动作 ✗。
    if (row.classList.contains('gone')) return;
    cancelPress();
    pressFired = false;
    const onAvatar = !!e.target.closest('.av');
    pressTimer = setTimeout(() => {
      pressTimer = null;
      pressFired = true;
      // 头像 → @ 他 ✓（这件事**没有别的手势替得了** ✓）；
      // 气泡 → 托盘 ✓（2026-10-28 ✓）。
      if (onAvatar) atFromRow(row);
      else openTray(row);
    }, PRESS_MS);
  };
  // ⚠️ 长按气泡时浏览器仍可能想弹"选词 / 分享"那层 ✓ —— 挡掉 ✓（只挡气泡 ✓）。
  $('#msgs').addEventListener('contextmenu', (e) => {
    if (e.target.closest && e.target.closest('.bubble')) e.preventDefault();
  });

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

  // ── ★ **引用：右滑一条消息** ✗→✓（2026-10-11 用户：「将引用变为右滑消息」）──
  //
  //   它 2026-10-07 在这儿待过两天 ✓（判据、阻尼、"↩ 引用"那条提示都挺好看 ✓），
  //   2026-10-08 撤掉换成了长按卡片 ✓ —— 当时的理由是"横滑要腾给进组件界面"✓。
  //   现在长按那条不要了 ✓ → 引用搬回横滑 ✓，但**只往右** ✓：
  //     · 往**左**永远归「进组件界面」✓（2026-10-09 用户点名"不能到处出现"✓）——
  //       一左一右**方向相反** ✓，所以两边**不抢** ✓（这是它能回来住下的前提 ✓）。
  //     · 往**右**在群聊上**本来是空的** ✓（引擎里那条只认 wall/comp ✓，也就是"往回退"✓），
  //       现在归引用 ✓。
  //
  //   ⚠️ 具体实现在**不在这儿** ✗ —— 它接进了 `05-settings.js` 那台手势引擎 ✓
  //      （左滑进收纳页、下拉进对话、"继续左滑…"那条跟手提示，**全在那一处** ✓）。
  //      "手势的大脑"只能有一台 ✓ —— 两处各接一套，迟早互相抢 ✓，
  //      或者只有一处知道"屏幕上现在是什么"✓（这个项目为"同一件事两处实现"栽过好几次 ✓）。
  //      这边只出两样 ✓：`quoteChatMsg`（把一条消息变成引用 ✓），
  //      以及 `.row` 上那点跟手位移要用的类名 ✓。

  /** ★ **把一条消息变成"引用"** ✗→✓（2026-10-11）—— 右滑那条手势唯一的落点 ✓。
   *
   *  ⚠️ 找不到就**什么都不做** ✗ —— 右滑引用的是**手里那条** ✓；
   *    万一 `_msgs` 里没有它（理论上不会 ✓），宁可没反应 ✓，
   *    也不能引用到"上一条碰过的消息"✓（那种错他根本没法察觉 ✓）。
   */
  const quoteChatMsg = (id) => {
    const m = _msgs.get(Number(id));
    if (m) setQuote(m);
  };


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
      // ★ 流式那一行也要穿管家的气泡 ✓（它有 `data-bubble-by` ✓，落库后清掉、
      //   由真正那条消息接着画 ✓；这中间换气泡也会被 `repaintBubbles` 重贴 ✓）。
      row.dataset.bubble = normBubble(group && group.agent_bubble);
      row.dataset.bubbleBy = 'agent';
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
        syncGone();                        // ★ 断线期间被擦掉的 ✓（见下 ✓）
        return;
      }
      if (pkt.type === 'message') { if (d.group_id === group.id) addMsg(d); }
      // ★ 2026-10-29：有人擦掉了一行 ✓ —— 在屏上的原地换掉 ✓。
      //   ⚠️ 已经是擦痕就不再动 ✓ —— 自己擦的那一下，HTTP 已经画过了 ✓，
      //     这条广播随后会再到一次 ✓（幂等 ✓）。
      else if (pkt.type === 'message_deleted') {
        if (d.group_id !== group.id) return;
        const row = $('#msgs').querySelector(`[data-id="${d.id}"]`);
        if (!row || !row.classList.contains('gone')) eraseRowLocal(d);
      }
      // ★ 2026-10-29：有人盖章 / 拿下来 ✓ —— 原地换那一小排 ✓。
      //   ⚠️ 自己盖的那一下 HTTP 已经画过了 ✓，这条广播随后会再到一次 ✓（幂等 ✓）。
      else if (pkt.type === 'message_stamp') {
        if (d.group_id !== group.id) return;
        const m = _msgs.get(d.message_id);
        if (m) { m.stamps = d.stamps || []; _msgs.set(d.message_id, m); }
        updateStamps(d.message_id, d.stamps || [], true);
      }
      // ★ `d.text` 要带上 ✗→✓ —— 服务端**已经挑好了**那一句 ✓
      //   （思考中/不打算说话是随机挑的 ✓）。丢了它就等于白挑 ✓。
      else if (pkt.type === 'agent_status') { if (d.group_id === group.id) setStatusTimed(d.state, d.text); }
      else if (pkt.type === 'agent_stream') {
        if (d.group_id !== group.id) return;
        if (d.done) { clearStream(); setStatus('idle'); } else appendStream(d.delta);
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

  /** ★ 2026-10-29：断线期间的**擦除**单独补 ✓。
   *
   *  ⚠️ `syncMissed` 补不到它 ✗ —— 那条按 id **递增**捞 ✓，只看得见"新到的" ✓；
   *     擦掉是**改**一条旧行 ✓（id 不变 ✓），永远落在那个窗口外面 ✓。
   *     所以重连后另拉最近一屏 ✓，只挑"现在已经是擦痕"的原地换掉 ✓。
   *     ⚠️ 只换、不新增 ✓ —— 历史交给 `loadOlder` ✓（这儿顺手补消息会打乱首次加载 ✓）。
   */
  const syncGone = async () => {
    if (!group) return;
    try {
      const msgs = await api(`/groups/${group.id}/messages?limit=80`);
      msgs.forEach(m => {
        if (!m.deleted) return;
        const row = $('#msgs').querySelector(`[data-id="${m.id}"]`);
        if (row && !row.classList.contains('gone')) eraseRowLocal(m);
      });
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
        // ★ 气泡（2026-10-27）：**换气泡就是靠这一趟广播回来的** ✓。
        //   服务端写完 `group_members.bubble` / `groups.agent_bubble` 会广播
        //   `group_update` ✓ → 这里重拉 ✓ → 下面 `repaintBubbles` 把在屏上的
        //   每一行按**现在的**成员表重贴 ✓。**历史消息不重发、不落库** ✓，
        //   所以"她改成猪猪"我这边一秒后就变 ✓，翻回去看老消息也一样是猪猪 ✓。
        const mineRow = (members || []).find(x => x.id != null && Number(x.id) === Number(me && me.id));
        if (mineRow) me.bubble = normBubble(mineRow.bubble);
        repaintBubbles();
        refreshWear();      // 配饰（2026-10-28 ✓：别人改了 → 广播 → 纸角那只也换 ✓）
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
    // ★ 2026-10-28：**手上有回应** ✓（纸声 + 轻震 ✓）—— 声音/触感各自有开关 ✓。
    sfx('paper'); haptic('soft');
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

  /** 选完一个附件 → 进群聊的待发区 ✓。 */
  const pickAdd = (file, kind) => {
    if (!file) return;
    addPending(file, kind);
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
  //   ⚠️ 全部进群聊的 `pending` 队列 ✓。
  $('#fileDoc').addEventListener('change', e => { pickAdd(e.target.files[0], 'file'); e.target.value = ''; });
  $('#fileAudio').addEventListener('change', e => { pickAdd(e.target.files[0], 'audio'); e.target.value = ''; });
  // ── ＋ ：**工具扇** ✓（2026-10-28，P2）──────────────────────────────
  //
  // ★ 原来是底部弹一张四格的"更多"卡片 ✓（相册 / 拍摄 / 文件 / 音频 ✓）。
  //   现在改成**从 + 那儿向上展开的一把扇子** ✓（见 06-workshop.js 的
  //   `openToolFan` ✓）—— 四样照旧 ✓，另外**多三样屋子里的东西** ✓
  //   （账本 / 提醒 / 回忆 ✓）。
  // ⚠️ 为什么实现挪进 06 ✓：扇子要**现算 + 的位置** ✓、还要调 `openLedger`
  //   那一套 ✓ —— 它们都在 06 那个 IIFE 里 ✓（04 只留这一行入口 ✓）。
  $('#pickMedia').onclick = () => openToolFan();

  // ── 表情包（2026-10-27）────────────────────────────────────────────
  //
  // ★ **编号 ⇄ 图**只认服务端那份清单 ✓：`static/stickers/stickers.json` ✓。
  //   前端**不抄编号表** ✗ —— 以后加表情只改清单 + 图 ✓。
  //   这里只做两件事：把清单缓一份到 localStorage（下次开页秒开 ✓），
  //   以及按清单预载缩略图（点开入口时不一格一格地跳 ✓）。
  //
  // ⚠️ 图片 URL 一定带 `?v=<清单版本>` ✓ —— 静态层见到它就回 immutable 长缓存 ✓；
  //    换版时只改清单的 `version` 和目录名 ✓，旧消息里存的旧 `?v=` 照旧能取到 ✓。
  const STICKER_CACHE = 'lg_stickers_v1';
  let stickerCatalog = { version: 0, categories: [], stickers: [] };
  try {
    const cached = JSON.parse(localStorage.getItem(STICKER_CACHE) || 'null');
    if (cached && Array.isArray(cached.stickers)) stickerCatalog = cached;
  } catch (e) {}
  let _stickerLoaded = false;

  const stickerImg = (s, thumb) => {
    if (!s) return '';
    // ⚠️ 清单里的路径是**相对 `/static`** 的 ✓（和 `core/stickers.py` 的 `media_path()` 一致 ✓）；
    //    少这一截就是 404 —— 2026-10-27 表情面板整片"碎图"就是这么来的 ✗。
    return '/static/' + (thumb && s.thumb ? s.thumb : s.file) + '?v=' + (stickerCatalog.version || 1);
  };
  const stickerById = (id) => {
    id = String(id || '');
    return (stickerCatalog.stickers || []).find(s => String(s.id) === id) || null;
  };
  /** 已落库的消息：用发送那一刻的路径 ✓；实在没有才按编号回查清单 ✓。 */
  const stickerUrl = (m) => {
    if (m && m.media_path) return '/static/' + m.media_path;
    return stickerImg(stickerById(m && m.content));
  };
  const stickerName = (m) => {
    const meta = (m && m.media_meta) || {};
    const s = stickerById(m && m.content);
    return meta.name || (s && s.name) || '';
  };
  const _esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const loadStickers = async () => {
    if (_stickerLoaded) return;
    _stickerLoaded = true;
    try {
      // 这份清单很小（几 KB），`/static` 没带 `?v=` 时是 no-store ✓，不会吃到旧版。
      const r = await fetch('/static/stickers/stickers.json', { credentials: 'same-origin' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      if (!data || !Array.isArray(data.stickers) || !data.stickers.length) return;
      stickerCatalog = data;
      try { localStorage.setItem(STICKER_CACHE, JSON.stringify(data)); } catch (e) {}
      data.stickers.forEach(s => { const im = new Image(); im.src = stickerImg(s, true); });
      if ($('#stLoading')) renderStickerSheet();   // 第一次进来时补画 ✓
    } catch (e) {
      _stickerLoaded = false;                       // 下次点开再试一次 ✓
      const box = $('#stLoading');
      if (box) box.textContent = '表情没拉到，检查一下网络再点开这个入口。';
    }
  };

  const renderStickerSheet = () => {
    const p = $('#sheetPanel');
    const all = stickerCatalog.stickers || [];
    if (!all.length) {
      p.innerHTML = `<div class="st-empty" id="stLoading">表情正在加载…<br>稍等一下；一直这样的话，退出去再进来一次。</div>
        <div class="actions"><button class="btn-solid" id="stOk">知道了</button></div>`;
      p.querySelector('#stOk').onclick = closeSheet;
      return;
    }
    // ⚠️ **管家那一组放最后** ✓（2026-10-28 用户）—— 群友的两套更常用。
    //    底色按类别固定 ✓（不按位置轮换 ✓），以后加组也不会把颜色挪乱 ✓。
    const cats = (stickerCatalog.categories || []).slice().sort((a, b) =>
      a.key === 'butler' ? 1 : b.key === 'butler' ? -1 : 0);
    const ST_TINT = { butler: 'st-g0', doctor: 'st-g1', coder: 'st-g2' };
    let html = '<div class="st-scroll">';
    cats.forEach((c, i) => {
      const items = all.filter(s => s.category === c.key);
      if (!items.length) return;
      // ★ 分组**只靠底色和圆角** ✓，一个字都不写 ✓（2026-10-27 用户：不要那么多字、
      //   不要文字分组 ✓）。颜色按清单顺序轮换 ✓，以后加组也不会挤在一起 ✓。
      html += `<div class="st-group ${ST_TINT[c.key] || 'st-g' + (i % 3)}"><div class="st-grid">` + items.map(s =>
        `<button class="st-item" data-sid="${_esc(s.id)}" aria-label="${_esc(s.name)}">
           <img loading="lazy" src="${stickerImg(s, true)}" alt="">
         </button>`).join('') + '</div></div>';
    });
    html += '</div>';
    p.innerHTML = html;
    p.querySelectorAll('.st-item').forEach(btn => {
      btn.onclick = () => {
        const s = stickerById(btn.dataset.sid);
        closeSheet();
        if (s) sendSticker(s);
      };
    });
  };

  $('#pickSticker').onclick = () => {
    renderStickerSheet();
    openSheet();
    loadStickers();
  };

  /** 发一张表情：**先上屏、再落库** ✓；客户端只报编号，路径由服务端补 ✓。 */
  const sendSticker = async (s) => {
    if (!s || !group) return;
    const tempId = 'st' + Date.now() + Math.random().toString(36).slice(2, 6);
    addTempBubble(tempId, 'sticker', stickerImg(s, false));
    scrollDown();
    // ★ 2026-10-28：表情发出去要有声 ✓ —— 一张贴纸的「啵」✓（不是系统音 ✓）。
    sfx('pop'); haptic('soft');
    try {
      const msg = await api(`/groups/${group.id}/messages`, {
        method: 'POST',
        body: JSON.stringify(Object.assign({
          msg_type: 'sticker',
          content: String(s.id),
        }, quoteField())),
      });
      clearQuote();
      // 正式消息可能已经从 WebSocket 先到了 ✓（和图片那条一样 ✓）
      if (!$('#msgs').querySelector(`[data-id="${msg.id}"]`)) addMsg(msg);
    } catch (e) {
      toast(e.message);
    } finally {
      removeTempBubble(tempId);
    }
  };

  loadStickers();   // 开页就预热：清单 + 缩略图 ✓（有缓存时零等待 ✓）

  // ★ **这张图是哪条消息** ✓（2026-10-29）—— 「收进回忆」要的是 `message_id` ✓。
  //   只有**已经落库**的那种调用点给得出 id ✓（`m.id` ✓）；
  //   本地刚发（`blob:` ✓）、回忆墙上的照片（墙上那张**本身就是回忆** ✓）都没有 ✓ → 藏按钮 ✓。
  let lightboxMsgId = null;
  const openLightbox = (src, msgId) => {
    lightboxMsgId = msgId ? Number(msgId) : null;
    $('#lightboxTxt').hidden = true;
    $('#lightboxImg').hidden = false;
    $('#lightboxImg').src = src;
    const memBtn = $('#lightboxMem');
    if (memBtn) memBtn.hidden = !lightboxMsgId;
    // ★ **能不能存，只看"这张图是不是已经落在服务器上"** ✗→✓（2026-10-11）——
    //   三个调用点给的 src 只有两种 ✓：
    //     · `img.src`（聊天里那条已经落库的图 ✓）→ **绝对 http 地址** ✓ → 能存 ✓
    //     · `blob:`（我自己刚发、还在传的那条 ✓）→ 原生**拿不到** ✓
    //       （blob 只在页面这个进程里有效 ✓）→ 藏起来 ✓
    //   ⚠️ 一个"点了没反应"的按钮**比没有按钮更糟** ✓（这个项目的老结论 ✓）。
    $('#lightboxSave').hidden = !/^https?:/.test(src);
    $('#lightbox').classList.add('on');
  };

  /**
   * ★ **关掉大图** ✗→✓（2026-10-11）—— 点任意处就关（微信那样 ✓）。
   *
   * ⚠️ **原来压根没有"关"这一半** ✗ —— 全仓只有 `classList.add('on')` ✓，
   *    一处 `remove` 都找不到 ✓，`__goBack` 里也没有它那一支 ✓ →
   *    **一旦点开就再也关不掉** ✓，除非整页重载 ✗。
   *    用户报的「返回主群聊变成了那张图片」有一半就是这个 ✓：
   *    灯箱盖在上面 ✓，而返回键关的是**底下那一屏** ✓ —— 屏幕一次次变 ✓，
   *    那张图纹丝不动 ✓（看着就像"主群聊变成了图片"✓）。
   */
  const closeLightbox = () => {
    $('#lightbox').classList.remove('on');
    // ⚠️ **`src` 要摘掉** ✗ —— 光摘 `.on` 只是把它藏起来 ✓，
    //    那张图还挂在 `<img>` 上 ✓：内存里那份**解码后的位图**还占着 ✓
    //    （手机上一张照片就是几十 MB ✓）。摘掉 src 浏览器才会回收 ✓。
    $('#lightboxImg').removeAttribute('src');
    lightboxMsgId = null;
  };
  // ⚠️ **能直接挂 onclick、不怕"点缩略图顺手把灯箱关了"** ✓ ——
  //    灯箱现在挂在 **body 底下** ✓（见 index.html 那段 ✓），
  //    **不再是缩略图的祖先** ✓ → 缩略图那一下**冒泡不到它** ✓。
  //    （它原来塞在群聊屏里的时候就得操这个心 ✓ —— 位置挪对了，这个坑自己就没了 ✓。
  //      "两个问题一个根因"在这类布局错里很常见 ✓，所以**先修位置** ✓。）
  $('#lightbox').onclick = () => closeLightbox();

  // ★ **保存到相册** ✗→✓（2026-10-11 用户：「需要保存」）——
  //   ⚠️ **网页自己做不到** ✗，这不是偷懒：`/media` 要同源 cookie ✓、
  //      而 WebView 里 `<a download>` / blob **没有任何下载器接着** ✓
  //      → 只能喊一声壳 ✓（`MainActivity` 的 `saveImage` ✓，它带 cookie 去取、
  //        写进系统相册 ✓）。
  //   ⚠️ **浏览器里没有 `LifeGuardNative`** ✓ —— 那句提示不是"出错了" ✓，
  //      是"这个动作只有 App 里才有" ✓（电脑上开网页时就是这种情况 ✓）。
  $('#lightboxSave').onclick = (ev) => {
    ev.stopPropagation();          // ⚠️ 别顺手把灯箱关了 ✓（按钮在灯箱里面 ✓）
    const src = $('#lightboxImg').getAttribute('src') || '';
    if (!src) return;
    // ⚠️ **两种"没有"要分开说** ✗ —— 它们的下一步完全不同 ✓：
    //   · 不在 App 里（电脑上开的网页 ✓）→ 说什么都没用 ✓，如实说 ✓
    //   · 在 App 里、但**壳是旧的**（没有这个方法 ✓）→ 该去**更新 App** ✓
    //   糊成一句"存不了"的话，他就不知道该干什么 ✓
    //   （这几行照老写法 ✓：`isNative` + 方法在不在 ✓，见上面 `takePhoto` ✓）。
    if (!isNative) { toast('保存到相册要在 App 里用（现在这个是浏览器）'); return; }
    if (!window.LifeGuardNative.saveImage) {
      toast('这个版本的 App 还不会存图 —— 更新一下 App 再试');
      return;
    }
    window.LifeGuardNative.saveImage(src);   // 存没存上由壳那边 toast 回话 ✓
  };

  // ★ **收进回忆**（2026-10-29）—— 看见一张图，当场就能钉到墙上 ✓。
  //   和长按托盘里的「钉上墙」走**同一个口子** ✓（`POST /memories` + `message_id` ✓），
  //   服务端自己去消息里抓快照 ✓、还带查重 ✓（钉过的再钉一次不会多一张 ✓）。
  if ($('#lightboxMem')) $('#lightboxMem').onclick = async (ev) => {
    ev.stopPropagation();              // ⚠️ 别顺手把灯箱关了 ✓（按钮在灯箱里面 ✓）
    const btn = $('#lightboxMem');
    if (!lightboxMsgId || btn.dataset.busy === '1') return;
    btn.dataset.busy = '1';
    btn.textContent = '收着…';
    try {
      const d = await api(`/groups/${group.id}/memories`, {
        method: 'POST',
        body: JSON.stringify({ message_id: lightboxMsgId }),
      });
      sfx('pop'); haptic('soft');
      toast(d && d.duplicated ? '这张已经在墙上了' : '收进回忆了');
      closeLightbox();
    } catch (e) {
      toast('没收进去，再试一下');
    } finally {
      btn.dataset.busy = '';
      btn.textContent = '收进回忆';
    }
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
    // ★ 自己那条"先上屏"的也要立刻是对的气泡 ✓（不然传完一换，气泡跳一下 ✓）。
    row.dataset.bubble = bubbleOfMember(me && me.id);
    row.dataset.bubbleBy = (me && me.id != null) ? 'u' + me.id : '';
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
    } else if (kind === 'sticker') {
      // 表情也是"先上屏、后落库" ✓ —— 本地缓存命中时和已发出的一模一样 ✓
      b.classList.add('media', 'sticker');
      const img = document.createElement('img');
      img.src = url;
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
    if (kind !== 'sticker') {
      const st = document.createElement('div'); st.className = 'vsub';
      st.textContent = '发送中…';
      b.appendChild(st);
    }
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
