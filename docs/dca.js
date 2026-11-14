/* =====================================================================
   Radar Saham US — Rencana DCA Bulanan, Biaya Broker (Pluang), dan
   Perbandingan Portofolio vs S&P 500
   (memakai helper global dari app.js, makro.js, porto.js, rebal.js, dunia.js)
   ===================================================================== */
'use strict';

/* ------------------------------------------------------------ biaya broker */
const BROKER_DEF = {
  n: 'Pluang', fee: 0.003, fx: 0.005, tax: 0.15, frac: true, min: 1,
};
function brokerCfg() { return Object.assign({}, BROKER_DEF, (App.notify && App.notify.broker) || {}); }
function dcaCfg() { return Object.assign({ on: false, amt: 2000000, day: 1 }, (App.notify && App.notify.dca) || {}); }
function setNotifyKey(k, v) {
  App.notify[k] = v;
  store.set('notify', App.notify);
  if (typeof cloudChanged === 'function') cloudChanged();
}
const rp = (v) => 'Rp ' + Math.round(v).toLocaleString('id-ID');
const pctID = (x, d = 2) => (x * 100).toLocaleString('id-ID', { maximumFractionDigits: d }) + '%';

function idrNow() {
  const mk = App.makro;
  const r = mk && mk.assets && mk.assets.flatMap((g) => g.rows).find((x) => x.sym === 'IDR=X');
  if (r && r.last) return { v: r.last, src: 'kurs pasar' };
  const X = typeof idrScenarios === 'function' ? idrScenarios() : null;
  if (X && X.cur) return { v: X.cur, src: 'Prakiraan Dunia' };
  return { v: 16500, src: 'perkiraan — data kurs belum termuat' };
}

/* ------------------------------------------------------------ rencana DCA */
function dcaPlan(rows) {
  const D = dcaCfg(), B = brokerCfg(), K = idrNow();
  const efPart = typeof efAllocation === 'function' && wealthSet() ? efAllocation(wealthCfg(), D.amt) : 0; // dana darurat dulu
  const gross = (D.amt - efPart) / K.v;
  const fxCost = gross * B.fx;
  const usd = gross - fxCost;
  if (!(usd > 0)) return null;
  // target alokasi = hasil rebalancing (profil risiko) dengan dana baru; DCA hanya MEMBELI yang porsinya kurang
  const R = computeRebalance(rows, Object.assign({}, rebOpts(), { cash: usd, regime: false }));
  if (!R) return null;
  let items = R.plan.filter((p) => p.w > 0 && p.tv - p.cv > 0).map((p) => ({ p, need: p.tv - p.cv }))
    .sort((a, b) => b.need - a.need).slice(0, usd < 300 ? 2 : usd < 1000 ? 3 : 5); // dana kecil: fokus 1–2 saham per bulan, bergiliran
  const minOrd = Math.max(B.min, usd * 0.15);
  for (let it = 0; it < 10 && items.length > 1; it++) {
    const tot = items.reduce((a, x) => a + x.need, 0);
    const small = items.filter((x) => (usd * x.need) / tot < minOrd);
    if (!small.length) break;
    items = items.filter((x) => x !== small[small.length - 1]);
  }
  const tot = items.reduce((a, x) => a + x.need, 0) || 1;
  let feeTot = 0, left = 0;
  const orders = items.map(({ p }) => {
    const alloc = (usd * (tot ? items.find((x) => x.p === p).need : 0)) / tot;
    let sh = (alloc / (1 + B.fee)) / p.s.price;
    sh = B.frac ? Math.floor(sh * 10000) / 10000 : Math.floor(sh);
    const cost = sh * p.s.price, fee = cost * B.fee;
    feeTot += fee;
    left += alloc - cost - fee;
    return { s: p.s, held: !!p.held, alloc, sh, cost, fee, wT: p.w };
  }).filter((o) => o.sh > 0);
  const after = R.cur + orders.reduce((a, o) => a + o.cost, 0);
  orders.forEach((o) => {
    const cv = (rows.find((r) => r.s.sym === o.s.sym) || { val: 0 }).val;
    o.wAfter = after ? (cv + o.cost) / after : 0;
  });
  const maxBefore = rows.length ? Math.max(...rows.map((r) => r.val / (R.cur || 1))) : 0;
  const maxAfter = rows.length || orders.length
    ? Math.max(...rows.map((r) => (r.val + (orders.find((o) => o.s.sym === r.s.sym) || { cost: 0 }).cost) / after), ...orders.map((o) => o.wAfter))
    : 0;
  return { D, B, K, efPart, gross, fxCost, usd, feeTot, left, orders, R, maxBefore, maxAfter };
}

function fvMonthly(pv, pmt, rYear, years) {
  const r = Math.pow(1 + rYear, 1 / 12) - 1, n = years * 12;
  return pv * Math.pow(1 + r, n) + pmt * ((Math.pow(1 + r, n) - 1) / r);
}

function dcaCard(rows, valUsd) {
  const P = dcaPlan(rows);
  const D = dcaCfg(), B = brokerCfg();
  const T = typeof timing === 'function' && App.dunia ? timing() : null;
  const pvIdr = valUsd * (P ? P.K.v : idrNow().v);
  const timingNote = T ? `🌍 Waktu masuk <b style="color:${timingColor(T.label)}">${T.label}</b> — ${T.label === 'Agresif' || T.label === 'Bertahap'
    ? 'kondisi mendukung; jalankan DCA seperti biasa.'
    : 'pasar sedang rawan, tapi DCA <b>tetap jalan</b>: membeli rutin saat harga turun justru menurunkan harga rata-rata. Yang dihindari adalah membeli besar sekaligus di luar jadwal.'}` : '';
  return `<div class="card card-pad" style="margin-top:12px" id="dcaCard">
    <div class="section-head" style="margin-bottom:6px;align-items:center;flex-wrap:wrap"><h3 class="card-title" style="margin:0">🗓️ Rencana DCA Bulanan</h3>${P && P.orders.length ? '<button class="btn" id="dcaCopy">Salin</button>' : ''}</div>
    <p class="small muted" style="margin:0 0 10px">Menabung saham rutin tiap bulan dengan nominal tetap. Uang baru dipakai untuk membeli saham yang porsinya <b>masih kurang</b> menurut target profil <b>${prof().ico} ${prof().n}</b>, jadi portofolio seimbang pelan-pelan <i>tanpa menjual</i> (tanpa biaya jual &amp; tanpa merealisasi untung). Saham bersaran JUAL tidak ditambah. Dana kecil difokuskan ke 2–3 saham yang paling kurang tiap bulan, bergiliran.</p>
    <div class="reb-opts">
      <label>Nominal / bulan Rp <input id="dcaAmt" type="number" min="0" step="100000" value="${D.amt || ''}" inputmode="numeric"></label>
      <label class="chk"><input type="checkbox" id="dcaOn" ${D.on ? 'checked' : ''}> ingatkan lewat Kabar tiap tanggal</label>
      <label><select id="dcaDay">${Array.from({ length: 28 }, (_, i) => i + 1).map((d) => `<option value="${d}" ${d === D.day ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
    </div>
    ${D.on && !(App.cloud && App.cloud.gistId) ? '<p class="small warn" style="margin:6px 0 0">Pengingat butuh sinkronisasi cloud — <a class="link" href="#/pengaturan">hubungkan di Pengaturan</a>.</p>' : ''}
    ${P ? `<div class="kv k3" style="margin:10px 0">
      <div><div class="l">Dana bulan ini</div><div class="v">${rp(D.amt)}</div><div class="s">${P.efPart ? `saham ${rp(D.amt - P.efPart)} · ` : ''}kurs ${Math.round(P.K.v).toLocaleString('id-ID')} (${esc(P.K.src)})</div></div>
      <div><div class="l">Biaya ${esc(B.n)}</div><div class="v">${fmt.usd(P.fxCost + P.feeTot, 2)}</div><div class="s">kurs ${pctID(B.fx)} ${fmt.usd(P.fxCost, 2)} · transaksi ${pctID(B.fee)} ${fmt.usd(P.feeTot, 2)}</div></div>
      <div><div class="l">Diinvestasikan</div><div class="v">${fmt.usd(P.usd - P.feeTot - P.left, 2)}</div><div class="s">${P.left > 0.5 ? `sisa ${fmt.usd(P.left, 2)} (bukan pecahan)` : `${P.orders.length} saham`}</div></div>
    </div>
    ${P.efPart ? `<p class="small warn" style="margin:0 0 8px">🛟 Dana darurat belum cukup — sisihkan <b>${rp(P.efPart)}</b> ke tabungan/RDPU dulu; sisanya ${rp(D.amt - P.efPart)} untuk saham di bawah. <a class="link" href="#wealthCard" onclick="document.getElementById('wealthCard').scrollIntoView({behavior:'smooth'});return false">atur</a></p>` : ''}
    ${P.orders.length ? `<div class="cmp-scroll"><table class="hold-table">
      <tr><th>Saham</th><th class="r">Beli</th><th class="r">Lembar</th><th class="r">Bobot</th></tr>
      ${P.orders.map((o) => `<tr><td><a href="#/s/${encodeURIComponent(o.s.sym)}"><b>${esc(o.s.sym)}</b></a> ${ratingBadge(o.s.rating)}<div class="small"><b class="up">${o.held ? 'Tambah' : 'Beli baru'}</b> <span class="faint">· ${esc(o.s.sector)} · ${fmt.usd(o.s.price)}${o.s.etf ? '' : ` · potensi ${fmt.pct(o.s.val ? o.s.val.upside : null, 0)}`}</span></div></td>
        <td class="r mono"><b>${rp((o.cost + o.fee) / (1 - B.fx) * P.K.v)}</b><div class="faint small">${fmt.usd(o.cost + o.fee, 2)}</div></td>
        <td class="r mono">${o.sh.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
        <td class="r mono">${Math.round(o.wAfter * 100)}%<div class="faint small">target ${Math.round(o.wT * 100)}%</div></td></tr>`).join('')}
    </table></div>
    ${rows.length ? `<p class="small" style="margin:8px 0 0">Bobot saham terbesar: <b>${Math.round(P.maxBefore * 100)}%</b> → <b>${Math.round(P.maxAfter * 100)}%</b> setelah DCA bulan ini.</p>` : ''}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn primary" id="dcaRec">✓ Sudah dibeli — catat ke portofolio</button></div>
    <p class="small faint" style="margin:6px 0 0">Di ${esc(B.n)}: beli berdasarkan <b>nominal</b> (bukan lembar) sesuai kolom Rupiah. Harga bisa bergeser sedikit — bila nominal beda, ubah angka lembar lewat ✎ di tabel Kepemilikan.</p>`
    : '<p class="small muted">Belum ada saham yang perlu dibeli — semua sudah di atas target.</p>'}` : '<p class="small muted">Isi nominal per bulan.</p>'}
    ${timingNote ? `<p class="small" style="margin:10px 0 0">${timingNote}</p>` : ''}
    ${D.amt > 0 ? `<details style="margin-top:10px"><summary class="small"><b>Ilustrasi bila rutin ${rp(D.amt)}/bulan</b></summary>
      <div class="cmp-scroll" style="margin-top:6px"><table class="hold-table"><tr><th>Lama</th><th class="r">Total setor</th><th class="r">Return 6%/thn</th><th class="r">Return 10%/thn</th></tr>
      ${[5, 10, 20].map((y) => `<tr><td>${y} tahun</td><td class="r mono">${rp(pvIdr + D.amt * 12 * y)}</td><td class="r mono">${rp(fvMonthly(pvIdr, D.amt, 0.06, y))}</td><td class="r mono"><b>${rp(fvMonthly(pvIdr, D.amt, 0.10, y))}</b></td></tr>`).join('')}
      </table></div>
      <p class="small faint" style="margin:6px 0 0">Termasuk portofolio sekarang ${rp(pvIdr)} sebagai modal awal. Rata-rata jangka panjang S&amp;P 500 ±10%/thn dalam dolar; nilai riil tiap tahun bisa jauh di atas atau di bawah — ilustrasi, bukan janji.</p></details>` : ''}
    ${brokerSettings()}
  </div>`;
}

function brokerSettings() {
  const B = brokerCfg();
  return `<details style="margin-top:10px" id="brkBox"><summary class="small"><b>⚙️ Biaya broker: ${esc(B.n)}</b> · transaksi ${pctID(B.fee)} · kurs ${pctID(B.fx)} · pajak dividen ${pctID(B.tax, 0)} · ${B.frac ? 'pecahan saham' : 'lembar utuh'}</summary>
    <div class="reb-opts" style="margin-top:8px">
      <label>Biaya transaksi % <input id="brFee" type="number" step="0.01" min="0" value="${+(B.fee * 100).toFixed(3)}"></label>
      <label>Selisih kurs Rp→$ % <input id="brFx" type="number" step="0.05" min="0" value="${+(B.fx * 100).toFixed(3)}"></label>
      <label>Pajak dividen % <input id="brTax" type="number" step="1" min="0" value="${+(B.tax * 100).toFixed(1)}"></label>
      <label class="chk"><input type="checkbox" id="brFrac" ${B.frac ? 'checked' : ''}> pecahan saham</label>
      <button class="btn" id="brReset" type="button">Bawaan Pluang</button>
    </div>
    <p class="small faint" style="margin:6px 0 0">Bawaan Pluang: biaya transaksi saham AS 0,30% per beli/jual (0,20% untuk Pluang Plus), pecahan saham mulai ±Rp 5.000, pajak dividen AS dipotong 15%. Selisih kurs Rp→$ tidak diumumkan — 0,5% adalah perkiraan; bandingkan kurs beli USD di aplikasi Pluang dengan kurs pasar lalu sesuaikan. Biaya ini dipakai di Rencana DCA, Saran Rebalancing, dan dividen bersih.</p>
  </details>`;
}

/* catat pembelian; simpan juga per transaksi (lots) agar perbandingan S&P 500 memakai tanggal tiap pembelian */
function addPurchase(sym, qty, price, date) {
  const st = App.bySym[sym];
  const ex = App.holdings.find((h) => h.sym === sym);
  const lot = price > 0 ? { d: date, q: qty, c: price } : null;
  if (ex) {
    const q0 = Number(ex.qty) || 0, c0 = Number(ex.cost) || 0;
    if (!ex.lots && c0 && ex.date && q0) ex.lots = [{ d: ex.date, q: q0, c: c0 }];
    ex.cost = price > 0 && c0 ? (q0 * c0 + qty * price) / (q0 + qty) : (price > 0 ? price : c0 || null);
    ex.qty = Math.round((q0 + qty) * 10000) / 10000;
    if (ex.lots && lot) ex.lots.push(lot); else delete ex.lots;
    if (!ex.date) ex.date = date;
  } else {
    const h = { sym, qty, cost: price > 0 ? price : null, date,
      buy: { rating: st.rating, score: st.score, fund: st.fund, fair: st.val ? st.val.fair : null, date }, added: new Date().toISOString().slice(0, 10) };
    if (lot) h.lots = [lot];
    App.holdings.push(h);
  }
}
function lotsOf(r) {
  const L = r.h.lots;
  if (Array.isArray(L) && L.length && L.every((x) => x.d && x.q > 0 && x.c > 0) && Math.abs(L.reduce((a, x) => a + x.q, 0) - r.qty) < 0.002 * Math.max(1, r.qty)) return L;
  return r.cost && r.h.date ? [{ d: r.h.date, q: r.qty, c: r.cost }] : null;
}

function bindDca(rows, el) {
  const c = $('#dcaCard');
  if (!c) return;
  const rerender = () => { const y = window.scrollY; renderPorto(el); window.scrollTo(0, y); };
  const saveD = () => {
    setNotifyKey('dca', { on: $('#dcaOn').checked, amt: Math.max(0, parseFloat($('#dcaAmt').value) || 0), day: parseInt($('#dcaDay').value, 10) || 1 });
    rerender();
  };
  ['#dcaAmt', '#dcaOn', '#dcaDay'].forEach((id) => { $(id).onchange = saveD; });
  const saveB = () => {
    setNotifyKey('broker', { n: 'Pluang', fee: Math.max(0, parseFloat($('#brFee').value) || 0) / 100, fx: Math.max(0, parseFloat($('#brFx').value) || 0) / 100,
      tax: Math.max(0, parseFloat($('#brTax').value) || 0) / 100, frac: $('#brFrac').checked, min: 1 });
    rerender();
    const b = $('#brkBox'); if (b) b.open = true;
  };
  ['#brFee', '#brFx', '#brTax', '#brFrac'].forEach((id) => { $(id).onchange = saveB; });
  $('#brReset').onclick = () => { setNotifyKey('broker', Object.assign({}, BROKER_DEF)); rerender(); };
  const P = dcaPlan(rows);
  const rec = $('#dcaRec');
  if (rec && P) rec.onclick = () => {
    if (!confirm(`Catat pembelian ${P.orders.map((o) => `${o.s.sym} ${o.sh}`).join(', ')} lembar ke portofolio?${P.efPart ? `\nDana darurat juga ditambah ${rp(P.efPart)}.` : ''}`)) return;
    if (P.efPart && typeof wealthCfg === 'function') { const W = wealthCfg(); W.ef += P.efPart; setNotifyKey('wealth', W); }
    const today = new Date().toISOString().slice(0, 10);
    P.orders.forEach((o) => addPurchase(o.s.sym, o.sh, Math.round(o.s.price * (1 + P.B.fee) * 10000) / 10000, today));
    saveHoldings();
    toast('Pembelian DCA dicatat');
    rerender();
  };
  const cp = $('#dcaCopy');
  if (cp && P) cp.onclick = async () => {
    const txt = [`DCA ${new Date().toISOString().slice(0, 7)} · ${rp(P.D.amt)} (${P.B.n}, profil ${prof().n}):`]
      .concat(P.efPart ? [`- Dana darurat: ${rp(P.efPart)} ke tabungan/RDPU`] : [])
      .concat(P.orders.map((o) => `- ${o.s.sym}: beli ${rp((o.cost + o.fee) / (1 - P.B.fx) * P.K.v)} (~${fmt.usd(o.cost + o.fee, 2)}, ${o.sh} lbr)`)).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Rencana DCA disalin'); } catch (e) { prompt('Salin:', txt); }
  };
}

/* ------------------------------------------------------------ portofolio vs S&P 500 */
function benchCard(rows) {
  if (!rows.length) return '';
  const spy = App.histCache.SPY;
  const head = '<h3 class="card-title">Dibanding S&amp;P 500</h3>';
  if (!spy || !spy.c) return `<div class="card card-pad" style="margin-top:12px">${head}<p class="small muted">Memuat data S&amp;P 500…</p></div>`;
  const n = spy.d.length, spyNow = spy.c[n - 1];
  const idx = (d) => { const i = spy.d.findIndex((x) => x >= d); return i < 0 ? n - 1 : i; };
  const noData = rows.filter((r) => !lotsOf(r));
  const tooOld = rows.filter((r) => lotsOf(r) && lotsOf(r).some((l) => l.d < spy.d[0]));
  const ok = rows.filter((r) => lotsOf(r) && !tooOld.includes(r));
  const skipTxt = [noData.length ? `${noData.map((r) => esc(r.s.sym)).join(', ')} dilewati (harga/tanggal beli kosong).` : '',
    tooOld.length ? `${tooOld.map((r) => esc(r.s.sym)).join(', ')} dilewati (dibeli sebelum ${fmt.date(spy.d[0])}, di luar data S&amp;P 500).` : ''].join(' ');
  if (!ok.length) return `<div class="card card-pad" style="margin-top:12px">${head}<p class="small muted">${noData.length ? 'Isi <b>harga beli</b> dan <b>tanggal beli</b> (✎ di tabel Kepemilikan) agar portofolio bisa dibandingkan dengan membeli S&amp;P 500 pada hari yang sama. ' : ''}${skipTxt}</p></div>`;
  const items = ok.map((r) => {
    const lots = lotsOf(r).map((l) => ({ ...l, i: idx(l.d) }));
    const basis = lots.reduce((a, l) => a + l.q * l.c, 0);
    const valB = lots.reduce((a, l) => a + l.q * l.c * spyNow / spy.c[l.i], 0);
    return { r, lots, basis, i0: Math.min(...lots.map((l) => l.i)), d0: lots.map((l) => l.d).sort()[0], rB: valB / basis - 1, rS: r.val / basis - 1, valB };
  });
  const basis = items.reduce((a, x) => a + x.basis, 0);
  const val = items.reduce((a, x) => a + x.r.val, 0);
  const valB = items.reduce((a, x) => a + x.valB, 0);
  const diff = val - valB;
  // grafik nilai: portofolio (lembar sekarang × harga historis) vs uang yang sama di S&P 500
  const i0 = Math.min(...items.map((x) => x.i0));
  // grafik hanya pada rentang yang punya riwayat harga semua saham (riwayat saham ±2 tahun)
  const hStart = items.reduce((m, x) => { const h = App.histCache[x.r.s.sym]; return h && h.d[0] > m ? h.d[0] : m; }, '');
  const c0 = Math.max(i0, hStart ? idx(hStart) : i0);
  const dates = spy.d.slice(c0);
  const maps = {};
  items.forEach((x) => { const h = App.histCache[x.r.s.sym]; if (h) { const m = {}; h.d.forEach((d, k) => { m[d] = h.c[k]; }); maps[x.r.s.sym] = m; } });
  const last = {};
  const port = [], bench = [], cap = [];
  dates.forEach((d, k) => {
    const j = c0 + k;
    let pv = 0, bv = 0, cv = 0;
    items.forEach((x) => {
      const m = maps[x.r.s.sym];
      if (m && m[d] != null) last[x.r.s.sym] = m[d];
      x.lots.forEach((l) => {
        if (j < l.i) return;
        pv += l.q * (last[x.r.s.sym] ?? l.c);
        bv += l.q * l.c * spy.c[j] / spy.c[l.i];
        cv += l.q * l.c;
      });
    });
    port.push(pv); bench.push(bv); cap.push(cv);
  });
  port[port.length - 1] = val; // harga terkini
  const chart = dates.length > 5 ? lineChart([
    { v: cap, color: 'var(--muted)', dash: '4 4', w: 1.2 },
    { v: bench, color: '#f59e0b' },
    { v: port, color: '#0284c7', w: 2.2 },
  ], { dates, h: 210, fmtY: (v) => '$' + (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v)), fmtX: (d) => fmt.date(d, { day: 'numeric', month: 'short', year: '2-digit' }) }) : '';
  const days = (Date.now() - new Date(spy.d[i0]).getTime()) / 864e5;
  return `<div class="card card-pad" style="margin-top:12px">${head}
    <p class="small muted" style="margin:0 0 10px">Bagaimana jika uang yang sama dibelikan ETF S&amp;P 500 (SPY/VOO) pada tanggal beli masing-masing saham? Ini cara paling jujur menilai apakah memilih saham sendiri sepadan dengan risikonya.</p>
    <div class="kv k3" style="margin-bottom:10px">
      <div><div class="l">Portofolio Anda</div><div class="v">${fmt.usd(val, 0)}</div><div class="s ${cls(val / basis - 1)}">${fmt.pct(val / basis - 1, 1)}</div></div>
      <div><div class="l">Bila di S&amp;P 500</div><div class="v">${fmt.usd(valB, 0)}</div><div class="s ${cls(valB / basis - 1)}">${fmt.pct(valB / basis - 1, 1)}</div></div>
      <div><div class="l">${diff >= 0 ? 'Mengalahkan pasar' : 'Tertinggal dari pasar'}</div><div class="v ${cls(diff)}">${diff >= 0 ? '+' : '−'}${fmt.usd(Math.abs(diff), 0)}</div><div class="s">${fmt.pct(val / valB - 1, 1)} · ${days < 90 ? 'periode masih pendek' : Math.round(days / 30) + ' bulan'}</div></div>
    </div>
    ${chart && c0 > i0 ? `<p class="small faint" style="margin:0 0 4px">Grafik mulai ${fmt.date(spy.d[c0])} (batas riwayat harga saham); angka di atas tetap dihitung sejak tanggal beli.</p>` : ''}
    ${chart ? `<div class="legend small" style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:4px"><span><i style="display:inline-block;width:12px;height:3px;background:#0284c7;vertical-align:middle"></i> Portofolio</span><span><i style="display:inline-block;width:12px;height:3px;background:#f59e0b;vertical-align:middle"></i> S&amp;P 500</span><span class="faint">- - modal</span></div>${chart}` : ''}
    <div class="cmp-scroll" style="margin-top:8px"><table class="hold-table"><tr><th>Saham</th><th>Sejak</th><th class="r">Saham</th><th class="r">S&amp;P 500</th><th class="r">Selisih</th></tr>
    ${items.sort((a, b) => (b.rS - b.rB) - (a.rS - a.rB)).map((x) => `<tr><td><b>${esc(x.r.s.sym)}</b></td><td class="small">${fmt.date(x.d0)}${x.lots.length > 1 ? ` <span class="faint">(${x.lots.length}×)</span>` : ''}</td><td class="r mono ${cls(x.rS)}">${fmt.pct(x.rS, 1)}</td><td class="r mono ${cls(x.rB)}">${fmt.pct(x.rB, 1)}</td><td class="r mono ${cls(x.rS - x.rB)}"><b>${fmt.pct(x.rS - x.rB, 1)}</b></td></tr>`).join('')}
    </table></div>
    <p class="small faint" style="margin:8px 0 0">S&amp;P 500 = SPY termasuk dividen; return saham Anda dihitung dari harga beli (dividen yang diterima belum dihitung). Biaya &amp; kurs sama untuk keduanya sehingga diabaikan. Pembelian lewat tombol DCA / + Tambah dicatat per tanggal; posisi lama tanpa catatan per transaksi dianggap dibeli seluruhnya pada tanggal beli. ${skipTxt} Bila dalam 1–2 tahun portofolio terus tertinggal, pertimbangkan menaruh sebagian besar dana di ETF indeks.</p>
  </div>`;
}

/* ------------------------------------------------------------ target keuangan */
function goalCfg() {
  return Object.assign({ amt: 500000000, year: new Date().getFullYear() + 9, r: 0.08, infl: 0.035 }, (App.notify && App.notify.goal) || {});
}
function goalCalc(pv, G, pmt) {
  const now = new Date();
  const n = Math.max(1, (G.year - now.getFullYear()) * 12 + (11 - now.getMonth()));
  const rm = Math.pow(1 + G.r, 1 / 12) - 1, g = Math.pow(1 + rm, n);
  const need = Math.max(0, ((G.amt - pv * g) * rm) / (g - 1));
  const fv = pv * g + (pmt * (g - 1)) / rm;
  let m = 0, v = pv;
  while (v < G.amt && m < 720) { v = v * (1 + rm) + pmt; m++; }
  return { n, need, fv, months: v >= G.amt ? m : null, real: G.amt / Math.pow(1 + G.infl, n / 12) };
}
function goalCard(valUsd) {
  const G = goalCfg(), D = dcaCfg(), K = idrNow().v, extra = typeof goalExtraIdr === 'function' ? goalExtraIdr() : 0, pv = valUsd * K + extra;
  const c = goalCalc(pv, G, D.amt || 0);
  const p = G.amt ? Math.min(1, pv / G.amt) : 0;
  const reach = c.months == null ? null : new Date(new Date().getFullYear(), new Date().getMonth() + c.months, 1);
  const ok = c.fv >= G.amt;
  const ceil50 = (x) => Math.ceil(x / 50000) * 50000;
  return `<div class="card card-pad" style="margin-top:12px" id="goalCard">
    <h3 class="card-title">🎯 Target Keuangan</h3>
    <div class="reb-opts">
      <label>Target Rp <input id="gAmt" type="number" min="0" step="10000000" value="${G.amt}" inputmode="numeric"></label>
      <label>Tahun <select id="gYear">${Array.from({ length: 36 }, (_, i) => new Date().getFullYear() + 1 + i).map((y) => `<option value="${y}" ${y === G.year ? 'selected' : ''}>${y}</option>`).join('')}</select></label>
      <label>Asumsi return <select id="gR">${[0.06, 0.08, 0.1].map((v) => `<option value="${v}" ${v === G.r ? 'selected' : ''}>${v * 100}%/thn</option>`).join('')}</select></label>
    </div>
    <div style="margin-top:10px" class="small">Sekarang <b>${rp(pv)}</b>${extra ? ` <span class="faint">(termasuk aset lain ${rp(extra)})</span>` : ''} dari <b>${rp(G.amt)}</b> (${Math.round(p * 100)}%)</div>
    <div class="goal-bar"><i style="width:${(p * 100).toFixed(1)}%"></i></div>
    <div class="kv k3" style="margin:10px 0">
      <div><div class="l">Perlu DCA / bulan</div><div class="v">${rp(c.need)}</div><div class="s">${c.n} bulan lagi · return ${Math.round(G.r * 100)}%/thn</div></div>
      <div><div class="l">Dengan DCA sekarang</div><div class="v ${ok ? 'up' : 'down'}">${rp(c.fv)}</div><div class="s">${D.amt ? rp(D.amt) + '/bln' : 'DCA belum diisi'} · ${ok ? 'target tercapai ✓' : 'kurang ' + rp(G.amt - c.fv)}</div></div>
      <div><div class="l">Target tercapai</div><div class="v">${reach ? reach.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' }) : '–'}</div><div class="s">${reach ? 'dengan DCA sekarang' : 'naikkan DCA'}</div></div>
    </div>
    ${c.need > 0 && Math.abs(ceil50(c.need) - (D.amt || 0)) >= 50000 ? `<button class="btn" id="gUse">Pakai ${rp(ceil50(c.need))}/bulan sebagai nominal DCA</button>` : ''}
    <div class="cmp-scroll" style="margin-top:10px"><table class="hold-table"><tr><th>Bila return rata-rata</th><th class="r">Perlu / bulan</th><th class="r">Hasil DCA sekarang</th></tr>
      ${[0.06, 0.08, 0.1].map((r) => { const x = goalCalc(pv, Object.assign({}, G, { r }), D.amt || 0); return `<tr><td>${r * 100}%/thn</td><td class="r mono">${rp(x.need)}</td><td class="r mono ${x.fv >= G.amt ? 'up' : ''}">${rp(x.fv)}</td></tr>`; }).join('')}
    </table></div>
    <p class="small faint" style="margin:8px 0 0">${rp(G.amt)} di ${G.year} setara ±<b>${rp(c.real)}</b> uang hari ini (inflasi ${(G.infl * 100).toLocaleString('id-ID')}%/thn) — pertimbangkan menaikkan target atau DCA seiring naiknya penghasilan. Return dalam rupiah juga dipengaruhi kurs; hasil nyata tiap tahun bisa jauh berbeda dari rata-rata.</p>
  </div>`;
}
function bindGoal(el) {
  if (!$('#goalCard')) return;
  const rerender = () => { const y = window.scrollY; renderPorto(el); window.scrollTo(0, y); };
  const save = () => {
    setNotifyKey('goal', Object.assign(goalCfg(), { amt: Math.max(0, parseFloat($('#gAmt').value) || 0), year: +$('#gYear').value, r: parseFloat($('#gR').value) }));
    rerender();
  };
  ['#gAmt', '#gYear', '#gR'].forEach((id) => { $(id).onchange = save; });
  const u = $('#gUse');
  if (u) u.onclick = () => {
    const G = goalCfg(), c = goalCalc(holdingRows().reduce((a, r) => a + r.val, 0) * idrNow().v + (typeof goalExtraIdr === 'function' ? goalExtraIdr() : 0), G, dcaCfg().amt || 0);
    setNotifyKey('dca', Object.assign(dcaCfg(), { amt: Math.ceil(c.need / 50000) * 50000 }));
    toast('Nominal DCA diperbarui');
    rerender();
  };
}
