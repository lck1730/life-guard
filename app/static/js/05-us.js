/**
 * 「我们」—— 两个人的日常记录。
 *
 * 用户 2026-11-01：「将纪念日名字改成『我们』，然后里面是情侣日常记录的功能，
 * 顶部有个在一起时间，设置在一起日期是 2024.7.17，然后下面就是一些可以随时
 * 记录的日常瞬间，支持图片文字（自动记录日期），注意界面要温馨浪漫，
 * 不要太干巴，不要介绍行文字，支持文字搜索匹配，一定注意 ui 设计和体验」。
 *
 * 这一屏上**没有一句功能说明** ✓（「不要介绍行文字」✓）——
 * 看到的每个字都是数据：天数 / 日期 / 谁记的 / 搜索词 ✓。
 *
 * ⚠️ 它是一屏整屏子页 ✓ → `_OTHER_SCREENS` 里要有 `#us` ✓、
 *    `__goBack` 里要有一支 ✓（见 `android-back-key-only-knows-settings` ✓）。
 * ⚠️ 弹层（写这一刻的那张纸）**住在 `#us` 里面** ✓ —— 返回键先收它 ✓，
 *    再按一次才退屏 ✓（见 `__goBack` ✓）。
 */

// ── 状态 ────────────────────────────────────────────────────────────
let usState = {
  togetherAt: '2024-07-17',
  moments: [],
  q: '',
  hasMore: false,
  loading: false,
  error: '',
  seq: 0,             // 搜索 / 翻页的取号 ✓（只认最后一次 ✓，见 01 的 popToken ✓）
  draft: '',          // 关弹层但不退屏时留着草稿 ✓（误触不会白写 ✓）
  photoBlob: null,
  photoUrl: '',
  saving: false,
};

let usSearchTimer = 0;

const usEl = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const usPad = (n) => String(n).padStart(2, '0');

const usDayKey = (d) =>
  d.getFullYear() + '-' + usPad(d.getMonth() + 1) + '-' + usPad(d.getDate());

const usWeek = (d) => ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];

const usTime = (d) => usPad(d.getHours()) + ':' + usPad(d.getMinutes());

/** 某一天在时间线里怎么叫 ✓：今天 / 昨天 / 10月30日（跨年带年份 ✓）。 */
const usDayName = (d) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
};

const usDaySub = (d) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today - that) / 86400000);
  const head = usWeek(d);
  if (diff === 0 || diff === 1) {
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + head;
  }
  return head;
};

/** 搜索命中处套一层 `<mark>` ✓ —— **用 DOM 拼，不拼 HTML** ✓（正文是用户写的）。 */
const usHighlight = (text, q) => {
  const frag = document.createDocumentFragment();
  const needle = (q || '').trim().toLowerCase();
  if (!needle) {
    frag.append(document.createTextNode(text));
    return frag;
  }
  const hay = text.toLowerCase();
  let from = 0;
  let at = hay.indexOf(needle);
  while (at !== -1) {
    if (at > from) frag.append(document.createTextNode(text.slice(from, at)));
    const mk = document.createElement('mark');
    mk.textContent = text.slice(at, at + needle.length);
    frag.append(mk);
    from = at + needle.length;
    at = hay.indexOf(needle, from);
  }
  if (from < text.length) frag.append(document.createTextNode(text.slice(from)));
  return frag;
};

// ── 在一起多少天 ────────────────────────────────────────────────────
//
// 用户给的日期是 **2024.7.17** ✓。按「在一起的第几天」算 ✓（当天算第 1 天 ✓）——
// 中国人说「在一起第 838 天」就是这个口径 ✓。
// ⚠️ 用**本地午夜**相减 ✓，不用 UTC ✗ —— 手机时区一变，日期头会差一天 ✓。
const usRenderHero = () => {
  const raw = (usState.togetherAt || '2024-07-17').split('-').map(Number);
  const y = raw[0] || 2024, m = raw[1] || 7, d = raw[2] || 17;
  const start = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.max(1, Math.round((today - start) / 86400000) + 1);
  $('#usDays').textContent = String(days);
  $('#usSince').textContent = '始于 ' + y + '.' + m + '.' + d;
};

// ── 数据 ────────────────────────────────────────────────────────────
const usLoad = async (more) => {
  if (!group || !group.id) return;
  if (more && (usState.loading || !usState.hasMore)) return;

  const seq = ++usState.seq;
  usState.loading = true;
  usState.error = '';
  if (!more) {
    usState.moments = [];
    usState.hasMore = false;
    $('#usList').innerHTML = '';
  }
  $('#usSearchWrap').classList.add('busy');
  usRenderList();

  const params = new URLSearchParams({ group_id: String(group.id) });
  if (usState.q) params.set('q', usState.q);
  if (more && usState.moments.length) {
    params.set('before', String(usState.moments[usState.moments.length - 1].id));
  }

  try {
    const d = await api('/us?' + params.toString());
    if (seq !== usState.seq) return;      // 中间又搜了一次 → 这一趟作废 ✓
    usState.togetherAt = d.together_at || usState.togetherAt;
    const got = Array.isArray(d.moments) ? d.moments : [];
    if (more) {
      const seen = new Set(usState.moments.map(x => x.id));
      usState.moments = usState.moments.concat(got.filter(x => !seen.has(x.id)));
    } else {
      usState.moments = got;
    }
    usState.hasMore = !!d.has_more;
    usRenderHero();
  } catch (e) {
    if (seq !== usState.seq) return;
    usState.error = e.message || '这会儿没连上';
  } finally {
    if (seq === usState.seq) {
      usState.loading = false;
      $('#usSearchWrap').classList.remove('busy');
      usRenderList();
    }
  }
};

// ── 时间线 ──────────────────────────────────────────────────────────
const usSkeleton = () => {
  for (let i = 0; i < 3; i++) {
    const sk = usEl('div', 'us-skel');
    sk.append(usEl('div', 'us-skel-line w1'), usEl('div', 'us-skel-line w2'),
              usEl('div', 'us-skel-line w3'));
    $('#usList').append(sk);
  }
};

const usEmpty = (kind) => {
  const box = usEl('div', 'us-empty');
  const art = usEl('div', 'us-empty-art');
  art.setAttribute('aria-hidden', 'true');
  ['♡', '♡', '♡'].forEach((ch, i) => {
    const s = usEl('span', 'us-eh' + i, ch);
    art.append(s);
  });
  box.append(art);

  if (kind === 'search') {
    box.append(usEl('p', 'us-empty-t', '没有找到「' + usState.q + '」'));
    box.append(usEl('p', 'us-empty-s', '换个词试试'));
  } else if (kind === 'error') {
    box.append(usEl('p', 'us-empty-t', '这会儿没连上'));
    box.append(usEl('p', 'us-empty-s', usState.error || ''));
    const retry = usEl('button', 'us-retry', '再试一次');
    retry.type = 'button';
    retry.onclick = () => usLoad(false);
    box.append(retry);
  } else {
    box.append(usEl('p', 'us-empty-t', '第一件小事，\n从今天开始。'));
  }
  return box;
};

const usCard = (m) => {
  const card = usEl('article', 'us-card');
  const when = new Date(m.happened_at * 1000);

  if (m.media_path) {
    card.classList.add('has-pic');
    const pic = usEl('button', 'us-pic');
    pic.type = 'button';
    pic.setAttribute('aria-label', '看大图');
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.alt = '';
    img.src = '/media/' + m.media_path;
    pic.append(img);
    // ⚠️ 只挂在 button 上 ✓ —— 两边都挂会开两次 ✓（图那一下会冒泡上来 ✓）。
    pic.onclick = () => openLightbox(img.src);
    card.append(pic);
  }

  if (m.text) {
    const p = usEl('p', 'us-txt');
    p.append(usHighlight(m.text, usState.q));
    card.append(p);
  }

  const meta = usEl('div', 'us-meta');
  const heart = usEl('span', 'us-meta-h', '♥');
  heart.setAttribute('aria-hidden', 'true');
  const who = usEl('span', 'us-who', m.user_name || '我们');
  const time = usEl('span', 'us-time', usTime(when));

  const del = usEl('button', 'us-del');
  del.type = 'button';
  del.setAttribute('aria-label', '删掉这条');
  del.innerHTML =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M5 7h14M9 7V5h6v2M7.5 7l.8 12h7.4l.8-12M10.5 10.5v5M13.5 10.5v5"/></svg>';
  del.onclick = () => usDelete(m);

  meta.append(heart, who, time, del);
  card.append(meta);
  return card;
};

const usRenderList = () => {
  const list = $('#usList');
  const more = $('#usMore');
  list.innerHTML = '';

  if (usState.loading && !usState.moments.length) {
    usSkeleton();
    more.hidden = true;
    return;
  }

  if (!usState.moments.length) {
    list.append(usEmpty(usState.error ? 'error' : (usState.q ? 'search' : 'new')));
    more.hidden = true;
    return;
  }

  let last = '';
  usState.moments.forEach((m) => {
    const d = new Date(m.happened_at * 1000);
    const key = usDayKey(d);
    if (key !== last) {
      const head = usEl('div', 'us-dayhead');
      head.append(usEl('span', 'us-dayname', usDayName(d)),
                  usEl('span', 'us-daysub', usDaySub(d)),
                  usEl('i', 'us-dayline'));
      list.append(head);
      last = key;
    }
    list.append(usCard(m));
  });

  more.hidden = !usState.hasMore;
  more.disabled = usState.loading;
  more.textContent = usState.loading
    ? '翻找中…'
    : (usState.q ? '再找找更早的' : '再往前翻翻');
};

const usDelete = async (m) => {
  const yes = await confirmBox({
    title: '删掉这一段？',
    body: '它会从我们的时间线里消失。',
    ok: '删掉',
    danger: true,
  });
  if (!yes) return;
  try {
    await api('/us/moments/' + m.id + '?group_id=' + group.id, { method: 'DELETE' });
    usState.moments = usState.moments.filter(x => x.id !== m.id);
    usRenderList();
    toast('删掉了');
  } catch (e) {
    toast(e.message || '没删掉，再试一次');
  }
};

// ── 写这一刻的那张纸 ────────────────────────────────────────────────
const usFitText = () => {
  const t = $('#usText');
  t.style.height = 'auto';
  const cap = Math.round(window.innerHeight * 0.34);
  t.style.height = Math.min(t.scrollHeight, cap) + 'px';
};

const usStamp = () => {
  const d = new Date();
  $('#usCDay').textContent =
    '今天 · ' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  $('#usCTime').textContent = usTime(d);
};

const usResetPhoto = () => {
  if (usState.photoUrl) {
    try { URL.revokeObjectURL(usState.photoUrl); } catch (e) {}
  }
  usState.photoUrl = '';
  usState.photoBlob = null;
  $('#usCPreview').removeAttribute('src');
  $('#usCPhoto').hidden = true;
};

const usClearDraft = () => {
  usState.draft = '';
  $('#usText').value = '';
  usFitText();
  usResetPhoto();
};

const usOpenComposer = () => {
  usStamp();
  $('#usText').value = usState.draft || '';
  if (usState.photoUrl) {
    $('#usCPreview').src = usState.photoUrl;
    $('#usCPhoto').hidden = false;
  }
  usFitText();
  $('#usComposer').classList.add('on');
  $('#usComposer').setAttribute('aria-hidden', 'false');
  $('#us').classList.add('composing');
  setTimeout(() => {
    if (!$('#usComposer').classList.contains('on')) return;
    try { $('#usText').focus({ preventScroll: true }); } catch (e) { $('#usText').focus(); }
  }, 260);
};

const usCloseComposer = () => {
  usState.draft = $('#usText').value;
  $('#usText').blur();
  $('#usComposer').classList.remove('on');
  $('#usComposer').setAttribute('aria-hidden', 'true');
  $('#us').classList.remove('composing');
};

const usSave = async () => {
  if (usState.saving) return;
  const text = $('#usText').value.trim();
  if (!text && !usState.photoBlob) {
    toast('写点什么，或者放一张照片');
    return;
  }

  usState.saving = true;
  const btn = $('#usSave');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '记下来…';

  try {
    let mediaPath = null;
    if (usState.photoBlob) {
      const type = usState.photoBlob.type || 'image/jpeg';
      const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
      const file = new File([usState.photoBlob], 'moment.' + ext, { type: type });
      const up = await uploadFile(file);
      mediaPath = up.path;
    }
    await api('/us/moments', {
      method: 'POST',
      body: JSON.stringify({ group_id: group.id, text: text, media_path: mediaPath }),
    });

    usCloseComposer();
    usClearDraft();
    // 新记的那条从最上面出来 ✓ → 清掉搜索、重新拉第一页 ✓。
    $('#usSearch').value = '';
    $('#usSearchClear').hidden = true;
    usState.q = '';
    toast('收进回忆啦');
    await usLoad(false);
  } catch (e) {
    toast(e.message || '没记上，再试一次');
  } finally {
    usState.saving = false;
    btn.disabled = false;
    btn.textContent = old;
  }
};

// ── 进 / 退这一屏 ───────────────────────────────────────────────────
const openUs = () => {
  if (!group || !group.id) {
    toast('先进入一个生活空间');
    return;
  }
  $('#usSearch').value = '';
  $('#usSearchClear').hidden = true;
  usState.q = '';
  usState.moments = [];
  usState.hasMore = false;
  usState.error = '';
  usState.draft = '';
  usResetPhoto();
  usRenderHero();
  pushScreen('us');
  usLoad(false);
};

const closeUs = () => {
  usCloseComposer();
  usClearDraft();
  popScreen('us');
};

// ── 绑定 ────────────────────────────────────────────────────────────
$('#usBack').onclick = closeUs;
$('#usFab').onclick = usOpenComposer;
$('#usCMask').onclick = usCloseComposer;
$('#usSave').onclick = usSave;

$('#usText').addEventListener('input', usFitText);

$('#usPick').onclick = () => $('#fileUs').click();
$('#usCRemove').onclick = () => usResetPhoto();

$('#fileUs').addEventListener('change', async (ev) => {
  const f = ev.target.files && ev.target.files[0];
  ev.target.value = '';                 // 同一张图删掉再选也能触发 ✓
  if (!f) return;
  if (!/^image\//.test(f.type || '')) {
    toast('只收照片');
    return;
  }
  const pick = $('#usPick');
  const label = pick.querySelector('span');
  const old = label.textContent;
  pick.disabled = true;
  label.textContent = '准备中';
  try {
    let blob;
    try {
      blob = await shrinkToJpeg(f, 1600);   // 手机上先缩 ✓，别让原图白过一趟隧道 ✓
    } catch (e) {
      throw new Error('这张照片打不开，换一张');
    }
    usResetPhoto();
    usState.photoBlob = blob;
    usState.photoUrl = URL.createObjectURL(blob);
    $('#usCPreview').src = usState.photoUrl;
    $('#usCPhoto').hidden = false;
  } catch (e) {
    toast(e.message || '这张照片不行');
  } finally {
    pick.disabled = false;
    label.textContent = old;
  }
});

$('#usSearch').addEventListener('input', (ev) => {
  const raw = ev.target.value;
  $('#usSearchClear').hidden = !raw;
  clearTimeout(usSearchTimer);
  usSearchTimer = setTimeout(() => {
    const q = raw.trim();
    if (q === usState.q) return;
    usState.q = q;
    usLoad(false);
  }, 260);
});

$('#usSearch').addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  clearTimeout(usSearchTimer);
  const q = ev.target.value.trim();
  if (q === usState.q) return;
  usState.q = q;
  ev.target.blur();
  usLoad(false);
});

$('#usSearchClear').onclick = () => {
  clearTimeout(usSearchTimer);
  $('#usSearch').value = '';
  $('#usSearchClear').hidden = true;
  $('#usSearch').focus();
  if (!usState.q) return;
  usState.q = '';
  usLoad(false);
};

$('#usMore').onclick = () => usLoad(true);

// 调试 / 截图钩子 ✓（和 `window.__openArch` 一个做法 ✓）。
window.__openUs = openUs;
