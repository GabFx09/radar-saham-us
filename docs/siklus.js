/* =====================================================================
   Radar Saham US — Siklus Pasar 100 Tahun (S&P 500 sejak 1927)
   (memakai helper global dari app.js & quant.js)
   ===================================================================== */
'use strict';

App.cyc = null;
async function loadCycles() {
  if (App.cyc) return App.cyc;
  const res = await fetch('data/cycles.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  App.cyc = await res.json();
  return App.cyc;
}

const yrs = (d) => (d / 365.25).toFixed(1).replace('.', ',') + ' thn';
const bln = (d) => Math.round(d / 30.4) + ' bln';
const durTxt = (d) => (d >= 365 ? yrs(d) : bln(d));
const wideW = () => (window.innerWidth >= 900 ? 1000 : 600);

/* ------------------------------------------------------------ grafik batang (positif/negatif) */
function barsSvg(items, o = {}) {
  const W = o.w || 600, H = o.h || 200, L = 40, R = 8, T = 18, B = 34;
  const vals = items.map((x) => x.v ?? 0);
  let hi = Math.max(0, ...vals), lo = Math.min(0, ...vals);
  const pad = (hi - lo) * 0.12 || 0.01; hi += pad; lo -= lo < 0 ? pad : 0;
  const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const bw = (W - L - R) / items.length;
  const step = niceStep((hi - lo) / 4), ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(v);
  const dec = step < 0.01 ? 1 : 0;
  return `<svg viewBox="0 0 ${W} ${H}" class="fanchart" role="img">
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="${Math.abs(v) < 1e-9 ? 'fc-now' : 'fc-grid'}"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" class="fc-ax" text-anchor="end">${(v * 100).toFixed(dec)}%</text>`).join('')}
    ${items.map((it, i) => {
      const v = it.v ?? 0, x0 = L + i * bw + bw * 0.16, w = bw * 0.68;
      const y0 = y(Math.max(0, v)), h = Math.max(1, Math.abs(y(v) - y(0)));
      const col = it.hl ? 'var(--accent-2)' : v >= 0 ? 'var(--up)' : 'var(--down)';
      return `<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${col}" opacity="${it.hl ? 1 : 0.78}"><title>${esc(it.label)}: ${fmt.pct(v, 1)}</title></rect>
        ${o.values !== false ? `<text x="${(x0 + w / 2).toFixed(1)}" y="${(v >= 0 ? y0 - 4 : y0 + h + 11).toFixed(1)}" class="fc-ax" text-anchor="middle" style="font-size:${items.length > 10 ? 9 : 10.5}px;fill:var(--text-2)">${(v * 100).toFixed(1)}</text>` : ''}
        <text x="${(x0 + w / 2).toFixed(1)}" y="${H - 18}" class="fc-ax" text-anchor="middle" style="font-weight:${it.hl ? 800 : 500};fill:${it.hl ? 'var(--accent-2)' : 'var(--text-3)'}">${esc(it.label)}</text>
        ${it.sub ? `<text x="${(x0 + w / 2).toFixed(1)}" y="${H - 5}" class="fc-ax" text-anchor="middle" style="font-size:9.5px">${esc(it.sub)}</text>` : ''}`;
    }).join('')}
  </svg>`;
}

/* ------------------------------------------------------------ grafik 100 tahun (skala log) */
function centuryChart(c) {
  const S = c.trend.series, W = wideW(), H = 280, L = 46, R = 10, T = 10, B = 24;
  const lv = S.flatMap((r) => [Math.log(r[1]), Math.log(r[2])]);
  const lo = Math.min(...lv) - 0.1, hi = Math.max(...lv) + 0.1;
  const t0 = new Date(S[0][0] + '-01').getTime(), t1 = new Date(S[S.length - 1][0] + '-01').getTime();
  const xd = (d) => L + ((new Date(d).getTime() - t0) / (t1 - t0)) * (W - L - R);
  const x = (i) => xd(S[i][0] + '-01');
  const y = (v) => T + ((hi - Math.log(v)) / (hi - lo)) * (H - T - B);
  const bears = c.regimes.list.filter((r) => r.type === 'bear');
  const ticks = [10, 100, 1000, 10000].filter((v) => Math.log(v) > lo && Math.log(v) < hi);
  const path = (k) => 'M' + S.map((r, i) => `${x(i).toFixed(1)} ${y(r[k]).toFixed(1)}`).join('L');
  return `<svg viewBox="0 0 ${W} ${H}" class="fanchart" role="img" aria-label="S&P 500 sejak 1927, skala log">
    ${bears.map((b) => `<rect x="${xd(b.start).toFixed(1)}" y="${T}" width="${Math.max(1, xd(b.end) - xd(b.start)).toFixed(1)}" height="${H - T - B}" fill="var(--down)" opacity=".13"/>`).join('')}
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="fc-grid"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" class="fc-ax" text-anchor="end">${v.toLocaleString('id-ID')}</text>`).join('')}
    ${[1930, 1950, 1970, 1990, 2010].map((yr) => `<text x="${xd(yr + '-01-01').toFixed(1)}" y="${H - 6}" class="fc-ax" text-anchor="middle">${yr}</text>`).join('')}
    <path d="${path(2)}" fill="none" stroke="var(--text-3)" stroke-width="1.4" stroke-dasharray="5 4"/>
    <path d="${path(1)}" fill="none" stroke="var(--accent-2)" stroke-width="1.8" stroke-linejoin="round"/>
  </svg>`;
}

/* ------------------------------------------------------------ jalur siklus presiden 48 bulan */
function presPathChart(c) {
  const P = c.pres_path, A = c.pres_path_avg, W = wideW(), H = 220, L = 42, R = 10, T = 12, B = 26;
  const all = P.concat(A, [0]);
  const lo = Math.min(...all) - 0.02, hi = Math.max(...all) + 0.03;
  const x = (i) => L + ((i + 1) / 48) * (W - L - R);
  const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const now = c.pres_now.month_idx;
  const step = niceStep((hi - lo) / 4), ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const line = (arr) => `M${L} ${y(0).toFixed(1)}L` + arr.map((v, i) => `${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('L');
  return `<svg viewBox="0 0 ${W} ${H}" class="fanchart">
    ${[0, 1, 2, 3].map((k) => `<rect x="${(L + (k * 12 / 48) * (W - L - R)).toFixed(1)}" y="${T}" width="${((12 / 48) * (W - L - R)).toFixed(1)}" height="${H - T - B}" fill="${k === c.pres_now.k - 1 ? 'var(--accent-2)' : 'transparent'}" opacity=".08"/>
      <text x="${(L + ((k * 12 + 6) / 48) * (W - L - R)).toFixed(1)}" y="${H - 7}" class="fc-ax" text-anchor="middle" style="font-weight:${k === c.pres_now.k - 1 ? 800 : 500}">Tahun ${k + 1}</text>`).join('')}
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="${Math.abs(v) < 1e-9 ? 'fc-now' : 'fc-grid'}"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" class="fc-ax" text-anchor="end">${Math.round(v * 100)}%</text>`).join('')}
    <path d="${line(A)}" fill="none" stroke="var(--text-3)" stroke-width="1.4" stroke-dasharray="4 3"/>
    <path d="${line(P)}" fill="none" stroke="var(--accent-2)" stroke-width="2.4" stroke-linejoin="round"/>
    <line x1="${x(now).toFixed(1)}" x2="${x(now).toFixed(1)}" y1="${T}" y2="${H - B}" stroke="var(--warn)" stroke-width="1.6"/>
    <circle cx="${x(now).toFixed(1)}" cy="${y(P[now]).toFixed(1)}" r="5" fill="var(--warn)"/>
    <text x="${(x(now) + 6).toFixed(1)}" y="${T + 12}" class="fc-lbl" style="fill:var(--warn)">Kini</text>
  </svg>`;
}

function spectrumChart(c) {
  const C = c.spectral.curve.filter((r) => r[0] <= 30), W = 600, H = 170, L = 36, R = 10, T = 10, B = 24;
  const lx = (p) => Math.log(p);
  const x0 = lx(2), x1 = lx(30);
  const x = (p) => L + ((lx(p) - x0) / (x1 - x0)) * (W - L - R);
  const hi = Math.max(...C.map((r) => r[1])) * 1.1;
  const y = (v) => T + ((hi - v) / hi) * (H - T - B);
  return `<svg viewBox="0 0 ${W} ${H}" class="fanchart">
    ${[2, 3, 4, 5, 7, 10, 15, 20, 30].map((p) => `<line x1="${x(p).toFixed(1)}" x2="${x(p).toFixed(1)}" y1="${T}" y2="${H - B}" class="fc-grid"/><text x="${x(p).toFixed(1)}" y="${H - 7}" class="fc-ax" text-anchor="middle">${p}</text>`).join('')}
    <path d="M${C.map((r) => `${x(r[0]).toFixed(1)} ${y(r[1]).toFixed(1)}`).join('L')}" fill="none" stroke="var(--accent-2)" stroke-width="2"/>
    <text x="${L}" y="${T + 8}" class="fc-ax">kekuatan</text><text x="${W - R}" y="${H - B - 4}" class="fc-ax" text-anchor="end">periode (tahun)</text>
  </svg>`;
}

/* ------------------------------------------------------------ tabel statistik */
const winTxt = (w) => (w == null ? '–' : Math.round(w * 100) + '%');
function statCells(st) {
  return `<td class="r mono ${cls(st.avg)}">${fmt.pct(st.avg, 1)}</td><td class="r mono">${winTxt(st.win)}</td>`;
}

/* ------------------------------------------------------------ halaman */
async function renderSiklus(el) {
  el.innerHTML = '<div class="splash"><div class="spinner"></div><p>Memuat 100 tahun data pasar…</p></div>';
  let c;
  try { c = await loadCycles(); } catch (e) {
    el.innerHTML = `<div class="empty"><div class="big-ico">📡</div><b>Data siklus belum tersedia</b><p class="small">${esc(e.message)}</p></div>`;
    return;
  }
  if (parseHash().parts[0] !== 'siklus') return;
  const R = c.regimes, now = c.now, cur = R.current;
  const period = store.get('seasonPeriod', 'since1950');
  const seas = c.seasonal[period];
  const curMonth = new Date(now.date).getMonth();
  const pres = c.presidential;
  const pk = now.pres_k, nk = now.next_pres_k;
  const q5 = c.trend.quintiles;
  const curQ = q5.findIndex((q) => now.trend_dev >= q.dev_lo && now.trend_dev <= q.dev_hi + 1e-9);
  const fwd = c.forward;
  const decNow = new Date(now.date).getFullYear() % 10;

  // ---------- kesimpulan otomatis
  const bullPctLonger = R.current_pct_longer;
  const signals = [];
  if (cur.type === 'bull') signals.push({ s: bullPctLonger < 0.35 ? 'warn' : 'ok', t: `Bull market sejak ${fmt.date(cur.start)} sudah berjalan ${durTxt(cur.days)} (+${Math.round(cur.chg * 100)}%). Hanya ${Math.round(bullPctLonger * 100)}% bull market dalam sejarah bertahan lebih lama — tergolong <b>bull market tua</b>, tapi umur saja bukan pemicu berakhirnya tren.` });
  else signals.push({ s: 'warn', t: `Pasar sedang bear market sejak ${fmt.date(cur.start)} (${fmt.pct(cur.chg, 0)}).` });
  signals.push({ s: pres[pk - 1].avg < 0.06 ? 'warn' : 'ok', t: `${now.date.slice(0, 4)} = <b>${esc(pres[pk - 1].name)}</b> siklus presiden: rata-rata historis ${fmt.pct(pres[pk - 1].avg, 1)} (naik ${winTxt(pres[pk - 1].win)} tahun). Tahun depan = <b>${esc(pres[nk - 1].name)}</b>: rata-rata ${fmt.pct(pres[nk - 1].avg, 1)}, naik ${winTxt(pres[nk - 1].win)} tahun.` });
  if (pk === 2) signals.push({ s: 'ok', t: `Pola terkuat yang ditemukan: dari titik terendah tahun midterm, S&amp;P 500 naik rata-rata <b>${fmt.pct(c.midterm_rally.avg, 0)}</b> dalam 12 bulan — positif di ${Math.round(c.midterm_rally.win * c.midterm_rally.n)} dari ${c.midterm_rally.n} siklus.` });
  const ns = now.season_next3;
  signals.push({ s: ns[0].avg > 0.01 ? 'ok' : 'warn', t: `Musiman: ${ns.map((m) => `${m.m} ${fmt.pct(m.avg, 1)} (naik ${winTxt(m.win)})`).join(' · ')} — periode November–April historis adalah "enam bulan terbaik".` });
  signals.push({ s: now.trend_dev > 0.4 ? 'bad' : now.trend_dev > 0.2 ? 'warn' : 'ok', t: `Harga ${fmt.pct(now.trend_dev, 0)} di atas tren 100 tahun (persentil ${Math.round(now.trend_pct * 100)}). Secara historis, saat pasar berada di kelompok 20% termahal, return 10 tahun berikutnya rata-rata hanya <b>${fmt.pct(q5[4].f10, 1)}/thn</b> vs <b>${fmt.pct(q5[0].f10, 1)}/thn</b> saat termurah.` });

  el.innerHTML = `<div class="fade-in">
    <h1 class="page-title">Siklus Pasar 100 Tahun</h1>
    <p class="page-sub">Pola berulang S&amp;P 500 dari ${c.start.slice(0, 4)} sampai kini — ${Math.round(c.years)} tahun, ${R.bull.n} bull market &amp; ${R.bear.n} bear market. Rata-rata tumbuh ${fmt.pct(c.cagr, 1, false)}/thn (harga saja, tanpa dividen).</p>

    <div class="card card-pad cyc-hero">
      <h3 class="card-title"><span class="ico">🧭</span>Posisi Siklus Saat Ini</h3>
      <div class="cyc-now">
        <div><div class="l">Fase</div><div class="v ${cur.type === 'bull' ? 'up' : 'down'}">${cur.type === 'bull' ? 'Bull market' : 'Bear market'}</div><div class="s">${durTxt(cur.days)} · ${fmt.pct(cur.chg, 0)}</div></div>
        <div><div class="l">Dari rekor</div><div class="v ${cls(now.dd_from_ath)}">${fmt.pct(now.dd_from_ath, 1)}</div><div class="s">rekor ${Number(now.ath).toLocaleString('en-US')}</div></div>
        <div><div class="l">Siklus presiden</div><div class="v">Tahun ${pk}</div><div class="s">${esc(pres[pk - 1].name.replace(/^Tahun \d /, ''))}</div></div>
        <div><div class="l">vs tren 100 thn</div><div class="v ${now.trend_dev > 0.3 ? 'down' : ''}">${fmt.pct(now.trend_dev, 0)}</div><div class="s">persentil ${Math.round(now.trend_pct * 100)}</div></div>
      </div>
      <ul class="cyc-sig">${signals.map((x) => `<li class="${x.s}"><span></span><div>${x.t}</div></li>`).join('')}</ul>
    </div>

    <section class="section card card-pad">
      <h3 class="card-title"><span class="ico">📜</span>S&amp;P 500 Sejak ${c.start.slice(0, 4)} (Skala Log)</h3>
      ${centuryChart(c)}
      <div class="legend"><span><i style="background:var(--accent-2)"></i>S&amp;P 500</span><span><i style="background:var(--text-3)"></i>Tren eksponensial ${fmt.pct(c.trend.cagr, 1, false)}/thn</span><span><i style="background:var(--down);opacity:.35;height:8px"></i>Bear market</span></div>
    </section>

    <section class="section grid-2">
      <div class="card card-pad"><h3 class="card-title"><span class="ico">🐂</span>Bull vs Bear Market</h3>
        <div class="kv">
          <div><div class="l">Bull: durasi median</div><div class="v up">${durTxt(R.bull.med_days)}</div><div class="s">rata-rata ${durTxt(R.bull.avg_days)}</div></div>
          <div><div class="l">Bull: kenaikan median</div><div class="v up">+${Math.round(R.bull.med_chg * 100)}%</div><div class="s">rata-rata +${Math.round(R.bull.avg_chg * 100)}%</div></div>
          <div><div class="l">Bear: durasi median</div><div class="v down">${durTxt(R.bear.med_days)}</div><div class="s">rata-rata ${durTxt(R.bear.avg_days)}</div></div>
          <div><div class="l">Bear: penurunan median</div><div class="v down">${fmt.pct(R.bear.med_chg, 0)}</div><div class="s">rata-rata ${fmt.pct(R.bear.avg_chg, 0)}</div></div>
        </div>
        <p class="small muted" style="margin:12px 0 0">Bull market rata-rata <b>${(R.bull.avg_days / R.bear.avg_days).toFixed(1).replace('.', ',')}× lebih lama</b> dari bear market. Penurunan 20%+ terjadi rata-rata tiap ${(c.years / R.bear.n).toFixed(1).replace('.', ',')} tahun; koreksi 10–20% yang pulih ke rekor: median turun ${fmt.pct(R.corrections.med_depth, 0)} dalam ${bln(R.corrections.med_down_days)}, pulih dalam ${bln(R.corrections.med_rec_days)}.</p>
      </div>
      <div class="card card-pad"><h3 class="card-title"><span class="ico">⏱️</span>Riwayat Bull &amp; Bear (Aturan 20%)</h3>
        <div class="regime-strip">${R.list.map((r) => `<i class="${r.type}${r.ongoing ? ' now' : ''}" style="flex:${Math.max(r.days, 40)}" title="${r.type === 'bull' ? 'Bull' : 'Bear'} ${r.start} → ${r.end}: ${fmt.pct(r.chg, 0)} (${durTxt(r.days)})"></i>`).join('')}</div>
        <div class="range-ends" style="margin-top:4px"><span>${c.start.slice(0, 4)}</span><span>Kini</span></div>
        <div class="cmp-scroll" style="max-height:260px;overflow-y:auto;margin-top:10px"><table class="hold-table">
          <tr><th>Fase</th><th>Mulai</th><th class="r">Durasi</th><th class="r">Perubahan</th></tr>
          ${[...R.list].reverse().slice(0, 16).map((r) => `<tr><td><b class="${r.type === 'bull' ? 'up' : 'down'}">${r.type === 'bull' ? '▲ Bull' : '▼ Bear'}</b>${r.ongoing ? ' <span class="tag">berjalan</span>' : ''}</td><td class="mono small">${r.start.slice(0, 7)}</td><td class="r mono">${durTxt(r.days)}</td><td class="r mono ${cls(r.chg)}">${fmt.pct(r.chg, 0)}</td></tr>`).join('')}
        </table></div>
      </div>
    </section>

    <section class="section card card-pad">
      <h3 class="card-title"><span class="ico">🏛️</span>Siklus Presiden 4 Tahunan</h3>
      <p class="small muted" style="margin:-6px 0 8px">Teori: pemerintah cenderung mengambil kebijakan pahit di awal masa jabatan dan mendorong ekonomi menjelang pemilu.</p>
      ${barsSvg(pres.map((p) => ({ label: 'Tahun ' + p.k, sub: 'naik ' + winTxt(p.win), v: p.avg, hl: p.k === pk })), { h: 190, w: wideW() })}
      <div class="mk-label" style="margin-top:14px">Jalur rata-rata 48 bulan (${c.pres_path_n} masa jabatan)</div>
      ${presPathChart(c)}
      <div class="legend"><span><i style="background:var(--accent-2)"></i>Median</span><span><i style="background:var(--text-3)"></i>Rata-rata</span><span><i style="background:var(--warn)"></i>Posisi sekarang</span></div>
      <div class="cyc-callout"><b>Reli dari dasar tahun midterm:</b> rata-rata <b class="up">${fmt.pct(c.midterm_rally.avg, 0)}</b> dalam 12 bulan, median ${fmt.pct(c.midterm_rally.med, 0)}, positif ${Math.round(c.midterm_rally.win * c.midterm_rally.n)}/${c.midterm_rally.n} kali (satu-satunya gagal: ${c.midterm_rally.list.filter((m) => m.gain < 0).map((m) => m.y).join(', ') || '–'}).
        <div class="chips-wrap" style="margin-top:8px">${c.midterm_rally.list.slice(-10).map((m) => `<span class="tag">${m.y} <b class="${cls(m.gain)}">${fmt.pct(m.gain, 0)}</b></span>`).join('')}</div></div>
    </section>

    <section class="section card card-pad">
      <div class="section-head" style="align-items:center;flex-wrap:wrap"><h3 class="card-title" style="margin:0"><span class="ico">🗓️</span>Pola Musiman Bulanan</h3>
        <div class="seg-mini" id="seasSel">${[['all', 'Semua'], ['since1950', 'Sejak 1950'], ['last30', '30 thn']].map(([k, n]) => `<button data-k="${k}" class="${k === period ? 'on' : ''}">${n}</button>`).join('')}</div></div>
      ${barsSvg(seas.map((m, i) => ({ label: m.m, sub: winTxt(m.win), v: m.avg, hl: i === curMonth })), { h: 210, w: wideW() })}
      <p class="small faint" style="margin:4px 0 12px">Batang = return rata-rata bulan itu; angka bawah = persentase tahun bulan itu naik. Biru = bulan berjalan.</p>
      <div class="kv k3">
        <div><div class="l">Nov–Apr ("6 bulan terbaik")</div><div class="v up">${fmt.pct(c.sell_in_may.winter.avg, 1)}</div><div class="s">naik ${winTxt(c.sell_in_may.winter.win)} tahun</div></div>
        <div><div class="l">Mei–Okt</div><div class="v ${cls(c.sell_in_may.summer.avg)}">${fmt.pct(c.sell_in_may.summer.avg, 1)}</div><div class="s">naik ${winTxt(c.sell_in_may.summer.win)} tahun</div></div>
        <div><div class="l">Reli Sinterklas</div><div class="v up">${fmt.pct(c.santa.avg, 1)}</div><div class="s">5 hari akhir Des + 2 awal Jan · naik ${winTxt(c.santa.win)}</div></div>
        <div><div class="l">Januari naik → sisa tahun</div><div class="v up">${fmt.pct(c.january.up.avg, 1)}</div><div class="s">naik ${winTxt(c.january.up.win)} (${c.january.up.n} thn)</div></div>
        <div><div class="l">Januari turun → sisa tahun</div><div class="v ${cls(c.january.down.avg)}">${fmt.pct(c.january.down.avg, 1)}</div><div class="s">naik ${winTxt(c.january.down.win)} (${c.january.down.n} thn)</div></div>
        <div><div class="l">September</div><div class="v down">${fmt.pct(c.seasonal.all[8].avg, 1)}</div><div class="s">bulan terburuk · naik ${winTxt(c.seasonal.all[8].win)}</div></div>
      </div>
    </section>

    <section class="section grid-2">
      <div class="card card-pad"><h3 class="card-title"><span class="ico">🔟</span>Siklus Dekade</h3>
        <p class="small muted" style="margin:-6px 0 8px">Return rata-rata menurut digit terakhir tahun (mis. 5 = 1955, 1985, 2025).</p>
        ${barsSvg(c.decennial.map((d) => ({ label: "'" + d.d, sub: winTxt(d.win), v: d.avg, hl: d.d === decNow })), { h: 190 })}
        <p class="small faint" style="margin:6px 0 0">Tahun berakhiran 5 terkuat, berakhiran 0–2 &amp; 7 lemah. Sampel hanya ~10 per kelompok — anggap sebagai keingintahuan statistik, bukan sinyal.</p></div>
      <div class="card card-pad"><h3 class="card-title"><span class="ico">⚖️</span>Mean Reversion: Mahal vs Murah</h3>
        <p class="small muted" style="margin:-6px 0 8px">Return tahunan 10 tahun berikutnya menurut jarak harga dari tren 100 tahun (5 kelompok).</p>
        ${barsSvg(q5.map((q, i) => ({ label: ['Termurah', 'Murah', 'Wajar', 'Mahal', 'Termahal'][i], sub: `${Math.round(q.dev_lo * 100)}…${q.dev_hi > 1 ? '' : Math.round(q.dev_hi * 100)}%`, v: q.f10, hl: i === curQ })), { h: 190 })}
        <p class="small faint" style="margin:6px 0 0">Biru = posisi saat ini. Ini pola terkuat secara statistik, tapi waktunya tidak bisa ditebak: pasar bisa tetap mahal bertahun-tahun.</p></div>
    </section>

    <section class="section card card-pad">
      <h3 class="card-title"><span class="ico">🔮</span>Apa yang Terjadi Setelahnya?</h3>
      <p class="small muted" style="margin:-6px 0 8px">Return S&amp;P 500 ke depan berdasarkan kondisi pasar saat itu.</p>
      <div class="cmp-scroll"><table class="hold-table">
        <tr><th>Kondisi</th><th class="r">3 bln</th><th class="r">Naik</th><th class="r">1 thn</th><th class="r">Naik</th><th class="r">3 thn</th></tr>
        ${fwd.map((f) => `<tr${f.key === 'all' ? ' class="base"' : ''}><td>${esc(f.name)}<div class="faint small">${Math.round(f.share * 100)}% hari</div></td>${statCells(f.f3m)}${statCells(f.f1y)}<td class="r mono ${cls(f.f3y.avg)}">${fmt.pct(f.f3y.avg, 0)}</td></tr>`).join('')}
      </table></div>
      <p class="small faint" style="margin:8px 0 0">Temuan: membeli di <b>rekor tertinggi</b> hasilnya hampir sama dengan hari biasa — rekor bukan alasan menunggu. Membeli saat <b>turun 20–30%</b> memberi peluang naik 1 tahun tertinggi. Setelah reli &gt;25% setahun, return berikutnya cenderung lebih rendah.</p>
    </section>

    <section class="section grid-2">
      <div class="card card-pad"><h3 class="card-title"><span class="ico">📉</span>Penurunan Terdalam</h3>
        <div class="cmp-scroll"><table class="hold-table">
          <tr><th>Puncak</th><th class="r">Turun</th><th class="r">Ke dasar</th><th class="r">Pulih</th></tr>
          ${c.drawdowns.slice(0, 10).map((d) => `<tr><td class="mono small">${d.peak.slice(0, 7)}</td><td class="r mono down">${fmt.pct(d.depth, 0)}</td><td class="r mono">${durTxt(d.down_days)}</td><td class="r mono">${d.rec_days == null ? 'belum' : durTxt(d.rec_days)}</td></tr>`).join('')}
        </table></div>
        <p class="small faint" style="margin:8px 0 0">Depresi Besar butuh 25 tahun untuk pulih (harga saja; dengan dividen ±15 tahun). Sejak 1950, penurunan terdalam pulih dalam 0,5–6 tahun.</p></div>
      <div class="card card-pad"><h3 class="card-title"><span class="ico">🔬</span>Adakah Siklus Berperiode Tetap?</h3>
        <p class="small muted" style="margin:-6px 0 8px">Analisis spektral (FFT) atas deviasi harga dari tren, diuji terhadap 300 deret acak "red noise".</p>
        ${spectrumChart(c)}
        <div class="chips-wrap" style="margin-top:8px">${c.spectral.peaks.map((p) => `<span class="tag">~${String(p.years).replace('.', ',')} thn ${p.sig ? '<b class="up">signifikan</b>' : '<span class="faint">tidak signifikan</span>'}</span>`).join('')}</div>
        <p class="small faint" style="margin:8px 0 0">Hasil jujur: ${c.spectral.peaks.some((p) => p.sig) ? 'ada periode yang menonjol, namun' : 'tidak ada'} siklus berperiode tetap (Kitchin ~4 thn, Juglar ~9 thn, Kuznets ~18 thn) yang lolos uji signifikansi 95%. Puncak di ~3,5–4 tahun paling menonjol (≈3–4× noise), sejalan dengan siklus bisnis &amp; pemilu, tapi tidak cukup teratur untuk dijadikan jam penentu waktu.</p></div>
    </section>

    <section class="section card card-pad prose" style="max-width:none">
      <h3 class="card-title"><span class="ico">🧠</span>Ringkasan: Pola yang Benar-Benar Berulang</h3>
      <ol style="padding-left:20px;margin:0">
        <li><b>Tren naik jangka panjang menang.</b> ${fmt.pct(c.cagr, 1, false)}/thn selama ${Math.round(c.years)} tahun; bull market jauh lebih panjang &amp; besar daripada bear market.</li>
        <li><b>Siklus presiden &amp; reli midterm</b> adalah pola kalender paling konsisten: tahun ke-2 lemah, dasar tahun midterm diikuti kenaikan ~${Math.round(c.midterm_rally.avg * 100)}%, tahun ke-3 terkuat.</li>
        <li><b>Musiman:</b> Nov–Apr lebih kuat dari Mei–Okt; September satu-satunya bulan yang lebih sering turun; akhir tahun cenderung positif.</li>
        <li><b>Valuasi relatif tren</b> memprediksi return 10 tahun, tetapi bukan waktu koreksi.</li>
        <li><b>Siklus berperiode tetap tidak ada.</b> Pola bersifat probabilistik, bukan jadwal — gunakan sebagai angin buritan/haluan, bukan sinyal jual-beli tunggal.</li>
      </ol>
    </section>

    <p class="disclaimer">Data: indeks S&amp;P 500 (^GSPC, Yahoo Finance) sejak ${fmt.date(c.start)}, harga tanpa dividen &amp; inflasi. Sebelum 1957 indeks berisi 90 saham. Pola historis tidak menjamin hasil di masa depan; sampel siklus presiden hanya ~24 per kelompok.</p>
  </div>`;

  $('#seasSel').onclick = (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    store.set('seasonPeriod', b.dataset.k);
    const y = window.scrollY;
    renderSiklus(el).then(() => window.scrollTo(0, y));
  };
}

function siklusHomeCard() {
  return `<section class="section"><a class="card card-pad link-card" href="#/siklus"><span class="ico-lg">🔄</span><div><b>Siklus Pasar 100 Tahun</b><div class="small muted">Bull &amp; bear market, siklus presiden, musiman, valuasi vs tren — dan posisi pasar sekarang</div></div><span class="faint">›</span></a></section>`;
}
