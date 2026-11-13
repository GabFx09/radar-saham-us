/* =====================================================================
   Radar Saham US — Monitor Makro, Heatmap Pasar, Revisi Estimasi
   (memakai helper global dari app.js, quant.js, siklus.js, term.js)
   ===================================================================== */
'use strict';

const fgColor = (v) => scoreColor(v * 0.85 + 10);
const bp = (x) => (x == null ? '–' : `${x >= 0 ? '+' : ''}${Math.round(x * 100)}bp`);

function miniSpark(arr, w = 80, h = 22) {
  if (!arr || arr.length < 2) return '';
  const a = arr.filter((v) => v != null);
  const min = Math.min(...a), max = Math.max(...a), rng = max - min || 1;
  const d = a.map((v, i) => `${i ? 'L' : 'M'}${((i / (a.length - 1)) * w).toFixed(1)} ${(h - 2 - ((v - min) / rng) * (h - 4)).toFixed(1)}`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${a[a.length - 1] >= a[0] ? 'var(--up)' : 'var(--down)'}" stroke-width="1.4" vector-effect="non-scaling-stroke"/></svg>`;
}

function fgGauge(v) {
  const R = 80, cx = 100, cy = 100;
  const pt = (val) => { const a = Math.PI * (1 - clamp(val, 0, 100) / 100); return [cx + R * Math.cos(a), cy - R * Math.sin(a)]; };
  const seg = (a, b) => { const [x1, y1] = pt(a), [x2, y2] = pt(b); return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${fgColor((a + b) / 2)}" stroke-width="16" fill="none" opacity=".85"/>`; };
  const [x, y] = pt(v);
  return `<svg viewBox="0 0 200 112" style="width:100%;max-width:230px;display:block;margin:0 auto">
    ${seg(0, 24.5)}${seg(25.5, 44.5)}${seg(45.5, 54.5)}${seg(55.5, 74.5)}${seg(75.5, 100)}
    <line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--text)" stroke-width="3" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="6" fill="var(--text)"/>
  </svg>`;
}

function lineChart(series, o = {}) {
  // series: [{v:[..], color, dash, axis:'l'|'r'}], labels: dates
  const W = o.w || wideW(), H = o.h || 200, L = 40, R = o.right ? 44 : 10, T = 10, B = 22;
  const n = o.dates.length;
  const x = (i) => L + (i / (n - 1)) * (W - L - R);
  const ax = (axis) => {
    const vals = series.filter((s) => (s.axis || 'l') === axis).flatMap((s) => s.v.filter((v) => v != null));
    let lo = o[axis + 'lo'] ?? Math.min(...vals), hi = o[axis + 'hi'] ?? Math.max(...vals);
    if (o[axis + 'lo'] == null) { const p = (hi - lo) * 0.06 || 1; lo -= p; hi += p; }
    return { lo, hi, y: (v) => T + ((hi - v) / (hi - lo)) * (H - T - B) };
  };
  const A = { l: ax('l') };
  if (series.some((s) => s.axis === 'r')) A.r = ax('r');
  const ticks = (o.lticks || (() => { const st = niceStep((A.l.hi - A.l.lo) / 4), t = []; for (let v = Math.ceil(A.l.lo / st) * st; v <= A.l.hi; v += st) t.push(v); return t; })());
  const bands = (o.bands || []).map(([a, b, col, op]) => {
    const i0 = o.dates.findIndex((d) => d >= a), i1 = o.dates.findIndex((d) => d > b);
    if (i0 < 0) return '';
    const e = i1 < 0 ? n - 1 : i1;
    return `<rect x="${x(i0).toFixed(1)}" y="${T}" width="${Math.max(1.5, x(e) - x(i0)).toFixed(1)}" height="${H - T - B}" fill="${col}" opacity="${op}"/>`;
  }).join('');
  const lbls = (o.xlabels || [0, 0.5, 1]).map((p) => { const i = Math.round(p * (n - 1)); return `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="fc-ax" text-anchor="${p === 0 ? 'start' : p === 1 ? 'end' : 'middle'}">${esc(o.fmtX ? o.fmtX(o.dates[i]) : o.dates[i])}</text>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="fanchart">${bands}
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${A.l.y(v).toFixed(1)}" y2="${A.l.y(v).toFixed(1)}" class="${o.zero != null && Math.abs(v - o.zero) < 1e-9 ? 'fc-now' : 'fc-grid'}"/><text x="${L - 6}" y="${(A.l.y(v) + 4).toFixed(1)}" class="fc-ax" text-anchor="end">${o.fmtY ? o.fmtY(v) : v}</text>`).join('')}
    ${lbls}
    ${series.map((s) => { const Y = A[s.axis || 'l'].y; let d = '', pen = false; s.v.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${Y(v).toFixed(1)}`; pen = true; }); return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.w || 1.8}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''} stroke-linejoin="round"/>`; }).join('')}
  </svg>`;
}

/* ------------------------------------------------------------ MAKRO */
async function renderMakro(el) {
  el.innerHTML = '<div class="splash"><div class="spinner"></div><p>MEMUAT MONITOR MAKRO…</p></div>';
  let mk;
  try { mk = await loadMakro(); } catch (e) {
    el.innerHTML = `<div class="empty"><div class="big-ico">📡</div><b>Data makro belum tersedia</b><p class="small">${esc(e.message)}</p></div>`;
    return;
  }
  if (parseHash().parts[0] !== 'makro') return;
  const fg = mk.fg, cv = mk.curve, rot = mk.rotation || [];

  // ---- Fear & Greed
  const fgHtml = fg ? `<div class="card card-pad">
    <h3 class="card-title">Indeks Fear &amp; Greed (Radar)</h3>
    <div class="fg-wrap">
      <div>${fgGauge(fg.now)}<div class="fg-num" style="color:${fgColor(fg.now)}">${Math.round(fg.now)}</div>
        <div class="fg-lbl" style="color:${fgColor(fg.now)}">${esc(fg.label)}</div>
        <div class="fg-cmp"><span>1 mgg <b>${fg.w1 == null ? '–' : Math.round(fg.w1)}</b></span><span>1 bln <b>${fg.m1 == null ? '–' : Math.round(fg.m1)}</b></span><span>1 thn <b>${fg.y1 == null ? '–' : Math.round(fg.y1)}</b></span></div></div>
      <div class="bars">${fg.components.map((c) => `<div class="bar-row" style="grid-template-columns:minmax(0,1fr) 90px 30px" title="${esc(c.desc)}"><span class="name" style="font-size:12px">${esc(c.name)}<small>${esc(c.label || '')}</small></span><div class="bar"><i style="width:${c.score}%;background:${fgColor(c.score)}"></i></div><span class="v">${Math.round(c.score)}</span></div>`).join('')}</div>
    </div>
    <div class="mk-label" style="margin-top:14px">Riwayat 1 tahun vs S&amp;P 500</div>
    ${lineChart([{ v: fg.hist.map((r) => r[1]), color: 'var(--accent)', w: 2 }, { v: fg.hist.map((r) => r[2]), color: 'var(--text-3)', axis: 'r', dash: '4 3', w: 1.3 }],
      { dates: fg.hist.map((r) => r[0]), llo: 0, lhi: 100, lticks: [0, 25, 50, 75, 100], right: true, h: 180, w: 600, fmtX: (d) => fmt.date(d, { month: 'short', year: '2-digit' }),
        bands: [] })}
    <div class="legend"><span><i style="background:var(--accent)"></i>Fear &amp; Greed (kiri)</span><span><i style="background:var(--text-3)"></i>S&amp;P 500 (kanan)</span></div>
    <table class="hold-table" style="margin-top:10px"><tr><th>Zona (2 thn terakhir)</th><th class="r">Hari</th><th class="r">SPY +1 bln</th><th class="r">SPY +3 bln</th></tr>
      ${fg.stats.map((z) => `<tr><td style="color:${fgColor({ 'Ketakutan Ekstrem': 10, Takut: 35, Netral: 50, Serakah: 65, 'Keserakahan Ekstrem': 90 }[z.zone])}">${esc(z.zone)}</td><td class="r mono">${z.days}</td><td class="r mono ${cls(z.f1m)}">${fmt.pct(z.f1m, 1)}</td><td class="r mono ${cls(z.f3m)}">${fmt.pct(z.f3m, 1)}</td></tr>`).join('')}</table>
    <p class="small faint" style="margin:8px 0 0">Dihitung sendiri dari 7 komponen (momentum, kekuatan &amp; keluasan ${App.data.count} saham, VIX, aset aman, obligasi berisiko, emas), masing-masing dinilai sebagai persentil 1 tahun. Investor kontrarian membeli saat takut, berhati-hati saat serakah.</p>
  </div>` : '';

  // ---- lintas aset
  const val = (r) => r.rate ? r.last.toFixed(3) + '%' : r.last >= 1000 ? r.last.toLocaleString('en-US', { maximumFractionDigits: 0 }) : r.last.toFixed(r.last < 10 ? 4 : 2);
  const ch = (r, k) => `<td class="${cls(r[k])} ${['m3', 'y1'].includes(k) ? 'hm' : ''}">${r.rate ? bp(r[k]) : fmt.pct(r[k], k === 'd1' ? 2 : 1)}</td>`;
  const xaHtml = `<div class="card card-pad">
    <h3 class="card-title">Monitor Lintas Aset</h3>
    <div class="cmp-scroll"><table class="xa-table">
      <tr><th>Aset</th><th>Terakhir</th><th>1H</th><th>1M</th><th>1B</th><th class="hm">3B</th><th>YTD</th><th class="hm">1T</th><th class="hm">90 hari</th></tr>
      ${mk.assets.map((g) => `<tr class="grp"><td colspan="9">${esc(g.name)}</td></tr>` + g.rows.map((r) => `<tr><td class="nm"><b>${esc(r.name)}</b><small>${esc(r.sym)}</small></td><td><b>${val(r)}</b></td>${ch(r, 'd1')}${ch(r, 'w1')}${ch(r, 'm1')}${ch(r, 'm3')}${ch(r, 'ytd')}${ch(r, 'y1')}<td class="sp hm">${miniSpark(r.spark)}</td></tr>`).join('')).join('')}
    </table></div>
    <p class="small faint" style="margin:8px 0 0">Imbal hasil obligasi dalam basis poin (bp). H = hari, M = minggu, B = bulan, T = tahun. USD/IDR naik = rupiah melemah.</p>
  </div>`;

  // ---- kurva yield
  let curveHtml = '';
  if (cv && cv.snap && cv.snap.length) {
    const W = 600, H = 190, L = 40, R = 14, T = 14, B = 26;
    const pts = cv.snap;
    const allv = pts.flatMap((p) => [p.now, p.y1, p.m1]).filter((v) => v != null);
    const lo = Math.min(...allv) - 0.25, hi = Math.max(...allv) + 0.25;
    const lx = (yr) => L + ((Math.log(yr) - Math.log(0.25)) / (Math.log(30) - Math.log(0.25))) * (W - L - R);
    const yy = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
    const ln = (k, col, dash) => `<path d="M${pts.filter((p) => p[k] != null).map((p) => `${lx(p.yrs).toFixed(1)} ${yy(p[k]).toFixed(1)}`).join('L')}" fill="none" stroke="${col}" stroke-width="${dash ? 1.4 : 2.4}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>` +
      pts.filter((p) => p[k] != null).map((p) => `<circle cx="${lx(p.yrs).toFixed(1)}" cy="${yy(p[k]).toFixed(1)}" r="${dash ? 2.5 : 4}" fill="${col}"/>${dash ? '' : `<text x="${lx(p.yrs).toFixed(1)}" y="${(yy(p[k]) - 9).toFixed(1)}" class="fc-ax" text-anchor="middle" style="fill:var(--text);font-weight:700">${p[k].toFixed(2)}</text>`}`).join('');
    const st = niceStep((hi - lo) / 4), tk = [];
    for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) tk.push(v);
    const snapSvg = `<svg viewBox="0 0 ${W} ${H}" class="fanchart">
      ${tk.map((v) => `<line x1="${L}" x2="${W - R}" y1="${yy(v).toFixed(1)}" y2="${yy(v).toFixed(1)}" class="fc-grid"/><text x="${L - 6}" y="${(yy(v) + 4).toFixed(1)}" class="fc-ax" text-anchor="end">${v.toFixed(1)}%</text>`).join('')}
      ${pts.map((p) => `<text x="${lx(p.yrs).toFixed(1)}" y="${H - 7}" class="fc-ax" text-anchor="middle">${p.label}</text>`).join('')}
      ${ln('y1', 'var(--text-3)', '4 3')}${ln('m1', 'var(--accent-2)', '2 3')}${ln('now', 'var(--accent)')}</svg>`;
    const sp = cv.spread_now, inverted = sp != null && sp < 0;
    const leads = (cv.leads || []).filter((l) => l.lead != null);
    const avgLead = leads.length ? Math.round(leads.reduce((a, l) => a + l.lead, 0) / leads.length) : null;
    const li = cv.last_inv;
    let status;
    if (inverted) status = `<b class="down">TERBALIK (INVERSI)</b> — spread 10T–3B ${sp.toFixed(2)} pp. Secara historis inversi mendahului resesi rata-rata ~${avgLead} bulan.`;
    else if (li && li.end && li.months_since_end != null && li.months_since_end <= 24) status = `<b class="warn" style="color:var(--warn)">NORMAL KEMBALI SETELAH INVERSI</b> — kurva terbalik ${li.start} s.d. ${li.end} (${(cv.inversions.at(-1) || {}).months || '?'} bln), kembali positif ${li.months_since_end} bulan lalu. Dalam sejarah, resesi sering dimulai justru setelah kurva kembali normal ("re-steepening"), tapi sinyal ini juga bisa meleset.`;
    else status = `<b class="up">NORMAL</b> — spread 10T–3B ${sp != null ? '+' + sp.toFixed(2) : '–'} pp. Tidak ada sinyal resesi dari kurva yield.`;
    curveHtml = `<div class="card card-pad">
      <h3 class="card-title">Kurva Yield Treasury AS &amp; Sinyal Resesi</h3>
      <p class="small" style="margin:0 0 10px;line-height:1.6">${status}</p>
      ${snapSvg}
      <div class="legend"><span><i style="background:var(--accent)"></i>Sekarang</span><span><i style="background:var(--accent-2)"></i>1 bulan lalu</span><span><i style="background:var(--text-3)"></i>1 tahun lalu</span></div>
      ${cv.series ? `<div class="mk-label" style="margin-top:14px">Spread 10 thn − 3 bln sejak ${cv.series[0][0].slice(0, 4)} (merah = resesi NBER)</div>
      ${lineChart([{ v: cv.series.map((r) => r[1]), color: 'var(--accent)', w: 1.5 }], { dates: cv.series.map((r) => r[0]), zero: 0, h: 190, w: 600, xlabels: [0, 0.25, 0.5, 0.75, 1], fmtX: (d) => d.slice(0, 4), fmtY: (v) => v.toFixed(0) + 'pp',
        bands: (cv.recessions || []).map(([a, b]) => [a, b, 'var(--down)', 0.28]) })}
      <div class="cmp-scroll" style="margin-top:10px"><table class="hold-table"><tr><th>Resesi</th><th>Inversi pertama</th><th class="r">Jeda</th></tr>
        ${(cv.leads || []).map((l) => `<tr><td class="mono">${l.rec}</td><td class="mono">${l.inv || '<span class="faint">tidak didahului</span>'}</td><td class="r mono">${l.lead != null ? l.lead + ' bln' : '–'}</td></tr>`).join('')}</table></div>
      <p class="small faint" style="margin:8px 0 0">${leads.length} dari ${(cv.leads || []).length} resesi sejak 1969 didahului inversi (rata-rata ${avgLead} bulan sebelumnya)${cv.false_pos && cv.false_pos.length ? `; inversi tanpa resesi: ${cv.false_pos.join(', ')}` : ''}. Sumber: ^TNX &amp; ^IRX (Yahoo Finance), tanggal resesi NBER.</p>` : ''}
    </div>`;
  }

  // ---- rotasi sektor (RRG)
  let rotHtml = '';
  if (rot.length) {
    const W = 600, H = 400, P = 34;
    const xs = rot.flatMap((r) => r.tail.map((t) => t[0])), ys = rot.flatMap((r) => r.tail.map((t) => t[1]));
    const dx = Math.max(...xs.map((v) => Math.abs(v - 100))) * 1.15 || 2, dy = Math.max(...ys.map((v) => Math.abs(v - 100))) * 1.15 || 2;
    const X = (v) => P + ((v - (100 - dx)) / (2 * dx)) * (W - 2 * P);
    const Y = (v) => P + (((100 + dy) - v) / (2 * dy)) * (H - 2 * P);
    const qc = { Memimpin: 'var(--up)', Melemah: 'var(--warn)', Tertinggal: 'var(--down)', Membaik: 'var(--accent-2)' };
    const svg = `<svg viewBox="0 0 ${W} ${H}" class="fanchart" role="img" aria-label="Relative Rotation Graph sektor">
      <rect x="${X(100)}" y="${P}" width="${W - P - X(100)}" height="${Y(100) - P}" fill="var(--up)" opacity=".07"/>
      <rect x="${X(100)}" y="${Y(100)}" width="${W - P - X(100)}" height="${H - P - Y(100)}" fill="var(--warn)" opacity=".07"/>
      <rect x="${P}" y="${Y(100)}" width="${X(100) - P}" height="${H - P - Y(100)}" fill="var(--down)" opacity=".07"/>
      <rect x="${P}" y="${P}" width="${X(100) - P}" height="${Y(100) - P}" fill="var(--accent-2)" opacity=".07"/>
      <line x1="${X(100)}" x2="${X(100)}" y1="${P}" y2="${H - P}" class="fc-now"/><line x1="${P}" x2="${W - P}" y1="${Y(100)}" y2="${Y(100)}" class="fc-now"/>
      <text x="${W - P - 4}" y="${P + 14}" text-anchor="end" class="fc-lbl" style="fill:var(--up)">MEMIMPIN</text>
      <text x="${W - P - 4}" y="${H - P - 6}" text-anchor="end" class="fc-lbl" style="fill:var(--warn)">MELEMAH</text>
      <text x="${P + 4}" y="${H - P - 6}" class="fc-lbl" style="fill:var(--down)">TERTINGGAL</text>
      <text x="${P + 4}" y="${P + 14}" class="fc-lbl" style="fill:var(--accent-2)">MEMBAIK</text>
      <text x="${W / 2}" y="${H - 8}" text-anchor="middle" class="fc-ax">Kekuatan relatif vs S&amp;P 500 →</text>
      <text x="12" y="${H / 2}" class="fc-ax" transform="rotate(-90 12 ${H / 2})" text-anchor="middle">Momentum →</text>
      ${rot.map((r) => { const c = qc[r.quad]; const t = r.tail; const last = t[t.length - 1];
        return `<path d="M${t.map((p) => `${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('L')}" fill="none" stroke="${c}" stroke-width="1.4" opacity=".7"/>
          ${t.slice(0, -1).map((p) => `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="2" fill="${c}" opacity=".6"/>`).join('')}
          <circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="5.5" fill="${c}"/>
          <text x="${(X(last[0]) + 8).toFixed(1)}" y="${(Y(last[1]) + 4).toFixed(1)}" class="fc-lbl" style="fill:var(--text)">${esc(r.sym)}</text>`; }).join('')}
    </svg>`;
    const sorted = [...rot].sort((a, b) => (b.m3 ?? -9) - (a.m3 ?? -9));
    rotHtml = `<div class="card card-pad">
      <h3 class="card-title">Rotasi Sektor (Relative Rotation Graph)</h3>
      <p class="small muted" style="margin:-4px 0 8px">Ekor = jejak 6 minggu terakhir. Sektor biasanya berputar searah jarum jam: Membaik → Memimpin → Melemah → Tertinggal.</p>
      ${svg}
      <div class="cmp-scroll" style="margin-top:8px"><table class="xa-table">
        <tr><th>Sektor</th><th>Kuadran</th><th>1M</th><th>1B</th><th>3B</th><th class="hm">YTD</th><th class="hm">1T</th><th>vs SPY 3B</th></tr>
        ${sorted.map((r) => `<tr><td class="nm"><b>${esc(r.name)}</b><small>${esc(r.sym)}</small></td><td style="color:${qc[r.quad]};font-weight:700">${esc(r.quad)}</td><td class="${cls(r.w1)}">${fmt.pct(r.w1, 1)}</td><td class="${cls(r.m1)}">${fmt.pct(r.m1, 1)}</td><td class="${cls(r.m3)}">${fmt.pct(r.m3, 1)}</td><td class="hm ${cls(r.ytd)}">${fmt.pct(r.ytd, 0)}</td><td class="hm ${cls(r.y1)}">${fmt.pct(r.y1, 0)}</td><td class="${cls(r.rs3m)}">${fmt.pct(r.rs3m, 1)}</td></tr>`).join('')}
      </table></div>
    </div>`;
  }

  el.innerHTML = `<div class="fade-in">
    <h1 class="page-title">Monitor Makro</h1>
    <p class="page-sub">Sentimen, suku bunga, sinyal resesi, rotasi sektor, dan lintas aset · data ${fmt.date(mk.generated || App.data.generated, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
    <div class="grid-2">${fgHtml}${curveHtml}</div>
    <section class="section">${xaHtml}</section>
    <section class="section">${rotHtml}</section>
    <p class="disclaimer">Indikator makro membantu membaca kondisi pasar, bukan alat penentu waktu jual-beli yang presisi.</p>
  </div>`;
}

function makroHomeStrip() {
  const mk = App.makro;
  if (!mk || !mk.assets) return '';
  const rows = Object.fromEntries(mk.assets.flatMap((g) => g.rows).map((r) => [r.sym, r]));
  const cell = (sym, lbl) => {
    const r = rows[sym];
    if (!r) return '';
    const v = r.rate ? r.last.toFixed(2) + '%' : r.last >= 1000 ? Math.round(r.last).toLocaleString('en-US') : r.last.toFixed(2);
    return `<a href="#/makro"><div class="l">${lbl}</div><div class="v">${v}</div><div class="c ${cls(r.d1)}">${r.rate ? bp(r.d1) : fmt.pct(r.d1, 2)}</div></a>`;
  };
  const fg = mk.fg;
  const cv = mk.curve;
  return `<section class="section"><div class="section-head"><div><h2>Makro Hari Ini</h2></div><a class="link" href="#/makro">Monitor ›</a></div>
    <div class="home-macro">
      ${fg ? `<a href="#/makro"><div class="l">Fear &amp; Greed</div><div class="v" style="color:${fgColor(fg.now)}">${Math.round(fg.now)}</div><div class="c" style="color:${fgColor(fg.now)}">${esc(fg.label)}</div></a>` : ''}
      ${cell('^VIX', 'VIX')}${cell('^TNX', 'UST 10 thn')}
      ${cv && cv.spread_now != null ? `<a href="#/makro"><div class="l">Spread 10T-3B</div><div class="v ${cv.spread_now < 0 ? 'down' : ''}">${cv.spread_now >= 0 ? '+' : ''}${cv.spread_now.toFixed(2)}</div><div class="c faint">${cv.spread_now < 0 ? 'inversi' : 'normal'}</div></a>` : ''}
      ${cell('DX-Y.NYB', 'Indeks Dolar')}${cell('IDR=X', 'USD/IDR')}${cell('GC=F', 'Emas')}${cell('BTC-USD', 'Bitcoin')}
    </div></section>`;
}

/* ------------------------------------------------------------ HEATMAP */
const SEC_ABBR = { Teknologi: 'TEK', Komunikasi: 'KOM', 'Konsumen Siklikal': 'SIKL', 'Konsumen Primer': 'PRIM', Kesehatan: 'KES',
  Keuangan: 'KEU', Industri: 'IND', Energi: 'ENR', Utilitas: 'UTIL', Properti: 'PROP', 'Bahan Baku': 'BHN', Lainnya: 'LAIN' };
function squarify(items, x, y, w, h) {
  const out = [];
  const total = items.reduce((a, b) => a + b.v, 0);
  if (!total || w <= 0 || h <= 0) return out;
  const scale = (w * h) / total;
  let rest = items.map((it) => ({ it, a: it.v * scale }));
  const worst = (row, s) => {
    const sum = row.reduce((a, b) => a + b.a, 0), mx = Math.max(...row.map((r) => r.a)), mn = Math.min(...row.map((r) => r.a));
    return Math.max((s * s * mx) / (sum * sum), (sum * sum) / (s * s * mn));
  };
  while (rest.length) {
    const s = Math.min(w, h);
    let row = [], best = Infinity;
    while (rest.length) {
      const cand = row.concat([rest[0]]);
      const r = worst(cand, s);
      if (r <= best) { row = cand; best = r; rest.shift(); } else break;
    }
    const sum = row.reduce((a, b) => a + b.a, 0);
    if (w >= h) {
      const rw = sum / h; let yy = y;
      row.forEach((r) => { const hh = r.a / rw; out.push({ it: r.it, x, y: yy, w: rw, h: hh }); yy += hh; });
      x += rw; w -= rw;
    } else {
      const rh = sum / w; let xx = x;
      row.forEach((r) => { const ww = r.a / rh; out.push({ it: r.it, x: xx, y, w: ww, h: rh }); xx += ww; });
      y += rh; h -= rh;
    }
  }
  return out;
}

const HM_METRICS = {
  d1: ['1 Hari', (s) => s.chg1d, 0.03, (v) => fmt.pct(v, 1)],
  m1: ['1 Bulan', (s) => s.ret['1m'], 0.12, (v) => fmt.pct(v, 0)],
  m3: ['3 Bulan', (s) => s.ret['3m'], 0.25, (v) => fmt.pct(v, 0)],
  y1: ['1 Tahun', (s) => s.ret['1y'], 0.5, (v) => fmt.pct(v, 0)],
  up: ['Proyeksi naik', (s) => (s.val ? s.val.upside : null), 0.4, (v) => fmt.pct(v, 0)],
  score: ['Skor', (s) => (s.score - 55) / 100, 0.2, (v) => Math.round(v * 100 + 55)],
  prob: ['Peluang untung', (s) => (s.q && s.q.mc ? s.q.mc.p_up - 0.5 : null), 0.2, (v) => Math.round((v + 0.5) * 100) + '%'],
};
function hmColor(v, rng) {
  if (v == null || !isFinite(v)) return '#3a3a3a';
  const t = clamp(v / rng, -1, 1);
  if (t >= 0) return `rgb(${Math.round(40 - 30 * t)},${Math.round(60 + 120 * t)},${Math.round(50 + 30 * t)})`;
  return `rgb(${Math.round(70 + 150 * -t)},${Math.round(50 - 20 * -t)},${Math.round(55 - 15 * -t)})`;
}

function renderHeatmap(el) {
  const metric = store.get('hmMetric', 'd1');
  const filt = store.get('hmFilter', 'all');
  const [mName, get, rng, fmtv] = HM_METRICS[metric];
  let S = App.data.stocks.filter((s) => s.mcap);
  if (filt === 'buy') S = S.filter((s) => s.rating === 'BUY' || s.rating === 'STRONG BUY');
  if (filt === 'wl') S = S.filter((s) => App.watch.has(s.sym));
  const secs = {};
  S.forEach((s) => { (secs[s.sector] = secs[s.sector] || []).push(s); });
  const secArr = Object.entries(secs).map(([k, list]) => ({ k, list: list.sort((a, b) => b.mcap - a.mcap), v: list.reduce((a, s) => a + s.mcap, 0) }))
    .sort((a, b) => b.v - a.v);
  // statistik ringkas
  const vals = S.map(get).filter((v) => v != null);
  const upN = vals.filter((v) => v > 0).length;
  const capW = S.reduce((a, s) => { const v = get(s); return v == null ? a : [a[0] + v * s.mcap, a[1] + s.mcap]; }, [0, 0]);

  el.innerHTML = `<div class="fade-in">
    <h1 class="page-title">Heatmap Pasar</h1>
    <p class="page-sub">Ukuran kotak = kapitalisasi pasar, dikelompokkan per sektor. Ketuk kotak untuk membuka analisis.</p>
    <div class="section-head" style="flex-wrap:wrap;align-items:center;gap:8px">
      <div class="seg-mini" id="hmMetric">${Object.entries(HM_METRICS).map(([k, m]) => `<button data-k="${k}" class="${k === metric ? 'on' : ''}">${m[0]}</button>`).join('')}</div>
      <div class="seg-mini" id="hmFilter">${[['all', 'Semua'], ['buy', 'Buy+'], ['wl', 'Watchlist']].map(([k, n]) => `<button data-k="${k}" class="${k === filt ? 'on' : ''}">${n}</button>`).join('')}</div>
    </div>
    <div class="small muted" style="margin-bottom:8px">${S.length} saham · ${metric === 'score' || metric === 'prob' || metric === 'up' ? '' : `naik ${upN} / turun ${vals.length - upN} · rata-rata tertimbang kapitalisasi <b class="${cls(capW[0] / capW[1])}">${fmtv(capW[0] / (capW[1] || 1))}</b>`}</div>
    <div class="heat-wrap" id="heat"></div>
    <div class="hm-legend">${Array.from({ length: 11 }, (_, i) => `<i style="background:${hmColor(((i - 5) / 5) * rng, rng)}"></i>`).join('')}</div>
    <div class="range-ends" style="margin-top:4px"><span>${fmtv(-rng)}</span><span>${mName}</span><span>${fmtv(rng)}</span></div>
    <section class="section grid-2" id="hmSecs"></section>
  </div>`;

  const box = $('#heat');
  const draw = () => {
    const W = box.clientWidth, H = Math.round(W < 700 ? Math.max(560, W * 1.45) : W * 0.56);
    box.style.height = H + 'px';
    const secRects = squarify(secArr, 0, 0, W, H);
    let html = '';
    secRects.forEach((sr) => {
      html += `<div class="hm-sec" style="left:${sr.x}px;top:${sr.y}px;width:${sr.w}px;height:${sr.h}px"><span>${esc(sr.it.k)}</span></div>`;
      const pad = sr.h > 40 && sr.w > 40 ? 14 : 0;
      squarify(sr.it.list.map((s) => ({ s, v: s.mcap })), sr.x + 1, sr.y + pad, sr.w - 2, sr.h - pad - 1).forEach((t) => {
        const s = t.it.s, v = get(s);
        const big = t.w > 46 && t.h > 30, mid = t.w > 30 && t.h > 18;
        html += `<a class="hm-t" href="#/s/${encodeURIComponent(s.sym)}" title="${esc(s.sym)} · ${esc(s.name)} · ${v == null ? '–' : fmtv(v)}" style="left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px;background:${hmColor(v, rng)}">
          ${mid ? `<b style="font-size:${clamp(Math.min(t.w / 4.2, t.h / 2.6), 9, 22).toFixed(0)}px">${esc(s.sym)}</b>` : ''}${big ? `<i>${v == null ? '–' : fmtv(v)}</i>` : ''}</a>`;
      });
    });
    box.innerHTML = html;
  };
  draw();
  const ro = new ResizeObserver(() => { if (document.body.contains(box)) draw(); });
  ro.observe(box);
  App._ro && App._ro.disconnect();
  App._ro = ro;

  // performa sektor
  const secStats = secArr.map((sc) => {
    const w = sc.list.reduce((a, s) => { const v = get(s); return v == null ? a : [a[0] + v * s.mcap, a[1] + s.mcap]; }, [0, 0]);
    const best = [...sc.list].filter((s) => get(s) != null).sort((a, b) => get(b) - get(a));
    return { k: sc.k, v: w[1] ? w[0] / w[1] : null, best: best.slice(0, 3), worst: best.slice(-3).reverse(), n: sc.list.length };
  }).sort((a, b) => (b.v ?? -9) - (a.v ?? -9));
  $('#hmSecs').innerHTML = `<div class="card card-pad"><h3 class="card-title">Sektor · ${esc(mName)}</h3>
    ${barsSvg(secStats.map((x) => ({ label: SEC_ABBR[x.k] || x.k.slice(0, 4).toUpperCase(), v: x.v })), { h: 200, values: true })}</div>
    <div class="card card-pad"><h3 class="card-title">Terbaik &amp; Terburuk per Sektor</h3>
    <div class="cmp-scroll"><table class="hold-table">${secStats.map((x) => `<tr><td><b>${esc(x.k)}</b><div class="faint small">${x.n} saham</div></td>
      <td>${x.best.map((s) => `<a href="#/s/${encodeURIComponent(s.sym)}" class="tag" style="margin:1px">${esc(s.sym)} <b class="${cls(get(s))}">${fmtv(get(s))}</b></a>`).join('')}</td>
      <td>${x.worst.map((s) => `<a href="#/s/${encodeURIComponent(s.sym)}" class="tag" style="margin:1px">${esc(s.sym)} <b class="${cls(get(s))}">${fmtv(get(s))}</b></a>`).join('')}</td></tr>`).join('')}</table></div></div>`;

  $('#hmMetric').onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) { store.set('hmMetric', b.dataset.k); renderHeatmap(el); } };
  $('#hmFilter').onclick = (e) => { const b = e.target.closest('[data-k]'); if (b) { store.set('hmFilter', b.dataset.k); renderHeatmap(el); } };
}

/* ------------------------------------------------------------ revisi estimasi (detail saham) */
function estCard(s, order = 6) {
  const e = s.est;
  if (!e) return '';
  const r = (k) => e[k] || {};
  const cell = (lbl, v) => `<td class="r mono ${cls(v)}">${fmt.pct(v, 1)}</td>`;
  return `<div class="card card-pad" style="order:${order}">
    <h3 class="card-title">Revisi Estimasi &amp; Kejutan Laba</h3>
    <div class="scores" style="gap:14px;margin-bottom:10px">${s.rev != null ? ring(s.rev) : ''}
      <div class="small muted" style="line-height:1.55">Skor momentum estimasi <b style="color:${scoreColor(s.rev ?? 50)}">${s.rev == null ? '–' : Math.round(s.rev)}/100</b>. Saham yang estimasinya terus dinaikkan analis cenderung mengungguli pasar (efek <i>earnings revision</i>). Dihitung ke skor analis (40%).</div></div>
    <table class="hold-table"><tr><th>Estimasi EPS</th><th class="r">Nilai</th><th class="r">7 hr</th><th class="r">30 hr</th><th class="r">90 hr</th></tr>
      ${[['fy0', 'Tahun ini'], ['fy1', 'Tahun depan']].filter(([k]) => e[k]).map(([k, n]) => `<tr><td>${n}</td><td class="r mono">${fmt.usd(r(k).eps)}</td>${cell('', r(k).r7)}${cell('', r(k).r30)}${cell('', r(k).r90)}</tr>`).join('')}</table>
    ${e.up30 != null ? `<p class="small" style="margin:8px 0 0">Revisi 30 hari: <b class="up">▲ ${e.up30} naik</b> · <b class="down">▼ ${e.down30} turun</b></p>` : ''}
    ${e.surprises && e.surprises.length ? `<div class="mk-label" style="margin-top:12px">Kejutan laba 4 kuartal · ${e.beats}/${e.n_q} mengalahkan estimasi</div>
      <div class="est-q">${e.surprises.map((q) => `<div><span class="faint">${q[0].slice(0, 7)}</span><b class="${cls(q[3])}">${fmt.pct(q[3], 0)}</b><span class="faint">${q[1] ?? '–'} vs ${q[2] ?? '–'}</span></div>`).join('')}</div>` : ''}
  </div>`;
}
