/* =====================================================================
   Radar Saham US — ekstensi
   1. Detail saham dimuat terpisah (data/detail/SYM.json)
   2. Sinkronisasi cloud via GitHub Gist (watchlist, perbandingan, alert, pengaturan)
   3. Alert harga & pengaturan notifikasi Telegram
   4. Kartu kinerja kuartalan
   ===================================================================== */
'use strict';

/* ------------------------------------------------------------ 1. detail terpisah */
const _detailCache = {};
async function loadDetail(sym) {
  const s = App.bySym[sym];
  if (!s || s._full) return s;
  if (!_detailCache[sym]) {
    _detailCache[sym] = fetch(`data/detail/${encodeURIComponent(sym)}.json`, { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .catch((e) => { delete _detailCache[sym]; throw e; });
  }
  const det = await _detailCache[sym];
  Object.assign(s, det, { _full: true });
  return s;
}
const _renderDetailFull = renderDetail;
renderDetail = function (el, sym) {
  const s = App.bySym[sym];
  if (!s || s._full || s.pros) return _renderDetailFull(el, sym);
  el.innerHTML = `<div class="splash"><div class="spinner"></div><p>MEMUAT ANALISIS ${esc(sym)}…</p></div>`;
  loadDetail(sym).then(() => {
    const p = parseHash().parts;
    if (p[0] === 's' && decodeURIComponent(p[1] || '').toUpperCase() === sym) _renderDetailFull(el, sym);
  }).catch((e) => {
    el.innerHTML = `<div class="empty"><div class="big-ico">📡</div><b>Analisis ${esc(sym)} gagal dimuat</b><p class="small">${esc(e.message)} — periksa koneksi internet.</p><button class="btn primary" onclick="render()">Coba lagi</button></div>`;
  });
};

/* ------------------------------------------------------------ 4. kinerja kuartalan */
function qtrCard(s, order = 10) {
  const q = s.qtr;
  if (!q || !q.hist || q.hist.d.length < 2) return '';
  const h = q.hist, n = h.d.length;
  const W = 600, H = 190, L = 50, R = 10, T = 16, B = 30;
  const vals = h.rev.concat(h.ni).filter((v) => v != null);
  const hi = Math.max(0, ...vals) * 1.12, lo = Math.min(0, ...vals) * 1.12;
  const y = (v) => T + ((hi - v) / (hi - lo || 1)) * (H - T - B);
  const bw = (W - L - R) / n;
  const bigN = (v) => fmt.big(v).replace('$', '');
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="fanchart">
    <line x1="${L}" x2="${W - R}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="fc-now"/>
    ${h.d.map((d, i) => {
      const x0 = L + i * bw, rv = h.rev[i] || 0, nv = h.ni[i] || 0;
      return `<rect x="${(x0 + bw * 0.14).toFixed(1)}" y="${y(Math.max(rv, 0)).toFixed(1)}" width="${(bw * 0.36).toFixed(1)}" height="${Math.abs(y(rv) - y(0)).toFixed(1)}" fill="var(--accent-2)" opacity=".85"><title>Pendapatan ${bigN(rv)}</title></rect>
        <rect x="${(x0 + bw * 0.52).toFixed(1)}" y="${y(Math.max(nv, 0)).toFixed(1)}" width="${(bw * 0.3).toFixed(1)}" height="${Math.max(1, Math.abs(y(nv) - y(0))).toFixed(1)}" fill="${nv >= 0 ? 'var(--up)' : 'var(--down)'}" opacity=".85"><title>Laba bersih ${bigN(nv)}</title></rect>
        ${h.yoy && h.yoy[i] != null ? `<text x="${(x0 + bw * 0.32).toFixed(1)}" y="${(y(Math.max(rv, 0)) - 4).toFixed(1)}" text-anchor="middle" class="fc-ax" style="fill:${h.yoy[i] >= 0 ? 'var(--up)' : 'var(--down)'};font-weight:700">${fmt.pct(h.yoy[i], 0)}</text>` : ''}
        <text x="${(x0 + bw / 2).toFixed(1)}" y="${H - 14}" text-anchor="middle" class="fc-ax">${esc(d.slice(2, 7))}</text>
        <text x="${(x0 + bw / 2).toFixed(1)}" y="${H - 3}" text-anchor="middle" class="fc-ax" style="font-size:9.5px">${h.opm[i] != null ? 'OPM ' + Math.round(h.opm[i] * 100) + '%' : ''}</text>`;
    }).join('')}
    <text x="${L - 6}" y="${(y(hi / 1.12) + 4).toFixed(1)}" class="fc-ax" text-anchor="end">${bigN(hi / 1.12)}</text>
  </svg>`;
  const chip = (lbl, v, good) => `<div><div class="l">${lbl}</div><div class="v ${v == null ? '' : good ? 'up' : 'down'}">${v == null ? '–' : fmt.pct(v, 1)}</div></div>`;
  return `<div class="card card-pad" style="order:${order}">
    <h3 class="card-title">Kinerja Kuartalan</h3>
    ${svg}
    <div class="legend"><span><i style="background:var(--accent-2)"></i>Pendapatan (angka = tumbuh YoY)</span><span><i style="background:var(--up)"></i>Laba bersih</span><span>OPM = margin operasi</span></div>
    <div class="kv k3" style="margin-top:10px">
      ${chip('Pendapatan YoY (kuartal terakhir)', q.rev_yoy, (q.rev_yoy ?? 0) >= 0)}
      ${chip('Percepatan vs kuartal lalu', q.accel, (q.accel ?? 0) >= 0)}
      ${chip('Margin operasi 12 bln', q.opm_ttm, (q.opm_ttm ?? 0) >= (q.opm_prev ?? 0))}
    </div>
    <p class="small faint" style="margin:8px 0 0">${s.fcf_src === 'ttm' ? `Free cash flow memakai data 12 bulan terakhir (4 kuartal): <b>${fmt.big(q.fcf_ttm)}</b> — dipakai di DCF &amp; FCF yield.` : 'Free cash flow memakai laporan tahunan terakhir.'}${q.opm_prev != null ? ` Margin operasi 12 bln sebelumnya ${fmt.pct(q.opm_prev, 1, false)}.` : ''}</p>
  </div>`;
}

/* ------------------------------------------------------------ 2. sinkronisasi cloud (GitHub Gist) */
const CLOUD_FILE = 'radar-saham.json';
const NOTIFY_DEFAULT = { daily: true, intraday: true, flow: true, flow_market: true, move_pct: 5, auto_plan: true, news: true, news_market: true, news_level: 'tinggi' };
App.cloud = store.get('cloud', null);
App.alerts = store.get('alerts', {});
App.notify = Object.assign({}, NOTIFY_DEFAULT, store.get('notify', {}));
let localUpdated = store.get('localUpdated', 0);

function cloudPayload() {
  return { v: 1, updated: new Date(localUpdated || Date.now()).toISOString(), watchlist: [...App.watch], compare: App.cmp,
    alerts: App.alerts, settings: App.notify, push: App.pushSubs || [], holdings: App.holdings || [] };
}
function applyState(st) {
  App.watch = new Set((st.watchlist || []).filter(Boolean));
  store.set('watchlist', [...App.watch]);
  App.cmp = (st.compare || []).filter(Boolean).slice(0, 4);
  store.set('compare', App.cmp);
  App.alerts = st.alerts || {};
  store.set('alerts', App.alerts);
  App.notify = Object.assign({}, NOTIFY_DEFAULT, st.settings || {});
  store.set('notify', App.notify);
  App.pushSubs = st.push || [];
  store.set('pushSubs', App.pushSubs);
  App.holdings = st.holdings || [];
  store.set('holdings', App.holdings);
}
async function ghApi(path, opt = {}) {
  const res = await fetch('https://api.github.com' + path, Object.assign({}, opt, {
    headers: Object.assign({ Authorization: 'Bearer ' + App.cloud.token, Accept: 'application/vnd.github+json' },
      opt.body ? { 'Content-Type': 'application/json' } : {}),
  }));
  if (!res.ok) {
    const msg = res.status === 401 ? 'token tidak valid / kedaluwarsa' : res.status === 404 ? 'tidak ditemukan (scope gist?)' : 'HTTP ' + res.status;
    throw new Error(msg);
  }
  return res.json();
}
async function readGist(id) {
  const g = await ghApi('/gists/' + id);
  const f = g.files[CLOUD_FILE];
  if (!f) throw new Error('file gist hilang');
  let content = f.content;
  if (f.truncated) content = await (await fetch(f.raw_url)).text();
  return { gist: g, data: JSON.parse(content || '{}') };
}
async function cloudConnect(token) {
  App.cloud = { token: token.trim() };
  const user = await ghApi('/user');
  let gistId = null;
  for (let page = 1; page <= 3 && !gistId; page++) {
    const list = await ghApi(`/gists?per_page=100&page=${page}`);
    const hit = list.find((g) => g.files && g.files[CLOUD_FILE]);
    if (hit) gistId = hit.id;
    if (list.length < 100) break;
  }
  if (gistId) {
    // perangkat kedua: gabungkan (union) agar tidak ada yang hilang
    const { data } = await readGist(gistId);
    const merged = {
      watchlist: [...new Set([...(data.watchlist || []), ...App.watch])],
      compare: (data.compare && data.compare.length ? data.compare : App.cmp),
      alerts: Object.assign({}, App.alerts, data.alerts || {}),
      settings: Object.assign({}, App.notify, data.settings || {}),
      push: [...new Map([...(data.push || []), ...(App.pushSubs || [])].map((x) => [x.endpoint, x])).values()],
      holdings: (data.holdings && data.holdings.length ? data.holdings : App.holdings || []),
    };
    applyState(merged);
  }
  localUpdated = Date.now();
  store.set('localUpdated', localUpdated);
  App.cloud = { token: App.cloud.token, login: user.login, gistId };
  if (!gistId) {
    const g = await ghApi('/gists', { method: 'POST', body: JSON.stringify({
      description: 'Radar Saham US — watchlist, alert & pengaturan (dibuat otomatis oleh aplikasi)', public: false,
      files: { [CLOUD_FILE]: { content: JSON.stringify(cloudPayload(), null, 1) } } }) });
    App.cloud.gistId = g.id;
  } else await cloudPush();
  App.cloud.synced = Date.now();
  store.set('cloud', App.cloud);
}
async function cloudPush() {
  if (!App.cloud || !App.cloud.gistId) return;
  await ghApi('/gists/' + App.cloud.gistId, { method: 'PATCH', body: JSON.stringify({ files: { [CLOUD_FILE]: { content: JSON.stringify(cloudPayload(), null, 1) } } }) });
  App.cloud.synced = Date.now();
  store.set('cloud', App.cloud);
}
async function cloudPull() {
  if (!App.cloud || !App.cloud.gistId) return false;
  const { data } = await readGist(App.cloud.gistId);
  const rT = Date.parse(data.updated || 0) || 0;
  let changed = false;
  if (rT > localUpdated) {
    applyState(data);
    localUpdated = rT;
    store.set('localUpdated', localUpdated);
    changed = true;
  } else if (localUpdated > rT) await cloudPush();
  App.cloud.synced = Date.now();
  store.set('cloud', App.cloud);
  return changed;
}
function cloudChanged() {
  localUpdated = Date.now();
  store.set('localUpdated', localUpdated);
  if (!App.cloud || !App.cloud.gistId) return;
  clearTimeout(cloudChanged._t);
  cloudChanged._t = setTimeout(() => cloudPush().catch((e) => toast('Sinkron cloud gagal: ' + e.message)), 1200);
}
// kaitkan ke fungsi yang mengubah watchlist / perbandingan
const _toggleWatch = toggleWatch;
toggleWatch = function (sym) { _toggleWatch(sym); cloudChanged(); };
const _saveCmp = saveCmp;
saveCmp = function () { _saveCmp(); cloudChanged(); };

/* ------------------------------------------------------------ 3. alert harga */
function openAlertSheet(s) {
  const a = App.alerts[s.sym] || {};
  const p = s.plan || {};
  openSheet(`<div class="sheet-handle"></div><h3 style="text-transform:uppercase;letter-spacing:.06em;color:var(--accent)">Alert Harga ${esc(s.sym)}</h3>
    <p class="small muted">Harga sekarang <b>${fmt.usd(s.price)}</b>. Notifikasi dikirim ke Telegram (dicek tiap 30 menit saat bursa buka) — perlu sinkronisasi cloud &amp; Telegram aktif di <a class="link" href="#/pengaturan" data-close>Pengaturan</a>.</p>
    <div class="alert-form">
      <label>Beri tahu jika harga ≥<input id="alAbove" type="number" step="0.01" inputmode="decimal" value="${a.above ?? ''}" placeholder="${p.target ? p.target.toFixed(2) : ''}"></label>
      <label>Beri tahu jika harga ≤<input id="alBelow" type="number" step="0.01" inputmode="decimal" value="${a.below ?? ''}" placeholder="${p.stop ? p.stop.toFixed(2) : ''}"></label>
    </div>
    <div class="chips-wrap" style="margin-top:8px">
      ${p.target ? `<button class="chip" data-fill="above" data-v="${p.target}">Target ${fmt.usd(p.target)}</button>` : ''}
      ${p.stop ? `<button class="chip" data-fill="below" data-v="${p.stop}">Stop ${fmt.usd(p.stop)}</button>` : ''}
      <button class="chip" data-fill="above" data-v="${(s.price * 1.1).toFixed(2)}">+10%</button>
      <button class="chip" data-fill="below" data-v="${(s.price * 0.9).toFixed(2)}">−10%</button>
    </div>
    <div class="sheet-actions">${App.alerts[s.sym] ? '<button class="btn" id="alDel">Hapus alert</button>' : ''}<button class="btn" data-close>Batal</button><button class="btn primary" id="alSave">Simpan</button></div>`);
  $('#sheet').querySelectorAll('[data-fill]').forEach((b) => {
    b.onclick = () => { $(b.dataset.fill === 'above' ? '#alAbove' : '#alBelow').value = Number(b.dataset.v).toFixed(2); };
  });
  $('#alSave').onclick = () => {
    const ab = parseFloat($('#alAbove').value), be = parseFloat($('#alBelow').value);
    if (!(ab > 0) && !(be > 0)) { toast('Isi minimal satu batas harga'); return; }
    App.alerts[s.sym] = { above: ab > 0 ? ab : null, below: be > 0 ? be : null, set: new Date().toISOString().slice(0, 10) };
    store.set('alerts', App.alerts);
    if (!App.watch.has(s.sym)) toggleWatch(s.sym); else cloudChanged();
    closeSheet();
    toast(`Alert ${s.sym} disimpan${App.cloud && App.cloud.gistId ? ' & disinkronkan' : ''}`);
    const b = $('#alertBtn'); if (b) b.classList.add('on');
  };
  const del = $('#alDel');
  if (del) del.onclick = () => { delete App.alerts[s.sym]; store.set('alerts', App.alerts); cloudChanged(); closeSheet(); toast('Alert dihapus'); const b = $('#alertBtn'); if (b) b.classList.remove('on'); };
}

/* ------------------------------------------------------------ halaman pengaturan */
function repoInfo() {
  const h = location.hostname, seg = location.pathname.split('/').filter(Boolean)[0];
  if (h.endsWith('github.io') && seg) return { owner: h.split('.')[0], repo: seg };
  return { owner: 'GabFx09', repo: 'radar-saham-us' };
}
function ago(t) {
  if (!t) return 'belum pernah';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'baru saja' : m < 60 ? m + ' menit lalu' : Math.round(m / 60) + ' jam lalu';
}
function renderSettings(el) {
  const c = App.cloud, ri = repoInfo(), slug = `${ri.owner}/${ri.repo}`;
  const al = Object.entries(App.alerts);
  const N = App.notify;
  el.innerHTML = `<div class="fade-in">
    <h1 class="page-title">Pengaturan</h1>
    <p class="page-sub">Sinkronisasi watchlist antar perangkat, notifikasi Telegram, dan alert harga.</p>
    <div class="grid-2">
    <div class="card card-pad">
      <h3 class="card-title">Sinkronisasi Cloud</h3>
      ${c && c.gistId ? `<p class="small">✅ Terhubung sebagai <b>@${esc(c.login)}</b> · sinkron ${ago(c.synced)}<br>
          Data tersimpan di <a class="link" href="https://gist.github.com/${esc(c.login)}/${esc(c.gistId)}" target="_blank" rel="noopener">gist rahasia Anda ↗</a>: ${App.watch.size} watchlist · ${al.length} alert.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" id="cSync">Sinkronkan sekarang</button><button class="btn" id="cOff">Putuskan perangkat ini</button></div>`
      : `<p class="small muted">Watchlist, perbandingan, alert, dan pengaturan disimpan di <b>GitHub Gist rahasia</b> milik Anda sendiri — otomatis sama di HP &amp; laptop, dan dibaca oleh notifikasi Telegram.</p>
        <ol class="small steps">
          <li>Buat token: <a class="link" href="https://github.com/settings/tokens/new?scopes=gist&amp;description=Radar%20Saham%20US" target="_blank" rel="noopener">GitHub → token baru (scope: gist) ↗</a>. Pilih masa berlaku "No expiration" atau sesuai keinginan, lalu salin.</li>
          <li>Tempel di bawah lalu ketuk Hubungkan. Ulangi di setiap perangkat.</li>
        </ol>
        <div class="alert-form"><label>Token GitHub (scope gist)<input id="cTok" type="password" autocomplete="off" placeholder="ghp_…"></label></div>
        <button class="btn primary" id="cOn" style="margin-top:10px">Hubungkan</button>
        <p class="small faint" style="margin:10px 0 0">Token hanya disimpan di browser perangkat ini dan hanya bisa mengakses gist — bukan repo atau akun Anda. Gist "rahasia" tidak tampil publik, tetapi siapa pun yang tahu alamatnya bisa membacanya; isinya hanya daftar ticker &amp; batas harga.</p>`}
    </div>

    <div class="card card-pad">
      <h3 class="card-title">Notifikasi via Kabar (disarankan)</h3>
      <p class="small muted" style="margin-top:0"><a class="link" href="https://gabfx09.github.io/kabar/" target="_blank" rel="noopener">Kabar ↗</a> adalah aplikasi kotak pesan terpisah milik Anda — bisa dipakai juga untuk notifikasi dari skrip &amp; aplikasi lain. Radar Saham mengirim ke saluran <b>"Radar Saham"</b>: ringkasan pagi, alert harga, dan berita sangat penting.</p>
      <ol class="small steps">
        <li>Buka <a class="link" href="https://gabfx09.github.io/kabar/" target="_blank" rel="noopener">Kabar</a>, masuk dengan token GitHub (scope gist) — boleh token yang sama dengan sinkronisasi di atas — lalu <b>Setelan → Aktifkan notifikasi</b> di HP.</li>
        <li>Simpan secret repo di <a class="link" href="https://github.com/${esc(slug)}/settings/secrets/actions" target="_blank" rel="noopener">GitHub → Secrets ↗</a>:
          <pre class="code">KABAR_TOKEN = token GitHub (scope gist)
KABAR_VAPID = kunci privat notifikasi Kabar
GIST_TOKEN  = token yang sama (membaca watchlist &amp; alert dari aplikasi ini)</pre></li>
        <li>Uji: <a class="link" href="https://github.com/${esc(slug)}/actions/workflows/alerts.yml" target="_blank" rel="noopener">Actions → Alert harga &amp; berita penting → Run workflow ↗</a> dengan mode <code>test</code>.</li>
      </ol>
    </div>

    <div class="card card-pad">
      <h3 class="card-title">Notifikasi Telegram (opsional)</h3>
      <p class="small muted" style="margin-top:0">Ringkasan pagi setelah update data (watchlist, perubahan rekomendasi, laporan keuangan, berita penting 24 jam) + alert harga tiap 30 menit saat bursa AS buka + <b>berita sangat penting</b> dicek tiap 30 menit sepanjang hari.</p>
      <ol class="small steps">
        <li>Di Telegram, chat <a class="link" href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather ↗</a> → <code>/newbot</code> → beri nama → salin <b>token bot</b>.</li>
        <li>Buka bot baru Anda lalu kirim pesan apa saja (mis. "halo").</li>
        <li>Cari chat ID Anda di sini (token tidak disimpan):
          <div class="alert-form" style="margin-top:6px"><label>Token bot<input id="tgTok" type="password" autocomplete="off" placeholder="123456:ABC…"></label></div>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap"><button class="btn" id="tgFind">Cari chat ID</button><button class="btn" id="tgTest">Kirim pesan uji</button></div>
          <div id="tgOut" class="small" style="margin-top:6px"></div></li>
        <li>Simpan sebagai <i>secret</i> repo di <a class="link" href="https://github.com/${esc(slug)}/settings/secrets/actions" target="_blank" rel="noopener">GitHub → Settings → Secrets ↗</a>:
          <pre class="code">TELEGRAM_TOKEN    = token bot
TELEGRAM_CHAT_ID  = chat ID
GIST_TOKEN        = token GitHub (scope gist) yang sama dengan sinkronisasi</pre>
          atau lewat terminal: <pre class="code">gh secret set TELEGRAM_TOKEN -R ${esc(slug)}
gh secret set TELEGRAM_CHAT_ID -R ${esc(slug)}
gh secret set GIST_TOKEN -R ${esc(slug)}</pre></li>
        <li>Uji: <a class="link" href="https://github.com/${esc(slug)}/actions/workflows/alerts.yml" target="_blank" rel="noopener">Actions → Alert harga &amp; berita penting → Run workflow ↗</a> dengan mode <code>test</code> atau <code>digest</code>.</li>
      </ol>
    </div>
    </div>

    <div class="grid-2" style="margin-top:12px">
    <div class="card card-pad">
      <h3 class="card-title">Preferensi Notifikasi</h3>
      <label class="tog"><input type="checkbox" id="nDaily" ${N.daily ? 'checked' : ''}> Ringkasan pagi (setelah update data harian)</label>
      <label class="tog"><input type="checkbox" id="nIntra" ${N.intraday ? 'checked' : ''}> Alert harga intraday (tiap 30 menit)</label>
      <label class="tog"><input type="checkbox" id="nFlow" ${N.flow !== false ? 'checked' : ''}> 💰 Dana masuk / 💸 keluar besar pada saham watchlist &amp; portofolio (tiap ±30 menit saat bursa buka)</label>
      <label class="tog"><input type="checkbox" id="nFlowMkt" ${N.flow_market !== false ? 'checked' : ''}> 💰 Dana masuk besar ke saham Buy/Strong Buy mana pun</label>
      <label class="tog"><input type="checkbox" id="nAuto" ${N.auto_plan ? 'checked' : ''}> Alert otomatis saat saham watchlist menyentuh target / stop loss model</label>
      <label class="tog">Alert bila saham watchlist bergerak ≥ <input type="number" id="nMove" min="1" max="30" step="0.5" value="${N.move_pct}" style="width:70px"> % dalam sehari</label>
      <label class="tog"><input type="checkbox" id="nNews" ${N.news ? 'checked' : ''}> Berita sangat penting tentang saham watchlist (akuisisi, investigasi, panduan laba, pergantian CEO, FDA, kebangkrutan…)</label>
      <label class="tog"><input type="checkbox" id="nNewsMkt" ${N.news_market ? 'checked' : ''}> Berita pasar besar (keputusan The Fed, perang, krisis bank, tarif, pasar anjlok…)</label>
      <label class="tog">Kepekaan berita <select id="nNewsLvl" class="sel"><option value="tinggi" ${N.news_level !== 'sedang' ? 'selected' : ''}>Hanya yang sangat penting</option><option value="sedang" ${N.news_level === 'sedang' ? 'selected' : ''}>Lebih banyak (termasuk upgrade/downgrade, PHK)</option></select></label>
      <p class="small faint" style="margin:8px 0 0">${c && c.gistId ? 'Disinkronkan ke cloud dan dibaca oleh workflow notifikasi.' : 'Hubungkan sinkronisasi cloud agar preferensi ini dibaca oleh notifikasi.'}</p>
    </div>
    <div class="card card-pad">
      <h3 class="card-title">Alert Harga (${al.length})</h3>
      ${al.length ? `<table class="hold-table"><tr><th>Saham</th><th class="r">≥</th><th class="r">≤</th><th class="r">Harga</th><th></th></tr>
        ${al.map(([sym, a]) => { const st = App.bySym[sym]; return `<tr><td><a href="#/s/${encodeURIComponent(sym)}"><b>${esc(sym)}</b></a></td><td class="r mono">${a.above ? fmt.usd(a.above) : '–'}</td><td class="r mono">${a.below ? fmt.usd(a.below) : '–'}</td><td class="r mono">${st ? fmt.usd(st.price) : '–'}</td><td class="r"><button class="cmp-x" data-delal="${esc(sym)}" aria-label="Hapus">×</button></td></tr>`; }).join('')}</table>`
        : '<p class="small muted">Belum ada. Buka halaman saham lalu ketuk <b>Alert</b>.</p>'}
    </div>
    </div>

    <div class="card card-pad" style="margin-top:12px">
      <h3 class="card-title">Status Data</h3>
      <div id="dataStatus" class="small muted">memeriksa…</div>
    </div>

    <div class="card card-pad" style="margin-top:12px">
      <h3 class="card-title">Cadangan Manual</h3>
      <p class="small muted" style="margin-top:0">Tanpa akun cloud: salin kode ini lalu tempel di perangkat lain.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="bkCopy">Salin kode cadangan</button><button class="btn" id="bkPaste">Tempel kode…</button></div>
    </div>
    <p class="disclaimer">Notifikasi berjalan di GitHub Actions milik repo Anda; jadwal GitHub bisa terlambat beberapa menit hingga jam pada saat sibuk.</p>
  </div>`;

  dataStatus();
  const on = $('#cOn');
  if (on) on.onclick = async () => {
    const t = $('#cTok').value.trim();
    if (!t) { toast('Tempel token dulu'); return; }
    on.disabled = true; on.textContent = 'Menghubungkan…';
    try { await cloudConnect(t); toast('Tersambung ke cloud ✓'); render(); } catch (e) { App.cloud = null; store.set('cloud', null); toast('Gagal: ' + e.message); on.disabled = false; on.textContent = 'Hubungkan'; }
  };
  const sy = $('#cSync');
  if (sy) sy.onclick = async () => { try { await cloudPull(); toast('Sinkron ✓'); render(); } catch (e) { toast('Gagal: ' + e.message); } };
  const off = $('#cOff');
  if (off) off.onclick = () => { App.cloud = null; store.set('cloud', null); toast('Perangkat ini diputus dari cloud'); render(); };

  const tg = async (method, body) => {
    const tok = $('#tgTok').value.trim();
    if (!tok) throw new Error('isi token bot');
    const r = await fetch(`https://api.telegram.org/bot${tok}/${method}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
    const j = await r.json();
    if (!j.ok) throw new Error(j.description || 'gagal');
    return j.result;
  };
  $('#tgFind').onclick = async () => {
    const out = $('#tgOut');
    try {
      const res = await tg('getUpdates');
      const chats = [...new Map(res.map((u) => (u.message || u.channel_post || {}).chat).filter(Boolean).map((ch) => [ch.id, ch])).values()];
      out.innerHTML = chats.length ? chats.map((ch) => `Chat ID: <b class="mono" style="color:var(--accent)">${ch.id}</b> (${esc(ch.first_name || ch.title || ch.username || '')})`).join('<br>') + '<br><span class="faint">Simpan angka ini sebagai TELEGRAM_CHAT_ID.</span>'
        : 'Belum ada pesan. Kirim pesan ke bot Anda dulu, lalu coba lagi.';
      if (chats.length) App._tgChat = chats[0].id;
    } catch (e) { out.textContent = 'Gagal: ' + e.message; }
  };
  $('#tgTest').onclick = async () => {
    const out = $('#tgOut');
    try {
      if (!App._tgChat) throw new Error('cari chat ID dulu');
      await tg('sendMessage', { chat_id: App._tgChat, text: '✅ Radar Saham US terhubung ke Telegram.' });
      out.innerHTML = '<b class="up">Pesan uji terkirim.</b> Lanjutkan ke langkah 4.';
    } catch (e) { out.textContent = 'Gagal: ' + e.message; }
  };
  const saveN = () => {
    App.notify = { daily: $('#nDaily').checked, intraday: $('#nIntra').checked, auto_plan: $('#nAuto').checked, flow: $('#nFlow').checked, flow_market: $('#nFlowMkt').checked,
      move_pct: clamp(parseFloat($('#nMove').value) || 5, 1, 30), news: $('#nNews').checked,
      news_market: $('#nNewsMkt').checked, news_level: $('#nNewsLvl').value };
    store.set('notify', App.notify);
    cloudChanged();
    toast('Preferensi disimpan');
  };
  ['#nDaily', '#nIntra', '#nFlow', '#nFlowMkt', '#nAuto', '#nMove', '#nNews', '#nNewsMkt', '#nNewsLvl'].forEach((id) => { $(id).onchange = saveN; });
  $$('[data-delal]').forEach((b) => { b.onclick = () => { delete App.alerts[b.dataset.delal]; store.set('alerts', App.alerts); cloudChanged(); render(); }; });
  $('#bkCopy').onclick = async () => {
    const code = 'RS1:' + btoa(unescape(encodeURIComponent(JSON.stringify(cloudPayload()))));
    try { await navigator.clipboard.writeText(code); toast('Kode cadangan disalin'); } catch (e) { prompt('Salin kode ini:', code); }
  };
  $('#bkPaste').onclick = () => {
    const code = prompt('Tempel kode cadangan (diawali RS1:)');
    if (!code) return;
    try {
      const st = JSON.parse(decodeURIComponent(escape(atob(code.trim().replace(/^RS1:/, '')))));
      applyState(st);
      cloudChanged();
      toast('Data dipulihkan ✓');
      render();
    } catch (e) { toast('Kode tidak valid'); }
  };
}

/* ------------------------------------------------------------ status kesegaran data */
async function dataStatus() {
  const el = $('#dataStatus');
  if (!el) return;
  const get = async (f) => { try { const r = await fetch('data/' + f, { cache: 'no-cache' }); return r.ok ? r.json() : null; } catch (e) { return null; } };
  const [mk, br, ip, cy, lv] = await Promise.all([get('makro.json'), get('berita.json'), get('ipo.json'), get('cycles.json'), get('live.json')]);
  const S = App.data.stocks;
  const age = (t) => { if (!t) return null; const h = (Date.now() - Date.parse(t)) / 36e5; return h; };
  const row = (n, t, maxH, extra) => {
    const h = age(t);
    const c = h == null ? 'down' : h <= maxH ? 'up' : h <= maxH * 2 ? '' : 'down';
    const txt = h == null ? 'tidak ada' : h < 1 ? Math.round(h * 60) + ' menit lalu' : h < 48 ? Math.round(h) + ' jam lalu' : Math.round(h / 24) + ' hari lalu';
    return `<tr><td>${n}</td><td class="r mono ${c}">${txt}</td><td class="small faint">${extra || ''}</td></tr>`;
  };
  if (!document.body.contains(el)) return;
  el.innerHTML = `<table class="hold-table">
    <tr><th>Sumber</th><th class="r">Diperbarui</th><th>Cakupan</th></tr>
    ${row('Harga live', lv && lv.t, 1.5, lv ? `${Object.keys(lv.assets || {}).length} aset · ${Object.keys(lv.stocks || {}).length} saham` : '')}
    ${row('Skor &amp; fundamental', App.data.generated, 36, `${S.length} saham · revisi estimasi ${S.filter((s) => s.rev != null).length} · orang dalam ${(App.data.cov || {}).ins ?? S.filter((s) => s.ins).length} · valuasi historis ${(App.data.cov || {}).own ?? S.filter((s) => s.own).length}`)}
    ${row('Monitor makro', mk && mk.generated, 36, mk ? `${mk.assets.reduce((a, g) => a + g.rows.length, 0)} aset · F&amp;G ${mk.fg ? Math.round(mk.fg.now) : '–'}` : '')}
    ${row('Berita penting', br && br.generated, 36, br ? `${br.items.length} berita` : '')}
    ${row('Kalender IPO', ip && ip.generated, 36, ip ? `${ip.upcoming.length} akan IPO · ${ip.recent.length} terbaru` : '')}
    ${row('Siklus &amp; CAPE', App.data.generated, 36, cy && cy.longrun ? `CPI s.d. ${cy.longrun.cpi_until}` : '')}
  </table>
  <p class="small faint" style="margin:8px 0 0">Hijau = segar. Update harian berjalan setelah bursa AS tutup (±05.00–11.00 WIB, jadwal GitHub bisa terlambat); harga live tiap ±20 menit. Bila update gagal, peringatan dikirim ke Kabar.</p>`;
}

/* ------------------------------------------------------------ boot: tarik data cloud */
(function extBoot() {
  if (!App.cloud || !App.cloud.gistId) return;
  const wait = setInterval(() => {
    if (!App.data) return;
    clearInterval(wait);
    cloudPull().then((changed) => { if (changed) render(); }).catch((e) => toast('Sinkron cloud gagal: ' + e.message));
  }, 300);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && App.data && App.cloud && App.cloud.gistId &&
      Date.now() - (App.cloud.synced || 0) > 60000) cloudPull().then((c) => { if (c) render(); }).catch(() => {});
  });
})();
