# Radar Saham US

Screener saham Amerika yang mengutamakan fundamental, dilengkapi analisis teknikal. Untuk setiap saham tersedia:
skor 0–100, rekomendasi (Strong Buy / Buy / Hold / Hindari), **alasan kenapa layak dibeli**, risiko,
**proyeksi kenaikan (%)** ke nilai wajar, skenario bear/bull, dan rencana trading.
Bisa di-install di HP seperti aplikasi (PWA). Tampilan bergaya terminal keuangan: ketik ticker atau perintah
(`HELP`, `MAKRO`, `HEAT`, `CMP NVDA AMD`, `SCR STRONG` …) di baris perintah, tekan `/` untuk fokus dan `1`–`9` untuk pindah halaman.

## Isi folder

| Path | Fungsi |
|---|---|
| `scripts/screener.py` | Mesin analisis: unduh data Yahoo Finance → skor → nilai wajar → narasi → `docs/data/` |
| `scripts/geopolitik.py` | Indeks stres geopolitik, 10 tema, eksposur per saham |
| `scripts/siklus.py` | Siklus pasar ~100 tahun S&P 500: bull/bear, siklus presiden, musiman, mean reversion, FFT |
| `scripts/makro.py` | Monitor makro: lintas aset, kurva yield & resesi, Fear & Greed, rotasi sektor, revisi estimasi EPS |
| `scripts/notify.py` | Notifikasi Telegram: ringkasan pagi, alert harga, berita penting |
| `scripts/berita.py` | Penilai tingkat kepentingan berita (akuisisi, investigasi, The Fed, perang, dll.) |
| `scripts/quant.py` | Monte Carlo, metrik risiko, profil faktor, model portofolio, rekam jejak |
| `docs/` | Web app (HTML/CSS/JS murni, tanpa build) |
| `.github/workflows/update-data.yml` | Update data otomatis setiap hari bursa |

## Jalankan di komputer

```bash
pip install -r requirements.txt
python scripts/screener.py          # ±2–10 menit untuk ~530 saham
python -m http.server 8765 -d docs  # buka http://localhost:8765
```

Opsi: `--limit 50` (uji cepat), `--tickers AAPL,MSFT,NVDA` (daftar sendiri).

**Buka di HP (Wi-Fi yang sama):** buka `http://IP-KOMPUTER:8765` (cek IP dengan `ipconfig`).
Untuk mode aplikasi penuh dan offline, HP butuh HTTPS, jadi pakai cara online di bawah.

## Online + install di HP (gratis, update otomatis)

1. Buat repo di GitHub, lalu push folder ini.
2. **Settings → Pages** → Source: *Deploy from a branch* → branch `main`, folder `/docs`.
3. **Settings → Actions → General** → *Workflow permissions* → **Read and write**.
4. Buka `https://USERNAME.github.io/NAMA-REPO/` di HP:
   - **Android (Chrome):** ketuk tombol unduh hijau di pojok kanan atas, atau menu ⋮ → *Instal aplikasi*.
   - **iPhone (Safari):** Bagikan → *Tambahkan ke Layar Utama*.

Data diperbarui otomatis Senin–Jumat sekitar pukul 05.30 WIB. Untuk update manual: tab **Actions → Update data screener → Run workflow**.

## Metodologi singkat

- **Skor = 65% fundamental + 20% teknikal + 10% konsensus analis + 5% ketahanan geopolitik**
- Fundamental: Kualitas 30% (ROIC, ROE, margin, FCF), Valuasi 28% (P/E fwd, PEG, EV/EBITDA, FCF yield),
  Pertumbuhan 22%, Kesehatan 20% (Piotroski, Altman Z, utang). Tiap metrik dinilai relatif terhadap sektornya dan terhadap ambang absolut.
- Nilai wajar = DCF free cash flow (35%) + multiple P/E wajar sektor (30%) + target analis (35%).
- Geopolitik (`scripts/geopolitik.py`): Indeks Stres Geopolitik harian dari VIX, emas, minyak, dolar, dan ETF
  pertahanan/Tiongkok/Taiwan/chip; intensitas 10 tema (tarif, chip & Taiwan, Timur Tengah, Rusia–Ukraina,
  reshoring, siber, rantai pasok, dolar & sanksi, mineral kritis, regulasi Big Tech) dari pasar + berita;
  eksposur tiap saham dari industri, profil bisnis, domisili, dan berita perusahaan.

- Kuantitatif (`scripts/quant.py`): simulasi Monte Carlo 3.000 jalur per saham (bootstrap return historis,
  volatilitas EWMA, return harapan = pandangan model + CAPM ala Black–Litterman); volatilitas, max drawdown,
  Sharpe/Sortino, beta, VaR; profil faktor; model portofolio mean-variance (konservatif/seimbang/agresif) dengan
  kovarians shrinkage + backtest; rekam jejak harian rekomendasi vs S&P 500 (`docs/data/track.json`).

Detail lengkap ada di halaman **Metodologi** di aplikasi.

> Bukan nasihat investasi. Proyeksi adalah estimasi model dan bisa meleset.

## Notifikasi via Kabar

Alert harga, berita sangat penting, dan ringkasan pagi dikirim ke **[Kabar](https://github.com/GabFx09/kabar)** —
aplikasi kotak pesan terpisah (bisa dipakai juga untuk notifikasi lain) — di saluran "Radar Saham", lengkap dengan
notifikasi push di HP. Secret repo yang dibutuhkan: `KABAR_TOKEN`, `KABAR_VAPID`, dan `GIST_TOKEN` (watchlist & alert
dari aplikasi). `scripts/kabar.py` adalah salinan pustaka pengirim dari repo Kabar.

Tab **Pesan** di aplikasi ini berisi Radar Bot: ketik ticker atau perintah (`/top`, `/makro`, `/berita`, `/laporan`,
`/alert NVDA >200`).

### Telegram (opsional)

Buka halaman **Pengaturan** di aplikasi (ikon lonceng) untuk panduan lengkap. Singkatnya, simpan tiga secret repo:
`TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`, dan `GIST_TOKEN` (token GitHub ber-scope gist — sama dengan yang dipakai untuk
sinkronisasi watchlist). Workflow **Alert harga & berita penting** berjalan tiap 30 menit: berita sangat penting
dicek sepanjang hari, alert harga hanya saat bursa AS buka.
