/* =====================================================================
   Radar Saham US — Catatan penjualan & Ringkasan SPT Tahunan (saham AS)
   Harta akhir tahun (harga perolehan dalam rupiah), dividen luar negeri + PPh 24,
   dan keuntungan/kerugian penjualan. Perkiraan untuk membantu mengisi SPT — bukan nasihat pajak.
   ===================================================================== */
'use strict';

App.sales = store.get('sales', []);
function saveSales() { store.set('sales', App.sales); if (typeof cloudChanged === 'function') cloudChanged(); }

function kursAt(d) {
  const h = App.histCache.USDIDR;
  if (!h || !h.d || !d) return null;
  let lo = 0, hi = h.d.length - 1, ans = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (h.d[mid] <= d) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
  return ans >= 0 ? h.c[ans] : h.c[0];
}
/** harga perolehan rata-rata per lembar dalam rupiah (kurs pada tanggal tiap pembelian) */
function costIdrPerShare(r) {
  const L = typeof lotsOf === 'function' ? lotsOf(r) : null;
  if (!L) return null;
  const q = L.reduce((a, l) => a + l.q, 0);
  if (!q) return null;
  return L.reduce((a, l) => a + l.q * l.c * (kursAt(l.d) || idrNow().v), 0) / q;
}

function recordSale(sym, q, p, d) {
  const h = App.holdings.find((x) => x.sym === sym);
  if (!h) return false;
  const q0 = Number(h.qty) || 0;
  q = Math.min(q, q0);
  if (!(q > 0) || !(p > 0)) return false;
  const r = { h, qty: q0, cost: Number(h.cost) || null };
  const B = typeof brokerCfg === 'function' ? brokerCfg() : { fee: 0 };
  App.sales.push({ sym, q, p, d, cost: r.cost, costIdr: costIdrPerShare(r), kurs: kursAt(d) || idrNow().v, fee: Math.round(q * p * B.fee * 100) / 100 });
  const left = Math.round((q0 - q) * 10000) / 10000;
  if (h.lots) h.lots = h.lots.map((l) => ({ ...l, q: Math.round(l.q * (left / q0) * 10000) / 10000 })).filter((l) => l.q > 0);
  h.qty = left;
  if (left <= 1e-6) App.holdings = App.holdings.filter((x) => x !== h);
  saveSales();
  saveHoldings();
  return true;
}

/* ------------------------------------------------------------ ringkasan SPT */
function taxYear() {
  const now = new Date();
  const def = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1; // Okt–Des: tahun berjalan
  const y = Number(store.get('taxYear', def));
  return y || def;
}
function sptData(rows, Y) {
  const K = idrNow().v;
  const ye = `${Y}-12-31`, yb = `${Y}-01-01`;
  const today = new Date().toISOString().slice(0, 10);
  const kEnd = (ye <= today ? kursAt(ye) : null) || K;
  const B = typeof brokerCfg === 'function' ? brokerCfg() : { tax: 0.15 };
  const harta = rows.map((r) => {
    const cIdr = costIdrPerShare(r);
    return { r, cIdr, perolehan: cIdr != null ? cIdr * r.qty : null, perolehanUsd: r.cost ? r.cost * r.qty : null, pasar: r.val * kEnd };
  });
  // dividen: perkiraan = lembar × dividen/thn × bagian tahun dimiliki
  const override = ((App.notify.tax || {})[Y] || {}).div;
  const divRows = rows.filter((r) => r.s.div_rate > 0).map((r) => {
    const start = [r.h.date || yb, yb].sort()[1];
    const frac = start > ye ? 0 : (Date.parse(ye) - Date.parse(start)) / (Date.parse(ye) - Date.parse(yb));
    return { r, gross: r.qty * r.s.div_rate * Math.max(0, Math.min(1, frac)) };
  }).filter((x) => x.gross > 0);
  const divEst = divRows.reduce((a, x) => a + x.gross, 0);
  const divGross = override != null ? override : divEst;
  const divTax = divGross * B.tax;
  const kAvg = K; // rata-rata kurs tahun berjalan ≈ kurs sekarang
  const sales = App.sales.filter((s) => s.d >= yb && s.d <= ye).map((s) => {
    const proceedsIdr = (s.q * s.p - (s.fee || 0)) * (s.kurs || K);
    const costIdr = s.costIdr != null ? s.q * s.costIdr : (s.cost ? s.q * s.cost * (s.kurs || K) : null);
    return { ...s, proceedsIdr, costIdr, gainIdr: costIdr != null ? proceedsIdr - costIdr : null, gainUsd: s.cost ? s.q * (s.p - s.cost) - (s.fee || 0) : null };
  });
  return { Y, K, kEnd, harta, divRows, divEst, divGross, divTax, kAvg, override, sales, B, yearDone: ye <= today };
}

function sptCard(rows) {
  if (!rows.length && !App.sales.length) return '';
  if (!App.histCache.USDIDR) return `<div class="card card-pad" style="margin-top:12px"><h3 class="card-title">🧾 Ringkasan SPT Tahunan</h3><p class="small muted">Memuat kurs historis…</p></div>`;
  const Y = taxYear();
  const D = sptData(rows, Y);
  const totP = D.harta.reduce((a, x) => a + (x.perolehan || 0), 0);
  const totM = D.harta.reduce((a, x) => a + x.pasar, 0);
  const missing = D.harta.filter((x) => x.perolehan == null).map((x) => x.r.s.sym);
  const gain = D.sales.reduce((a, s) => a + (s.gainIdr || 0), 0);
  const years = [...new Set([new Date().getFullYear(), new Date().getFullYear() - 1, ...App.sales.map((s) => +s.d.slice(0, 4))])].sort((a, b) => b - a);
  return `<div class="card card-pad" style="margin-top:12px" id="sptCard">
    <div class="section-head" style="margin-bottom:6px;align-items:center;flex-wrap:wrap"><h3 class="card-title" style="margin:0">🧾 Ringkasan SPT Tahunan</h3><button class="btn" id="sptCopy">Salin</button></div>
    <p class="small muted" style="margin:0 0 8px">Bahan mengisi SPT Tahunan orang pribadi (lapor paling lambat 31 Maret tahun berikutnya). Saham AS di ${esc((typeof brokerCfg === 'function' ? brokerCfg() : {}).n || 'broker')} wajib dicantumkan sebagai <b>harta</b>; dividen &amp; keuntungan penjualan sebagai <b>penghasilan dari luar negeri</b>, dan pajak dividen yang sudah dipotong AS bisa dikreditkan (PPh Pasal 24).</p>
    <div class="reb-opts"><label>Tahun pajak <select id="sptY">${years.map((y) => `<option value="${y}" ${y === Y ? 'selected' : ''}>${y}</option>`).join('')}</select></label></div>
    ${D.yearDone ? '' : `<p class="small warn" style="margin:6px 0 0">Tahun ${Y} belum selesai — angka memakai kepemilikan &amp; kurs hari ini. Buka lagi setelah 31 Desember untuk angka final.</p>`}

    <div class="mk-label" style="margin-top:12px">A. Harta akhir tahun — jenis harta: saham</div>
    <div class="cmp-scroll"><table class="hold-table"><tr><th>Saham</th><th class="r">Lembar</th><th class="r">Harga perolehan</th><th class="r">Nilai pasar 31/12</th></tr>
      ${D.harta.map((x) => `<tr><td><b>${esc(x.r.s.sym)}</b><div class="faint small">${esc(x.r.s.name || '')}</div></td><td class="r mono">${x.r.qty.toLocaleString('id-ID', { maximumFractionDigits: 4 })}</td>
        <td class="r mono">${x.perolehan != null ? `<b>${rp(x.perolehan)}</b><div class="faint small">${fmt.usd(x.perolehanUsd, 2)}</div>` : '<span class="warn small">isi harga &amp; tanggal beli</span>'}</td>
        <td class="r mono">${rp(x.pasar)}</td></tr>`).join('')}
      <tr><td><b>Total</b></td><td></td><td class="r mono"><b>${rp(totP)}</b></td><td class="r mono">${rp(totM)}</td></tr></table></div>
    <p class="small faint" style="margin:4px 0 0">Yang dilaporkan: <b>harga perolehan</b> (rata-rata harga beli × kurs pada tanggal beli). Nilai pasar hanya informasi (kurs ${Math.round(D.kEnd).toLocaleString('id-ID')}).${missing.length ? ` Belum lengkap: ${missing.map(esc).join(', ')}.` : ''}</p>

    <div class="mk-label" style="margin-top:12px">B. Penghasilan dari luar negeri ${Y}</div>
    <div class="kv k3">
      <div><div class="l">Dividen kotor</div><div class="v">${fmt.usd(D.divGross, 2)}</div><div class="s">${rp(D.divGross * D.kAvg)} · ${D.override != null ? 'angka Anda' : 'perkiraan'}</div></div>
      <div><div class="l">Pajak dipotong AS (PPh 24)</div><div class="v">${fmt.usd(D.divTax, 2)}</div><div class="s">${rp(D.divTax * D.kAvg)} · ${Math.round(D.B.tax * 100)}%</div></div>
      <div><div class="l">Untung/rugi penjualan</div><div class="v ${cls(gain)}">${gain >= 0 ? '' : '−'}${rp(Math.abs(gain))}</div><div class="s">${D.sales.length} transaksi jual</div></div>
    </div>
    <div class="reb-opts" style="margin-top:8px"><label>Dividen kotor sebenarnya $ <input id="sptDiv" type="number" step="0.01" min="0" placeholder="${D.divEst.toFixed(2)}" value="${D.override != null ? D.override : ''}"></label><span class="small faint">dari riwayat dividen di aplikasi broker (kosongkan = perkiraan)</span></div>
    ${D.sales.length ? `<div class="cmp-scroll" style="margin-top:8px"><table class="hold-table"><tr><th>Jual</th><th class="r">Hasil</th><th class="r">Perolehan</th><th class="r">U/R</th></tr>
      ${D.sales.map((s, i) => `<tr><td><b>${esc(s.sym)}</b><div class="faint small">${fmt.date(s.d)} · ${s.q} × ${fmt.usd(s.p)} <button class="cmp-x" data-delsale="${App.sales.indexOf(App.sales.find((x) => x.d === s.d && x.sym === s.sym && x.q === s.q))}" title="Hapus catatan">✕</button></div></td>
        <td class="r mono">${rp(s.proceedsIdr)}</td><td class="r mono">${s.costIdr != null ? rp(s.costIdr) : '–'}</td><td class="r mono ${cls(s.gainIdr)}"><b>${s.gainIdr != null ? (s.gainIdr >= 0 ? '' : '−') + rp(Math.abs(s.gainIdr)) : '–'}</b></td></tr>`).join('')}</table></div>` : `<p class="small faint" style="margin:6px 0 0">Belum ada penjualan tercatat di ${Y}. Saat menjual, catat lewat ✎ di tabel Kepemilikan → <b>Catat penjualan</b>.</p>`}
    <details style="margin-top:10px"><summary class="small"><b>Cara mengisinya</b></summary>
      <ol class="small" style="margin:6px 0 0;padding-left:18px">
        <li><b>Daftar harta</b>: tambahkan tiap saham/ETF (jenis harta saham), tahun perolehan, dan nilai <i>harga perolehan</i> di tabel A. Tulis nama broker &amp; jumlah lembar di keterangan.</li>
        <li><b>Penghasilan</b>: dividen kotor (dalam rupiah) dan keuntungan penjualan masuk penghasilan dari luar negeri. Kerugian penjualan tidak mengurangi penghasilan lain.</li>
        <li><b>Kredit pajak luar negeri (PPh 24)</b>: pajak dividen yang sudah dipotong di AS. Simpan riwayat dividen/laporan tahunan dari broker sebagai bukti.</li>
        <li>Kurs: tabel ini memakai kurs pasar; untuk angka resmi pakai <b>kurs pajak (KMK)</b> yang berlaku pada tanggal tersebut — selisihnya biasanya kecil.</li>
      </ol>
      <p class="small faint" style="margin:6px 0 0">Aturan bisa berubah dan ada perbedaan tafsir antar sumber (mis. tarif dividen luar negeri). Untuk kepastian, cek <a class="link" href="https://pajak.go.id/id/artikel/sobat-cuan-ini-cara-laporkan-saham-di-spt-tahunan" target="_blank" rel="noopener">panduan DJP</a> atau tanyakan ke KPP / konsultan pajak. Ini bukan nasihat pajak.</p></details>
  </div>`;
}

function bindSpt(rows, el) {
  if (!$('#sptCard')) return;
  const rerender = () => { const y = window.scrollY; renderPorto(el); window.scrollTo(0, y); };
  $('#sptY').onchange = () => { store.set('taxYear', +$('#sptY').value); rerender(); };
  $('#sptDiv').onchange = () => {
    const Y = taxYear(), v = $('#sptDiv').value.trim();
    const t = Object.assign({}, App.notify.tax || {});
    t[Y] = Object.assign({}, t[Y] || {});
    if (v === '') delete t[Y].div; else t[Y].div = Math.max(0, parseFloat(v) || 0);
    App.notify.tax = t; store.set('notify', App.notify); if (typeof cloudChanged === 'function') cloudChanged();
    rerender();
  };
  $$('[data-delsale]').forEach((b) => { b.onclick = () => {
    const i = +b.dataset.delsale;
    if (i < 0 || !confirm('Hapus catatan penjualan ini? (jumlah lembar di portofolio tidak dikembalikan)')) return;
    App.sales.splice(i, 1); saveSales(); rerender();
  }; });
  $('#sptCopy').onclick = async () => {
    const D = sptData(rows, taxYear());
    const L = [`Ringkasan SPT ${D.Y} — saham AS (${(brokerCfg().n)})`, 'A. Harta (harga perolehan):']
      .concat(D.harta.map((x) => `- ${x.r.s.sym} ${x.r.qty} lembar, perolehan ${x.perolehan != null ? rp(x.perolehan) : '?'} (${x.perolehanUsd != null ? fmt.usd(x.perolehanUsd, 2) : '?'}), beli ${x.r.h.date || '?'}`))
      .concat([`B. Dividen kotor ${fmt.usd(D.divGross, 2)} ≈ ${rp(D.divGross * D.kAvg)}; pajak dipotong AS ${fmt.usd(D.divTax, 2)} ≈ ${rp(D.divTax * D.kAvg)} (PPh 24)`])
      .concat(D.sales.map((s) => `- Jual ${s.sym} ${s.q} lbr ${s.d} @ ${fmt.usd(s.p)}: hasil ${rp(s.proceedsIdr)}, perolehan ${s.costIdr != null ? rp(s.costIdr) : '?'}, untung/rugi ${s.gainIdr != null ? rp(s.gainIdr) : '?'}`));
    try { await navigator.clipboard.writeText(L.join('\n')); toast('Ringkasan SPT disalin'); } catch (e) { prompt('Salin:', L.join('\n')); }
  };
}
