"""
ETF indeks untuk mode "inti ETF + satelit" (tersedia di Pluang & broker saham AS lain).
Menulis riwayat 10 tahun ke docs/data/history/{SYM}.json dan mengembalikan ringkasan untuk stocks.json ("etfs").
Bisa dijalankan sendiri:  python scripts/etf.py   (memperbarui history + menyisipkan ke stocks.json)
"""
import json
import math
import os

import numpy as np
import yfinance as yf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HIST_DIR = os.path.join(ROOT, "docs", "data", "history")

# biaya tahunan (expense ratio) dari prospektus penerbit; jarang berubah
ETFS = [
    ("VOO", "Vanguard S&P 500 ETF", "500 perusahaan terbesar AS — inti paling umum", 0.0003),
    ("IVV", "iShares Core S&P 500 ETF", "S&P 500, setara VOO", 0.0003),
    ("SPY", "SPDR S&P 500 ETF", "S&P 500 tertua & paling likuid (biaya sedikit lebih tinggi)", 0.0009),
    ("VTI", "Vanguard Total Stock Market ETF", "seluruh pasar saham AS (±3.600 saham)", 0.0003),
    ("QQQ", "Invesco QQQ (Nasdaq-100)", "100 saham non-keuangan terbesar Nasdaq — condong teknologi, lebih volatil", 0.0020),
    ("QQQM", "Invesco Nasdaq-100 ETF (QQQM)", "sama dengan QQQ, biaya lebih murah, harga per unit lebih kecil", 0.0015),
    ("SCHD", "Schwab US Dividend Equity ETF", "saham dividen berkualitas — lebih tenang, pertumbuhan lebih lambat", 0.0006),
]


def _r(x, n=4):
    return None if x is None or not math.isfinite(x) else round(float(x), n)


def build(log=print, write_hist=True):
    syms = [e[0] for e in ETFS]
    df = yf.download(syms, period="10y", interval="1d", auto_adjust=True, progress=False, group_by="ticker", threads=True)
    out = []
    for sym, name, desc, er in ETFS:
        try:
            c = df[sym]["Close"].astype(float).dropna()
        except Exception:  # noqa: BLE001
            continue
        if len(c) < 260:
            continue
        p = float(c.iloc[-1])
        rets = c.pct_change().dropna()
        yrs = (c.index[-1] - c.index[0]).days / 365.25

        def cagr(n_years):
            k = int(round(252 * n_years))
            if len(c) <= k:
                return None
            return (p / float(c.iloc[-k - 1])) ** (1 / n_years) - 1

        dd = float((c / c.cummax() - 1).min())
        vol = float(rets.iloc[-252:].std() * np.sqrt(252))
        div = None
        try:
            info = yf.Ticker(sym).info or {}
            div = info.get("yield") or info.get("dividendYield") or info.get("trailingAnnualDividendYield")
            if div and div > 1:  # sebagian versi yfinance memberi persen
                div = div / 100
        except Exception:  # noqa: BLE001
            pass
        out.append({
            "sym": sym, "name": name, "desc": desc, "er": er, "price": _r(p, 2),
            "chg1d": _r(p / float(c.iloc[-2]) - 1), "r1y": _r(cagr(1)), "r5y": _r(cagr(5)), "r10y": _r(cagr(min(10, yrs - 0.05))),
            "vol": _r(vol, 3), "dd": _r(dd, 3), "div": _r(div, 4),
        })
        if write_hist:
            with open(os.path.join(HIST_DIR, f"{sym}.json"), "w", encoding="utf-8") as fh:
                json.dump({"d": [ix.strftime("%Y-%m-%d") for ix in c.index], "c": [round(float(x), 2) for x in c.values]}, fh, separators=(",", ":"))
    log(f"  ETF: {len(out)}/{len(ETFS)}")
    if write_hist:
        fx_history(log)
    return out


def fx_history(log=print):
    """Kurs USD/IDR harian 10 thn (untuk harga perolehan dalam rupiah di ringkasan SPT)."""
    try:
        c = yf.download("IDR=X", period="10y", interval="1d", auto_adjust=True, progress=False)["Close"].squeeze().astype(float).dropna()
        c = c[(c > 5000) & (c < 50000)]  # buang data rusak
        with open(os.path.join(HIST_DIR, "USDIDR.json"), "w", encoding="utf-8") as fh:
            json.dump({"d": [ix.strftime("%Y-%m-%d") for ix in c.index], "c": [round(float(x), 1) for x in c.values]}, fh, separators=(",", ":"))
        log(f"  kurs USD/IDR: {len(c)} hari")
    except Exception as e:  # noqa: BLE001
        log(f"  kurs USD/IDR gagal: {e}")


if __name__ == "__main__":
    etfs = build()
    path = os.path.join(ROOT, "docs", "data", "stocks.json")
    with open(path, encoding="utf-8") as fh:
        d = json.load(fh)
    d["etfs"] = etfs
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(d, fh, ensure_ascii=False, separators=(",", ":"))
    print(json.dumps(etfs, indent=1)[:1500])
