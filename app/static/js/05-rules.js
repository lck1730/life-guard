/**
 * 「规矩」—— 每周上限 / 每周任务。
 *
 * 用户 2026-11-22：「新增一个立规矩板块……比如说每周能吃几次放纵餐，喝几杯
 * 奶茶小甜水之类，以及每周要做什么事情……主要由管家去添加规矩以及督促……
 * 这个可视化界面入口……第五个板块，注重于界面美观简洁和管家的感知与操作」。
 *
 * 这一屏上**没有一句功能说明** ✓ —— 看到的都是规矩本身和本周进度 ✓。
 * 管家那边：每轮系统提示里已经有进度（`app/core/rules.py` 的 `prompt_section` ✓），
 * 操作走插件工具 ✓；这里只是同一份数据的界面 ✓。
 *
 * ⚠️ 它是一屏整屏子页 ✓ → `_OTHER_SCREENS` 里要有 `#rules` ✓、
 *    `__goBack` 里要有一支 ✓（见 `android-back-key-only-knows-settings` ✓）。
 * ⚠️ 立规矩 / 改规矩的纸片**住在 `#rules` 里面** ✓ —— 返回键先收它 ✓。
 */

// ── 状态 ────────────────────────────────────────────────────────────
let rlState = {
  weekStart: 0,
  weekEnd: 0,
  weekLabel: '',
  rules: [],
  summary: { total: 0, kept: 0 },
  loading: false,
  error: '',
  seq: 0,
  busy: false,
  editing: 0,          // 0 = 新立一条；否则是正在改的那条 id ✓
  kind: 'limit',
  target: 2,
  icon: 'star',
};

//: 和 `app/core/rules.py` 的 `ICONS` 一一对应 ✓（名字对不上就画个星兜底 ✓）。
const RL_ICONS = {
  food:
    '<path d="M4 11.2h16a8 8 0 0 1-16 0Z"/>' +
    '<path d="M9 8V6.2M12 8V5.4M15 8V6.2"/>',
  drink:
    '<path d="M6.2 7.5h11.6l-1.1 11.2a2 2 0 0 1-2 1.8H9.3a2 2 0 0 1-2-1.8Z"/>' +
    '<path d="M7.2 11.5h9.6M12.6 7.5 16 3.2"/>',
  run:
    '<circle cx="14.2" cy="5.2" r="1.8"/>' +
    '<path d="M13 8.2 10.2 12l3.2 1.4-1.2 5.8M10.2 12 7 10.4M13.4 13.4l3.4 1.8 2.2 4.2"/>',
  book:
    '<path d="M12 6.4C9.8 4.9 7.2 4.6 4.2 5.3v12.6c3-.7 5.6-.4 7.8 1.1 2.2-1.5 4.8-1.8 7.8-1.1V5.3c-3-.7-5.6-.4-7.8 1.1Z"/>' +
    '<path d="M12 6.4V19"/>',
  moon:
    '<path d="M19.5 14.4A7.8 7.8 0 0 1 9.6 4.5 8 8 0 1 0 19.5 14.4Z"/>',
  heart:
    '<path d="M12 20s-7.1-4.3-8.5-8.1C2.4 8.7 4.4 5.6 7.7 5.6c1.9 0 3.3 1.1 4.3 2.6 1-1.5 2.4-2.6 4.3-2.6 3.3 0 5.3 3.1 4.2 6.3C19.1 15.7 12 20 12 20z"/>',
  star:
    '<path d="M12 3.8l2.45 4.96 5.48.8-3.97 3.86.94 5.46L12 16.3l-4.9 2.58.94-5.46-3.97-3.86 5.48-.8z"/>',
  leaf:
    '<path d="M19.5 4.5C12 4.5 6.3 8.1 6.3 14.2c0 2 .8 3.6 2 4.8 5.7.5 11.2-4.1 11.2-14.5Z"/>' +
    '<path d="M4.5 20c2.3-4.6 5.2-7.2 9.3-9.4"/>',
  spark:
    '<path d="M12 3.5c.7 4.7 2.3 6.3 7 7-4.7.7-6.3 2.3-7 7-.7-4.7-2.3-6.3-7-7 4.7-.7 6.3-2.3 7-7Z"/>' +
    '<path d="M19 16.5c.3 1.8.9 2.4 2.7 2.7-1.8.3-2.4.9-2.7 2.7-.3-1.8-.9-2.4-2.7-2.7 1.8-.3 2.4-.9 2.7-2.7Z"/>',
  clock:
    '<circle cx="12" cy="12" r="8.2"/>' +
    '<path d="M12 7.4V12l3.1 2"/>',
};

const RL_KIND_TEXT = {
  limit: '不超过',
  task: '要做到',
};

const rlIconSvg = (name) => (
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" ' +
  'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
  'stroke-linejoin="round" aria-hidden="true">' +
  (RL_ICONS[name] || RL_ICONS.star) +
  '</svg>'
);

const rlEl = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

// ── 周 ──────────────────────────────────────────────────────────────
const rlMonday = (d) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const off = (x.getDay() + 6) % 7;       // 周一=0 ✓
  x.setDate(x.getDate() - off);
  return x;
};

const rlPad = (n) => String(n).padStart(2, '0');

const rlRangeText = (start, end) => {
  const a = new Date(start * 1000);
  const b = new Date(end * 1000 - 1000);
  if (a.getFullYear() !== b.getFullYear()) {
    return a.getFullYear() + '年' + (a.getMonth() + 1) + '月' + a.getDate() + '日–' +
      b.getFullYear() + '年' + (b.getMonth() + 1) + '月' + b.getDate() + '日';
  }
  return (a.getMonth() + 1) + '月' + a.getDate() + '日–' +
    (b.getMonth() + 1) + '月' + b.getDate() + '日';
};

const rlFallbackWeek = () => {
  const start = rlMonday(new Date());
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  rlState.weekStart = Math.floor(start.getTime() / 1000);
  rlState.weekEnd = Math.floor(end.getTime() / 1000);
  rlState.weekLabel = rlRangeText(rlState.weekStart, rlState.weekEnd);
};

const rlRenderWeek = () => {
  if (!rlState.weekStart) rlFallbackWeek();
  $('#rlRange').textContent = rlState.weekLabel ||
    rlRangeText(rlState.weekStart, rlState.weekEnd);

  const start = new Date(rlState.weekStart * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const names = ['一', '二', '三', '四', '五', '六', '日'];

  const days = $('#rlDays');
  days.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const cell = rlEl('span', 'rl-day');
    if (d.getTime() === today.getTime()) cell.classList.add('on');
    cell.append(rlEl('i', 'rl-dn', names[i]), rlEl('b', 'rl-dd', String(d.getDate())));
    days.append(cell);
  }

  const total = rlState.rules.length;
  const kept = rlState.rules.filter(r =>
    r.status === 'ok' || r.status === 'full' || r.status === 'done').length;
  rlState.summary = { total, kept };
  const sum = $('#rlSum');
  sum.hidden = total === 0;
  sum.textContent = total
    ? total + ' 条规矩 · ' + kept + ' 条守住了'
    : '';
};

// ── 一条规矩 ────────────────────────────────────────────────────────
const rlStatusText = (rule) => {
  const base = rule.count + '/' + rule.target;
  if (rule.kind === 'limit') {
    if (rule.status === 'over') return base + ' · 超了 ' + rule.over + ' 次';
    if (rule.status === 'full') return base + ' · 到顶了';
    return base + ' · 还能 ' + rule.remaining + ' 次';
  }
  if (rule.status === 'done') return base + ' · 做到了';
  return base + ' · 还差 ' + rule.remaining + ' 次';
};

const rlToast = (rule) => {
  if (rule.kind === 'limit') {
    if (rule.status === 'over') return '记下了 · 这次超了 ' + rule.over + ' 次';
    if (rule.status === 'full') return '记下了 · 刚好到顶';
    return '记下了 · 还能 ' + rule.remaining + ' 次';
  }
  return rule.status === 'done'
    ? '记下啦 · 做到了'
    : '记下了 · 还差 ' + rule.remaining + ' 次';
};

const rlCard = (rule) => {
  const card = rlEl('article', 'rl-card st-' + rule.status);
  card.dataset.id = String(rule.id);

  const top = rlEl('div', 'rl-top');
  const tap = rlEl('button', 'rl-htap');
  tap.type = 'button';
  tap.setAttribute('aria-label', '改「' + rule.title + '」');
  const ico = rlEl('span', 'rl-ico');
  ico.innerHTML = rlIconSvg(rule.icon);      // 静态白名单 SVG ✓
  const hx = rlEl('span', 'rl-hx');
  hx.append(rlEl('span', 'rl-title', rule.title),
            rlEl('span', 'rl-sub', '每周' + RL_KIND_TEXT[rule.kind] + ' ' + rule.target + ' 次'));
  tap.append(ico, hx);
  tap.onclick = () => rlOpenComposer(rule);

  const ops = rlEl('div', 'rl-ops');
  const minus = rlEl('button', 'rl-op', '−');
  minus.type = 'button';
  minus.setAttribute('aria-label', '撤销一次');
  minus.disabled = rule.count < 1;
  minus.onclick = () => rlUndo(rule);
  const plus = rlEl('button', 'rl-op plus', '+');
  plus.type = 'button';
  plus.setAttribute('aria-label', '记一次');
  plus.disabled = rule.kind === 'task' && rule.count >= rule.target;
  plus.onclick = () => rlLog(rule);
  ops.append(minus, plus);

  top.append(tap, ops);
  card.append(top);

  if (rule.note) card.append(rlEl('p', 'rl-note', rule.note));

  const bar = rlEl('div', 'rl-bar');
  const fill = rlEl('i');
  const pct = rule.target > 0 ? Math.min(100, (rule.count / rule.target) * 100) : 0;
  fill.style.width = pct + '%';
  bar.append(fill);
  card.append(bar);

  const foot = rlEl('div', 'rl-foot');
  if (rule.target <= 8) {
    const dots = rlEl('span', 'rl-dots');
    for (let i = 0; i < rule.target; i++) {
      const dot = rlEl('i');
      if (i < Math.min(rule.count, rule.target)) dot.classList.add('on');
      dots.append(dot);
    }
    foot.append(dots);
  }
  foot.append(rlEl('span', 'rl-state', rlStatusText(rule)));
  card.append(foot);
  return card;
};

const rlSkeleton = () => {
  for (let i = 0; i < 3; i++) {
    const sk = rlEl('div', 'rl-skel');
    sk.append(rlEl('i', 'rl-skel-line w1'), rlEl('i', 'rl-skel-line w2'),
              rlEl('i', 'rl-skel-line w3'));
    $('#rlList').append(sk);
  }
};

const rlEmpty = (kind) => {
  const box = rlEl('div', 'rl-empty' + (kind === 'error' ? ' error' : ''));

  if (kind === 'error') {
    const art = rlEl('span', 'rl-empty-art');
    art.innerHTML =
      '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
      '<path d="M12 7.5v5.2M12 16.3v.2"/><circle cx="12" cy="12" r="8.4"/></svg>';
    box.append(art,
               rlEl('p', 'rl-empty-t', '这会儿没连上'),
               rlEl('p', 'rl-empty-s', rlState.error || ''));
    const retry = rlEl('button', 'rl-empty-btn', '再试一次');
    retry.type = 'button';
    retry.onclick = () => rlLoad(false);
    box.append(retry);
    return box;
  }

  const art = rlEl('span', 'rl-empty-art');
  art.innerHTML =
    '<svg viewBox="0 0 24 24" width="31" height="31" fill="none" ' +
    'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" ' +
    'stroke-linejoin="round">' +
    '<path d="M8.5 4.5h7A2.5 2.5 0 0 1 18 7v12.5H8.5A2.5 2.5 0 0 1 6 17z"/>' +
    '<path d="M6 17a2.5 2.5 0 0 1 2.5-2.5H18"/>' +
    '<path d="M9.2 8.5l1.3 1.3 2.6-2.7"/></svg>';
  // ⚠️ 空状态只留**状态 + 操作** ✓ —— 不写一句"这里可以做什么"的介绍 ✓
  //    （用户 2026-11-01 明确要求「不要介绍行文字」✓）。
  box.append(art, rlEl('p', 'rl-empty-t', '还没有立规矩'));
  const add = rlEl('button', 'rl-empty-btn', '立第一条');
  add.type = 'button';
  add.onclick = () => rlOpenComposer(null);
  box.append(add);
  return box;
};

const rlRender = () => {
  rlRenderWeek();
  const list = $('#rlList');
  list.innerHTML = '';

  if (rlState.loading && !rlState.rules.length) {
    rlSkeleton();
    return;
  }
  if (rlState.error && !rlState.rules.length) {
    list.append(rlEmpty('error'));
    return;
  }
  if (!rlState.rules.length) {
    list.append(rlEmpty('new'));
    return;
  }
  rlState.rules.forEach((rule) => list.append(rlCard(rule)));
};

// ── 数据 ────────────────────────────────────────────────────────────
const rlSyncSummary = () => {
  rlState.summary = {
    total: rlState.rules.length,
    kept: rlState.rules.filter(r =>
      r.status === 'ok' || r.status === 'full' || r.status === 'done').length,
  };
};

const rlReplace = (rule) => {
  const i = rlState.rules.findIndex(x => x.id === rule.id);
  if (i >= 0) rlState.rules[i] = rule;
  else rlState.rules.push(rule);
  rlSyncSummary();
};

const rlLoad = async () => {
  if (!group || !group.id) return;
  const seq = ++rlState.seq;
  rlState.loading = true;
  rlState.error = '';
  rlRender();

  try {
    const d = await api('/rules?group_id=' + encodeURIComponent(group.id));
    if (seq !== rlState.seq) return;
    rlState.weekStart = Number(d.week_start) || rlState.weekStart;
    rlState.weekEnd = Number(d.week_end) || rlState.weekEnd;
    rlState.weekLabel = d.week_label || rlState.weekLabel;
    rlState.rules = Array.isArray(d.rules) ? d.rules : [];
    rlSyncSummary();
  } catch (e) {
    if (seq !== rlState.seq) return;
    rlState.error = e.message || '这会儿没连上';
  } finally {
    if (seq === rlState.seq) {
      rlState.loading = false;
      rlRender();
    }
  }
};

const rlLog = async (rule) => {
  if (rlState.busy) return;
  rlState.busy = true;
  try {
    const fresh = await api('/rules/' + rule.id + '/log', {
      method: 'POST',
      body: JSON.stringify({ group_id: group.id }),
    });
    rlReplace(fresh);
    rlRender();
    toast(rlToast(fresh));
  } catch (e) {
    toast(e.message || '没记上，再试一次');
  } finally {
    rlState.busy = false;
  }
};

const rlUndo = async (rule) => {
  if (rlState.busy) return;
  rlState.busy = true;
  try {
    const fresh = await api('/rules/' + rule.id + '/undo', {
      method: 'POST',
      body: JSON.stringify({ group_id: group.id }),
    });
    rlReplace(fresh);
    rlRender();
    toast('撤销了一次');
  } catch (e) {
    toast(e.message || '没撤成，再试一次');
  } finally {
    rlState.busy = false;
  }
};

// ── 立 / 改 / 结束 ──────────────────────────────────────────────────
const rlMarkSeg = () => {
  $$('#rlSeg button').forEach(b => b.classList.toggle('on', b.dataset.kind === rlState.kind));
};

const rlMarkIcon = () => {
  $$('#rlIcons button').forEach(b => b.classList.toggle('on', b.dataset.icon === rlState.icon));
};

const rlSetNum = (n) => {
  rlState.target = Math.max(1, Math.min(20, n));
  $('#rlNum').textContent = String(rlState.target);
};

const rlFillIcons = () => {
  const wrap = $('#rlIcons');
  wrap.innerHTML = '';
  Object.keys(RL_ICONS).forEach((name) => {
    const b = rlEl('button', 'rl-icon');
    b.type = 'button';
    b.dataset.icon = name;
    b.setAttribute('aria-label', name);
    b.innerHTML = rlIconSvg(name);
    b.onclick = () => {
      rlState.icon = name;
      rlMarkIcon();
    };
    wrap.append(b);
  });
};

const rlOpenComposer = (rule) => {
  rlState.editing = rule ? rule.id : 0;
  rlState.kind = rule ? rule.kind : 'limit';
  rlState.icon = rule ? rule.icon : 'star';
  rlState.target = rule ? rule.target : 2;

  $('#rlCTitle').textContent = rule ? '改这条规矩' : '立一条规矩';
  $('#rlName').value = rule ? rule.title : '';
  $('#rlSave').textContent = rule ? '改好了' : '立下这条';
  $('#rlDel').hidden = !rule;
  rlSetNum(rlState.target);
  rlMarkSeg();
  rlMarkIcon();

  $('#rlComposer').classList.add('on');
  $('#rlComposer').setAttribute('aria-hidden', 'false');
  $('#rules').classList.add('composing');
  setTimeout(() => {
    if (!$('#rlComposer').classList.contains('on')) return;
    try { $('#rlName').focus({ preventScroll: true }); } catch (e) { $('#rlName').focus(); }
  }, 260);
};

const rlCloseComposer = () => {
  $('#rlName').blur();
  $('#rlComposer').classList.remove('on');
  $('#rlComposer').setAttribute('aria-hidden', 'true');
  $('#rules').classList.remove('composing');
};

const rlSave = async () => {
  if (rlState.busy) return;
  const name = $('#rlName').value.trim();
  if (!name) {
    toast('先给这条规矩起个名字');
    try { $('#rlName').focus(); } catch (e) {}
    return;
  }

  rlState.busy = true;
  const btn = $('#rlSave');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = rlState.editing ? '改着…' : '立着…';

  const payload = {
    group_id: group.id,
    title: name,
    kind: rlState.kind,
    target: rlState.target,
    icon: rlState.icon,
  };

  try {
    const fresh = rlState.editing
      ? await api('/rules/' + rlState.editing, {
          method: 'PATCH', body: JSON.stringify(payload),
        })
      : await api('/rules', { method: 'POST', body: JSON.stringify(payload) });
    rlReplace(fresh);
    rlCloseComposer();
    rlRender();
    toast(rlState.editing ? '改好了' : '立下了「' + fresh.title + '」');
  } catch (e) {
    toast(e.message || '没立上，再试一次');
  } finally {
    rlState.busy = false;
    btn.disabled = false;
    btn.textContent = old;
  }
};

const rlDelete = async () => {
  if (!rlState.editing || rlState.busy) return;
  const rule = rlState.rules.find(x => x.id === rlState.editing);
  const title = rule ? rule.title : '这条规矩';
  const yes = await confirmBox({
    title: '结束「' + title + '」？',
    body: '它会从规矩里拿掉；这周记过的次数也不再显示。',
    ok: '结束',
    danger: true,
  });
  if (!yes) return;

  rlState.busy = true;
  try {
    await api('/rules/' + rlState.editing + '?group_id=' + encodeURIComponent(group.id),
      { method: 'DELETE' });
    const id = rlState.editing;
    rlState.rules = rlState.rules.filter(x => x.id !== id);
    rlSyncSummary();
    rlCloseComposer();
    rlRender();
    toast('结束了「' + title + '」');
  } catch (e) {
    toast(e.message || '没结束成，再试一次');
  } finally {
    rlState.busy = false;
  }
};

// ── 进 / 退这一屏 ───────────────────────────────────────────────────
const openRules = () => {
  if (!group || !group.id) {
    toast('先进入一个生活空间');
    return;
  }
  rlState.rules = [];
  rlState.error = '';
  rlState.editing = 0;
  rlState.busy = false;
  rlState.weekStart = 0;
  rlState.weekEnd = 0;
  rlState.weekLabel = '';
  rlFallbackWeek();
  rlRender();
  pushScreen('rules');
  rlLoad(false);
};

const closeRules = () => {
  rlState.seq++;
  rlCloseComposer();
  popScreen('rules');
};

// ── 绑定 ────────────────────────────────────────────────────────────
rlFillIcons();

$('#rlBack').onclick = closeRules;
$('#rlFab').onclick = () => rlOpenComposer(null);
$('#rlCMask').onclick = rlCloseComposer;
$('#rlSave').onclick = rlSave;
$('#rlDel').onclick = rlDelete;

$('#rlMinus').onclick = () => rlSetNum(rlState.target - 1);
$('#rlPlus').onclick = () => rlSetNum(rlState.target + 1);

$$('#rlSeg button').forEach((b) => {
  b.onclick = () => {
    rlState.kind = b.dataset.kind;
    rlMarkSeg();
  };
});

$('#rlName').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    ev.target.blur();
  }
});

// 调试 / 截图钩子 ✓（和 `window.__openUs` 一个做法 ✓）。
window.__openRules = openRules;
