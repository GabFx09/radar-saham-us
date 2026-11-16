/* =====================================================================
   Radar Saham US — screener rumus sendiri
   Rumus ditulis dalam satuan manusia (persen = angka persen), contoh:
     pe < 15 dan roe > 20 dan potensi > 25
   Diurai dengan parser sendiri (tanpa eval) agar aman.
   ===================================================================== */
'use strict';

const pctv = (x) => (x == null || !isFinite(x) ? null : x * 100);
const RUMUS_VARS = [
  ['Skor', [
    ['skor', 'Skor gabungan 0–100', (s) => s.score],
    ['fund', 'Skor fundamental 0–100', (s) => s.fund],
    ['tek', 'Skor teknikal 0–100', (s) => s.tech],
    ['analis', 'Skor analis 0–100', (s) => s.analyst],
    ['kualitas', 'Pilar kualitas 0–100', (s) => s.pillars && s.pillars.quality],
    ['tumbuh', 'Pilar pertumbuhan 0–100', (s) => s.pillars && s.pillars.growth],
    ['murah', 'Pilar valuasi 0–100 (tinggi = murah)', (s) => s.pillars && s.pillars.value],
    ['sehat', 'Pilar kesehatan keuangan 0–100', (s) => s.pillars && s.pillars.health],
    ['geo', 'Ketahanan geopolitik 0–100', (s) => s.geo && s.geo.score],
    ['aliran', 'Aliran dana 0–100 (tinggi = uang masuk)', (s) => s.flow],
    ['revisi', 'Revisi estimasi analis 0–100', (s) => s.rev],
    ['momentum', 'Persentil faktor momentum', (s) => s.factors && s.factors.momentum],
  ]],
  ['Valuasi', [
    ['harga', 'Harga ($)', (s) => s.price],
    ['potensi', 'Potensi ke nilai wajar (%)', (s) => s.val && pctv(s.val.upside)],
    ['pe', 'P/E forward (x)', (s) => s.m.pe_fwd],
    ['peg', 'PEG ratio', (s) => s.m.peg],
    ['fcf', 'Free cash flow yield (%)', (s) => pctv(s.m.fcf_yield)],
    ['kap', 'Kapitalisasi pasar (miliar $)', (s) => (s.mcap ? s.mcap / 1e9 : null)],
  ]],
  ['Bisnis', [
    ['roe', 'ROE (%)', (s) => pctv(s.m.roe)],
    ['roic', 'ROIC (%)', (s) => pctv(s.m.roic)],
    ['margin', 'Margin operasi (%)', (s) => pctv(s.m.op_margin)],
    ['pendapatan', 'Pertumbuhan pendapatan kuartal YoY (%)', (s) => pctv(s.m.rev_growth)],
    ['cagr', 'Pendapatan CAGR 3 tahun (%)', (s) => pctv(s.m.rev_cagr3)],
    ['eps', 'Proyeksi pertumbuhan EPS (%)', (s) => pctv(s.m.eps_growth_fwd)],
    ['piotroski', 'Piotroski F-Score 0–9', (s) => s.m.piotroski],
    ['de', 'Debt / Equity (x)', (s) => s.m.de],
    ['dividen', 'Dividend yield (%)', (s) => pctv(s.m.div_yield)],
    ['payout', 'Payout ratio (%)', (s) => pctv(s.m.payout)],
  ]],
  ['Harga & risiko', [
    ['hari', 'Perubahan hari ini (%)', (s) => pctv(s.chg1d)],
    ['r1b', 'Return 1 bulan (%)', (s) => s.ret && pctv(s.ret['1m'])],
    ['r3b', 'Return 3 bulan (%)', (s) => s.ret && pctv(s.ret['3m'])],
    ['r6b', 'Return 6 bulan (%)', (s) => s.ret && pctv(s.ret['6m'])],
    ['r1t', 'Return 1 tahun (%)', (s) => s.ret && pctv(s.ret['1y'])],
    ['beta', 'Beta', (s) => s.m.beta],
    ['vol', 'Volatilitas tahunan (%)', (s) => s.q && pctv(s.q.vol)],
    ['mdd', 'Penurunan terdalam 1 tahun (%, negatif)', (s) => s.q && pctv(s.q.mdd)],
    ['sharpe', 'Sharpe 1 tahun', (s) => s.q && s.q.sharpe],
    ['peluang', 'Peluang untung simulasi (%)', (s) => s.q && s.q.mc && pctv(s.q.mc.p_up)],
  ]],
];
const RUMUS_TEXT = [
  ['sektor', 'Sektor, mis. sektor = "Teknologi"', (s) => s.sector],
  ['rating', 'Rekomendasi: "STRONG BUY", "BUY", "HOLD", "HINDARI"', (s) => s.rating],
  ['ukuran', 'Kapitalisasi: "Mega", "Large", "Mid", "Small"', (s) => s.cap],
  ['ticker', 'Kode saham, mis. ticker = "AAPL"', (s) => s.sym],
];
const RUMUS_GET = Object.fromEntries([...RUMUS_VARS.flatMap(([, v]) => v), ...RUMUS_TEXT].map(([k, , g]) => [k, g]));
const RUMUS_FN = {
  min: (...a) => (a.some((x) => x == null) ? null : Math.min(...a)),
  max: (...a) => (a.some((x) => x == null) ? null : Math.max(...a)),
  abs: (x) => (x == null ? null : Math.abs(x)),
  ada: (x) => x != null, // ada(peg) → data tersedia
};
const RUMUS_CONTOH = [
  ['Murah & menguntungkan', 'pe < 15 dan roe > 15 dan potensi > 20'],
  ['Compounder', 'roic > 18 dan cagr > 10 dan de < 1'],
  ['Turun tapi bagus', 'r3b < -15 dan fund >= 65 dan rating != "HINDARI"'],
  ['Dividen aman', 'dividen > 3 dan payout < 70 dan sehat > 60'],
  ['Tumbuh tidak mahal', 'eps > 15 dan peg < 1.5 dan pendapatan > 10'],
  ['Teknologi undervalue', 'sektor = "Teknologi" dan potensi > 25'],
];

/* ---------- tokenizer + parser (recursive descent) → fungsi (s) => nilai */
function rumusLex(src) {
  const T = [];
  let i = 0;
  const words = { dan: 'and', and: 'and', atau: 'or', or: 'or', bukan: 'not', not: 'not', tidak: 'not' };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(?:e[+-]?\d+)?|^\d+\.?/i.exec(src.slice(i));
      if (!m) throw new Error('titik di tempat yang salah');
      const raw = m[0], v = Number(raw);
      i += m[0].length;
      if (src[i] === '%') i++; // "20%" = 20 (variabel persen sudah dalam persen)
      if (!isFinite(v)) throw new Error(`angka "${raw}" tidak valid`);
      T.push({ t: 'num', v });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))[0];
      i += m.length;
      const w = m.toLowerCase();
      if (words[w]) T.push({ t: 'op', v: words[w] });
      else T.push({ t: 'id', v: w });
      continue;
    }
    if (c === '"' || c === "'") {
      const j = src.indexOf(c, i + 1);
      if (j < 0) throw new Error('tanda kutip belum ditutup');
      T.push({ t: 'str', v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '==', '!=', '&&', '||', '<>'].includes(two)) {
      T.push({ t: 'op', v: { '&&': 'and', '||': 'or', '==': '=', '<>': '!=' }[two] || two });
      i += 2;
      continue;
    }
    if ('<>=+-*/(),!'.includes(c)) { T.push({ t: 'op', v: c === '!' ? 'not' : c }); i++; continue; }
    throw new Error(`karakter "${c}" tidak dikenal`);
  }
  return T;
}
function compileRumus(src) {
  src = String(src || '').trim();
  if (!src) return null;
  const T = rumusLex(src);
  let p = 0;
  const peek = () => T[p];
  const isOp = (v) => T[p] && T[p].t === 'op' && T[p].v === v;
  const need = (v) => { if (!isOp(v)) throw new Error(`kurang "${v}"`); p++; };
  const used = new Set();
  const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
  function orE() { let a = andE(); while (isOp('or')) { p++; const l = a, r = andE(); a = (s) => !!l(s) || !!r(s); } return a; }
  function andE() { let a = notE(); while (isOp('and')) { p++; const l = a, r = notE(); a = (s) => !!l(s) && !!r(s); } return a; }
  function notE() { if (isOp('not')) { p++; const x = notE(); return (s) => !x(s); } return cmpE(); }
  function cmpE() {
    const a = addE();
    const t = peek();
    if (t && t.t === 'op' && ['<', '<=', '>', '>=', '=', '!='].includes(t.v)) {
      p++;
      const b = addE(), op = t.v;
      return (s) => {
        const x = a(s), y = b(s);
        if (x == null || y == null) return false; // data kosong → tidak lolos
        if (typeof x === 'string' || typeof y === 'string') {
          const u = String(x).toLowerCase(), v = String(y).toLowerCase();
          return op === '=' ? u === v : op === '!=' ? u !== v : false;
        }
        switch (op) { case '<': return x < y; case '<=': return x <= y; case '>': return x > y; case '>=': return x >= y; case '=': return x === y; default: return x !== y; }
      };
    }
    return a;
  }
  function addE() {
    let a = mulE();
    while (isOp('+') || isOp('-')) {
      const op = T[p++].v, l = a, r = mulE();
      a = (s) => { const x = num(l(s)), y = num(r(s)); return x == null || y == null ? null : op === '+' ? x + y : x - y; };
    }
    return a;
  }
  function mulE() {
    let a = unE();
    while (isOp('*') || isOp('/')) {
      const op = T[p++].v, l = a, r = unE();
      a = (s) => { const x = num(l(s)), y = num(r(s)); return x == null || y == null || (op === '/' && y === 0) ? null : op === '*' ? x * y : x / y; };
    }
    return a;
  }
  function unE() { if (isOp('-')) { p++; const x = unE(); return (s) => { const v = num(x(s)); return v == null ? null : -v; }; } return atom(); }
  function atom() {
    const t = T[p++];
    if (!t) throw new Error('rumus terpotong di akhir');
    if (t.t === 'num' || t.t === 'str') { const v = t.v; return () => v; }
    if (t.t === 'id') {
      if (isOp('(')) {
        const fn = RUMUS_FN[t.v];
        if (!fn) throw new Error(`fungsi "${t.v}" tidak dikenal (pakai min, max, abs, ada)`);
        p++;
        const args = [];
        if (!isOp(')')) { args.push(orE()); while (isOp(',')) { p++; args.push(orE()); } }
        need(')');
        return (s) => fn(...args.map((g) => g(s)));
      }
      const g = RUMUS_GET[t.v];
      if (!g) throw new Error(`"${t.v}" bukan nama data yang dikenal — lihat daftar di bawah`);
      used.add(t.v);
      return (s) => { try { const v = g(s); return v === undefined ? null : v; } catch (e) { return null; } };
    }
    if (t.v === '(') { const x = orE(); need(')'); return x; }
    throw new Error(`"${t.v}" di tempat yang salah`);
  }
  const fn = orE();
  if (p < T.length) throw new Error(`ada sisa "${T[p].v}" yang tidak dimengerti`);
  return { fn, used: [...used] };
}
const _rumusCache = {};
function rumusOf(src) {
  if (!src) return null;
  if (!(src in _rumusCache)) { try { _rumusCache[src] = compileRumus(src); } catch (e) { _rumusCache[src] = { err: e.message }; } }
  return _rumusCache[src];
}
/** nilai urutan dari rumus urutan (null → paling bawah) */
function rumusSortVal(s) {
  const r = rumusOf(App.filters.rumusSort);
  if (!r || r.err) return -Infinity;
  const v = r.fn(s);
  return typeof v === 'number' && isFinite(v) ? v : typeof v === 'boolean' ? +v : -Infinity;
}
SORTS.rumus = ['Rumus urutan sendiri', rumusSortVal];
SORT_METRIC.rumus = ['Nilai', (s) => { const v = rumusSortVal(s); return v === -Infinity ? '–' : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2).replace(/\.?0+$/, ''); }];

/* ---------- strategi saya (rumus tersimpan) */
const myScreens = () => store.get('myScreens', []);
function saveMyScreens(a) { store.set('myScreens', a.slice(0, 30)); }
function myScreenChips() {
  const a = myScreens(), f = App.filters;
  if (!a.length) return '';
  return `<div class="mk-label" style="margin:10px 0 4px">Strategi saya</div>
    <div class="chips scr-presets" id="myChips">${a.map((m, i) => `<button class="chip ${f.rumus === m.rumus && (f.rumusSort || '') === (m.sort || '') ? 'active' : ''}" data-my="${i}" title="${esc(m.rumus)}">ƒ ${esc(m.name)}</button>`).join('')}</div>`;
}
function bindMyChips(rerender) {
  const box = $('#myChips');
  if (!box) return;
  box.onclick = (e) => {
    const b = e.target.closest('[data-my]');
    if (!b) return;
    const m = myScreens()[+b.dataset.my];
    if (!m) return;
    const f = App.filters;
    const on = f.rumus === m.rumus && (f.rumusSort || '') === (m.sort || '');
    Object.assign(f, defaultFilters(), on ? {} : { rumus: m.rumus, rumusSort: m.sort || '', sort: m.sort ? 'rumus' : 'score' });
    App.shown = 50; saveFilters(); rerender();
  };
}

function openRumusSheet(onApply) {
  const f = App.filters;
  const varList = RUMUS_VARS.map(([g, vs]) => `<div class="rm-g">${esc(g)}</div>` + vs.map(([k, d]) => `<button type="button" class="rm-v" data-ins="${k}"><code>${k}</code><span>${esc(d)}</span></button>`).join('')).join('')
    + '<div class="rm-g">Teks</div>' + RUMUS_TEXT.map(([k, d]) => `<button type="button" class="rm-v" data-ins="${k}"><code>${k}</code><span>${esc(d)}</span></button>`).join('');
  openSheet(`<div class="sheet-handle"></div><h3>ƒ Rumus Sendiri</h3>
    <p class="small muted" style="margin:0 0 8px">Tulis syarat Anda sendiri. Angka persen ditulis apa adanya (<code>roe &gt; 20</code> = ROE di atas 20%). Gabungkan dengan <code>dan</code> / <code>atau</code> / <code>bukan</code> dan tanda kurung. Saham tanpa data untuk syarat itu otomatis tidak lolos.</p>
    <textarea id="rmSrc" class="rm-src" rows="3" spellcheck="false" autocapitalize="off" placeholder='mis. pe < 15 dan roe > 20 dan potensi > 25'>${esc(f.rumus || '')}</textarea>
    <div id="rmMsg" class="rm-msg"></div>
    <div class="chips rm-ex">${RUMUS_CONTOH.map(([n, r]) => `<button type="button" class="chip" data-ex="${esc(r)}">${esc(n)}</button>`).join('')}</div>
    <div class="fgroup"><label>Urutkan dengan rumus (opsional)</label>
      <input id="rmSort" class="rm-src rm-one" spellcheck="false" autocapitalize="off" placeholder="mis. potensi + roe  ·  kosong = pakai urutan biasa" value="${esc(f.rumusSort || '')}">
      <div id="rmSortMsg" class="rm-msg"></div></div>
    <details class="rm-help"><summary>Daftar data yang bisa dipakai (ketuk untuk menyisipkan)</summary><div class="rm-vars">${varList}</div>
      <p class="small faint">Fungsi: <code>min(a,b)</code> <code>max(a,b)</code> <code>abs(x)</code> <code>ada(peg)</code> (data tersedia). Operator: <code>&lt; &lt;= &gt; &gt;= = !=</code> <code>+ − * /</code>.</p></details>
    <div class="sheet-actions"><button class="btn" id="rmClear">Hapus rumus</button><button class="btn" id="rmSave">Simpan…</button><button class="btn primary" id="rmApply">Terapkan</button></div>
    ${myScreens().length ? `<div class="fgroup"><label>Strategi tersimpan</label>${myScreens().map((m, i) => `<div class="rm-saved"><div><b>${esc(m.name)}</b><code>${esc(m.rumus)}${m.sort ? ' · urut: ' + esc(m.sort) : ''}</code></div><button type="button" class="cmp-x" data-del="${i}" title="Hapus">✕</button></div>`).join('')}</div>` : ''}`);
  const sh = $('#sheet .sheet'), src = $('#rmSrc'), srt = $('#rmSort');
  let last = src;
  const check = () => {
    const r = rumusOf(src.value.trim());
    const msg = $('#rmMsg');
    if (!r) msg.innerHTML = '<span class="faint">Kosong = tanpa rumus.</span>';
    else if (r.err) msg.innerHTML = `<span class="down">⚠ ${esc(r.err)}</span>`;
    else {
      const n = App.data.stocks.filter((s) => r.fn(s)).length;
      msg.innerHTML = `<span class="up">✓ ${n} dari ${App.data.stocks.length} saham lolos</span>`;
    }
    const q = rumusOf(srt.value.trim());
    $('#rmSortMsg').innerHTML = q && q.err ? `<span class="down">⚠ ${esc(q.err)}</span>` : '';
    return { ok: !(r && r.err) && !(q && q.err) };
  };
  let t;
  src.oninput = srt.oninput = () => { clearTimeout(t); t = setTimeout(check, 120); };
  src.onfocus = () => (last = src); srt.onfocus = () => (last = srt);
  check();
  $('.rm-ex', sh).onclick = (e) => { const b = e.target.closest('[data-ex]'); if (b) { src.value = b.dataset.ex; check(); } };
  $('.rm-vars', sh).onclick = (e) => {
    const b = e.target.closest('[data-ins]');
    if (!b) return;
    const el = last, a = el.selectionStart ?? el.value.length, z = el.selectionEnd ?? a;
    const pre = el.value.slice(0, a), ins = (pre && !/\s$/.test(pre) ? ' ' : '') + b.dataset.ins + ' ';
    el.value = pre + ins + el.value.slice(z);
    el.focus(); el.selectionStart = el.selectionEnd = a + ins.length;
    check();
  };
  const apply = () => {
    if (!check().ok) { toast('Perbaiki rumus dulu'); return false; }
    const r = src.value.trim(), so = srt.value.trim();
    Object.assign(App.filters, { rumus: r, rumusSort: so });
    if (so) App.filters.sort = 'rumus'; else if (App.filters.sort === 'rumus') App.filters.sort = 'score';
    App.shown = 50; saveFilters();
    return true;
  };
  $('#rmApply').onclick = () => { if (apply()) { closeSheet(); onApply(); } };
  $('#rmClear').onclick = () => { src.value = ''; srt.value = ''; apply(); closeSheet(); onApply(); };
  $('#rmSave').onclick = () => {
    if (!src.value.trim()) { toast('Tulis rumusnya dulu'); return; }
    if (!apply()) return;
    const name = (prompt('Nama strategi:', '') || '').trim().slice(0, 40);
    if (!name) return;
    const a = myScreens().filter((m) => m.name.toLowerCase() !== name.toLowerCase());
    a.push({ name, rumus: App.filters.rumus, sort: App.filters.rumusSort || '' });
    saveMyScreens(a);
    toast(`Strategi "${name}" disimpan`);
    closeSheet(); onApply();
  };
  $$('[data-del]', sh).forEach((b) => (b.onclick = () => {
    const a = myScreens(), m = a[+b.dataset.del];
    if (!m || !confirm(`Hapus strategi "${m.name}"?`)) return;
    a.splice(+b.dataset.del, 1); saveMyScreens(a);
    b.closest('.rm-saved').remove();
  }));
}
