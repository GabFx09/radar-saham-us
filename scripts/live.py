"""
Harga live (± tiap 20 menit) untuk Radar Saham US -> docs/data/live.json

- Aset makro (indeks, obligasi, komoditas, valas, kripto, kredit, ETF sektor): sepanjang hari.
- Seluruh saham universe: saat bursa AS buka (plus satu kali setelah tutup).
Harga diambil dari bar 15 menit (bukan bar harian Yahoo, yang untuk beberapa valas seperti USD/IDR
kadang berganti-ganti sumber kuotasi). Tick yang menyimpang jauh dari median bar terakhir dibuang.
"""
import datetime as dt
import json
import math
import os
import sys
import time

import numpy as np
import pandas as pd
import yfinance as yf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import aliran  # noqa: E402
import makro  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "data", "live.json")


def log(*a):
    print(*a, flush=True)


def _r(x, n=4):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, n) if math.isfinite(x) else None


def ny_now():
    try:
        from zoneinfo import ZoneInfo
        return dt.datetime.now(ZoneInfo("America/New_York"))
    except Exception:  # noqa: BLE001
        return dt.datetime.now(dt.timezone(dt.timedelta(hours=-5)))


def clean_last(c):
    """Harga terakhir yang tahan tick salah: median 3 bar terakhir bila bar terakhir menyimpang > 2%."""
    c = c.dropna()
    if not len(c):
        return None
    last = float(c.iloc[-1])
    tail = c.iloc[-7:]
    med = float(np.median(tail))
    if med and abs(last / med - 1) > 0.02:
        return float(np.median(c.iloc[-3:]))
    return last


def prev_close(c, rate=False, fx24=False):
    """Pembanding '1 hari': penutupan sesi sebelumnya (saham) atau harga ±24 jam lalu (valas/kripto/futures)."""
    c = c.dropna()
    if len(c) < 2:
        return None
    idx = c.index
    if fx24:
        t0 = idx[-1] - pd.Timedelta(hours=24)
        before = c[idx <= t0]
        return float(before.iloc[-1]) if len(before) else None
    days = sorted(set(idx.date))
    if len(days) < 2:
        return None
    prev = c[idx.date == days[-2]]
    return float(prev.iloc[-1]) if len(prev) else None


def fetch(symbols, period="5d", interval="15m", full=False):
    out = {}
    for i in range(0, len(symbols), 150):
        part = symbols[i:i + 150]
        for attempt in range(3):
            try:
                df = yf.download(part, period=period, interval=interval, auto_adjust=False, group_by="ticker",
                                 threads=True, progress=False, prepost=False)
                break
            except Exception as e:  # noqa: BLE001
                log(f"  unduh gagal ({e}), ulangi")
                df = None
                time.sleep(3 + 3 * attempt)
        if df is None:
            continue
        for s in part:
            try:
                sub = df[s] if isinstance(df.columns, pd.MultiIndex) else df
                c = sub["Close"].dropna()
                if len(c):
                    out[s] = sub.dropna(subset=["Close"]) if full else c
            except Exception:  # noqa: BLE001
                pass
    missing = [s for s in symbols if s not in out]
    if missing and len(missing) <= 60:  # putaran ulang tanpa thread (mis. "database is locked" di cache yfinance)
        time.sleep(2)
        try:
            df = yf.download(missing, period=period, interval=interval, auto_adjust=False, group_by="ticker",
                             threads=False, progress=False, prepost=False)
            for s in missing:
                try:
                    sub = df[s] if isinstance(df.columns, pd.MultiIndex) else df
                    c = sub["Close"].dropna()
                    if len(c):
                        out[s] = sub.dropna(subset=["Close"]) if full else c
                except Exception:  # noqa: BLE001
                    pass
        except Exception:  # noqa: BLE001
            pass
    return out


def main():
    now = dt.datetime.now(dt.timezone.utc)
    ny = ny_now()
    mins = ny.hour * 60 + ny.minute
    weekday = ny.weekday() < 5
    market_open = weekday and 570 <= mins <= 960
    try:
        with open(OUT, encoding="utf-8") as fh:
            old = json.load(fh)
    except Exception:  # noqa: BLE001
        old = {}
    # ---- aset makro
    rate_syms = makro.RATE_SYMS
    fx24 = {s for g, items in makro.ASSETS if g in ("Valas", "Kripto", "Komoditas") for s, _ in items}
    msyms = makro.all_symbols()
    px = fetch(msyms)
    assets = {}
    for s, c in px.items():
        last = clean_last(c)
        pc = prev_close(c, fx24=s in fx24)
        if last is None:
            continue
        d1 = (last - pc) if (pc is not None and s in rate_syms) else (last / pc - 1 if pc else None)
        assets[s] = {"p": _r(last, 4), "d1": _r(d1, 4), "t": c.index[-1].tz_convert("UTC").strftime("%Y-%m-%dT%H:%MZ")}
    log(f"aset makro: {len(assets)}/{len(msyms)}")
    # ---- saham: saat bursa buka, atau sekali setelah tutup (bila data saham lama dari sesi sebelumnya)
    stocks = old.get("stocks") or {}
    stocks_t = old.get("stocks_t")
    stocks_day = old.get("stocks_day")
    need_after = weekday and mins > 960 and (not stocks_t or stocks_t < now.strftime("%Y-%m-%dT") + "20:00")
    old_fmt = bool(stocks) and all(len(v) < 5 for v in list(stocks.values())[:20])  # format lama tanpa aliran dana
    if market_open or need_after or not stocks or old_fmt:
        try:
            with open(os.path.join(ROOT, "docs", "data", "stocks.json"), encoding="utf-8") as fh:
                syms = [x["sym"] for x in json.load(fh)["stocks"]]
        except Exception:  # noqa: BLE001
            syms = []
        sp = fetch(syms, period="5d", interval="15m", full=True)
        new, nbig, sday = {}, 0, None
        for s, df in sp.items():
            c = df["Close"]
            last = clean_last(c)
            pc = prev_close(c)
            if last:
                chg = last / pc - 1 if pc else None
                row = [_r(last, 2), _r(chg, 4)]
                it = aliran.intraday(df)
                if it:  # [harga, chg1d, volume relatif, dana bersih $, tekanan beli -1..1]
                    row += [it[1], it[2], it[3]]
                    sday = max(sday or it[0], it[0])
                    nbig += aliran.big_flow(it[1], it[2], it[3], chg)[0] is not None
                new[s] = row
        if len(new) > 0.5 * max(1, len(syms)):
            stocks, stocks_t, stocks_day = new, now.strftime("%Y-%m-%dT%H:%MZ"), sday
        log(f"saham: {len(new)}/{len(syms)} · aliran dana besar: {nbig}")
    out = {"t": now.strftime("%Y-%m-%dT%H:%MZ"), "market_open": market_open, "assets": assets,
           "stocks": stocks, "stocks_t": stocks_t, "stocks_day": stocks_day}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    log(f"live.json ditulis · IDR={assets.get('IDR=X', {}).get('p')} · bursa {'BUKA' if market_open else 'tutup'}")


if __name__ == "__main__":
    main()
