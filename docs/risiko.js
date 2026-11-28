/* =====================================================================
   Radar Saham US — Manajemen risiko
   1. Ukuran posisi berbasis risiko (halaman saham, kartu Rencana Trading):
      lembar = modal × % risiko ÷ (harga − stop), dibatasi bobot maksimum profil & saldo tunai.
   2. Analisis kebiasaan trading sendiri (Portofolio → Analisis): dari riwayat jual & beli.
   Dipindahkan dari modul RISK & PERF Quant Lab Terminal.
   ===================================================================== */
'use strict';

const RISK_OPTS = [0.5, 1, 1.5, 2];

function riskPct() {
  const v = Number(store.get('riskPct', 1));
  return RISK_OPTS.includes(v) ? v : 1;
}
function idrRate() {
  const mk = App.makro;
  const r = mk && mk.assets && mk.assets.flatMap((g) => g.rows).find((x) => x.sym === 'IDR=X');
  return r ? r.last : null;
}
/** modal = nilai saham di portofolio (harga terakhir) + saldo tunai */
function capitalUsd() {
  const stocks = (App.holdings || []).reduce((a, h) => {
    const s = App.bySym && App.bySym[h.sym];
    const p = (s && s.price) || Number(h.cost) || 0;
    return a + (Number(h.qty) || 0) * p;
  }, 0);
  const cash = typeof cashCfg === 'function' ? cashCfg().usd : 0;
  return { total: stocks + cash, stocks, cash };
}

function posSizeHtml(s) {
  const p = s.plan || {};
  const price = s.price;
  if (!price || !p.stop || p.stop >= price) return '';
  posSizeHtml.cur = s;
  const cap = capitalUsd();
  const rp = riskPct();
  const PF = typeof prof === 'function' ? prof() : { maxW: 0.25 };
  const fee = (typeof brokerCfg === 'function' ? brokerCfg().fee : 0) || 0;
  const idr = idrRate();
  const head = `<div class="ps-head"><b>Ukuran posisi berbasis risiko</b>
    <span class="seg-mini">${RISK_OPTS.map((v) => `<button class="${v === rp ? 'on' : ''}" onclick="setRiskPct(${v},'${esc(s.sym)}')">${String(v).replace('.', ',')}%</button>`).join('')}</span></div>`;
  if (!(cap.total > 0)) {
    return `<div class="possize" id="possize">${head}<p class="small muted" style="margin:6px 0 0">Isi saham di <a class="link" href="#/portofolio">Portofolio</a> (atau saldo tunai) agar aplikasi bisa menghitung berapa lembar yang aman dibeli.</p></div>`;
  }
  const riskPerShare = price - p.stop + price * fee * 2; // turun sampai stop + biaya beli & jual
  const riskUsd = cap.total * rp / 100;
  let q = riskUsd / riskPerShare;
  const capW = cap.total * PF.maxW; // batas bobot per saham dari profil
  const held = (App.holdings || []).find((h) => h.sym === s.sym);
  const heldVal = held ? (Number(held.qty) || 0) * price : 0;
  const room = Math.max(0, capW - heldVal);
  let limit = '';
  if (q * price > room) { q = room / price; limit = `dibatasi bobot maks ${Math.round(PF.maxW * 100)}% per saham (profil ${esc(PF.n || '')})`; }
  if (cap.cash > 0 && q * price * (1 + fee) > cap.cash && !limit) { limit = `melebihi saldo tunai ${fmt.usd(cap.cash, 0)}`; }
  q = Math.floor(q * 100) / 100; // broker AS umumnya mendukung pecahan lembar
  if (q <= 0) {
    return `<div class="possize" id="possize">${head}<p class="small warn-t" style="margin:8px 0 0">⚠ ${esc(s.sym)} sudah ${Math.round(heldVal / cap.total * 100)}% dari portofolio (${fmt.usd(heldVal, 0)} dari modal ${fmt.usd(cap.total, 0)}) — di atas batas ${Math.round(PF.maxW * 100)}% per saham untuk profil ${esc(PF.n || '')}. Sebaiknya <b>tidak menambah</b>; tambahkan modal atau saldo tunai bila ingin membeli lagi.</p></div>`;
  }
  const val = q * price;
  const loss = q * riskPerShare;
  const idrTxt = (x) => (idr ? ` <span class="faint">≈ Rp ${Math.round(x * idr).toLocaleString('id-ID')}</span>` : '');
  const ev = typeof econNext === 'function' ? econNext(24) : [];
  const earnSoon = s.earnings_ts && s.earnings_ts * 1000 > Date.now() && s.earnings_ts * 1000 < Date.now() + 5 * 864e5;
  return `<div class="possize" id="possize">${head}
    <div class="kv k3" style="margin-top:8px">
      <div><div class="l">Beli maksimal</div><div class="v">${q > 0 ? fq2(q) + ' lbr' : '–'}</div><div class="s">${fmt.usd(val, 0)}${idrTxt(val)}</div></div>
      <div><div class="l">Rugi bila kena stop</div><div class="v down">${fmt.usd(loss, 0)}</div><div class="s">${(loss / cap.total * 100).toFixed(1).replace('.', ',')}% modal · termasuk biaya</div></div>
      <div><div class="l">Bobot di portofolio</div><div class="v">${Math.round((val + heldVal) / cap.total * 100)}%</div><div class="s">modal ${fmt.usd(cap.total, 0)}${held ? ' · sudah punya ' + fmt.usd(heldVal, 0) : ''}</div></div>
    </div>
    ${limit ? `<p class="small warn-t" style="margin:6px 0 0">⚠ Jumlah ${limit}.</p>` : ''}
    ${p.target && p.target <= price ? `<p class="small warn-t" style="margin:6px 0 0">⚠ Nilai wajar model (${fmt.usd(p.target)}) di bawah harga sekarang — risiko lebih besar dari potensi naik. Angka di atas hanya batas maksimal, bukan saran membeli.</p>` : ['HINDARI', 'HOLD'].includes(s.rating) ? `<p class="small warn-t" style="margin:6px 0 0">⚠ Rekomendasi model: ${esc(s.rating)} — angka di atas hanya batas maksimal, bukan saran membeli.</p>` : ''}
    ${earnSoon ? `<p class="small warn-t" style="margin:6px 0 0">⚠ Laporan keuangan ${fmt.date(s.earnings_ts * 1000, { weekday: 'short', day: 'numeric', month: 'short' })} — harga bisa melompat melewati stop; pertimbangkan beli separuh dulu.</p>` : ''}
    ${ev.length ? `<p class="small warn-t" style="margin:6px 0 0">⚠ Rilis ekonomi besar ≤ 24 jam: ${ev.map((e) => esc(e.id || e.title)).slice(0, 3).join(', ')} (${econWib(ev[0].t)}).</p>` : ''}
    <p class="small faint" style="margin:6px 0 0">Aturan: bila harga turun ke stop ${fmt.usd(p.stop)}, kerugian hanya ≈ ${String(rp).replace('.', ',')}% dari modal. Dengan risiko 1% per posisi, 10 kali salah beruntun baru memotong modal ±10%. Stop bisa terlewati saat harga gap.</p>
  </div>`;
}
function fq2(n) { return (Number(n) || 0).toLocaleString('id-ID', { maximumFractionDigits: 2 }); }
function setRiskPct(v, sym) {
  store.set('riskPct', v);
  const el = $('#possize'), s = App.bySym && App.bySym[sym];
  const cur = posSizeHtml.cur && posSizeHtml.cur.sym === sym ? posSizeHtml.cur : s;
  if (el && cur) el.outerHTML = posSizeHtml(cur);
}

/* ------------------------------------------------------------ 2. kebiasaan trading */
function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }

function tradeBehaviorCard() {
  const sales = (App.sales || []).filter((x) => x && x.p > 0 && x.cost > 0);
  const holds = App.holdings || [];
  const lotsAll = [];
  holds.forEach((h) => (h.lots || []).forEach((l) => lotsAll.push({ sym: h.sym, ...l })));
  sales.forEach((x) => x.hb && (x.hb.lots || []).forEach((l) => lotsAll.push({ sym: x.sym, ...l })));
  const nTx = sales.length + lotsAll.length;
  if (nTx < 2) return '';

  const firstBuy = (sym) => {
    const ds = lotsAll.filter((l) => l.sym === sym && l.d).map((l) => l.d).sort();
    const h = holds.find((x) => x.sym === sym);
    return ds[0] || (h && h.date) || null;
  };
  // ---- penjualan (realisasi)
  const T = sales.map((x) => {
    const r = x.p / x.cost - 1 - 2 * ((typeof brokerCfg === 'function' ? brokerCfg().fee : 0) || 0);
    const d0 = (x.hb && x.hb.date) || firstBuy(x.sym);
    const s = App.bySym && App.bySym[x.sym];
    return { ...x, r, days: d0 ? Math.max(0, daysBetween(d0, x.d)) : null, after: s && s.price ? s.price / x.p - 1 : null };
  });
  const win = T.filter((t) => t.r > 0), lose = T.filter((t) => t.r <= 0);
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const pl = (t) => t.q * t.p * t.r / (1 + t.r); // laba/rugi USD
  const gross = { w: win.reduce((a, t) => a + pl(t), 0), l: -lose.reduce((a, t) => a + pl(t), 0) };
  const out = [];
  const rows = [];
  if (T.length) {
    rows.push(['Penjualan tercatat', `${T.length}×`, `${win.length} untung · ${lose.length} rugi`]);
    rows.push(['Rata-rata untung / rugi', `${win.length ? fmt.pct(avg(win.map((t) => t.r)), 1) : '–'} / ${lose.length ? fmt.pct(avg(lose.map((t) => t.r)), 1) : '–'}`, 'bersih biaya broker']);
    if (gross.l > 0) rows.push(['Profit factor', (gross.w / gross.l).toFixed(2).replace('.', ','), '> 1,5 sehat · < 1 = rugi bersih']);
    const dw = avg(win.filter((t) => t.days != null).map((t) => t.days)), dl = avg(lose.filter((t) => t.days != null).map((t) => t.days));
    if (dw != null) rows.push(['Lama memegang', `untung ${Math.round(dw)} hr${dl != null ? ` · rugi ${Math.round(dl)} hr` : ''}`, '']);
    // efek disposisi: cepat menjual yang untung, lama menahan yang rugi
    if (dw != null && dl != null && win.length >= 2 && lose.length >= 1 && dl > dw * 1.5) {
      out.push({ s: 'bad', t: `<b>Efek disposisi:</b> saham rugi Anda tahan ${Math.round(dl)} hari, yang untung dijual setelah ${Math.round(dw)} hari. Pola umum yang membuat untung kecil &amp; rugi besar — biarkan pemenang berjalan dengan trailing stop, potong yang rugi sesuai rencana.` });
    }
    // jual terlalu cepat: harga sekarang jauh di atas harga jual
    const early = T.filter((t) => t.r > 0 && t.after != null && t.after > 0.15);
    if (early.length) out.push({ s: 'warn', t: `<b>Terlalu cepat jual?</b> ${early.map((t) => `${esc(t.sym)} (dijual ${fmt.usd(t.p)}, sekarang ${fmt.pct(t.after, 0)})`).join(', ')}. Pertimbangkan jual bertahap (mis. separuh di target 1) daripada sekaligus.` });
    const good = T.filter((t) => t.r < 0 && t.after != null && t.after < -0.1);
    if (good.length) out.push({ s: 'ok', t: `<b>Cut loss yang tepat:</b> ${good.map((t) => `${esc(t.sym)} (turun lagi ${fmt.pct(t.after, 0)} sesudah dijual)`).join(', ')}.` });
  }
  // ---- posisi terbuka: rugi besar yang lama ditahan
  const nowD = new Date().toISOString().slice(0, 10);
  const bag = holds.map((h) => {
    const s = App.bySym && App.bySym[h.sym];
    const d0 = firstBuy(h.sym);
    return s && h.cost ? { sym: h.sym, r: s.price / h.cost - 1, days: d0 ? daysBetween(d0, nowD) : null, rating: s.rating } : null;
  }).filter((x) => x && x.r < -0.15 && x.days != null && x.days > 60);
  if (bag.length) out.push({ s: 'bad', t: `<b>Rugi yang ditahan lama:</b> ${bag.map((x) => `${esc(x.sym)} ${fmt.pct(x.r, 0)} selama ${x.days} hari${x.rating === 'HINDARI' ? ' (model: HINDARI)' : ''}`).join(', ')}. Tanyakan: "kalau belum punya, apakah saya akan membelinya hari ini?"` });
  // ---- rata-rata turun (beli lagi saat harga di bawah rata-rata beli)
  const avgDown = [];
  const bySym = {};
  lotsAll.filter((l) => l.d && l.c > 0).sort((a, b) => a.d.localeCompare(b.d)).forEach((l) => {
    const st = bySym[l.sym] || (bySym[l.sym] = { q: 0, cost: 0 });
    const q = Number(l.o ?? l.q) || 0;
    if (st.q > 0 && l.c < (st.cost / st.q) * 0.95) avgDown.push(l.sym);
    st.q += q; st.cost += q * l.c;
  });
  if (avgDown.length) {
    const ss = [...new Set(avgDown)];
    const bad = ss.filter((x) => (App.bySym[x] || {}).rating === 'HINDARI');
    out.push({ s: bad.length ? 'bad' : 'warn', t: `<b>Rata-rata turun</b> ${avgDown.length}× (${ss.map(esc).join(', ')}). ${bad.length ? `${bad.map(esc).join(', ')} kini berperingkat HINDARI — menambah di saham yang fundamentalnya memburuk memperbesar risiko.` : 'Wajar bila fundamental tetap kuat; batasi agar bobot tidak melebihi batas profil.'}` });
  }
  // ---- frekuensi transaksi
  const d30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const n30 = sales.filter((x) => x.d >= d30).length + lotsAll.filter((l) => l.d && l.d >= d30).length;
  const fees = sales.reduce((a, x) => a + (x.fee || 0), 0);
  rows.push(['Transaksi 30 hari terakhir', `${n30}×`, fees > 0 ? `biaya jual tercatat ${fmt.usd(fees, 2)}` : '']);
  if (n30 >= 12) out.push({ s: 'warn', t: `<b>Sering bertransaksi</b> (${n30}× dalam 30 hari). Untuk investor 6–12 bulan, biaya &amp; keputusan emosional biasanya lebih merugikan daripada manfaatnya.` });
  if (!out.length) out.push({ s: 'ok', t: 'Belum terlihat kebiasaan merugikan dari data yang ada.' });

  const sample = T.length < 5 ? `<p class="small faint" style="margin:8px 0 0">Baru ${T.length} penjualan tercatat — kesimpulan makin bisa dipercaya setelah ±10 transaksi. Catat setiap beli/jual lewat tombol transaksi agar analisis lengkap.</p>` : '';
  return `<div class="card card-pad" style="margin-top:12px">
    <h3 class="card-title"><span class="ico">🪞</span>Kebiasaan Trading Anda</h3>
    <p class="small muted" style="margin:-6px 0 10px">Dari riwayat beli &amp; jual yang tercatat di aplikasi — mencari "kebocoran" yang sering tidak disadari.</p>
    <div class="cmp-scroll"><table class="hold-table">${rows.map(([a, b, c]) => `<tr><td>${a}</td><td class="r mono"><b>${b}</b>${c ? `<div class="faint small">${c}</div>` : ''}</td></tr>`).join('')}</table></div>
    <div class="beh-list">${out.map((o) => `<div class="beh ${o.s}">${o.t}</div>`).join('')}</div>
    ${sample}
  </div>`;
}
