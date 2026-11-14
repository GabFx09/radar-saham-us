/* =====================================================================
   Radar Saham US — Kekayaan Total & Dana Darurat
   Mencatat aset di luar saham (dana darurat, tabungan, RDPU, emas, lainnya) dan utang.
   Bila dana darurat < target, sebagian DCA bulanan disarankan ke dana darurat dulu
   (sama dengan ef_part di scripts/notify.py).
   ===================================================================== */
'use strict';

const WEALTH_KEYS = [
  ['ef', '🛟 Dana darurat', 'tabungan/RDPU khusus darurat'],
  ['sav', '🏦 Tabungan lain', 'rekening bank'],
  ['rdpu', '📈 Reksa dana', 'RDPU / obligasi / campuran'],
  ['gold', '🥇 Emas', 'emas fisik/digital'],
  ['other', '📦 Aset lain', 'deposito, kripto, dll.'],
  ['debt', '💳 Utang', 'paylater, kartu kredit, pinjaman'],
];
function wealthCfg() {
  return Object.assign({ ef: 0, sav: 0, rdpu: 0, gold: 0, other: 0, debt: 0, exp: 0, efT: 6, prio: true, inGoal: true }, (App.notify && App.notify.wealth) || {});
}
const wealthSet = () => !!(App.notify && App.notify.wealth);
/** bagian DCA bulan ini untuk dana darurat (maks 50%) */
function efAllocation(W, amt) {
  if (!W || !W.prio || !(W.exp > 0) || !(amt > 0)) return 0;
  return Math.min(Math.max(0, W.efT * W.exp - W.ef), amt * 0.5);
}
/** aset di luar saham yang ikut dihitung untuk Target Keuangan (tanpa dana darurat) */
function goalExtraIdr() {
  if (!wealthSet()) return 0;
  const W = wealthCfg();
  return W.inGoal ? W.sav + W.rdpu + W.gold + W.other - W.debt : 0;
}

function wealthCard(valUsd) {
  const W = wealthCfg(), K = idrNow().v, stocks = valUsd * K;
  const assets = stocks + W.ef + W.sav + W.rdpu + W.gold + W.other;
  const net = assets - W.debt;
  const mo = W.exp > 0 ? W.ef / W.exp : null;
  const parts = [['Saham & ETF', stocks, '#0284c7'], ['Dana darurat', W.ef, '#0ea271'], ['Tabungan', W.sav, '#64748b'], ['Reksa dana', W.rdpu, '#a855f7'], ['Emas', W.gold, '#f59e0b'], ['Lainnya', W.other, '#14b8a6']].filter((p) => p[1] > 0);
  const D = typeof dcaCfg === 'function' ? dcaCfg() : { amt: 0 };
  const efp = efAllocation(W, D.amt);
  let advice = '';
  if (W.debt > 0) advice = `<li class="warn"><span></span><div>Ada utang ${rp(W.debt)}. Utang berbunga tinggi (paylater/kartu kredit, sering 20–40%/thn) sebaiknya <b>dilunasi dulu</b> — itu "return" pasti yang lebih besar dari rata-rata saham.</div></li>`;
  if (mo == null) advice += '<li><span></span><div>Isi <b>pengeluaran per bulan</b> agar kecukupan dana darurat bisa dihitung.</div></li>';
  else if (mo < W.efT) advice += `<li class="warn"><span></span><div>Dana darurat baru <b>${mo.toLocaleString('id-ID', { maximumFractionDigits: 1 })} bulan</b> pengeluaran (target ${W.efT}). Kurang ${rp(W.efT * W.exp - W.ef)}.${W.prio && efp > 0 ? ` Rencana DCA otomatis menyisihkan <b>${rp(efp)}</b>/bulan ke dana darurat sampai cukup.` : ''} Simpan di tabungan terpisah atau RDPU — bukan saham, karena saat darurat harga saham bisa sedang turun.</div></li>`;
  else advice += `<li class="up"><span></span><div>✓ Dana darurat ${mo.toLocaleString('id-ID', { maximumFractionDigits: 1 })} bulan pengeluaran — aman. Seluruh DCA bisa ke investasi.</div></li>`;
  if (net > 0 && stocks / net > 0.9 && (mo == null || mo < W.efT)) advice += `<li class="warn"><span></span><div>${Math.round(stocks / net * 100)}% kekayaan ada di saham. Untuk usia muda wajar porsi saham besar, asalkan dana darurat sudah terpisah.</div></li>`;
  return `<div class="card card-pad" style="margin-top:12px" id="wealthCard">
    <h3 class="card-title">🏦 Kekayaan Total &amp; Dana Darurat</h3>
    <p class="small muted" style="margin:0 0 10px">Catat aset di luar saham agar rencana memperhitungkan gambaran keuangan Anda seluruhnya. Tersimpan di perangkat ini${App.cloud && App.cloud.gistId ? ' &amp; gist pribadi Anda' : ''} — tidak dikirim ke mana pun.</p>
    <div class="reb-opts">
      ${WEALTH_KEYS.map(([k, n, ph]) => `<label>${n} Rp <input data-w="${k}" type="number" min="0" step="100000" value="${W[k] || ''}" placeholder="${ph}" inputmode="numeric"></label>`).join('')}
      <label>💸 Pengeluaran / bulan Rp <input data-w="exp" type="number" min="0" step="100000" value="${W.exp || ''}" placeholder="biaya hidup rutin" inputmode="numeric"></label>
      <label>Target dana darurat <select id="wEfT">${[3, 6, 9, 12].map((v) => `<option value="${v}" ${v === W.efT ? 'selected' : ''}>${v} bulan</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" id="wPrio" ${W.prio ? 'checked' : ''}> utamakan dana darurat di DCA</label>
      <label class="chk"><input type="checkbox" id="wGoal" ${W.inGoal ? 'checked' : ''}> aset lain ikut dihitung di Target</label>
    </div>
    <div class="kv k3" style="margin:10px 0">
      <div><div class="l">Kekayaan bersih</div><div class="v">${rp(net)}</div><div class="s">aset ${rp(assets)}${W.debt ? ' − utang ' + rp(W.debt) : ''}</div></div>
      <div><div class="l">Dana darurat</div><div class="v ${mo == null ? '' : mo >= W.efT ? 'up' : 'down'}">${mo == null ? '–' : mo.toLocaleString('id-ID', { maximumFractionDigits: 1 }) + ' bln'}</div><div class="s">target ${W.efT} bulan${W.exp ? ' = ' + rp(W.efT * W.exp) : ''}</div></div>
      <div><div class="l">Porsi saham &amp; ETF</div><div class="v">${assets ? Math.round(stocks / assets * 100) : 0}%</div><div class="s">dari total aset</div></div>
    </div>
    ${parts.length > 1 ? `<div style="display:flex;height:12px;border-radius:6px;overflow:hidden;margin:4px 0 6px">${parts.map((p) => `<i title="${p[0]}" style="flex:${p[1]};background:${p[2]}"></i>`).join('')}</div>
      <div class="small" style="display:flex;gap:12px;flex-wrap:wrap">${parts.map((p) => `<span><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${p[2]}"></i> ${p[0]} ${Math.round(p[1] / assets * 100)}%</span>`).join('')}</div>` : ''}
    <ul class="cyc-sig" style="margin-top:10px">${advice}</ul>
    <p class="small faint" style="margin:6px 0 0">Target umum dana darurat: 3 bulan bila lajang dengan penghasilan stabil, 6 bulan atau lebih bila penghasilan tidak tetap / ada tanggungan.</p>
  </div>`;
}
function bindWealth(el) {
  if (!$('#wealthCard')) return;
  const save = () => {
    const W = wealthCfg();
    $$('#wealthCard [data-w]').forEach((i) => { W[i.dataset.w] = Math.max(0, parseFloat(i.value) || 0); });
    W.efT = +$('#wEfT').value; W.prio = $('#wPrio').checked; W.inGoal = $('#wGoal').checked;
    setNotifyKey('wealth', W);
    const y = window.scrollY; renderPorto(el); window.scrollTo(0, y);
  };
  $$('#wealthCard [data-w]').forEach((i) => { i.onchange = save; });
  ['#wEfT', '#wPrio', '#wGoal'].forEach((id) => { $(id).onchange = save; });
}
