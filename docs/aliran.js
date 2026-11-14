/* =====================================================================
   Radar Saham US — Aliran Dana (Money Flow)
   Kartu detail: uang masuk/keluar 12 minggu, CMF, MFI, OBV, volume, institusi (13F), short interest.
   ===================================================================== */
'use strict';

function flowLabel(v) {
  if (v == null) return '–';
  return v >= 70 ? 'Akumulasi kuat' : v >= 58 ? 'Akumulasi' : v > 42 ? 'Netral' : v > 30 ? 'Distribusi' : 'Distribusi kuat';
}
function flowBars(weekly) {
  if (!weekly || weekly.length < 2) return '';
  const W = 600, H = 150, L = 46, R = 8, T = 10, B = 22;
  const vals = weekly.map((x) => x[1] || 0);
  const mx = Math.max(...vals.map(Math.abs)) || 1;
  const y = (v) => T + (H - T - B) / 2 - (v / mx) * (H - T - B) / 2;
  const bw = (W - L - R) / vals.length;
  const big = (v) => fmt.big(Math.abs(v)).replace('$', '');
  return `<svg viewBox="0 0 ${W} ${H}" class="fanchart">
    <line x1="${L}" x2="${W - R}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="fc-now"/>
    <text x="${L - 6}" y="${(y(mx) + 4).toFixed(1)}" class="fc-ax" text-anchor="end">+${big(mx)}</text>
    <text x="${L - 6}" y="${(y(-mx) + 4).toFixed(1)}" class="fc-ax" text-anchor="end">−${big(mx)}</text>
    ${vals.map((v, i) => { const x0 = L + i * bw + bw * 0.15, yy = y(Math.max(v, 0)), h = Math.max(1, Math.abs(y(v) - y(0)));
      return `<rect x="${x0.toFixed(1)}" y="${yy.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${h.toFixed(1)}" fill="${v >= 0 ? 'var(--up)' : 'var(--down)'}" opacity=".85"><title>Minggu ${weekly[i][0]}: ${v >= 0 ? '+' : '−'}${fmt.big(Math.abs(v))}</title></rect>`; }).join('')}
    ${[0, Math.floor(vals.length / 2), vals.length - 1].map((i) => `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" class="fc-ax" text-anchor="middle">${fmt.date(weekly[i][0], { day: 'numeric', month: 'short' })}</text>`).join('')}
  </svg>`;
}
function flowCard(s, order = 8) {
  const f = s.fl;
  if (!f) return '';
  const sc = s.flow, inst = f.inst, sh = f.short;
  const net = f.net20 || 0;
  return `<div class="card card-pad" style="order:${order}">
    <h3 class="card-title">Aliran Dana (Money Flow)</h3>
    <div class="scores" style="gap:14px;margin-bottom:10px">${sc != null ? ring(sc) : ''}
      <div><div style="font-weight:800;color:${scoreColor(sc ?? 50)}">${flowLabel(sc)}</div>
        <div class="small muted">Perkiraan tekanan ${net >= 0 ? 'beli' : 'jual'} bersih 20 hari: <b class="${net >= 0 ? 'up' : 'down'}">${net >= 0 ? '+' : '−'}${fmt.big(Math.abs(net))}</b> dari total transaksi ${fmt.big(f.gross20)}</div></div></div>
    <div class="mk-label">Uang masuk / keluar per minggu (12 minggu)</div>
    ${flowBars(f.weekly)}
    <div class="kv k3" style="margin-top:10px">
      <div><div class="l">Chaikin Money Flow 20h</div><div class="v ${cls(f.cmf)}">${f.cmf == null ? '–' : (f.cmf >= 0 ? '+' : '') + f.cmf.toFixed(2)}</div><div class="s">> +0,1 akumulasi · < −0,1 distribusi</div></div>
      <div><div class="l">Money Flow Index 14h</div><div class="v">${fmt.num(f.mfi, 0)}</div><div class="s">${f.mfi > 80 ? 'jenuh beli' : f.mfi < 20 ? 'jenuh jual' : 'normal'}</div></div>
      <div><div class="l">Volume naik ÷ turun</div><div class="v ${f.ud >= 1 ? 'up' : 'down'}">${fmt.num(f.ud, 2)}×</div><div class="s">20 hari</div></div>
      <div><div class="l">Tren OBV</div><div class="v ${cls(f.obv_tr)}">${f.obv_tr == null ? '–' : (f.obv_tr >= 0 ? '+' : '') + f.obv_tr.toFixed(2)}</div><div class="s">${f.div === 'akumulasi' ? '<b class="up">akumulasi tersembunyi</b>' : f.div === 'distribusi' ? '<b class="down">distribusi</b>' : 'searah harga'}</div></div>
      <div><div class="l">Volume 5h vs 50h</div><div class="v">${fmt.num(f.rv, 2)}×</div><div class="s">harga 5h ${fmt.pct(f.chg5, 1)}</div></div>
      ${sh ? `<div><div class="l">Short interest</div><div class="v ${sh.chg > 0.1 ? 'down' : sh.chg < -0.1 ? 'up' : ''}">${fmt.pct(sh.pct_float, 1, false)}</div><div class="s">${sh.chg != null ? 'sebulan ' + fmt.pct(sh.chg, 0) + ' · ' : ''}${sh.days ? sh.days + ' hari menutup' : ''}</div></div>` : ''}
    </div>
    ${inst && inst.top ? `<div class="mk-label" style="margin-top:12px">10 institusi terbesar · ${inst.n_up} menambah · ${inst.n_dn} mengurangi${inst.net_usd != null ? ` · bersih <b class="${inst.net_usd >= 0 ? 'up' : 'down'}">${inst.net_usd >= 0 ? '+' : '−'}${fmt.big(Math.abs(inst.net_usd))}</b>` : ''}</div>
      <div class="cmp-scroll"><table class="hold-table"><tr><th>Institusi</th><th class="r">Porsi</th><th class="r">Perubahan</th><th class="r">Lapor</th></tr>
        ${inst.top.map(([n, d, p, shs, c]) => `<tr><td>${esc(n)}</td><td class="r mono">${fmt.pct(p, 2, false)}</td><td class="r mono ${cls(c)}">${c == null ? '–' : fmt.pct(c, 1)}</td><td class="r mono small faint">${esc(d)}</td></tr>`).join('')}</table></div>` : ''}
    <p class="small faint" style="margin:8px 0 0">Perkiraan dari harga &amp; volume harian (posisi penutupan dalam rentang harian × volume) — bukan data transaksi per pembeli. Data institusi dari laporan 13F (tertunda hingga 45 hari setelah kuartal). Skor aliran dana = 30% komponen teknikal.</p>
  </div>`;
}
