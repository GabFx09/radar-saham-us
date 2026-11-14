/* =====================================================================
   Radar Saham US — kerangka TERMINAL
   Command line (perintah + ticker), ticker tape, jam bursa New York,
   baris function key, tab pasar, dan pintasan keyboard.
   ===================================================================== */
'use strict';

const CMDS = [
  { k: 'BERANDA', h: '#/', d: 'Ringkasan pasar & pilihan teratas', n: '1', a: ['HOME', 'HOM'] },
  { k: 'SCREENER', h: '#/screener', d: 'Saring 530+ saham · SCR STRONG / SCR GARP …', n: '2', a: ['SCR', 'EQS', 'SCREEN'] },
  { k: 'MAKRO', h: '#/makro', d: 'Fear & Greed, kurva yield, rotasi sektor, lintas aset', n: '3', a: ['MACRO', 'PASAR', 'ECO', 'MKT', 'WEI'] },
  { k: 'HEATMAP', h: '#/heatmap', d: 'Peta panas seluruh pasar', n: '4', a: ['HEAT', 'MAP', 'IMAP', 'MOV'] },
  { k: 'SIKLUS', h: '#/siklus', d: 'Siklus pasar 100 tahun', n: '5', a: ['CYC', 'CYCLE', 'SEAS'] },
  { k: 'GEO', h: '#/geo', d: 'Analisis geopolitik', n: '6', a: ['GEOPOLITIK', 'RISK'] },
  { k: 'PESAN', h: '#/pesan', d: 'Kotak masuk & Radar Bot (alert, berita penting, tanya saham)', n: '9', a: ['CHAT', 'MSG', 'INBOX', 'BOT', 'NOTIF'] },
  { k: 'STRATEGI', h: '#/strategi', d: 'Model portofolio, rekam jejak, kalender laba', n: '7', a: ['STRAT', 'PRT', 'EVTS', 'MODEL'] },
  { k: 'WATCHLIST', h: '#/watchlist', d: 'Saham pantauan Anda', n: '8', a: ['WL', 'WATCH', 'MON'] },
  { k: 'METODE', h: '#/metode', d: 'Metodologi & sumber data', n: '', a: ['DOCS', 'METODOLOGI'] },
  { k: 'PORTOFOLIO', h: '#/portofolio', d: 'Saham milik Anda: untung/rugi, risiko, alokasi', n: '', a: ['PORT', 'PF', 'HOLD', 'MILIK'] },
  { k: 'BERITA', h: '#/berita', d: 'Berita penting 48 jam (akuisisi, investigasi, The Fed…)', n: '', a: ['NEWS', 'N', 'CN', 'TOP'] },
  { k: 'IPO', h: '#/ipo', d: 'Jadwal IPO, IPO terbaru, lock-up', n: '', a: ['IPOS', 'LISTING'] },
  { k: 'SETELAN', h: '#/pengaturan', d: 'Sinkronisasi cloud, Telegram & alert harga', n: '0', a: ['SET', 'PENGATURAN', 'ALERT', 'ALRT', 'SYNC'] },
  { k: 'CMP', h: '#/bandingkan', d: 'Bandingkan saham · CMP NVDA AMD AVGO', n: '', a: ['BANDINGKAN', 'COMP', 'RV'] },
  { k: 'TEMA', h: 'theme', d: 'Ganti tema terminal gelap / kertas', n: '', a: ['THEME'] },
  { k: 'HELP', h: 'help', d: 'Daftar perintah', n: '', a: ['?', 'BANTUAN'] },
];
const MARKET_VIEWS = ['makro', 'heatmap', 'berita', 'ipo', 'siklus', 'geo', 'strategi', 'bandingkan'];

function findCmd(word) {
  const w = word.toUpperCase();
  return CMDS.find((c) => c.k === w || c.a.includes(w));
}

function navActive(a, view) {
  const nav = a.dataset.nav;
  if (view === 's') return false;
  if (nav === view) return true;
  if (nav === 'watchlist' && view === 'portofolio') return true;
  if (a.closest('.bottomnav')) {
    if (nav === 'makro' && MARKET_VIEWS.includes(view)) return true;
    if (nav === 'strategi' && view === 'bandingkan') return true;
  }
  if (nav === 'strategi' && view === 'bandingkan') return true;
  return false;
}

function termAfterRender(view) {
  const sub = $('#subnav');
  if (!sub) return;
  sub.innerHTML = MARKET_VIEWS.includes(view) ? `<nav class="mtabs" aria-label="Analisis pasar">${[
    ['makro', 'Makro'], ['heatmap', 'Heatmap'], ['berita', 'Berita'], ['ipo', 'IPO'], ['siklus', 'Siklus 100 thn'], ['geo', 'Geopolitik'], ['strategi', 'Strategi'], ['bandingkan', 'Bandingkan']]
    .map(([k, n]) => `<a href="#/${k}" class="${k === view ? 'on' : ''}">${n}</a>`).join('')}</nav>` : '';
}

/* ------------------------------------------------------------ command palette */
let cmdSel = 0;
function drawSearch(q) {
  const raw = q.trim();
  const up = raw.toUpperCase();
  const first = up.split(/\s+/)[0] || '';
  const cmds = !raw ? CMDS : CMDS.filter((c) => c.k.startsWith(first) || c.a.some((x) => x.startsWith(first)));
  let stocks;
  if (!raw) stocks = App.data.stocks.slice(0, 8);
  else {
    const ql = first.toLowerCase();
    stocks = App.data.stocks.filter((s) => s.sym.toLowerCase().startsWith(ql) || s.name.toLowerCase().includes(raw.toLowerCase()))
      .sort((a, b) => (b.sym === first) - (a.sym === first) || b.sym.toLowerCase().startsWith(ql) - a.sym.toLowerCase().startsWith(ql) || b.score - a.score)
      .slice(0, 12);
  }
  const exact = App.bySym[first];
  const items = [];
  if (exact) items.push({ type: 's', sym: exact.sym });
  cmds.slice(0, raw ? 5 : 12).forEach((c) => items.push({ type: 'c', c }));
  stocks.filter((s) => !exact || s.sym !== exact.sym).forEach((s) => items.push({ type: 's', sym: s.sym }));
  App._cmdItems = items;
  cmdSel = 0;
  const cmdHtml = items.filter((x) => x.type === 'c').map((x) => `<div class="cmd-row" data-cmd="${x.c.k}"><b>${x.c.k}</b><span class="muted">${esc(x.c.d)}</span><kbd>${x.c.n ? x.c.n : ''}</kbd></div>`).join('');
  const stockHtml = items.filter((x) => x.type === 's').map((x) => stockRow(App.bySym[x.sym])).join('');
  $('#searchResults').innerHTML =
    (exact ? `<div class="cmd-head">Ticker · Enter untuk membuka</div>${stockRow(exact)}` : '') +
    (cmdHtml ? `<div class="cmd-head">Perintah</div>${cmdHtml}` : '') +
    (stockHtml && stockHtml !== (exact ? stockRow(exact) : '') ? `<div class="cmd-head">${raw ? 'Saham' : 'Peringkat teratas'}</div>${items.filter((x) => x.type === 's' && (!exact || x.sym !== exact.sym)).map((x) => stockRow(App.bySym[x.sym])).join('')}` : '') ||
    '<div class="empty small">Tidak ditemukan. Ketik HELP untuk daftar perintah.</div>';
}

function runCommand(raw) {
  const parts = raw.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!parts.length) return;
  const [w, ...args] = parts;
  const go = (h) => { closeSearch(); location.hash = h; };
  const c = findCmd(w);
  if (c) {
    if (c.k === 'TEMA') { closeSearch(); $('#btnTheme').click(); return; }
    if (c.k === 'HELP') { closeSearch(); showHelp(); return; }
    if (c.k === 'CMP') {
      const syms = args.filter((x) => App.bySym[x]);
      return go(syms.length ? '#/bandingkan?s=' + syms.join(',') : '#/bandingkan');
    }
    if (c.k === 'SCREENER' && args.length) {
      const p = PRESETS.find((x) => x.id.toUpperCase() === args[0] || x.id.toUpperCase().startsWith(args[0]));
      if (p) return go('#/screener?p=' + p.id);
    }
    return go(c.h);
  }
  if (App.bySym[w]) return go('#/s/' + encodeURIComponent(w));
  const first = (App._cmdItems || []).find((x) => x.type === 's');
  if (first) return go('#/s/' + encodeURIComponent(first.sym));
  toast(`Perintah "${w}" tidak dikenal — ketik HELP`);
}

function showHelp() {
  openSheet(`<div class="sheet-handle"></div><h3 style="text-transform:uppercase;letter-spacing:.06em;color:var(--accent)">Daftar Perintah</h3>
    <p class="small muted">Tekan <b>/</b> atau ketuk baris perintah di atas, ketik lalu Enter. Angka 1–9 = pindah halaman cepat.</p>
    <table class="hold-table">${CMDS.map((c) => `<tr><td><b style="color:var(--accent)">${c.k}</b>${c.n ? ` <span class="faint">[${c.n}]</span>` : ''}<div class="faint small">${c.a.slice(0, 3).join(' · ')}</div></td><td class="small">${esc(c.d)}</td></tr>`).join('')}
      <tr><td><b style="color:var(--accent)">&lt;TICKER&gt;</b></td><td class="small">Buka analisis saham, mis. <b>NVDA</b></td></tr>
      <tr><td><b style="color:var(--accent)">SCR &lt;PRESET&gt;</b></td><td class="small">${PRESETS.map((p) => p.id.toUpperCase()).join(' · ')}</td></tr></table>
    <div class="sheet-actions"><button class="btn primary" data-close>Tutup</button></div>`);
}

/* ------------------------------------------------------------ jam bursa */
function nyParts(d) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { wd: p.weekday, h: Number(p.hour) % 24, m: Number(p.minute), txt: `${p.hour}:${p.minute}` };
}
function tickClock() {
  const el = $('#clock');
  if (!el) return;
  const d = new Date();
  const ny = nyParts(d);
  const mins = ny.h * 60 + ny.m;
  const wk = !['Sat', 'Sun'].includes(ny.wd);
  let st = 'TUTUP', cl = 'closed';
  if (wk && mins >= 570 && mins < 960) { st = 'BURSA BUKA'; cl = 'open'; }
  else if (wk && mins >= 240 && mins < 570) { st = 'PRA-PASAR'; cl = 'pre'; }
  else if (wk && mins >= 960 && mins < 1200) { st = 'PASCA-PASAR'; cl = 'pre'; }
  const wib = d.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });
  const live = typeof liveLabel === 'function' && App.live ? ` <span class="faint" style="font-size:10.5px">${liveLabel()}</span>` : '';
  el.innerHTML = `NY <b>${ny.txt}</b> · WIB <b>${wib.replace('.', ':')}</b><br><span class="st ${cl}">● ${st}</span>${live}`;
}

/* ------------------------------------------------------------ ticker tape */
function buildTape() {
  const el = $('#tape');
  if (!el || !App.data) return;
  const items = [];
  const mk = App.makro;
  const pick = ['SPY', 'QQQ', 'DIA', 'IWM', '^VIX', '^TNX', 'CL=F', 'GC=F', 'DX-Y.NYB', 'IDR=X', 'BTC-USD'];
  const short = { SPY: 'S&P500', QQQ: 'NDX100', DIA: 'DOW', IWM: 'R2000', '^VIX': 'VIX', '^TNX': 'UST10Y', 'CL=F': 'WTI', 'GC=F': 'EMAS', 'DX-Y.NYB': 'DXY', 'IDR=X': 'USDIDR', 'BTC-USD': 'BTC' };
  if (mk && mk.assets) {
    const rows = Object.fromEntries(mk.assets.flatMap((g) => g.rows).map((r) => [r.sym, r]));
    pick.forEach((s) => {
      const r = rows[s];
      if (!r) return;
      const ch = r.d1;
      const chTxt = r.rate ? `${ch >= 0 ? '+' : ''}${Math.round(ch * 100)}bp` : fmt.pct(ch, 2);
      const val = r.rate ? r.last.toFixed(3) + '%' : r.last >= 1000 ? Math.round(r.last).toLocaleString('en-US') : r.last.toFixed(2);
      items.push(`<a href="#/makro"><b>${short[s]}</b><span class="v">${val}</span><span class="${cls(ch)}">${chTxt}</span></a>`);
    });
    if (mk.fg) items.push(`<a href="#/makro"><b>FEAR&amp;GREED</b><span class="v">${Math.round(mk.fg.now)}</span><span>${esc(mk.fg.label.toUpperCase())}</span></a>`);
  } else if (App.data.market) {
    const m = App.data.market;
    items.push(`<a href="#/"><b>S&amp;P500</b><span class="v">${fmt.usd(m.spy)}</span><span class="${cls(m.chg1d)}">${fmt.pct(m.chg1d, 2)}</span></a>`);
  }
  const movers = [...App.data.stocks].filter((s) => s.chg1d != null).sort((a, b) => Math.abs(b.chg1d) - Math.abs(a.chg1d)).slice(0, 14);
  movers.forEach((s) => items.push(`<a href="#/s/${encodeURIComponent(s.sym)}"><b>${esc(s.sym)}</b><span class="v">${fmt.num(s.price, 2)}</span><span class="${cls(s.chg1d)}">${fmt.pct(s.chg1d, 2)}</span></a>`));
  const html = items.join('');
  el.innerHTML = html + html;
}

/* ------------------------------------------------------------ data makro (dimuat di latar) */
App.makro = null;
async function loadMakro() {
  if (App.makro) return App.makro;
  const res = await fetch('data/makro.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  App.makro = await res.json();
  return App.makro;
}

/* ------------------------------------------------------------ boot */
(function termBoot() {
  $('#cmdBtn').onclick = openSearch;
  const inp = $('#searchInput');
  inp.setAttribute('placeholder', 'Ticker atau perintah (HELP) …');
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runCommand(inp.value); }
  });
  $('#searchResults').addEventListener('click', (e) => {
    const r = e.target.closest('[data-cmd]');
    if (r) runCommand(r.dataset.cmd);
  });
  document.addEventListener('keydown', (e) => {
    if (/input|textarea|select/i.test(document.activeElement.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!$('#searchOverlay').classList.contains('hidden') || !$('#sheet').classList.contains('hidden')) return;
    const c = CMDS.find((x) => x.n === e.key);
    if (c) { e.preventDefault(); location.hash = c.h; }
    else if (e.key === '?') { e.preventDefault(); showHelp(); }
  });
  tickClock();
  setInterval(tickClock, 20000);
  const wait = setInterval(() => {
    if (!App.data) return;
    clearInterval(wait);
    buildTape();
    loadMakro().then(() => {
      buildTape();
      const v = parseHash().parts[0] || 'home';
      if (v === 'home') render();
    }).catch(() => {});
  }, 200);
})();
