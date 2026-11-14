"""
Aliran Dana (Money Flow) — siapa yang membeli/menjual dan berapa banyak.

Dari harga & volume harian (semua saham):
  - Perkiraan uang masuk/keluar 20 hari (money flow volume x harga tipikal) + seri mingguan 12 minggu
  - Chaikin Money Flow (CMF-20), Money Flow Index (MFI-14), tren On-Balance Volume (OBV) & divergensinya
  - Rasio volume hari naik vs turun, lonjakan volume relatif (5 hari vs 50 hari)
Dari Yahoo (saham teratas): perubahan kepemilikan 10 institusi terbesar (13F).
Dari info Yahoo (semua saham): perubahan short interest bulanan.
Skor 0-100: >60 akumulasi (uang masuk), <40 distribusi (uang keluar).
"""
import math

import numpy as np
import pandas as pd


def _r(x, n=4):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, n) if math.isfinite(x) else None


def lin(x, bad, good):
    if x is None:
        return None
    return max(0.0, min(100.0, (x - bad) / (good - bad) * 100))


def from_prices(df):
    """df: OHLCV harian (minimal 60 baris)."""
    try:
        d = df[["High", "Low", "Close", "Volume"]].astype(float).dropna()
    except Exception:  # noqa: BLE001
        return None
    d = d[d["Volume"] > 0]
    if len(d) < 60:
        return None
    H, L, C, V = d["High"], d["Low"], d["Close"], d["Volume"]
    rng = (H - L).replace(0, np.nan)
    mfm = (((C - L) - (H - C)) / rng).fillna(0).clip(-1, 1)
    tp = (H + L + C) / 3
    dollar = tp * V
    mf_d = mfm * dollar  # aliran dana bertanda (dolar)
    n = 20
    net20 = float(mf_d.iloc[-n:].sum())
    gross20 = float(dollar.iloc[-n:].sum())
    cmf = float((mfm * V).iloc[-n:].sum() / V.iloc[-n:].sum()) if V.iloc[-n:].sum() else None
    # MFI-14
    raw = tp * V
    up = raw.where(tp > tp.shift(1), 0.0)
    dn = raw.where(tp < tp.shift(1), 0.0)
    pos, neg = float(up.iloc[-14:].sum()), float(dn.iloc[-14:].sum())
    mfi = 100.0 if neg == 0 else 100 - 100 / (1 + pos / neg)
    # OBV
    sign = np.sign(C.diff().fillna(0))
    obv = (sign * V).cumsum()
    avgv = float(V.iloc[-n:].mean()) or 1
    obv_tr = float((obv.iloc[-1] - obv.iloc[-1 - n]) / (avgv * n))
    pchg20 = float(C.iloc[-1] / C.iloc[-1 - n] - 1)
    div = None
    if obv_tr > 0.15 and pchg20 < -0.02:
        div = "akumulasi"     # volume masuk walau harga turun
    elif obv_tr < -0.15 and pchg20 > 0.02:
        div = "distribusi"    # harga naik tapi volume keluar
    upv = float(V.iloc[-n:][C.diff().iloc[-n:] > 0].sum())
    dnv = float(V.iloc[-n:][C.diff().iloc[-n:] < 0].sum())
    ud = upv / dnv if dnv else None
    rv = float(V.iloc[-5:].mean() / V.iloc[-50:].mean()) if V.iloc[-50:].mean() else None
    chg5 = float(C.iloc[-1] / C.iloc[-6] - 1)
    # seri mingguan 12 minggu (dolar bersih)
    wk = mf_d.copy()
    wk.index = pd.to_datetime(wk.index)
    if getattr(wk.index, "tz", None) is not None:
        wk.index = wk.index.tz_localize(None)
    weekly = wk.resample("W-FRI").sum().iloc[-12:]
    return {"net20": _r(net20, 0), "gross20": _r(gross20, 0), "cmf": _r(cmf), "mfi": _r(mfi, 1), "obv_tr": _r(obv_tr),
            "pchg20": _r(pchg20), "div": div, "ud": _r(ud, 2), "rv": _r(rv, 2), "chg5": _r(chg5),
            "weekly": [[i.strftime("%Y-%m-%d"), _r(v, 0)] for i, v in weekly.items()]}


def short_info(info):
    s, p = info.get("sharesShort"), info.get("sharesShortPriorMonth")
    if not s:
        return None
    out = {"shares": s, "pct_float": _r(info.get("shortPercentOfFloat")), "days": _r(info.get("shortRatio"), 2)}
    if p:
        out["chg"] = _r(s / p - 1)
    return out


def inst_summary(t, price=None):
    """10 institusi terbesar (laporan 13F): perubahan kepemilikan terakhir."""
    ih = t.institutional_holders
    if ih is None or not len(ih):
        return None
    rows, net_sh, held = [], 0.0, 0.0
    for _, r in ih.head(10).iterrows():
        sh = float(r.get("Shares") or 0)
        pc = r.get("pctChange")
        pc = float(pc) if pc is not None and pd.notna(pc) else None
        prev = sh / (1 + pc) if pc is not None and pc > -1 else None
        if prev is not None:
            net_sh += sh - prev
            held += prev
        rows.append([str(r.get("Holder"))[:34], str(r.get("Date Reported"))[:10], _r(r.get("pctHeld")), _r(sh, 0), _r(pc)])
    n_up = sum(1 for x in rows if (x[4] or 0) > 0.001)
    n_dn = sum(1 for x in rows if (x[4] or 0) < -0.001)
    return {"top": rows, "n_up": n_up, "n_dn": n_dn, "net_sh": _r(net_sh, 0), "net_pct": _r(net_sh / held) if held else None,
            "net_usd": _r(net_sh * price, 0) if price else None}


def score(fl, inst=None, short=None):
    if not fl:
        return None
    parts = []
    parts.append((lin(fl.get("cmf"), -0.15, 0.15), 0.30))
    o = lin(fl.get("obv_tr"), -0.5, 0.5)
    if o is not None and fl.get("div") == "akumulasi":
        o = min(100, o + 15)
    if o is not None and fl.get("div") == "distribusi":
        o = max(0, o - 15)
    parts.append((o, 0.15))
    m = fl.get("mfi")
    parts.append((None if m is None else (60.0 if m > 85 else lin(m, 25, 72)), 0.15))
    ud = fl.get("ud")
    parts.append((lin(math.log(ud), -0.4, 0.4) if ud and ud > 0 else None, 0.15))
    rv, c5 = fl.get("rv"), fl.get("chg5")
    if rv is not None and c5 is not None:
        parts.append((80.0 if rv >= 1.5 and c5 > 0 else 20.0 if rv >= 1.5 and c5 < 0 else 50.0, 0.10))
    if inst and inst.get("net_pct") is not None:
        parts.append((lin(inst["net_pct"], -0.03, 0.03), 0.10))
    if short and short.get("chg") is not None:
        parts.append((lin(-short["chg"], -0.25, 0.25), 0.05))
    parts = [(v, w) for v, w in parts if v is not None]
    if not parts:
        return None
    return round(sum(v * w for v, w in parts) / sum(w for _, w in parts), 1)


# ---------------------------------------------------------------- intraday (bar 15 menit)
BIG_RV, BIG_NR, BIG_CHG, BIG_MIN_USD = 2.0, 0.25, 0.01, 5e6


def intraday(df):
    """Volume relatif hari ini vs rata-rata 4 hari sebelumnya sampai jam yang sama, dan perkiraan aliran dana bersih hari ini.
    df: bar 15 menit (High, Low, Close, Volume). Hasil: (tanggal, rv, net_usd, net_ratio) atau None."""
    try:
        d = df[["High", "Low", "Close", "Volume"]].astype(float).dropna()
    except Exception:  # noqa: BLE001
        return None
    d = d[d["Volume"] > 0]
    if len(d) < 8:
        return None
    idx = d.index
    if getattr(idx, "tz", None) is not None:
        idx = idx.tz_convert("America/New_York")
    days = pd.Series([x.date() for x in idx], index=d.index)
    last = days.iloc[-1]
    today = d[days == last]
    n = len(today)
    prev = sorted(set(days[days < last]))[-4:]
    if not prev or not n:
        return None
    base = float(np.mean([d[days == p]["Volume"].iloc[:n].sum() for p in prev]))
    H, L, C, V = today["High"], today["Low"], today["Close"], today["Volume"]
    rng = (H - L).replace(0, np.nan)
    mfm = (((C - L) - (H - C)) / rng).fillna(0).clip(-1, 1)
    tp = (H + L + C) / 3
    net = float((mfm * tp * V).sum())
    gross = float((tp * V).sum())
    return last.isoformat(), (_r(V.sum() / base, 2) if base else None), _r(net, -3), (_r(net / gross, 3) if gross else None)


def big_flow(rv, net, nr, chg):
    """'in' = dana masuk besar, 'out' = dana keluar besar, None = biasa. Kuat bila volume >= 3x & tekanan >= 35%."""
    if rv is None or net is None or nr is None or chg is None or rv < BIG_RV or abs(net) < BIG_MIN_USD:
        return None, False
    strong = rv >= 3 and abs(nr) >= 0.35
    if nr >= BIG_NR and chg >= BIG_CHG:
        return "in", strong
    if nr <= -BIG_NR and chg <= -BIG_CHG:
        return "out", strong
    return None, False
