/* =====================================================================
   Radar Saham US × Prakiraan Dunia (gabfx09.github.io/prakiraan-dunia)
   - Skor "Waktu Masuk": sinyal kuantitatif Radar + rezim, risiko, matriks aset, siklus & skenario Prakiraan
   - Sikap makro per sektor (matriks aset Prakiraan) untuk detail saham & rebalancing
   - Rentang harga Prakiraan dikalibrasi ulang memakai hasil backtest-nya sendiri
   - Proyeksi portofolio dalam Rupiah memakai skenario USD/IDR
   ===================================================================== */
'use strict';

App.dunia = null;
const DUNIA_URL = 'https://gabfx09.github.io/prakiraan-dunia/';
const STANCE = { add: { n: 'Tambah', v: 80, c: 'up' }, hold: { n: 'Tahan', v: 55, c: 'muted' }, care: { n: 'Hati-hati', v: 35, c: 'warn' }, cut: { n: 'Kurangi', v: 15, c: 'down' } };
const HZ = ['1 bln', '3 bln', '6 bln', '1 thn', '3 thn', '5 thn'];

async function loadDunia() {
  if (App.dunia) return App.dunia;
  const bases = [location.origin + '/prakiraan-dunia/data/', 'https://raw.githubusercontent.com/GabFx09/prakiraan-dunia/main/data/'];
  for (const base of bases) {
    try {
      const get = async (f) => { const r = await fetch(base + f, { cache: 'no-cache' }); if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); };
      const [snap, bt, mk] = await Promise.all([get('snapshot.json'), get('backtest.json').catch(() => null), get('market.json').catch(() => null)]);
      App.dunia = { snap, bt, mk };
      return App.dunia;
    } catch (e) { /* coba sumber berikutnya */ }
  }
  throw new Error('Prakiraan Dunia tidak dapat dimuat');
}

/* ------------------------------------------------------------ sikap makro per sektor */
function matrixRow(re) { const S = App.dunia && App.dunia.snap; return S ? S.assets.find((a) => re.test(a.n)) : null; }
function nearStance(row) {
  if (!row) return null;
  const w = [0.4, 0.35, 0.25];
  const v = row.s.slice(0, 3).reduce((a, k, i) => a + (STANCE[k] ? STANCE[k].v : 55) * w[i], 0);
  return v;
}
function sectorRow(s) {
  if (!App.dunia) return null;
  if (/gold|silver/i.test(s.industry || '')) return matrixRow(/^Emas/i);
  if (s.sector === 'Energi') return matrixRow(/energi|minyak/i);
  if (s.sector === 'Teknologi' || (s.sector === 'Komunikasi' && (s.mcap || 0) > 2e11)) return matrixRow(/teknologi|AI/i);
  return matrixRow(/Saham AS/i);
}
function sectorStance(s) {
  const row = sectorRow(s);
  if (!row) return null;
  const v = nearStance(row);
  const k = v >= 70 ? 'add' : v >= 50 ? 'hold' : v >= 30 ? 'care' : 'cut';
  return { k, v, row, mult: { add: 1.15, hold: 1, care: 0.85, cut: 0.65 }[k] };
}
function stanceTag(s) {
  const st = sectorStance(s);
  if (!st) return '';
  return `<a class="tag" href="#/dunia" title="${esc(st.row.n)}: ${esc(st.row.e)}">🌍 Makro: <b class="${STANCE[st.k].c}">${STANCE[st.k].n}</b></a>`;
}

/* ------------------------------------------------------------ skor waktu masuk */
async function loadAllForTiming() {
  await Promise.all([loadDunia().catch(() => null), loadMakro().catch(() => null), loadCycles().catch(() => null)]);
}
function timing() {
  const P = [], D = App.dunia && App.dunia.snap, mk = App.makro, cy = App.cyc, m = App.data.market;
  const add = (src, name, val, score, w, note) => { if (score != null && isFinite(score)) P.push({ src, name, val, score: clamp(score, 0, 100), w, note }); };
  if (mk && mk.fg) add('Radar', 'Fear & Greed', Math.round(mk.fg.now) + ' · ' + mk.fg.label, 100 - mk.fg.now, 0.13, 'Kontrarian: takut = peluang beli');
  if (cy && cy.longrun && cy.longrun.cape) add('Radar', 'Valuasi pasar (CAPE)', cy.longrun.cape.now + ' · persentil ' + Math.round(cy.longrun.cape.pct * 100), 100 - cy.longrun.cape.pct * 100, 0.08, 'Mahal = return 10 thn lebih rendah');
  if (m) add('Radar', 'Tren S&P 500', m.regime + ' · ' + Math.round((m.breadth || 0) * 100) + '% saham > MA200', { Bullish: 65, Netral: 50, Bearish: 35 }[m.regime] ?? 50, 0.08, 'Tren & keluasan pasar');
  if (cy && cy.pres_now) {
    const k = cy.pres_now.k, mo = new Date().getMonth();
    const sc = k === 2 ? (mo >= 8 ? 70 : 45) : k === 3 ? 72 : k === 4 ? 60 : 50;
    add('Radar', 'Siklus presiden', 'Tahun ' + k + (k === 2 ? ' (midterm)' : ''), sc, 0.08, k === 2 && mo >= 8 ? 'Akhir tahun midterm → historis reli 12 bln' : 'Pola 4 tahunan');
  }
  if (mk && mk.curve && mk.curve.spread_now != null) {
    const li = mk.curve.last_inv, rec = li && li.end && li.months_since_end != null && li.months_since_end <= 24;
    add('Radar', 'Kurva yield 10T-3B', (mk.curve.spread_now >= 0 ? '+' : '') + mk.curve.spread_now.toFixed(2) + ' pp', mk.curve.spread_now < 0 ? 40 : rec ? 45 : 60, 0.05, rec ? 'Baru normal setelah inversi — waspada resesi' : 'Sinyal resesi');
  }
  const fl = App.data.stocks.filter((s) => s.flow != null);
  if (fl.length) {
    const net = (fl.filter((s) => s.flow >= 55).length - fl.filter((s) => s.flow <= 45).length) / fl.length;
    add('Radar', 'Aliran dana pasar', (net >= 0 ? '+' : '') + Math.round(net * 100) + '% saham akumulasi', 50 + net * 100, 0.08, 'Akumulasi vs distribusi di 900+ saham');
  }
  if (D) {
    add('Prakiraan', 'Indeks risiko dunia', D.risk + '/100 · ' + D.regimeTitle, 100 - D.risk, 0.14, D.riskParts.map((r) => r.k + ' ' + r.v).join(', '));
    const us = matrixRow(/Saham AS/i);
    if (us) add('Prakiraan', 'Sikap saham AS', us.s.slice(0, 3).map((k, i) => HZ[i] + ': ' + (STANCE[k] || {}).n).join(' · '), nearStance(us), 0.14, us.e);
    const sp = D.cycles.find((c) => c.id === 'spx');
    if (sp) add('Prakiraan', 'Siklus saham AS (Wyckoff)', sp.phases[Math.min(3, Math.floor(sp.pos / 25))] + ' · posisi ' + sp.pos, sp.pos >= 85 || sp.pos < 15 ? 65 : sp.pos >= 60 ? 35 : sp.pos < 40 ? 70 : 50, 0.06, sp.now);
    const yr = D.horizons.find((h) => h.id === '1t');
    if (yr) {
      const p = (k) => (yr.sc.find((x) => x.k === k) || {}).p || 0;
      add('Prakiraan', 'Skenario 1 tahun', `dasar ${p('base')}% · optimis ${p('bull')}% · pesimis ${p('bear')}%`, 55 + (p('bull') - p('bear')) * 1.2, 0.06, yr.sum);
    }
  }
  const tw = P.reduce((a, p) => a + p.w, 0) || 1;
  const score = P.reduce((a, p) => a + p.score * p.w, 0) / tw;
  const label = score >= 62 ? 'Agresif' : score >= 50 ? 'Bertahap' : score >= 38 ? 'Hati-hati' : 'Tahan kas';
  const equity = { Agresif: 0.95, Bertahap: 0.75, 'Hati-hati': 0.55, 'Tahan kas': 0.35 }[label];
  const now = { Agresif: '60–80%', Bertahap: '30–40%', 'Hati-hati': '15–25%', 'Tahan kas': '≤10%' }[label];
  return { score, label, parts: P, equity, now, coverage: P.filter((p) => p.src === 'Prakiraan').length ? 'Radar + Prakiraan' : 'Radar saja' };
}
function timingColor(l) { return { Agresif: 'var(--up)', Bertahap: 'var(--accent-2)', 'Hati-hati': 'var(--warn)', 'Tahan kas': 'var(--down)' }[l]; }

/* ------------------------------------------------------------ kalibrasi rentang (backtest Prakiraan) */
function invNorm(p) { // Acklam
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396157509031, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const q = p < 0.02425 ? Math.sqrt(-2 * Math.log(p)) : p > 1 - 0.02425 ? Math.sqrt(-2 * Math.log(1 - p)) : null;
  if (q != null) { const x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); return p < 0.5 ? x : -x; }
  const r = p - 0.5, t = r * r;
  return (((((a[0] * t + a[1]) * t + a[2]) * t + a[3]) * t + a[4]) * t + a[5]) * r / (((((b[0] * t + b[1]) * t + b[2]) * t + b[3]) * t + b[4]) * t + 1);
}
function calibratedBands() {
  const bt = App.dunia && App.dunia.bt;
  if (!bt || !bt.bands) return [];
  const target = bt.target || 0.55, zT = invNorm((1 + target) / 2);
  const names = { spx: 'S&P 500', ihsg: 'IHSG', gold: 'Emas', brent: 'Minyak Brent', usdidr: 'USD/IDR', ust10: 'Obligasi AS 10 thn', btc: 'Bitcoin' };
  return Object.entries(bt.bands).map(([k, hz]) => ({ k, n: names[k] || k, rows: Object.entries(hz).map(([h, [lo, hi]]) => {
    const cov = ((bt.coverage[k] || {})[h] || {}).rate;
    const f = cov ? zT / invNorm((1 + clamp(cov, 0.05, 0.95)) / 2) : 1;
    const mid = (lo + hi) / 2, half = (hi - lo) / 2 * f;
    return { h, lo, hi, cov, f, clo: mid - half, chi: mid + half };
  }) }));
}

/* ------------------------------------------------------------ skenario rupiah */
function idrScenarios() {
  const D = App.dunia && App.dunia.snap;
  const cur = (() => { const r = App.makro && App.makro.assets && App.makro.assets.flatMap((g) => g.rows).find((x) => x.sym === 'IDR=X'); return r ? r.last : 18000; })();
  const parse = (txt) => { const m = /Rupiah\s+([\d.]+)\s*[–-]\s*([\d.]+)/i.exec(txt || ''); return m ? (Number(m[1].replace(/\./g, '')) + Number(m[2].replace(/\./g, ''))) / 2 : null; };
  let base = null;
  if (D) { const yr = D.horizons.find((h) => h.id === '1t'); if (yr) for (const sc of yr.sc) { const v = parse([sc.d, ...(sc.l || [])].join(' ')); if (v && sc.k === 'base') base = v; } }
  base = base || cur;
  return { cur, base, bull: Math.min(base, cur) * 0.97, bear: Math.max(base, cur) * 1.05 };
}

/* ------------------------------------------------------------ kartu beranda */
function duniaHomeCard() {
  if (!App.dunia) return `<section class="section"><a class="card card-pad link-card" href="#/dunia"><span class="ico-lg">🌍</span><div><b>Waktu Masuk &amp; Rezim Dunia</b><div class="small muted">Memuat sinyal Radar + Prakiraan Dunia…</div></div><span class="faint">›</span></a></section>`;
  const T = timing(), D = App.dunia.snap;
  return `<section class="section"><a class="card card-pad timing-home" href="#/dunia">
    <div class="th-l"><div class="mk-label">Waktu masuk saham</div><div class="th-v" style="color:${timingColor(T.label)}">${T.label.toUpperCase()}</div><div class="small faint">skor ${Math.round(T.score)}/100 · ${T.coverage}</div></div>
    <div class="th-r"><div class="small"><b>${esc(D.regimeTitle)}</b> · risiko dunia <b>${D.risk}</b>/100</div>
      <div class="small muted">Masukkan <b>${T.now}</b> dana yang direncanakan sekarang${T.label === 'Agresif' ? '' : ', sisanya bertahap 3–6 bulan'}. Porsi saham disarankan ±${Math.round(T.equity * 100)}%.</div></div>
    <span class="faint">›</span></a></section>`;
}

/* ------------------------------------------------------------ halaman Waktu & Rezim */
async function renderDunia(el) {
  el.innerHTML = '<div class="splash"><div class="spinner"></div><p>MEMUAT PRAKIRAAN DUNIA…</p></div>';
  await loadAllForTiming();
  if (parseHash().parts[0] !== 'dunia') return;
  if (!App.dunia) { el.innerHTML = `<div class="empty"><div class="big-ico">🌍</div><b>Prakiraan Dunia tidak dapat dimuat</b><p class="small">Skor waktu masuk tetap memakai sinyal Radar.</p></div>`; return; }
  const D = App.dunia.snap, T = timing();
  const today = new Date().toISOString().slice(0, 10), lim = new Date(Date.now() + 45 * 864e5).toISOString().slice(0, 10);
  const events = [...(D.calendar || []).map((x) => ({ d: x.d, t: x.t, c: x.c, imp: x.imp, url: x.url })), ...(D.milestones || []).map((x) => ({ d: x.d, t: x.t, c: x.c }))]
    .filter((x) => x.d >= today && x.d <= lim).sort((a, b) => a.d.localeCompare(b.d));
  const bands = calibratedBands();
  const secRows = D.assets.filter((a) => /saham|emas/i.test(a.n));
  const radarCount = (row) => App.data.stocks.filter((s) => (s.rating === 'STRONG BUY' || s.rating === 'BUY') && sectorRow(s) === row).length;
  el.innerHTML = `<div class="fade-in">
    <h1 class="page-title">Waktu Masuk &amp; Rezim Dunia</h1>
    <p class="page-sub">Gabungan sinyal kuantitatif Radar dan analisis <a class="link" href="${DUNIA_URL}" target="_blank" rel="noopener">Prakiraan Dunia ↗</a> · diperbarui ${fmt.date(D.updatedAt, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
    <div class="card card-pad timing-hero">
      <div><div class="mk-label">Kesimpulan</div><div class="th-big" style="color:${timingColor(T.label)}">${T.label.toUpperCase()}</div>
        <div class="bar" style="margin:8px 0"><i style="width:${T.score}%;background:${timingColor(T.label)}"></i></div>
        <div class="small faint">skor ${Math.round(T.score)}/100 · 0 = tahan kas · 100 = agresif</div></div>
      <div><p style="margin:0 0 8px"><b>Rencana:</b> masukkan <b>${T.now}</b> dari dana yang direncanakan untuk saham sekarang${T.label === 'Agresif' ? '.' : `, sisanya bertahap (mis. tiap 2–4 minggu) selama 3–6 bulan atau saat skor naik.`} Porsi saham dalam total aset ±<b>${Math.round(T.equity * 100)}%</b>, sisanya kas/pasar uang/obligasi${D.risk >= 70 ? ' dan sedikit emas sebagai pelindung' : ''}.</p>
        <p class="small muted" style="margin:0"><b>${esc(D.regimeTitle)}.</b> ${esc(D.regimeText)}</p></div>
    </div>
    <div class="card card-pad" style="margin-top:12px"><h3 class="card-title">Rincian Sinyal</h3>
      <div class="cmp-scroll"><table class="hold-table"><tr><th>Sumber</th><th>Sinyal</th><th>Nilai</th><th class="r">Skor</th><th class="r">Bobot</th></tr>
      ${T.parts.map((p) => `<tr><td class="small"><span class="tag">${p.src}</span></td><td><b>${esc(p.name)}</b><div class="faint small">${esc((p.note || '').slice(0, 140))}</div></td><td class="small">${esc(p.val)}</td>
        <td class="r mono" style="color:${scoreColor(p.score)}">${Math.round(p.score)}</td><td class="r mono faint">${Math.round(p.w / T.parts.reduce((a, x) => a + x.w, 0) * 100)}%</td></tr>`).join('')}</table></div>
      <p class="small faint" style="margin:8px 0 0">Skor tinggi = kondisi mendukung membeli saham. Sinyal Prakiraan ditulis agen AI dan bersifat kualitatif — diberi bobot ±40%, sisanya data pasar Radar.</p></div>
    <div class="grid-2" style="margin-top:12px">
      <div class="card card-pad"><h3 class="card-title">Sikap per Kelompok Saham</h3>
        <div class="cmp-scroll"><table class="hold-table"><tr><th>Kelompok</th>${HZ.map((h) => `<th class="r">${h}</th>`).join('')}</tr>
        ${secRows.map((a) => `<tr><td><b>${esc(a.n)}</b><div class="faint small">${esc(a.e)}${/Indonesia/i.test(a.n) ? '' : ` · ${radarCount(a)} saham Buy di Radar`}</div></td>${a.s.map((k) => `<td class="r"><b class="${(STANCE[k] || {}).c || ''}" style="font-size:11px">${(STANCE[k] || { n: k }).n}</b></td>`).join('')}</tr>`).join('')}</table></div>
        <p class="small faint" style="margin:8px 0 0">Dipakai Radar sebagai label "🌍 Makro" di halaman saham dan pengali bobot di Saran Rebalancing (Tambah ×1,15 · Hati-hati ×0,85 · Kurangi ×0,65).</p></div>
      <div class="card card-pad"><h3 class="card-title">Skenario 1 Tahun (Prakiraan)</h3>
        ${(D.horizons.find((h) => h.id === '1t') || { sc: [] }).sc.map((sc) => `<div class="scn ${sc.k}"><div class="scn-h"><b>${esc(sc.n)}</b><span class="mono">${sc.p}%</span></div><div class="bar"><i style="width:${sc.p}%;background:${sc.k === 'bull' ? 'var(--up)' : sc.k === 'bear' ? 'var(--down)' : 'var(--accent-2)'}"></i></div><div class="small muted">${esc(sc.d)}</div></div>`).join('')}</div>
    </div>
    <div class="grid-2" style="margin-top:12px">
      <div class="card card-pad"><h3 class="card-title">Pemicu 45 Hari ke Depan</h3>
        ${events.length ? events.map((x) => `<div class="earn"><div class="earn-d"><b>${Number(x.d.slice(8, 10))}</b><span>${new Date(x.d).toLocaleDateString('id-ID', { month: 'short' })}</span></div><div style="min-width:0">${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.t)}</a>` : esc(x.t)}<div class="faint small">${esc(x.c || '')}${x.imp ? ' · dampak ' + esc(x.imp) : ''}</div></div><div></div></div>`).join('') : '<p class="small faint">Tidak ada jadwal penting.</p>'}
        <p class="small faint" style="margin:8px 0 0">Tinjau ulang rencana di sekitar tanggal-tanggal ini.</p></div>
      <div class="card card-pad"><h3 class="card-title">Rentang Harga Dikalibrasi</h3>
        <div class="cmp-scroll"><table class="hold-table"><tr><th>Aset</th><th>Horizon</th><th class="r">Rentang asli</th><th class="r">Akurasi historis</th><th class="r">Dikalibrasi</th></tr>
        ${bands.map((b) => b.rows.map((r) => `<tr><td>${esc(b.n)}</td><td class="small">${r.h === '1b' ? '1 bln' : '3 bln'}</td><td class="r mono small">${fmt.num(r.lo, r.lo < 20 ? 2 : 0)}–${fmt.num(r.hi, r.hi < 20 ? 2 : 0)}</td>
          <td class="r mono small ${r.cov == null ? '' : Math.abs(r.cov - 0.55) < 0.03 ? 'up' : 'warn'}" style="${r.cov != null && Math.abs(r.cov - 0.55) >= 0.03 ? 'color:var(--warn)' : ''}">${r.cov == null ? '–' : Math.round(r.cov * 100) + '%'}</td>
          <td class="r mono small"><b>${fmt.num(r.clo, r.clo < 20 ? 2 : 0)}–${fmt.num(r.chi, r.chi < 20 ? 2 : 0)}</b></td></tr>`).join('')).join('')}</table></div>
        <p class="small faint" style="margin:8px 0 0">Rentang Prakiraan dirancang memuat harga sebenarnya 55% dari waktu. Backtest 5 tahun menunjukkan beberapa terlalu sempit (&lt;55%) atau terlalu lebar (&gt;55%); kolom "dikalibrasi" melebarkan/menyempitkan rentang agar peluangnya benar-benar ±55%.</p></div>
    </div>
    <p class="disclaimer">Bukan nasihat keuangan. Waktu pasar sulit ditebak — rencana bertahap dibuat agar keputusan tidak bergantung pada satu titik waktu.</p>
  </div>`;
}

/* ------------------------------------------------------------ boot: muat di latar untuk beranda */
(function duniaBoot() {
  const wait = setInterval(() => {
    if (!App.data) return;
    clearInterval(wait);
    loadAllForTiming().then(() => { const v = parseHash().parts[0] || 'home'; if (v === 'home' || v === 'portofolio' || v === 'dunia') render();
    else if (v === 's') { const t = document.querySelector('.d-sym'), s = App.data.stocks.find((x) => x.sym === decodeURIComponent(parseHash().parts[1] || '').toUpperCase()); if (t && s && !t.querySelector('a.tag')) t.insertAdjacentHTML('beforeend', ' ' + stanceTag(s)); } });
  }, 200);
})();
