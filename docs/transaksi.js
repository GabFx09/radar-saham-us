/* =====================================================================
   Radar Saham US — Transaksi portofolio: beli tambah, jual (sebagian/semua),
   ubah data, dan riwayat transaksi (dengan pembatalan penjualan).
   Memakai addPurchase (dca.js), recordSale/undoSale (pajak.js).
   ===================================================================== */
'use strict';

const fq = (n) => (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 4 });
const r4 = (n) => Math.round(n * 10000) / 10000;

/** lembar jual/beli: mode 'buy' | 'sell' | 'edit' */
function openTrade(sym, mode, el) {
  const h = App.holdings.find((x) => x.sym === sym);
  if (!h) return;
  const s = App.bySym[sym] || {};
  const B = typeof brokerCfg === 'function' ? brokerCfg() : { fee: 0, n: 'broker' };
  const today = new Date().toISOString().slice(0, 10);
  openSheet(`<div class="sheet-handle"></div>
    <h3 style="margin-bottom:2px">${esc(sym)} <span class="faint small" style="font-weight:400">${esc(s.name || '')}</span></h3>
    <p class="small muted" style="margin:0 0 10px">Dimiliki <b>${fq(h.qty)}</b> lembar${h.cost ? ` · harga beli rata-rata <b>${fmt.usd(h.cost)}</b>` : ''}${s.price ? ` · harga sekarang ${fmt.usd(s.price)}` : ''}</p>
    <nav class="mtabs tx-tabs"><a href="#" data-m="buy">+ Beli tambah</a><a href="#" data-m="sell">− Jual</a><a href="#" data-m="edit">✎ Ubah data</a></nav>
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
        <label>Lembar ${sell ? 'dijual' : 'dibeli'}<input id="tQ" type="number" step="any" min="0" inputmode="decimal" placeholder="mis. ${sell ? fq(h.qty) : '1.5'}" ${sell ? `max="${h.qty}"` : ''}></label>
        <label>Harga ${sell ? 'jual' : 'beli'} per lembar ($)<input id="tP" type="number" step="any" min="0" inputmode="decimal" value="${s.price || ''}"></label>
        <label>Tanggal<input id="tD" type="date" value="${today}" max="${today}"></label></div>
      ${sell ? `<div class="tx-quick">${[[0.25, '25%'], [0.5, '50%'], [0.75, '75%'], [1, 'Semua']].map(([f, n]) => `<button class="chip" data-frac="${f}">${n}</button>`).join('')}</div>` : ''}
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
        const nq = r4(Number(h.qty) + q), nc = h.cost ? (h.qty * h.cost + q * p) / nq : p;
        out.innerHTML = `<div>Total bayar ≈ <b>${fmt.usd(q * p + fee, 2)}</b>${fee ? ` <span class="faint">(termasuk biaya ${fmt.usd(fee, 2)})</span>` : ''}</div>
          <div>Sesudah beli: <b>${fq(nq)}</b> lembar · rata-rata <b>${fmt.usd(nc)}</b>${h.cost ? ` <span class="faint">(sebelumnya ${fmt.usd(h.cost)})</span>` : ''}</div>`;
      }
    };
    $('#tQ').oninput = prev; $('#tP').oninput = prev;
    $$('[data-frac]').forEach((b) => { b.onclick = () => { const f = +b.dataset.frac; $('#tQ').value = f === 1 ? h.qty : r4(h.qty * f); prev(); }; });
    $('#tGo').onclick = () => {
      const q = parseFloat($('#tQ').value), p = parseFloat($('#tP').value), d = $('#tD').value || today;
      if (!(q > 0)) { toast('Isi jumlah lembar'); return; }
      if (!(p > 0)) { toast(`Isi harga ${sell ? 'jual' : 'beli'}`); return; }
      if (sell) {
        if (q >= h.qty - 1e-9 && !confirm(`Jual semua ${fq(h.qty)} lembar ${sym}? ${sym} akan keluar dari portofolio (bisa dibatalkan di Riwayat transaksi).`)) return;
        if (!recordSale(sym, q, p, d)) { toast('Gagal mencatat penjualan'); return; }
        toast(`Terjual ${fq(Math.min(q, h.qty))} lembar ${sym} ✓`);
      } else {
        addPurchase(sym, q, p, d);
        saveHoldings();
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
  $$('[data-undosale]').forEach((b) => { b.onclick = () => { if (undoSale(+b.dataset.undosale)) { const y = window.scrollY; renderPorto(el); window.scrollTo(0, y); } }; });
}
