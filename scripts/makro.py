"""
Monitor makro untuk Radar Saham US.

1. Lintas aset: indeks, suku bunga, komoditas, valas (termasuk USD/IDR), kripto, kredit.
2. Kurva yield: snapshot 3 bln-30 thn, spread 10Y-3M sejak 1962, inversi vs resesi NBER.
3. Indeks Fear & Greed buatan sendiri (7 komponen, dinormalisasi persentil 1 tahun).
4. Rotasi sektor (Relative Rotation Graph) + kinerja ETF sektor.
5. Revisi estimasi EPS & kejutan laba per saham (dipanggil dari screener).
"""
import math
import time

import numpy as np
import pandas as pd
import yfinance as yf

ASSETS = [
    ("Indeks", [("SPY", "S&P 500"), ("QQQ", "Nasdaq 100"), ("DIA", "Dow Jones"), ("IWM", "Russell 2000"), ("^VIX", "VIX")]),
    ("Obligasi AS", [("^IRX", "T-Bill 3 bln"), ("^FVX", "Treasury 5 thn"), ("^TNX", "Treasury 10 thn"), ("^TYX", "Treasury 30 thn")]),
    ("Komoditas", [("CL=F", "Minyak WTI"), ("GC=F", "Emas"), ("SI=F", "Perak"), ("HG=F", "Tembaga")]),
    ("Valas", [("DX-Y.NYB", "Indeks Dolar"), ("IDR=X", "USD/IDR"), ("EURUSD=X", "EUR/USD"), ("JPY=X", "USD/JPY")]),
    ("Kripto", [("BTC-USD", "Bitcoin"), ("ETH-USD", "Ethereum")]),
    ("Kredit", [("HYG", "Obligasi High Yield"), ("LQD", "Obligasi Investment Grade"), ("TLT", "Treasury 20+ thn")]),
]
RATE_SYMS = {"^IRX", "^FVX", "^TNX", "^TYX"}
SECTOR_ETF = [("XLK", "Teknologi"), ("XLF", "Keuangan"), ("XLV", "Kesehatan"), ("XLE", "Energi"), ("XLI", "Industri"),
              ("XLY", "Konsumen Siklikal"), ("XLP", "Konsumen Primer"), ("XLU", "Utilitas"), ("XLB", "Bahan Baku"),
              ("XLRE", "Properti"), ("XLC", "Komunikasi")]
EXTRA = ["IEF"]
# Resesi AS versi NBER (puncak -> dasar), data publik
RECESSIONS = [("1969-12", "1970-11"), ("1973-11", "1975-03"), ("1980-01", "1980-07"), ("1981-07", "1982-11"),
              ("1990-07", "1991-03"), ("2001-03", "2001-11"), ("2007-12", "2009-06"), ("2020-02", "2020-04")]


def all_symbols():
    return [s for _, g in ASSETS for s, _ in g] + [s for s, _ in SECTOR_ETF] + EXTRA


def _r(x, n=4):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, n) if math.isfinite(x) else None


def download(symbols, period="2y", log=print):
    """Unduh harga penutupan dengan pengulangan untuk simbol yang gagal."""
    out = {}
    todo = list(dict.fromkeys(symbols))
    for attempt in range(3):
        if not todo:
            break
        try:
            df = yf.download(todo, period=period, interval="1d", auto_adjust=True, group_by="ticker",
                             threads=True, progress=False)
        except Exception as e:  # noqa: BLE001
            log(f"  makro: unduhan gagal ({e})")
            time.sleep(3)
            continue
        for s in todo:
            try:
                sub = df[s] if isinstance(df.columns, pd.MultiIndex) else df
                c = sub["Close"].dropna()
                if len(c) > 30:
                    out[s] = c.astype(float)
            except Exception:  # noqa: BLE001
                pass
        todo = [s for s in todo if s not in out]
        if todo:
            time.sleep(3 + 4 * attempt)
    if todo:
        log(f"  makro: tidak tersedia {todo}")
    return out


# ----------------------------------------------------------------------------- lintas aset
def _chg(c, days, rate):
    if len(c) <= days:
        return None
    a, b = c.iloc[-1 - days], c.iloc[-1]
    return _r(b - a, 3) if rate else _r(b / a - 1)


def despike(c, tol=0.025):
    """Hapus titik yang menyimpang > tol dari median 11 hari di sekitarnya (kuotasi valas Yahoo kadang salah,
    mis. USD/IDR melompat 3% lalu kembali esok harinya)."""
    med = c.rolling(11, center=True, min_periods=5).median()
    ok = (c / med - 1).abs() <= tol
    ok.iloc[-1] = ok.iloc[-1] or abs(c.iloc[-1] / c.iloc[-6:-1].median() - 1) <= tol * 2
    return c[ok]


def cross_asset(px):
    groups = []
    for gname, items in ASSETS:
        rows = []
        for sym, name in items:
            c = px.get(sym)
            if c is not None and gname == "Valas":
                c = despike(c)
            if c is None or len(c) < 30:
                continue
            rate = sym in RATE_SYMS
            ytd_base = c[c.index.year < c.index[-1].year]
            ytd = None
            if len(ytd_base):
                ytd = _r(c.iloc[-1] - ytd_base.iloc[-1], 3) if rate else _r(c.iloc[-1] / ytd_base.iloc[-1] - 1)
            tail = c.iloc[-90:]
            rows.append({"sym": sym, "name": name, "last": _r(c.iloc[-1], 4), "rate": rate,
                         "d1": _chg(c, 1, rate), "w1": _chg(c, 5, rate), "m1": _chg(c, 21, rate),
                         "m3": _chg(c, 63, rate), "ytd": ytd, "y1": _chg(c, 252, rate),
                         "spark": [_r(x, 4) for x in tail.values[:: max(1, len(tail) // 45)]]})
        if rows:
            groups.append({"name": gname, "rows": rows})
    return groups


# ----------------------------------------------------------------------------- kurva yield
def yield_curve(px, log=print):
    snap = []
    for sym, label, yrs in [("^IRX", "3B", 0.25), ("^FVX", "5T", 5), ("^TNX", "10T", 10), ("^TYX", "30T", 30)]:
        c = px.get(sym)
        if c is None:
            continue
        def at(days):
            return _r(c.iloc[-1 - days], 3) if len(c) > days else None
        snap.append({"label": label, "yrs": yrs, "now": _r(c.iloc[-1], 3), "m1": at(21), "y1": at(252)})
    out = {"snap": snap}
    long = download(["^TNX", "^IRX"], period="max", log=log)
    if "^TNX" not in long or "^IRX" not in long:
        return out
    j = pd.concat([long["^TNX"], long["^IRX"]], axis=1, join="inner").dropna()
    j.columns = ["t10", "t3m"]
    sp = (j["t10"] - j["t3m"]).resample("ME").mean().dropna()
    out["spread_now"] = _r((j["t10"] - j["t3m"]).iloc[-1], 3)
    out["t10_now"], out["t3m_now"] = _r(j["t10"].iloc[-1], 3), _r(j["t3m"].iloc[-1], 3)
    out["series"] = [[d.strftime("%Y-%m"), _r(v, 2)] for d, v in sp.items()]
    out["recessions"] = [list(r) for r in RECESSIONS]
    # episode inversi (rata-rata bulanan < 0)
    inv = sp < 0
    eps = []
    start = None
    for d, v in inv.items():
        if v and start is None:
            start = d
        elif not v and start is not None:
            eps.append([start, d])
            start = None
    if start is not None:
        eps.append([start, None])
    out["inversions"] = [{"start": a.strftime("%Y-%m"), "end": b.strftime("%Y-%m") if b is not None else None,
                          "months": int(((b or sp.index[-1]) - a).days / 30.4) + 1,
                          "min": _r(sp[(sp.index >= a) & ((sp.index <= b) if b is not None else True)].min(), 2)}
                         for a, b in eps]
    # waktu tunggu inversi pertama -> resesi
    leads = []
    for rs, re_ in RECESSIONS:
        rs_d = pd.Timestamp(rs + "-01")
        prior = [e for e in eps if e[0] < rs_d and e[0] >= rs_d - pd.DateOffset(months=30)]
        if prior:
            first = min(e[0] for e in prior)
            leads.append({"rec": rs, "inv": first.strftime("%Y-%m"),
                          "lead": int(round((rs_d - first).days / 30.4))})
        else:
            leads.append({"rec": rs, "inv": None, "lead": None})
    out["leads"] = leads
    # inversi tanpa resesi (false positive)
    fp = []
    for a, b in eps:
        hit = any(pd.Timestamp(rs + "-01") >= a and pd.Timestamp(rs + "-01") <= a + pd.DateOffset(months=30)
                  for rs, _ in RECESSIONS)
        if not hit and (b is None or (b - a).days > 60):
            fp.append(a.strftime("%Y-%m"))
    out["false_pos"] = fp
    last_inv = eps[-1] if eps else None
    if last_inv:
        out["last_inv"] = {"start": last_inv[0].strftime("%Y-%m"),
                           "end": last_inv[1].strftime("%Y-%m") if last_inv[1] is not None else None,
                           "months_since_end": int((sp.index[-1] - last_inv[1]).days / 30.4) if last_inv[1] is not None else None}
    return out


# ----------------------------------------------------------------------------- fear & greed
def _pct_rank(s, win=252):
    return s.rolling(win, min_periods=60).apply(lambda a: (a[:-1] < a[-1]).mean() * 100 if len(a) > 1 else np.nan,
                                              raw=True)


FG_LABEL = [(25, "Ketakutan Ekstrem"), (45, "Takut"), (55, "Netral"), (75, "Serakah"), (101, "Keserakahan Ekstrem")]


def fg_label(v):
    for lim, n in FG_LABEL:
        if v < lim:
            return n
    return FG_LABEL[-1][1]


def fear_greed(px, universe):
    spy, vix = px.get("SPY"), px.get("^VIX")
    if spy is None or vix is None:
        return None
    idx = spy.index
    comps = {}
    # 1. momentum: SPY vs MA125
    comps["momentum"] = ("Momentum S&P 500", "Jarak S&P 500 dari rata-rata 125 hari", spy / spy.rolling(125).mean() - 1)
    # 2-3. kekuatan & keluasan dari ~530 saham
    if universe:
        U = pd.DataFrame(universe).reindex(idx).ffill()
        hi = U.rolling(252, min_periods=200).max()
        lo = U.rolling(252, min_periods=200).min()
        valid = hi.notna().sum(axis=1).replace(0, np.nan)
        nh = ((U >= hi * 0.98).sum(axis=1) - (U <= lo * 1.02).sum(axis=1)) / valid
        comps["strength"] = ("Kekuatan harga", "Saham di dekat puncak 52 minggu dikurangi yang di dekat dasar", nh)
        ma50 = U.rolling(50).mean()
        br = (U > ma50).sum(axis=1) / ma50.notna().sum(axis=1).replace(0, np.nan)
        comps["breadth"] = ("Keluasan pasar", "% saham di atas rata-rata 50 hari", br)
    # 4. volatilitas (dibalik: VIX tinggi = takut)
    v = vix.reindex(idx).ffill()
    comps["volatility"] = ("Volatilitas (VIX)", "VIX dibanding rata-rata 50 hari (dibalik)", -(v / v.rolling(50).mean() - 1))
    # 5. permintaan aset aman: saham vs obligasi 20 hari
    tlt = px.get("TLT")
    if tlt is not None:
        t = tlt.reindex(idx).ffill()
        comps["safe"] = ("Permintaan aset aman", "Return 20 hari saham dikurangi Treasury jangka panjang",
                         spy.pct_change(20) - t.pct_change(20))
    # 6. obligasi sampah
    hyg, ief = px.get("HYG"), px.get("IEF")
    if hyg is not None and ief is not None:
        h, i = hyg.reindex(idx).ffill(), ief.reindex(idx).ffill()
        comps["junk"] = ("Permintaan obligasi berisiko", "Return 20 hari obligasi high-yield dikurangi Treasury",
                         h.pct_change(20) - i.pct_change(20))
    # 7. emas vs saham (safe haven klasik)
    gold = px.get("GC=F")
    if gold is not None:
        g = gold.reindex(idx).ffill()
        comps["gold"] = ("Saham vs emas", "Return 20 hari saham dikurangi emas", spy.pct_change(20) - g.pct_change(20))

    scores = {k: _pct_rank(s.astype(float)) for k, (_, _, s) in comps.items()}
    S = pd.DataFrame(scores)
    comp = S.mean(axis=1, skipna=True).dropna()
    comp = comp.rolling(3, min_periods=1).mean()  # haluskan sedikit
    if comp.empty:
        return None

    def ago(d):
        return _r(comp.iloc[-1 - d], 1) if len(comp) > d else None
    now = float(comp.iloc[-1])
    hist = comp.iloc[-260:]
    spy_h = spy.reindex(hist.index)
    return {
        "now": _r(now, 1), "label": fg_label(now),
        "w1": ago(5), "m1": ago(21), "y1": ago(250),
        "components": [{"key": k, "name": comps[k][0], "desc": comps[k][1], "score": _r(S[k].iloc[-1], 1),
                        "label": fg_label(S[k].iloc[-1]) if pd.notna(S[k].iloc[-1]) else None}
                       for k in comps if pd.notna(S[k].iloc[-1])],
        "hist": [[d.strftime("%Y-%m-%d"), _r(v, 1), _r(p, 2)] for d, v, p in
                 zip(hist.index[::2], hist.values[::2], spy_h.values[::2])],
        "stats": _fg_forward(comp, spy),
    }


def _fg_forward(comp, spy):
    """Return SPY 1 & 3 bulan ke depan menurut zona F&G (sampel 2 tahun — indikatif)."""
    f21 = spy.shift(-21) / spy - 1
    f63 = spy.shift(-63) / spy - 1
    out = []
    for lo, hi, n in [(0, 25, "Ketakutan Ekstrem"), (25, 45, "Takut"), (45, 55, "Netral"), (55, 75, "Serakah"),
                      (75, 101, "Keserakahan Ekstrem")]:
        m = (comp >= lo) & (comp < hi)
        a, b = f21.reindex(comp.index)[m].dropna(), f63.reindex(comp.index)[m].dropna()
        out.append({"zone": n, "days": int(m.sum()), "f1m": _r(a.mean()) if len(a) > 5 else None,
                    "f3m": _r(b.mean()) if len(b) > 5 else None})
    return out


# ----------------------------------------------------------------------------- rotasi sektor
def sector_rotation(px):
    spy = px.get("SPY")
    if spy is None:
        return None
    sw = spy.resample("W-FRI").last()
    rows = []
    for sym, name in SECTOR_ETF:
        c = px.get(sym)
        if c is None:
            continue
        w = c.resample("W-FRI").last().reindex(sw.index).ffill()
        rel = w / sw
        ratio = 100 * rel / rel.rolling(26, min_periods=20).mean()
        mom = 100 * ratio / ratio.shift(4)
        # normalisasi ke 100 ± skala agar tersebar (gaya JdK)
        tail = [[_r(x, 2), _r(y, 2)] for x, y in zip(ratio.iloc[-6:].values, mom.iloc[-6:].values)
                if pd.notna(x) and pd.notna(y)]
        if not tail:
            continue
        x, y = tail[-1]
        quad = ("Memimpin" if x >= 100 and y >= 100 else "Melemah" if x >= 100 else
                "Membaik" if y >= 100 else "Tertinggal")
        rows.append({"sym": sym, "name": name, "tail": tail, "quad": quad,
                     "w1": _chg(c, 5, False), "m1": _chg(c, 21, False), "m3": _chg(c, 63, False),
                     "ytd": _r(c.iloc[-1] / c[c.index.year < c.index[-1].year].iloc[-1] - 1)
                     if len(c[c.index.year < c.index[-1].year]) else None,
                     "y1": _chg(c, 252, False), "rs3m": _r((_chg(c, 63, False) or 0) - (_chg(spy, 63, False) or 0))})
    return rows


# ----------------------------------------------------------------------------- estimasi analis
def fetch_estimates(sym):
    """Revisi estimasi EPS (eps_trend / eps_revisions) dan riwayat kejutan laba 4 kuartal."""
    for attempt in range(2):
        try:
            t = yf.Ticker(sym)
            tr = t.eps_trend
            rv = t.eps_revisions
            eh = t.earnings_history
            out = {}
            try:
                ins = insider_summary(t)
                if ins:
                    out["ins"] = ins
            except Exception:  # noqa: BLE001
                pass
            if tr is not None and len(tr):
                for per, key in (("0y", "fy0"), ("+1y", "fy1")):
                    if per in tr.index:
                        row = tr.loc[per]
                        cur = row.get("current")
                        def chg(col):
                            v = row.get(col)
                            return _r(cur / v - 1) if cur and v and v > 0 else None
                        out[key] = {"eps": _r(cur, 3), "r7": chg("7daysAgo"), "r30": chg("30daysAgo"),
                                    "r90": chg("90daysAgo")}
            if rv is not None and len(rv):
                up = dn = 0
                for per in ("0y", "+1y"):
                    if per in rv.index:
                        up += int(rv.loc[per].get("upLast30days") or 0)
                        dn += int(rv.loc[per].get("downLast30days") or 0)
                out["up30"], out["down30"] = up, dn
            if eh is not None and len(eh):
                q = []
                for d, row in eh.tail(4).iterrows():
                    sp = row.get("surprisePercent")
                    q.append([str(d)[:10], _r(row.get("epsActual"), 3), _r(row.get("epsEstimate"), 3),
                              _r(sp, 4) if sp is not None else None])
                out["surprises"] = q
                sps = [x[3] for x in q if x[3] is not None]
                out["beats"] = sum(1 for x in sps if x > 0)
                out["n_q"] = len(sps)
                out["avg_surprise"] = _r(float(np.mean(sps))) if sps else None
            return sym, out or None
        except Exception:  # noqa: BLE001
            time.sleep(1.5)
    return sym, None


def insider_summary(t):
    """Ringkasan transaksi orang dalam: pembelian/penjualan pasar terbuka 90 hari + ringkasan 6 bulan Yahoo."""
    out = {}
    ip = t.insider_purchases
    if ip is not None and len(ip):
        lab = ip.columns[0]
        rows = {str(r[lab]).strip(): r for _, r in ip.iterrows()}
        g = lambda k, c="Shares": _r(rows[k][c]) if k in rows and pd.notna(rows[k][c]) else None  # noqa: E731
        net = g("% Net Shares Purchased (Sold)")
        out["net_pct"] = net if net is not None and abs(net) <= 1 else None  # >100% = data Yahoo keliru
        out["buy6"], out["sell6"] = g("Purchases"), g("Sales")
    tr = t.insider_transactions
    if tr is not None and len(tr):
        tr = tr.copy()
        tr["d"] = pd.to_datetime(tr["Start Date"], errors="coerce")
        cut = pd.Timestamp.now() - pd.Timedelta(days=90)
        txt = tr["Text"].fillna("").str.lower()
        buy = tr[(tr["d"] >= cut) & txt.str.startswith("purchase")]
        sell = tr[(tr["d"] >= cut) & txt.str.startswith("sale")]
        out["buy90"] = {"n": int(buy["Insider"].nunique()), "val": _r(buy["Value"].fillna(0).sum(), 0),
                        "who": (str(buy.iloc[0]["Insider"]).title() + f" ({buy.iloc[0]['Position']})") if len(buy) else None}
        out["sell90"] = {"n": int(sell["Insider"].nunique()), "val": _r(sell["Value"].fillna(0).sum(), 0)}

        def kind(x):
            x = x.lower()
            return ("Beli" if x.startswith("purchase") else "Jual" if x.startswith("sale") else
                    "Opsi" if "option" in x else "Hibah" if "gift" in x else "Penghargaan" if "award" in x else "Lain")
        out["recent"] = [[str(r_["d"].date()) if pd.notna(r_["d"]) else "", str(r_["Insider"]).title()[:26],
                          str(r_.get("Position") or "")[:22], kind(str(r_["Text"] or "")),
                          _r(r_["Shares"], 0), _r(r_["Value"], 0)] for _, r_ in tr.head(8).iterrows()]
    return out or None


def insider_score(ins, mcap=None):
    """0-100: pembelian pasar terbuka (terutama banyak orang = cluster buying) positif, penjualan bersih besar negatif."""
    if not ins:
        return None
    s = 50.0
    b = ins.get("buy90") or {}
    if b.get("n", 0) >= 2 and (b.get("val") or 0) >= 100_000:
        s += 30
    elif (b.get("val") or 0) >= 100_000:
        s += 15
    net = ins.get("net_pct")
    if net is not None:
        s += max(-15, min(10, net * 100))
    sv = (ins.get("sell90") or {}).get("val") or 0
    if mcap and sv > 0.005 * mcap:
        s -= 10
    return round(max(0, min(100, s)), 1)


def revision_score(e):
    """0-100: revisi estimasi 90 hari (55%), rasio revisi naik/turun 30 hari (20%), kejutan laba (25%)."""
    if not e:
        return None
    def lin(x, bad, good):
        if x is None:
            return None
        return max(0.0, min(100.0, (x - bad) / (good - bad) * 100))
    parts = []
    revs = [e[k]["r90"] for k in ("fy0", "fy1") if e.get(k) and e[k].get("r90") is not None]
    if revs:
        parts.append((lin(float(np.mean(revs)), -0.08, 0.10), 0.55))
    if e.get("up30") is not None and (e["up30"] + e["down30"]) > 0:
        parts.append((100 * e["up30"] / (e["up30"] + e["down30"]), 0.20))
    if e.get("avg_surprise") is not None:
        parts.append((lin(e["avg_surprise"], -0.05, 0.10), 0.25))
    parts = [(s, w) for s, w in parts if s is not None]
    if not parts:
        return None
    return round(sum(s * w for s, w in parts) / sum(w for _, w in parts), 1)


# ----------------------------------------------------------------------------- utama
def fx_from_hourly(px, log=print):
    """Bar harian valas Yahoo kadang berganti sumber kuotasi (mis. USD/IDR melompat 17.500 <-> 18.100).
    Untuk 60 hari terakhir, bangun penutupan harian dari bar per jam yang konsisten."""
    fx = [s for g, items in ASSETS if g == "Valas" for s, _ in items]
    try:
        df = yf.download(fx, period="60d", interval="1h", auto_adjust=False, group_by="ticker", progress=False, threads=True)
    except Exception as e:  # noqa: BLE001
        log(f"  makro: valas per jam gagal ({e})")
        return
    for s in fx:
        try:
            h = (df[s] if isinstance(df.columns, pd.MultiIndex) else df)["Close"].dropna()
        except Exception:  # noqa: BLE001
            continue
        if len(h) < 50 or s not in px:
            continue
        h.index = h.index.tz_convert("UTC").tz_localize(None)
        daily = h.groupby(h.index.date).last()
        daily.index = pd.to_datetime(daily.index)
        base = px[s].copy()
        base.index = pd.to_datetime(base.index).tz_localize(None) if getattr(base.index, "tz", None) is not None else pd.to_datetime(base.index)
        old = base[base.index < daily.index[0]]
        px[s] = pd.concat([old, daily]).astype(float)
        log(f"  makro: {s} 60 hari dari data per jam (terakhir {daily.iloc[-1]:.4f})")


def build(prices, universe_close, log=print):
    syms = all_symbols()
    px = {s: prices[s]["Close"].astype(float).dropna() for s in syms if s in prices}
    missing = [s for s in syms if s not in px]
    if missing:
        px.update(download(missing, "2y", log))
    log(f"  makro: {len(px)}/{len(syms)} aset")
    fx_from_hourly(px, log)
    out = {"assets": cross_asset(px)}
    try:
        out["curve"] = yield_curve(px, log)
    except Exception as e:  # noqa: BLE001
        log(f"  makro: kurva yield gagal ({e})")
    try:
        out["fg"] = fear_greed(px, universe_close)
    except Exception as e:  # noqa: BLE001
        log(f"  makro: fear & greed gagal ({e})")
    try:
        out["rotation"] = sector_rotation(px)
    except Exception as e:  # noqa: BLE001
        log(f"  makro: rotasi sektor gagal ({e})")
    fg = out.get("fg")
    if fg:
        log(f"  makro: Fear & Greed {fg['now']} ({fg['label']})")
    return out
