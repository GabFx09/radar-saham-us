/* =====================================================================
   Radar Saham US — "Pesan": kotak masuk bergaya chat + Radar Bot + notifikasi push
   - Pesan dari server (ringkasan pagi, alert harga, berita penting) dibaca dari gist pengguna
   - Ringkasan harian lokal selalu tersedia tanpa pengaturan apa pun
   - Radar Bot menjawab perintah (/top, /makro, ticker, /alert NVDA >200 …) dari data aplikasi
   - Notifikasi push Web Push (VAPID) ke HP/laptop, termasuk saat aplikasi ditutup
   ===================================================================== */
'use strict';

const VAPID_PUBLIC = 'BMFWT1fD_xNTms4Zgm469P4veZfE33AVLg_UiiSAjRmGPVPCPvtIBTjF-hBDmAeoC3y8ma7haWcyMhUzVTGeQeo';
const INBOX_FILE = 'radar-saham-inbox.json';
App.inbox = store.get('inbox', []);
App.chat = store.get('chatlog', []);
App.lastRead = store.get('lastRead', 0);
App.pushSubs = store.get('pushSubs', []);

/* ------------------------------------------------------------ sanitasi HTML pesan */
function cleanHtml(htm) {
  const doc = new DOMParser().parseFromString(`<div>${String(htm || '').replace(/\n/g, '<br>')}</div>`, 'text/html');
  const ok = new Set(['B', 'I', 'A', 'BR', 'STRONG', 'EM', 'CODE']);
  const walk = (node) => {
    [...node.childNodes].forEach((ch) => {
      if (ch.nodeType === 1) {
        if (!ok.has(ch.tagName)) { ch.replaceWith(...ch.childNodes); return; }
        [...ch.attributes].forEach((a) => { if (!(ch.tagName === 'A' && a.name === 'href')) ch.removeAttribute(a.name); });
        if (ch.tagName === 'A') {
          const h = ch.getAttribute('href') || '';
          if (!/^(https?:|#)/i.test(h)) ch.removeAttribute('href');
          else if (/^https?:/i.test(h)) { ch.setAttribute('target', '_blank'); ch.setAttribute('rel', 'noopener'); }
        }
        walk(ch);
      }
    });
  };
  walk(doc.body.firstChild);
  return doc.body.firstChild.innerHTML;
}

/* ------------------------------------------------------------ kotak masuk dari gist */
async function pullInbox() {
  if (!App.cloud || !App.cloud.gistId) return false;
  const g = await ghApi('/gists/' + App.cloud.gistId);
  const f = g.files[INBOX_FILE];
  if (!f) return false;
  let content = f.content;
  if (f.truncated) content = await (await fetch(f.raw_url)).text();
  const msgs = (JSON.parse(content || '{}').messages || []).slice(-200);
  const changed = msgs.length !== App.inbox.length || (msgs.at(-1) || {}).id !== (App.inbox.at(-1) || {}).id;
  App.inbox = msgs;
  store.set('inbox', msgs);
  updateBadge();
  return changed;
}
function unreadCount() {
  return App.inbox.filter((m) => Date.parse(m.t) > App.lastRead).length + (localDigest() && Date.parse(localDigest().t) > App.lastRead ? 1 : 0);
}
function updateBadge() {
  const n = unreadCount();
  $$('[data-nav="pesan"]').forEach((a) => {
    let b = a.querySelector('.nbadge');
    if (!b) { b = document.createElement('span'); b.className = 'nbadge'; a.appendChild(b); }
    b.textContent = n > 99 ? '99+' : n;
    b.hidden = !n;
  });
  try { if (navigator.setAppBadge) n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } catch (e) { /* tidak didukung */ }
}

/* ------------------------------------------------------------ ringkasan harian lokal (tanpa server) */
function localDigest() {
  const d = App.data;
  if (!d) return null;
  const S = d.stocks, m = d.market || {};
  const sb = S.filter((s) => s.rating === 'STRONG BUY');
  const wl = [...App.watch].map((x) => App.bySym[x]).filter(Boolean);
  const now = Date.now();
  const earn = S.filter((s) => s.earnings_ts && s.earnings_ts * 1000 > now - 864e5 && s.earnings_ts * 1000 < now + 5 * 864e5 && (App.watch.has(s.sym) || s.rating !== 'HOLD' && s.rating !== 'HINDARI'));
  const L = [];
  if (m.spy) L.push(`S&amp;P 500 <b>${fmt.usd(m.spy)}</b> (${fmt.pct(m.chg1d, 2)}) · ${esc(m.regime || '')}${App.makro && App.makro.fg ? ` · Fear&amp;Greed <b>${Math.round(App.makro.fg.now)}</b> ${esc(App.makro.fg.label)}` : ''}`);
  if (wl.length) {
    L.push('', '<b>⭐ Watchlist</b>');
    wl.slice(0, 12).forEach((s) => L.push(`<a href="#/s/${encodeURIComponent(s.sym)}">${esc(s.sym)}</a> ${fmt.usd(s.price)} (${fmt.pct(s.chg1d, 1)}) · ${esc(s.rating)} · proyeksi ${fmt.pct(s.val ? s.val.upside : null, 0)}${s.prev && s.prev.rating !== s.rating ? ` · <b>dari ${esc(s.prev.rating)}</b>` : ''}`));
  }
  if (sb.length) L.push('', `<b>★ Strong Buy (${sb.length})</b>`, sb.slice(0, 8).map((s) => `<a href="#/s/${encodeURIComponent(s.sym)}">${esc(s.sym)}</a> ${fmt.pct(s.val ? s.val.upside : null, 0)}`).join(' · '));
  const c = d.changes;
  if (c && (c.up.length || c.down.length)) {
    L.push('', '<b>🔄 Perubahan rekomendasi</b>');
    if (c.up.length) L.push('▲ ' + c.up.slice(0, 6).map((x) => `${esc(x.sym)}→${esc(x.to)}`).join(', '));
    if (c.down.length) L.push('▼ ' + c.down.slice(0, 6).map((x) => `${esc(x.sym)}→${esc(x.to)}`).join(', '));
  }
  if (earn.length) L.push('', '<b>📅 Laporan keuangan 5 hari</b>', earn.sort((a, b) => a.earnings_ts - b.earnings_ts).slice(0, 10).map((s) => `${esc(s.sym)} ${fmt.date(s.earnings_ts * 1000, { day: 'numeric', month: 'short' })}`).join(' · '));
  return { id: 'local-' + d.generated, t: d.generated, kind: 'digest', title: `📊 Ringkasan data ${fmt.date(d.generated, { weekday: 'long', day: 'numeric', month: 'short' })}`, html: L.join('\n'), local: true };
}

/* ------------------------------------------------------------ Radar Bot */
const BOT_CMDS = [
  ['/ringkasan', 'Ringkasan pasar & watchlist hari ini'], ['/top', 'Saham Strong Buy & Buy teratas'],
  ['/makro', 'Fear & Greed, VIX, yield, dolar, rupiah'], ['/berita', 'Berita penting terbaru'],
  ['/watchlist', 'Status saham pantauan'], ['/laporan', 'Jadwal laporan keuangan 7 hari'],
  ['/naik', 'Saham yang paling naik hari ini'], ['/turun', 'Saham yang paling turun hari ini'],
  ['/alert NVDA >200', 'Pasang alert harga (atau <150)'], ['NVDA', 'Ketik ticker untuk ringkasan saham'],
  ['bandingkan NVDA AMD', 'Buka perbandingan'],
];
function stockCardHtml(s) {
  const v = s.val || {};
  return `<b>${esc(s.sym)}</b> · ${esc(s.name)}<br>${fmt.usd(s.price)} (${fmt.pct(s.chg1d, 2)}) · <b>${esc(s.rating)}</b> · skor ${Math.round(s.score)}<br>` +
    `Nilai wajar ${fmt.usd(v.fair)} → proyeksi <b>${fmt.pct(v.upside, 1)}</b> (keyakinan ${esc(v.confidence || '–')})` +
    (s.q && s.q.mc ? `<br>Peluang untung 12 bln ${Math.round(s.q.mc.p_up * 100)}% · risiko turun &gt;20% ${Math.round(s.q.mc.p_loss20 * 100)}%` : '') +
    (s.pro1 ? `<br><i>${esc(s.pro1)}</i>` : '') +
    `<br><a href="#/s/${encodeURIComponent(s.sym)}">Buka analisis lengkap ›</a>`;
}
async function botAnswer(raw) {
  const text = raw.trim();
  const up = text.toUpperCase();
  const words = up.split(/\s+/);
  const cmd = words[0].replace(/^\//, '');
  const S = App.data.stocks;
  const list = (arr, f) => arr.map(f).join('<br>');
  if (['HALO', 'HAI', 'HI', 'HELLO', 'PAGI', 'SIANG', 'SORE', 'MALAM', 'TERIMA', 'MAKASIH', 'THANKS'].includes(cmd)) {
    return ['TERIMA', 'MAKASIH', 'THANKS'].includes(cmd) ? 'Sama-sama! 🙌 Semoga cuan.' :
      `Halo! 👋 Saya Radar Bot. Coba ketik <code>/ringkasan</code>, <code>/top</code>, atau nama saham seperti <code>NVDA</code>. Daftar lengkap: <code>/bantuan</code>.`;
  }
  if (['BANTUAN', 'HELP', 'START', '?'].includes(cmd)) return '<b>Perintah Radar Bot</b><br>' + list(BOT_CMDS, ([c, d]) => `<code>${esc(c)}</code> — ${esc(d)}`);
  if (['RINGKASAN', 'DIGEST', 'HARI'].includes(cmd)) { const d = localDigest(); return `<b>${esc(d.title)}</b><br>${d.html}`; }
  if (['TOP', 'BELI', 'BUY'].includes(cmd)) {
    const sb = S.filter((s) => s.rating === 'STRONG BUY'), b = S.filter((s) => s.rating === 'BUY').slice(0, 8);
    return `<b>★ Strong Buy (${sb.length})</b><br>` + list(sb, (s) => `<a href="#/s/${encodeURIComponent(s.sym)}">${esc(s.sym)}</a> skor ${Math.round(s.score)} · proyeksi ${fmt.pct(s.val && s.val.upside, 0)}`) +
      `<br><br><b>Buy teratas</b><br>` + list(b, (s) => `<a href="#/s/${encodeURIComponent(s.sym)}">${esc(s.sym)}</a> skor ${Math.round(s.score)} · ${fmt.pct(s.val && s.val.upside, 0)}`);
  }
  if (['MAKRO', 'MACRO', 'PASAR'].includes(cmd)) {
    const mk = await loadMakro().catch(() => null);
    if (!mk) return 'Data makro belum tersedia.';
    const rows = Object.fromEntries(mk.assets.flatMap((g) => g.rows).map((r) => [r.sym, r]));
    const r = (s, n, rate) => rows[s] ? `${n} <b>${rate ? rows[s].last.toFixed(2) + '%' : rows[s].last.toLocaleString('en-US', { maximumFractionDigits: 2 })}</b> (${rate ? bp(rows[s].d1) : fmt.pct(rows[s].d1, 2)})` : '';
    return [mk.fg ? `Fear &amp; Greed <b>${Math.round(mk.fg.now)}</b> — ${esc(mk.fg.label)}` : '', r('^VIX', 'VIX'), r('^TNX', 'UST 10 thn', true),
      mk.curve && mk.curve.spread_now != null ? `Spread 10T−3B <b>${mk.curve.spread_now.toFixed(2)}</b> pp` : '', r('DX-Y.NYB', 'Indeks dolar'), r('IDR=X', 'USD/IDR'), r('GC=F', 'Emas'), r('CL=F', 'Minyak WTI'), r('BTC-USD', 'Bitcoin')]
      .filter(Boolean).join('<br>') + '<br><a href="#/makro">Buka monitor makro ›</a>';
  }
  if (['BERITA', 'NEWS'].includes(cmd)) {
    const own = App.inbox.filter((m) => m.kind === 'news').slice(-5).reverse();
    const geo = ((App.data.geo || {}).news || []).slice(0, 5);
    let out = own.length ? '<b>Berita penting (dari notifikasi)</b><br>' + own.map((m) => `• ${esc(m.title)}`).join('<br>') + '<br><br>' : '';
    out += geo.length ? '<b>Berita geopolitik & pasar terbaru</b><br>' + geo.map((n) => `• <a href="${esc(/^https?:/i.test(n.url || '') ? n.url : '#')}">${esc(n.title)}</a>`).join('<br>') : 'Belum ada berita.';
    return out;
  }
  if (['WATCHLIST', 'WL'].includes(cmd)) {
    const wl = [...App.watch].map((x) => App.bySym[x]).filter(Boolean);
    if (!wl.length) return 'Watchlist kosong. Ketik ticker lalu ketuk ⭐ di halaman saham.';
    return list(wl, (s) => `<a href="#/s/${encodeURIComponent(s.sym)}">${esc(s.sym)}</a> ${fmt.usd(s.price)} (${fmt.pct(s.chg1d, 1)}) · ${esc(s.rating)} · ${fmt.pct(s.val && s.val.upside, 0)}${App.alerts[s.sym] ? ' · 🔔' : ''}`);
  }
  if (['LAPORAN', 'EARNINGS'].includes(cmd)) {
    const now = Date.now();
    const e = S.filter((s) => s.earnings_ts && s.earnings_ts * 1000 > now - 864e5 && s.earnings_ts * 1000 < now + 7 * 864e5).sort((a, b) => a.earnings_ts - b.earnings_ts);
    const pri = e.filter((s) => App.watch.has(s.sym) || s.rating === 'STRONG BUY' || s.rating === 'BUY');
    return `<b>${e.length} emiten melapor dalam 7 hari</b><br>` + list((pri.length ? pri : e).slice(0, 15), (s) => `${fmt.date(s.earnings_ts * 1000, { weekday: 'short', day: 'numeric', month: 'short' })} — <a href="#/s/${encodeURIComponent(s.sym)}">${esc(s.sym)}</a> ${App.watch.has(s.sym) ? '⭐' : ''} ${esc(s.rating)}`);
  }
  if (['NAIK', 'TURUN', 'GAINERS', 'LOSERS'].includes(cmd)) {
    const asc = cmd === 'TURUN' || cmd === 'LOSERS';
    const arr = S.filter((s) => s.chg1d != null).sort((a, b) => (asc ? a.chg1d - b.chg1d : b.chg1d - a.chg1d)).slice(0, 10);
    return `<b>${asc ? 'Paling turun' : 'Paling naik'} hari terakhir</b><br>` + list(arr, (s) => `<a href="#/s/${encodeURIComponent(s.sym)}">${esc(s.sym)}</a> ${fmt.pct(s.chg1d, 1)} · ${esc(s.rating)}`);
  }
  if (cmd === 'ALERT') {
    const sym = words[1], m = (words[2] || '').match(/^([<>])=?\$?([\d.]+)$/);
    if (!sym || !App.bySym[sym] || !m) return 'Format: <code>/alert NVDA &gt;200</code> atau <code>/alert NVDA &lt;150</code>';
    const a = App.alerts[sym] || {};
    a[m[1] === '>' ? 'above' : 'below'] = parseFloat(m[2]);
    App.alerts[sym] = a;
    store.set('alerts', App.alerts);
    if (!App.watch.has(sym)) toggleWatch(sym); else cloudChanged();
    return `🔔 Alert disimpan: <b>${esc(sym)}</b> ${m[1] === '>' ? '≥' : '≤'} ${fmt.usd(parseFloat(m[2]))} (harga kini ${fmt.usd(App.bySym[sym].price)}).` +
      (App.cloud && App.cloud.gistId ? ' Dicek tiap 30 menit saat bursa buka.' : ' <a href="#/pengaturan">Hubungkan cloud</a> agar alert dikirim saat aplikasi tertutup.');
  }
  if (['BANDINGKAN', 'CMP'].includes(cmd)) {
    const syms = words.slice(1).filter((x) => App.bySym[x]);
    return syms.length >= 2 ? `<a href="#/bandingkan?s=${syms.join(',')}">Buka perbandingan ${syms.join(' vs ')} ›</a>` : 'Format: <code>bandingkan NVDA AMD</code>';
  }
  const hit = words.map((w) => w.replace(/[^A-Z.\-]/g, '')).find((w) => App.bySym[w]);
  if (hit) return stockCardHtml(App.bySym[hit]);
  const byName = S.find((s) => s.name.toLowerCase().includes(text.toLowerCase()) && text.length >= 3);
  if (byName) return stockCardHtml(byName);
  return `Maaf, saya belum paham "<b>${esc(text)}</b>". Ketik <code>/bantuan</code> untuk daftar perintah, atau ketik ticker seperti <code>NVDA</code>.`;
}

/* ------------------------------------------------------------ halaman Pesan */
function feed() {
  const all = [];
  const d = localDigest();
  if (d) all.push(d);
  App.inbox.forEach((m) => all.push(Object.assign({ from: 'bot' }, m)));
  App.chat.forEach((m) => all.push(m));
  return all.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}
function dayLabel(t) {
  const d = new Date(t), today = new Date();
  const diff = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
  return diff === 0 ? 'Hari ini' : diff === 1 ? 'Kemarin' : fmt.date(d, { weekday: 'long', day: 'numeric', month: 'long' });
}
function bubble(m) {
  const me = m.from === 'me';
  const time = new Date(m.t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace('.', ':');
  const kind = { alert: 'k-alert', news: 'k-news', digest: 'k-digest' }[m.kind] || '';
  return `<div class="bub ${me ? 'me' : 'bot'} ${kind}">
    ${m.title ? `<div class="bt">${esc(m.title)}</div>` : ''}
    <div class="bb">${me ? esc(m.text) : cleanHtml(m.html)}</div>
    <div class="bm">${m.local ? 'dari data aplikasi · ' : ''}${time}${me ? ' ✓✓' : ''}</div></div>`;
}
function pushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}
function renderPesan(el) {
  const items = feed();
  const unreadFrom = App.lastRead;
  let lastDay = '', html = '', unreadShown = false;
  items.forEach((m) => {
    const dl = dayLabel(m.t);
    if (dl !== lastDay) { html += `<div class="day-sep"><span>${esc(dl)}</span></div>`; lastDay = dl; }
    if (!unreadShown && m.from !== 'me' && Date.parse(m.t) > unreadFrom && unreadFrom > 0) { html += '<div class="unread-sep"><span>Pesan baru</span></div>'; unreadShown = true; }
    html += bubble(m);
  });
  const ps = pushState();
  const cloudOk = App.cloud && App.cloud.gistId;
  el.innerHTML = `<div class="chat fade-in">
    <div class="chat-head">
      <div class="avatar">RB</div>
      <div style="min-width:0;flex:1"><b>Radar Bot</b> <span class="verified">✓</span>
        <div class="small faint">${cloudOk ? '☁ watchlist tersinkron' : 'tanya saham, pasar &amp; ringkasan harian'}</div></div>
      <a class="btn" href="https://gabfx09.github.io/kabar/" target="_blank" rel="noopener" title="Alert & berita dikirim ke aplikasi Kabar">🔔 Notifikasi di Kabar ↗</a>
    </div>
    <div class="chat-tip">Alert harga, berita penting &amp; ringkasan pagi kini dikirim ke aplikasi terpisah <a class="link" href="https://gabfx09.github.io/kabar/" target="_blank" rel="noopener">Kabar ↗</a> (saluran "Radar Saham") lengkap dengan notifikasi HP. Di sini Anda bisa bertanya ke Radar Bot.</div>
    <div class="chat-list" id="chatList">${html || '<div class="empty small">Belum ada pesan.</div>'}</div>
    <div class="chat-chips">${['/ringkasan', '/top', '/makro', '/berita', '/watchlist', '/laporan', '/naik', '/turun', '/bantuan'].map((c) => `<button class="chip" data-q="${c}">${c}</button>`).join('')}</div>
    <form class="chat-input" id="chatForm" autocomplete="off">
      <input id="chatIn" placeholder="Tulis pesan… (ticker, /top, /alert NVDA >200)" enterkeyhint="send">
      <button class="btn primary" aria-label="Kirim"><svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2-7z"/></svg></button>
    </form>
  </div>`;
  const list = $('#chatList');
  list.scrollTop = list.scrollHeight;
  App.lastRead = Date.now();
  store.set('lastRead', App.lastRead);
  updateBadge();

  const ask = async (q) => {
    if (!q.trim()) return;
    const t = new Date().toISOString();
    App.chat.push({ id: 'me' + Date.now(), t, from: 'me', text: q });
    let ans;
    try { ans = await botAnswer(q); } catch (e) { ans = 'Maaf, terjadi kesalahan: ' + esc(e.message); }
    App.chat.push({ id: 'bot' + Date.now(), t: new Date(Date.parse(t) + 1).toISOString(), from: 'bot', html: ans });
    App.chat = App.chat.slice(-120);
    store.set('chatlog', App.chat);
    renderPesan(el);
    setTimeout(() => { const i = $('#chatIn'); if (i && matchMedia('(min-width: 900px)').matches) i.focus(); }, 30);
  };
  $('#chatForm').onsubmit = (e) => { e.preventDefault(); const v = $('#chatIn').value; $('#chatIn').value = ''; ask(v); };
  $$('.chat-chips [data-q]').forEach((b) => { b.onclick = () => ask(b.dataset.q); });
  const pb = $('#pushBtn');
  if (pb) pb.onclick = enablePush;

}

/* ------------------------------------------------------------ notifikasi push */
function b64ToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function enablePush() {
  const ps = pushState();
  if (ps === 'unsupported') {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    openSheet(`<div class="sheet-handle"></div><h3>Notifikasi belum didukung di sini</h3>
      <p class="small muted">${ios ? 'Di iPhone/iPad, notifikasi hanya bisa untuk aplikasi yang <b>dipasang ke Layar Utama</b> (iOS 16.4+). Buka di Safari → Bagikan → <b>Tambahkan ke Layar Utama</b>, lalu buka dari ikon tersebut dan aktifkan lagi.' : 'Browser ini tidak mendukung Web Push. Gunakan Chrome/Edge/Firefox terbaru, atau pasang aplikasi ke layar utama.'}</p>
      <div class="sheet-actions"><button class="btn primary" data-close>Mengerti</button></div>`);
    return;
  }
  if (!App.cloud || !App.cloud.gistId) {
    openSheet(`<div class="sheet-handle"></div><h3>Hubungkan cloud dulu</h3>
      <p class="small muted">Notifikasi dikirim oleh server GitHub Actions milik Anda. Server perlu tahu alamat notifikasi perangkat ini dan isi watchlist — keduanya disimpan di gist rahasia Anda.</p>
      <div class="sheet-actions"><button class="btn" data-close>Nanti</button><a class="btn primary" href="#/pengaturan" data-close>Buka Pengaturan</a></div>`);
    return;
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Izin notifikasi ditolak — ubah di pengaturan browser'); return; }
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC) });
    const j = sub.toJSON();
    const ua = /android/i.test(navigator.userAgent) ? 'Android' : /iphone|ipad/i.test(navigator.userAgent) ? 'iPhone/iPad' : /windows/i.test(navigator.userAgent) ? 'Windows' : /mac/i.test(navigator.userAgent) ? 'Mac' : 'Perangkat';
    App.pushSubs = App.pushSubs.filter((x) => x.endpoint !== j.endpoint);
    App.pushSubs.push({ endpoint: j.endpoint, keys: j.keys, ua, added: new Date().toISOString().slice(0, 10) });
    store.set('myEndpoint', j.endpoint);
    store.set('pushSubs', App.pushSubs);
    cloudChanged();
    await reg.showNotification('Radar Saham — notifikasi aktif ✓', { body: 'Alert harga & berita penting akan muncul di sini.', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'test', data: { url: '#/pesan' } });
    toast('Notifikasi aktif di perangkat ini');
    render();
  } catch (e) { toast('Gagal mengaktifkan: ' + e.message); }
}

/* ------------------------------------------------------------ boot */
(function pesanBoot() {
  const wait = setInterval(() => {
    if (!App.data) return;
    clearInterval(wait);
    updateBadge();

  }, 300);
  document.addEventListener('visibilitychange', () => {

  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'push' && App.cloud && App.cloud.gistId) pullInbox().then(() => { if (parseHash().parts[0] === 'pesan') render(); }).catch(() => {});
    });
  }
})();
