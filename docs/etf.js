/* =====================================================================
   Radar Saham US — ETF indeks & mode "Inti ETF + Satelit"
   ETF (VOO, QQQ, ...) dimasukkan ke App.bySym sebagai objek khusus (s.etf = true) agar bisa
   dicatat di portofolio, dibandingkan, dan dibeli lewat Rebalancing / Rencana DCA.
   ===================================================================== */
'use strict';

const normCdf = (z) => { // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
};

function setupEtfs(d) {
  App.etfs = (d.etfs || []).map((e) => {
    const beta = /^QQQ/.test(e.sym) ? 1.15 : e.sym === 'SCHD' ? 0.8 : 1;
    const exp = Math.min(0.10, Math.max(0.05, (e.r10y ?? 0.09) * 0.75)); // harapan konservatif: 75% dari rata-rata 10 thn
    const vol = e.vol || 0.16;
    return Object.assign({}, e, {
      etf: true, sector: 'ETF Indeks', industry: 'ETF', rating: 'ETF', score: null, fund: null, tech: null,
      m: { beta, div_yield: e.div }, q: { vol, beta_calc: beta, mc: { exp, p_loss20: normCdf((-0.2 - exp) / vol) } },
      val: null, factors: {}, pillars: {}, div_rate: (e.div || 0) * e.price,
    });
  });
  App.etfs.forEach((e) => { if (!App.bySym[e.sym]) App.bySym[e.sym] = e; });
}

/* ------------------------------------------------------------ pengaturan inti */
const CORE_PCT = { konservatif: 0.7, seimbang: 0.6, agresif: 0.5 };
function coreCfg() {
  const c = Object.assign({ on: false, etf: 'VOO', pct: null }, (App.notify && App.notify.core) || {});
  if (c.pct == null) c.pct = CORE_PCT[typeof profileKey === 'function' ? profileKey() : 'seimbang'] || 0.6;
  if (!App.bySym || !App.bySym[c.etf] || !App.bySym[c.etf].etf) c.on = false; // data ETF belum ada
  return c;
}

function coreCard() {
  const C = coreCfg();
  const list = App.etfs || [];
  if (!list.length) return '';
  const E = App.bySym[C.etf] || list[0];
  const pc = (x) => (x == null ? '–' : fmt.pct(x, 1));
  return `<div class="card card-pad" style="margin-top:12px" id="coreCard">
    <h3 class="card-title">Inti ETF + Satelit</h3>
    <p class="small muted" style="margin:0 0 10px">Sebagian besar dana di <b>ETF indeks</b> (ratusan saham sekaligus, biaya sangat murah) sebagai <i>inti</i>, sisanya di saham pilihan Radar sebagai <i>satelit</i>. Hasilnya mendekati pasar dengan risiko satu-saham jauh lebih kecil, dan pilihan saham Anda tetap bisa menambah hasil. Kebanyakan investor profesional pun kalah dari indeks dalam jangka panjang.</p>
    <div class="reb-opts">
      <label class="chk"><input type="checkbox" id="coreOn" ${C.on ? 'checked' : ''}> aktifkan inti ETF</label>
      <label>ETF <select id="coreEtf">${list.map((e) => `<option value="${e.sym}" ${e.sym === C.etf ? 'selected' : ''}>${e.sym}</option>`).join('')}</select></label>
      <label>Porsi inti <select id="corePct">${[0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((v) => `<option value="${v}" ${Math.abs(v - C.pct) < 1e-9 ? 'selected' : ''}>${v * 100}%</option>`).join('')}</select></label>
    </div>
    <div class="kv k3" style="margin:10px 0">
      <div><div class="l">${esc(E.sym)}</div><div class="v">${fmt.usd(E.price)}</div><div class="s ${cls(E.chg1d)}">${fmt.pct(E.chg1d, 2)} hari ini</div></div>
      <div><div class="l">Rata-rata / thn</div><div class="v">${pc(E.r10y)}</div><div class="s">10 thn · 5 thn ${pc(E.r5y)} · 1 thn ${pc(E.r1y)}</div></div>
      <div><div class="l">Penurunan terdalam</div><div class="v down">${fmt.pct(E.dd, 0)}</div><div class="s">dalam 10 thn · volatilitas ${Math.round((E.vol || 0) * 100)}%/thn</div></div>
    </div>
    <p class="small" style="margin:0">${esc(E.name)} — ${esc(E.desc)}. Biaya tahunan ${(E.er * 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%${E.div ? ` · dividen ±${(E.div * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%/thn` : ''}. <a class="link" href="#/s/${E.sym}">Detail &amp; grafik ›</a></p>
    ${C.on ? `<p class="small up" style="margin:8px 0 0">✓ Aktif: Rebalancing &amp; Rencana DCA menargetkan <b>${Math.round(C.pct * 100)}% ${esc(C.etf)}</b> + ${Math.round((1 - C.pct) * 100)}% saham pilihan profil ${prof().n}.</p>` : `<p class="small faint" style="margin:8px 0 0">Saran porsi inti untuk profil ${prof().n}: ${Math.round((CORE_PCT[profileKey()] || 0.6) * 100)}%. Untuk dana di bawah ±Rp 150 juta, inti ETF membuat diversifikasi jauh lebih mudah daripada membeli 8–10 saham.</p>`}
    <details style="margin-top:8px"><summary class="small"><b>Bandingkan ETF</b></summary>
      <div class="cmp-scroll" style="margin-top:6px"><table class="hold-table"><tr><th>ETF</th><th class="r">10 thn/thn</th><th class="r">5 thn/thn</th><th class="r">Volatilitas</th><th class="r">Turun terdalam</th><th class="r">Biaya</th></tr>
      ${list.map((e) => `<tr><td><a href="#/s/${e.sym}"><b>${e.sym}</b></a><div class="faint small">${esc(e.desc)}</div></td><td class="r mono">${pc(e.r10y)}</td><td class="r mono">${pc(e.r5y)}</td><td class="r mono">${Math.round((e.vol || 0) * 100)}%</td><td class="r mono down">${fmt.pct(e.dd, 0)}</td><td class="r mono">${(e.er * 100).toFixed(2)}%</td></tr>`).join('')}
      </table></div>
      <p class="small faint" style="margin:6px 0 0">QQQM riwayatnya sejak 2020 (isinya sama dengan QQQ). Return masa lalu tidak menjamin masa depan; rasio biaya dari penerbit ETF. Pastikan ETF tersedia di aplikasi broker Anda.</p></details>
  </div>`;
}
function bindCore(el) {
  if (!$('#coreCard')) return;
  const save = () => {
    App.notify.core = { on: $('#coreOn').checked, etf: $('#coreEtf').value, pct: parseFloat($('#corePct').value) };
    store.set('notify', App.notify);
    if (typeof cloudChanged === 'function') cloudChanged();
    const y = window.scrollY; renderPorto(el); window.scrollTo(0, y);
  };
  ['#coreOn', '#coreEtf', '#corePct'].forEach((id) => { $(id).onchange = save; });
}

/* ------------------------------------------------------------ halaman detail ETF */
async function renderEtf(el, e) {
  const pc = (x) => (x == null ? '–' : fmt.pct(x, 1));
  el.innerHTML = `<div class="fade-in">
    <button class="back" onclick="history.length > 1 ? history.back() : (location.hash = '#/')"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>Kembali</button>
    <h1 class="page-title">${esc(e.sym)} <span class="badge r-ETF">ETF</span></h1>
    <p class="page-sub">${esc(e.name)} — ${esc(e.desc)}.</p>
    <div class="cyc-now" style="margin-bottom:12px">
      <div><div class="l">Harga</div><div class="v">${fmt.usd(e.price)}</div><div class="s ${cls(e.chg1d)}">${fmt.pct(e.chg1d, 2)}</div></div>
      <div><div class="l">Rata-rata 10 thn</div><div class="v">${pc(e.r10y)}</div><div class="s">per tahun</div></div>
      <div><div class="l">Turun terdalam</div><div class="v down">${fmt.pct(e.dd, 0)}</div><div class="s">10 thn</div></div>
      <div><div class="l">Biaya tahunan</div><div class="v">${(e.er * 100).toFixed(2)}%</div><div class="s">${e.div ? 'dividen ±' + (e.div * 100).toFixed(1) + '%' : ''}</div></div>
    </div>
    <div class="card card-pad"><h3 class="card-title">Harga 10 tahun</h3><div id="etfChart"><p class="small muted">Memuat…</p></div></div>
    <div class="card card-pad" style="margin-top:12px"><h3 class="card-title">Kenapa ETF indeks?</h3>
      <ul class="small" style="margin:0;padding-left:18px">
        <li>Satu pembelian = ratusan perusahaan; satu saham bangkrut hampir tidak terasa.</li>
        <li>Biaya tahunan sangat kecil (${(e.er * 100).toFixed(2)}%) dan tidak perlu memantau laporan keuangan.</li>
        <li>Cocok sebagai <b>inti</b> portofolio yang dibeli rutin tiap bulan (DCA) — aktifkan di <a class="link" href="#/portofolio?t=rencana">Portofolio → Rencana → Inti ETF + Satelit</a>.</li>
        <li>Tetap bisa turun dalam (${fmt.pct(e.dd, 0)} dalam 10 tahun terakhir) — kuncinya tidak panik menjual.</li>
      </ul></div>
  </div>`;
  try {
    const h = await loadHist(e.sym);
    const c = $('#etfChart');
    if (c && h && h.c) {
      const step = Math.max(1, Math.floor(h.c.length / 500));
      const idx = h.c.map((_, i) => i).filter((i) => i % step === 0 || i === h.c.length - 1);
      c.innerHTML = lineChart([{ v: idx.map((i) => h.c[i]), color: '#0284c7', w: 2 }], { dates: idx.map((i) => h.d[i]), h: 220, fmtY: (v) => '$' + Math.round(v), fmtX: (d) => d.slice(0, 4) });
    }
  } catch (err) { const c = $('#etfChart'); if (c) c.innerHTML = '<p class="small muted">Grafik tidak tersedia.</p>'; }
}
