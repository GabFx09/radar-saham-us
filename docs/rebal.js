/* =====================================================================
   Radar Saham US — Saran Rebalancing portofolio
   Menghitung target alokasi dari portofolio saat ini + kandidat Buy/Strong Buy:
   batas bobot per saham & sektor, keragaman sektor, keyakinan model, risiko simulasi.
   ===================================================================== */
'use strict';

const REB_DEF = { maxW: 0.25, n: 0, cash: 0, frac: true, keep: false, floor: 0.6, macro: true, regime: false };
function rebOpts() { return Object.assign({}, REB_DEF, { maxW: typeof prof === 'function' ? prof().maxW : REB_DEF.maxW }, store.get('rebal', {})); }

/* ---- profil risiko: mengubah pemilihan kandidat, bobot, batas per saham/sektor, trailing stop, dan porsi saham */
const PROFILES = {
  konservatif: { n: 'Konservatif', ico: '🛡️', maxW: 0.20, addW: 0.15, trail: [0.35, 0.08, 0.22], eqAdj: -0.15, nAdj: 2, sec: 0.30,
    desc: 'Mengutamakan stabilitas: saham berkualitas, volatilitas rendah, dividen. Cocok untuk dana yang dipakai dalam 1–3 tahun atau bila sulit tenang saat pasar turun.' },
  seimbang: { n: 'Seimbang', ico: '⚖️', maxW: 0.25, addW: 0.20, trail: [0.45, 0.10, 0.30], eqAdj: 0, nAdj: 0, sec: 0.35,
    desc: 'Campuran kualitas dan pertumbuhan dengan pengendalian risiko — pengaturan bawaan Radar.' },
  agresif: { n: 'Agresif', ico: '🚀', maxW: 0.30, addW: 0.25, trail: [0.55, 0.15, 0.35], eqAdj: 0.15, nAdj: -1, sec: 0.45,
    desc: 'Mengejar pertumbuhan: potensi naik besar, pertumbuhan & momentum tinggi, aliran dana masuk; menerima saham lebih volatil dan keyakinan nilai wajar lebih rendah. Cocok untuk horizon ≥ 5–10 tahun dan bila siap melihat portofolio turun 30–40% tanpa panik menjual.' },
};
function profileKey() { const k = App.notify && App.notify.profile; return PROFILES[k] ? k : 'seimbang'; }
function prof() { return PROFILES[profileKey()]; }

function conviction(s) {
  const P = profileKey();
  const up = s.val ? s.val.upside : 0;
  const mc = (s.q && s.q.mc) || {};
  const vol = (s.q && s.q.vol) || 0.35;
  if (P === 'agresif') {
    const conf = { Tinggi: 1.1, Sedang: 1, Rendah: 0.8 }[(s.val || {}).confidence] || 0.9;
    const base = Math.max(4, s.score - 50) * (1 + clamp(up || 0, -0.3, 0.8)) * conf * (1 - 0.4 * (mc.p_loss20 || 0.2));
    return base / Math.pow(Math.max(0.15, vol) / 0.3, 0.25);
  }
  const conf = { Tinggi: 1.15, Sedang: 1, Rendah: 0.7 }[(s.val || {}).confidence] || 0.9;
  const base = Math.max(4, s.score - 52) * (1 + clamp(up || 0, -0.3, 0.6)) * conf * (1 - 0.8 * (mc.p_loss20 || 0.2));
  return base / Math.pow(Math.max(0.15, vol) / 0.3, P === 'konservatif' ? 1 : 0.5); // lebih kecil untuk saham sangat volatil
}
function candidateQuality(s) {
  const P = profileKey();
  const up = s.val ? s.val.upside : 0, mc = (s.q && s.q.mc) || {}, f = s.factors || {}, conf = (s.val || {}).confidence;
  if (P === 'agresif') {
    return 0.7 * s.score + 25 * clamp(up || 0, 0, 0.8) + 0.12 * (f.growth ?? 50) + 0.08 * (f.momentum ?? 50) + 0.1 * ((s.flow ?? 50) - 50)
      - 10 * (mc.p_loss20 || 0.2) - (conf === 'Rendah' ? 3 : 0) + (conf === 'Tinggi' ? 2 : 0);
  }
  if (P === 'konservatif') {
    return s.score + 10 * clamp(up || 0, 0, 0.4) - 30 * (mc.p_loss20 || 0.2) + 0.1 * (f.quality ?? 50) + 0.08 * (f.lowvol ?? 50)
      + (conf === 'Tinggi' ? 5 : 0) + ((s.m || {}).div_yield >= 0.02 ? 3 : 0);
  }
  return s.score + 15 * clamp(up || 0, 0, 0.6) - 20 * (mc.p_loss20 || 0.2) + (conf === 'Tinggi' ? 4 : 0);
}
/** Saham yang layak jadi kandidat beli untuk profil aktif. */
function profileEligible(s) {
  if (!(s.rating === 'STRONG BUY' || s.rating === 'BUY') || !s.val) return false;
  const P = profileKey(), conf = s.val.confidence, mc = (s.q && s.q.mc) || {}, vol = (s.q && s.q.vol) || 0.35;
  if (P === 'agresif') return (mc.p_loss20 || 0) < (conf === 'Rendah' ? 0.35 : 0.45); // risiko besar boleh, tapi bukan setengah peluang jatuh 20%
  if (P === 'konservatif') return conf !== 'Rendah' && vol <= 0.45 && (mc.p_loss20 || 0) <= 0.3;
  return conf !== 'Rendah';
}
function profilePicks(n = 8) {
  const held = new Set(App.holdings.map((h) => h.sym));
  return App.data.stocks.filter((s) => profileEligible(s) && !held.has(s.sym)).sort((a, b) => candidateQuality(b) - candidateQuality(a)).slice(0, n);
}
function setProfile(k) {
  App.notify.profile = k;
  store.set('notify', App.notify);
  const o = store.get('rebal', {});
  store.set('rebal', Object.assign(o, { maxW: PROFILES[k].maxW, n: 0 }));
  if (typeof cloudChanged === 'function') cloudChanged();
}
function profileCard() {
  const k = profileKey(), P = PROFILES[k];
  const picks = profilePicks(8);
  const T = typeof timing === 'function' && App.dunia ? timing() : null;
  return `<div class="card card-pad" style="margin-top:12px" id="profCard">
    <h3 class="card-title">Profil Risiko &amp; Rekomendasi</h3>
    <div class="prof-seg">${Object.entries(PROFILES).map(([key, p]) => `<button class="${key === k ? 'on' : ''}" data-prof="${key}">${p.ico} ${p.n}</button>`).join('')}</div>
    <p class="small" style="margin:10px 0 6px">${esc(P.desc)}</p>
    <div class="kv k3" style="margin:6px 0 10px">
      <div><div class="l">Maks per saham</div><div class="v">${Math.round(P.maxW * 100)}%</div></div>
      <div><div class="l">Maks per sektor</div><div class="v">${Math.round(P.sec * 100)}%</div></div>
      <div><div class="l">Trailing stop</div><div class="v">${Math.round(P.trail[1] * 100)}–${Math.round(P.trail[2] * 100)}%</div><div class="s">menyesuaikan volatilitas</div></div>
      ${T ? `<div><div class="l">Porsi saham disarankan</div><div class="v">±${Math.round(T.equity * 100)}%</div><div class="s">rezim ${esc(T.label)}${P.eqAdj ? ` ${P.eqAdj > 0 ? '+' : '−'}${Math.round(Math.abs(P.eqAdj) * 100)}% profil` : ''}</div></div>` : ''}
    </div>
    <div class="mk-label">Rekomendasi teratas untuk profil ${P.n} (selain yang sudah Anda miliki)</div>
    <div class="cmp-scroll"><table class="hold-table"><tr><th>Saham</th><th class="r">Potensi</th><th class="r">Pertumbuhan</th><th class="r">Volatilitas</th><th class="r">Risiko turun 20%</th><th class="r">Aliran dana</th></tr>
      ${picks.map((s) => { const mc = (s.q && s.q.mc) || {}; return `<tr><td><a href="#/s/${encodeURIComponent(s.sym)}"><b>${esc(s.sym)}</b></a> ${ratingBadge(s.rating)}<div class="faint small">${esc(s.sector)} · ${fmt.usd(s.price)} · keyakinan ${esc((s.val || {}).confidence || '–')}</div></td>
        <td class="r mono ${cls(s.val.upside)}">${fmt.pct(s.val.upside, 0)}</td><td class="r mono">${Math.round(s.pillars.growth)}</td>
        <td class="r mono">${s.q && s.q.vol ? Math.round(s.q.vol * 100) + '%' : '–'}</td><td class="r mono ${(mc.p_loss20 || 0) >= 0.35 ? 'down' : ''}">${mc.p_loss20 != null ? Math.round(mc.p_loss20 * 100) + '%' : '–'}</td>
        <td class="r mono" style="color:${scoreColor(s.flow ?? 50)}">${s.flow != null ? Math.round(s.flow) : '–'}</td></tr>`; }).join('')}
    </table></div>
    ${k === 'agresif' ? `<ul class="small muted" style="margin:10px 0 0;padding-left:18px">
      <li>Usia muda = horizon panjang: penurunan 30–40% biasanya sempat pulih, dan waktu adalah keuntungan terbesar Anda.</li>
      <li>Tetap sisihkan <b>dana darurat</b> 3–6 bulan pengeluaran di tabungan/RDPU — jangan di saham.</li>
      <li>Masuk <b>bertahap</b> dan tambah rutin tiap bulan (DCA); jangan memakai utang atau margin.</li>
      <li>Agresif bukan berarti 1–2 saham: tetap 5–7 saham di beberapa sektor, maks ${Math.round(P.maxW * 100)}% per saham.</li></ul>` : ''}
    <p class="small faint" style="margin:8px 0 0">Profil dipakai Saran Rebalancing, Penasihat (trailing stop &amp; batas bobot), dan porsi saham di Waktu Masuk. Tersinkron ke notifikasi bila cloud aktif. Bukan nasihat keuangan pribadi.</p>
  </div>`;
}
function bindProfile(el) {
  const c = $('#profCard');
  if (!c) return;
  c.querySelectorAll('[data-prof]').forEach((b) => { b.onclick = () => { setProfile(b.dataset.prof); const y = window.scrollY; renderPorto(el); window.scrollTo(0, y); toast('Profil ' + PROFILES[b.dataset.prof].n + ' dipakai'); }; });
}/** Pilihan Teratas di Beranda: Strong Buy dulu, lalu skor tertinggi. */
function homePicks(n = 8) {
  return App.data.stocks.filter((s) => s.rating === 'STRONG BUY' || s.rating === 'BUY')
    .sort((a, b) => (b.rating === 'STRONG BUY') - (a.rating === 'STRONG BUY') || b.score - a.score).slice(0, n);
}
/** Alasan saham Pilihan Teratas tidak masuk rencana rebalancing. */
function whyNotPicked(sel, N, opt) {
  const inSel = new Set(sel.map((x) => x.s.sym));
  return homePicks().filter((s) => !inSel.has(s.sym)).map((s) => {
    const mc = (s.q && s.q.mc) || {}, conf = (s.val || {}).confidence;
    const risk = (mc.p_loss20 || 0) >= 0.3 ? ` · peluang turun 20% dalam simulasi ${Math.round(mc.p_loss20 * 100)}%` : '';
    if (App.holdings.some((h) => h.sym === s.sym)) return { s, t: 'sudah Anda miliki, tetapi penasihat menyarankan JUAL' };
    if (!s.val) return { s, t: 'belum ada nilai wajar' };
    if (!profileEligible(s)) return { s, t: (conf === 'Rendah' ? 'keyakinan nilai wajar rendah — perkiraan harga wajarnya kurang bisa diandalkan' : `terlalu berisiko untuk profil ${prof().n}`) + risk };
    const same = sel.find((x) => x.s.sector === s.sector);
    if (same) return { s, t: `sektor ${s.sector} sudah terwakili oleh ${same.s.sym} — diutamakan sektor yang belum Anda punya` };
    return { s, t: `kalah peringkat risiko/imbal hasil dari kandidat terpilih (jumlah saham dibatasi ${N}${opt.n ? '' : ' otomatis sesuai nilai portofolio'})` + risk };
  });
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
  const N = opt.n || Math.max(3, (V < 1500 ? 4 : V < 6000 ? 6 : V < 25000 ? 8 : 10) + prof().nAdj);
  const maxW = Math.max(opt.maxW, 1 / N + 0.02);
  const maxSec = Math.max(prof().sec, maxW + 0.05);
  // 1. kepemilikan: jual bila saran JUAL (kecuali opsi "jangan jual")
  const keep = rows.filter((r) => opt.keep || r.adv.act !== 'JUAL');
  const sel = keep.map((r) => ({ s: r.s, held: r }));
  // 2. kandidat: Buy/Strong Buy, keyakinan bukan Rendah, utamakan sektor baru
  const have = new Set(sel.map((x) => x.s.sym));
  const pool = App.data.stocks.filter((s) => profileEligible(s)
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
  const stOf = (s) => (opt.macro && typeof sectorStance === 'function' ? sectorStance(s) : null);
  const items = sel.map((x) => { const st = stOf(x.s); return { ...x, st, raw: conviction(x.s) * (st ? st.mult : 1) }; });
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
  // porsi kas sesuai rezim (skor Waktu Masuk)
  const T = typeof timing === 'function' && App.dunia ? timing() : null;
  const eq = opt.regime && T ? T.equity : 1; // T.equity sudah memperhitungkan profil
  w = w.map((x) => x * eq);
  const plan = items.map((x, i) => {
    const s = x.s, tv = w[i] * V, cv = x.held ? x.held.val : 0;
    const dv = tv - cv;
    const sh = opt.frac ? Math.round((dv / s.price) * 100) / 100 : Math.trunc(dv / s.price);
    return { s, held: x.held, st: x.st, w: w[i], cw: cv / (cur || 1), tv, cv, dv, sh };
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
  const why = whyNotPicked(sel, N, opt);
  // biaya broker & untung yang direalisasi dari penjualan
  const B = typeof brokerCfg === 'function' ? brokerCfg() : { n: 'broker', fee: 0, fx: 0 };
  const act = plan.filter((p) => p.act !== 'Biarkan');
  const traded = act.reduce((a, p) => a + Math.abs(p.dv), 0);
  const fees = traded * B.fee + (Number(opt.cash) || 0) * B.fx;
  const sells = act.filter((p) => p.held && p.dv < 0);
  const realized = sells.reduce((a, p) => a + (p.held.cost ? Math.min(Math.abs(p.sh), p.held.qty) * (p.s.price - p.held.cost) : 0), 0);
  const cost = { B, traded, fees, realized, nTrades: act.length, sellAmt: sells.reduce((a, p) => a + Math.abs(p.dv), 0) };
  return { V, cur, N, maxW, plan, why, eq, T, cost, cashT: V * (1 - eq), before: stat(plan.filter((p) => p.held), (p) => p.cv), after: stat(plan, (p) => p.tv) };
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
    <p class="small muted" style="margin:0 0 10px">Profil <b>${prof().ico} ${prof().n}</b> · target alokasi ${R.N} saham dari portofolio Anda + kandidat Buy/Strong Buy terbaik, dengan batas ${Math.round(R.maxW * 100)}% per saham dan keragaman sektor. Bobot mengikuti keyakinan model (skor, potensi naik, keyakinan nilai wajar, risiko simulasi, volatilitas).</p>
    <div class="reb-opts">
      <label>Maks/saham <select id="rbW">${[0.15, 0.2, 0.25, 0.3, 0.4].map((v) => `<option value="${v}" ${v === o.maxW ? 'selected' : ''}>${v * 100}%</option>`).join('')}</select></label>
      <label>Jumlah saham <select id="rbN"><option value="0" ${!o.n ? 'selected' : ''}>otomatis</option>${[3, 4, 5, 6, 8, 10, 12].map((v) => `<option value="${v}" ${v === o.n ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Dana tambahan $ <input id="rbC" type="number" min="0" step="50" value="${o.cash || ''}" placeholder="0"></label>
      <label class="chk"><input type="checkbox" id="rbF" ${o.frac ? 'checked' : ''}> pecahan saham</label>
      <label>Saham lama minimal <select id="rbL">${[[0, 'tanpa batas'], [0.4, '40% batas'], [0.6, '60% batas'], [1, '= batas']].map(([v, n]) => `<option value="${v}" ${v === (o.floor ?? 0.6) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" id="rbK" ${o.keep ? 'checked' : ''}> jangan jual yang bersaran JUAL</label>
      <label class="chk" title="Bobot sektor disesuaikan sikap Prakiraan Dunia: Tambah ×1,15 · Hati-hati ×0,85 · Kurangi ×0,65"><input type="checkbox" id="rbM" ${o.macro ? 'checked' : ''}> ikuti sikap makro sektor</label>
      <label class="chk" title="Sisihkan kas sesuai skor Waktu Masuk"><input type="checkbox" id="rbR" ${o.regime ? 'checked' : ''}> sisihkan kas sesuai rezim</label>
    </div>
    ${R.T ? `<p class="small" style="margin:8px 0 0">🌍 <a class="link" href="#/dunia">Waktu masuk: <b style="color:${timingColor(R.T.label)}">${R.T.label}</b></a> (skor ${Math.round(R.T.score)}) — porsi saham disarankan ±${Math.round(R.T.equity * 100)}% dari dana investasi${o.regime ? `; rencana ini menyisihkan <b>${fmt.usd(R.cashT, 0)}</b> sebagai kas` : '; centang "sisihkan kas sesuai rezim" untuk menerapkannya'}. Beli baru sebaiknya bertahap.</p>` : ''}
    <div class="kv k3" style="margin:10px 0">
      ${cmp('Bobot terbesar', R.before.maxw, R.after.maxw, (x) => Math.round(x * 100) + '%', (a, b) => b < a)}
      ${cmp('Jumlah sektor', R.before.secs, R.after.secs, (x) => x, (a, b) => b > a)}
      ${cmp('Beta', R.before.beta, R.after.beta, (x) => x.toFixed(2), (a, b) => Math.abs(b - 1) < Math.abs(a - 1) || b < a)}
      ${cmp('Skor rata-rata', R.before.score, R.after.score, (x) => Math.round(x), (a, b) => b > a)}
      ${cmp('Return harapan 12 bln', R.before.exp, R.after.exp, (x) => fmt.pct(x, 1), (a, b) => b > a)}
      <div><div class="l">Nilai dialokasikan</div><div class="v">${fmt.usd(R.V, 0)}</div><div class="s">${o.cash ? 'termasuk dana tambahan' : 'tanpa dana tambahan'}</div></div>
    </div>
    ${R.cost.nTrades ? `<p class="small" style="margin:0 0 8px">💸 Perkiraan biaya ${esc(R.cost.B.n)}: <b>${fmt.usd(R.cost.fees, 2)}</b> (${R.cost.nTrades} transaksi senilai ${fmt.usd(R.cost.traded, 0)} × ${(R.cost.B.fee * 100).toLocaleString('id-ID')}%${o.cash ? ` + kurs ${(R.cost.B.fx * 100).toLocaleString('id-ID')}% untuk dana tambahan` : ''})${R.cost.realized > 1 ? ` · penjualan merealisasi untung ±<b>${fmt.usd(R.cost.realized, 0)}</b> (catat untuk SPT Tahunan)` : ''}.${R.cost.sellAmt > 0 ? ` Ingin tanpa menjual? <a class="link" href="#dcaCard" onclick="document.getElementById('dcaCard').scrollIntoView({behavior:'smooth'});return false">Rencana DCA</a> menyeimbangkan pelan-pelan lewat pembelian baru.` : ''}</p>` : ''}
    <div class="cmp-scroll"><table class="hold-table">
      <tr><th>Saham</th><th>Aksi</th><th class="r">Sekarang</th><th class="r">Target</th><th class="r">Selisih</th><th class="r">Lembar</th></tr>
      ${R.plan.map((p) => `<tr class="${p.act === 'Biarkan' ? 'faint' : ''}"><td><a href="#/s/${encodeURIComponent(p.s.sym)}"><b>${esc(p.s.sym)}</b></a> ${ratingBadge(p.s.rating)}<div class="faint small">${esc(p.s.sector)} · ${fmt.usd(p.s.price)} · potensi ${fmt.pct(p.s.val ? p.s.val.upside : null, 0)}${p.st && p.st.k !== 'hold' ? ` · 🌍 ${STANCE[p.st.k].n}` : ''}</div></td>
        <td><b class="${p.act === 'Beli baru' || p.act === 'Tambah' ? 'up' : p.act === 'Biarkan' ? 'muted' : 'down'}">${p.act}</b></td>
        <td class="r mono">${Math.round(p.cw * 100)}%</td><td class="r mono"><b>${Math.round(p.w * 100)}%</b></td>
        <td class="r mono ${cls(p.dv)}">${p.dv >= 0 ? '+' : '−'}${fmt.usd(Math.abs(p.dv), 0)}</td><td class="r mono">${shTxt(p)}</td></tr>`).join('')}
    </table></div>
    ${R.why.length ? `<details class="reb-why" open style="margin-top:10px"><summary class="small"><b>Kenapa berbeda dengan Pilihan Teratas di Beranda?</b> (${R.why.length} saham tidak dipilih)</summary>
      <p class="small muted" style="margin:6px 0">Beranda mengurutkan skor tertinggi saja. Rebalancing memilih yang paling cocok <i>untuk portofolio Anda</i>: membuang keyakinan nilai wajar rendah, memperhitungkan risiko turun, dan mendahulukan sektor baru.</p>
      <ul class="small" style="margin:0;padding-left:18px">${R.why.map((x) => `<li><a href="#/s/${encodeURIComponent(x.s.sym)}"><b>${esc(x.s.sym)}</b></a> ${ratingBadge(x.s.rating)} <span class="faint">skor ${Math.round(x.s.score)}</span> — ${esc(x.t)}</li>`).join('')}</ul></details>` : ''}
    <p class="small faint" style="margin:8px 0 0">Jalankan bertahap (mis. 2–3 kali dalam 1–2 minggu); biaya di atas memakai pengaturan broker di kartu Rencana DCA. Setelah transaksi, perbarui jumlah lembar di tabel Kepemilikan agar saran berikutnya akurat. Bukan nasihat keuangan pribadi.</p>
  </div>`;
}
function bindRebalance(rows, el) {
  const c = $('#rebCard');
  if (!c) return;
  const save = () => {
    store.set('rebal', { maxW: parseFloat($('#rbW').value), n: parseInt($('#rbN').value, 10) || 0, cash: parseFloat($('#rbC').value) || 0,
      frac: $('#rbF').checked, keep: $('#rbK').checked, floor: parseFloat($('#rbL').value), macro: $('#rbM').checked, regime: $('#rbR').checked });
    const y = window.scrollY;
    renderPorto(el);
    window.scrollTo(0, y);
  };
  ['#rbW', '#rbN', '#rbF', '#rbK', '#rbL', '#rbM', '#rbR'].forEach((id) => { $(id).onchange = save; });
  $('#rbC').onchange = save;
  $('#rbCopy').onclick = async () => {
    const R = computeRebalance(rows, rebOpts());
    const txt = [`Rencana rebalancing (${App.data.generated.slice(0, 10)}, nilai ${fmt.usd(R.V, 0)}):`].concat(R.plan.filter((p) => p.act !== 'Biarkan').map((p) =>
      `- ${p.act} ${p.s.sym}: ${p.sh > 0 ? 'beli' : 'jual'} ${Math.abs(p.sh)} lbr (~${fmt.usd(Math.abs(p.dv), 0)}) → target ${Math.round(p.w * 100)}%`)).concat(R.eq < 1 ? [`- Sisihkan kas ~${fmt.usd(R.cashT, 0)} (${Math.round((1 - R.eq) * 100)}%) sesuai rezim "${R.T.label}"`] : []).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Rencana disalin'); } catch (e) { prompt('Salin:', txt); }
  };
}
