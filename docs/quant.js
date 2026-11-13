/* =====================================================================
   Radar Saham US — modul Analisis Kuantitatif
   Monte Carlo, profil faktor & risiko, model portofolio, rekam jejak,
   perubahan rekomendasi, kalender laporan keuangan, dan bandingkan saham.
   (memakai helper global dari app.js)
   ===================================================================== */
'use strict';

const CMP_COLORS = ['#0284c7', '#f59e0b', '#a855f7', '#ec4899'];
const FACTORS = [
  ['value', 'Valuasi'], ['quality', 'Kualitas'], ['growth', 'Pertumbuhan'],
  ['momentum', 'Momentum'], ['lowvol', 'Stabil'], ['size', 'Ukuran'],
];
App.quant = null;
App.cmp = store.get('compare', []).filter(Boolean);

async function loadQuant() {
  if (App.quant) return App.quant;
  const res = await fetch('data/quant.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  App.quant = await res.json();
  return App.quant;
}

const pctP = (x) => (x == null ? '–' : Math.round(x * 100) + '%');
const ratingOrder = { HINDARI: 0, HOLD: 1, BUY: 2, 'STRONG BUY': 3 };

/* ------------------------------------------------------------ grafik kipas Monte Carlo */
function fanChart(s) {
  const mc = s.q.mc, P = s.price, fan = mc.fan;
  const W = 600, H = 250, L = 52, R = 74, T = 14, B = 28;
  const fair = s.val && s.val.fair ? s.val.fair / P : null;
  let lo = Math.min(...fan.map((r) => r[0])), hi = Math.max(...fan.map((r) => r[4]));
  if (fair) { lo = Math.min(lo, fair); hi = Math.max(hi, fair); }
  const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const x = (i) => L + (i / (fan.length - 1)) * (W - L - R);
  const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const band = (a, b) => 'M' + fan.map((r, i) => `${x(i).toFixed(1)} ${y(r[a]).toFixed(1)}`).join('L') + 'L' +
    fan.map((r, i) => [i, r]).reverse().map(([i, r]) => `${x(i).toFixed(1)} ${y(r[b]).toFixed(1)}`).join('L') + 'Z';
  const line = (k) => 'M' + fan.map((r, i) => `${x(i).toFixed(1)} ${y(r[k]).toFixed(1)}`).join('L');
  const ticks = [];
  for (let k = 0; k < 5; k++) ticks.push(lo + ((hi - lo) * (k + 0.5)) / 5);
  const last = fan[fan.length - 1];
  const endLbl = (v, cls_, txt) => `<text x="${W - R + 6}" y="${(y(v) + 4).toFixed(1)}" class="fc-end ${cls_}">${txt}</text>`;
  // hindari label akhir bertumpuk
  const ends = [[last[4], 'P95'], [last[2], 'Median'], [last[0], 'P5']];
  let prevY = -99;
  const endTxt = ends.map(([v, n]) => {
    let yy = y(v); if (yy - prevY < 26) yy = prevY + 26; prevY = yy;
    return `<text x="${W - R + 6}" y="${(yy - 2).toFixed(1)}" class="fc-end">${fmt.usd(v * P, 0)}</text>
      <text x="${W - R + 6}" y="${(yy + 10).toFixed(1)}" class="fc-end2">${n} ${fmt.pct(v - 1, 0)}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="fanchart" role="img" aria-label="Distribusi harga 12 bulan hasil simulasi">
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="fc-grid"/>
      <text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" class="fc-ax" text-anchor="end">${fmt.usd(v * P, 0)}</text>`).join('')}
    ${[0, 3, 6, 9, 12].map((mo) => `<text x="${x(mo).toFixed(1)}" y="${H - 8}" class="fc-ax" text-anchor="middle">${mo ? mo + ' bln' : 'Kini'}</text>`).join('')}
    <path d="${band(0, 4)}" class="fc-b90"/>
    <path d="${band(1, 3)}" class="fc-b50"/>
    <line x1="${L}" x2="${W - R}" y1="${y(1).toFixed(1)}" y2="${y(1).toFixed(1)}" class="fc-now"/>
    ${fair ? `<line x1="${L}" x2="${W - R}" y1="${y(fair).toFixed(1)}" y2="${y(fair).toFixed(1)}" class="fc-fair"/>
      <text x="${L + 6}" y="${(y(fair) - 5).toFixed(1)}" class="fc-lbl fair">Nilai wajar ${fmt.usd(fair * P, 0)}</text>` : ''}
    <path d="${line(2)}" class="fc-med"/>
    ${endTxt}
  </svg>`;
}

function mcCard(s, order = 6) {
  const mc = s.q && s.q.mc;
  if (!mc) return '';
  const up = s.val ? s.val.upside : null;
  const pill = (v, good) => `<b class="${v == null ? '' : good ? 'up' : 'down'}">${pctP(v)}</b>`;
  return `<div class="card card-pad" style="order:${order}">
    <h3 class="card-title"><span class="ico">🎲</span>Simulasi Monte Carlo · 12 Bulan</h3>
    <p class="small muted" style="margin:-6px 0 8px">3.000 skenario harga dari pola return historis saham ini (termasuk ekor gemuk), volatilitas saat ini, dan return harapan model.</p>
    ${fanChart(s)}
    <div class="legend"><span><i style="background:var(--accent-2);opacity:.25;height:8px"></i>Rentang 90%</span><span><i style="background:var(--accent-2);opacity:.5;height:8px"></i>Rentang 50%</span><span><i style="background:var(--accent-2)"></i>Median</span><span><i style="background:var(--text-3)"></i>Harga kini</span>${s.val ? '<span><i style="background:var(--up)"></i>Nilai wajar</span>' : ''}</div>
    <div class="prob-grid">
      <div class="prob"><div class="pv" style="color:${scoreColor(mc.p_up * 100 + 10)}">${pctP(mc.p_up)}</div><div class="pl">Peluang untung</div><div class="pbar"><i style="width:${mc.p_up * 100}%;background:${scoreColor(mc.p_up * 100 + 10)}"></i></div></div>
      ${up != null && up > 0 && mc.p_fair != null ? `<div class="prob"><div class="pv">${pctP(mc.p_fair)}</div><div class="pl">Capai nilai wajar</div><div class="pbar"><i style="width:${mc.p_fair * 100}%;background:var(--up)"></i></div></div>` : ''}
      <div class="prob"><div class="pv" style="color:${scoreColor(100 - mc.p_loss20 * 250)}">${pctP(mc.p_loss20)}</div><div class="pl">Risiko turun &gt;20%</div><div class="pbar"><i style="width:${mc.p_loss20 * 100}%;background:var(--down)"></i></div></div>
      ${mc.p_target_first != null ? `<div class="prob"><div class="pv">${pctP(mc.p_target_first)}</div><div class="pl">Target kena sebelum stop</div><div class="pbar"><i style="width:${mc.p_target_first * 100}%;background:var(--accent-2)"></i></div></div>` : ''}
    </div>
    <div class="kv k3" style="margin-top:12px">
      <div><div class="l">Return harapan</div><div class="v ${cls(mc.exp)}">${fmt.pct(mc.exp, 1)}</div><div class="s">${Math.round(mc.view_w * 100)}% model · ${100 - Math.round(mc.view_w * 100)}% CAPM</div></div>
      <div><div class="l">Hasil median</div><div class="v ${cls(mc.median)}">${fmt.pct(mc.median, 1)}</div><div class="s">50% skenario di atasnya</div></div>
      <div><div class="l">Rentang 90%</div><div class="v" style="font-size:14px">${fmt.pct(mc.p5, 0)} / ${fmt.pct(mc.p95, 0)}</div><div class="s">P5 / P95</div></div>
      <div><div class="l">CVaR 5%</div><div class="v down">${fmt.pct(mc.cvar5, 0)}</div><div class="s">Rata-rata 5% skenario terburuk</div></div>
      <div><div class="l">Volatilitas dipakai</div><div class="v">${fmt.pct(mc.sigma, 0, false)}</div><div class="s">per tahun</div></div>
      ${mc.days_to_target ? `<div><div class="l">Waktu ke target</div><div class="v">~${Math.round(mc.days_to_target / 21)} bln</div><div class="s">median skenario yang sampai</div></div>` : `<div><div class="l">Peluang naik &gt;20%</div><div class="v up">${pctP(mc.p_gain20)}</div></div>`}
    </div>
    <p class="small faint" style="margin:12px 0 0">Return harapan sengaja konservatif: pandangan model nilai wajar hanya diberi bobot ${Math.round(mc.view_w * 100)}% (sesuai tingkat keyakinan), sisanya return ekuilibrium CAPM ${fmt.pct(mc.capm, 1, false)}. Simulasi bukan ramalan — ini gambaran rentang kemungkinan.</p>
  </div>`;
}

/* ------------------------------------------------------------ radar faktor */
function radar(series, size = 260) {
  const c = size / 2, R = size / 2 - 42, n = FACTORS.length;
  const pt = (i, v) => { const a = -Math.PI / 2 + (i / n) * 2 * Math.PI; return [c + R * (v / 100) * Math.cos(a), c + R * (v / 100) * Math.sin(a)]; };
  const ring_ = (v) => FACTORS.map((_, i) => pt(i, v).map((z) => z.toFixed(1)).join(',')).join(' ');
  return `<svg viewBox="0 0 ${size} ${size}" class="radar" role="img" aria-label="Profil faktor">
    ${[25, 50, 75, 100].map((v) => `<polygon points="${ring_(v)}" class="rd-grid"/>`).join('')}
    ${FACTORS.map((f, i) => { const [x2, y2] = pt(i, 100); const [lx, ly] = pt(i, 122); return `<line x1="${c}" y1="${c}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="rd-grid"/>
      <text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="middle" class="rd-lbl">${f[1]}</text>`; }).join('')}
    ${series.map((sr) => `<polygon points="${FACTORS.map((f, i) => pt(i, sr.f[f[0]] ?? 0).map((z) => z.toFixed(1)).join(',')).join(' ')}" fill="${sr.color}" fill-opacity="${series.length > 1 ? 0.1 : 0.2}" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round"/>
      ${series.length === 1 ? FACTORS.map((f, i) => { const [px, py] = pt(i, sr.f[f[0]] ?? 0); return `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="3.5" fill="${sr.color}"/>`; }).join('') : ''}`).join('')}
  </svg>`;
}

function factorCard(s, order = 8) {
  if (!s.factors) return '';
  const q = s.q || {};
  const f = s.factors;
  const top = FACTORS.filter(([k]) => f[k] != null).sort((a, b) => f[b[0]] - f[a[0]]);
  const style = (() => {
    const t = (k) => f[k] ?? 0;
    if (t('quality') >= 70 && t('value') >= 60) return 'Quality-Value — bisnis unggul dengan harga wajar';
    if (t('growth') >= 75 && t('momentum') >= 60) return 'Growth-Momentum — tumbuh cepat & sedang disukai pasar';
    if (t('growth') >= 70) return 'Growth — pertumbuhan di atas rata-rata';
    if (t('value') >= 75) return 'Deep Value — dihargai murah oleh pasar';
    if (t('lowvol') >= 70 && t('quality') >= 55) return 'Defensif — pergerakan stabil, kualitas memadai';
    if (t('momentum') >= 75) return 'Momentum — tren harga kuat';
    if (t('quality') >= 70) return 'Quality — profitabilitas tinggi';
    return 'Campuran — tidak dominan di satu gaya';
  })();
  const beta = q.beta_calc != null ? q.beta_calc : s.m.beta;
  return `<div class="card card-pad" style="order:${order}">
    <h3 class="card-title"><span class="ico">🧬</span>Profil Faktor &amp; Risiko</h3>
    <div class="factor-wrap">
      <div class="radar-box">${radar([{ f, color: 'var(--accent-2)' }])}</div>
      <div>
        <div class="mk-label">Gaya investasi</div>
        <div style="font-weight:700;margin:2px 0 10px">${esc(style)}</div>
        <div class="bars">${top.map(([k, n]) => `<div class="bar-row"><span class="name" style="min-width:94px">${n}</span><div class="bar"><i style="width:${f[k]}%;background:${scoreColor(f[k])}"></i></div><span class="v">${f[k]}</span></div>`).join('')}</div>
      </div>
    </div>
    <p class="small faint" style="margin:8px 0 12px">Persentil dibanding ${App.data.count} saham di universe (100 = paling tinggi). "Stabil" = volatilitas rendah.</p>
    ${q.vol != null ? `<div class="kv k3">
      <div><div class="l">Volatilitas 1 thn</div><div class="v">${fmt.pct(q.vol, 0, false)}</div><div class="s">Saat ini ${fmt.pct(q.vol_now, 0, false)}</div></div>
      <div><div class="l">Max drawdown 1 thn</div><div class="v down">${fmt.pct(q.mdd, 0)}</div><div class="s">Penurunan terdalam</div></div>
      <div><div class="l">Beta vs S&amp;P 500</div><div class="v">${fmt.num(beta, 2)}</div><div class="s">${beta == null ? '' : beta > 1.2 ? 'Lebih liar dari pasar' : beta < 0.8 ? 'Lebih tenang dari pasar' : 'Mirip pasar'}</div></div>
      <div><div class="l">Sharpe 1 thn</div><div class="v ${cls(q.sharpe)}">${fmt.num(q.sharpe, 2)}</div><div class="s">Return per unit risiko</div></div>
      <div><div class="l">Sortino 1 thn</div><div class="v ${cls(q.sortino)}">${fmt.num(q.sortino, 2)}</div><div class="s">Hanya risiko turun</div></div>
      <div><div class="l">VaR harian 95%</div><div class="v down">${fmt.pct(q.var95_d, 1)}</div><div class="s">1 dari 20 hari lebih buruk</div></div>
    </div>` : ''}
  </div>`;
}

/* ------------------------------------------------------------ badge perubahan */
function changeTag(s) {
  const p = s.prev;
  if (!p || p.rating === s.rating) return '';
  const upg = ratingOrder[s.rating] > ratingOrder[p.rating];
  return `<span class="chg-tag ${upg ? 'up' : 'down'}" title="Berubah sejak ${esc(p.d)}">${upg ? '▲ Naik' : '▼ Turun'} dari ${esc(p.rating)}</span>`;
}

/* ------------------------------------------------------------ bandingkan */
function saveCmp() { store.set('compare', App.cmp); updateCmpBar(); }
function toggleCmp(sym) {
  const i = App.cmp.indexOf(sym);
  if (i >= 0) { App.cmp.splice(i, 1); toast(`${sym} dikeluarkan dari perbandingan`); }
  else {
    if (App.cmp.length >= 4) { toast('Maksimal 4 saham — hapus salah satu dulu'); return false; }
    App.cmp.push(sym); toast(`${sym} ditambahkan ke perbandingan (${App.cmp.length}/4)`);
  }
  saveCmp();
  return true;
}
function updateCmpBar() {
  let bar = $('#cmpBar');
  if (!bar) {
    bar = document.createElement('a');
    bar.id = 'cmpBar'; bar.className = 'cmp-bar'; bar.href = '#/bandingkan';
    document.body.appendChild(bar);
  }
  const view = (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]) || 'home';
  const show = App.cmp.length >= 1 && view !== 'bandingkan';
  bar.classList.toggle('show', show);
  bar.innerHTML = `<span class="cmp-dots">${App.cmp.map((s, i) => `<i style="background:${CMP_COLORS[i]}"></i>`).join('')}</span>
    Bandingkan ${App.cmp.length} saham <b>›</b>`;
}

const CMP_ROWS = [
  ['Ringkasan'],
  ['Rekomendasi', (s) => ratingOrder[s.rating], (s) => ratingBadge(s.rating), 'hi'],
  ['Skor gabungan', (s) => s.score, (s) => Math.round(s.score), 'hi'],
  ['Proyeksi naik', (s) => (s.val ? s.val.upside : null), (s) => fmt.pct(s.val?.upside, 0), 'hi'],
  ['Peluang untung (MC)', (s) => s.q?.mc?.p_up, (s) => pctP(s.q?.mc?.p_up), 'hi'],
  ['Risiko turun >20%', (s) => s.q?.mc?.p_loss20, (s) => pctP(s.q?.mc?.p_loss20), 'lo'],
  ['Skor'],
  ['Fundamental', (s) => s.fund, (s) => Math.round(s.fund), 'hi'],
  ['Kualitas', (s) => s.pillars.quality, (s) => Math.round(s.pillars.quality), 'hi'],
  ['Valuasi', (s) => s.pillars.value, (s) => Math.round(s.pillars.value), 'hi'],
  ['Pertumbuhan', (s) => s.pillars.growth, (s) => Math.round(s.pillars.growth), 'hi'],
  ['Kesehatan', (s) => s.pillars.health, (s) => Math.round(s.pillars.health), 'hi'],
  ['Teknikal', (s) => s.tech, (s) => Math.round(s.tech), 'hi'],
  ['Ketahanan geopolitik', (s) => s.geo?.score, (s) => (s.geo ? Math.round(s.geo.score) : '–'), 'hi'],
  ['Valuasi & bisnis'],
  ['P/E forward', (s) => (s.m.pe_fwd > 0 ? s.m.pe_fwd : null), (s) => fmt.x(s.m.pe_fwd), 'lo'],
  ['PEG', (s) => (s.m.peg > 0 ? s.m.peg : null), (s) => fmt.num(s.m.peg, 2), 'lo'],
  ['FCF yield', (s) => s.m.fcf_yield, (s) => fmt.pct(s.m.fcf_yield, 1, false), 'hi'],
  ['ROIC', (s) => s.m.roic, (s) => fmt.pct(s.m.roic, 0, false), 'hi'],
  ['Margin operasi', (s) => s.m.op_margin, (s) => fmt.pct(s.m.op_margin, 0, false), 'hi'],
  ['Pendapatan YoY', (s) => s.m.rev_growth, (s) => fmt.pct(s.m.rev_growth, 0), 'hi'],
  ['Proyeksi EPS', (s) => s.m.eps_growth_fwd, (s) => fmt.pct(s.m.eps_growth_fwd, 0), 'hi'],
  ['Utang/Ekuitas', (s) => s.m.de, (s) => fmt.num(s.m.de, 2), 'lo'],
  ['Piotroski', (s) => s.m.piotroski, (s) => (s.m.piotroski ?? '–') + '/9', 'hi'],
  ['Dividen', (s) => s.m.div_yield, (s) => fmt.pct(s.m.div_yield, 1, false), 'hi'],
  ['Risiko'],
  ['Volatilitas 1 thn', (s) => s.q?.vol, (s) => fmt.pct(s.q?.vol, 0, false), 'lo'],
  ['Max drawdown', (s) => s.q?.mdd, (s) => fmt.pct(s.q?.mdd, 0), 'hi'],
  ['Sharpe 1 thn', (s) => s.q?.sharpe, (s) => fmt.num(s.q?.sharpe, 2), 'hi'],
  ['Beta', (s) => s.q?.beta_calc, (s) => fmt.num(s.q?.beta_calc, 2), null],
  ['Kapitalisasi', (s) => s.mcap, (s) => fmt.big(s.mcap), null],
];

function renderCompare(el, query) {
  const qs = query.get('s');
  if (qs) {
    App.cmp = qs.split(',').map((x) => x.trim().toUpperCase()).filter((x) => App.bySym[x]).slice(0, 4);
    saveCmp();
    history.replaceState(null, '', '#/bandingkan');
  }
  const list = App.cmp.map((x) => App.bySym[x]).filter(Boolean);
  const picker = `<div class="card card-pad cmp-picker">
    <div class="search-box" style="margin:0"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
      <input id="cmpInput" type="search" placeholder="${list.length >= 4 ? 'Maksimal 4 saham' : 'Tambah saham: ketik ticker atau nama…'}" ${list.length >= 4 ? 'disabled' : ''} autocomplete="off" spellcheck="false"></div>
    <div id="cmpSug" class="chips-wrap" style="margin-top:10px"></div>
  </div>`;

  if (list.length < 2) {
    el.innerHTML = `<div class="fade-in">
      <h1 class="page-title">Bandingkan Saham</h1>
      <p class="page-sub">Adu 2–4 saham berdampingan: skor, valuasi, risiko, simulasi, dan profil faktor.</p>
      ${picker}
      ${list.length ? `<div class="chips-wrap" style="margin:12px 0">${list.map((s) => `<span class="tag">${esc(s.sym)}</span>`).join('')}</div>` : ''}
      <div class="card empty"><div class="big-ico">⚖️</div><b>Pilih minimal 2 saham</b><p class="small">Ketik di kotak di atas, atau ketuk tombol <b>Bandingkan</b> di halaman detail saham.</p></div>
      <div class="section"><div class="section-head"><div><h2 style="font-size:16px">Ide perbandingan</h2></div></div>
      <div class="chips-wrap">${[['NVDA,AMD,AVGO', 'Chip AI'], ['MSFT,GOOGL,AMZN,META', 'Big Tech'], ['JPM,BAC,WFC,GS', 'Bank besar'], ['XOM,CVX,COP', 'Energi'], ['V,MA,PYPL', 'Pembayaran'], ['LMT,RTX,NOC,GD', 'Pertahanan']]
        .map(([q, n]) => `<a class="chip" href="#/bandingkan?s=${q}">${n}</a>`).join('')}</div></div>
    </div>`;
    bindCmpPicker();
    return;
  }

  const head = `<tr><th></th>${list.map((s, i) => `<th class="cmp-col"><div class="cmp-h"><i style="background:${CMP_COLORS[i]}"></i>
      <a href="#/s/${encodeURIComponent(s.sym)}">${esc(s.sym)}</a><button class="cmp-x" data-rm="${esc(s.sym)}" aria-label="Hapus ${esc(s.sym)}">×</button></div>
      <div class="cmp-n">${esc(s.name)}</div><div class="mono" style="font-weight:700">${fmt.usd(s.price)}</div></th>`).join('')}</tr>`;
  const body = CMP_ROWS.map(([label, get, show, better]) => {
    if (!get) return `<tr class="cmp-sec"><td colspan="${list.length + 1}">${label}</td></tr>`;
    const vals = list.map((s) => { const v = get(s); return v == null || !isFinite(v) ? null : v; });
    const valid = vals.filter((v) => v != null);
    let best = null;
    if (better && valid.length >= 2) best = better === 'hi' ? Math.max(...valid) : Math.min(...valid);
    return `<tr><td class="cmp-l">${label}</td>${list.map((s, i) => `<td class="${best != null && vals[i] === best ? 'best' : ''}">${show(s)}</td>`).join('')}</tr>`;
  }).join('');

  // pemenang: hitung berapa kali jadi terbaik
  const wins = list.map(() => 0);
  CMP_ROWS.forEach(([, get, , better]) => {
    if (!get || !better) return;
    const vals = list.map((s) => { const v = get(s); return v == null || !isFinite(v) ? null : v; });
    const valid = vals.filter((v) => v != null);
    if (valid.length < 2) return;
    const best = better === 'hi' ? Math.max(...valid) : Math.min(...valid);
    vals.forEach((v, i) => { if (v === best) wins[i]++; });
  });
  const byScore = [...list].sort((a, b) => b.score - a.score);

  el.innerHTML = `<div class="fade-in">
    <div class="section-head" style="align-items:center"><div><h1 class="page-title">Bandingkan Saham</h1>
      <p class="page-sub" style="margin:0">${list.map((s) => esc(s.sym)).join(' vs ')}</p></div>
      <button class="btn" id="cmpShare"><svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v13"/></svg>Bagikan</button></div>
    ${picker}
    <div class="card card-pad" style="margin-top:14px">
      <h3 class="card-title"><span class="ico">🏆</span>Kesimpulan</h3>
      <p class="thesis" style="margin:0"><b>${esc(byScore[0].sym)}</b> unggul secara keseluruhan (skor ${Math.round(byScore[0].score)}, ${esc(byScore[0].rating)})${byScore[0].val ? ` dengan proyeksi ${fmt.pct(byScore[0].val.upside, 0)}` : ''}.
      ${list.map((s, i) => `${esc(s.sym)} terbaik di <b>${wins[i]}</b> metrik`).join(' · ')}.</p>
    </div>
    <div class="grid-2" style="margin-top:14px">
      <div class="card card-pad"><h3 class="card-title"><span class="ico">🧬</span>Profil Faktor</h3>
        <div class="radar-box" style="max-width:340px;margin:0 auto">${radar(list.map((s, i) => ({ f: s.factors || {}, color: CMP_COLORS[i] })), 300)}</div>
        <div class="legend" style="justify-content:center">${list.map((s, i) => `<span><i style="background:${CMP_COLORS[i]}"></i>${esc(s.sym)}</span>`).join('')}</div></div>
      <div class="card card-pad"><h3 class="card-title"><span class="ico">📈</span>Kinerja Harga 1 Tahun</h3>
        <div id="cmpChart" class="chart-wrap" style="min-height:220px"><div class="splash" style="min-height:220px"><div class="spinner"></div></div></div>
        <div class="legend">${list.map((s, i) => `<span><i style="background:${CMP_COLORS[i]}"></i>${esc(s.sym)} <b class="${cls(s.ret['1y'])}">${fmt.pct(s.ret['1y'], 0)}</b></span>`).join('')}</div></div>
    </div>
    <div class="card" style="margin-top:14px"><div class="cmp-scroll"><table class="cmp-table">${head}${body}</table></div></div>
    <p class="disclaimer">Sel hijau = nilai terbaik di antara saham yang dibandingkan.</p>
  </div>`;

  bindCmpPicker();
  $$('[data-rm]').forEach((b) => { b.onclick = () => { toggleCmp(b.dataset.rm); render(); }; });
  $('#cmpShare').onclick = async () => {
    const url = location.href.split('#')[0] + '#/bandingkan?s=' + list.map((s) => s.sym).join(',');
    try {
      if (navigator.share) await navigator.share({ title: 'Bandingkan saham · Radar Saham US', url });
      else { await navigator.clipboard.writeText(url); toast('Tautan disalin'); }
    } catch (e) { /* batal */ }
  };
  Promise.all(list.map((s) => loadHist(s.sym).catch(() => null))).then((hs) => {
    const box = $('#cmpChart');
    if (box && document.body.contains(box)) box.innerHTML = perfChart(hs.map((h, i) => ({ h, color: CMP_COLORS[i] })));
  });
}

function bindCmpPicker() {
  const inp = $('#cmpInput'), sug = $('#cmpSug');
  if (!inp) return;
  const draw = () => {
    const q = inp.value.trim().toLowerCase();
    const res = (q ? App.data.stocks.filter((s) => s.sym.toLowerCase().startsWith(q) || s.name.toLowerCase().includes(q))
      : App.data.stocks.filter((s) => s.rating === 'STRONG BUY'))
      .filter((s) => !App.cmp.includes(s.sym)).slice(0, 8);
    sug.innerHTML = (q ? '' : '<span class="small faint" style="align-self:center">Saran:</span>') +
      res.map((s) => `<button class="chip" data-add="${esc(s.sym)}">${esc(s.sym)} <span class="faint">${Math.round(s.score)}</span></button>`).join('');
  };
  inp.oninput = draw;
  sug.onclick = (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    if (toggleCmp(b.dataset.add)) render();
  };
  draw();
}

function perfChart(items) {
  const W = 600, H = 230, L = 44, R = 10, T = 10, B = 24;
  const series = items.filter((x) => x.h).map((x) => {
    const n = x.h.c.length, start = Math.max(0, n - 252);
    const base = x.h.c[start];
    return { color: x.color, d: x.h.d.slice(start), v: x.h.c.slice(start).map((c) => c / base - 1) };
  });
  if (!series.length) return '<div class="empty small">Grafik tidak tersedia.</div>';
  const all = series.flatMap((s) => s.v);
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const pad = (hi - lo) * 0.08 || 0.05; lo -= pad; hi += pad;
  const len = Math.max(...series.map((s) => s.v.length));
  const x = (i) => L + (i / (len - 1)) * (W - L - R);
  const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const ticks = [];
  const step = niceStep((hi - lo) / 4);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const d0 = series[0].d;
  return `<svg viewBox="0 0 ${W} ${H}" class="fanchart">
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="${Math.abs(v) < 1e-9 ? 'fc-now' : 'fc-grid'}"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" class="fc-ax" text-anchor="end">${Math.round(v * 100)}%</text>`).join('')}
    ${[0, 0.5, 1].map((p) => { const i = Math.round(p * (d0.length - 1)); return `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="fc-ax" text-anchor="${p === 0 ? 'start' : p === 1 ? 'end' : 'middle'}">${fmt.date(d0[i], { month: 'short', year: '2-digit' })}</text>`; }).join('')}
    ${series.map((s) => `<path d="${'M' + s.v.map((v, i) => `${x(i + len - s.v.length).toFixed(1)} ${y(v).toFixed(1)}`).join('L')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`).join('')}
  </svg>`;
}
function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 0.01)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/* ------------------------------------------------------------ STRATEGI */
function donut(parts, size = 150) {
  const c = size / 2, R = size / 2 - 8, r0 = R - 22;
  let a = -Math.PI / 2;
  const cols = ['#0284c7', '#0ea271', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#ef4444', '#6366f1', '#84cc16', '#64748b', '#f97316'];
  const segs = parts.map(([, w], i) => {
    const a2 = a + w * 2 * Math.PI - 0.012;
    const large = a2 - a > Math.PI ? 1 : 0;
    const p = (ang, rr) => `${(c + rr * Math.cos(ang)).toFixed(2)} ${(c + rr * Math.sin(ang)).toFixed(2)}`;
    const d = `M${p(a, R)} A${R} ${R} 0 ${large} 1 ${p(a2, R)} L${p(a2, r0)} A${r0} ${r0} 0 ${large} 0 ${p(a, r0)}Z`;
    a = a2 + 0.012;
    return `<path d="${d}" fill="${cols[i % cols.length]}"/>`;
  }).join('');
  return { svg: `<svg viewBox="0 0 ${size} ${size}" class="donut">${segs}</svg>`, cols };
}

function backtestChart(curve) {
  const W = 600, H = 220, L = 44, R = 10, T = 10, B = 24;
  const pv = curve.map((r) => r[1] - 1), sv = curve.map((r) => (r[2] == null ? null : r[2] - 1));
  const all = pv.concat(sv.filter((v) => v != null));
  let lo = Math.min(0, ...all), hi = Math.max(0, ...all);
  const pad = (hi - lo) * 0.08 || 0.05; lo -= pad; hi += pad;
  const x = (i) => L + (i / (curve.length - 1)) * (W - L - R);
  const y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const step = niceStep((hi - lo) / 4), ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const path = (arr) => 'M' + arr.map((v, i) => (v == null ? null : `${x(i).toFixed(1)} ${y(v).toFixed(1)}`)).filter(Boolean).join('L');
  return `<svg viewBox="0 0 ${W} ${H}" class="fanchart">
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="${Math.abs(v) < 1e-9 ? 'fc-now' : 'fc-grid'}"/><text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" class="fc-ax" text-anchor="end">${Math.round(v * 100)}%</text>`).join('')}
    ${[0, 0.5, 1].map((p) => { const i = Math.round(p * (curve.length - 1)); return `<text x="${x(i).toFixed(1)}" y="${H - 6}" class="fc-ax" text-anchor="${p === 0 ? 'start' : p === 1 ? 'end' : 'middle'}">${fmt.date(curve[i][0], { month: 'short', year: '2-digit' })}</text>`; }).join('')}
    <path d="${path(sv)}" fill="none" stroke="var(--text-3)" stroke-width="1.8" stroke-dasharray="4 3"/>
    <path d="${path(pv)}" fill="none" stroke="var(--accent)" stroke-width="2.4" stroke-linejoin="round"/>
  </svg>`;
}

function corrHeat(c) {
  if (!c || !c.syms.length) return '';
  const n = c.syms.length;
  const col = (v) => v == null ? 'transparent' : v >= 0 ? `rgba(224,54,79,${(Math.min(1, v) * 0.85).toFixed(2)})` : `rgba(2,132,199,${(Math.min(1, -v) * 0.85).toFixed(2)})`;
  return `<div class="cmp-scroll"><table class="heat">
    <tr><th></th>${c.syms.map((s) => `<th>${esc(s)}</th>`).join('')}</tr>
    ${c.m.map((row, i) => `<tr><th>${esc(c.syms[i])}</th>${row.map((v, j) => `<td style="background:${i === j ? 'var(--surface-2)' : col(v)}" title="${esc(c.syms[i])}–${esc(c.syms[j])}: ${v}">${i === j ? '' : v.toFixed(2).replace('0.', '.')}</td>`).join('')}</tr>`).join('')}
  </table></div>
  <p class="small faint" style="margin:8px 0 0">Korelasi return harian 1 tahun. Merah = bergerak searah (diversifikasi lemah), biru = berlawanan. Rata-rata ${n > 1 ? (c.m.flat().reduce((a, v, k) => a + (k % (n + 1) === 0 ? 0 : v), 0) / (n * n - n)).toFixed(2) : '–'}.</p>`;
}

async function renderStrategi(el) {
  el.innerHTML = '<div class="splash"><div class="spinner"></div><p>Memuat analisis kuantitatif…</p></div>';
  let q;
  try { q = await loadQuant(); } catch (e) {
    el.innerHTML = `<div class="empty"><div class="big-ico">📡</div><b>Data strategi belum tersedia</b><p class="small">${esc(e.message)}</p></div>`;
    return;
  }
  if (parseHash().parts[0] !== 'strategi') return;
  const prof = store.get('profile', 'seimbang');
  const P = q.portfolios;
  const cap = store.get('capital', 10000);

  const portHtml = () => {
    if (!P) return '<div class="card empty">Model portofolio belum dapat disusun (kandidat Buy kurang).</div>';
    const p = P[prof] || P.seimbang;
    const { svg, cols } = donut(p.sectors);
    const bt = p.backtest || {};
    return `<div class="card card-pad">
      <div class="section-head" style="align-items:center;flex-wrap:wrap"><h3 class="card-title" style="margin:0"><span class="ico">🧺</span>Model Portofolio</h3>
        <div class="seg-mini" id="profSel">${Object.keys(P).map((k) => `<button data-p="${k}" class="${k === prof ? 'on' : ''}">${esc(P[k].name)}</button>`).join('')}</div></div>
      <p class="small muted" style="margin:0 0 12px">${esc(p.desc)} Dioptimasi mean-variance dari ${App.data.stocks.filter((s) => s.rating === 'STRONG BUY' || s.rating === 'BUY').length} saham Buy/Strong Buy · maks. ${Math.round(p.rules.max_w * 100)}% per saham, ${Math.round(p.rules.max_sec * 100)}% per sektor.</p>
      <div class="kv k3">
        <div><div class="l">Return harapan 12 bln</div><div class="v up">${fmt.pct(p.exp, 1)}</div></div>
        <div><div class="l">Volatilitas</div><div class="v">${fmt.pct(p.vol, 1, false)}</div></div>
        <div><div class="l">Sharpe harapan</div><div class="v">${fmt.num(p.sharpe, 2)}</div></div>
        <div><div class="l">Beta</div><div class="v">${fmt.num(p.beta, 2)}</div></div>
        <div><div class="l">Rasio diversifikasi</div><div class="v">${fmt.num(p.div_ratio, 2)}</div><div class="s">&gt;1.3 = baik</div></div>
        <div><div class="l">Skenario buruk (5%)</div><div class="v down">${fmt.pct(p.var95, 1)}</div><div class="s">1 thn, normal</div></div>
      </div>
      <div class="port-wrap">
        <div class="donut-box">${svg}<div class="donut-c"><b>${p.n}</b><span>saham</span></div></div>
        <div class="donut-leg">${p.sectors.map(([n, w], i) => `<div><i style="background:${cols[i % cols.length]}"></i><span>${esc(n)}</span><b>${Math.round(w * 100)}%</b></div>`).join('')}</div>
      </div>
      <div class="cap-row"><label for="capIn" class="small muted">Simulasi modal (USD)</label>
        <input id="capIn" type="number" min="100" step="100" inputmode="numeric" value="${cap}"></div>
      <div class="cmp-scroll"><table class="hold-table">
        <tr><th>Saham</th><th>Bobot</th><th class="r">Harapan</th><th class="r">Lembar</th><th class="r">Nilai</th></tr>
        ${p.holdings.map((h) => {
          const amt = cap * h.w, sh = h.price ? Math.floor(amt / h.price) : 0;
          return `<tr data-sym="${esc(h.sym)}"><td><a href="#/s/${encodeURIComponent(h.sym)}"><b>${esc(h.sym)}</b></a> ${h.rating === 'STRONG BUY' ? '<span style="color:var(--accent)">★</span>' : ''}<div class="faint small">${esc(h.sector)}</div></td>
          <td><div class="wbar"><i style="width:${(h.w / p.holdings[0].w) * 100}%"></i></div><span class="mono small">${(h.w * 100).toFixed(1)}%</span></td>
          <td class="r mono up">${fmt.pct(h.exp, 0)}</td><td class="r mono">${sh}${sh === 0 ? '<span class="faint small"> *</span>' : ''}</td><td class="r mono">${fmt.usd(sh * h.price, 0)}</td></tr>`;
        }).join('')}
      </table></div>
      <p class="small faint" style="margin:8px 0 0">Lembar dibulatkan ke bawah (* = modal terlalu kecil untuk 1 lembar; banyak broker mendukung pecahan saham). Sisa kas: ${fmt.usd(cap - p.holdings.reduce((a, h) => a + Math.floor(cap * h.w / (h.price || 1)) * (h.price || 0), 0), 0)}.</p>
    </div>
    <div class="grid-2" style="margin-top:16px">
      <div class="card card-pad"><h3 class="card-title"><span class="ico">⏪</span>Backtest 1 Tahun</h3>
        ${backtestChart(p.curve)}
        <div class="legend"><span><i style="background:var(--accent)"></i>Portofolio ${fmt.pct(bt.ret, 0)}</span><span><i style="background:var(--text-3)"></i>S&amp;P 500 ${fmt.pct(bt.spy, 0)}</span><span>Max DD <b class="down">${fmt.pct(bt.mdd, 0)}</b></span></div>
        <p class="small faint" style="margin:10px 0 0">⚠️ Bobot hari ini diterapkan ke harga setahun lalu — ada <i>look-ahead bias</i> (saham dipilih dengan data terkini), jadi hasil ini cenderung terlalu bagus. Lihat <b>Rekam Jejak</b> di bawah untuk kinerja nyata.</p></div>
      <div class="card card-pad"><h3 class="card-title"><span class="ico">🔗</span>Korelasi 10 Saham Terbesar</h3>${corrHeat(p.corr)}</div>
    </div>`;
  };

  // ---- rekam jejak
  const tr = q.track;
  const trackHtml = tr && tr.cohorts && tr.cohorts.length ? (() => {
    const a = tr.alpha || {};
    const alphaBox = (k, n) => `<div><div class="l">${n}</div><div class="v ${cls(a[k])}">${a[k] == null ? '–' : fmt.pct(a[k], 2)}</div><div class="s">rata-rata vs S&amp;P 500</div></div>`;
    return `<div class="card card-pad">
      <h3 class="card-title"><span class="ico">📒</span>Rekam Jejak Rekomendasi</h3>
      <p class="small muted" style="margin:-6px 0 12px">Setiap hari daftar rekomendasi disimpan beserta harganya, lalu dilacak kinerjanya — tanpa diedit. Dicatat sejak <b>${fmt.date(tr.since)}</b> (${tr.n_snaps} snapshot).</p>
      <div class="kv k3">${alphaBox('sb', 'Strong Buy')}${alphaBox('b', 'Buy')}${alphaBox('h', 'Hindari')}</div>
      <div class="cmp-scroll" style="margin-top:12px"><table class="hold-table">
        <tr><th>Sejak</th><th class="r">Strong Buy</th><th class="r">Buy</th><th class="r">Hindari</th><th class="r">S&amp;P 500</th></tr>
        ${tr.cohorts.slice(0, 20).map((c) => `<tr><td>${fmt.date(c.d, { day: 'numeric', month: 'short' })}<div class="faint small">${c.days} hari</div></td>
          <td class="r mono ${cls(c.sb)}">${fmt.pct(c.sb, 1)}<div class="faint small">${c.sb_n} saham</div></td>
          <td class="r mono ${cls(c.b)}">${fmt.pct(c.b, 1)}<div class="faint small">${c.b_n} saham</div></td>
          <td class="r mono ${cls(c.h)}">${fmt.pct(c.h, 1)}</td>
          <td class="r mono ${cls(c.spy)}">${fmt.pct(c.spy, 1)}</td></tr>`).join('')}
      </table></div>
      ${tr.first_movers ? `<div class="grid-2" style="margin-top:12px;gap:10px">
        <div><div class="mk-label">Terbaik sejak ${fmt.date(tr.since, { day: 'numeric', month: 'short' })}</div><div class="chips-wrap" style="margin-top:6px">${tr.first_movers.best.map(([s, r]) => `<a class="tag" href="#/s/${encodeURIComponent(s)}">${esc(s)} <b class="${cls(r)}">${fmt.pct(r, 1)}</b></a>`).join('')}</div></div>
        <div><div class="mk-label">Terburuk</div><div class="chips-wrap" style="margin-top:6px">${tr.first_movers.worst.map(([s, r]) => `<a class="tag" href="#/s/${encodeURIComponent(s)}">${esc(s)} <b class="${cls(r)}">${fmt.pct(r, 1)}</b></a>`).join('')}</div></div>
      </div>` : ''}
      <p class="small faint" style="margin:10px 0 0">Return = rata-rata bobot sama dari harga saat direkomendasikan sampai harga terakhir (tanpa dividen). Periode masih pendek — data ini akan makin bermakna setelah beberapa bulan.</p>
    </div>`;
  })() : '<div class="card card-pad"><h3 class="card-title"><span class="ico">📒</span>Rekam Jejak Rekomendasi</h3><p class="small muted">Rekam jejak mulai dicatat — hasil akan muncul setelah update berikutnya.</p></div>';

  el.innerHTML = `<div class="fade-in">
    <h1 class="page-title">Strategi</h1>
    <p class="page-sub">Portofolio teroptimasi, rekam jejak, perubahan rekomendasi, dan kalender laporan keuangan.</p>
    <div id="portBox">${portHtml()}</div>
    <section class="section">${trackHtml}</section>
    <section class="section">${changesHtml(true)}</section>
    <section class="section">${earningsHtml(30)}</section>
    <section class="section grid-2">
      <a class="card card-pad link-card" href="#/bandingkan"><span class="ico-lg">⚖️</span><div><b>Bandingkan Saham</b><div class="small muted">Adu 2–4 saham berdampingan</div></div><span class="faint">›</span></a>
      <a class="card card-pad link-card" href="#/siklus"><span class="ico-lg">🔄</span><div><b>Siklus Pasar 100 Tahun</b><div class="small muted">Bull/bear, siklus presiden, musiman</div></div><span class="faint">›</span></a>
      <a class="card card-pad link-card" href="#/metode"><span class="ico-lg">📐</span><div><b>Metodologi</b><div class="small muted">Cara skor, proyeksi &amp; simulasi dihitung</div></div><span class="faint">›</span></a>
    </section>
    <p class="disclaimer">Model portofolio adalah ilustrasi kuantitatif, bukan saran alokasi personal. Sesuaikan dengan tujuan, jangka waktu, dan toleransi risiko Anda.</p>
  </div>`;

  const bind = () => {
    const sel = $('#profSel');
    if (sel) sel.onclick = (e) => {
      const b = e.target.closest('[data-p]');
      if (!b) return;
      store.set('profile', b.dataset.p);
      renderStrategi(el);
    };
    const ci = $('#capIn');
    if (ci) ci.onchange = () => {
      const v = Math.max(100, Math.min(1e9, Number(ci.value) || 10000));
      store.set('capital', v);
      const y = window.scrollY;
      renderStrategi(el).then(() => window.scrollTo(0, y));
    };
  };
  bind();
}

function changesHtml(full) {
  const c = App.data.changes;
  if (!c || (!c.up.length && !c.down.length && !(c.movers || []).length)) return full ? `<div class="card card-pad"><h3 class="card-title"><span class="ico">🔄</span>Perubahan Rekomendasi</h3><p class="small muted">Tidak ada perubahan rekomendasi sejak update sebelumnya.</p></div>` : '';
  const n = full ? 12 : 4;
  const item = (x) => `<a class="chg-row" href="#/s/${encodeURIComponent(x.sym)}"><b>${esc(x.sym)}</b><span class="small muted chg-name">${esc(x.name)}</span>
    <span class="chg-flow">${ratingBadge(x.from)}<span class="faint">→</span>${ratingBadge(x.to)}</span></a>`;
  return `<div class="card card-pad">
    <div class="section-head" style="margin-bottom:8px"><div><h3 class="card-title" style="margin:0"><span class="ico">🔄</span>Perubahan Rekomendasi</h3>
      <p class="small muted" style="margin:4px 0 0">Dibanding data ${fmt.date(c.since, { day: 'numeric', month: 'short' })}</p></div>
      ${full ? '' : '<a class="link" href="#/strategi">Detail ›</a>'}</div>
    <div class="grid-2" style="gap:14px">
      <div><div class="mk-label up">▲ Naik peringkat (${c.up.length})</div>${c.up.slice(0, n).map(item).join('') || '<p class="small faint">Tidak ada.</p>'}</div>
      <div><div class="mk-label down">▼ Turun peringkat (${c.down.length})</div>${c.down.slice(0, n).map(item).join('') || '<p class="small faint">Tidak ada.</p>'}</div>
    </div>
    ${full && c.movers && c.movers.length ? `<div class="mk-label" style="margin-top:12px">Skor bergerak besar</div><div class="chips-wrap" style="margin-top:6px">${c.movers.map((x) => `<a class="tag" href="#/s/${encodeURIComponent(x.sym)}">${esc(x.sym)} <b class="${cls(x.ds)}">${x.ds > 0 ? '+' : ''}${x.ds}</b></a>`).join('')}</div>` : ''}
  </div>`;
}

function earningsHtml(days) {
  const now = Date.now(), lim = now + days * 864e5;
  const list = App.data.stocks.filter((s) => s.earnings_ts && s.earnings_ts * 1000 > now - 864e5 && s.earnings_ts * 1000 < lim)
    .sort((a, b) => a.earnings_ts - b.earnings_ts);
  const watchFirst = list.filter((s) => App.watch.has(s.sym) || s.rating === 'STRONG BUY' || s.rating === 'BUY');
  const show = (watchFirst.length >= 6 ? watchFirst : list).slice(0, 24);
  return `<div class="card card-pad">
    <h3 class="card-title"><span class="ico">📅</span>Kalender Laporan Keuangan</h3>
    <p class="small muted" style="margin:-6px 0 10px">${list.length} emiten melapor dalam ${days} hari ke depan${watchFirst.length >= 6 ? ' — ditampilkan saham Buy/Strong Buy & watchlist Anda' : ''}. Harga sering bergerak tajam di sekitar tanggal ini.</p>
    ${show.length ? `<div class="earn-list">${show.map((s) => {
      const d = new Date(s.earnings_ts * 1000), dd = Math.round((s.earnings_ts * 1000 - now) / 864e5);
      return `<a class="earn" href="#/s/${encodeURIComponent(s.sym)}"><div class="earn-d"><b>${d.getDate()}</b><span>${d.toLocaleDateString('id-ID', { month: 'short' })}</span></div>
        <div style="min-width:0"><b>${esc(s.sym)}</b> ${App.watch.has(s.sym) ? '<span style="color:var(--gold)">★</span>' : ''}<div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</div></div>
        <div style="text-align:right">${ratingBadge(s.rating)}<div class="faint small">${dd <= 0 ? 'hari ini' : dd === 1 ? 'besok' : dd + ' hari'}</div></div></a>`;
    }).join('')}</div>` : '<p class="small faint">Tidak ada jadwal dalam periode ini.</p>'}
  </div>`;
}

function strategiHomeCard() {
  const c = App.data.changes;
  const hasC = c && (c.up.length || c.down.length);
  return `<section class="section grid-2">
    ${hasC ? changesHtml(false) : ''}
    ${earningsHtml(10)}
  </section>
  <section class="section"><a class="card card-pad link-card" href="#/strategi"><span class="ico-lg">🧺</span><div><b>Model Portofolio &amp; Rekam Jejak</b><div class="small muted">Portofolio teroptimasi (konservatif / seimbang / agresif), backtest, dan kinerja rekomendasi sebelumnya</div></div><span class="faint">›</span></a></section>`;
}

window.addEventListener('hashchange', updateCmpBar);
