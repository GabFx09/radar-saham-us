/* =====================================================================
   Radar Saham US — Transaksi portofolio: beli tambah, jual (sebagian/semua),
   ubah data, dan riwayat transaksi (dengan pembatalan penjualan).
   Memakai addPurchase (dca.js), recordSale/undoSale (pajak.js).
   ===================================================================== */
'use strict';

const fq = (n) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 4 });
const r4 = (n) => Math.round(n * 10000) / 10000;

/** lembar jual/beli: mode 'buy' | 'sell' | 'edit'. pre = { q, p, cash } isian awal (mis. dari rekomendasi) */
function openTrade(sym, mode, el, pre = {}) {
  const s = App.bySym[sym] || {};
  if (!App.bySym[sym]) return;
  const held = App.holdings.find((x) => x.sym === sym);
  const h = held || { sym, qty: 0, cost: null }; // saham baru dari rekomendasi: hanya tab Beli
  if (!held) mode = 'buy';
  const B = typeof brokerCfg === 'function' ? brokerCfg() : { fee: 0, n: 'broker' };
  const today = new Date().toISOString().slice(0, 10);
  openSheet(`<div class="sheet-handle"></div>
    <h3 style="margin-bottom:2px">${esc(sym)} <span class="faint small" style="font-weight:400">${esc(s.name || '')}</span></h3>
    <p class="small muted" style="margin:0 0 10px">${held ? `Dimiliki <b>${fq(h.qty)}</b> lembar${h.cost ? ` · harga beli rata-rata <b>${fmt.usd(h.cost)}</b>` : ''}` : 'Belum dimiliki — beli baru'}${s.price ? ` · harga sekarang ${fmt.usd(s.price)}` : ''}</p>
    <nav class="mtabs tx-tabs"><a href="#" data-m="buy">+ ${held ? 'Beli tambah' : 'Beli'}</a>${held ? '<a href="#" data-m="sell">− Jual</a><a href="#" data-m="edit">✎ Ubah data</a>' : ''}</nav>
    <div id="txBody"></div>`);

  const show = (m) => {
    $$('.tx-tabs a').forEach((a) => a.classList.toggle('on', a.dataset.m === m));
    const body = $('#txBody');
    if (m === 'edit') {
      body.innerHTML = `<div class="alert-form"><label>Jumlah lembar<input id="eQty" type="number" step="any" inputmode="decimal" value="${h.qty}"></label>
        <label>Harga beli rata-rata ($)<input id="eCost" type="number" step="any" inputmode="decimal" value="${h.cost ?? ''}"></label>
        <label>Tanggal beli<input id="eDate" type="date" value="${h.date || ''}"></label></div>
        <p class="small faint" style="margin:6px 0 0">Untuk koreksi data saja. Untuk transaksi baru pakai tab <b>Beli tambah</b> / <b>Jual</b> agar untung/rugi &amp; SPT tercatat benar.</p>
        <div class="sheet-actions"><button class="btn" id="eDel" style="color:var(--down)">Hapus saham</button><button class="btn" data-close>Batal</button><button class="btn primary" id="eSave">Simpan</button></div>`;
      $('#eSave').onclick = () => {
        const q = parseFloat($('#eQty').value) || 0, c = parseFloat($('#eCost').value), d = $('#eDate').value || h.date || null;
        if (q !== Number(h.qty) || (c > 0 ? c : null) !== (h.cost ?? null) || d !== h.date) delete h.lots; // diubah manual → catatan per transaksi tidak berlaku
        h.qty = q; h.cost = c > 0 ? c : null; h.date = d;
        if (!h.qty) App.holdings = App.holdings.filter((x) => x !== h);
        saveHoldings(); closeSheet(); renderPorto(el);
      };
      $('#eDel').onclick = () => {
        if (!confirm(`Hapus ${sym} dari portofolio tanpa mencatat penjualan?\n(Kalau Anda menjualnya, pakai tab Jual.)`)) return;
        App.holdings = App.holdings.filter((x) => x !== h); saveHoldings(); closeSheet(); renderPorto(el);
      };
      return;
    }
    const sell = m === 'sell';
    body.innerHTML = `<div class="alert-form">
        <label>Lembar ${sell ? 'dijual' : 'dibeli'}<input id="tQ" type="number" step="any" min="0" inputmode="decimal" placeholder="mis. ${sell ? fq(h.qty) : '1.5'}" ${sell ? `max="${h.qty}"` : pre.q ? `value="${pre.q}"` : ''}></label>
        <label>Harga ${sell ? 'jual' : 'beli'} per lembar ($)<input id="tP" type="number" step="any" min="0" inputmode="decimal" value="${(!sell && pre.p) || s.price || ''}"></label>
        <label>Tanggal<input id="tD" type="date" value="${today}" max="${today}"></label></div>
      ${sell ? `<div class="tx-quick">${[[0.25, '25%'], [0.5, '50%'], [0.75, '75%'], [1, 'Semua']].map(([f, n]) => `<button class="chip" data-frac="${f}">${n}</button>`).join('')}</div>` : ''}
      ${cashCfg().set ? `<label class="chk tx-cash"><input type="checkbox" id="tCash" ${sell || pre.cash !== false ? 'checked' : ''}> ${sell ? 'masukkan hasil ke saldo' : 'potong dari saldo'} <span class="faint">(saldo ${fmt.usd(cashCfg().usd, 2)})</span></label>` : ''}
      <div class="tx-prev" id="tPrev"></div>
      <div class="sheet-actions"><button class="btn" data-close>Batal</button><button class="btn primary ${sell ? 'tx-sell' : ''}" id="tGo">${sell ? 'Jual' : 'Beli'}</button></div>`;
    const prev = () => {
      const q = parseFloat($('#tQ').value), p = parseFloat($('#tP').value);
      const out = $('#tPrev');
      if (!(q > 0) || !(p > 0)) { out.innerHTML = '<span class="faint">Isi jumlah lembar &amp; harga untuk melihat hasilnya.</span>'; return; }
      const fee = q * p * (B.fee || 0);
      if (sell) {
        const qq = Math.min(q, h.qty), left = r4(h.qty - qq), net = qq * p - fee;
        const pl = h.cost ? qq * (p - h.cost) - fee : null;
        out.innerHTML = `${q > h.qty + 1e-9 ? `<div class="warn">Melebihi yang dimiliki — dihitung ${fq(h.qty)} lembar.</div>` : ''}
          <div>Uang diterima ≈ <b>${fmt.usd(net, 2)}</b>${fee ? ` <span class="faint">(stl biaya ${fmt.usd(fee, 2)})</span>` : ''}</div>
          ${pl != null ? `<div>Untung/rugi ≈ <b class="${cls(pl)}">${pl >= 0 ? '+' : '−'}${fmt.usd(Math.abs(pl), 2)}</b> <span class="${cls(pl)}">(${fmt.pct(p / h.cost - 1, 1)})</span></div>` : ''}
          <div>Sisa: <b>${fq(left)}</b> lembar${left <= 1e-6 ? ' — posisi ditutup' : ''}</div>`;
      } else {
        const nq = r4(Number(h.qty) + q), nc = h.cost && h.qty ? (h.qty * h.cost + q * p) / nq : p;
        out.innerHTML = `<div>Total bayar ≈ <b>${fmt.usd(q * p + fee, 2)}</b>${fee ? ` <span class="faint">(termasuk biaya ${fmt.usd(fee, 2)})</span>` : ''}</div>
          ${pre.q && !sell ? `<div class="faint">Isian dari rekomendasi — ubah lembar &amp; harga sesuai yang benar-benar Anda beli di ${esc(B.n)}.</div>` : ''}
          <div>Sesudah beli: <b>${fq(nq)}</b> lembar · rata-rata <b>${fmt.usd(nc)}</b>${h.cost ? ` <span class="faint">(sebelumnya ${fmt.usd(h.cost)})</span>` : ''}</div>
          ${$('#tCash') && $('#tCash').checked && q * p + fee > cashCfg().usd + 0.005 ? `<div class="warn">Saldo hanya ${fmt.usd(cashCfg().usd, 2)} — saldo akan menjadi $0.</div>` : ''}`;
      }
    };
    $('#tQ').oninput = prev; $('#tP').oninput = prev;
    const tc = $('#tCash');
    if (tc) { let touched = false; tc.onchange = () => { touched = true; prev(); }; $('#tD').onchange = () => { if (!touched) tc.checked = $('#tD').value >= today; }; } // transaksi lama: saldo tidak diubah
    $$('[data-frac]').forEach((b) => { b.onclick = () => { const f = +b.dataset.frac; $('#tQ').value = f === 1 ? h.qty : r4(h.qty * f); prev(); }; });
    $('#tGo').onclick = () => {
      const q = parseFloat($('#tQ').value), p = parseFloat($('#tP').value), d = $('#tD').value || today;
      if (!(q > 0)) { toast('Isi jumlah lembar'); return; }
      if (!(p > 0)) { toast(`Isi harga ${sell ? 'jual' : 'beli'}`); return; }
      if (sell) {
        if (q >= h.qty - 1e-9 && !confirm(`Jual semua ${fq(h.qty)} lembar ${sym}? ${sym} akan keluar dari portofolio (bisa dibatalkan di Riwayat transaksi).`)) return;
        const qq = Math.min(q, h.qty);
        if (!recordSale(sym, q, p, d)) { toast('Gagal mencatat penjualan'); return; }
        if (tc && tc.checked) { const sale = App.sales[App.sales.length - 1]; sale.cashAdj = adjCash(qq * p * (1 - (B.fee || 0))); saveSales(); }
        toast(`Terjual ${fq(qq)} lembar ${sym} ✓`);
      } else {
        addPurchase(sym, q, p, d);
        saveHoldings();
        if (tc && tc.checked) adjCash(-(q * p * (1 + (B.fee || 0))));
        toast(`Dibeli ${fq(q)} lembar ${sym} ✓`);
      }
      closeSheet(); renderPorto(el);
    };
    prev();
    setTimeout(() => { const i = $('#tQ'); if (i) i.focus(); }, 50);
  };
  $$('.tx-tabs a').forEach((a) => { a.onclick = (e) => { e.preventDefault(); show(a.dataset.m); }; });
  show(mode || 'buy');
}

/** riwayat transaksi: pembelian (catatan per transaksi) + penjualan */
function txHistoryCard() {
  const T = [];
  App.holdings.forEach((h) => {
    if (Array.isArray(h.lots) && h.lots.length) h.lots.forEach((l) => T.push({ k: 'buy', sym: h.sym, d: l.d, q: l.o ?? l.q, p: l.c }));
    else if (h.cost && h.date) T.push({ k: 'buy', sym: h.sym, d: h.date, q: Number(h.qty) || 0, p: Number(h.cost) }); // posisi awal (diisi manual)
  });
  // saham yang sudah dijual habis: pembeliannya diambil dari salinan saat posisi ditutup
  (App.sales || []).forEach((s) => {
    const hb = s.hb;
    if (!hb || App.holdings.some((h) => h.sym === s.sym)) return;
    const L = Array.isArray(hb.lots) && hb.lots.length ? hb.lots : (hb.cost && hb.date ? [{ d: hb.date, q: hb.qty, c: hb.cost }] : []);
    L.forEach((l) => T.push({ k: 'buy', sym: s.sym, d: l.d, q: l.o ?? l.q, p: l.c }));
  });
  (App.sales || []).forEach((s, i) => T.push({ k: 'sell', sym: s.sym, d: s.d, q: s.q, p: s.p, i, pl: s.cost ? s.q * (s.p - s.cost) - (s.fee || 0) : null, id: s.id || 0 }));
  if (!T.length) return '';
  T.sort((a, b) => (b.d || '').localeCompare(a.d || '') || (b.id || 0) - (a.id || 0) || (a.k === 'sell' ? -1 : 1));
  const row = (t) => `<div class="tx-row"><span class="tx-k ${t.k}">${t.k === 'buy' ? 'BELI' : 'JUAL'}</span>
    <span class="tx-m"><a href="#/s/${encodeURIComponent(t.sym)}"><b>${esc(t.sym)}</b></a> ${fq(t.q)} × ${fmt.usd(t.p)}<div class="faint small">${fmt.date(t.d)} · ${fmt.usd(t.q * t.p, 2)}</div></span>
    <span class="tx-r">${t.k === 'sell' && t.pl != null ? `<b class="${cls(t.pl)}">${t.pl >= 0 ? '+' : '−'}${fmt.usd(Math.abs(t.pl), 2)}</b>` : ''}${t.k === 'sell' ? `<button class="cmp-x" data-undosale="${t.i}" title="Batalkan penjualan (lembar dikembalikan)">↶</button>` : ''}</span></div>`;
  const first = T.slice(0, 8), rest = T.slice(8);
  const realized = (App.sales || []).reduce((a, s) => a + (s.cost ? s.q * (s.p - s.cost) - (s.fee || 0) : 0), 0);
  return `<div class="card card-pad" style="margin-top:12px" id="txCard">
    <div class="section-head" style="margin-bottom:6px;align-items:center"><h3 class="card-title" style="margin:0">Riwayat transaksi</h3>${(App.sales || []).length ? `<span class="small">Untung/rugi terealisasi <b class="${cls(realized)}">${realized >= 0 ? '+' : '−'}${fmt.usd(Math.abs(realized), 2)}</b></span>` : ''}</div>
    ${first.map(row).join('')}
    ${rest.length ? `<details><summary class="small">Tampilkan ${rest.length} transaksi lainnya</summary>${rest.map(row).join('')}</details>` : ''}
    <p class="small faint" style="margin:6px 0 0">Isi transaksi lama berurutan dari yang paling awal agar harga rata-rata benar. ✎ Ubah data mengganti catatan pembelian per transaksi dengan satu angka rata-rata. ↶ membatalkan penjualan dan mengembalikan lembarnya.</p>
  </div>`;
}
function bindTx(el) {
  $$('[data-trade]').forEach((b) => { b.onclick = () => { const [m, sym] = b.dataset.trade.split(':'); openTrade(sym, m, el); }; });
  // satu saham dari rekomendasi sudah dibeli → catat yang itu saja
  $$('[data-recbuy]').forEach((b) => { b.onclick = () => { const [sym, q, p, c] = b.dataset.recbuy.split(':'); openTrade(sym, 'buy', el, { q: +q || '', p: +p || '', cash: c !== '0' }); }; });
  $$('[data-undosale]').forEach((b) => { b.onclick = () => { if (undoSale(+b.dataset.undosale)) { const y = window.scrollY; renderPorto(el); window.scrollTo(0, y); } }; });
}

/* ------------------------------------------------------------ SALDO (kas belum diinvestasikan) */
function cashCfg() { const c = (App.notify && App.notify.cash) || {}; return { usd: Math.max(0, Number(c.usd) || 0), set: c.usd != null, at: c.at || null }; }
function setCash(v) { setNotifyKey('cash', { usd: Math.max(0, Math.round((Number(v) || 0) * 100) / 100), at: new Date().toISOString().slice(0, 10) }); }
/** ubah saldo sebesar d (USD); mengembalikan perubahan yang benar-benar terjadi (saldo tidak bisa minus) */
function adjCash(d) {
  const C = cashCfg();
  if (!C.set || !d) return 0;
  const n = Math.max(0, C.usd + d);
  setCash(n);
  return Math.round((n - C.usd) * 100) / 100;
}
const DEPLOY = { Agresif: 1, Bertahap: 0.5, 'Hati-hati': 0.25, 'Tahan kas': 0.1 };
function cashCard(rows, stockVal) {
  const C = cashCfg(), K = idrNow();
  const T = typeof timing === 'function' && App.dunia ? timing() : null;
  const all = store.get('cashAll', false);
  const frac = all || !T ? 1 : DEPLOY[T.label] ?? 1;
  const use = C.usd * frac;
  const P = use >= 1 && typeof buyPlan === 'function' ? buyPlan(rows, use) : null;
  const totAll = stockVal + C.usd;
  const PF = typeof prof === 'function' ? prof() : null;
  return `<div class="card card-pad" style="margin-top:12px" id="cashCard">
    <div class="section-head" style="margin-bottom:6px;align-items:center;flex-wrap:wrap"><h3 class="card-title" style="margin:0">💵 Saldo &amp; rekomendasi beli</h3>${P && P.orders.length ? '<button class="btn" id="cashCopy">Salin</button>' : ''}</div>
    <p class="small muted" style="margin:0 0 10px">Saldo dolar di ${esc(brokerCfg().n)} yang belum dibelikan saham. Ikut dihitung di total portofolio, dan otomatis berkurang saat <b>Beli</b> / bertambah saat <b>Jual</b>.</p>
    <div class="reb-opts"><label>Saldo $ <input id="cashIn" type="number" min="0" step="any" inputmode="decimal" value="${C.set ? C.usd : ''}" placeholder="mis. 250"></label>
      <span class="small faint">${C.set ? `≈ ${rp(C.usd * K.v)}${C.at ? ` · diperbarui ${fmt.date(C.at)}` : ''}` : 'isi sesuai saldo USD di aplikasi broker'}</span></div>
    ${C.set && C.usd > 0 ? `<div class="kv k3" style="margin:10px 0">
      <div><div class="l">Total portofolio</div><div class="v">${fmt.usd(totAll, 0)}</div><div class="s">${rp(totAll * K.v)}</div></div>
      <div><div class="l">Porsi kas</div><div class="v">${Math.round((C.usd / (totAll || 1)) * 100)}%</div><div class="s">saham ${fmt.usd(stockVal, 0)}</div></div>
      <div><div class="l">Saran dipakai sekarang</div><div class="v">${fmt.usd(use, 0)}</div><div class="s">${frac < 1 ? `${Math.round(frac * 100)}% saldo · sisanya bertahap` : 'seluruh saldo'}</div></div>
    </div>
    ${T ? `<p class="small" style="margin:0 0 8px">🌍 <a class="link" href="#/dunia">Waktu masuk <b style="color:${timingColor(T.label)}">${T.label}</b></a> (skor ${Math.round(T.score)}) — ${frac < 1 ? `pakai ${Math.round(frac * 100)}% saldo dulu, sisanya masuk bertahap tiap 2–4 minggu atau saat skor naik.` : 'kondisi mendukung untuk memakai saldo.'} <label class="chk" style="display:inline-flex"><input type="checkbox" id="cashAll" ${all ? 'checked' : ''}> pakai semua saldo</label></p>` : ''}
    ${P && P.orders.length ? `<div class="cmp-scroll"><table class="hold-table">
      <tr><th>Saham</th><th class="r">Beli</th><th class="r">Lembar</th><th class="r">Bobot</th></tr>
      ${P.orders.map((o) => `<tr><td><a href="#/s/${encodeURIComponent(o.s.sym)}"><b>${esc(o.s.sym)}</b></a> ${o.s.etf ? '' : ratingBadge(o.s.rating)}<div class="small"><b class="up">${o.held ? 'Tambah' : 'Beli baru'}</b> <span class="faint">· ${esc(o.s.sector || '')} · ${fmt.usd(o.s.price)}${o.s.etf ? '' : ` · potensi ${fmt.pct(o.s.val ? o.s.val.upside : null, 0)}`}</span></div><div class="tx-btns"><button class="tx-b buy" data-recbuy="${esc(o.s.sym)}:${o.sh}:${o.s.price}:1">✓ Sudah beli</button>${o.held || typeof noBrkBtn !== 'function' ? '' : noBrkBtn(o.s.sym).replace('class="nobrk"', 'class="nobrk" style="margin-top:0"')}</div></td>
        <td class="r mono"><b>${fmt.usd(o.cost + o.fee, 2)}</b></td>
        <td class="r mono">${fq(o.sh)}</td>
        <td class="r mono">${Math.round(o.wAfter * 100)}%<div class="faint small">target ${Math.round(o.wT * 100)}%</div></td></tr>`).join('')}
    </table></div>
    <p class="small" style="margin:8px 0 0">Total ${fmt.usd(P.orders.reduce((a, o) => a + o.cost + o.fee, 0), 2)} (biaya ${fmt.usd(P.feeTot, 2)})${P.left > 0.5 ? ` · sisa ${fmt.usd(P.left, 2)}` : ''}. Dipilih dari saham yang porsinya paling kurang menurut target profil${PF ? ` <b>${PF.ico} ${PF.n}</b>` : ''} — rekomendasi model, nilai wajar, dan batas bobot ikut diperhitungkan; saham bersaran JUAL tidak ditambah.</p>
    <p class="small faint" style="margin:6px 0 0">Beli sebagian saja? Ketuk <b>✓ Sudah beli</b> di baris saham itu — lembar &amp; harga bisa disesuaikan.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="btn primary" id="cashRec">✓ Semua sudah dibeli — catat &amp; potong saldo</button></div>`
    : `<p class="small muted">${use < 1 ? 'Saldo terlalu kecil untuk dibelikan.' : 'Belum ada saham yang perlu dibeli — semua sudah di atas target.'}</p>`}` : C.set ? '<p class="small muted" style="margin:8px 0 0">Saldo kosong. Saat Anda menjual saham, hasilnya otomatis masuk ke sini.</p>' : ''}
    ${typeof noBrkManage === 'function' ? noBrkManage() : ''}
    <p class="small faint" style="margin:8px 0 0">Saham yang tidak ada di ${esc(brokerCfg().n)}? Ketuk <b>✕ tidak ada di ${esc(brokerCfg().n)}</b> — tidak akan direkomendasikan lagi dan langsung diganti. Rekomendasi dari data model, bukan perintah beli. Harga bergerak — di aplikasi broker beli sesuai <b>nominal dolar</b>.</p>
  </div>`;
}
function bindCash(rows, el) {
  if (!$('#cashCard')) return;
  const rerender = () => { const y = window.scrollY; renderPorto(el); window.scrollTo(0, y); };
  $('#cashIn').onchange = () => { const v = $('#cashIn').value.trim(); if (v === '') setNotifyKey('cash', {}); else setCash(parseFloat(v)); toast('Saldo disimpan'); rerender(); };
  const ca = $('#cashAll'); if (ca) ca.onchange = () => { store.set('cashAll', ca.checked); rerender(); };
  const plan = () => {
    const C = cashCfg(), T = typeof timing === 'function' && App.dunia ? timing() : null;
    const frac = store.get('cashAll', false) || !T ? 1 : DEPLOY[T.label] ?? 1;
    return buyPlan(rows, C.usd * frac);
  };
  const rec = $('#cashRec');
  if (rec) rec.onclick = () => {
    const P = plan();
    if (!P || !P.orders.length) return;
    const tot = P.orders.reduce((a, o) => a + o.cost + o.fee, 0);
    if (!confirm(`Catat pembelian ${P.orders.map((o) => `${o.s.sym} ${fq(o.sh)} lbr`).join(', ')} dan potong saldo ${fmt.usd(tot, 2)}?\n(Sesuaikan lewat ✎ bila lembar/harga di broker berbeda.)`)) return;
    const d = new Date().toISOString().slice(0, 10);
    P.orders.forEach((o) => addPurchase(o.s.sym, o.sh, o.s.price, d));
    saveHoldings();
    adjCash(-tot);
    toast('Pembelian dicatat & saldo dipotong ✓');
    rerender();
  };
  const cp = $('#cashCopy');
  if (cp) cp.onclick = async () => {
    const P = plan();
    if (!P) return;
    const txt = [`Rekomendasi beli dari saldo ${fmt.usd(cashCfg().usd, 2)} (Radar Saham):`].concat(P.orders.map((o) => `- ${o.held ? 'Tambah' : 'Beli'} ${o.s.sym}: ${fmt.usd(o.cost + o.fee, 2)} (~${fq(o.sh)} lbr @ ${fmt.usd(o.s.price)}) → bobot ${Math.round(o.wAfter * 100)}%`)).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Disalin'); } catch (e) { prompt('Salin:', txt); }
  };
}
