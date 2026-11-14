/* =====================================================================
   Radar Saham US — harga live (data/live.json, diperbarui ±20 menit oleh GitHub Actions)
   Menimpa harga harian: saham (harga, % hari ini, proyeksi ke nilai wajar), aset makro, tape, jam.
   ===================================================================== */
'use strict';

App.live = null;
const LIVE_VIEWS = new Set(['home', 'screener', 'makro', 'portofolio', 'watchlist', 'heatmap', 'strategi', 'pesan']);

function applyLiveOne(s) {
  const L = App.live;
  if (!L || !L.stocks || !s) return;
  const q = L.stocks[s.sym];
  if (!q || !q[0]) return;
  if (s.price_daily == null) s.price_daily = s.price;
  s.price = q[0];
  if (q[1] != null) s.chg1d = q[1];
  if (s.val && s.val.fair) s.val.upside = s.val.fair / s.price - 1;
}
function applyLive() {
  const L = App.live;
  if (!L) return;
  const fresh = (t, ref) => t && (!ref || Date.parse(t) > Date.parse(ref));
  if (L.stocks && fresh(L.stocks_t, App.data.generated)) { App.data.stocks.forEach(applyLiveOne); (App.etfs || []).forEach(applyLiveOne); }
  const A = L.assets || {};
  if (App.makro && App.makro.assets) {
    App.makro.assets.forEach((g) => g.rows.forEach((r) => {
      const a = A[r.sym];
      if (!a || a.p == null) return;
      r.last = a.p;
      if (a.d1 != null) r.d1 = a.d1;
      r.live_t = a.t;
    }));
  }
  const spy = A.SPY, m = App.data.market;
  if (m && spy && spy.p) { m.spy = spy.p; if (spy.d1 != null) m.chg1d = spy.d1; }
}
async function loadLive() {
  try {
    const r = await fetch('data/live.json', { cache: 'no-cache' });
    if (!r.ok) return false;
    const j = await r.json();
    const changed = !App.live || App.live.t !== j.t;
    App.live = j;
    applyLive();
    return changed;
  } catch (e) { return false; }
}
function liveLabel() {
  const L = App.live;
  if (!L) return '';
  const t = new Date(L.t);
  const mins = Math.round((Date.now() - t) / 60000);
  const hm = t.toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).replace('.', ':');
  return `<span title="Harga live diperbarui ±20 menit">⟳ harga ${hm}${mins > 60 ? ` <span style="color:var(--warn)">(${Math.round(mins / 60)} jam lalu)</span>` : ''}</span>`;
}

(function liveBoot() {
  // (label waktu harga live ditampilkan oleh tickClock di term.js)
  // muat detail saham -> terapkan ulang harga live
  if (typeof loadDetail === 'function') {
    const _load = loadDetail;
    loadDetail = async function (sym) { const s = await _load(sym); applyLiveOne(s); return s; };
  }
  // makro dimuat terpisah -> terapkan harga live setelahnya
  if (typeof loadMakro === 'function') {
    const _lm = loadMakro;
    loadMakro = async function () { const m = await _lm(); applyLive(); return m; };
  }

  const refresh = (force) => loadLive().then((changed) => {
    document.querySelectorAll('.today-flow-slot').forEach((el) => { const s = App.bySym[el.dataset.sym]; if (s && typeof todayFlowLine === 'function') el.innerHTML = todayFlowLine(s); });
    if (!changed && !force) return;
    tickClock();
    buildTape();
    const v = parseHash().parts[0] || 'home';
    const typing = /input|textarea|select/i.test((document.activeElement || {}).tagName || '');
    if (LIVE_VIEWS.has(v) && !typing && !document.querySelector('#sheet:not(.hidden)')) render();
  });
  const wait = setInterval(() => {
    if (!App.data) return;
    clearInterval(wait);
    refresh(true);
    setInterval(() => { if (document.visibilityState === 'visible') refresh(false); }, 5 * 60000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(false); });
  }, 150);
})();
