#!/usr/bin/env python3
"""
Screener Saham US — mesin analisis fundamental + teknikal.

Bobot skor akhir:
  - Fundamental 70%  (Kualitas 30%, Valuasi 28%, Pertumbuhan 22%, Kesehatan Keuangan 20%)
  - Teknikal    20%
  - Konsensus analis 10%

Proyeksi kenaikan = nilai wajar gabungan dari 3 metode
  (DCF free cash flow / model P/B-ROE untuk bank, multiple P/E wajar sektor, target analis)
dibanding harga sekarang.

Pemakaian:
  python scripts/screener.py                 # S&P 500 + saham growth populer
  python scripts/screener.py --limit 50      # uji cepat 50 saham
  python scripts/screener.py --tickers AAPL,MSFT,NVDA
"""
import argparse
import datetime as dt
import io
import json
import math
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import pandas as pd
import requests
import yfinance as yf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import geopolitik  # noqa: E402
import quant  # noqa: E402
import siklus  # noqa: E402
import makro  # noqa: E402
import aliran  # noqa: E402
import zlib  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "docs", "data")
HIST_DIR = os.path.join(OUT_DIR, "history")

SP500_CSV = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"

# Saham growth/populer di luar S&P 500 (yang laporan keuangannya dalam USD)
EXTRAS = [
    "SHOP", "MELI", "NU", "SE", "SNOW", "NET", "MDB", "ZS", "SOFI", "RKLB", "DUOL", "CELH",
    "TEAM", "COIN", "ONON", "CAVA", "ARM", "HIMS", "AFRM", "TOST", "IOT", "PINS", "RBLX",
    "U", "ROKU", "SFM", "ELF", "FN", "CRDO", "ALAB", "ASTS", "OKLO", "IONQ", "NBIS", "CVNA",
]

FALLBACK = [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AVGO", "TSLA", "BRK-B", "JPM", "LLY", "V",
    "UNH", "XOM", "MA", "JNJ", "PG", "HD", "COST", "ABBV", "MRK", "ORCL", "CVX", "KO", "PEP",
    "ADBE", "CRM", "WMT", "BAC", "NFLX", "AMD", "TMO", "MCD", "CSCO", "ACN", "ABT", "LIN", "DHR",
    "INTU", "TXN", "QCOM", "WFC", "PM", "AMGN", "CAT", "IBM", "GE", "NOW", "ISRG", "SPGI", "UBER",
    "BKNG", "GS", "AXP", "PLTR", "LRCX", "AMAT", "KLAC", "PANW", "ANET", "CRWD", "MU", "ADI",
    "SNPS", "CDNS", "VRTX", "REGN", "BSX", "SYK", "MDT", "ELV", "CI", "MCK", "COR", "HCA", "LOW",
    "TJX", "NKE", "SBUX", "CMG", "ORLY", "AZO", "DE", "HON", "UNP", "LMT", "RTX", "NOC", "GD",
    "ETN", "PH", "ITW", "WM", "RSG", "CTAS", "ADP", "PAYX", "FI", "PYPL", "MS", "SCHW", "BLK",
    "C", "CB", "PGR", "MMC", "AON", "ICE", "CME", "MCO", "NEE", "SO", "DUK", "AMT", "PLD", "EQIX",
    "COP", "EOG", "SLB", "MPC", "PSX", "FCX", "NEM", "SHW", "APD", "ECL", "DIS", "CMCSA", "T", "VZ",
    "TMUS", "MO", "MDLZ", "CL", "KMB", "GIS", "HSY", "MNST", "KDP", "DECK", "LULU", "FTNT", "DDOG",
    "APP", "VST", "CEG", "GEV", "TTD", "ABNB", "DASH", "MAR", "HLT", "RCL", "URI", "FAST", "ODFL",
] + EXTRAS

SECTOR_ID = {
    "Technology": "Teknologi",
    "Healthcare": "Kesehatan",
    "Financial Services": "Keuangan",
    "Consumer Cyclical": "Konsumen Siklikal",
    "Consumer Defensive": "Konsumen Primer",
    "Industrials": "Industri",
    "Energy": "Energi",
    "Utilities": "Utilitas",
    "Real Estate": "Properti",
    "Basic Materials": "Bahan Baku",
    "Communication Services": "Komunikasi",
}

RISK_FREE = 0.043
EQUITY_PREMIUM = 0.05
TERMINAL_G = 0.03


# ----------------------------------------------------------------------------- utilitas
def sf(x):
    """safe float: None untuk NaN/inf/invalid"""
    try:
        if x is None:
            return None
        x = float(x)
        return x if math.isfinite(x) else None
    except Exception:
        return None


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def div(a, b):
    a, b = sf(a), sf(b)
    if a is None or b is None or b == 0:
        return None
    return a / b


def srow(df, names, col=0):
    if df is None or getattr(df, "empty", True):
        return None
    if isinstance(names, str):
        names = [names]
    for n in names:
        if n in df.index and col < df.shape[1]:
            v = sf(df.loc[n].iloc[col])
            if v is not None:
                return v
    return None


def sseries(df, names, n=4):
    return [srow(df, names, i) for i in range(n)]


def cagr(new, old, years):
    if new is None or old is None or old <= 0 or new <= 0 or years <= 0:
        return None
    return (new / old) ** (1 / years) - 1


def lin(x, bad, good):
    """skor absolut 0..100, linear antara 'bad' dan 'good' (boleh terbalik)."""
    if x is None:
        return None
    if good == bad:
        return 50.0
    t = (x - bad) / (good - bad)
    return 100.0 * clamp(t, 0.0, 1.0)


def r(x, n=4):
    x = sf(x)
    return None if x is None else round(x, n)


def log(*a):
    print(*a, flush=True)


def next_earnings(info):
    """Tanggal laporan keuangan berikutnya. Yahoo: earningsTimestamp = laporan TERAKHIR,
    earningsTimestampStart/End = jendela laporan berikutnya."""
    now = time.time() - 86400
    for k in ("earningsTimestampStart", "earningsCallTimestampStart", "earningsTimestamp", "earningsTimestampEnd"):
        v = info.get(k)
        if isinstance(v, (int, float)) and v > now:
            return int(v)
    return None


# kelas saham ganda: simpan satu kelas saja agar daftar & portofolio tidak dobel
DUP_CLASSES = {"GOOG", "FOX", "NWS"}


def sp400():
    """Konstituen S&P MidCap 400 dari Wikipedia (kosong bila gagal — universe tetap S&P 500)."""
    try:
        r_ = requests.get("https://en.wikipedia.org/wiki/List_of_S%26P_400_companies", timeout=30,
                          headers={"User-Agent": "Mozilla/5.0 (compatible; radar-saham/1.0)"})
        r_.raise_for_status()
        for t in pd.read_html(io.StringIO(r_.text)):
            col = next((c for c in t.columns if str(c).lower() in ("symbol", "ticker", "ticker symbol")), None)
            if col is not None and len(t) > 300:
                return [str(x).strip().replace(".", "-") for x in t[col].tolist() if str(x).strip()]
    except Exception as e:  # noqa: BLE001
        log(f"Gagal ambil S&P 400 ({e}) — lanjut tanpa mid cap")
    return []


def fetch_monthly(symbols):
    """Harga penutupan bulanan 5 tahun (untuk valuasi vs riwayat sendiri)."""
    out = {}
    for i in range(0, len(symbols), 100):
        part = symbols[i:i + 100]
        for attempt in range(2):
            try:
                df = yf.download(part, period="5y", interval="1mo", auto_adjust=False, group_by="ticker",
                                 threads=True, progress=False)
                break
            except Exception:  # noqa: BLE001
                df = None
                time.sleep(3)
        if df is None:
            continue
        for s_ in part:
            try:
                sub = df[s_] if isinstance(df.columns, pd.MultiIndex) else df
                c = sub["Close"].dropna()
                if len(c) > 12:
                    out[s_] = c
            except Exception:  # noqa: BLE001
                pass
    return out


def own_valuation(inc, mclose, pe_now, ps_now):
    """P/E & P/S tiap akhir tahun fiskal (≤4 thn) dari laporan + harga bulanan -> premi/diskon vs median sendiri."""
    if inc is None or inc.empty or mclose is None or len(mclose) < 12:
        return None
    eps = sseries(inc, ["Diluted EPS", "Basic EPS"], 4)
    rev = sseries(inc, "Total Revenue", 4)
    sh = sseries(inc, ["Diluted Average Shares", "Basic Average Shares"], 4)
    idx = mclose.index.tz_localize(None) if getattr(mclose.index, "tz", None) is not None else mclose.index
    mc = pd.Series(mclose.values, index=idx)
    pes, pss, yrs = [], [], []
    for i, col in enumerate(list(inc.columns)[:4]):
        d = pd.Timestamp(col)
        px = mc[mc.index <= d]
        if not len(px):
            continue
        p = float(px.iloc[-1])
        if eps[i] and eps[i] > 0:
            pes.append(p / eps[i])
        if rev[i] and sh[i] and sh[i] > 0:
            pss.append(p / (rev[i] / sh[i]))
        yrs.append(d.year)
    out = {"years": yrs}
    if len(pes) >= 2 and pe_now and pe_now > 0:
        med = float(np.median(pes))
        out.update({"pe_med": r(med, 1), "pe_min": r(min(pes), 1), "pe_max": r(max(pes), 1), "pe_own": r(pe_now / med - 1, 4)})
    if len(pss) >= 2 and ps_now and ps_now > 0:
        med = float(np.median(pss))
        out.update({"ps_med": r(med, 2), "ps_own": r(ps_now / med - 1, 4)})
    return out if len(out) > 1 else None


def next_exdiv(info):
    """Tanggal ex-dividend berikutnya; bila Yahoo hanya punya tanggal lalu, diperkirakan dari frekuensi kuartalan."""
    rate = sf(info.get("dividendRate")) or 0
    ts = info.get("exDividendDate")
    if not rate or not isinstance(ts, (int, float)):
        return None, False
    now = time.time()
    if ts >= now - 86400:
        return int(ts), False
    last = sf(info.get("lastDividendValue")) or 0
    per = int(round(rate / last)) if last else 4
    step = 86400 * (365 / max(1, min(12, per)))
    t = ts
    while t < now - 86400:
        t += step
    return int(t), True


# ----------------------------------------------------------------------------- universe
def get_universe(args):
    if args.tickers:
        return [t.strip().upper().replace(".", "-") for t in args.tickers.split(",") if t.strip()]
    syms = []
    try:
        resp = requests.get(SP500_CSV, timeout=20)
        resp.raise_for_status()
        df = pd.read_csv(io.StringIO(resp.text))
        syms = [str(s).strip().replace(".", "-") for s in df["Symbol"].tolist()]
        log(f"Universe S&P 500: {len(syms)} saham")
    except Exception as e:
        log(f"Gagal ambil daftar S&P 500 ({e}); pakai daftar cadangan.")
        syms = list(FALLBACK)
    if not getattr(args, "tanpa_midcap", False):
        mid = sp400()
        if mid:
            log(f"Universe S&P MidCap 400: {len(mid)} saham")
            syms += [m for m in mid if m not in syms]
    for t in EXTRAS:
        if t not in syms:
            syms.append(t)
    syms = [s for s in dict.fromkeys(syms) if s not in DUP_CLASSES]
    if args.limit:
        syms = syms[: args.limit]
    return syms


# ----------------------------------------------------------------------------- data fetch
CACHE_DIR = os.path.join(ROOT, ".cache", "fund")
CACHE_STATS = {"hit": 0, "miss": 0}


def cache_get(sym, info):
    """Laporan keuangan dari cache bila masih segar: umur < 5-9 hari (tersebar per saham) dan belum ada
    laporan laba baru sejak disimpan. Info harga/rasio tetap diambil segar setiap hari."""
    import pickle
    import zlib as _z
    p = os.path.join(CACHE_DIR, f"{sym}.pkl")
    try:
        with open(p, "rb") as fh:
            d = pickle.load(fh)
    except Exception:  # noqa: BLE001
        CACHE_STATS["miss"] += 1
        return None
    age = time.time() - d.get("t", 0)
    max_age = 86400 * (5 + _z.crc32(sym.encode()) % 5)
    last_earn = info.get("earningsTimestamp") or 0
    if age > max_age or (isinstance(last_earn, (int, float)) and last_earn > d.get("t", 0) - 86400):
        CACHE_STATS["miss"] += 1
        return None
    CACHE_STATS["hit"] += 1
    return d["data"]


def cache_put(sym, data):
    import pickle
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        with open(os.path.join(CACHE_DIR, f"{sym}.pkl"), "wb") as fh:
            pickle.dump({"t": time.time(), "data": data}, fh)
    except Exception:  # noqa: BLE001
        pass


def fetch_fundamentals(sym):
    last_err = None
    for attempt in range(3):
        try:
            t = yf.Ticker(sym)
            info = t.info or {}
            if info.get("quoteType") not in (None, "EQUITY"):
                return sym, None, "bukan saham"
            if not (info.get("currentPrice") or info.get("regularMarketPrice")):
                raise RuntimeError("info kosong")
            cached = cache_get(sym, info)
            if cached:
                return sym, (info, *cached), None
            inc = t.income_stmt
            bal = t.balance_sheet
            cf = t.cashflow
            qinc = qcf = None
            try:  # laporan kuartalan (opsional: kegagalan tidak membatalkan saham ini)
                qinc = t.quarterly_income_stmt
                qcf = t.quarterly_cashflow
            except Exception:
                pass
            cache_put(sym, (inc, bal, cf, qinc, qcf))
            return sym, (info, inc, bal, cf, qinc, qcf), None
        except Exception as e:
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    return sym, None, str(last_err)


def fetch_prices(symbols):
    out = {}
    chunk = 80
    for i in range(0, len(symbols), chunk):
        part = symbols[i : i + chunk]
        for attempt in range(3):
            try:
                df = yf.download(
                    part, period="2y", interval="1d", auto_adjust=True,
                    group_by="ticker", threads=True, progress=False,
                )
                break
            except Exception as e:
                log(f"  download harga gagal ({e}), ulangi...")
                time.sleep(3)
                df = None
        if df is None:
            continue
        for s in part:
            try:
                sub = df[s] if isinstance(df.columns, pd.MultiIndex) else df
                sub = sub.dropna(subset=["Close"])
                if len(sub) > 60:
                    out[s] = sub
            except Exception:
                pass
        log(f"  harga: {min(i + chunk, len(symbols))}/{len(symbols)}")
    # ulangi simbol yang gagal (timeout jaringan) dalam kelompok kecil
    for rnd in (1, 2):
        missing = [s for s in symbols if s not in out]
        if not missing:
            break
        log(f"  ulang unduh harga {len(missing)} simbol (putaran {rnd})...")
        time.sleep(5 * rnd)
        for i in range(0, len(missing), 25):
            part = missing[i : i + 25]
            try:
                df = yf.download(part, period="2y", interval="1d", auto_adjust=True,
                                 group_by="ticker", threads=True, progress=False)
            except Exception:
                continue
            for s in part:
                try:
                    sub = df[s] if isinstance(df.columns, pd.MultiIndex) else df
                    sub = sub.dropna(subset=["Close"])
                    if len(sub) > 60:
                        out[s] = sub
                except Exception:
                    pass
    return out


# ----------------------------------------------------------------------------- teknikal
def rsi_series(c, n=14):
    d = c.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    rs = up / dn.replace(0, np.nan)
    return 100 - 100 / (1 + rs)


def compute_tech(df, spy_close):
    c = df["Close"].astype(float)
    h = df["High"].astype(float)
    l = df["Low"].astype(float)
    v = df["Volume"].astype(float)
    n = len(c)
    if n < 130:
        return None
    price = float(c.iloc[-1])

    def ret(k):
        return float(c.iloc[-1] / c.iloc[-1 - k] - 1) if n > k else None

    sma50 = c.rolling(50).mean()
    sma200 = c.rolling(200).mean()
    s50 = sf(sma50.iloc[-1])
    s200 = sf(sma200.iloc[-1]) if n >= 200 else None
    s200_prev = sf(sma200.iloc[-21]) if n >= 221 else None
    rsi = sf(rsi_series(c).iloc[-1])
    ema12 = c.ewm(span=12, adjust=False).mean()
    ema26 = c.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    hist = macd - signal
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    atr = sf(tr.rolling(14).mean().iloc[-1])

    last252 = c.iloc[-252:]
    high52 = float(h.iloc[-252:].max())
    low52 = float(l.iloc[-252:].min())
    mom_12_1 = float(c.iloc[-22] / c.iloc[-253] - 1) if n > 253 else ret(min(n - 1, 126))

    rs6 = None
    if spy_close is not None:
        spy = spy_close.reindex(c.index).ffill()
        if len(spy.dropna()) > 127:
            rs6 = ret(126) - float(spy.iloc[-1] / spy.iloc[-127] - 1)

    chg = c.diff().iloc[-50:]
    vol50 = v.iloc[-50:]
    upv = float(vol50[chg > 0].sum())
    dnv = float(vol50[chg < 0].sum())
    ud_ratio = upv / dnv if dnv > 0 else None

    support = float(l.iloc[-63:].min())
    resistance = float(h.iloc[-63:].max())

    t = {
        "price": price,
        "chg1d": float(c.iloc[-1] / c.iloc[-2] - 1),
        "ret1m": ret(21), "ret3m": ret(63), "ret6m": ret(126), "ret1y": ret(252),
        "mom": mom_12_1, "rs6m": rs6,
        "sma50": s50, "sma200": s200,
        "sma200_up": (s200 is not None and s200_prev is not None and s200 > s200_prev),
        "rsi": rsi,
        "macd_hist": sf(hist.iloc[-1]),
        "macd_rising": bool(hist.iloc[-1] > hist.iloc[-4]),
        "atr": atr,
        "high52": high52, "low52": low52,
        "dist_high": price / high52 - 1,
        "ud_ratio": ud_ratio,
        "support": support, "resistance": resistance,
        "vol_avg": float(v.iloc[-50:].mean()),
    }
    # sparkline mingguan 1 tahun
    wk = last252.iloc[::5].tolist() + [price]
    t["spark"] = [round(x, 2) for x in wk]
    return t


def tech_score(t, mom_pct, rs_pct):
    p = t["price"]
    trend = 0.0
    if t["sma200"]:
        trend += 10 if p > t["sma200"] else 0
        trend += 9 if (t["sma50"] and t["sma50"] > t["sma200"]) else 0
        trend += 8 if t["sma200_up"] else 0
    else:
        trend += 13 if (t["sma50"] and p > t["sma50"]) else 0
    trend += 8 if (t["sma50"] and p > t["sma50"]) else 0

    mom = 15 * (mom_pct if mom_pct is not None else 0.5) + 15 * (rs_pct if rs_pct is not None else 0.5)

    rsi = t["rsi"] or 50
    if 40 <= rsi <= 65:
        rs = 15
    elif 65 < rsi <= 72:
        rs = 11
    elif rsi > 72:
        rs = 5
    elif 30 <= rsi < 40:
        rs = 9
    else:
        rs = 7

    m = (5 if (t["macd_hist"] or 0) > 0 else 0) + (5 if t["macd_rising"] else 0)
    dh = t["dist_high"]
    near = 10 * clamp((dh + 0.35) / 0.30, 0, 1)
    return round(clamp(trend + mom + rs + m + near, 0, 100), 1)


# ----------------------------------------------------------------------------- fundamental
def piotroski(inc, bal, cf):
    try:
        ni0, ni1 = srow(inc, "Net Income", 0), srow(inc, "Net Income", 1)
        ta0, ta1, ta2 = sseries(bal, "Total Assets", 3)
        ocf0 = srow(cf, "Operating Cash Flow", 0)
        ltd0 = srow(bal, ["Long Term Debt", "Long Term Debt And Capital Lease Obligation"], 0) or 0
        ltd1 = srow(bal, ["Long Term Debt", "Long Term Debt And Capital Lease Obligation"], 1) or 0
        ca0, ca1 = srow(bal, "Current Assets", 0), srow(bal, "Current Assets", 1)
        cl0, cl1 = srow(bal, "Current Liabilities", 0), srow(bal, "Current Liabilities", 1)
        sh0 = srow(bal, ["Ordinary Shares Number", "Share Issued"], 0)
        sh1 = srow(bal, ["Ordinary Shares Number", "Share Issued"], 1)
        gp0, gp1 = srow(inc, "Gross Profit", 0), srow(inc, "Gross Profit", 1)
        rv0, rv1 = srow(inc, "Total Revenue", 0), srow(inc, "Total Revenue", 1)
        if None in (ni0, ta0, ta1, ocf0):
            return None, None
        roa0 = ni0 / ta0
        roa1 = (ni1 / ta1) if (ni1 is not None and ta1) else None
        checks = [
            ["Laba bersih positif", ni0 > 0],
            ["Arus kas operasi positif", ocf0 > 0],
            ["ROA meningkat", roa1 is not None and roa0 > roa1],
            ["Kas operasi > laba bersih (kualitas laba)", ocf0 > ni0],
            ["Rasio utang jangka panjang turun", (ltd0 / ta0) <= (ltd1 / ta1) if ta1 else False],
            ["Current ratio membaik",
             (ca0 and cl0 and ca1 and cl1) and (ca0 / cl0 > ca1 / cl1) or False],
            ["Tidak ada dilusi saham", (sh0 is not None and sh1 is not None and sh0 <= sh1 * 1.005)],
            ["Gross margin membaik",
             (gp0 and rv0 and gp1 and rv1) and (gp0 / rv0 > gp1 / rv1) or False],
            ["Perputaran aset membaik",
             (rv0 and rv1 and ta1 and ta2) and (rv0 / ta1 > rv1 / ta2) or
             ((rv0 and rv1) and (rv0 / ta0 > rv1 / ta1)) or False],
        ]
        checks = [[a, bool(b)] for a, b in checks]
        return sum(1 for _, b in checks if b), checks
    except Exception:
        return None, None


def quarterly(qinc, qcf):
    """Ringkasan laporan kuartalan: FCF 12 bulan terakhir (TTM), pertumbuhan pendapatan YoY per kuartal
    (dan percepatannya), margin operasi TTM vs 12 bulan sebelumnya, serta riwayat 6 kuartal untuk grafik."""
    try:
        if qinc is None or qinc.empty:
            return None
        cols = sorted(qinc.columns, reverse=True)[:9]

        def row(df, names):
            if df is None or df.empty:
                return None
            for n in ([names] if isinstance(names, str) else names):
                if n in df.index:
                    return df.loc[n]
            return None
        rev = row(qinc, "Total Revenue")
        ni = row(qinc, ["Net Income", "Net Income Common Stockholders"])
        op = row(qinc, ["Operating Income", "EBIT"])
        fcf = row(qcf, "Free Cash Flow")
        ocf = row(qcf, "Operating Cash Flow")
        capex = row(qcf, "Capital Expenditure")

        def g(ser, c):
            if ser is None or c not in ser.index:
                return None
            return sf(ser.get(c))
        q = []
        for c in cols:
            fc = g(fcf, c)
            if fc is None and g(ocf, c) is not None:
                fc = g(ocf, c) + (g(capex, c) or 0)
            q.append({"d": str(c)[:10], "rev": g(rev, c), "ni": g(ni, c), "op": g(op, c), "fcf": fc})
        out = {}
        f4 = [x["fcf"] for x in q[:4]]
        out["fcf_ttm"] = sum(f4) if len(f4) == 4 and all(v is not None for v in f4) else None
        rv = [x["rev"] for x in q]

        def yoy(i):
            if len(rv) > i + 4 and rv[i] and rv[i + 4] and rv[i + 4] > 0:
                return rv[i] / rv[i + 4] - 1
            return None
        out["rev_yoy"], out["rev_yoy_prev"] = yoy(0), yoy(1)
        out["accel"] = out["rev_yoy"] - out["rev_yoy_prev"] if None not in (out["rev_yoy"], out["rev_yoy_prev"]) else None

        def opm(a, b):
            seg = q[a:b]
            if len(seg) == 4 and all(x["op"] is not None and x["rev"] for x in seg):
                return sum(x["op"] for x in seg) / sum(x["rev"] for x in seg)
            return None
        out["opm_ttm"], out["opm_prev"] = opm(0, 4), opm(4, 8)
        h = [x for x in q[:6] if x["rev"] is not None][::-1]
        out["hist"] = {"d": [x["d"] for x in h], "rev": [r(x["rev"], 0) for x in h], "ni": [r(x["ni"], 0) for x in h],
                       "opm": [r(x["op"] / x["rev"], 4) if x["op"] is not None and x["rev"] else None for x in h],
                       "yoy": [r(rv[q.index(x)] / rv[q.index(x) + 4] - 1, 4)
                               if len(rv) > q.index(x) + 4 and rv[q.index(x) + 4] else None for x in h]}
        return {k: (r(v, 4) if isinstance(v, float) else v) for k, v in out.items()}
    except Exception:
        return None


def compute_fund(info, inc, bal, cf, qinc=None, qcf=None, mclose=None):
    f = {}
    sector = info.get("sector") or "Lainnya"
    is_fin = sector == "Financial Services" and (info.get("industry") or "").find("Insurance") < 0
    is_fin = sector == "Financial Services"
    price = sf(info.get("currentPrice")) or sf(info.get("regularMarketPrice"))
    mcap = sf(info.get("marketCap"))
    shares = sf(info.get("sharesOutstanding")) or (div(mcap, price))
    f["is_fin"] = is_fin

    # --- profitabilitas
    f["roe"] = sf(info.get("returnOnEquity"))
    f["roa"] = sf(info.get("returnOnAssets"))
    f["gross_margin"] = sf(info.get("grossMargins"))
    f["op_margin"] = sf(info.get("operatingMargins"))
    f["net_margin"] = sf(info.get("profitMargins"))
    rev_ttm = sf(info.get("totalRevenue"))
    fcf_ttm = sf(info.get("freeCashflow"))

    rev = sseries(inc, "Total Revenue", 4)
    ni = sseries(inc, ["Net Income", "Net Income Common Stockholders"], 4)
    opi = sseries(inc, ["Operating Income", "EBIT"], 4)
    fcf_hist = sseries(cf, "Free Cash Flow", 4)
    if all(x is None for x in fcf_hist):
        ocf = sseries(cf, "Operating Cash Flow", 4)
        capex = sseries(cf, "Capital Expenditure", 4)
        fcf_hist = [(o + (c or 0)) if o is not None else None for o, c in zip(ocf, capex)]

    # FCF dari laporan arus kas (OCF - capex). Field freeCashflow Yahoo = "levered FCF" → hanya cadangan
    fcf_annual = fcf_hist[0]
    fcf_use = fcf_annual if fcf_annual is not None else fcf_ttm
    # bila laporan kuartalan tersedia: pakai FCF 12 bulan terakhir (lebih segar dari laporan tahunan)
    qd = quarterly(qinc, qcf)
    f["qtr"] = qd
    f["fcf_src"] = "annual"
    if qd and qd.get("fcf_ttm") is not None:
        fcf_use = qd["fcf_ttm"]
        f["fcf_src"] = "ttm"
    f["fcf"] = fcf_use
    # kualitas laba (Sloan): akrual = (laba bersih - arus kas operasi) / total aset — tinggi = laba "kertas"
    ocf0 = srow(cf, "Operating Cash Flow", 0)
    ta0 = srow(bal, "Total Assets", 0)
    f["accruals"] = (ni[0] - ocf0) / ta0 if (ni[0] is not None and ocf0 is not None and ta0 and ta0 > 0 and not is_fin) else None
    # dilusi: perubahan jumlah saham beredar (rata-rata terdilusi) setahun
    shs = sseries(inc, ["Diluted Average Shares", "Basic Average Shares"], 2)
    f["share_chg"] = shs[0] / shs[1] - 1 if (shs[0] and shs[1] and shs[1] > 0) else None
    f["fcf_margin"] = div(fcf_use, rev_ttm or rev[0])

    ebit = srow(inc, ["EBIT", "Operating Income"], 0)
    tax_rate = srow(inc, "Tax Rate For Calcs", 0)
    tax_rate = clamp(tax_rate, 0, 0.35) if tax_rate is not None else 0.21
    inv_cap = srow(bal, "Invested Capital", 0)
    inv_cap1 = srow(bal, "Invested Capital", 1)
    if ebit is not None and inv_cap and inv_cap > 0 and not is_fin:
        avg_ic = (inv_cap + inv_cap1) / 2 if inv_cap1 and inv_cap1 > 0 else inv_cap
        f["roic"] = ebit * (1 - tax_rate) / avg_ic
    else:
        f["roic"] = None

    if opi[0] is not None and opi[1] is not None and rev[0] and rev[1]:
        f["margin_trend"] = opi[0] / rev[0] - opi[1] / rev[1]
    else:
        f["margin_trend"] = None

    equity = srow(bal, ["Stockholders Equity", "Common Stock Equity"], 0)
    if equity is not None and equity <= 0:
        f["roe"] = None  # ekuitas negatif (buyback besar) → ROE tidak bermakna

    # --- pertumbuhan
    f["rev_growth"] = sf(info.get("revenueGrowth"))
    f["earn_growth"] = sf(info.get("earningsGrowth"))
    valid_rev = [(i, x) for i, x in enumerate(rev) if x is not None and x > 0]
    f["rev_cagr3"] = cagr(valid_rev[0][1], valid_rev[-1][1], valid_rev[-1][0] - valid_rev[0][0]) \
        if len(valid_rev) >= 2 else None
    valid_fcf = [(i, x) for i, x in enumerate(fcf_hist) if x is not None]
    f["fcf_cagr3"] = cagr(valid_fcf[0][1], valid_fcf[-1][1], valid_fcf[-1][0] - valid_fcf[0][0]) \
        if len(valid_fcf) >= 2 else None
    teps, feps = sf(info.get("trailingEps")), sf(info.get("forwardEps"))
    f["eps_ttm"], f["eps_fwd"] = teps, feps
    if teps and feps and teps > 0:
        f["eps_growth_fwd"] = clamp(feps / teps - 1, -0.9, 3)
    else:
        f["eps_growth_fwd"] = None

    # --- valuasi
    f["pe_ttm"] = sf(info.get("trailingPE"))
    f["pe_fwd"] = div(price, feps) if feps and feps > 0 else None
    f["ey_fwd"] = div(feps, price)  # earnings yield (negatif kalau rugi)
    ev = sf(info.get("enterpriseValue"))
    ebitda = sf(info.get("ebitda"))
    f["ev_ebitda"] = div(ev, ebitda) if (ebitda and ebitda > 0 and ev and ev > 0) else None
    f["ebitda_ev"] = div(ebitda, ev) if (ev and ev > 0 and ebitda is not None and not is_fin) else None
    f["fcf_yield"] = div(fcf_use, mcap) if not is_fin else None
    f["ps"] = sf(info.get("priceToSalesTrailing12Months"))
    f["pb"] = sf(info.get("priceToBook"))
    g_for_peg = f["eps_growth_fwd"]
    if g_for_peg is None or g_for_peg <= 0.02:
        g_for_peg = f["earn_growth"] if (f["earn_growth"] and f["earn_growth"] > 0.02) else None
    if g_for_peg is not None and f["pe_fwd"]:
        f["peg"] = f["pe_fwd"] / (min(g_for_peg, 0.6) * 100)
    else:
        f["peg"] = None

    # --- kesehatan
    de = sf(info.get("debtToEquity"))
    f["de"] = de / 100 if de is not None and not is_fin else None
    f["current_ratio"] = sf(info.get("currentRatio")) if not is_fin else None
    cash, debt = sf(info.get("totalCash")) or 0, sf(info.get("totalDebt")) or 0
    f["net_debt"] = debt - cash
    f["netdebt_ebitda"] = div(debt - cash, ebitda) if (ebitda and ebitda > 0 and not is_fin) else None
    ie = srow(inc, ["Interest Expense", "Interest Expense Non Operating"], 0)
    if ebit is not None and ie and abs(ie) > 0 and not is_fin:
        f["int_cov"] = clamp(ebit / abs(ie), -50, 100)
    elif ebit and ebit > 0 and not is_fin:
        f["int_cov"] = 100.0
    else:
        f["int_cov"] = None

    f["piotroski"], f["piotroski_checks"] = piotroski(inc, bal, cf)

    f["altman"] = None
    if not is_fin and sector != "Real Estate":
        ta = srow(bal, "Total Assets", 0)
        tl = srow(bal, "Total Liabilities Net Minority Interest", 0)
        wc = srow(bal, "Working Capital", 0)
        re_ = srow(bal, "Retained Earnings", 0)
        if ta and tl and mcap and ebit is not None and rev[0]:
            f["altman"] = clamp(
                1.2 * (wc or 0) / ta + 1.4 * (re_ or 0) / ta + 3.3 * ebit / ta
                + 0.6 * mcap / tl + 1.0 * rev[0] / ta, -5, 20)

    # --- imbal hasil ke pemegang saham
    dps = sf(info.get("dividendRate")) or sf(info.get("trailingAnnualDividendRate"))
    f["div_yield"] = div(dps, price) if dps else 0.0
    f["payout"] = sf(info.get("payoutRatio"))
    buyback = srow(cf, ["Repurchase Of Capital Stock", "Common Stock Payments"], 0)
    issue = srow(cf, ["Issuance Of Capital Stock", "Common Stock Issuance"], 0) or 0
    net_bb = (-(buyback or 0) - issue)
    f["buyback_yield"] = div(net_bb, mcap) if mcap else None
    f["sh_yield"] = (f["div_yield"] or 0) + (f["buyback_yield"] or 0) if f["buyback_yield"] is not None else f["div_yield"]

    # --- analis
    f["rec_mean"] = sf(info.get("recommendationMean"))
    f["n_analysts"] = int(info.get("numberOfAnalystOpinions") or 0)
    f["target_mean"] = sf(info.get("targetMeanPrice"))
    f["target_high"] = sf(info.get("targetHighPrice"))
    f["target_low"] = sf(info.get("targetLowPrice"))
    f["target_upside"] = (f["target_mean"] / price - 1) if (f["target_mean"] and price and f["n_analysts"] >= 3) else None

    # --- lainnya
    f["beta"] = sf(info.get("beta"))
    f["short_float"] = sf(info.get("shortPercentOfFloat"))
    f["insider"] = sf(info.get("heldPercentInsiders"))
    f["inst"] = sf(info.get("heldPercentInstitutions"))
    f["cash"], f["debt"] = cash, debt
    f["shares"] = shares
    f["bvps"] = sf(info.get("bookValue"))
    ov = own_valuation(inc, mclose, f.get("pe_ttm"), f.get("ps"))
    f["own"] = ov
    f["pe_own"] = ov.get("pe_own") if ov else None
    f["ps_own"] = ov.get("ps_own") if ov else None

    years = []
    if inc is not None and not inc.empty:
        years = [str(getattr(c, "year", c)) for c in list(inc.columns)[:4]]
    f["hist"] = {
        "years": years[::-1],
        "revenue": [r(x, 0) for x in rev[: len(years)]][::-1],
        "net_income": [r(x, 0) for x in ni[: len(years)]][::-1],
        "fcf": [r(x, 0) for x in fcf_hist[: len(years)]][::-1],
    }
    return f


# ----------------------------------------------------------------------------- scoring
# (kunci, lebih_tinggi_lebih_baik, nilai_buruk, nilai_bagus, bobot, bobot_khusus_bank)
PILLARS = {
    "quality": [
        ("roic", 0.00, 0.22, 1.5, 0.0),
        ("roe", 0.00, 0.25, 1.1, 2.0),
        ("accruals", 0.10, -0.06, 0.6, 0.0),
        ("roa", 0.00, 0.12, 0.6, 1.5),
        ("gross_margin", 0.15, 0.60, 0.7, 0.0),
        ("op_margin", 0.00, 0.30, 1.0, 0.8),
        ("fcf_margin", 0.00, 0.25, 1.0, 0.0),
        ("margin_trend", -0.04, 0.04, 0.5, 0.5),
        ("sh_yield", 0.00, 0.06, 0.5, 0.8),
    ],
    "growth": [
        ("rev_growth", -0.03, 0.25, 1.0, 1.0),
        ("rev_cagr3", -0.02, 0.20, 1.2, 1.2),
        ("eps_growth_fwd", -0.05, 0.25, 1.3, 1.3),
        ("earn_growth", -0.10, 0.30, 0.6, 0.8),
        ("fcf_cagr3", -0.05, 0.20, 0.6, 0.0),
    ],
    "value": [
        ("ey_fwd", 0.02, 0.08, 1.3, 1.5),       # 1/PE forward
        ("peg", 3.0, 0.8, 1.0, 0.8),
        ("ebitda_ev", 0.03, 0.12, 1.0, 0.0),
        ("fcf_yield", 0.00, 0.08, 1.3, 0.0),
        ("pe_own", 0.60, -0.35, 0.8, 0.8),
        ("ps", 15.0, 1.5, 0.4, 0.0),
        ("pb", 10.0, 1.2, 0.3, 1.5),
    ],
    "health": [
        ("piotroski", 3, 8, 1.5, 1.5),
        ("de", 2.5, 0.3, 1.0, 0.0),
        ("current_ratio", 0.8, 2.0, 0.5, 0.0),
        ("netdebt_ebitda", 4.0, 0.0, 1.0, 0.0),
        ("int_cov", 2.0, 15.0, 0.8, 0.0),
        ("altman", 1.8, 4.0, 0.7, 0.0),
        ("share_chg", 0.10, -0.03, 0.6, 0.4),
    ],
}
PILLAR_W = {"quality": 0.30, "value": 0.28, "growth": 0.22, "health": 0.20}


def percentile_tables(records):
    """Persentil tiap metrik dalam sektor (jika ≥8 emiten) atau seluruh universe."""
    keys = [k for p in PILLARS.values() for k, *_ in p] + ["pe_fwd"]
    rows = []
    for rec in records:
        row = {"sym": rec["sym"], "sector": rec["sector"]}
        for k in keys:
            row[k] = rec["f"].get(k)
        rows.append(row)
    df = pd.DataFrame(rows).set_index("sym")
    pct = pd.DataFrame(index=df.index)
    for k in keys:
        col = pd.to_numeric(df[k], errors="coerce")
        glob = col.rank(pct=True)
        sec = col.groupby(df["sector"]).rank(pct=True)
        cnt = col.groupby(df["sector"]).transform("count")
        pct[k] = np.where(cnt >= 8, sec, glob)
    medians = {}
    for sec, g in df.groupby("sector"):
        pe = pd.to_numeric(g["pe_fwd"], errors="coerce")
        pe = pe[(pe > 0) & (pe < 200)]
        medians[sec] = {
            "pe_fwd": sf(pe.median()) if len(pe) >= 3 else None,
        }
        for k in keys:
            if k == "pe_fwd":
                continue
            col = pd.to_numeric(g[k], errors="coerce").dropna()
            medians[sec][k] = sf(col.median()) if len(col) >= 3 else None
    allpe = pd.to_numeric(df["pe_fwd"], errors="coerce")
    allpe = allpe[(allpe > 0) & (allpe < 200)]
    medians["_all"] = {"pe_fwd": sf(allpe.median())}
    return pct, medians


def pillar_scores(rec, pct):
    f = rec["f"]
    out, details = {}, {}
    for pname, items in PILLARS.items():
        tot, wsum = 0.0, 0.0
        for key, bad, good, w, wfin in items:
            weight = wfin if f["is_fin"] else w
            if weight <= 0:
                continue
            v = f.get(key)
            if v is None:
                continue
            p = sf(pct.at[rec["sym"], key])
            higher_better = good > bad
            if p is None:
                p = 0.5
            p100 = (p if higher_better else 1 - p) * 100
            s = 0.5 * p100 + 0.5 * lin(v, bad, good)
            details[key] = {"score": round(s), "pct": round(p100)}
            tot += s * weight
            wsum += weight
        if wsum == 0:
            out[pname] = 40.0
        else:
            # penalti ringan bila data sedikit
            full = sum((wf if f["is_fin"] else w) for _, _, _, w, wf in items)
            cover = wsum / full if full else 1
            sc = tot / wsum
            out[pname] = round(sc * (0.85 + 0.15 * cover) + 50 * 0.15 * (1 - cover), 1)
    return out, details


def analyst_score(f):
    n = f["n_analysts"]
    if n < 3 or f["rec_mean"] is None:
        return 50.0
    s1 = lin(f["rec_mean"], 3.2, 1.4)
    s2 = lin(f["target_upside"], -0.05, 0.35) if f["target_upside"] is not None else 50
    conf = clamp(n / 15, 0.3, 1.0)
    return round(50 + ((0.55 * s1 + 0.45 * s2) - 50) * conf, 1)


# ----------------------------------------------------------------------------- nilai wajar
def fair_value(rec, medians):
    f, t = rec["f"], rec["t"]
    price = t["price"]
    shares = f["shares"]
    methods = {}
    beta = clamp(f["beta"] if f["beta"] is not None else 1.0, 0.6, 2.0)
    disc = clamp(RISK_FREE + beta * EQUITY_PREMIUM, 0.075, 0.12)

    gs = [(f.get("eps_growth_fwd"), 0.4), (f.get("rev_cagr3"), 0.4), (f.get("fcf_cagr3"), 0.2)]
    gs = [(clamp(g, -0.05, 0.35), w) for g, w in gs if g is not None]
    g = sum(a * w for a, w in gs) / sum(w for _, w in gs) if gs else 0.05
    g = clamp(g, 0.0, 0.22)

    # 1) DCF FCF 2 tahap (non-bank)
    if not f["is_fin"] and shares:
        fcf_last = f["fcf"]
        hist = [x for x in (f["hist"]["fcf"] or []) if x is not None]
        avg3 = sum(hist[-3:]) / len(hist[-3:]) if hist else None
        base = None
        if fcf_last and fcf_last > 0 and avg3 and avg3 > 0:
            base = 0.65 * fcf_last + 0.35 * avg3
        elif fcf_last and fcf_last > 0:
            base = fcf_last
        if base:
            pv, cfv = 0.0, base
            for yr in range(1, 11):
                gy = g if yr <= 5 else g + (TERMINAL_G - g) * (yr - 5) / 5
                cfv *= 1 + gy
                pv += cfv / (1 + disc) ** yr
            tv = cfv * (1 + TERMINAL_G) / (disc - TERMINAL_G)
            pv += tv / (1 + disc) ** 10
            eq = pv + (f["cash"] or 0) - (f["debt"] or 0)
            if eq > 0:
                methods["dcf"] = eq / shares

    # 1b) Model P/B-ROE (bank & keuangan)
    if f["is_fin"] and f["bvps"] and f["roe"]:
        roe = clamp(f["roe"], 0.0, 0.30)
        gg = min(TERMINAL_G + 0.01, roe * 0.5)
        if disc > gg and roe > 0:
            methods["dcf"] = f["bvps"] * (roe - gg) / (disc - gg)

    # 2) multiple P/E wajar
    sec_pe = (medians.get(rec["sector"]) or {}).get("pe_fwd") or medians["_all"]["pe_fwd"] or 20
    qg = (rec["pillars"]["quality"] + rec["pillars"]["growth"]) / 2
    fair_pe = clamp(sec_pe * clamp(0.75 + 0.5 * qg / 100, 0.75, 1.25), 8, 45)
    if f["eps_fwd"] and f["eps_fwd"] > 0:
        eps_next = f["eps_fwd"] * (1 + clamp(g, 0, 0.15) * 0.5)
        methods["multiple"] = eps_next * fair_pe

    # 3) target analis
    if f["target_mean"] and f["n_analysts"] >= 3:
        methods["analyst"] = f["target_mean"]

    # batasi outlier: setiap metode dibatasi -60%..+150% dari harga
    for k in list(methods):
        methods[k] = price * (1 + clamp(methods[k] / price - 1, -0.6, 1.0))

    W = {"dcf": 0.35, "multiple": 0.30, "analyst": 0.35}
    if not methods:
        return None
    fv = sum(methods[k] * W[k] for k in methods) / sum(W[k] for k in methods)
    vals = list(methods.values())
    lo, hi = min(vals), max(vals)
    tl = f["target_low"] if f["target_low"] else lo
    th = f["target_high"] if f["target_high"] else hi
    bear = min(fv, 0.5 * lo + 0.5 * min(tl, lo * 1.1))
    bull = max(fv, 0.5 * hi + 0.5 * max(th, hi * 0.9))
    bear = min(bear, fv * 0.93)
    bull = max(bull, fv * 1.07)
    cv = float(np.std(vals) / np.mean(vals)) if len(vals) > 1 else 0.35
    n = f["n_analysts"]
    if len(vals) >= 3 and cv < 0.15 and n >= 10:
        conf = "Tinggi"
    elif len(vals) >= 2 and cv < 0.30:
        conf = "Sedang"
    else:
        conf = "Rendah"
    # laba melonjak ekstrem (kemungkinan puncak siklus) → keyakinan diturunkan
    if (f.get("eps_growth_fwd") or 0) > 0.6 or (f.get("eps_ttm") or 0) <= 0:
        conf = "Rendah"
    return {
        "fair": fv, "upside": fv / price - 1,
        "bear": bear, "bull": bull,
        "bear_pct": bear / price - 1, "bull_pct": bull / price - 1,
        "methods": methods, "confidence": conf, "cv": cv,
        "growth_used": g, "discount": disc, "fair_pe": fair_pe, "sector_pe": sec_pe,
        "total_return": fv / price - 1 + (f["div_yield"] or 0),
    }


def rating_for(overall, fund, upside, conf=None):
    if upside is None:
        upside = 0
    if overall >= 70 and fund >= 65 and upside >= 0.12 and conf != "Rendah":
        return "STRONG BUY"
    if overall >= 60 and fund >= 55 and upside >= 0.05:
        return "BUY"
    if (overall >= 45 and upside >= -0.10) or (fund >= 62 and upside >= -0.25):
        return "HOLD"
    return "HINDARI"


# ----------------------------------------------------------------------------- narasi
def pct(x, d=0):
    return f"{x * 100:.{d}f}%"


def money(x):
    if x is None:
        return "-"
    a = abs(x)
    s = "-" if x < 0 else ""
    if a >= 1e12:
        return f"{s}${a / 1e12:.2f} T"
    if a >= 1e9:
        return f"{s}${a / 1e9:.1f} M"
    if a >= 1e6:
        return f"{s}${a / 1e6:.0f} jt"
    return f"{s}${a:,.0f}"


def build_reasons(rec, medians):
    f, t, v, d = rec["f"], rec["t"], rec["val"], rec["details"]
    sec = rec["sector_id"]
    med = medians.get(rec["sector"], {})
    pros, cons = [], []

    def P(score, text, tag):
        pros.append({"s": score, "text": text, "tag": tag})

    def C(score, text, tag):
        cons.append({"s": score, "text": text, "tag": tag})

    def sp(key):
        return d.get(key, {}).get("pct")

    # ---- kualitas
    if f["roic"] is not None and f["roic"] >= 0.15:
        P(70 + min(f["roic"], 0.6) * 50,
          f"ROIC {pct(f['roic'])} — bisnis menghasilkan imbal hasil sangat tinggi atas setiap dolar modal "
          f"yang ditanam (lebih baik dari {sp('roic')}% emiten {sec}).", "Kualitas")
    elif f["roe"] is not None and f["roe"] >= 0.18:
        P(65 + min(f["roe"], 0.6) * 40,
          f"ROE {pct(f['roe'])} — profitabilitas atas modal pemegang saham sangat tinggi "
          f"(top {100 - (sp('roe') or 50)}% di sektor {sec}).", "Kualitas")
    if f["op_margin"] is not None and f["op_margin"] >= 0.20:
        extra = ""
        if f["margin_trend"] is not None and f["margin_trend"] > 0.01:
            extra = f" dan masih melebar {f['margin_trend'] * 100:.1f} poin dari tahun lalu"
        P(62 + f["op_margin"] * 40, f"Margin operasi {pct(f['op_margin'])}{extra} — tanda pricing power "
          f"dan keunggulan kompetitif (moat).", "Kualitas")
    elif f["margin_trend"] is not None and f["margin_trend"] > 0.02:
        P(60, f"Margin operasi melebar {f['margin_trend'] * 100:.1f} poin dibanding tahun lalu — efisiensi "
          f"bisnis meningkat.", "Kualitas")
    if f["fcf_yield"] is not None and f["fcf_yield"] >= 0.04:
        P(65 + min(f["fcf_yield"], 0.15) * 200,
          f"Free cash flow yield {pct(f['fcf_yield'], 1)}: setiap $100 nilai saham menghasilkan "
          f"${f['fcf_yield'] * 100:.1f} kas bebas per tahun ({money(f['fcf'])}).", "Valuasi")
    elif f["fcf_margin"] is not None and f["fcf_margin"] >= 0.20:
        P(62, f"Mesin uang: {pct(f['fcf_margin'])} dari pendapatan berubah menjadi free cash flow.", "Kualitas")

    # ---- pertumbuhan
    if f["rev_cagr3"] is not None and f["rev_cagr3"] >= 0.10:
        P(60 + min(f["rev_cagr3"], 0.5) * 70,
          f"Pendapatan tumbuh rata-rata {pct(f['rev_cagr3'])}/tahun dalam 3 tahun terakhir"
          + (f", kuartal terakhir +{pct(f['rev_growth'])} YoY." if f["rev_growth"] and f["rev_growth"] > 0 else "."),
          "Pertumbuhan")
    elif f["rev_growth"] is not None and f["rev_growth"] >= 0.12:
        P(60 + min(f["rev_growth"], 0.5) * 60, f"Pendapatan kuartal terakhir naik {pct(f['rev_growth'])} YoY.",
          "Pertumbuhan")
    if f["eps_growth_fwd"] is not None and f["eps_growth_fwd"] >= 0.10:
        P(60 + min(f["eps_growth_fwd"], 0.5) * 70,
          f"Laba per saham (EPS) diproyeksikan naik {pct(f['eps_growth_fwd'])} — dari ${f['eps_ttm']:.2f} "
          f"ke ${f['eps_fwd']:.2f}.", "Pertumbuhan")

    # ---- valuasi
    spe = med.get("pe_fwd")
    if f["pe_fwd"] and spe and f["pe_fwd"] < spe * 0.85:
        disc = 1 - f["pe_fwd"] / spe
        P(60 + disc * 60, f"P/E forward {f['pe_fwd']:.1f}x — {pct(disc)} lebih murah dari median sektor "
          f"{sec} ({spe:.1f}x).", "Valuasi")
    if f["peg"] is not None and 0 < f["peg"] <= 1.3:
        P(62 + (1.3 - f["peg"]) * 25, f"PEG ratio {f['peg']:.2f} — pertumbuhan laba belum sepenuhnya "
          f"tercermin di harga (GARP: Growth at Reasonable Price).", "Valuasi")
    if v and v["upside"] >= 0.10:
        P(60 + min(v["upside"], 0.8) * 50,
          f"Estimasi nilai wajar ${v['fair']:.2f} vs harga ${t['price']:.2f} — potensi naik "
          f"{pct(v['upside'])} (rentang ${v['bear']:.0f}–${v['bull']:.0f}).", "Valuasi")

    # ---- kesehatan
    if f["piotroski"] is not None and f["piotroski"] >= 7:
        P(60 + f["piotroski"] * 3, f"Piotroski F-Score {f['piotroski']}/9 — fundamental membaik di hampir "
          f"semua indikator (laba, arus kas, leverage, efisiensi).", "Kesehatan")
    if not f["is_fin"] and f["net_debt"] is not None and f["net_debt"] < 0 and f["fcf"] and f["fcf"] > 0:
        P(66, f"Neraca kuat: kas bersih {money(-f['net_debt'])} (kas melebihi total utang).", "Kesehatan")
    elif f["de"] is not None and f["de"] < 0.5 and (f["int_cov"] or 0) > 10:
        P(60, f"Utang rendah (D/E {f['de']:.2f}x) dan laba operasi menutup bunga {f['int_cov']:.0f}x.",
          "Kesehatan")
    if f["sh_yield"] is not None and f["sh_yield"] >= 0.03:
        dv = f["div_yield"] or 0
        P(58 + min(f["sh_yield"], 0.1) * 150,
          f"Mengembalikan {pct(f['sh_yield'], 1)}/tahun ke pemegang saham (dividen {pct(dv, 1)} + buyback).",
          "Pemegang Saham")

    # ---- geopolitik
    g = rec.get("geo")
    if g:
        TH, gi = geopolitik.THEMES, rec["geo_int"]
        for k, imp in sorted(g["impact"].items(), key=lambda x: -x[1])[:2]:
            if imp >= 0.22:
                P(56 + imp * 40, f"Diuntungkan tema geopolitik {TH[k]['name']} (intensitas "
                  f"{gi[k]:.0f}/100): {TH[k]['desc'].split(' — ')[0].split(':')[0]}.", "Geopolitik")
        for k, imp in sorted(g["impact"].items(), key=lambda x: x[1])[:2]:
            if imp <= -0.25:
                C(58 + (-imp) * 40, f"Rentan terhadap tema {TH[k]['name']} (intensitas {gi[k]:.0f}/100, "
                  f"eksposur {g['exp'][k]:+.1f} dari skala -1 s.d. +1).", "Geopolitik")
        if g["risk"] < 15 and g["score"] >= 60:
            P(54, f"Tahan guncangan geopolitik: eksposur rendah terhadap tarif, konflik, dan rantai pasok "
              f"global (skor ketahanan {g['score']:.0f}/100).", "Geopolitik")

    # ---- analis
    if f["n_analysts"] >= 5 and f["rec_mean"] is not None and f["rec_mean"] <= 2.1:
        label = "Strong Buy" if f["rec_mean"] <= 1.6 else "Buy"
        tu = f" dengan target rata-rata ${f['target_mean']:.2f} ({'+' if f['target_upside'] >= 0 else ''}" \
             f"{pct(f['target_upside'])})" if f["target_upside"] is not None else ""
        P(58 + (2.2 - f["rec_mean"]) * 20 + min(f["n_analysts"], 40) * 0.2,
          f"{f['n_analysts']} analis Wall Street, konsensus {label}{tu}.", "Analis")

    # ---- teknikal
    p = t["price"]
    if t["sma200"] and t["sma50"] and p > t["sma50"] > t["sma200"] and t["sma200_up"]:
        P(64, "Tren naik terkonfirmasi: harga di atas MA50 & MA200, MA200 menanjak (golden cross aktif).",
          "Teknikal")
    if t["rs6m"] is not None and t["rs6m"] > 0.08:
        P(58 + min(t["rs6m"], 0.6) * 40, f"Relative strength kuat: mengungguli S&P 500 sebesar "
          f"{pct(t['rs6m'])} dalam 6 bulan.", "Teknikal")
    if t["sma50"] and t["sma200"] and p > t["sma200"] and abs(p / t["sma50"] - 1) <= 0.04 and (t["rsi"] or 50) < 60:
        P(63, f"Sedang pullback ke area MA50 (${t['sma50']:.2f}) dalam tren naik — titik masuk yang menarik.",
          "Teknikal")
    elif t["rsi"] and 40 <= t["rsi"] <= 62 and t["sma200"] and p > t["sma200"]:
        P(55, f"RSI {t['rsi']:.0f} — momentum sehat, belum jenuh beli.", "Teknikal")

    # ================= risiko
    if f["de"] is not None and f["de"] > 2.0:
        C(70 + min(f["de"], 6) * 4, f"Utang tinggi: debt-to-equity {f['de']:.1f}x.", "Kesehatan")
    if f["netdebt_ebitda"] is not None and f["netdebt_ebitda"] > 3:
        C(68 + min(f["netdebt_ebitda"], 8) * 3, f"Utang bersih {f['netdebt_ebitda']:.1f}x EBITDA — leverage tinggi.",
          "Kesehatan")
    if f["int_cov"] is not None and f["int_cov"] < 3:
        C(72, f"Laba operasi hanya {f['int_cov']:.1f}x beban bunga.", "Kesehatan")
    if f["fcf"] is not None and f["fcf"] < 0 and not f["is_fin"]:
        C(75, f"Free cash flow negatif ({money(f['fcf'])}) — bisnis masih membakar kas.", "Kualitas")
    if f["eps_ttm"] is not None and f["eps_ttm"] <= 0:
        C(70, "Perusahaan masih merugi (EPS 12 bulan terakhir negatif).", "Kualitas")
    if f["rev_growth"] is not None and f["rev_growth"] < -0.02:
        C(65 + min(-f["rev_growth"], 0.3) * 60, f"Pendapatan turun {pct(-f['rev_growth'])} YoY.", "Pertumbuhan")
    if f["eps_growth_fwd"] is not None and f["eps_growth_fwd"] > 0.6:
        C(74, f"Lonjakan laba sangat besar (+{pct(f['eps_growth_fwd'])}) — bila bisnisnya siklikal, P/E rendah "
          f"di puncak siklus bisa menyesatkan; proyeksi berisiko terlalu optimistis.", "Valuasi")
    if f["eps_growth_fwd"] is not None and f["eps_growth_fwd"] < -0.03:
        C(66, f"Analis memproyeksikan EPS turun {pct(-f['eps_growth_fwd'])} tahun depan.", "Pertumbuhan")
    if f["pe_fwd"] and spe and f["pe_fwd"] > spe * 1.5 and f["pe_fwd"] > 30:
        C(60 + min(f["pe_fwd"] / spe, 4) * 5, f"Valuasi premium: P/E forward {f['pe_fwd']:.0f}x vs median sektor "
          f"{spe:.0f}x — ekspektasi pasar sudah tinggi.", "Valuasi")
    if f["piotroski"] is not None and f["piotroski"] <= 3:
        C(68, f"Piotroski F-Score rendah ({f['piotroski']}/9) — banyak indikator fundamental memburuk.",
          "Kesehatan")
    if f["altman"] is not None and f["altman"] < 1.8:
        C(70, f"Altman Z-Score {f['altman']:.1f} — berada di zona rawan tekanan keuangan.", "Kesehatan")
    if v and v["upside"] < 0:
        C(72, f"Harga sudah {pct(-v['upside'])} di atas estimasi nilai wajar (${v['fair']:.2f}).", "Valuasi")
    if t["rsi"] and t["rsi"] > 72:
        C(58 + (t["rsi"] - 72), f"RSI {t['rsi']:.0f} — jenuh beli, rawan koreksi jangka pendek; idealnya "
          f"tunggu pullback.", "Teknikal")
    if t["sma200"] and p < t["sma200"]:
        C(62, f"Harga di bawah MA200 (${t['sma200']:.2f}) — tren jangka panjang masih lemah.", "Teknikal")
    if f["beta"] and f["beta"] > 1.6:
        C(55 + min(f["beta"], 3) * 3, f"Volatilitas tinggi (beta {f['beta']:.2f}) — pergerakan harga bisa "
          f"tajam ke dua arah.", "Risiko")
    if f["short_float"] and f["short_float"] > 0.08:
        C(58, f"Short interest {pct(f['short_float'], 1)} dari float — banyak investor bertaruh harga turun.",
          "Risiko")
    if v and v["confidence"] == "Rendah":
        C(50, "Estimasi nilai wajar antar-metode berbeda jauh — ketidakpastian proyeksi tinggi.", "Valuasi")
    if f["payout"] and f["payout"] > 1.0 and (f["div_yield"] or 0) > 0.02:
        C(60, f"Payout ratio {pct(f['payout'])} — dividen melebihi laba, keberlanjutan perlu dicermati.",
          "Pemegang Saham")

    fl, sh_, ist = rec.get("flraw"), rec.get("short"), rec.get("inst")
    if fl and rec.get("flow") is not None:
        net = fl.get("net20") or 0
        if rec["flow"] >= 68 and net > 0:
            P(52 + (rec["flow"] - 68) * 0.8, f"Uang masuk: tekanan beli bersih ±{money(net)} dalam 20 hari (CMF {fl['cmf']:+.2f}, volume hari naik "
                                            f"{fl['ud']:.1f}× hari turun).", "Aliran Dana")
        elif rec["flow"] <= 32 and net < 0:
            C(52 + (32 - rec["flow"]) * 0.8, f"Uang keluar: tekanan jual bersih ±{money(-net)} dalam 20 hari (CMF {fl['cmf']:+.2f}"
                                            + (f", volume hari turun {1 / fl['ud']:.1f}× hari naik" if fl.get('ud') else "") + ").", "Aliran Dana")
        if fl.get("div") == "akumulasi":
            P(56, "Akumulasi tersembunyi: volume beli (OBV) naik walau harga turun 20 hari terakhir.", "Aliran Dana")
        elif fl.get("div") == "distribusi":
            C(56, "Distribusi: harga naik tapi volume (OBV) turun — kenaikan tidak didukung pembeli besar.", "Aliran Dana")
        if (fl.get("rv") or 0) >= 2 and (fl.get("chg5") or 0) > 0.03:
            P(50, f"Lonjakan volume {fl['rv']:.1f}× rata-rata disertai kenaikan harga {pct(fl['chg5'])} (5 hari).", "Aliran Dana")
    if ist and ist.get("net_pct") is not None:
        if ist["net_pct"] >= 0.02 and ist["n_up"] >= 6:
            P(50, f"{ist['n_up']} dari 10 institusi terbesar menambah kepemilikan (bersih {pct(ist['net_pct'])}"
                  + (f", ±{money(ist['net_usd'])}" if ist.get('net_usd') else "") + ").", "Institusi")
        elif ist["net_pct"] <= -0.02 and ist["n_dn"] >= 6:
            C(50, f"{ist['n_dn']} dari 10 institusi terbesar mengurangi kepemilikan (bersih {pct(ist['net_pct'])}).", "Institusi")
    if sh_ and sh_.get("chg") is not None:
        if sh_["chg"] >= 0.30 and (sh_.get("pct_float") or 0) >= 0.02:
            C(48 + min(sh_["chg"], 2) * 10, f"Short interest naik {pct(sh_['chg'])} dalam sebulan ({pct(sh_.get('pct_float'), 1)} dari float) "
                                           "— taruhan harga turun bertambah.", "Short Interest")
        elif sh_["chg"] <= -0.25 and (sh_.get("pct_float") or 0) >= 0.03:
            P(48, f"Short interest turun {pct(-sh_['chg'])} sebulan — posisi short ditutup (short covering).", "Short Interest")
    ff = rec["f"]
    acc, shc = ff.get("accruals"), ff.get("share_chg")
    if acc is not None:
        if acc >= 0.10:
            C(50 + min(acc, 0.3) * 80, f"Kualitas laba rendah: laba bersih melebihi arus kas operasi sebesar {pct(acc)} dari total aset "
                                      f"(akrual tinggi — sering mendahului penurunan laba).", "Kualitas Laba")
        elif acc <= -0.06 and rec["fund"] >= 60:
            P(50 + min(-acc, 0.2) * 60, f"Kualitas laba tinggi: arus kas operasi melebihi laba bersih ({pct(-acc)} dari aset).", "Kualitas Laba")
    if shc is not None:
        if shc >= 0.08:
            C(50 + min(shc, 0.5) * 60, f"Dilusi: jumlah saham beredar bertambah {pct(shc)} dalam setahun — porsi pemegang saham lama mengecil.",
              "Dilusi")
        elif shc <= -0.03:
            P(48 + min(-shc, 0.1) * 150, f"Jumlah saham beredar berkurang {pct(-shc)} setahun (buyback) — porsi tiap saham membesar.",
              "Pemegang Saham")
    ins = (rec.get("est") or {}).get("ins")
    if ins:
        b90 = ins.get("buy90") or {}
        s90 = ins.get("sell90") or {}
        if b90.get("n", 0) >= 2 and (b90.get("val") or 0) >= 100_000:
            P(66 + min(b90["n"], 5) * 3, f"Orang dalam membeli di pasar terbuka: {b90['n']} orang, {money(b90['val'])} dalam 90 hari "
                                         f"terakhir — sinyal keyakinan manajemen.", "Orang Dalam")
        elif b90.get("n", 0) == 1 and (b90.get("val") or 0) >= 250_000:
            P(55, f"{b90.get('who', 'Seorang pejabat')} membeli saham {money(b90['val'])} di pasar terbuka (90 hari).", "Orang Dalam")
        net = ins.get("net_pct")
        if net is not None and net <= -0.10 and (s90.get("val") or 0) >= 1_000_000:
            C(50 + min(-net, 0.5) * 40, f"Orang dalam menjual bersih {pct(-net)} kepemilikannya dalam 6 bulan "
                                       f"({money(s90['val'])} dalam 90 hari).", "Orang Dalam")
    ow = rec["f"].get("own")
    if ow and ow.get("pe_own") is not None and ow.get("pe_med"):
        po = ow["pe_own"]
        if po <= -0.20 and rec["fund"] >= 55:
            P(54 + min(-po, 0.5) * 40, f"P/E {rec['f']['pe_ttm']:.1f}x — {pct(-po)} di bawah median P/E-nya sendiri "
                                      f"{len(ow['years'])} tahun terakhir ({ow['pe_med']:.1f}x).", "Valuasi Historis")
        elif po >= 0.50:
            C(48 + min(po, 1.0) * 20, f"P/E {rec['f']['pe_ttm']:.1f}x — {pct(po)} di atas median P/E-nya sendiri "
                                     f"({ow['pe_med']:.1f}x); valuasi sudah mahal dibanding biasanya.", "Valuasi Historis")
    qd = rec["f"].get("qtr")
    if qd:
        y0, y1, ac = qd.get("rev_yoy"), qd.get("rev_yoy_prev"), qd.get("accel")
        if y0 is not None and ac is not None:
            if y0 >= 0.08 and ac >= 0.03:
                P(56 + min(ac, 0.3) * 80, f"Pertumbuhan pendapatan MEMPERCEPAT: kuartal terakhir {pct(y0)} YoY vs "
                                         f"{pct(y1)} pada kuartal sebelumnya.", "Kuartalan")
            elif ac <= -0.08 and y0 < 0.20:
                C(50 + min(-ac, 0.3) * 60, f"Pertumbuhan pendapatan melambat: kuartal terakhir {pct(y0)} YoY vs "
                                          f"{pct(y1)} pada kuartal sebelumnya.", "Kuartalan")
        m0, m1 = qd.get("opm_ttm"), qd.get("opm_prev")
        if m0 is not None and m1 is not None:
            if m0 - m1 >= 0.03 and m0 > 0:
                P(52 + min(m0 - m1, 0.2) * 100, f"Margin operasi 12 bulan terakhir naik ke {pct(m0)} dari {pct(m1)} "
                                               f"setahun sebelumnya — efisiensi membaik.", "Kuartalan")
            elif m1 - m0 >= 0.04:
                C(50 + min(m1 - m0, 0.2) * 100, f"Margin operasi 12 bulan terakhir turun ke {pct(m0)} dari {pct(m1)} "
                                               f"setahun sebelumnya.", "Kuartalan")
    e = rec.get("est")
    if e:
        r90 = [e[k]["r90"] for k in ("fy0", "fy1") if e.get(k) and e[k].get("r90") is not None]
        avg90 = sum(r90) / len(r90) if r90 else None
        if avg90 is not None and avg90 >= 0.04:
            P(55 + min(avg90, 0.3) * 120, f"Analis menaikkan estimasi EPS rata-rata {pct(avg90)} dalam 90 hari terakhir"
              + (f" ({e['up30']} revisi naik vs {e['down30']} turun dalam 30 hari)." if e.get("up30") is not None else "."),
              "Revisi Estimasi")
        elif avg90 is not None and avg90 <= -0.04:
            C(55 + min(-avg90, 0.3) * 120, f"Analis memangkas estimasi EPS rata-rata {pct(-avg90)} dalam 90 hari terakhir"
              + (f" ({e['down30']} revisi turun vs {e['up30']} naik dalam 30 hari)." if e.get("up30") is not None else "."),
              "Revisi Estimasi")
        if e.get("n_q", 0) >= 4 and e.get("beats") == 4 and (e.get("avg_surprise") or 0) > 0.03:
            P(52, f"Laba mengalahkan estimasi 4 kuartal berturut-turut (rata-rata kejutan {pct(e['avg_surprise'])}).",
              "Kejutan Laba")
        elif e.get("n_q", 0) >= 4 and e.get("beats", 4) <= 1:
            C(50, f"Laba di bawah estimasi pada {e['n_q'] - e['beats']} dari {e['n_q']} kuartal terakhir.", "Kejutan Laba")
    mc = rec.get("mc")
    if mc:
        if mc["p_up"] >= 0.62:
            P(50 + (mc["p_up"] - 0.62) * 150,
              f"Simulasi Monte Carlo {quant.MC_PATHS:,} skenario: peluang untung dalam 12 bulan "
              f"{pct(mc['p_up'])}, rentang hasil 90% {pct(mc['p5'])} s.d. {pct(mc['p95'])}.", "Probabilitas")
        if mc.get("p_target_first") and mc["p_target_first"] >= 0.5:
            P(50, f"{pct(mc['p_target_first'])} skenario simulasi menyentuh target nilai wajar lebih dulu "
                  f"sebelum stop loss.", "Probabilitas")
        if mc["p_loss20"] >= 0.32:
            C(42 + mc["p_loss20"] * 50, f"Simulasi: {pct(mc['p_loss20'])} kemungkinan harga turun >20% dalam "
                                         f"12 bulan (volatilitas {pct(mc['sigma'])}/thn).", "Probabilitas")
    qr = rec.get("q_risk")
    if qr and qr["mdd"] <= -0.40:
        C(48, f"Pernah turun {pct(-qr['mdd'])} dari puncak dalam 1 tahun terakhir — pergerakan harga liar.",
          "Risiko")

    pros.sort(key=lambda x: -x["s"])
    cons.sort(key=lambda x: -x["s"])
    return [{"text": x["text"], "tag": x["tag"]} for x in pros[:6]], \
           [{"text": x["text"], "tag": x["tag"]} for x in cons[:5]]


PILLAR_ID = {"quality": "kualitas bisnis", "growth": "pertumbuhan", "value": "valuasi", "health": "kesehatan keuangan"}


def label_score(s):
    if s >= 80:
        return "sangat kuat"
    if s >= 65:
        return "kuat"
    if s >= 50:
        return "cukup"
    if s >= 35:
        return "lemah"
    return "sangat lemah"


def build_thesis(rec):
    pl = rec["pillars"]
    best = sorted(pl.items(), key=lambda x: -x[1])
    worst = best[-1]
    v = rec["val"]
    s = (f"{rec['name']} memiliki fundamental {label_score(rec['fund'])} (skor {rec['fund']:.0f}/100) "
         f"dengan keunggulan utama di {PILLAR_ID[best[0][0]]} ({best[0][1]:.0f}) dan "
         f"{PILLAR_ID[best[1][0]]} ({best[1][1]:.0f}).")
    if worst[1] < 50:
        s += f" Titik lemahnya ada di {PILLAR_ID[worst[0]]} ({worst[1]:.0f})."
    if v:
        arah = "potensi naik" if v["upside"] >= 0 else "potensi turun"
        s += (f" Gabungan model DCF, multiple sektor, dan target analis menghasilkan nilai wajar "
              f"${v['fair']:.2f} — {arah} {abs(v['upside']) * 100:.1f}% dalam ~12 bulan "
              f"(keyakinan {v['confidence'].lower()}).")
    s += f" Kondisi teknikal {label_score(rec['tech'])} ({rec['tech']:.0f}/100)."
    g = rec.get("geo")
    if g:
        s += f" Risiko geopolitik {g['risk_label'].lower()}"
        worst = min(g["impact"].items(), key=lambda x: x[1])
        best = max(g["impact"].items(), key=lambda x: x[1])
        if worst[1] <= -0.2:
            s += f", terutama dari tema {geopolitik.THEMES[worst[0]]['name']}"
        if best[1] >= 0.2:
            s += f"; berpeluang diuntungkan tema {geopolitik.THEMES[best[0]]['name']}"
        s += "."
    return s


def trade_plan(rec):
    t, v = rec["t"], rec["val"]
    p = t["price"]
    atr = t["atr"] or p * 0.02
    lo = p - 1.0 * atr
    if t["sma50"] and t["sma50"] < p and t["sma50"] > p * 0.9:
        lo = max(min(lo, t["sma50"]), p * 0.9)
    stop = min(max(p - 2.5 * atr, p * 0.82), lo - 1.0 * atr)
    tgt = v["fair"] if v else None
    rr = (tgt - p) / (p - stop) if (tgt and p > stop) else None
    return {"entry_lo": r(lo, 2), "entry_hi": r(p, 2), "stop": r(stop, 2), "target": r(tgt, 2),
            "target2": r(v["bull"], 2) if v else None, "rr": r(rr, 2)}


def cap_bucket(m):
    if not m:
        return "?"
    if m >= 200e9:
        return "Mega"
    if m >= 10e9:
        return "Large"
    if m >= 2e9:
        return "Mid"
    return "Small"


# ----------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", help="daftar ticker dipisah koma")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--tanpa-midcap", action="store_true", help="hanya S&P 500 + daftar tambahan")
    args = ap.parse_args()

    t0 = time.time()
    os.makedirs(HIST_DIR, exist_ok=True)
    syms = get_universe(args)
    log(f"Menganalisis {len(syms)} saham...")

    log("1/4 Mengunduh harga 2 tahun...")
    prices = fetch_prices(list(dict.fromkeys(syms + ["SPY"] + list(geopolitik.MACRO.values()) + makro.all_symbols())))
    spy = prices.get("SPY")
    spy_close = spy["Close"] if spy is not None else None

    log("2/4 Mengunduh data fundamental & laporan keuangan...")
    raw = {}
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(fetch_fundamentals, s): s for s in syms if s in prices}
        done = 0
        for fu in as_completed(futs):
            s, data, err = fu.result()
            done += 1
            if data:
                raw[s] = data
            elif err:
                log(f"  lewati {s}: {err}")
            if done % 25 == 0:
                log(f"  fundamental: {done}/{len(futs)}")

    # putaran ulang untuk saham yang gagal (timeout / dibatasi Yahoo), lebih pelan
    for rnd in (1, 2):
        failed = [s for s in syms if s in prices and s not in raw]
        if not failed:
            break
        log(f"  ulang {len(failed)} saham yang gagal (putaran {rnd})...")
        time.sleep(20 * rnd)
        with ThreadPoolExecutor(max_workers=2) as ex:
            for s, data, err in ex.map(fetch_fundamentals, failed):
                if data:
                    raw[s] = data
        log(f"  berhasil total: {len(raw)}")

    log(f"  cache laporan keuangan: {CACHE_STATS['hit']} dipakai ulang, {CACHE_STATS['miss']} diunduh baru")
    log("  Mengunduh harga bulanan 5 tahun (valuasi vs riwayat sendiri)...")
    mprices = fetch_monthly(list(raw.keys()))
    log(f"  bulanan: {len(mprices)}/{len(raw)}")
    log("3/4 Menghitung metrik...")
    records = []
    for s, (info, inc, bal, cf, qinc, qcf) in raw.items():
        try:
            fin_cur = info.get("financialCurrency") or "USD"
            if fin_cur != (info.get("currency") or "USD"):
                log(f"  lewati {s}: laporan keuangan dalam {fin_cur}")
                continue
            t = compute_tech(prices[s], spy_close)
            if not t:
                continue
            ip = sf(info.get("currentPrice")) or sf(info.get("regularMarketPrice"))
            if ip:
                t["price"] = ip
                t["dist_high"] = ip / t["high52"] - 1
            f = compute_fund(info, inc, bal, cf, qinc, qcf, mprices.get(s))
            sector = info.get("sector") or "Lainnya"
            records.append({
                "sym": s, "name": info.get("shortName") or info.get("longName") or s,
                "sector": sector, "sector_id": SECTOR_ID.get(sector, sector),
                "industry": info.get("industry") or "",
                "mcap": sf(info.get("marketCap")),
                "summary": (info.get("longBusinessSummary") or "")[:600],
                "summary_full": info.get("longBusinessSummary") or "",
                "country": info.get("country") or "",
                "website": info.get("website") or "",
                "earnings_ts": next_earnings(info),
                "exdiv": next_exdiv(info),
                "div_rate": sf(info.get("dividendRate")),
                "earnings_est": bool(info.get("isEarningsDateEstimate")),
                "earnings_last": info.get("earningsTimestamp"),
                "f": f, "t": t,
                "flraw": aliran.from_prices(prices[s]), "short": aliran.short_info(info),
            })
        except Exception as e:
            log(f"  error {s}: {e}")

    if not records:
        log("Tidak ada data yang berhasil diproses (kemungkinan dibatasi Yahoo, coba lagi nanti).")
        sys.exit(1)
    if not args.tickers and len(records) < 0.6 * len(syms):
        log(f"Hanya {len(records)}/{len(syms)} saham berhasil — data lama TIDAK ditimpa. Coba lagi nanti.")
        sys.exit(1)

    log("4/4 Skoring, valuasi, dan narasi...")
    pct_tbl, medians = percentile_tables(records)
    moms = pd.Series({rcd["sym"]: rcd["t"]["mom"] for rcd in records}, dtype=float).rank(pct=True)
    rss = pd.Series({rcd["sym"]: rcd["t"]["rs6m"] for rcd in records}, dtype=float).rank(pct=True)

    for rec in records:
        rec["pillars"], rec["details"] = pillar_scores(rec, pct_tbl)
        rec["fund"] = round(sum(rec["pillars"][k] * w for k, w in PILLAR_W.items()), 1)
        rec["tech"] = tech_score(rec["t"], sf(moms.get(rec["sym"])), sf(rss.get(rec["sym"])))
        rec["analyst"] = analyst_score(rec["f"])
        rec["score"] = round(0.70 * rec["fund"] + 0.20 * rec["tech"] + 0.10 * rec["analyst"], 1)

    # ---- revisi estimasi EPS & kejutan laba (saham teratas sementara, hemat panggilan API)
    prelim = sorted(records, key=lambda x: -x["score"])
    est_syms = [x["sym"] for x in prelim[: (len(prelim) if args.tickers else 230)]]
    log(f"  Mengunduh revisi estimasi analis untuk {len(est_syms)} saham...")
    ests = {}
    with ThreadPoolExecutor(max_workers=min(args.workers, 6)) as ex:
        for sym_, e in ex.map(makro.fetch_estimates, est_syms):
            if e:
                ests[sym_] = e
    for rnd in (1, 2):
        miss = [x for x in est_syms if x not in ests]
        if len(miss) < 5:
            break
        log(f"  ulang estimasi {len(miss)} saham (putaran {rnd})...")
        time.sleep(15 * rnd)
        with ThreadPoolExecutor(max_workers=2) as ex:
            for sym_, e in ex.map(makro.fetch_estimates, miss):
                if e:
                    ests[sym_] = e
    log(f"  estimasi: {len(ests)}/{len(est_syms)}")
    for rec in records:
        rec["est"] = ests.get(rec["sym"])
        rec["rev"] = makro.revision_score(rec["est"])
        ins = (rec["est"] or {}).get("ins")
        rec["ins_score"] = makro.insider_score(ins, rec.get("mcap"))
        inst = (rec["est"] or {}).get("inst")
        if inst and inst.get("net_sh") is not None:
            inst["net_usd"] = round(inst["net_sh"] * rec["t"]["price"])
        rec["inst"] = inst
        rec["flow"] = aliran.score(rec.get("flraw"), inst, rec.get("short"))
        # komponen teknikal = 70% teknikal harga + 30% aliran dana
        rec["tech_comp"] = round(0.7 * rec["tech"] + 0.3 * rec["flow"], 1) if rec["flow"] is not None else rec["tech"]
        parts = [(rec["analyst"], 0.5)]
        if rec["rev"] is not None:
            parts.append((rec["rev"], 0.3))
        if rec["ins_score"] is not None:
            parts.append((rec["ins_score"], 0.2))
        tw = sum(w for _, w in parts)
        rec["analyst"] = round(sum(v * w for v, w in parts) / tw, 1)

    # ---- geopolitik (berita perusahaan untuk ~180 saham teratas sementara)
    geo_payload = geopolitik.build(records, prices, spy_close, [x["sym"] for x in prelim[:180]],
                                   workers=args.workers, log=log)
    geo_int = {t["key"]: t["intensity"] for t in geo_payload["themes"]}
    if not args.tickers:
        try:
            import berita
            cand = [x["sym"] for x in prelim if x["score"] >= 58][:140]
            names = {x["sym"]: x["name"] for x in records}
            items = berita.collect(cand, market=True, hours=48, min_stock=40, min_market=50, names=names)
            for it in items:
                it.pop("summary", None)
            with open(os.path.join(OUT_DIR, "berita.json"), "w", encoding="utf-8") as fh:
                json.dump({"generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                           "items": items[:120], "scanned": len(cand)}, fh, ensure_ascii=False, separators=(",", ":"))
            log(f"  berita penting: {len(items)} dari {len(cand)} saham + pasar")
        except Exception as e:  # noqa: BLE001
            log(f"  berita penting gagal: {e}")
        try:
            import ipo
            ip = ipo.build(log=log)
            if ip["upcoming"] or ip["recent"]:
                with open(os.path.join(OUT_DIR, "ipo.json"), "w", encoding="utf-8") as fh:
                    json.dump(ip, fh, ensure_ascii=False, separators=(",", ":"))
        except Exception as e:  # noqa: BLE001
            log(f"  ipo gagal: {e}")
    for rec in records:
        rec["geo_int"] = geo_int
        rec["score"] = round(0.65 * rec["fund"] + 0.20 * rec.get("tech_comp", rec["tech"]) + 0.10 * rec["analyst"]
                             + 0.05 * rec["geo"]["score"], 1)

    for rec in records:
        rec["val"] = fair_value(rec, medians)
        up = rec["val"]["upside"] if rec["val"] else None
        rec["rating"] = rating_for(rec["score"], rec["fund"], up, rec["val"]["confidence"] if rec["val"] else None)
        rec["plan"] = trade_plan(rec)
        # ---- kuantitatif: risiko & Monte Carlo
        close = prices[rec["sym"]]["Close"]
        rec["q_risk"] = quant.risk_metrics(close, spy_close)
        rec["mc"] = None
        if rec["q_risk"]:
            qr = rec["q_risk"]
            beta = qr["beta_calc"] if qr["beta_calc"] is not None else rec["f"].get("beta")
            v = rec["val"]
            exp, capm, wv = quant.expected_return(up, beta, v["confidence"] if v else None)
            try:
                rec["mc"] = quant.monte_carlo(close, rec["t"]["price"], exp, qr["vol"], qr["vol_now"],
                                              v["fair"] if v else None, rec["plan"]["target"],
                                              rec["plan"]["stop"], zlib.crc32(rec["sym"].encode()))
                if rec["mc"]:
                    rec["mc"]["capm"], rec["mc"]["view_w"] = capm, wv
            except Exception as e:
                log(f"  MC gagal {rec['sym']}: {e}")
        rec["pros"], rec["cons"] = build_reasons(rec, medians)
        rec["thesis"] = build_thesis(rec)

    quant.factor_profile(records)
    log("  Menyusun model portofolio...")
    try:
        portfolios = quant.build_portfolios(records, prices, spy_close, log=log)
    except Exception as e:
        log(f"  portofolio gagal: {e}")
        portfolios = None

    records.sort(key=lambda x: -x["score"])
    for i, rec in enumerate(records):
        rec["rank"] = i + 1

    # ---------------- ekspor
    def metrics_out(f):
        keys = ["accruals", "share_chg", "roe", "roa", "roic", "gross_margin", "op_margin", "net_margin", "fcf_margin", "margin_trend",
                "rev_growth", "earn_growth", "rev_cagr3", "fcf_cagr3", "eps_growth_fwd", "eps_ttm", "eps_fwd",
                "pe_ttm", "pe_fwd", "peg", "ev_ebitda", "fcf_yield", "ps", "pb", "de", "current_ratio",
                "netdebt_ebitda", "int_cov", "piotroski", "altman", "div_yield", "payout", "buyback_yield",
                "sh_yield", "rec_mean", "n_analysts", "target_mean", "target_high", "target_low",
                "target_upside", "beta", "short_float", "insider", "inst", "fcf", "net_debt", "cash", "debt"]
        return {k: r(f.get(k), 4) for k in keys}

    stocks = []
    breadth = 0
    for rec in records:
        t, v = rec["t"], rec["val"]
        if t["sma200"] and t["price"] > t["sma200"]:
            breadth += 1
        stocks.append({
            "sym": rec["sym"], "name": rec["name"], "sector": rec["sector_id"], "sector_en": rec["sector"],
            "industry": rec["industry"], "mcap": rec["mcap"], "cap": cap_bucket(rec["mcap"]),
            "rank": rec["rank"], "score": rec["score"], "fund": rec["fund"], "tech": rec["tech"],
            "analyst": rec["analyst"], "pillars": rec["pillars"], "rating": rec["rating"],
            "price": r(t["price"], 2), "chg1d": r(t["chg1d"]),
            "ret": {"1m": r(t["ret1m"]), "3m": r(t["ret3m"]), "6m": r(t["ret6m"]), "1y": r(t["ret1y"])},
            "tech_d": {k: (r(t[k], 4) if isinstance(t[k], (int, float)) and not isinstance(t[k], bool) else t[k])
                       for k in ["sma50", "sma200", "sma200_up", "rsi", "macd_hist", "macd_rising", "atr",
                                 "high52", "low52", "dist_high", "rs6m", "ud_ratio", "support", "resistance",
                                 "vol_avg", "mom"]},
            "spark": t["spark"],
            "m": metrics_out(rec["f"]),
            "mp": {k: v_["pct"] for k, v_ in rec["details"].items()},
            "piotroski_checks": rec["f"]["piotroski_checks"],
            "hist": rec["f"]["hist"],
            "val": None if not v else {
                "fair": r(v["fair"], 2), "upside": r(v["upside"]), "bear": r(v["bear"], 2),
                "bull": r(v["bull"], 2), "bear_pct": r(v["bear_pct"]), "bull_pct": r(v["bull_pct"]),
                "methods": {k: r(x, 2) for k, x in v["methods"].items()}, "confidence": v["confidence"],
                "capped": bool(v["upside"] >= 0.99),
                "growth_used": r(v["growth_used"]), "discount": r(v["discount"]),
                "fair_pe": r(v["fair_pe"], 1), "sector_pe": r(v["sector_pe"], 1),
                "total_return": r(v["total_return"]),
            },
            "pros": rec["pros"], "cons": rec["cons"], "thesis": rec["thesis"], "plan": rec["plan"],
            "geo": rec["geo"], "country": rec["country"],
            "factors": rec.get("factors"),
            "flow": rec.get("flow"),
            "fl": None if not rec.get("flraw") else {**rec["flraw"], "inst": rec.get("inst"), "short": rec.get("short")},
            "est": rec.get("est"), "rev": rec.get("rev"),
            "qtr": rec["f"].get("qtr"), "fcf_src": rec["f"].get("fcf_src"),
            "q": None if not rec.get("q_risk") else {
                **{k: r(x, 4) for k, x in rec["q_risk"].items()},
                "mc": None if not rec.get("mc") else {
                    k: (x if k == "fan" else (r(x, 4) if isinstance(x, float) else x))
                    for k, x in rec["mc"].items()},
            },
            "summary": rec["summary"], "website": rec["website"], "earnings_ts": rec["earnings_ts"],
            "earnings_est": rec.get("earnings_est"), "earnings_last": rec.get("earnings_last"),
            "exdiv_ts": (rec.get("exdiv") or (None, False))[0], "exdiv_est": (rec.get("exdiv") or (None, False))[1],
            "div_rate": rec.get("div_rate"),
            "own": rec["f"].get("own"), "ins": (rec.get("est") or {}).get("ins"),
        })

    # ringkasan sektor
    sectors = {}
    for s in stocks:
        d = sectors.setdefault(s["sector"], {"n": 0, "score": 0, "up": [], "buy": 0})
        d["n"] += 1
        d["score"] += s["score"]
        if s["val"]:
            d["up"].append(s["val"]["upside"])
        if s["rating"] in ("STRONG BUY", "BUY"):
            d["buy"] += 1
    sector_out = []
    for name, d in sectors.items():
        sector_out.append({"name": name, "n": d["n"], "score": round(d["score"] / d["n"], 1),
                           "upside": r(float(np.median(d["up"]))) if d["up"] else None, "buy": d["buy"],
                           "pe": r((medians.get(next((rc["sector"] for rc in records if rc["sector_id"] == name),
                                                     ""), {}) or {}).get("pe_fwd"), 1)})
    sector_out.sort(key=lambda x: -x["score"])

    spy_t = compute_tech(spy, None) if spy is not None else None
    market = None
    if spy_t:
        regime = "Bullish" if (spy_t["sma200"] and spy_t["price"] > spy_t["sma200"] and spy_t["sma50"] > spy_t["sma200"]) \
            else ("Bearish" if spy_t["sma200"] and spy_t["price"] < spy_t["sma200"] else "Netral")
        market = {"spy": r(spy_t["price"], 2), "chg1d": r(spy_t["chg1d"]), "ret1m": r(spy_t["ret1m"]),
                  "ret1y": r(spy_t["ret1y"]), "rsi": r(spy_t["rsi"], 1), "regime": regime,
                  "above_sma200": r(spy_t["price"] / spy_t["sma200"] - 1) if spy_t["sma200"] else None,
                  "breadth": r(breadth / len(stocks)), "spark": spy_t["spark"]}

    now = dt.datetime.now(dt.timezone.utc)
    today = now.strftime("%Y-%m-%d")
    # ---- perubahan rekomendasi vs hari bursa sebelumnya (baseline disimpan agar re-run hari yang sama aman)
    base_path = os.path.join(OUT_DIR, "baseline.json")
    stocks_path = os.path.join(OUT_DIR, "stocks.json")
    try:
        with open(stocks_path, encoding="utf-8") as fh:
            prev_gen = (json.load(fh).get("generated") or "")[:10]
    except Exception:
        prev_gen = ""
    if prev_gen and prev_gen < today and not args.tickers:
        try:
            with open(stocks_path, encoding="utf-8") as fh:
                old = json.load(fh)
            mini = {"generated": old.get("generated"),
                    "stocks": [{"sym": x["sym"], "name": x["name"], "rating": x["rating"], "score": x["score"]}
                               for x in old.get("stocks", [])]}
            with open(base_path, "w", encoding="utf-8") as fh:
                json.dump(mini, fh, ensure_ascii=False, separators=(",", ":"))
        except Exception as e:
            log(f"  baseline gagal: {e}")
    changes, prev_map = quant.rating_changes(base_path, stocks)
    for s_ in stocks:
        pm = prev_map.get(s_["sym"])
        if pm and (pm["rating"] != s_["rating"] or abs(pm["score"] - s_["score"]) >= 0.5):
            s_["prev"] = pm

    quant_out = {"generated": now.isoformat(timespec="seconds"), "portfolios": portfolios, "track": None}
    if not args.tickers:
        try:
            quant_out["track"] = quant.update_track(os.path.join(OUT_DIR, "track.json"), today, stocks,
                                                    spy_t["price"] if spy_t else None, prices)
        except Exception as e:
            log(f"  rekam jejak gagal: {e}")
    if not args.tickers:
        try:
            mk = makro.build(prices, {rc["sym"]: prices[rc["sym"]]["Close"].astype(float) for rc in records}, log=log)
            mk["generated"] = now.isoformat(timespec="seconds")
            mk_path = os.path.join(OUT_DIR, "makro.json")
            complete = mk.get("fg") and mk.get("rotation") and (mk.get("curve") or {}).get("spread_now") is not None
            if complete or not os.path.exists(mk_path):
                with open(mk_path, "w", encoding="utf-8") as fh:
                    json.dump(mk, fh, ensure_ascii=False, separators=(",", ":"))
            else:
                log("  makro: data tidak lengkap — makro.json lama dipertahankan")
        except Exception as e:
            log(f"  monitor makro gagal: {e}")
        try:
            cyc = siklus.build(log=log)
            with open(os.path.join(OUT_DIR, "cycles.json"), "w", encoding="utf-8") as fh:
                json.dump(cyc, fh, ensure_ascii=False, separators=(",", ":"))
        except Exception as e:
            log(f"  analisis siklus gagal: {e}")
    with open(os.path.join(OUT_DIR, "quant.json"), "w", encoding="utf-8") as fh:
        json.dump(quant_out, fh, ensure_ascii=False, separators=(",", ":"))

    # ---- pecah: stocks.json ringkas untuk daftar/screener, detail/{SYM}.json untuk halaman saham
    detail_dir = os.path.join(OUT_DIR, "detail")
    os.makedirs(detail_dir, exist_ok=True)
    heavy = {"fl", "pros", "cons", "thesis", "summary", "website", "hist", "piotroski_checks", "mp", "tech_d", "plan",
             "est", "earnings_last", "country", "qtr", "fcf_src", "ins", "own"}

    def sig(x, n=3):
        if isinstance(x, float) and x and math.isfinite(x):
            return float(f"{x:.{n}g}")
        return x

    def spark_q(arr):
        # bentuk grafik mini saja: 0-99 relatif terhadap min/maks (harga asli ada di riwayat)
        if not arr or len(arr) < 2:
            return arr
        lo, hi = min(arr), max(arr)
        return [round((v - lo) / ((hi - lo) or 1) * 99) for v in arr]
    m_list = ["pe_fwd", "peg", "roe", "roic", "rev_cagr3", "rev_growth", "eps_growth_fwd", "piotroski", "div_yield",
              "payout", "fcf_yield", "op_margin", "de", "beta"]
    slim = []
    for s_ in stocks:
        det = {k: s_.get(k) for k in heavy}
        det.update({"sym": s_["sym"], "m": s_["m"], "val": s_["val"], "q": s_.get("q"), "geo": s_.get("geo")})
        with open(os.path.join(detail_dir, f"{s_['sym']}.json"), "w", encoding="utf-8") as fh:
            json.dump(det, fh, ensure_ascii=False, separators=(",", ":"))
        sl = {k: v for k, v in s_.items() if k not in heavy}
        sl["m"] = {k: sig(s_["m"].get(k)) for k in m_list}
        sl["spark"] = spark_q(s_.get("spark"))
        if s_.get("ret"):
            sl["ret"] = {k: sig(v) for k, v in s_["ret"].items()}
        sl["pro1"] = s_["pros"][0]["text"] if s_["pros"] else s_["thesis"]
        if s_["val"]:
            sl["val"] = {k: s_["val"].get(k) for k in ("fair", "upside", "confidence", "capped")}
        if s_.get("q"):
            mc = s_["q"].get("mc")
            sl["q"] = {k: sig(s_["q"].get(k)) for k in ("vol", "mdd", "sharpe", "beta_calc")}
            sl["q"]["mc"] = {k: sig(mc.get(k)) for k in ("p_up", "p_loss20", "exp")} if mc else None
        if s_.get("geo"):
            sl["geo"] = {k: s_["geo"].get(k) for k in ("score", "opp", "risk", "risk_label")}
        slim.append(sl)
    if not args.tickers:
        keep_d = {x["sym"] for x in stocks}
        for fn in os.listdir(detail_dir):
            if fn.endswith(".json") and fn[:-5] not in keep_d:
                os.remove(os.path.join(detail_dir, fn))

    payload = {
        "changes": changes,
        "generated": now.isoformat(timespec="seconds"),
        "geo": geo_payload,
        "count": len(stocks),
        "market": market,
        "sectors": sector_out,
        "cov": {"ins": sum(1 for x in stocks if x.get("ins")), "own": sum(1 for x in stocks if x.get("own"))},
        "stocks": slim,
    }
    with open(os.path.join(OUT_DIR, "stocks.json"), "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))

    # riwayat harga untuk grafik detail
    for rec in records:
        df = prices[rec["sym"]]
        c = df["Close"].astype(float)
        hist = {
            "d": [ix.strftime("%Y-%m-%d") for ix in c.index],
            "c": [round(float(x), 2) for x in c.values],
            "v": [int(x) if math.isfinite(x) else 0 for x in df["Volume"].astype(float).values],
        }
        with open(os.path.join(HIST_DIR, f"{rec['sym']}.json"), "w", encoding="utf-8") as fh:
            json.dump(hist, fh, separators=(",", ":"))

    # tolok ukur S&P 500 (SPY) untuk perbandingan portofolio
    if spy is not None:
        c = spy["Close"].astype(float).dropna()
        try:  # riwayat lebih panjang agar pembelian lama tetap bisa dibandingkan
            long = yf.download("SPY", period="10y", interval="1d", auto_adjust=True, progress=False)["Close"].squeeze().astype(float).dropna()
            if len(long) > len(c):
                c = long
        except Exception as e:  # noqa: BLE001
            log(f"SPY 10 thn gagal: {e}")
        with open(os.path.join(HIST_DIR, "SPY.json"), "w", encoding="utf-8") as fh:
            json.dump({"d": [ix.strftime("%Y-%m-%d") for ix in c.index], "c": [round(float(x), 2) for x in c.values]}, fh, separators=(",", ":"))

    if not args.tickers:
        keep = {rec["sym"] for rec in records} | {"SPY"}
        for fn in os.listdir(HIST_DIR):
            if fn.endswith(".json") and fn[:-5] not in keep:
                os.remove(os.path.join(HIST_DIR, fn))

    n_sb = sum(1 for s in stocks if s["rating"] == "STRONG BUY")
    n_b = sum(1 for s in stocks if s["rating"] == "BUY")
    log(f"Selesai: {len(stocks)} saham, {n_sb} STRONG BUY, {n_b} BUY — {time.time() - t0:.0f} detik")
    log("Top 10:")
    for s in stocks[:10]:
        up = s["val"]["upside"] * 100 if s["val"] else 0
        log(f"  {s['rank']:>3}. {s['sym']:<6} skor {s['score']:5.1f}  F {s['fund']:5.1f}  T {s['tech']:5.1f}  "
            f"{s['rating']:<10}  upside {up:+.1f}%")


if __name__ == "__main__":
    main()
