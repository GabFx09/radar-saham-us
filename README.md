# Radar Saham US

Screener saham Amerika yang mengutamakan fundamental, dilengkapi analisis teknikal. Untuk setiap saham tersedia:
skor 0–100, rekomendasi (Strong Buy / Buy / Hold / Hindari), **alasan kenapa layak dibeli**, risiko,
**proyeksi kenaikan (%)** ke nilai wajar, skenario bear/bull, dan rencana trading.
Bisa di-install di HP seperti aplikasi (PWA).

## Isi folder

| Path | Fungsi |
|---|---|
| `scripts/screener.py` | Mesin analisis: unduh data Yahoo Finance → skor → nilai wajar → narasi → `docs/data/` |
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

- **Skor = 70% fundamental + 20% teknikal + 10% konsensus analis**
- Fundamental: Kualitas 30% (ROIC, ROE, margin, FCF), Valuasi 28% (P/E fwd, PEG, EV/EBITDA, FCF yield),
  Pertumbuhan 22%, Kesehatan 20% (Piotroski, Altman Z, utang). Tiap metrik dinilai relatif terhadap sektornya dan terhadap ambang absolut.
- Nilai wajar = DCF free cash flow (35%) + multiple P/E wajar sektor (30%) + target analis (35%).

Detail lengkap ada di halaman **Metodologi** di aplikasi.

> Bukan nasihat investasi. Proyeksi adalah estimasi model dan bisa meleset.
