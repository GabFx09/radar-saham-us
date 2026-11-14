/* =====================================================================
   Radar Saham US — Kalender & analisis IPO
   ===================================================================== */
'use strict';

App.ipo = null;
async function renderIpo(el) {
  el.innerHTML = '<div class="splash"><div class="spinner"></div><p>MEMUAT KALENDER IPO…</p></div>';
  try {
    if (!App.ipo) { const r = await fetch('data/ipo.json', { cache: 'no-cache' }); if (!r.ok) throw new Error('HTTP ' + r.status); App.ipo = await r.json(); }
  } catch (e) { el.innerHTML = '<div class="empty"><div class="big-ico">🆕</div><b>Data IPO belum tersedia</b><p class="small">Dibuat pada update data harian berikutnya.</p></div>'; return; }
  if (parseHash().parts[0] !== 'ipo') return;
  const I = App.ipo, tab = store.get('ipoTab', 'up'), all = store.get('ipoAll', false);
  const keep = (x) => all || x.type === 'Perusahaan';
  const money = (v) => (v == null ? '–' : v >= 1e9 ? '$' + (v / 1e9).toFixed(1) + ' M' : '$' + Math.round(v / 1e6) + ' jt');
  const rng = (x) => (x.lo && x.hi ? (x.lo === x.hi ? fmt.usd(x.hi) : `$${x.lo}–${x.hi}`) : '–');
  const dd = (d) => (d ? fmt.date(d, { day: 'numeric', month: 'short' }) : 'belum dijadwalkan');
  const st = I.stats;
  const up = (I.upcoming || []).filter(keep);
  const rec = I.recent || [];
  const fl = (I.filed || []).filter(keep);
  let body;
  if (tab === 'up') {
    body = `<div class="cmp-scroll"><table class="hold-table">
      <tr><th>Tanggal</th><th>Perusahaan</th><th class="r">Rentang harga</th><th class="r">Nilai penawaran</th><th>Bursa</th></tr>
      ${up.map((x) => `<tr><td class="mono small">${esc(dd(x.date))}</td><td><b>${esc(x.sym || '—')}</b> ${x.type !== 'Perusahaan' ? `<span class="tag">${esc(x.type)}</span>` : ''}<div class="small muted">${esc(x.name || '')}</div></td>
        <td class="r mono">${rng(x)}</td><td class="r mono">${money(x.amount)}</td><td class="small">${esc(x.exch || '–')}</td></tr>`).join('') || '<tr><td colspan="5" class="faint">Tidak ada jadwal IPO.</td></tr>'}</table></div>`;
  } else if (tab === 'rec') {
    body = `<div class="cmp-scroll"><table class="hold-table">
      <tr><th>IPO</th><th>Perusahaan</th><th class="r">Harga IPO</th><th class="r">Hari-1</th><th class="r">Sejak IPO</th><th class="r">Dari puncak</th><th class="hm">Grafik</th></tr>
      ${rec.map((x) => `<tr><td class="mono small">${esc(dd(x.date))}<div class="faint">${x.days} hr</div></td><td><b>${esc(x.sym)}</b><div class="small muted">${esc(x.name || '')}</div></td>
        <td class="r mono">${fmt.usd(x.price)}<div class="faint small">${money(x.amount)}</div></td><td class="r mono ${cls(x.day1)}">${fmt.pct(x.day1, 0)}</td>
        <td class="r mono ${cls(x.ret)}"><b>${fmt.pct(x.ret, 0)}</b><div class="faint small">${x.last ? fmt.usd(x.last) : ''}</div></td><td class="r mono ${cls(x.dd)}">${fmt.pct(x.dd, 0)}</td>
        <td class="hm">${x.spark ? miniSpark(x.spark, 90, 26) : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="faint">Belum ada data.</td></tr>'}</table></div>`;
  } else {
    body = `<h3 class="card-title" style="margin-top:4px">Lock-up berakhir (45 hari)</h3>
      ${(I.lockups || []).length ? `<div class="cmp-scroll"><table class="hold-table"><tr><th>Tanggal</th><th>Saham</th><th class="r">Sejak IPO</th></tr>
        ${I.lockups.map((x) => `<tr><td class="mono small">${esc(dd(x.date))}</td><td><b>${esc(x.sym)}</b><div class="small muted">${esc(x.name || '')}</div></td><td class="r mono ${cls(x.ret)}">${fmt.pct(x.ret, 0)}</td></tr>`).join('')}</table></div>` : '<p class="small faint">Tidak ada lock-up berakhir dalam 45 hari.</p>'}
      <h3 class="card-title" style="margin-top:16px">Baru mengajukan IPO (S-1)</h3>
      <div class="cmp-scroll"><table class="hold-table"><tr><th>Diajukan</th><th>Perusahaan</th><th class="r">Target dana</th></tr>
        ${fl.map((x) => `<tr><td class="mono small">${esc(dd(x.date))}</td><td><b>${esc(x.sym || '—')}</b><div class="small muted">${esc(x.name || '')}</div></td><td class="r mono">${money(x.amount)}</td></tr>`).join('')}</table></div>`;
  }
  el.innerHTML = `<div class="fade-in">
    <h1 class="page-title">IPO Saham AS</h1>
    <p class="page-sub">Jadwal IPO, kinerja IPO terbaru, berakhirnya lock-up, dan perusahaan yang baru mengajukan IPO · sumber Nasdaq &amp; Yahoo · ${fmt.date(I.generated, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
    ${st ? `<div class="cyc-now" style="margin-bottom:12px">
      <div><div class="l">IPO 200 hari terakhir</div><div class="v">${st.n}</div><div class="s">perusahaan</div></div>
      <div><div class="l">Rata-rata hari pertama</div><div class="v ${cls(st.day1_avg)}">${fmt.pct(st.day1_avg, 1)}</div><div class="s">dari harga IPO</div></div>
      <div><div class="l">Median sejak IPO</div><div class="v ${cls(st.ret_med)}">${fmt.pct(st.ret_med, 1)}</div><div class="s">terbaik ${esc(st.best)} · terburuk ${esc(st.worst)}</div></div>
      <div><div class="l">Masih di atas harga IPO</div><div class="v">${Math.round(st.above_offer * 100)}%</div><div class="s">dari IPO terbaru</div></div>
    </div>` : ''}
    <div class="section-head" style="flex-wrap:wrap;gap:8px;align-items:center">
      <div class="seg-mini" id="ipoTab">${[['up', `Akan IPO (${up.length})`], ['rec', `IPO terbaru (${rec.length})`], ['lock', 'Lock-up & filing']].map(([k, n]) => `<button data-k="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}</div>
      ${tab !== 'rec' ? `<label class="small muted"><input type="checkbox" id="ipoAll" ${all ? 'checked' : ''}> tampilkan SPAC &amp; dana/ETF</label>` : ''}
    </div>
    <div class="card card-pad">${body}</div>
    <div class="card card-pad" style="margin-top:12px"><h3 class="card-title">Yang perlu diketahui sebelum membeli IPO</h3>
      <ul class="cyc-sig">
        <li class="warn"><span></span><div>Investor ritel biasanya baru bisa membeli <b>setelah saham diperdagangkan</b> — harganya sering sudah jauh di atas harga IPO pada hari pertama.</div></li>
        <li class="warn"><span></span><div>Data saat ini: rata-rata naik ${st ? fmt.pct(st.day1_avg, 0) : '–'} di hari pertama, tapi median kinerja sejak IPO ${st ? fmt.pct(st.ret_med, 0) : '–'} dan hanya ${st ? Math.round(st.above_offer * 100) : '–'}% yang masih di atas harga IPO. Riset akademis juga menunjukkan IPO rata-rata tertinggal dari pasar dalam 3 tahun pertama.</div></li>
        <li class="warn"><span></span><div><b>Lock-up</b> (±180 hari) — setelah berakhir, pendiri &amp; investor awal boleh menjual; harga sering tertekan menjelang tanggal ini.</div></li>
        <li class="ok"><span></span><div>Saham IPO belum punya cukup riwayat untuk dinilai model Radar (laporan keuangan, revisi analis, teknikal). Setelah listing dan masuk indeks S&amp;P, saham akan muncul di screener.</div></li>
      </ul></div>
    <p class="disclaimer">Jadwal &amp; rentang harga IPO sering berubah atau ditunda. Bukan ajakan membeli.</p>
  </div>`;
  $('#ipoTab').onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) { store.set('ipoTab', b.dataset.k); renderIpo(el); } };
  const a = $('#ipoAll');
  if (a) a.onchange = () => { store.set('ipoAll', a.checked); renderIpo(el); };
}
