/* =====================================================================
   Radar Saham US — Portofolio, Berita Penting, Orang Dalam, Valuasi Historis,
   Uji Sinyal (IC), dan Kalender Dividen
   (memakai helper global dari app.js, quant.js, ext.js, makro.js)
   ===================================================================== */
'use strict';

App.holdings = store.get('holdings', []);
function saveHoldings() { store.set('holdings', App.holdings); cloudChanged(); }

/* ------------------------------------------------------------ PORTOFOLIO */
function holdingRows() {
  return App.holdings.map((h) => {
    const s = App.bySym[h.sym];
    if (!s) return null;
    const qty = Number(h.qty) || 0, cost = Number(h.cost) || 0;
    const val = qty * s.price, basis = qty * cost;
    const day = val - val / (1 + (s.chg1d || 0));
    return { h, s, qty, cost, val, basis, pl: cost ? val - basis : null, plp: cost ? s.price / cost - 1 : null, day };
  }).filter(Boolean);
}
function renderPorto(el) {
  const rows = holdingRows();
  const tot = rows.reduce((a, r) => ({ val: a.val + r.val, basis: a.basis + (r.cost ? r.basis : 0), day: a.day + r.day, basisVal: a.basisVal + (r.cost ? r.val : 0) }), { val: 0, basis: 0, day: 0, basisVal: 0 });
  const plTot = tot.basis ? tot.basisVal - tot.basis : null;
  const idr = (() => { const mk = App.makro; const r = mk && mk.assets && mk.assets.flatMap((g) => g.rows).find((x) => x.sym === 'IDR=X'); return r ? r.last : null; })();
  // risiko & alokasi
  const sec = {};
  rows.forEach((r) => { sec[r.s.sector] = (sec[r.s.sector] || 0) + r.val; });
  const secArr = Object.entries(sec).map(([k, v]) => [k, tot.val ? v / tot.val : 0]).sort((a, b) => b[1] - a[1]);
  const w = (r) => (tot.val ? r.val / tot.val : 0);
  const beta = rows.reduce((a, r) => a + w(r) * ((r.s.q && r.s.q.beta_calc) ?? r.s.m.beta ?? 1), 0);
  const vol = rows.reduce((a, r) => a + w(r) * ((r.s.q && r.s.q.vol) || 0.3), 0);
  const divInc = rows.reduce((a, r) => a + r.qty * (r.s.div_rate || 0), 0);
  const expRet = rows.reduce((a, r) => a + w(r) * ((r.s.q && r.s.q.mc && r.s.q.mc.exp) ?? 0), 0);
  const warns = [];
  rows.forEach((r) => { if (w(r) > 0.25) warns.push(`<b>${esc(r.s.sym)}</b> ${Math.round(w(r) * 100)}% dari portofolio — terlalu terkonsentrasi (saran ≤ 20–25%).`); });
  secArr.forEach(([k, v]) => { if (v > 0.4) warns.push(`Sektor <b>${esc(k)}</b> ${Math.round(v * 100)}% — diversifikasi lemah.`); });
  rows.forEach((r) => { if (r.s.rating === 'HINDARI') warns.push(`<b>${esc(r.s.sym)}</b> kini berperingkat HINDARI (skor ${Math.round(r.s.score)}) — tinjau ulang alasan memegangnya.`); });
  rows.forEach((r) => { if (r.s.val && r.s.val.upside < -0.15) warns.push(`<b>${esc(r.s.sym)}</b> ${fmt.pct(-r.s.val.upside, 0)} di atas nilai wajar model.`); });
  const { svg, cols } = rows.length ? donut(secArr) : { svg: '', cols: [] };

  el.innerHTML = `<div class="fade-in">
    ${wlTabs('porto')}
    <h1 class="page-title">Portofolio</h1>
    <p class="page-sub">Saham yang Anda miliki — untung/rugi, risiko, dan sinyal model. ${App.cloud && App.cloud.gistId ? '☁ tersinkron & dipantau notifikasi' : 'Tersimpan di perangkat ini · <a class="link" href="#/pengaturan">hubungkan cloud</a> agar dipantau notifikasi'}.</p>
    ${rows.length ? `<div class="cyc-now" style="margin-bottom:12px">
      <div><div class="l">Nilai pasar</div><div class="v">${fmt.usd(tot.val, 0)}</div><div class="s">${idr ? 'Rp ' + Math.round(tot.val * idr).toLocaleString('id-ID') : ''}</div></div>
      <div><div class="l">Hari ini</div><div class="v ${cls(tot.day)}">${tot.day >= 0 ? '+' : '−'}${fmt.usd(Math.abs(tot.day), 0)}</div><div class="s">${fmt.pct(tot.val ? tot.day / (tot.val - tot.day) : null, 2)}</div></div>
      <div><div class="l">Untung/rugi total</div><div class="v ${cls(plTot)}">${plTot == null ? '–' : (plTot >= 0 ? '+' : '−') + fmt.usd(Math.abs(plTot), 0)}</div><div class="s">${plTot == null ? 'isi harga beli' : fmt.pct(plTot / tot.basis, 1)}</div></div>
      <div><div class="l">Dividen / tahun</div><div class="v">${fmt.usd(divInc, 0)}</div><div class="s">yield ${fmt.pct(tot.val ? divInc / tot.val : null, 2, false)}</div></div>
    </div>` : ''}
    <div class="card card-pad">
      <h3 class="card-title">Kepemilikan (${rows.length})</h3>
      ${rows.length ? `<div class="cmp-scroll"><table class="hold-table">
        <tr><th>Saham</th><th class="r">Lembar</th><th class="r">Harga beli</th><th class="r">Nilai</th><th class="r">U/R</th><th class="r">Bobot</th><th></th></tr>
        ${rows.sort((a, b) => b.val - a.val).map((r) => `<tr><td><a href="#/s/${encodeURIComponent(r.s.sym)}"><b>${esc(r.s.sym)}</b></a> ${ratingBadge(r.s.rating)}<div class="faint small">${fmt.usd(r.s.price)} · ${fmt.pct(r.s.chg1d, 1)} · proyeksi ${fmt.pct(r.s.val ? r.s.val.upside : null, 0)}</div></td>
          <td class="r mono">${r.qty.toLocaleString('en-US')}</td><td class="r mono">${r.cost ? fmt.usd(r.cost) : '–'}</td><td class="r mono">${fmt.usd(r.val, 0)}</td>
          <td class="r mono ${cls(r.pl)}">${r.pl == null ? '–' : fmt.pct(r.plp, 1)}<div class="small">${r.pl == null ? '' : (r.pl >= 0 ? '+' : '−') + fmt.usd(Math.abs(r.pl), 0)}</div></td>
          <td class="r mono">${Math.round(w(r) * 100)}%</td><td class="r"><button class="cmp-x" data-edit="${esc(r.h.sym)}" title="Ubah">✎</button></td></tr>`).join('')}
      </table></div>` : '<p class="small muted">Belum ada saham. Tambahkan di bawah — mis. <b>NVDA</b>, 10 lembar, harga beli $150.</p>'}
      <form class="porto-add" id="pAdd" autocomplete="off">
        <input id="pSym" placeholder="Ticker" list="pSyms" required>
        <input id="pQty" type="number" step="any" min="0" placeholder="Lembar" inputmode="decimal" required>
        <input id="pCost" type="number" step="any" min="0" placeholder="Harga beli $" inputmode="decimal">
        <button class="btn primary">+ Tambah</button>
      </form>
      <datalist id="pSyms">${App.data.stocks.map((s) => `<option value="${esc(s.sym)}">${esc(s.name)}</option>`).join('')}</datalist>
    </div>
    ${rows.length ? `<div class="grid-2" style="margin-top:12px">
      <div class="card card-pad"><h3 class="card-title">Alokasi Sektor</h3>
        <div class="port-wrap"><div class="donut-box">${svg}<div class="donut-c"><b>${rows.length}</b><span>saham</span></div></div>
        <div class="donut-leg">${secArr.map(([n, v], i) => `<div><i style="background:${cols[i % cols.length]}"></i><span>${esc(n)}</span><b>${Math.round(v * 100)}%</b></div>`).join('')}</div></div></div>
      <div class="card card-pad"><h3 class="card-title">Risiko &amp; Prospek</h3>
        <div class="kv">
          <div><div class="l">Beta tertimbang</div><div class="v">${beta.toFixed(2)}</div><div class="s">${beta > 1.2 ? 'lebih liar dari pasar' : beta < 0.8 ? 'lebih tenang dari pasar' : 'mirip pasar'}</div></div>
          <div><div class="l">Volatilitas (perkiraan)</div><div class="v">${fmt.pct(vol, 0, false)}</div><div class="s">rata-rata tertimbang, tanpa korelasi</div></div>
          <div><div class="l">Return harapan 12 bln</div><div class="v ${cls(expRet)}">${fmt.pct(expRet, 1)}</div><div class="s">model + CAPM</div></div>
          <div><div class="l">Skor rata-rata</div><div class="v">${Math.round(rows.reduce((a, r) => a + w(r) * r.s.score, 0))}</div><div class="s">tertimbang nilai</div></div>
        </div>
        ${warns.length ? `<ul class="cyc-sig" style="margin-top:12px">${warns.map((x) => `<li class="warn"><span></span><div>${x}</div></li>`).join('')}</ul>` : '<p class="small up" style="margin:10px 0 0">✓ Tidak ada peringatan konsentrasi atau sinyal negatif.</p>'}
      </div></div>` : ''}
    <p class="disclaimer">Harga memakai data harian terakhir aplikasi (bukan real-time). Saham portofolio otomatis dipantau notifikasi (stop loss, target, gerak besar, laporan keuangan &amp; ex-dividend) bila sinkronisasi cloud aktif.</p>
  </div>`;

  $('#pAdd').onsubmit = (e) => {
    e.preventDefault();
    const sym = $('#pSym').value.trim().toUpperCase();
    if (!App.bySym[sym]) { toast(`${sym} tidak ada di universe`); return; }
    const qty = parseFloat($('#pQty').value), cost = parseFloat($('#pCost').value);
    if (!(qty > 0)) { toast('Isi jumlah lembar'); return; }
    const ex = App.holdings.find((h) => h.sym === sym);
    if (ex) {
      // rata-rata harga beli bila menambah posisi
      const q0 = Number(ex.qty) || 0, c0 = Number(ex.cost) || 0;
      ex.cost = cost > 0 && c0 ? (q0 * c0 + qty * cost) / (q0 + qty) : (cost > 0 ? cost : c0);
      ex.qty = q0 + qty;
    } else App.holdings.push({ sym, qty, cost: cost > 0 ? cost : null, added: new Date().toISOString().slice(0, 10) });
    saveHoldings();
    toast(`${sym} ditambahkan`);
    renderPorto(el);
  };
  $$('[data-edit]').forEach((b) => { b.onclick = () => editHolding(b.dataset.edit, el); });
}
function editHolding(sym, el) {
  const h = App.holdings.find((x) => x.sym === sym);
  if (!h) return;
  openSheet(`<div class="sheet-handle"></div><h3>${esc(sym)}</h3>
    <div class="alert-form"><label>Jumlah lembar<input id="eQty" type="number" step="any" value="${h.qty}"></label>
    <label>Harga beli rata-rata ($)<input id="eCost" type="number" step="any" value="${h.cost ?? ''}"></label></div>
    <div class="sheet-actions"><button class="btn" id="eDel" style="color:var(--down)">Hapus</button><button class="btn" data-close>Batal</button><button class="btn primary" id="eSave">Simpan</button></div>`);
  $('#eSave').onclick = () => { h.qty = parseFloat($('#eQty').value) || 0; const c = parseFloat($('#eCost').value); h.cost = c > 0 ? c : null; if (!h.qty) App.holdings = App.holdings.filter((x) => x !== h); saveHoldings(); closeSheet(); renderPorto(el); };
  $('#eDel').onclick = () => { App.holdings = App.holdings.filter((x) => x !== h); saveHoldings(); closeSheet(); renderPorto(el); };
}
function wlTabs(active) {
  return `<nav class="mtabs" style="margin-top:0"><a href="#/watchlist" class="${active === 'wl' ? 'on' : ''}">Watchlist</a><a href="#/portofolio" class="${active === 'porto' ? 'on' : ''}">Portofolio</a></nav>`;
}

/* ------------------------------------------------------------ BERITA PENTING */
App.berita = null;
async function renderBerita(el) {
  el.innerHTML = '<div class="splash"><div class="spinner"></div><p>MEMUAT BERITA…</p></div>';
  try {
    if (!App.berita) { const r = await fetch('data/berita.json', { cache: 'no-cache' }); if (!r.ok) throw new Error('HTTP ' + r.status); App.berita = await r.json(); }
  } catch (e) { el.innerHTML = `<div class="empty"><div class="big-ico">📰</div><b>Feed berita belum tersedia</b><p class="small">Dibuat pada update data harian berikutnya.</p></div>`; return; }
  if (parseHash().parts[0] !== 'berita') return;
  const f = store.get('newsFilter', 'all');
  const mine = new Set([...App.watch, ...App.holdings.map((h) => h.sym)]);
  let items = App.berita.items || [];
  if (f === 'neg') items = items.filter((n) => n.impact < 0);
  if (f === 'pos') items = items.filter((n) => n.impact > 0);
  if (f === 'mkt') items = items.filter((n) => !n.sym);
  if (f === 'mine') items = items.filter((n) => n.sym && mine.has(n.sym));
  const ageNow = (n) => n.age_h + (Date.now() - Date.parse(App.berita.generated)) / 36e5;
  el.innerHTML = `<div class="fade-in">
    <h1 class="page-title">Berita Penting</h1>
    <p class="page-sub">Berita 48 jam yang dinilai paling berpengaruh (akuisisi, investigasi, panduan laba, pergantian CEO, The Fed, konflik…) dari ${App.berita.scanned} saham berperingkat tinggi + pasar umum · diperbarui ${fmt.date(App.berita.generated, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
    <div class="seg-mini" id="nf" style="margin-bottom:12px">${[['all', 'Semua'], ['neg', 'Negatif'], ['pos', 'Positif'], ['mkt', 'Pasar'], ['mine', 'Milik & pantauan']].map(([k, n]) => `<button data-k="${k}" class="${k === f ? 'on' : ''}">${n}</button>`).join('')}</div>
    <div class="card">${items.length ? items.map((n) => {
      const s = n.sym && App.bySym[n.sym];
      return `<div class="news-row ${n.impact < 0 ? 'neg' : n.impact > 0 ? 'pos' : ''}">
        <div class="ns">${n.score}</div>
        <div style="min-width:0">
          <div class="small">${n.sym ? `<a href="#/s/${encodeURIComponent(n.sym)}"><b>${esc(n.sym)}</b></a> ${s ? ratingBadge(s.rating) : ''}${mine.has(n.sym) ? ' <span style="color:var(--gold)">★</span>' : ''}` : '<b>PASAR</b>'} · <span class="muted">${esc(n.cats.join(', '))}</span></div>
          <a class="nt" href="${esc(/^https?:/i.test(n.url || '') ? n.url : '#')}" target="_blank" rel="noopener">${esc(n.title)}</a>
          <div class="faint small">${esc(n.source)} · ${Math.round(ageNow(n))} jam lalu</div></div></div>`;
    }).join('') : '<div class="empty small">Tidak ada berita pada filter ini.</div>'}</div>
    <p class="disclaimer">Penilaian otomatis berbasis kata kunci — bisa keliru menafsirkan konteks. Selalu baca beritanya sendiri.</p>
  </div>`;
  $('#nf').onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) { store.set('newsFilter', b.dataset.k); renderBerita(el); } };
}

/* ------------------------------------------------------------ kartu detail: orang dalam & valuasi historis */
function insiderCard(s, order = 7) {
  const ins = s.ins, m = s.m || {};
  if (!ins && m.insider == null && m.inst == null) return '';
  const b = (ins && ins.buy90) || {}, sl = (ins && ins.sell90) || {};
  const net = ins && ins.net_pct;
  return `<div class="card card-pad" style="order:${order}">
    <h3 class="card-title">Orang Dalam &amp; Institusi</h3>
    <div class="kv k3">
      <div><div class="l">Dimiliki orang dalam</div><div class="v">${fmt.pct(m.insider, 1, false)}</div></div>
      <div><div class="l">Dimiliki institusi</div><div class="v">${fmt.pct(m.inst, 0, false)}</div></div>
      <div><div class="l">Net 6 bln (orang dalam)</div><div class="v ${cls(net)}">${net == null ? '–' : fmt.pct(net, 2)}</div></div>
      <div><div class="l">Beli pasar terbuka 90h</div><div class="v ${b.val ? 'up' : ''}">${b.val ? fmt.big(b.val) : '–'}</div><div class="s">${b.n || 0} orang</div></div>
      <div><div class="l">Jual 90 hari</div><div class="v ${sl.val ? 'down' : ''}">${sl.val ? fmt.big(sl.val) : '–'}</div><div class="s">${sl.n || 0} orang</div></div>
    </div>
    ${ins && ins.recent && ins.recent.length ? `<div class="cmp-scroll" style="margin-top:10px"><table class="hold-table">
      <tr><th>Tanggal</th><th>Orang dalam</th><th>Jenis</th><th class="r">Nilai</th></tr>
      ${ins.recent.map(([d, who, pos, k, sh, v]) => `<tr><td class="mono small">${esc(d)}</td><td>${esc(who)}<div class="faint small">${esc(pos)}</div></td>
        <td><b class="${k === 'Beli' ? 'up' : k === 'Jual' ? 'down' : 'muted'}">${esc(k)}</b></td><td class="r mono">${v ? fmt.big(v) : (sh ? Number(sh).toLocaleString('en-US') + ' lbr' : '–')}</td></tr>`).join('')}</table></div>` : ''}
    <p class="small faint" style="margin:8px 0 0">Pembelian di pasar terbuka oleh beberapa orang dalam sekaligus (<i>cluster buying</i>) secara historis sinyal kuat; penjualan sering karena alasan pribadi/pajak sehingga bobotnya lebih kecil. Menyumbang 20% skor analis.</p>
  </div>`;
}
function ownValCard(s, order = 6) {
  const o = s.own;
  if (!o || (o.pe_own == null && o.ps_own == null)) return '';
  const bar = (v) => { const x = clamp(50 + v * 60, 4, 96); return `<div class="dbar" style="margin-top:6px"><span class="mid"></span><i style="left:${Math.min(50, x)}%;width:${Math.abs(x - 50)}%;background:${v <= 0 ? 'var(--up)' : 'var(--down)'}"></i></div>`; };
  return `<div class="card card-pad" style="order:${order}">
    <h3 class="card-title">Valuasi vs Riwayat Sendiri</h3>
    <div class="kv">
      ${o.pe_own != null ? `<div><div class="l">P/E sekarang vs median ${o.years.length} thn</div><div class="v ${o.pe_own <= 0 ? 'up' : 'down'}">${fmt.pct(o.pe_own, 0)}</div><div class="s">${fmt.x(s.m.pe_ttm)} vs ${fmt.x(o.pe_med)} (rentang ${fmt.x(o.pe_min)}–${fmt.x(o.pe_max)})</div>${bar(o.pe_own)}</div>` : ''}
      ${o.ps_own != null ? `<div><div class="l">P/S sekarang vs median</div><div class="v ${o.ps_own <= 0 ? 'up' : 'down'}">${fmt.pct(o.ps_own, 0)}</div><div class="s">${fmt.x(s.m.ps, 2)} vs ${fmt.x(o.ps_med, 2)}</div>${bar(o.ps_own)}</div>` : ''}
    </div>
    <p class="small faint" style="margin:8px 0 0">Membandingkan saham dengan dirinya sendiri (akhir tahun fiskal ${esc(o.years.slice().reverse().join(', '))}). Diskon besar pada bisnis yang tetap sehat sering jadi peluang; premi besar berarti ekspektasi pasar sudah tinggi. Ikut dihitung dalam pilar Valuasi.</p>
  </div>`;
}

/* ------------------------------------------------------------ STRATEGI: uji sinyal & kalender dividen */
function icCard(tr) {
  if (!tr || !tr.ic) return '';
  const rows = tr.ic, any = rows.some((r) => r.h5_n || r.h20_n || r.h60_n);
  const c = (v, n) => v == null ? `<td class="r faint">–</td>` : `<td class="r mono ${v >= 0.05 ? 'up' : v <= -0.05 ? 'down' : ''}">${v >= 0 ? '+' : ''}${v.toFixed(3)}<div class="faint small">${n} snap</div></td>`;
  return `<div class="card card-pad">
    <h3 class="card-title">Uji Sinyal (Information Coefficient)</h3>
    <p class="small muted" style="margin:-6px 0 10px">Korelasi peringkat antara nilai faktor saat dicatat dan return sesudahnya, untuk semua saham. IC ≥ +0,05 yang konsisten = faktor benar-benar memprediksi; negatif = berlawanan.</p>
    ${any ? `<div class="cmp-scroll"><table class="hold-table"><tr><th>Faktor</th><th class="r">≥1 mgg</th><th class="r">≥1 bln</th><th class="r">≥3 bln</th></tr>
      ${rows.map((r) => `<tr><td>${esc(r.name)}</td>${c(r.h5, r.h5_n)}${c(r.h20, r.h20_n)}${c(r.h60, r.h60_n)}</tr>`).join('')}</table></div>`
      : '<p class="small faint">Data faktor mulai dicatat — hasil pertama muncul setelah ±1 minggu, dan baru bermakna setelah beberapa bulan.</p>'}
    <p class="small faint" style="margin:8px 0 0">Setelah ±3 bulan data, bobot skor bisa disesuaikan berdasarkan faktor yang terbukti bekerja.</p>
  </div>`;
}
function trackBanner(tr) {
  if (!tr || !tr.since) return '';
  const days = Math.round((Date.now() - Date.parse(tr.since)) / 864e5);
  if (days >= 60) return '';
  return `<div class="cyc-callout" style="background:var(--warn-bg);margin:0 0 12px">⚠ <b>Data belum cukup:</b> rekam jejak baru ${days} hari (${tr.n_snaps} snapshot). Selisih return dalam periode sependek ini sebagian besar kebetulan — anggap bermakna setelah ±60 hari, idealnya 6–12 bulan.</div>`;
}
function dividendHtml(days) {
  const now = Date.now(), lim = now + days * 864e5;
  const mine = new Set([...App.watch, ...App.holdings.map((h) => h.sym)]);
  const list = App.data.stocks.filter((s) => s.exdiv_ts && s.exdiv_ts * 1000 > now - 864e5 && s.exdiv_ts * 1000 < lim && s.div_rate)
    .map((s) => ({ s, y: s.div_rate / s.price })).sort((a, b) => a.s.exdiv_ts - b.s.exdiv_ts);
  const pri = list.filter((x) => mine.has(x.s.sym) || x.y >= 0.025 || x.s.rating === 'STRONG BUY' || x.s.rating === 'BUY');
  const show = (pri.length >= 6 ? pri : list).slice(0, 24);
  return `<div class="card card-pad">
    <h3 class="card-title">Kalender Dividen</h3>
    <p class="small muted" style="margin:-6px 0 10px">Ex-dividend ${days} hari ke depan: saham harus sudah dimiliki <b>sebelum</b> tanggal ini agar berhak atas dividen. Ditampilkan milik/pantauan, yield ≥ 2,5%, atau Buy/Strong Buy. (p) = tanggal perkiraan.</p>
    ${show.length ? `<div class="earn-list">${show.map(({ s, y }) => {
      const d = new Date(s.exdiv_ts * 1000), dd = Math.round((s.exdiv_ts * 1000 - now) / 864e5);
      return `<a class="earn" href="#/s/${encodeURIComponent(s.sym)}"><div class="earn-d"><b>${d.getDate()}</b><span>${d.toLocaleDateString('id-ID', { month: 'short' })}</span></div>
        <div style="min-width:0"><b>${esc(s.sym)}</b>${mine.has(s.sym) ? ' <span style="color:var(--gold)">★</span>' : ''}${s.exdiv_est ? ' <span class="faint small">(p)</span>' : ''}<div class="small muted">$${s.div_rate.toFixed(2)}/thn · yield ${fmt.pct(y, 1, false)}</div></div>
        <div style="text-align:right">${ratingBadge(s.rating)}<div class="faint small">${dd <= 0 ? 'hari ini' : dd + ' hari'}</div></div></a>`;
    }).join('')}</div>` : '<p class="small faint">Tidak ada jadwal ex-dividend dalam periode ini.</p>'}
  </div>`;
}
