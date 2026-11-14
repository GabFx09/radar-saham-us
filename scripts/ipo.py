"""
Kalender & analisis IPO saham AS.

Sumber: API kalender IPO Nasdaq (priced / upcoming / filed) + kalender IPO Yahoo Finance (cadangan & pelengkap).
Untuk IPO yang sudah listing (≤ 180 hari): kinerja sejak harga penawaran, hari pertama, dan jadwal
berakhirnya lock-up (±180 hari setelah IPO — orang dalam boleh menjual, harga sering tertekan).
"""
import datetime as dt
import math
import re
import time

import pandas as pd
import requests
import yfinance as yf

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      "Accept": "application/json, text/plain, */*", "Origin": "https://www.nasdaq.com", "Referer": "https://www.nasdaq.com/"}
SPAC_RE = re.compile(r"acquisition|blank check|warrant|\bunits?\b|\brights?\b|\bcorp\.?\s+[ivx]+\b|\bspac\b", re.I)
FUND_RE = re.compile(r"\betf\b|\bfunds?\b|\btrust\b|\bportfolio\b|income opportunit|closed-end", re.I)


def _r(x, n=4):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, n) if math.isfinite(x) else None


def _num(s):
    if s is None:
        return None
    s = str(s).replace("$", "").replace(",", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _range(s):
    """'14.00-16.00' -> (14, 16); '10.00' -> (10, 10)."""
    if not s:
        return None, None
    parts = [_num(x) for x in re.split(r"\s*-\s*", str(s)) if x.strip()]
    parts = [p for p in parts if p]
    if not parts:
        return None, None
    return min(parts), max(parts)


def _date(s):
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(str(s)[:10], fmt).date().isoformat()
        except ValueError:
            pass
    return None


def kind(name, sym=""):
    if SPAC_RE.search(name or "") or re.search(r"(W|U|R)$", sym or "") and len(sym or "") == 5:
        return "SPAC"
    if FUND_RE.search(name or ""):
        return "Dana/ETF"
    return "Perusahaan"


def nasdaq_month(ym, log=print):
    for attempt in range(3):
        try:
            r = requests.get(f"https://api.nasdaq.com/api/ipo/calendar?date={ym}", headers=UA, timeout=(10, 30))
            r.raise_for_status()
            return (r.json() or {}).get("data") or {}
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                log(f"  ipo: Nasdaq {ym} gagal ({e})")
            time.sleep(2 + 3 * attempt)
    return {}


def _rows(block):
    if not block:
        return []
    if isinstance(block, dict) and "rows" in block:
        return block.get("rows") or []
    if isinstance(block, dict) and "upcomingTable" in block:
        return (block["upcomingTable"] or {}).get("rows") or []
    return []


def build(log=print):
    today = dt.date.today()
    months = sorted({(today.replace(day=1) - pd.DateOffset(months=k)).strftime("%Y-%m") for k in range(0, 6)} |
                    {(today.replace(day=1) + pd.DateOffset(months=1)).strftime("%Y-%m")})
    priced, upcoming, filed = {}, {}, {}
    for ym in months:
        d = nasdaq_month(ym, log)
        for x in _rows(d.get("priced")):
            sym = (x.get("proposedTickerSymbol") or "").strip()
            if not sym:
                continue
            priced[sym] = {"sym": sym, "name": x.get("companyName"), "exch": x.get("proposedExchange"),
                           "price": _num(x.get("proposedSharePrice")), "shares": _num(x.get("sharesOffered")),
                           "date": _date(x.get("pricedDate")), "amount": _num(x.get("dollarValueOfSharesOffered"))}
        for x in _rows(d.get("upcoming")):
            sym = (x.get("proposedTickerSymbol") or "").strip()
            lo, hi = _range(x.get("proposedSharePrice"))
            upcoming[sym or x.get("companyName")] = {
                "sym": sym or None, "name": x.get("companyName"), "exch": x.get("proposedExchange"),
                "lo": lo, "hi": hi, "shares": _num(x.get("sharesOffered")), "date": _date(x.get("expectedPriceDate")),
                "amount": _num(x.get("dollarValueOfSharesOffered")), "src": "Nasdaq"}
        for x in _rows(d.get("filed")):
            key = (x.get("proposedTickerSymbol") or "").strip() or x.get("companyName")
            filed[key] = {"sym": (x.get("proposedTickerSymbol") or "").strip() or None, "name": x.get("companyName"),
                          "date": _date(x.get("filedDate")), "amount": _num(x.get("dollarValueOfSharesOffered"))}
    # pelengkap / cadangan: kalender Yahoo
    try:
        cal = yf.Calendars().get_ipo_info_calendar(limit=100)
        for sym, x in cal.iterrows():
            sym = str(sym)
            d_ = x.get("Date")
            ds = pd.Timestamp(d_).date().isoformat() if pd.notna(d_) else None
            act = str(x.get("Action") or "")
            if act.lower().startswith("expected") and ds and ds >= today.isoformat() and sym not in upcoming:
                upcoming[sym] = {"sym": sym, "name": x.get("Company"), "exch": x.get("Exchange") if pd.notna(x.get("Exchange")) else None,
                                 "lo": _r(x.get("Price From"), 2), "hi": _r(x.get("Price To"), 2),
                                 "shares": _r(x.get("Shares"), 0), "date": ds, "amount": None, "src": "Yahoo"}
            elif act.lower().startswith("priced") and sym not in priced and ds:
                priced[sym] = {"sym": sym, "name": x.get("Company"), "exch": x.get("Exchange"), "price": _r(x.get("Price"), 2),
                               "shares": _r(x.get("Shares"), 0), "date": ds, "amount": None}
    except Exception as e:  # noqa: BLE001
        log(f"  ipo: kalender Yahoo gagal ({e})")

    for d in (priced, upcoming, filed):
        for x in d.values():
            x["type"] = kind(x.get("name"), x.get("sym") or "")
            if x.get("amount") is None and x.get("shares") and (x.get("price") or x.get("hi")):
                x["amount"] = _r(x["shares"] * (x.get("price") or x.get("hi")), 0)

    # kinerja IPO terbaru (perusahaan saja, ≤ 200 hari)
    recent = [x for x in priced.values() if x["type"] == "Perusahaan" and x.get("date") and x.get("price")
              and (today - dt.date.fromisoformat(x["date"])).days <= 200]
    syms = [x["sym"] for x in recent]
    px = {}
    if syms:
        try:
            df = yf.download(syms, period="1y", interval="1d", auto_adjust=False, group_by="ticker", progress=False, threads=True)
            for s in syms:
                try:
                    c = (df[s] if isinstance(df.columns, pd.MultiIndex) else df)["Close"].dropna()
                    if len(c):
                        px[s] = c
                except Exception:  # noqa: BLE001
                    pass
        except Exception as e:  # noqa: BLE001
            log(f"  ipo: harga gagal ({e})")
    for x in recent:
        c = px.get(x["sym"])
        d0 = dt.date.fromisoformat(x["date"])
        x["lockup"] = (d0 + dt.timedelta(days=180)).isoformat()
        x["days"] = (today - d0).days
        if c is None or not len(c):
            continue
        idx = c.index.tz_localize(None) if getattr(c.index, "tz", None) is not None else c.index
        c = pd.Series(c.values, index=idx)
        after = c[c.index.date >= d0]
        if not len(after):
            continue
        x["last"] = _r(c.iloc[-1], 2)
        x["first_close"] = _r(after.iloc[0], 2)
        x["day1"] = _r(after.iloc[0] / x["price"] - 1)
        x["ret"] = _r(c.iloc[-1] / x["price"] - 1)
        x["from_first"] = _r(c.iloc[-1] / after.iloc[0] - 1)
        x["hi"] = _r(after.max(), 2)
        x["dd"] = _r(c.iloc[-1] / after.max() - 1)
        x["spark"] = [_r(v, 2) for v in after.values[:: max(1, len(after) // 40)]]
    recent.sort(key=lambda x: x["date"], reverse=True)

    up = sorted(upcoming.values(), key=lambda x: (x.get("date") or "9999"))
    fl = sorted(filed.values(), key=lambda x: (x.get("date") or ""), reverse=True)[:60]
    with_ret = [x for x in recent if x.get("ret") is not None]
    stats = None
    if with_ret:
        stats = {"n": len(with_ret),
                 "day1_avg": _r(sum(x["day1"] for x in with_ret) / len(with_ret)),
                 "ret_med": _r(float(pd.Series([x["ret"] for x in with_ret]).median())),
                 "above_offer": _r(sum(1 for x in with_ret if x["ret"] > 0) / len(with_ret)),
                 "best": max(with_ret, key=lambda x: x["ret"])["sym"], "worst": min(with_ret, key=lambda x: x["ret"])["sym"]}
    out = {"generated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
           "upcoming": [x for x in up if not x.get("date") or x["date"] >= (today - dt.timedelta(days=3)).isoformat()],
           "recent": recent, "filed": fl, "stats": stats,
           "lockups": sorted([{"sym": x["sym"], "name": x["name"], "date": x["lockup"], "ret": x.get("ret")}
                              for x in recent if today.isoformat() <= x["lockup"] <= (today + dt.timedelta(days=45)).isoformat()],
                             key=lambda x: x["date"])}
    log(f"  ipo: {len(out['upcoming'])} akan IPO, {len(recent)} IPO terbaru, {len(fl)} filing")
    return out
