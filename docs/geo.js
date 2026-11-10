/* =====================================================================
   Radar Saham US — modul tampilan Analisis Geopolitik
   (memakai helper global dari app.js: App, fmt, esc, ring, scoreColor, stockRow, spark, cls, clamp)
   ===================================================================== */
'use strict';

const stressColor = (x) => scoreColor(100 - x);
const geoThemes = () => (App.data.geo && App.data.geo.themes) || [];
const geoTheme = (k) => geoThemes().find((t) => t.key === k);

function geoDate(d) {
  if (!d) return '';
  const t = new Date(d);
  if (isNaN(t)) return '';
  const h = (Date.now() - t) / 36e5;
  if (h < 1) return 'baru saja';
  if (h < 24) return Math.round(h) + ' jam lalu';
  if (h < 24 * 7) return Math.round(h / 24) + ' hari lalu';
  return fmt.date(t, { day: 'numeric', month: 'short' });
}

function gauge(v) {
  const R = 80, cx = 100, cy = 100;
  const pt = (val) => { const a = Math.PI * (1 - clamp(val, 0, 100) / 100); return [cx + R * Math.cos(a), cy - R * Math.sin(a)]; };
  const [x, y] = pt(v);
  const seg = (a, b, col) => { const [x1, y1] = pt(a), [x2, y2] = pt(b); return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${R} ${R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${col}" stroke-width="14" fill="none" opacity=".22"/>`; };
  return `<svg viewBox="0 0 200 118" class="gauge" role="img" aria-label="Indeks stres ${Math.round(v)}">
    ${seg(0, 39.5, scoreColor(90))}${seg(40.5, 54.5, scoreColor(58))}${seg(55.5, 69.5, scoreColor(40))}${seg(70.5, 100, scoreColor(10))}
    <path d="M20 100 A${R} ${R} 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}" stroke="${stressColor(v)}" stroke-width="14" fill="none" stroke-linecap="round"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="var(--surface)" stroke="${stressColor(v)}" stroke-width="4"/>
    <text x="100" y="92" text-anchor="middle" font-size="34" font-weight="800" fill="var(--text)" font-family="JetBrains Mono, monospace">${Math.round(v)}</text>
    <text x="20" y="116" font-size="10" fill="var(--text-3)" text-anchor="middle">0</text><text x="180" y="116" font-size="10" fill="var(--text-3)" text-anchor="middle">100</text>
  </svg>`;
}

function symChips(list) {
  return (list || []).map((s) => `<a class="tag sym-chip" href="#/s/${encodeURIComponent(s)}">${esc(s)}</a>`).join('') || '<span class="faint small">–</span>';
}

function themeTags(keys) {
  return (keys || []).map((k) => { const t = geoTheme(k); return t ? `<span class="tag">${t.icon} ${esc(t.name)}</span>` : ''; }).join('');
}

function newsItem(n) {
  return `<a class="news" href="${esc(n.url || '#')}" target="_blank" rel="noopener">
    <div class="news-title">${esc(n.title)}</div>
    <div class="news-meta">${n.sym ? `<b>${esc(n.sym)}</b> · ` : ''}${esc(n.source || '')}${n.date ? ' · ' + geoDate(n.date) : ''}</div>
    ${n.themes ? `<div class="news-tags">${themeTags(n.themes)}</div>` : ''}
  </a>`;
}

/* ------------------------------------------------------------ halaman Geopolitik */
function renderGeo(el) {
  const G = App.data.geo;
  if (!G) {
    el.innerHTML = '<div class="empty"><div class="big-ico">🌍</div>Data geopolitik belum tersedia — jalankan ulang <code>python scripts/screener.py</code>.</div>';
    return;
  }
  const S = App.data.stocks;
  const hist = (G.gsi_hist || []).map((x) => x[1]);
  const safe = S.filter((s) => s.geo && s.geo.score >= 70 && s.fund >= 60).sort((a, b) => b.score - a.score);
  const exposed = S.filter((s) => s.geo && s.geo.risk >= 40 && (s.rating === 'STRONG BUY' || s.rating === 'BUY')).sort((a, b) => b.geo.risk - a.geo.risk);
  const fmtInd = (i) => (i.value == null ? '–' : i.fmt === 'pct' ? fmt.pct(i.value) : fmt.num(i.value, 1));
  const maxSec = Math.max(...G.sectors.map((x) => x.score));

  el.innerHTML = `<div class="fade-in">
    <h1 class="page-title">Analisis Geopolitik</h1>
    <p class="page-sub">Bagaimana tarif, konflik, sanksi, dan kebijakan global memengaruhi pasar saham AS — diperbarui setiap hari dari data pasar &amp; berita.</p>

    <div class="geo-hero card card-pad">
      <div class="geo-gauge">${gauge(G.gsi)}
        <div class="geo-gauge-l"><span class="mk-label">Indeks Stres Geopolitik</span>
          <span class="regime" style="color:${stressColor(G.gsi)};background:color-mix(in srgb, ${stressColor(G.gsi)} 14%, transparent)">${esc(G.gsi_label)}</span></div></div>
      <div class="geo-sum">
        <p class="thesis">${esc(G.summary)}</p>
        ${hist.length > 2 ? `<div class="geo-trend"><span class="mk-label">Tren 6 bulan</span>${spark(hist, 240, 44).replace('class="row-spark"', 'class="geo-spark"')}</div>` : ''}
      </div>
    </div>

    <section class="section">
      <div class="section-head"><div><h2>Sinyal Pasar</h2><p>Aset yang biasanya bereaksi duluan terhadap ketegangan geopolitik</p></div></div>
      <div class="ind-grid">${G.indicators.map((i) => `<div class="card ind">
        <div class="ind-top"><span class="ind-name">${esc(i.name)}</span><span class="mono ind-val">${fmtInd(i)}</span></div>
        <div class="bar"><i style="width:${i.score ?? 0}%;background:${stressColor(i.score ?? 0)}"></i></div>
        <div class="ind-note">${esc(i.note)} · <b style="color:${stressColor(i.score ?? 0)}">stres ${i.score == null ? '–' : Math.round(i.score)}</b></div></div>`).join('')}</div>
    </section>

    <section class="section">
      <div class="section-head"><div><h2>Tema Geopolitik</h2><p>Diurutkan dari intensitas tertinggi · intensitas = gabungan bobot struktural, sinyal pasar &amp; frekuensi berita 14 hari</p></div></div>
      <div class="grid-2">${G.themes.map((t) => `<div class="card card-pad theme">
        <div class="theme-head"><span class="theme-ico">${t.icon}</span>
          <div style="flex:1;min-width:0"><div class="theme-name">${esc(t.name)}</div>
          <div class="bar" style="margin-top:6px"><i style="width:${t.intensity}%;background:${stressColor(t.intensity)}"></i></div></div>
          <div class="theme-int"><b class="mono" style="color:${stressColor(t.intensity)}">${Math.round(t.intensity)}</b><small>${t.trend === 'naik' ? '▲ memanas' : t.trend === 'turun' ? '▼ mereda' : '● stabil'}</small></div></div>
        <p class="small muted" style="margin:10px 0">${esc(t.desc)}</p>
        <div class="theme-side"><span class="lbl up">Diuntungkan</span><div class="chips-wrap">${symChips(t.winners)}</div></div>
        <div class="theme-side"><span class="lbl down">Dirugikan</span><div class="chips-wrap">${symChips(t.losers)}</div></div>
        ${t.headlines.length ? `<details class="theme-news"><summary>${t.news_count} berita terkait (14 hari)</summary>${t.headlines.map(newsItem).join('')}</details>` : `<p class="small faint" style="margin:8px 0 0">Tidak ada berita besar 14 hari terakhir.</p>`}
      </div>`).join('')}</div>
    </section>

    <section class="section grid-2">
      <div class="card">
        <div class="card-pad" style="padding-bottom:4px"><div class="section-head" style="margin:0"><div><h2 style="font-size:16px">🛡️ Tahan Geopolitik</h2><p>Ketahanan geo ≥ 70 &amp; fundamental ≥ 60</p></div>
          <a class="link" href="#/screener?p=geo_safe">${safe.length} saham ›</a></div></div>
        <div class="list">${safe.slice(0, 6).map(stockRow).join('') || '<div class="empty small">Belum ada.</div>'}</div>
      </div>
      <div class="card">
        <div class="card-pad" style="padding-bottom:4px"><div class="section-head" style="margin:0"><div><h2 style="font-size:16px">⚠️ Bagus, tapi Rentan</h2><p>Rekomendasi beli dengan risiko geopolitik tinggi — perhatikan ukuran posisi</p></div></div></div>
        <div class="list">${exposed.slice(0, 6).map(stockRow).join('') || '<div class="empty small">Tidak ada.</div>'}</div>
      </div>
    </section>

    <section class="section card card-pad">
      <div class="section-head"><div><h2>Ketahanan per Sektor</h2><p>Rata-rata skor ketahanan geopolitik (makin tinggi makin tahan)</p></div></div>
      ${G.sectors.map((x) => `<div class="sector-row" style="grid-template-columns:130px 1fr 46px">
        <span style="font-weight:600">${esc(x.name)}</span>
        <div class="bar"><i style="width:${(x.score / maxSec) * 100}%;background:${scoreColor(x.score)}"></i></div>
        <span class="v">${Math.round(x.score)}</span></div>`).join('')}
    </section>

    <section class="section">
      <div class="section-head"><div><h2>Berita Geopolitik Terkini</h2><p>Disaring otomatis dari berita Yahoo Finance (bahasa Inggris)</p></div></div>
      <div class="card news-list">${(G.news || []).slice(0, 25).map(newsItem).join('') || '<div class="empty small">Belum ada berita.</div>'}</div>
    </section>

    <p class="disclaimer">Analisis geopolitik bersifat model: eksposur ditentukan dari industri, profil bisnis, domisili, dan berita — bukan dari rincian pendapatan per negara. Peristiwa geopolitik sulit diprediksi; gunakan sebagai salah satu pertimbangan, bukan satu-satunya.</p>
  </div>`;
}

/* ------------------------------------------------------------ kartu di halaman detail */
function geoCard(s) {
  const g = s.geo;
  if (!g || !App.data.geo) return '';
  const rows = Object.keys(g.exp).filter((k) => Math.abs(g.exp[k]) >= 0.1)
    .sort((a, b) => Math.abs(g.impact[b]) - Math.abs(g.impact[a])).slice(0, 7);
  const riskCls = { Rendah: 'r-BUY', Sedang: 'r-HOLD', Tinggi: 'r-HINDARI', 'Sangat Tinggi': 'r-HINDARI' }[g.risk_label] || 'r-HOLD';
  return `<div class="card card-pad" style="order:4">
    <h3 class="card-title"><span class="ico">🌍</span>Analisis Geopolitik</h3>
    <div class="geo-head">${ring(g.score)}
      <div style="flex:1"><div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><b>Ketahanan ${Math.round(g.score)}/100</b><span class="badge ${riskCls}">Risiko ${esc(g.risk_label)}</span></div>
      <div class="small faint">Bobot 5% dalam skor akhir · Stres global saat ini ${Math.round(App.data.geo.gsi)} (${esc(App.data.geo.gsi_label)})</div></div></div>
    <div class="kv" style="margin:12px 0">
      <div><div class="l">Tekanan risiko</div><div class="bar" style="margin-top:7px"><i style="width:${g.risk}%;background:var(--down)"></i></div><div class="s">${Math.round(g.risk)}/100</div></div>
      <div><div class="l">Peluang</div><div class="bar" style="margin-top:7px"><i style="width:${g.opp}%;background:var(--up)"></i></div><div class="s">${Math.round(g.opp)}/100</div></div>
    </div>
    ${rows.length ? `<div class="small faint" style="margin-bottom:6px">Eksposur per tema (← dirugikan · diuntungkan →)</div>
    <div class="geo-rows">${rows.map((k) => {
      const t = geoTheme(k) || { name: k, icon: '', intensity: 0 };
      const e = g.exp[k], w = Math.abs(e) * 50;
      return `<a class="geo-row" href="#/geo"><span class="name">${t.icon} ${esc(t.name)}<small>Intensitas tema ${Math.round(t.intensity)}</small></span>
        <div class="dbar"><span class="mid"></span><i style="left:${e >= 0 ? 50 : 50 - w}%;width:${w}%;background:${e >= 0 ? 'var(--up)' : 'var(--down)'}"></i></div>
        <span class="v ${e >= 0 ? 'up' : 'down'}">${e > 0 ? '+' : ''}${e.toFixed(1)}</span></a>`;
    }).join('')}</div>` : '<p class="small muted">Eksposur geopolitik minimal — bisnis didominasi pasar domestik.</p>'}
    ${g.evidence && g.evidence.length ? `<div class="small" style="margin-top:12px"><b>Dasar penilaian:</b><ul class="geo-ev">${g.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}<li>Industri: ${esc(s.industry)}${s.country ? ' · Domisili: ' + esc(s.country) : ''}</li></ul></div>` : ''}
    ${g.news && g.news.length ? `<div style="margin-top:10px"><b class="small">Berita terkait:</b>${g.news.map(newsItem).join('')}</div>` : ''}
  </div>`;
}

/* ------------------------------------------------------------ kartu ringkas di Beranda */
function geoHomeCard() {
  const G = App.data.geo;
  if (!G) return '';
  const top = G.themes.slice(0, 3);
  return `<a class="card card-pad geo-mini section" href="#/geo">
    <div style="display:flex;align-items:center;gap:14px">
      <div class="geo-mini-g">${gauge(G.gsi)}</div>
      <div style="flex:1;min-width:0">
        <div class="mk-label">🌍 Stres Geopolitik · <span style="color:${stressColor(G.gsi)}">${esc(G.gsi_label)}</span></div>
        <div class="small" style="margin-top:4px"><b>Tema dominan:</b> ${top.map((t) => `${t.icon} ${esc(t.name)} <span class="mono" style="color:${stressColor(t.intensity)}">${Math.round(t.intensity)}</span>`).join(' · ')}</div>
        <div class="link" style="margin-top:6px">Lihat analisis geopolitik ›</div>
      </div></div></a>`;
}
