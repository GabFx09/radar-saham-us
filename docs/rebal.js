/* =====================================================================
   Radar Saham US — Saran Rebalancing portofolio
   Menghitung target alokasi dari portofolio saat ini + kandidat Buy/Strong Buy:
   batas bobot per saham & sektor, keragaman sektor, keyakinan model, risiko simulasi.
   ===================================================================== */
'use strict';

const REB_DEF = { maxW: 0.25, n: 0, cash: 0, frac: true, keep: false, floor: 0.6 };
function rebOpts() { return Object.assign({}, REB_DEF, store.get('rebal', {})); }

function conviction(s) {
  const up = s.val ? s.val.upside : 0;
  const conf = { Tinggi: 1.15, Sedang: 1, Rendah: 0.7 }[(s.val || {}).confidence] || 0.9;
  const mc = (s.q && s.q.mc) || {};
  const base = Math.max(4, s.score - 52) * (1 + clamp(up || 0, -0.3, 0.6)) * conf * (1 - 0.8 * (mc.p_loss20 || 0.2));
  const vol = (s.q && s.q.vol) || 0.35;
  return base / Math.sqrt(Math.max(0.15, vol) / 0.3); // sedikit lebih kecil untuk saham sangat volatil
}
function candidateQuality(s) {
  const up = s.val ? s.val.upside : 0, mc = (s.q && s.q.mc) || {};
  return s.score + 15 * clamp(up || 0, 0, 0.6) - 20 * (mc.p_loss20 || 0.2) + ((s.val || {}).confidence === 'Tinggi' ? 4 : 0);
}
/** Batasi bobot tiap saham <= maxW dan tiap sektor <= maxSec, distribusikan sisa secara proporsional. */
function capWeights(items, maxW, maxSec) {
  let w = items.map((x) => x.raw);
  for (let it = 0; it < 50; it++) {
    const tot = w.reduce((a, b) => a + b, 0) || 1;
    w = w.map((x) => x / tot);
    let changed = false;
    const fixed = new Set();
    w = w.map((x, i) => { if (x > maxW + 1e-9) { changed = true; fixed.add(i); return maxW; } return x; });
    const sec = {};
    items.forEach((x, i) => { sec[x.s.sector] = (sec[x.s.sector] || 0) + w[i]; });
    Object.entries(sec).forEach(([k, v]) => {
      if (v > maxSec + 1e-9) {
        changed = true;
        items.forEach((x, i) => { if (x.s.sector === k) { w[i] *= maxSec / v; fixed.add(i); } });
      }
    });
    const used = w.reduce((a, b, i) => a + (fixed.has(i) ? b : 0), 0);
    const freeTot = w.reduce((a, b, i) => a + (fixed.has(i) ? 0 : b), 0);
    if (!changed || freeTot <= 0) break;
    w = w.map((x, i) => (fixed.has(i) ? x : x / freeTot * Math.max(0, 1 - used)));
  }
  const tot = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((x) => x / tot);
}
function computeRebalance(rows, opt) {
  const cur = rows.reduce((a, r) => a + r.val, 0);
  const V = cur + (Number(opt.cash) || 0);
  if (V <= 0) return null;
  const N = opt.n || (V < 1500 ? 4 : V < 6000 ? 6 : V < 25000 ? 8 : 10);
  const maxW = Math.max(opt.maxW, 1 / N + 0.02);
  const maxSec = Math.max(0.35, maxW + 0.05);
  // 1. kepemilikan: jual bila saran JUAL (kecuali opsi "jangan jual")
  const keep = rows.filter((r) => opt.keep || r.adv.act !== 'JUAL');
  const sel = keep.map((r) => ({ s: r.s, held: r }));
  // 2. kandidat: Buy/Strong Buy, keyakinan bukan Rendah, utamakan sektor baru
  const have = new Set(sel.map((x) => x.s.sym));
  const pool = App.data.stocks.filter((s) => (s.rating === 'STRONG BUY' || s.rating === 'BUY') && s.val && s.val.confidence !== 'Rendah'
    && !have.has(s.sym) && !App.holdings.some((h) => h.sym === s.sym)).sort((a, b) => candidateQuality(b) - candidateQuality(a));
  const secCount = () => sel.reduce((m, x) => ((m[x.s.sector] = (m[x.s.sector] || 0) + 1), m), {});
  while (sel.length < N && pool.length) {
    const sc = secCount();
    let i = pool.findIndex((s) => !sc[s.sector]); // sektor baru dulu
    if (i < 0) i = pool.findIndex((s) => (sc[s.sector] || 0) < 2);
    if (i < 0) break;
    sel.push({ s: pool.splice(i, 1)[0], held: null });
  }
  // 3. bobot target
  const items = sel.map((x) => ({ ...x, raw: conviction(x.s) }));
  let w = capWeights(items, maxW, maxSec);
  // bobot minimal untuk saham lama yang tidak bersaran JUAL (hindari penjualan drastis)
  const floor = Math.min(maxW, (opt.floor ?? 0.6) * maxW);
  if (floor > 0) {
    for (let it = 0; it < 20; it++) {
      const low = items.map((x, i) => x.held && x.held.adv.act !== 'JUAL' && w[i] < floor - 1e-9 && x.held.val / V >= floor * 0.5);
      if (!low.some(Boolean)) break;
      const need = w.reduce((a, x, i) => a + (low[i] ? floor - x : 0), 0);
      const free = w.reduce((a, x, i) => a + (low[i] ? 0 : x), 0);
      if (free <= need) break;
      w = w.map((x, i) => (low[i] ? floor : x * (1 - need / free)));
    }
  }
  const plan = items.map((x, i) => {
    const s = x.s, tv = w[i] * V, cv = x.held ? x.held.val : 0;
    const dv = tv - cv;
    const sh = opt.frac ? Math.round((dv / s.price) * 100) / 100 : Math.trunc(dv / s.price);
    return { s, held: x.held, w: w[i], cw: cv / (cur || 1), tv, cv, dv, sh };
  });
  rows.filter((r) => !sel.some((x) => x.held === r)).forEach((r) => plan.push({ s: r.s, held: r, w: 0, cw: r.val / (cur || 1), tv: 0, cv: r.val, dv: -r.val, sh: -r.qty, sellAll: true }));
  plan.forEach((p) => {
    const rel = p.cv ? p.dv / p.cv : 1;
    p.act = p.sellAll ? 'Jual semua' : !p.held ? 'Beli baru' : Math.abs(p.dv) < Math.max(25, 0.02 * V) ? 'Biarkan' : rel < 0 ? 'Kurangi' : 'Tambah';
  });
  plan.sort((a, b) => b.w - a.w);
  const stat = (arr, wf) => {
    const t = arr.reduce((a, p) => a + wf(p), 0) || 1;
    const beta = arr.reduce((a, p) => a + wf(p) * (((p.s.q || {}).beta_calc) ?? p.s.m.beta ?? 1), 0) / t;
    const exp = arr.reduce((a, p) => a + wf(p) * ((((p.s.q || {}).mc || {}).exp) ?? 0), 0) / t;
    const score = arr.reduce((a, p) => a + wf(p) * p.s.score, 0) / t;
    const secs = new Set(arr.filter((p) => wf(p) > 0).map((p) => p.s.sector)).size;
    const maxw = Math.max(...arr.map((p) => wf(p) / t));
    return { beta, exp, score, secs, maxw };
  };
  return { V, cur, N, maxW, plan, before: stat(plan.filter((p) => p.held), (p) => p.cv), after: stat(plan, (p) => p.tv) };
}

function rebalanceCard(rows) {
  if (!rows.length) return '';
  const o = rebOpts();
  const R = computeRebalance(rows, o);
  if (!R) return '';
  const cmp = (lbl, a, b, f, good) => `<div><div class="l">${lbl}</div><div class="v">${f(a)} → <span class="${good(a, b) ? 'up' : ''}">${f(b)}</span></div></div>`;
  const shTxt = (p) => (p.sh === 0 ? '–' : `${p.sh > 0 ? '+' : '−'}${Math.abs(p.sh).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
  return `<div class="card card-pad" style="margin-top:12px" id="rebCard">
    <div class="section-head" style="margin-bottom:6px;align-items:center;flex-wrap:wrap"><h3 class="card-title" style="margin:0">Saran Rebalancing</h3><button class="btn" id="rbCopy">Salin rencana</button></div>
    <p class="small muted" style="margin:0 0 10px">Target alokasi ${R.N} saham dari portofolio Anda + kandidat Buy/Strong Buy terbaik, dengan batas ${Math.round(R.maxW * 100)}% per saham dan keragaman sektor. Bobot mengikuti keyakinan model (skor, potensi naik, keyakinan nilai wajar, risiko simulasi, volatilitas).</p>
    <div class="reb-opts">
      <label>Maks/saham <select id="rbW">${[0.15, 0.2, 0.25, 0.3, 0.4].map((v) => `<option value="${v}" ${v === o.maxW ? 'selected' : ''}>${v * 100}%</option>`).join('')}</select></label>
      <label>Jumlah saham <select id="rbN"><option value="0" ${!o.n ? 'selected' : ''}>otomatis</option>${[3, 4, 5, 6, 8, 10, 12].map((v) => `<option value="${v}" ${v === o.n ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Dana tambahan $ <input id="rbC" type="number" min="0" step="50" value="${o.cash || ''}" placeholder="0"></label>
      <label class="chk"><input type="checkbox" id="rbF" ${o.frac ? 'checked' : ''}> pecahan saham</label>
      <label>Saham lama minimal <select id="rbL">${[[0, 'tanpa batas'], [0.4, '40% batas'], [0.6, '60% batas'], [1, '= batas']].map(([v, n]) => `<option value="${v}" ${v === (o.floor ?? 0.6) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" id="rbK" ${o.keep ? 'checked' : ''}> jangan jual yang bersaran JUAL</label>
    </div>
    <div class="kv k3" style="margin:10px 0">
      ${cmp('Bobot terbesar', R.before.maxw, R.after.maxw, (x) => Math.round(x * 100) + '%', (a, b) => b < a)}
      ${cmp('Jumlah sektor', R.before.secs, R.after.secs, (x) => x, (a, b) => b > a)}
      ${cmp('Beta', R.before.beta, R.after.beta, (x) => x.toFixed(2), (a, b) => Math.abs(b - 1) < Math.abs(a - 1) || b < a)}
      ${cmp('Skor rata-rata', R.before.score, R.after.score, (x) => Math.round(x), (a, b) => b > a)}
      ${cmp('Return harapan 12 bln', R.before.exp, R.after.exp, (x) => fmt.pct(x, 1), (a, b) => b > a)}
      <div><div class="l">Nilai dialokasikan</div><div class="v">${fmt.usd(R.V, 0)}</div><div class="s">${o.cash ? 'termasuk dana tambahan' : 'tanpa dana tambahan'}</div></div>
    </div>
    <div class="cmp-scroll"><table class="hold-table">
      <tr><th>Saham</th><th>Aksi</th><th class="r">Sekarang</th><th class="r">Target</th><th class="r">Selisih</th><th class="r">Lembar</th></tr>
      ${R.plan.map((p) => `<tr class="${p.act === 'Biarkan' ? 'faint' : ''}"><td><a href="#/s/${encodeURIComponent(p.s.sym)}"><b>${esc(p.s.sym)}</b></a> ${ratingBadge(p.s.rating)}<div class="faint small">${esc(p.s.sector)} · ${fmt.usd(p.s.price)} · potensi ${fmt.pct(p.s.val ? p.s.val.upside : null, 0)}</div></td>
        <td><b class="${p.act === 'Beli baru' || p.act === 'Tambah' ? 'up' : p.act === 'Biarkan' ? 'muted' : 'down'}">${p.act}</b></td>
        <td class="r mono">${Math.round(p.cw * 100)}%</td><td class="r mono"><b>${Math.round(p.w * 100)}%</b></td>
        <td class="r mono ${cls(p.dv)}">${p.dv >= 0 ? '+' : '−'}${fmt.usd(Math.abs(p.dv), 0)}</td><td class="r mono">${shTxt(p)}</td></tr>`).join('')}
    </table></div>
    <p class="small faint" style="margin:8px 0 0">Jalankan bertahap (mis. 2–3 kali dalam 1–2 minggu) dan perhitungkan biaya broker &amp; pajak. Setelah transaksi, perbarui jumlah lembar di tabel Kepemilikan agar saran berikutnya akurat. Bukan nasihat keuangan pribadi.</p>
  </div>`;
}
function bindRebalance(rows, el) {
  const c = $('#rebCard');
  if (!c) return;
  const save = () => {
    store.set('rebal', { maxW: parseFloat($('#rbW').value), n: parseInt($('#rbN').value, 10) || 0, cash: parseFloat($('#rbC').value) || 0,
      frac: $('#rbF').checked, keep: $('#rbK').checked, floor: parseFloat($('#rbL').value) });
    const y = window.scrollY;
    renderPorto(el);
    window.scrollTo(0, y);
  };
  ['#rbW', '#rbN', '#rbF', '#rbK', '#rbL'].forEach((id) => { $(id).onchange = save; });
  $('#rbC').onchange = save;
  $('#rbCopy').onclick = async () => {
    const R = computeRebalance(rows, rebOpts());
    const txt = [`Rencana rebalancing (${App.data.generated.slice(0, 10)}, nilai ${fmt.usd(R.V, 0)}):`].concat(R.plan.filter((p) => p.act !== 'Biarkan').map((p) =>
      `- ${p.act} ${p.s.sym}: ${p.sh > 0 ? 'beli' : 'jual'} ${Math.abs(p.sh)} lbr (~${fmt.usd(Math.abs(p.dv), 0)}) → target ${Math.round(p.w * 100)}%`)).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Rencana disalin'); } catch (e) { prompt('Salin:', txt); }
  };
}
