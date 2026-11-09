/* =====================================================================
   Radar Saham US — aplikasi (vanilla JS, tanpa build)
   ===================================================================== */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* abaikan */ } },
};

const App = {
  data: null,
  bySym: {},
  watch: new Set(store.get('watchlist', [])),
  filters: Object.assign(defaultFilters(), store.get('filters', {})),
  shown: 50,
  scroll: {},
  histCache: {},
};

function defaultFilters() {
  return { q: '', preset: 'all', sectors: [], caps: [], ratings: [], minFund: 0, minUpside: -50, maxPE: 0, minROE: 0, minPio: 0, minDiv: 0, sort: 'score' };
}

/* ------------------------------------------------------------ format */
const fmt = {
  pct(x, d = 1, sign = true) {
    if (x == null || !isFinite(x)) return '–';
    const v = x * 100;
    return (sign && v > 0 ? '+' : '') + v.toFixed(d) + '%';
  },
  num(x, d = 2) { return x == null || !isFinite(x) ? '–' : Number(x).toFixed(d); },
  x(x, d = 1) { return x == null || !isFinite(x) ? '–' : Number(x).toFixed(d) + 'x'; },
  usd(x, d = 2) {
    if (x == null || !isFinite(x)) return '–';
    return '$' + Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  },
  big(x) {
    if (x == null || !isFinite(x)) return '–';
    const a = Math.abs(x), s = x < 0 ? '-' : '';
    if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)} T`;
    if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)} M`;
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)} Jt`;
    return `${s}$${a.toFixed(0)}`;
  },
  date(d, opt) { return new Date(d).toLocaleDateString('id-ID', opt || { day: 'numeric', month: 'short', year: 'numeric' }); },
};
const cls = (x) => (x == null ? '' : x >= 0 ? 'up' : 'down');

function scoreColor(s) {
  const h = clamp((s - 30) / 50, 0, 1) * 148;
  return `hsl(${h.toFixed(0)} 72% 46%)`;
}
function ratingBadge(r) {
  const k = r === 'STRONG BUY' ? 'STRONG' : r;
  const icon = r === 'STRONG BUY' ? '★ ' : '';
  return `<span class="badge r-${k}">${icon}${esc(r)}</span>`;
}
function ring(s, lg) {
  const size = lg ? 84 : 44, R = lg ? 36 : 18, sw = lg ? 7 : 4, C = 2 * Math.PI * R, c = size / 2;
  return `<div class="ring ${lg ? 'lg' : ''}" title="Skor ${s}">
    <svg viewBox="0 0 ${size} ${size}"><circle class="bg" cx="${c}" cy="${c}" r="${R}" fill="none" stroke-width="${sw}"/>
    <circle cx="${c}" cy="${c}" r="${R}" fill="none" stroke="${scoreColor(s)}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${(C * s / 100).toFixed(1)} ${C.toFixed(1)}"/></svg>
    <span style="color:${scoreColor(s)}">${Math.round(s)}</span></div>`;
}
function spark(arr, w = 72, h = 30) {
  if (!arr || arr.length < 2) return '';
  const min = Math.min(...arr), max = Math.max(...arr), rng = max - min || 1;
  const pts = arr.map((v, i) => [(i / (arr.length - 1)) * w, h - 2 - ((v - min) / rng) * (h - 4)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  const col = arr[arr.length - 1] >= arr[0] ? 'var(--up)' : 'var(--down)';
  const id = 'g' + Math.random().toString(36).slice(2, 8);
  return `<svg class="row-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".25"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d}L${w} ${h}L0 ${h}Z" fill="url(#${id})"/><path d="${d}" fill="none" stroke="${col}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ------------------------------------------------------------ presets */
const PRESETS = [
  { id: 'all', name: 'Semua', desc: 'Seluruh saham, diurutkan berdasarkan skor gabungan.', f: () => true },
  { id: 'strong', name: '★ Strong Buy', desc: 'Skor tinggi, fundamental kuat, dan potensi naik ≥12%.', f: (s) => s.rating === 'STRONG BUY' },
  { id: 'buy', name: 'Buy + Strong Buy', desc: 'Semua saham dengan rekomendasi beli.', f: (s) => s.rating === 'STRONG BUY' || s.rating === 'BUY' },
  { id: 'quality_value', name: 'Kualitas Murah', desc: 'Bisnis berkualitas tinggi yang dihargai murah.', f: (s) => s.pillars.quality >= 65 && s.pillars.value >= 60, sort: 'fund' },
  { id: 'garp', name: 'Growth Wajar (GARP)', desc: 'Pertumbuhan tinggi dengan PEG ≤ 1.5.', f: (s) => s.pillars.growth >= 68 && s.m.peg != null && s.m.peg > 0 && s.m.peg <= 1.5 && s.fund >= 58, sort: 'growth' },
  { id: 'compounder', name: 'Compounder', desc: 'ROIC ≥ 18%, pendapatan tumbuh ≥ 8%/thn, neraca sehat — mesin bunga majemuk.', f: (s) => (s.m.roic ?? 0) >= 0.18 && (s.m.rev_cagr3 ?? 0) >= 0.08 && s.pillars.health >= 55, sort: 'quality' },
  { id: 'upside', name: 'Upside Terbesar', desc: 'Potensi naik ≥ 25% dengan fundamental ≥ 60.', f: (s) => s.val && s.val.upside >= 0.25 && s.fund >= 60, sort: 'upside' },
  { id: 'dividend', name: 'Dividen Kuat', desc: 'Dividen ≥ 2.5%, payout aman, neraca sehat.', f: (s) => (s.m.div_yield ?? 0) >= 0.025 && s.pillars.health >= 50 && (s.m.payout ?? 0) < 0.9, sort: 'div' },
  { id: 'momentum', name: 'Momentum + Fundamental', desc: 'Teknikal ≥ 75 dan fundamental ≥ 62: tren naik yang didukung bisnis bagus.', f: (s) => s.tech >= 75 && s.fund >= 62, sort: 'tech' },
  { id: 'fortress', name: 'Neraca Benteng', desc: 'Kesehatan keuangan ≥ 75 dan Piotroski ≥ 7.', f: (s) => s.pillars.health >= 75 && (s.m.piotroski ?? 0) >= 7, sort: 'fund' },
];

const SORTS = {
  score: ['Skor gabungan', (s) => s.score],
  fund: ['Skor fundamental', (s) => s.fund],
  upside: ['Potensi naik', (s) => (s.val ? s.val.upside : -9)],
  quality: ['Kualitas', (s) => s.pillars.quality],
  value: ['Valuasi (termurah)', (s) => s.pillars.value],
  growth: ['Pertumbuhan', (s) => s.pillars.growth],
  health: ['Kesehatan keuangan', (s) => s.pillars.health],
  tech: ['Teknikal', (s) => s.tech],
  div: ['Dividen tertinggi', (s) => s.m.div_yield ?? 0],
  mcap: ['Kapitalisasi pasar', (s) => s.mcap ?? 0],
  chg: ['Perubahan harian', (s) => s.chg1d ?? 0],
};
const RATINGS = ['STRONG BUY', 'BUY', 'HOLD', 'HINDARI'];
const CAPS = { Mega: 'Mega (>$200M)', Large: 'Large ($10–200M)', Mid: 'Mid ($2–10M)', Small: 'Small (<$2M)' };

/* ------------------------------------------------------------ data */
async function loadData() {
  const res = await fetch('data/stocks.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const d = await res.json();
  App.data = d;
  App.bySym = Object.fromEntries(d.stocks.map((s) => [s.sym, s]));
}
async function loadHist(sym) {
  if (App.histCache[sym]) return App.histCache[sym];
  const res = await fetch(`data/history/${encodeURIComponent(sym)}.json`);
  if (!res.ok) throw new Error('riwayat tidak tersedia');
  const h = await res.json();
  App.histCache[sym] = h;
  return h;
}

/* ------------------------------------------------------------ router */
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, query: new URLSearchParams(qs || '') };
}
let currentKey = '';
function render() {
  if (!App.data) return;
  const { parts, query } = parseHash();
  App.scroll[currentKey] = window.scrollY;
  const view = parts[0] || 'home';
  const key = parts.join('/');
  const el = $('#app');
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === (view === 's' ? '' : view)));
  if (view === 'home') renderHome(el);
  else if (view === 'screener') {
    if (query.get('p')) {
      Object.assign(App.filters, defaultFilters(), { preset: query.get('p') });
      const pr = PRESETS.find((p) => p.id === query.get('p'));
      if (pr && pr.sort) App.filters.sort = pr.sort;
      saveFilters();
      history.replaceState(null, '', '#/screener');
    }
    renderScreener(el);
  } else if (view === 's' && parts[1]) renderDetail(el, decodeURIComponent(parts[1]).toUpperCase());
  else if (view === 'watchlist') renderWatchlist(el);
  else if (view === 'metode') renderMethod(el);
  else renderHome(el);
  currentKey = key;
  const y = App.scroll[key];
  window.scrollTo(0, view === 's' ? 0 : y || 0);
}

/* ------------------------------------------------------------ rows */
function stockRow(s) {
  const up = s.val ? s.val.upside : null;
  return `<a class="row" href="#/s/${encodeURIComponent(s.sym)}">
    ${ring(s.score)}
    <div class="row-main">
      <div class="row-sym">${esc(s.sym)} ${ratingBadge(s.rating)} ${App.watch.has(s.sym) ? '<span style="color:var(--gold)">★</span>' : ''}</div>
      <div class="row-name">${esc(s.name)}</div>
      <div class="row-meta"><span>${esc(s.sector)}</span><span class="sc">F <b>${Math.round(s.fund)}</b></span><span class="sc">T <b>${Math.round(s.tech)}</b></span></div>
    </div>
    <div class="row-cols">
      <div class="row-col" style="color:${scoreColor(s.fund)}">${Math.round(s.fund)}<small>Fundamental</small></div>
      <div class="row-col" style="color:${scoreColor(s.pillars.value)}">${Math.round(s.pillars.value)}<small>Valuasi</small></div>
      <div class="row-col" style="color:${scoreColor(s.tech)}">${Math.round(s.tech)}<small>Teknikal</small></div>
      <div class="row-col">${s.m.pe_fwd ? fmt.x(s.m.pe_fwd) : '–'}<small>P/E fwd</small></div>
    </div>
    <div class="row-right">
      ${spark(s.spark)}
      <div>
        <div class="row-price">${fmt.usd(s.price)}</div>
        <div class="row-up ${cls(up)}" title="Potensi ke nilai wajar">${up == null ? '–' : (up >= 0 ? '▲ ' : '▼ ') + fmt.pct(Math.abs(up), 1, false)}</div>
      </div>
    </div>
  </a>`;
}

/* ------------------------------------------------------------ HOME */
function renderHome(el) {
  const d = App.data, S = d.stocks, m = d.market;
  const picks = S.filter((s) => s.rating === 'STRONG BUY' || s.rating === 'BUY')
    .sort((a, b) => (b.rating === 'STRONG BUY') - (a.rating === 'STRONG BUY') || b.score - a.score).slice(0, 8);
  const nSB = S.filter((s) => s.rating === 'STRONG BUY').length;
  const nB = S.filter((s) => s.rating === 'BUY').length;
  const ups = S.filter((s) => s.val && (s.rating === 'STRONG BUY' || s.rating === 'BUY')).map((s) => s.val.upside).sort((a, b) => a - b);
  const medUp = ups.length ? ups[Math.floor(ups.length / 2)] : null;
  const regimeCls = m && m.regime === 'Bullish' ? 'bull' : m && m.regime === 'Bearish' ? 'bear' : 'neutral';
  const regimeTxt = { Bullish: 'Pasar Bullish', Bearish: 'Pasar Bearish', Netral: 'Pasar Netral' }[m?.regime] || '';

  const themed = ['quality_value', 'garp', 'compounder', 'dividend'].map((id) => {
    const p = PRESETS.find((x) => x.id === id);
    const key = SORTS[p.sort || 'score'][1];
    const list = S.filter(p.f).sort((a, b) => key(b) - key(a));
    return `<div class="card">
      <div class="card-pad" style="padding-bottom:4px"><div class="section-head" style="margin:0">
        <div><h2 style="font-size:16px">${esc(p.name)}</h2><p>${esc(p.desc)}</p></div>
        <a class="link" href="#/screener?p=${id}">${list.length} saham ›</a></div></div>
      <div class="list">${list.slice(0, 5).map(stockRow).join('') || '<div class="empty small">Belum ada saham yang lolos kriteria ini.</div>'}</div>
    </div>`;
  }).join('');

  const maxSec = Math.max(...d.sectors.map((x) => x.score));
  el.innerHTML = `<div class="fade-in">
    <div class="section-head" style="margin-top:4px">
      <div><h1 class="page-title">Radar Saham US</h1>
      <p class="page-sub" style="margin:0">Screener fundamental-first: ${d.count} saham S&amp;P 500 &amp; growth populer</p></div>
    </div>
    <div class="updated" style="margin:6px 0 16px">Data per ${fmt.date(d.generated, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>

    <div class="market">
      ${m ? `<div class="card card-pad mk-main">
        <div><div class="mk-label">S&amp;P 500 (SPY)</div>
          <div class="mk-value">${fmt.usd(m.spy)} <span class="${cls(m.chg1d)}" style="font-size:14px">${fmt.pct(m.chg1d, 2)}</span></div>
          <div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="regime ${regimeCls}">${regimeTxt}</span>
          <span class="small muted">1 thn ${fmt.pct(m.ret1y)}</span></div></div>
        <div style="width:110px;height:46px">${spark(m.spark, 110, 46).replace('class="row-spark"', 'style="width:110px;height:46px"')}</div>
      </div>` : ''}
      <div class="mk-stats">
        <div class="card stat"><div class="v" style="color:var(--accent)">${nSB}</div><div class="l">Strong Buy</div></div>
        <div class="card stat"><div class="v">${nB}</div><div class="l">Buy</div></div>
        <div class="card stat"><div class="v ${cls(medUp)}">${fmt.pct(medUp, 0)}</div><div class="l">Median upside saham Buy</div></div>
      </div>
    </div>
    ${m ? `<p class="small muted" style="margin:10px 2px 0">${Math.round(m.breadth * 100)}% saham di atas MA200 · SPY ${m.above_sma200 >= 0 ? 'di atas' : 'di bawah'} MA200 (${fmt.pct(m.above_sma200)}) · RSI ${fmt.num(m.rsi, 0)}</p>` : ''}

    <section class="section">
      <div class="section-head"><div><h2>Pilihan Teratas</h2><p>Lolos semua saringan: fundamental kuat, valuasi menarik, tren mendukung</p></div>
      <a class="link" href="#/screener?p=buy">Semua ›</a></div>
      <div class="hscroll">${picks.map(pickCard).join('')}</div>
    </section>

    <section class="section grid-2">${themed}</section>

    <section class="section card card-pad">
      <div class="section-head"><div><h2>Peta Sektor</h2><p>Rata-rata skor &amp; median potensi naik per sektor</p></div></div>
      ${d.sectors.map((x) => `<div class="sector-row">
        <span style="font-weight:600">${esc(x.name)} <span class="faint small">(${x.n})</span></span>
        <div class="bar"><i style="width:${(x.score / maxSec) * 100}%;background:${scoreColor(x.score)}"></i></div>
        <span class="v">${x.score.toFixed(0)}</span>
        <span class="v ${cls(x.upside)}" style="font-size:12px">${fmt.pct(x.upside, 0)}</span></div>`).join('')}
    </section>

    <p class="disclaimer">Bukan ajakan membeli/menjual. Proyeksi berasal dari model kuantitatif & konsensus analis, bisa meleset. Lakukan riset sendiri dan sesuaikan dengan profil risiko Anda.</p>
  </div>`;
}

function pickCard(s) {
  const up = s.val ? s.val.upside : null;
  const reason = s.pros[0] ? s.pros[0].text : s.thesis;
  return `<a class="card pick" href="#/s/${encodeURIComponent(s.sym)}">
    <div class="pick-top">
      <div><div class="pick-rank">#${s.rank} · ${esc(s.sector)}</div>
      <div class="pick-sym">${esc(s.sym)}</div><div class="pick-name">${esc(s.name)}</div></div>
      ${ring(s.score)}
    </div>
    <div class="pick-up"><div><div class="mk-label">Proyeksi naik</div><div class="big ${cls(up)}">${fmt.pct(up, 0)}</div></div>
      <div style="text-align:right"><div class="mk-label">Target</div><div class="mono" style="font-weight:700">${fmt.usd(s.val?.fair)}</div><div class="faint small mono">dari ${fmt.usd(s.price)}</div></div></div>
    <div class="pick-reason">${esc(reason)}</div>
    <div class="pick-foot">${ratingBadge(s.rating)}<span class="tag">Fund ${Math.round(s.fund)}</span><span class="tag">Tek ${Math.round(s.tech)}</span></div>
  </a>`;
}

/* ------------------------------------------------------------ SCREENER */
function saveFilters() { store.set('filters', App.filters); }
function activeFilterCount(f) {
  let n = 0;
  if (f.sectors.length) n++; if (f.caps.length) n++; if (f.ratings.length) n++;
  if (f.minFund > 0) n++; if (f.minUpside > -50) n++; if (f.maxPE > 0) n++; if (f.minROE > 0) n++; if (f.minPio > 0) n++; if (f.minDiv > 0) n++;
  return n;
}
function applyFilters() {
  const f = App.filters;
  const pr = PRESETS.find((p) => p.id === f.preset) || PRESETS[0];
  const q = f.q.trim().toLowerCase();
  let out = App.data.stocks.filter((s) => {
    if (q && !s.sym.toLowerCase().includes(q) && !s.name.toLowerCase().includes(q)) return false;
    if (!pr.f(s)) return false;
    if (f.sectors.length && !f.sectors.includes(s.sector)) return false;
    if (f.caps.length && !f.caps.includes(s.cap)) return false;
    if (f.ratings.length && !f.ratings.includes(s.rating)) return false;
    if (s.fund < f.minFund) return false;
    if (f.minUpside > -50 && (!s.val || s.val.upside * 100 < f.minUpside)) return false;
    if (f.maxPE > 0 && (!s.m.pe_fwd || s.m.pe_fwd > f.maxPE)) return false;
    if (f.minROE > 0 && (s.m.roe == null || s.m.roe * 100 < f.minROE)) return false;
    if (f.minPio > 0 && (s.m.piotroski == null || s.m.piotroski < f.minPio)) return false;
    if (f.minDiv > 0 && ((s.m.div_yield || 0) * 100 < f.minDiv)) return false;
    return true;
  });
  const key = (SORTS[f.sort] || SORTS.score)[1];
  out.sort((a, b) => key(b) - key(a));
  return out;
}
function renderScreener(el) {
  const f = App.filters;
  const pr = PRESETS.find((p) => p.id === f.preset) || PRESETS[0];
  el.innerHTML = `<div class="fade-in">
    <h1 class="page-title">Screener</h1>
    <p class="page-sub">${esc(pr.desc)}</p>
    <div class="chips" id="presetChips">${PRESETS.map((p) => `<button class="chip ${p.id === f.preset ? 'active' : ''}" data-p="${p.id}">${esc(p.name)}</button>`).join('')}</div>
    <div class="toolbar">
      <label class="input"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input id="q" type="search" placeholder="Filter ticker / nama" value="${esc(f.q)}" autocomplete="off"></label>
      <button class="btn" id="openFilter"><svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>Filter${activeFilterCount(f) ? ` <span class="dot">${activeFilterCount(f)}</span>` : ''}</button>
    </div>
    <div class="result-bar"><span id="count"></span>
      <select class="sel" id="sort" aria-label="Urutkan">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${k === f.sort ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>
    <div class="card list" id="results"></div>
    <div style="text-align:center;margin:16px 0" id="moreWrap"></div>
  </div>`;

  const draw = () => {
    const res = applyFilters();
    $('#count').textContent = `${res.length} saham`;
    $('#results').innerHTML = res.slice(0, App.shown).map(stockRow).join('') ||
      `<div class="empty"><div class="big-ico">🔍</div>Tidak ada saham yang cocok.<br><button class="btn" style="margin-top:12px" id="resetAll">Reset filter</button></div>`;
    $('#moreWrap').innerHTML = res.length > App.shown ? `<button class="btn" id="more">Tampilkan lebih banyak (${res.length - App.shown})</button>` : '';
    const ra = $('#resetAll');
    if (ra) ra.onclick = () => { App.filters = defaultFilters(); saveFilters(); renderScreener(el); };
    const mb = $('#more');
    if (mb) mb.onclick = () => { App.shown += 100; draw(); };
  };
  draw();

  $('#presetChips').onclick = (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) return;
    f.preset = b.dataset.p;
    const p = PRESETS.find((x) => x.id === f.preset);
    if (p.sort) f.sort = p.sort;
    App.shown = 50; saveFilters(); renderScreener(el);
  };
  let qt;
  $('#q').oninput = (e) => { clearTimeout(qt); qt = setTimeout(() => { f.q = e.target.value; App.shown = 50; saveFilters(); draw(); }, 120); };
  $('#sort').onchange = (e) => { f.sort = e.target.value; saveFilters(); draw(); };
  $('#openFilter').onclick = () => openFilterSheet(() => renderScreener(el));
}

function openFilterSheet(onApply) {
  const f = JSON.parse(JSON.stringify(App.filters));
  const sectors = App.data.sectors.map((s) => s.name).sort();
  const seg = (name, items, sel) => `<div class="seg" data-seg="${name}">${items.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${sel.includes(v) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
  const slider = (key, label, min, max, step, show) => `<div class="fgroup"><div class="flabel">${label}<span id="lbl_${key}">${show(f[key])}</span></div>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${f[key]}" data-k="${key}"></div>`;
  const shows = {
    minFund: (v) => (v > 0 ? '≥ ' + v : 'Semua'),
    minUpside: (v) => (v > -50 ? '≥ ' + v + '%' : 'Semua'),
    maxPE: (v) => (v > 0 ? '≤ ' + v + 'x' : 'Semua'),
    minROE: (v) => (v > 0 ? '≥ ' + v + '%' : 'Semua'),
    minPio: (v) => (v > 0 ? '≥ ' + v + '/9' : 'Semua'),
    minDiv: (v) => (v > 0 ? '≥ ' + v + '%' : 'Semua'),
  };
  openSheet(`<div class="sheet-handle"></div><h3>Filter Lanjutan</h3><p class="small muted" style="margin:0">Kombinasikan dengan preset di atas.</p>
    <div class="fgroup"><label>Rekomendasi</label>${seg('ratings', RATINGS.map((r) => [r, r]), f.ratings)}</div>
    <div class="fgroup"><label>Kapitalisasi pasar</label>${seg('caps', Object.entries(CAPS), f.caps)}</div>
    <div class="fgroup"><label>Sektor</label>${seg('sectors', sectors.map((s) => [s, s]), f.sectors)}</div>
    ${slider('minFund', 'Skor fundamental minimum', 0, 90, 5, shows.minFund)}
    ${slider('minUpside', 'Potensi naik minimum', -50, 80, 5, shows.minUpside)}
    ${slider('maxPE', 'P/E forward maksimum', 0, 60, 5, shows.maxPE)}
    ${slider('minROE', 'ROE minimum', 0, 50, 5, shows.minROE)}
    ${slider('minPio', 'Piotroski F-Score minimum', 0, 9, 1, shows.minPio)}
    ${slider('minDiv', 'Dividend yield minimum', 0, 6, 0.5, shows.minDiv)}
    <div class="sheet-actions"><button class="btn" id="fReset">Reset</button><button class="btn primary" id="fApply">Terapkan</button></div>`);
  const sh = $('#sheet .sheet');
  $$('[data-seg]', sh).forEach((g) => (g.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const arr = f[g.dataset.seg], v = b.dataset.v, i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
    b.classList.toggle('on');
  }));
  $$('input[type=range]', sh).forEach((r) => (r.oninput = () => { f[r.dataset.k] = Number(r.value); $('#lbl_' + r.dataset.k).textContent = shows[r.dataset.k](f[r.dataset.k]); }));
  $('#fReset').onclick = () => { const d = defaultFilters(); d.preset = App.filters.preset; d.q = App.filters.q; d.sort = App.filters.sort; App.filters = d; saveFilters(); closeSheet(); onApply(); };
  $('#fApply').onclick = () => { App.filters = f; App.shown = 50; saveFilters(); closeSheet(); onApply(); };
}

function openSheet(html) {
  const w = $('#sheet');
  $('.sheet', w).innerHTML = html;
  w.classList.remove('hidden');
  w.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  const w = $('#sheet');
  w.classList.add('hidden');
  w.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

/* ------------------------------------------------------------ DETAIL */
const METRICS = [
  ['Valuasi', [
    ['pe_fwd', 'P/E Forward', 'x', 'Harga ÷ proyeksi laba per saham tahun depan. Makin rendah makin murah.', 'ey_fwd'],
    ['pe_ttm', 'P/E (12 bln terakhir)', 'x', 'Harga ÷ laba 12 bulan terakhir.'],
    ['peg', 'PEG Ratio', 'x2', 'P/E ÷ pertumbuhan laba. Di bawah 1 = murah relatif terhadap pertumbuhannya.', 'peg'],
    ['ev_ebitda', 'EV / EBITDA', 'x', 'Nilai perusahaan (termasuk utang) ÷ laba operasi sebelum penyusutan.', 'ebitda_ev'],
    ['fcf_yield', 'Free Cash Flow Yield', '%', 'Kas bebas tahunan ÷ kapitalisasi pasar. Makin tinggi makin murah.', 'fcf_yield'],
    ['ps', 'Price / Sales', 'x', 'Kapitalisasi ÷ penjualan tahunan.', 'ps'],
    ['pb', 'Price / Book', 'x', 'Harga ÷ nilai buku per saham.', 'pb'],
  ]],
  ['Profitabilitas & Kualitas', [
    ['roic', 'ROIC', '%', 'Imbal hasil atas modal yang diinvestasikan. > 15% = bisnis dengan moat.', 'roic'],
    ['roe', 'ROE', '%', 'Laba bersih ÷ ekuitas pemegang saham.', 'roe'],
    ['roa', 'ROA', '%', 'Laba bersih ÷ total aset.', 'roa'],
    ['gross_margin', 'Gross Margin', '%', 'Laba kotor ÷ pendapatan — indikator pricing power.', 'gross_margin'],
    ['op_margin', 'Operating Margin', '%', 'Laba operasi ÷ pendapatan.', 'op_margin'],
    ['net_margin', 'Net Margin', '%', 'Laba bersih ÷ pendapatan.'],
    ['fcf_margin', 'FCF Margin', '%', 'Free cash flow ÷ pendapatan.', 'fcf_margin'],
    ['margin_trend', 'Perubahan Margin Operasi', 'pp', 'Selisih margin operasi vs tahun sebelumnya.', 'margin_trend'],
  ]],
  ['Pertumbuhan', [
    ['rev_growth', 'Pendapatan (YoY kuartal)', '%', 'Pertumbuhan pendapatan kuartal terakhir vs tahun lalu.', 'rev_growth'],
    ['rev_cagr3', 'Pendapatan CAGR 3 thn', '%', 'Rata-rata pertumbuhan pendapatan per tahun.', 'rev_cagr3'],
    ['eps_growth_fwd', 'Proyeksi Pertumbuhan EPS', '%', 'EPS forward vs EPS 12 bulan terakhir (estimasi analis).', 'eps_growth_fwd'],
    ['earn_growth', 'Laba (YoY kuartal)', '%', 'Pertumbuhan laba kuartal terakhir.', 'earn_growth'],
    ['fcf_cagr3', 'Free Cash Flow CAGR', '%', 'Rata-rata pertumbuhan free cash flow per tahun.', 'fcf_cagr3'],
    ['eps_ttm', 'EPS 12 bln terakhir', '$', ''],
    ['eps_fwd', 'EPS Forward', '$', ''],
  ]],
  ['Kesehatan Keuangan', [
    ['piotroski', 'Piotroski F-Score', '/9', '9 tes kekuatan fundamental. 7–9 = sangat sehat.', 'piotroski'],
    ['altman', 'Altman Z-Score', 'n', '> 3 aman, 1.8–3 abu-abu, < 1.8 rawan tekanan keuangan.', 'altman'],
    ['de', 'Debt / Equity', 'x2', 'Total utang ÷ ekuitas.', 'de'],
    ['current_ratio', 'Current Ratio', 'x2', 'Aset lancar ÷ kewajiban lancar.', 'current_ratio'],
    ['netdebt_ebitda', 'Utang Bersih / EBITDA', 'x', 'Berapa tahun laba operasi untuk melunasi utang bersih. Negatif = kas bersih.', 'netdebt_ebitda'],
    ['int_cov', 'Interest Coverage', 'x', 'EBIT ÷ beban bunga.', 'int_cov'],
  ]],
  ['Pemegang Saham', [
    ['div_yield', 'Dividend Yield', '%', ''],
    ['payout', 'Payout Ratio', '%', 'Porsi laba yang dibagikan sebagai dividen.'],
    ['buyback_yield', 'Net Buyback Yield', '%', 'Pembelian kembali saham bersih ÷ kapitalisasi.'],
    ['sh_yield', 'Shareholder Yield', '%', 'Dividen + buyback bersih.', 'sh_yield'],
    ['insider', 'Kepemilikan Insider', '%', ''],
    ['inst', 'Kepemilikan Institusi', '%', ''],
    ['short_float', 'Short Interest', '%', 'Porsi saham beredar yang di-short.'],
  ]],
];
function fmtMetric(v, type) {
  if (v == null) return '–';
  switch (type) {
    case '%': return fmt.pct(v, 1, false);
    case 'pp': return (v > 0 ? '+' : '') + (v * 100).toFixed(1) + ' pp';
    case 'x': return fmt.x(v, 1);
    case 'x2': return fmt.x(v, 2);
    case '$': return fmt.usd(v);
    case '/9': return v + '/9';
    default: return fmt.num(v, 2);
  }
}

function renderDetail(el, sym) {
  const s = App.bySym[sym];
  if (!s) {
    el.innerHTML = `<div class="empty"><div class="big-ico">🤷</div>Saham <b>${esc(sym)}</b> tidak ada di universe screener.<br><a class="link" href="#/screener">Kembali ke screener</a></div>`;
    return;
  }
  const v = s.val, m = s.m, t = s.tech_d, p = s.plan;
  const up = v ? v.upside : null;
  const inWatch = App.watch.has(s.sym);
  const nextEarn = s.earnings_ts && s.earnings_ts * 1000 > Date.now() ? fmt.date(s.earnings_ts * 1000) : null;
  const confN = v ? { Tinggi: 3, Sedang: 2, Rendah: 1 }[v.confidence] : 0;

  // ---------- proyeksi
  let projHtml = '<div class="card card-pad">Nilai wajar tidak dapat dihitung (data tidak cukup).</div>';
  if (v) {
    const lo = Math.min(v.bear, s.price) * 0.97, hi = Math.max(v.bull, s.price) * 1.03;
    const pos = (x) => clamp(((x - lo) / (hi - lo)) * 100, 6, 94);
    projHtml = `<div class="card proj ${up < 0 ? 'neg' : ''}" style="order:1">
      <div class="proj-top">
        <div><div class="mk-label">Proyeksi kenaikan ~12 bulan</div>
          <div class="proj-big ${cls(up)}">${fmt.pct(up)}</div>
          <div class="proj-sub">Total return termasuk dividen: <b class="${cls(v.total_return)}">${fmt.pct(v.total_return)}</b></div></div>
        <div class="proj-target"><div class="mk-label">Nilai wajar</div><div class="v">${fmt.usd(v.fair)}</div>
          <div class="conf c${confN}" title="Tingkat keyakinan berdasarkan kesesuaian antar-metode & jumlah analis"><i><b></b></i> Keyakinan ${esc(v.confidence)}</div></div>
      </div>
      <div class="range">
        <div class="range-track"></div>
        <div class="range-mark fair" style="left:${pos(v.fair)}%"><span class="lbl">Wajar ${fmt.usd(v.fair, 0)}</span><span class="pin"></span></div>
        <div class="range-mark now" style="left:${pos(s.price)}%"><span class="pin"></span><span class="lbl">Harga ${fmt.usd(s.price, 0)}</span></div>
      </div>
      <div class="range-ends"><span>Bear <b>${fmt.usd(v.bear)}</b> <span class="${cls(v.bear_pct)}">${fmt.pct(v.bear_pct, 0)}</span></span>
        <span>Bull <b>${fmt.usd(v.bull)}</b> <span class="${cls(v.bull_pct)}">${fmt.pct(v.bull_pct, 0)}</span></span></div>
    </div>`;
  }

  // ---------- skor
  const pillarRows = [
    ['quality', 'Kualitas & Profit', 'Bobot 30%'], ['value', 'Valuasi', 'Bobot 28%'],
    ['growth', 'Pertumbuhan', 'Bobot 22%'], ['health', 'Kesehatan Keuangan', 'Bobot 20%'],
  ];
  const scoreHtml = `<div class="card card-pad" style="order:2">
    <h3 class="card-title"><span class="ico">🎯</span>Skor Analisis</h3>
    <div class="scores">${ring(s.score, true)}
      <div class="subscores">
        <div class="subscore"><div class="v" style="color:${scoreColor(s.fund)}">${Math.round(s.fund)}</div><div class="l">Fundamental</div><div class="w">70%</div></div>
        <div class="subscore"><div class="v" style="color:${scoreColor(s.tech)}">${Math.round(s.tech)}</div><div class="l">Teknikal</div><div class="w">20%</div></div>
        <div class="subscore"><div class="v" style="color:${scoreColor(s.analyst)}">${Math.round(s.analyst)}</div><div class="l">Analis</div><div class="w">10%</div></div>
      </div></div>
    <div class="bars">${pillarRows.map(([k, n, w]) => `<div class="bar-row"><span class="name">${n}<small>${w} dari fundamental</small></span>
      <div class="bar"><i style="width:${s.pillars[k]}%;background:${scoreColor(s.pillars[k])}"></i></div><span class="v">${Math.round(s.pillars[k])}</span></div>`).join('')}</div>
    <p class="small faint" style="margin:14px 0 0">Peringkat #${s.rank} dari ${App.data.count} saham. Skor 0–100: tiap metrik dibandingkan dengan emiten sesektor (persentil) dan ambang absolut.</p>
  </div>`;

  // ---------- alasan
  const prosHtml = `<div class="card card-pad" style="order:3">
    <h3 class="card-title"><span class="ico">✅</span>Kenapa Layak Dibeli</h3>
    <p class="thesis">${esc(s.thesis)}</p>
    <ul class="reasons pro" style="margin-top:14px">${s.pros.map((r, i) => `<li><span class="rk">${i + 1}</span><span class="t">${esc(r.text)}<br><small>${esc(r.tag)}</small></span></li>`).join('') || '<li class="muted" style="display:block">Tidak ada keunggulan menonjol.</li>'}</ul>
  </div>`;
  const consHtml = `<div class="card card-pad" style="order:4">
    <h3 class="card-title"><span class="ico">⚠️</span>Risiko yang Perlu Diwaspadai</h3>
    <ul class="reasons con">${s.cons.map((r) => `<li><span class="rk">!</span><span class="t">${esc(r.text)}<br><small>${esc(r.tag)}</small></span></li>`).join('') || '<li class="muted" style="display:block">Tidak ada risiko besar yang terdeteksi oleh model. Tetap perhatikan risiko pasar secara umum.</li>'}</ul>
  </div>`;

  // ---------- grafik
  const chartHtml = `<div class="card card-pad" style="order:5">
    <div class="section-head" style="margin-bottom:8px"><h3 class="card-title" style="margin:0"><span class="ico">📈</span>Grafik Harga</h3>
      <div class="seg-mini" id="rangeSel">${['3M', '6M', '1Y', '2Y'].map((r) => `<button data-r="${r}" class="${r === '1Y' ? 'on' : ''}">${r}</button>`).join('')}</div></div>
    <div class="chart-wrap" id="chart"><div class="splash" style="min-height:220px"><div class="spinner"></div></div></div>
    <div class="legend"><span><i style="background:var(--accent-2)"></i>Harga</span><span><i style="background:#f59e0b"></i>MA50</span><span><i style="background:#a855f7"></i>MA200</span>${v ? '<span><i style="background:var(--up)"></i>Nilai wajar</span>' : ''}</div>
  </div>`;

  // ---------- valuasi
  const meth = v ? v.methods : {};
  const mrow = (key, name, sub) => meth[key] == null ? '' : `<div class="method"><span class="n">${name}<small>${sub}</small></span>
    <span class="v">${fmt.usd(meth[key])}</span><span class="v ${cls(meth[key] / s.price - 1)}" style="min-width:62px">${fmt.pct(meth[key] / s.price - 1, 0)}</span></div>`;
  const valHtml = v ? `<div class="card card-pad" style="order:6">
    <h3 class="card-title"><span class="ico">🧮</span>Perhitungan Nilai Wajar</h3>
    ${mrow('dcf', s.sector_en === 'Financial Services' ? 'Model P/B–ROE' : 'DCF Free Cash Flow', s.sector_en === 'Financial Services' ? `ROE ${fmt.pct(m.roe, 0, false)}, biaya modal ${fmt.pct(v.discount, 1, false)} · bobot 35%` : `Tumbuh ${fmt.pct(v.growth_used, 0, false)}/thn (5 thn), diskonto ${fmt.pct(v.discount, 1, false)} · bobot 35%`)}
    ${mrow('multiple', 'Multiple P/E Wajar', `P/E wajar ${fmt.x(v.fair_pe)} vs median sektor ${fmt.x(v.sector_pe)} · bobot 30%`)}
    ${mrow('analyst', 'Target Analis', `${m.n_analysts} analis, rentang ${fmt.usd(m.target_low, 0)}–${fmt.usd(m.target_high, 0)} · bobot 35%`)}
    <div class="method" style="border-top:2px solid var(--border)"><span class="n" style="font-weight:800">Nilai wajar gabungan<small>Rata-rata tertimbang metode yang tersedia</small></span>
      <span class="v" style="font-size:16px">${fmt.usd(v.fair)}</span><span class="v ${cls(up)}" style="min-width:62px;font-size:16px">${fmt.pct(up, 0)}</span></div>
  </div>` : '';

  // ---------- trading plan
  const planHtml = `<div class="card card-pad" style="order:7">
    <h3 class="card-title"><span class="ico">🧭</span>Rencana Trading</h3>
    <div class="plan">
      <div class="entry"><div class="l">Zona beli</div><div class="v">${fmt.usd(p.entry_lo)} – ${fmt.usd(p.entry_hi, 2)}</div></div>
      <div class="stop"><div class="l">Stop loss</div><div class="v down">${fmt.usd(p.stop)}</div><div class="small faint">${fmt.pct(p.stop / s.price - 1)}</div></div>
      <div class="tp"><div class="l">Target 1 (wajar)</div><div class="v up">${fmt.usd(p.target)}</div></div>
      <div class="tp"><div class="l">Target 2 (bull)</div><div class="v up">${fmt.usd(p.target2)}</div></div>
    </div>
    <p class="small muted" style="margin:12px 0 0">Risk/Reward: <b class="mono">${p.rr == null ? '–' : '1 : ' + fmt.num(p.rr, 1)}</b>. Zona beli memakai ATR &amp; MA50; stop loss ≈ 2.5× ATR di bawah harga. Cocok untuk investor menengah (6–12 bulan) — investor jangka panjang bisa mengabaikan stop dan fokus pada fundamental.</p>
  </div>`;

  // ---------- teknikal
  const pr = s.price;
  const rangePos = t.high52 && t.low52 ? clamp(((pr - t.low52) / (t.high52 - t.low52)) * 100, 0, 100) : 50;
  const status = (ok, a, b) => `<span class="badge ${ok ? 'r-BUY' : 'r-HINDARI'}">${ok ? a : b}</span>`;
  const techHtml = `<div class="card card-pad" style="order:8">
    <h3 class="card-title"><span class="ico">📊</span>Analisis Teknikal</h3>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      ${t.sma200 ? status(pr > t.sma200, 'Di atas MA200', 'Di bawah MA200') : ''}
      ${t.sma50 && t.sma200 ? status(t.sma50 > t.sma200, 'Golden cross', 'Death cross') : ''}
      ${status((t.macd_hist || 0) > 0, 'MACD positif', 'MACD negatif')}
      ${t.rsi > 70 ? '<span class="badge r-HOLD">Overbought</span>' : t.rsi < 30 ? '<span class="badge r-HOLD">Oversold</span>' : ''}
    </div>
    <div class="kv k3">
      <div><div class="l">RSI (14)</div><div class="v">${fmt.num(t.rsi, 0)}</div><div class="s">${t.rsi > 70 ? 'Jenuh beli' : t.rsi < 30 ? 'Jenuh jual' : 'Netral'}</div></div>
      <div><div class="l">MA50</div><div class="v">${fmt.usd(t.sma50)}</div><div class="s ${cls(pr / t.sma50 - 1)}">${fmt.pct(pr / t.sma50 - 1)}</div></div>
      <div><div class="l">MA200</div><div class="v">${fmt.usd(t.sma200)}</div><div class="s ${cls(t.sma200 ? pr / t.sma200 - 1 : null)}">${t.sma200 ? fmt.pct(pr / t.sma200 - 1) : '–'}</div></div>
      <div><div class="l">vs S&amp;P 500 (6 bln)</div><div class="v ${cls(t.rs6m)}">${fmt.pct(t.rs6m)}</div></div>
      <div><div class="l">Support</div><div class="v">${fmt.usd(t.support)}</div></div>
      <div><div class="l">Resistance</div><div class="v">${fmt.usd(t.resistance)}</div></div>
    </div>
    <div style="margin-top:14px"><div class="flabel" style="font-weight:600"><span class="muted" style="color:var(--text-2);font-family:inherit">Rentang 52 minggu</span><span>${fmt.pct(t.dist_high)} dari puncak</span></div>
      <div style="position:relative;height:8px;border-radius:8px;background:var(--surface-2)"><div style="position:absolute;left:${rangePos}%;top:-4px;width:4px;height:16px;border-radius:3px;background:var(--text);transform:translateX(-50%)"></div></div>
      <div class="range-ends" style="margin-top:6px"><span>${fmt.usd(t.low52)}</span><span>${fmt.usd(t.high52)}</span></div></div>
    <div class="kv" style="grid-template-columns:repeat(4,1fr);margin-top:12px">
      ${['1m', '3m', '6m', '1y'].map((k) => `<div style="text-align:center"><div class="l">${k.replace('m', ' bln').replace('1y', '1 thn')}</div><div class="v ${cls(s.ret[k])}" style="font-size:14px">${fmt.pct(s.ret[k], 0)}</div></div>`).join('')}
    </div>
  </div>`;

  // ---------- metrik
  const metricsHtml = `<div class="card card-pad" style="order:9">
    <h3 class="card-title"><span class="ico">🔬</span>Metrik Fundamental</h3>
    <p class="small faint" style="margin:-6px 0 0">Bar = persentil vs emiten sesektor (makin penuh makin baik).</p>
    <table class="mtable">${METRICS.map(([g, rows]) => `<tr><th colspan="3">${g}</th></tr>` + rows.map(([k, label, type, help, pk]) => {
      const pc = pk && s.mp[pk] != null ? s.mp[pk] : null;
      return `<tr><td>${label}${help ? `<span class="help">${help}</span>` : ''}</td>
        <td class="val">${fmtMetric(m[k], type)}</td>
        <td class="pct">${pc == null ? '' : `<div class="pbar"><i style="width:${pc}%;background:${scoreColor(pc)}"></i></div><div class="pnum">P${pc}</div>`}</td></tr>`;
    }).join('')).join('')}</table>
  </div>`;

  // ---------- riwayat keuangan
  const histHtml = s.hist && s.hist.years.length ? `<div class="card card-pad" style="order:10">
    <h3 class="card-title"><span class="ico">🏦</span>Kinerja Keuangan Tahunan</h3>
    ${finChart(s.hist)}
    <div class="legend"><span><i style="background:var(--accent-2)"></i>Pendapatan</span><span><i style="background:var(--accent)"></i>Laba bersih</span><span><i style="background:#a855f7"></i>Free cash flow</span></div>
  </div>` : '';

  // ---------- piotroski
  const pioHtml = s.piotroski_checks ? `<div class="card card-pad" style="order:11">
    <h3 class="card-title"><span class="ico">🧪</span>Piotroski F-Score: ${m.piotroski}/9</h3>
    <ul class="checks">${s.piotroski_checks.map(([n, ok]) => `<li><span class="${ok ? 'ok' : 'no'}">${ok ? '✓' : '✕'}</span>${esc(n)}</li>`).join('')}</ul>
  </div>` : '';

  // ---------- profil
  const aboutHtml = `<div class="card card-pad" style="order:12">
    <h3 class="card-title"><span class="ico">🏢</span>Profil Perusahaan</h3>
    <div class="kv">
      <div><div class="l">Kapitalisasi</div><div class="v">${fmt.big(s.mcap)}</div></div>
      <div><div class="l">Beta</div><div class="v">${fmt.num(m.beta, 2)}</div></div>
      <div><div class="l">Kas</div><div class="v">${fmt.big(m.cash)}</div></div>
      <div><div class="l">Utang</div><div class="v">${fmt.big(m.debt)}</div></div>
    </div>
    ${nextEarn ? `<p class="small" style="margin:12px 0 0">📅 Laporan keuangan berikutnya: <b>${nextEarn}</b></p>` : ''}
    <p class="small muted" style="margin:12px 0 0;line-height:1.6">${esc(s.summary)}${s.summary.length >= 600 ? '…' : ''}</p>
    ${s.website ? `<a class="link" href="${esc(s.website)}" target="_blank" rel="noopener">${esc(s.website.replace(/^https?:\/\//, ''))} ↗</a>` : ''}
  </div>`;

  el.innerHTML = `<div class="fade-in">
    <button class="back" onclick="history.length > 1 ? history.back() : (location.hash = '#/')"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>Kembali</button>
    <div class="d-head">
      <div style="min-width:0"><div class="d-sym">${esc(s.sym)} ${ratingBadge(s.rating)}</div>
        <div class="d-name">${esc(s.name)}</div>
        <div class="d-tags"><span class="tag">${esc(s.sector)}</span><span class="tag">${esc(s.industry)}</span><span class="tag">${esc(s.cap)} cap</span></div></div>
      <div class="d-price"><div class="p">${fmt.usd(s.price)}</div><div class="${cls(s.chg1d)} mono" style="font-weight:700">${fmt.pct(s.chg1d, 2)}</div></div>
    </div>
    <div class="d-actions">
      <button class="btn star-btn ${inWatch ? 'on' : ''}" id="starBtn"><svg viewBox="0 0 24 24"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/></svg>${inWatch ? 'Di watchlist' : 'Watchlist'}</button>
      <button class="btn" id="shareBtn"><svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v13"/></svg>Bagikan</button>
    </div>
    <div class="detail-grid" style="margin-top:16px">
      <div class="dcol">${projHtml}${prosHtml}${consHtml}${chartHtml}${metricsHtml}${histHtml}</div>
      <div class="dcol">${scoreHtml}${valHtml}${planHtml}${techHtml}${pioHtml}${aboutHtml}</div>
    </div>
    <p class="disclaimer">Analisis otomatis berbasis data Yahoo Finance; bukan rekomendasi investasi personal. Proyeksi adalah estimasi model dan bisa meleset.</p>
  </div>`;

  $('#starBtn').onclick = () => {
    toggleWatch(s.sym);
    const on = App.watch.has(s.sym);
    $('#starBtn').classList.toggle('on', on);
    $('#starBtn').lastChild.textContent = on ? 'Di watchlist' : 'Watchlist';
  };
  $('#shareBtn').onclick = async () => {
    const text = `${s.sym} — ${s.rating}, skor ${Math.round(s.score)}/100, proyeksi ${fmt.pct(up)} ke ${fmt.usd(v?.fair)}`;
    try {
      if (navigator.share) await navigator.share({ title: `${s.sym} · Radar Saham US`, text, url: location.href });
      else { await navigator.clipboard.writeText(`${text}\n${location.href}`); toast('Tautan disalin'); }
    } catch (e) { /* dibatalkan */ }
  };

  let range = '1Y';
  const chartEl = $('#chart');
  const drawIt = () => loadHist(s.sym).then((h) => { if (document.body.contains(chartEl)) drawPriceChart(chartEl, h, range, v ? v.fair : null); })
    .catch(() => { chartEl.innerHTML = '<div class="empty small">Grafik tidak tersedia offline.</div>'; });
  drawIt();
  $('#rangeSel').onclick = (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    range = b.dataset.r;
    $$('#rangeSel button').forEach((x) => x.classList.toggle('on', x === b));
    drawIt();
  };
  const ro = new ResizeObserver(() => { if (App.histCache[s.sym] && document.body.contains(chartEl)) drawPriceChart(chartEl, App.histCache[s.sym], range, v ? v.fair : null); });
  ro.observe(chartEl);
  App._ro && App._ro.disconnect();
  App._ro = ro;
}

/* ------------------------------------------------------------ charts */
function sma(arr, n) {
  const out = new Array(arr.length).fill(null);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= n) sum -= arr[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}
function drawPriceChart(el, h, range, fair) {
  const W = Math.max(280, el.clientWidth), H = W < 500 ? 230 : 290, VH = 42, PADR = 54, PADT = 10;
  const n = { '3M': 63, '6M': 126, '1Y': 252, '2Y': 9999 }[range];
  const ma50 = sma(h.c, 50), ma200 = sma(h.c, 200);
  const start = Math.max(0, h.c.length - n);
  const C = h.c.slice(start), D = h.d.slice(start), V = h.v.slice(start), M50 = ma50.slice(start), M200 = ma200.slice(start);
  let lo = Math.min(...C), hi = Math.max(...C);
  [...M50, ...M200].forEach((x) => { if (x != null) { lo = Math.min(lo, x); hi = Math.max(hi, x); } });
  let fairIn = false;
  if (fair && fair < hi * 1.35 && fair > lo * 0.7) { lo = Math.min(lo, fair); hi = Math.max(hi, fair); fairIn = true; }
  const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const cw = W - PADR, ch = H - VH - PADT;
  const X = (i) => (i / (C.length - 1)) * cw;
  const Y = (v) => PADT + ch - ((v - lo) / (hi - lo)) * ch;
  const line = (arr) => { let d = ''; arr.forEach((v, i) => { if (v == null) return; d += (d ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }); return d; };
  const pd = line(C);
  const upTrend = C[C.length - 1] >= C[0];
  const ticks = 4, grid = [];
  const lastV = C[C.length - 1];
  for (let i = 0; i <= ticks; i++) { const v = lo + ((hi - lo) * i) / ticks; const clash = Math.abs(Y(v) - Y(lastV)) < 16 || (fair && fairIn && Math.abs(Y(v) - Y(fair)) < 16); grid.push(`<line x1="0" x2="${cw}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--chart-grid)"/>` + (clash ? '' : `<text x="${cw + 6}" y="${Y(v) + 4}" font-size="10.5" fill="var(--text-3)" font-family="JetBrains Mono, monospace">${v >= 1000 ? v.toFixed(0) : v.toFixed(v < 10 ? 2 : 1)}</text>`)); }
  const vmax = Math.max(...V) || 1;
  const bw = Math.max(1, cw / C.length - 0.6);
  const vols = V.map((v, i) => `<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${(H - (v / vmax) * (VH - 6)).toFixed(1)}" width="${bw.toFixed(1)}" height="${((v / vmax) * (VH - 6)).toFixed(1)}" fill="${i && C[i] < C[i - 1] ? 'var(--down)' : 'var(--up)'}" opacity=".35"/>`).join('');
  const months = [];
  let lastM = '';
  D.forEach((d, i) => { const mk = d.slice(0, 7); if (mk !== lastM) { lastM = mk; months.push(i); } });
  const step = Math.ceil(months.length / (W < 500 ? 4 : 7));
  const xl = months.filter((_, i) => i % step === 0 && i > 0).map((i) => `<text x="${X(i)}" y="${H - VH + 12}" font-size="10" fill="var(--text-3)" text-anchor="middle">${fmt.date(D[i], { month: 'short', year: '2-digit' })}</text>`).join('');
  const fairLine = fair ? (fairIn
    ? `<line x1="0" x2="${cw}" y1="${Y(fair)}" y2="${Y(fair)}" stroke="var(--up)" stroke-dasharray="5 4" stroke-width="1.5"/><rect x="${cw + 2}" y="${Y(fair) - 9}" width="${PADR - 2}" height="18" rx="5" fill="var(--up)"/><text x="${cw + 6}" y="${Y(fair) + 4}" font-size="10.5" fill="#fff" font-weight="700" font-family="JetBrains Mono, monospace">${fair.toFixed(0)}</text>`
    : `<text x="${cw - 4}" y="${PADT + 12}" font-size="11" fill="var(--up)" text-anchor="end" font-weight="700">Nilai wajar ${fmt.usd(fair, 0)} ${fair > hi ? '↑' : '↓'}</text>`) : '';
  const last = C[C.length - 1];
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Grafik harga">
    <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent-2)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent-2)" stop-opacity="0"/></linearGradient></defs>
    ${grid.join('')}${vols}${xl}
    <path d="${pd}L${cw} ${PADT + ch}L0 ${PADT + ch}Z" fill="url(#pg)"/>
    <path d="${line(M200)}" fill="none" stroke="#a855f7" stroke-width="1.4" opacity=".9"/>
    <path d="${line(M50)}" fill="none" stroke="#f59e0b" stroke-width="1.4" opacity=".9"/>
    <path d="${pd}" fill="none" stroke="var(--accent-2)" stroke-width="2" stroke-linejoin="round"/>
    ${fairLine}
    <rect x="${cw + 2}" y="${Y(last) - 9}" width="${PADR - 2}" height="18" rx="5" fill="${upTrend ? 'var(--accent-2)' : 'var(--down)'}"/>
    <text x="${cw + 6}" y="${Y(last) + 4}" font-size="10.5" fill="#fff" font-weight="700" font-family="JetBrains Mono, monospace">${last >= 1000 ? last.toFixed(0) : last.toFixed(1)}</text>
    <g id="xh" style="display:none"><line id="xhl" y1="${PADT}" y2="${H}" stroke="var(--text-3)" stroke-dasharray="3 3"/><circle id="xhc" r="4.5" fill="var(--accent-2)" stroke="var(--surface)" stroke-width="2"/></g>
  </svg><div class="chart-tip hidden" id="ctip"></div>`;
  const svg = el.querySelector('svg'), xh = el.querySelector('#xh'), tip = el.querySelector('#ctip');
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const i = clamp(Math.round((x / cw) * (C.length - 1)), 0, C.length - 1);
    const px = X(i), py = Y(C[i]);
    xh.style.display = '';
    el.querySelector('#xhl').setAttribute('x1', px); el.querySelector('#xhl').setAttribute('x2', px);
    el.querySelector('#xhc').setAttribute('cx', px); el.querySelector('#xhc').setAttribute('cy', py);
    tip.classList.remove('hidden');
    const chg = C[i] / C[0] - 1;
    tip.innerHTML = `${fmt.date(D[i])} · $${C[i].toFixed(2)} <span style="opacity:.75">${fmt.pct(chg)}</span>`;
    tip.style.left = clamp((px / W) * r.width, 80, r.width - 80) + 'px';
    tip.style.top = '-30px';
  };
  const leave = () => { xh.style.display = 'none'; tip.classList.add('hidden'); };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', leave);
}

function finChart(h) {
  const W = 520, H = 190, PT = 14, PB = 24;
  const series = [['revenue', 'var(--accent-2)'], ['net_income', 'var(--accent)'], ['fcf', '#a855f7']];
  const vals = series.flatMap(([k]) => h[k].filter((x) => x != null));
  if (!vals.length) return '';
  const max = Math.max(0, ...vals), min = Math.min(0, ...vals);
  const Y = (v) => PT + ((max - v) / (max - min || 1)) * (H - PT - PB);
  const n = h.years.length, gw = W / n, bw = Math.min(30, (gw - 20) / 3);
  let bars = '';
  h.years.forEach((yr, i) => {
    const cx = gw * i + gw / 2;
    series.forEach(([k, col], j) => {
      const v = h[k][i];
      if (v == null) return;
      const x = cx + (j - 1) * (bw + 4) - bw / 2;
      const y0 = Y(0), y1 = Y(v);
      bars += `<rect x="${x}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.max(1, Math.abs(y1 - y0))}" rx="3" fill="${col}"><title>${yr} · ${fmt.big(v)}</title></rect>`;
      if (j === 0) bars += `<text x="${cx}" y="${Math.min(y0, y1) - 4}" font-size="10" text-anchor="middle" fill="var(--text-2)" font-family="JetBrains Mono, monospace">${fmt.big(v).replace('$', '')}</text>`;
    });
    bars += `<text x="${cx}" y="${H - 6}" font-size="11.5" text-anchor="middle" fill="var(--text-2)" font-weight="600">${yr}</text>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto" role="img" aria-label="Kinerja keuangan">
    <line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--border)"/>${bars}</svg>`;
}

/* ------------------------------------------------------------ WATCHLIST */
function toggleWatch(sym) {
  if (App.watch.has(sym)) { App.watch.delete(sym); toast(`${sym} dihapus dari watchlist`); }
  else { App.watch.add(sym); toast(`${sym} ditambahkan ke watchlist ★`); }
  store.set('watchlist', [...App.watch]);
}
function renderWatchlist(el) {
  const list = [...App.watch].map((s) => App.bySym[s]).filter(Boolean).sort((a, b) => b.score - a.score);
  const ups = list.filter((s) => s.val).map((s) => s.val.upside);
  const avg = ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : null;
  el.innerHTML = `<div class="fade-in">
    <h1 class="page-title">Watchlist</h1>
    <p class="page-sub">Saham pantauan Anda — tersimpan di perangkat ini.</p>
    ${list.length ? `<div class="mk-stats" style="margin-bottom:14px">
      <div class="card stat"><div class="v">${list.length}</div><div class="l">Saham</div></div>
      <div class="card stat"><div class="v" style="color:${scoreColor(list.reduce((a, s) => a + s.score, 0) / list.length)}">${Math.round(list.reduce((a, s) => a + s.score, 0) / list.length)}</div><div class="l">Rata-rata skor</div></div>
      <div class="card stat"><div class="v ${cls(avg)}">${fmt.pct(avg, 0)}</div><div class="l">Rata-rata upside</div></div>
    </div><div class="card list">${list.map(stockRow).join('')}</div>`
    : `<div class="card empty"><div class="big-ico">⭐</div><b>Watchlist masih kosong</b><p class="small">Buka detail saham lalu ketuk tombol <b>Watchlist</b> untuk menyimpannya di sini.</p><a class="btn primary" href="#/screener?p=strong" style="margin-top:6px">Lihat Strong Buy</a></div>`}
  </div>`;
}

/* ------------------------------------------------------------ METODOLOGI */
function renderMethod(el) {
  el.innerHTML = `<div class="fade-in prose">
    <h1 class="page-title">Metodologi</h1>
    <p class="page-sub">Bagaimana skor, rekomendasi, dan proyeksi kenaikan dihitung.</p>
    <div class="card"><table class="wtable">
      <tr><td><b>Fundamental</b> — kualitas, valuasi, pertumbuhan, kesehatan</td><td>70%</td></tr>
      <tr><td><b>Teknikal</b> — tren, momentum, RSI, MACD, kekuatan relatif</td><td>20%</td></tr>
      <tr><td><b>Konsensus analis</b> — rekomendasi &amp; target harga</td><td>10%</td></tr>
    </table></div>

    <h2>1. Skor Fundamental (70%)</h2>
    <p>Setiap metrik diberi nilai 0–100 dengan menggabungkan dua sudut pandang: <b>persentil terhadap emiten sesektor</b> (50%) — supaya bank tidak dibandingkan dengan perusahaan software — dan <b>ambang absolut</b> (50%) — supaya saham "terbaik di sektor yang jelek" tidak otomatis dapat nilai tinggi.</p>
    <div class="card"><table class="wtable">
      <tr><td><b>Kualitas &amp; Profitabilitas</b><br><span class="small">ROIC, ROE, ROA, gross/operating/FCF margin, tren margin, shareholder yield</span></td><td>30%</td></tr>
      <tr><td><b>Valuasi</b><br><span class="small">Earnings yield forward (1/PE), PEG, EBITDA/EV, FCF yield, P/S, P/B</span></td><td>28%</td></tr>
      <tr><td><b>Pertumbuhan</b><br><span class="small">Pendapatan YoY &amp; CAGR 3 thn, proyeksi EPS, laba YoY, FCF CAGR</span></td><td>22%</td></tr>
      <tr><td><b>Kesehatan Keuangan</b><br><span class="small">Piotroski F-Score, Altman Z, D/E, current ratio, utang bersih/EBITDA, interest coverage</span></td><td>20%</td></tr>
    </table></div>
    <p>Sektor keuangan (bank, asuransi) memakai bobot khusus: ROE, P/B, dan Piotroski lebih berat; metrik yang tidak relevan untuk bank (EV/EBITDA, D/E, FCF) diabaikan.</p>

    <h2>2. Skor Teknikal (20%)</h2>
    <p>Tren (harga vs MA50/MA200, golden cross, arah MA200) 35 poin · momentum 12-1 bulan &amp; kekuatan relatif vs S&amp;P 500 30 poin · RSI 15 poin (ideal 40–65) · MACD 10 poin · jarak dari puncak 52 minggu 10 poin.</p>

    <h2>3. Proyeksi Kenaikan (Nilai Wajar)</h2>
    <p>Nilai wajar adalah rata-rata tertimbang tiga metode independen:</p>
    <ul>
      <li><b>DCF Free Cash Flow (35%)</b> — FCF dari laporan arus kas diproyeksikan 10 tahun (5 tahun tumbuh sesuai gabungan proyeksi EPS, CAGR pendapatan &amp; FCF — dibatasi maks. 22%; lalu melambat ke 3%), didiskonto dengan CAPM (4.3% + beta × 5%, rentang 7.5–12%). Untuk bank: model P/B–ROE.</li>
      <li><b>Multiple P/E wajar (30%)</b> — median P/E forward sektor, disesuaikan ±25% menurut skor kualitas &amp; pertumbuhan, dikalikan EPS 12 bulan ke depan.</li>
      <li><b>Target analis (35%)</b> — rata-rata target harga Wall Street (min. 3 analis).</li>
    </ul>
    <p>Setiap metode dibatasi -60% s.d. +100% dari harga untuk meredam outlier. Skenario <b>bear</b> dan <b>bull</b> berasal dari estimasi terendah/tertinggi dan rentang target analis. <b>Keyakinan</b> tinggi bila ketiga metode saling berdekatan dan diliput banyak analis.</p>

    <h2>4. Rekomendasi</h2>
    <div class="card"><table class="wtable">
      <tr><td>${ratingBadge('STRONG BUY')} skor ≥ 70, fundamental ≥ 65, upside ≥ 12%</td><td></td></tr>
      <tr><td>${ratingBadge('BUY')} skor ≥ 60, fundamental ≥ 55, upside ≥ 5%</td><td></td></tr>
      <tr><td>${ratingBadge('HOLD')} skor ≥ 45 &amp; upside ≥ -10%, atau fundamental ≥ 62 &amp; upside ≥ -25%</td><td></td></tr>
      <tr><td>${ratingBadge('HINDARI')} selain di atas</td><td></td></tr>
    </table></div>

    <h2>5. Data</h2>
    <p>Harga, rasio, dan laporan keuangan tahunan dari Yahoo Finance; universe = seluruh konstituen S&amp;P 500 ditambah saham growth populer. Data diperbarui otomatis setiap hari bursa setelah pasar tutup (bila di-deploy dengan GitHub Actions).</p>

    <p class="disclaimer"><b>Penafian:</b> Aplikasi ini adalah alat bantu riset, bukan nasihat investasi. Model kuantitatif memiliki keterbatasan — misalnya laba siklikal di puncak siklus bisa membuat saham tampak murah, dan data pihak ketiga bisa keliru atau terlambat. Kinerja masa lalu tidak menjamin hasil di masa depan. Selalu lakukan riset mandiri.</p>
  </div>`;
}

/* ------------------------------------------------------------ search */
function openSearch() {
  $('#searchOverlay').classList.remove('hidden');
  const inp = $('#searchInput');
  inp.value = '';
  drawSearch('');
  setTimeout(() => inp.focus(), 30);
}
function closeSearch() { $('#searchOverlay').classList.add('hidden'); }
function drawSearch(q) {
  q = q.trim().toLowerCase();
  let res;
  if (!q) res = App.data.stocks.slice(0, 12);
  else {
    res = App.data.stocks.filter((s) => s.sym.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      .sort((a, b) => (b.sym.toLowerCase() === q) - (a.sym.toLowerCase() === q) || (b.sym.toLowerCase().startsWith(q)) - (a.sym.toLowerCase().startsWith(q)) || b.score - a.score)
      .slice(0, 30);
  }
  $('#searchResults').innerHTML = (q ? '' : '<div class="small faint" style="padding:10px 14px 0">Peringkat teratas</div>') +
    (res.map(stockRow).join('') || '<div class="empty small">Tidak ditemukan.</div>');
}

/* ------------------------------------------------------------ install / tema */
let deferredPrompt = null;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('#btnInstall').classList.remove('hidden'); });
window.addEventListener('appinstalled', () => { $('#btnInstall').classList.add('hidden'); toast('Aplikasi terpasang 🎉'); });
if (isIOS && !isStandalone) $('#btnInstall').classList.remove('hidden');

function installHelp() {
  openSheet(`<div class="sheet-handle"></div><h3>Pasang di Layar Utama</h3>
    <p class="small muted">Buka seperti aplikasi — layar penuh, ikon di home screen, dan tetap bisa dibuka saat offline.</p>
    ${isIOS ? `<ol class="prose" style="padding-left:20px"><li>Ketuk tombol <b>Bagikan</b> (kotak dengan panah ke atas) di Safari.</li><li>Gulir dan pilih <b>Tambahkan ke Layar Utama</b>.</li><li>Ketuk <b>Tambah</b>.</li></ol>`
    : `<ol class="prose" style="padding-left:20px"><li>Buka menu <b>⋮</b> di Chrome.</li><li>Pilih <b>Instal aplikasi</b> atau <b>Tambahkan ke layar utama</b>.</li><li>Konfirmasi <b>Instal</b>.</li></ol>`}
    <div class="sheet-actions"><button class="btn primary" data-close>Mengerti</button></div>`);
}
$('#btnInstall').onclick = async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('#btnInstall').classList.add('hidden');
  } else installHelp();
};
$('#btnTheme').onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  store.set('theme', next);
  try { localStorage.setItem('theme', next); } catch (e) { /* */ }
};

/* ------------------------------------------------------------ boot */
$('#btnSearch').onclick = openSearch;
$('#searchClose').onclick = closeSearch;
$('#searchOverlay').onclick = (e) => { if (e.target.id === 'searchOverlay' || e.target.closest('a.row')) closeSearch(); };
$('#searchInput').oninput = (e) => drawSearch(e.target.value);
$('#sheet').onclick = (e) => { if (e.target.closest('[data-close]')) closeSheet(); };
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeSearch(); closeSheet(); }
  if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); }
});
window.addEventListener('hashchange', render);

(async function boot() {
  try {
    await loadData();
    render();
  } catch (e) {
    $('#app').innerHTML = `<div class="empty"><div class="big-ico">📡</div><b>Gagal memuat data</b><p class="small">${esc(e.message)}</p>
      <p class="small">Pastikan file <code>data/stocks.json</code> sudah dibuat dengan menjalankan <code>python scripts/screener.py</code>.</p>
      <button class="btn primary" onclick="location.reload()">Coba lagi</button></div>`;
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
