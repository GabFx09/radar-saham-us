"""
Analisis siklus pasar saham AS ~100 tahun (S&P 500 / ^GSPC sejak 1927, indeks harga tanpa dividen).

Pola yang diuji:
  1. Bull & bear market (aturan 20%) + koreksi 10-20%
  2. Musiman bulanan (Sell in May, September, reli akhir tahun)
  3. Siklus presiden 4 tahunan (+ reli dari dasar tahun midterm)
  4. Siklus dekade (digit terakhir tahun)
  5. Drawdown terdalam & waktu pemulihan
  6. Return ke depan setelah kondisi tertentu (rekor tertinggi, turun 10/20/30%, tahun > +20%)
  7. Tren jangka panjang (regresi log) & mean reversion 10 tahun
  8. Analisis spektral (FFT) untuk mencari periode siklus dominan
  9. Barometer Januari
 10. Posisi siklus saat ini
"""
import datetime as dt
import math

import numpy as np
import pandas as pd

BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]
TERM = {1: "Tahun 1 (pasca pemilu)", 2: "Tahun 2 (midterm)", 3: "Tahun 3 (pra-pemilu)", 4: "Tahun 4 (pemilu)"}


def _r(x, n=4):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, n) if math.isfinite(x) else None


def term_year(y):
    return {1: 1, 2: 2, 3: 3, 0: 4}[y % 4]


# ----------------------------------------------------------------------------- 1. bull / bear
def regimes(c, thr=0.20):
    """Bull/bear klasik: bear dimulai di puncak bila harga turun >= thr; bull dimulai di dasar bila naik >= thr."""
    vals, idx = c.values, c.index
    state = "bull"
    ext_i = 0  # indeks puncak (bull) / dasar (bear)
    start_i = 0
    out = []
    for i in range(1, len(vals)):
        if state == "bull":
            if vals[i] > vals[ext_i]:
                ext_i = i
            elif vals[i] <= vals[ext_i] * (1 - thr):
                out.append(("bull", start_i, ext_i))
                state, start_i, ext_i = "bear", ext_i, i
        else:
            if vals[i] < vals[ext_i]:
                ext_i = i
            elif vals[i] >= vals[ext_i] * (1 + thr):
                out.append(("bear", start_i, ext_i))
                state, start_i, ext_i = "bull", ext_i, i
    out.append((state, start_i, len(vals) - 1))  # fase berjalan
    res = []
    for k, (typ, a, b) in enumerate(out):
        res.append({"type": typ, "start": idx[a].strftime("%Y-%m-%d"), "end": idx[b].strftime("%Y-%m-%d"),
                    "days": int((idx[b] - idx[a]).days), "chg": _r(vals[b] / vals[a] - 1),
                    "ongoing": k == len(out) - 1})
    return res


def episodes(c):
    """Semua episode drawdown: puncak -> dasar -> pulih ke puncak lama (None bila belum pulih)."""
    vals, idx = c.values, c.index
    out = []
    peak_i, i = 0, 1
    while i < len(vals):
        if vals[i] >= vals[peak_i]:
            peak_i = i
            i += 1
            continue
        j, trough = i, i
        while j < len(vals) and vals[j] < vals[peak_i]:
            if vals[j] < vals[trough]:
                trough = j
            j += 1
        rec = j < len(vals)
        out.append({"peak": idx[peak_i].strftime("%Y-%m-%d"), "trough": idx[trough].strftime("%Y-%m-%d"),
                    "rec": idx[j].strftime("%Y-%m-%d") if rec else None,
                    "depth": _r(vals[trough] / vals[peak_i] - 1),
                    "down_days": int((idx[trough] - idx[peak_i]).days),
                    "rec_days": int((idx[j] - idx[trough]).days) if rec else None})
        if not rec:
            break
        peak_i, i = j, j + 1
    return out


# ----------------------------------------------------------------------------- statistik umum
def stat(xs):
    xs = np.asarray([x for x in xs if x is not None and math.isfinite(x)], float)
    if not len(xs):
        return {"n": 0}
    return {"n": int(len(xs)), "avg": _r(xs.mean()), "med": _r(np.median(xs)), "win": _r((xs > 0).mean()),
            "best": _r(xs.max()), "worst": _r(xs.min())}


def forward_returns(c, mask, days):
    """Return rata-rata `days` hari bursa ke depan pada hari-hari di mana mask True (sampel tidak tumpang tindih
    dipakai untuk win-rate agar tidak bias)."""
    fwd = c.shift(-days) / c - 1
    sel = fwd[mask & fwd.notna()]
    return stat(sel.values)


def build(log=print, close=None):
    if close is None:
        import yfinance as yf
        d = yf.download("^GSPC", period="max", interval="1d", auto_adjust=True, progress=False)
        close = d["Close"].squeeze().dropna()
    c = close.astype(float)
    c = c[c > 0]
    log(f"  siklus: {len(c)} hari bursa sejak {c.index[0].date()}")
    out = {"start": c.index[0].strftime("%Y-%m-%d"), "end": c.index[-1].strftime("%Y-%m-%d"),
           "last": _r(c.iloc[-1], 2), "years": _r((c.index[-1] - c.index[0]).days / 365.25, 1)}

    # tahunan & bulanan
    ye = c.resample("YE").last()
    yr = ye.pct_change()
    yr.iloc[0] = None
    yearly = {int(i.year): _r(v) for i, v in yr.items() if v is not None and math.isfinite(v)}
    cur_year = c.index[-1].year
    me = c.resample("ME").last()
    mr = me.pct_change().dropna()
    if mr.index[-1].month == c.index[-1].month and c.index[-1].day < 25:
        mr_full = mr.iloc[:-1]  # bulan berjalan belum lengkap
    else:
        mr_full = mr
    out["cagr"] = _r((c.iloc[-1] / c.iloc[0]) ** (1 / out["years"]) - 1)
    out["yearly"] = [[y, v] for y, v in yearly.items()]

    # ---- 1. bull & bear
    reg = regimes(c)
    bulls = [x for x in reg if x["type"] == "bull" and not x["ongoing"]]
    bears = [x for x in reg if x["type"] == "bear" and not x["ongoing"]]
    eps = episodes(c)
    corr10 = [x for x in eps if -0.2 < x["depth"] <= -0.1 and x["rec"]]
    cur_dd = eps[-1] if eps and not eps[-1]["rec"] else None
    out["regimes"] = {
        "list": reg,
        "bull": {"n": len(bulls), "med_days": int(np.median([b["days"] for b in bulls])),
                 "avg_days": int(np.mean([b["days"] for b in bulls])),
                 "med_chg": _r(np.median([b["chg"] for b in bulls])), "avg_chg": _r(np.mean([b["chg"] for b in bulls]))},
        "bear": {"n": len(bears), "med_days": int(np.median([b["days"] for b in bears])),
                 "avg_days": int(np.mean([b["days"] for b in bears])),
                 "med_chg": _r(np.median([b["chg"] for b in bears])), "avg_chg": _r(np.mean([b["chg"] for b in bears]))},
        "corrections": {"n": len(corr10), "per_year": _r(len(corr10) / out["years"], 2),
                        "med_depth": _r(np.median([x["depth"] for x in corr10])) if corr10 else None,
                        "med_down_days": int(np.median([x["down_days"] for x in corr10])) if corr10 else None,
                        "med_rec_days": int(np.median([x["rec_days"] for x in corr10])) if corr10 else None},
        "current": reg[-1], "current_dd": cur_dd,
    }
    cur = reg[-1]
    if cur["type"] == "bull":
        longer = sum(1 for b in bulls if b["days"] > cur["days"])
        out["regimes"]["current_pct_longer"] = _r(longer / len(bulls))
        out["regimes"]["current_pct_bigger"] = _r(sum(1 for b in bulls if b["chg"] > cur["chg"]) / len(bulls))

    # ---- 2. musiman bulanan
    def season(mrs):
        rows = []
        for m in range(1, 13):
            s = mrs[mrs.index.month == m].values
            rows.append({"m": BULAN[m - 1], **stat(s)})
        return rows
    out["seasonal"] = {"all": season(mr_full), "since1950": season(mr_full[mr_full.index.year >= 1950]),
                       "last30": season(mr_full[mr_full.index.year >= cur_year - 30])}
    # Sell in May: Nov-Apr vs Mei-Okt
    win_ret, sum_ret = [], []
    for y in range(c.index[0].year + 1, cur_year + 1):
        try:
            a = me[(me.index.year == y - 1) & (me.index.month == 10)].iloc[0]
            b = me[(me.index.year == y) & (me.index.month == 4)].iloc[0]
            win_ret.append(b / a - 1)
            e = me[(me.index.year == y) & (me.index.month == 10)]
            if len(e) and not (y == cur_year and c.index[-1].month <= 10):
                sum_ret.append(e.iloc[0] / b - 1)
        except IndexError:
            pass
    out["sell_in_may"] = {"winter": stat(win_ret), "summer": stat(sum_ret)}

    # ---- 3. siklus presiden
    pres = {k: [] for k in (1, 2, 3, 4)}
    for y, v in yearly.items():
        if y == cur_year:
            continue
        pres[term_year(y)].append(v)
    out["presidential"] = [{"k": k, "name": TERM[k], **stat(v)} for k, v in pres.items()]
    # reli dari dasar tahun midterm (12 bulan setelah titik terendah tahun midterm)
    mid = []
    for y in sorted(set(c.index.year)):
        if term_year(y) != 2 or y == cur_year:
            continue
        cy = c[c.index.year == y]
        lo_d = cy.idxmin()
        after = c[(c.index > lo_d) & (c.index <= lo_d + pd.Timedelta(days=365))]
        if len(after) > 200:
            mid.append({"y": y, "low": lo_d.strftime("%Y-%m-%d"), "gain": _r(after.iloc[-1] / cy.min() - 1),
                        "max_gain": _r(after.max() / cy.min() - 1)})
    out["midterm_rally"] = {"list": mid, **stat([m["gain"] for m in mid])}
    # profil rata-rata intra-siklus 4 tahun (bulanan, dinormalisasi ke awal siklus)
    paths = []
    for y in range(1929, cur_year - 3):
        if term_year(y) != 1:
            continue
        s = me[(me.index.year >= y) & (me.index.year <= y + 3)]
        base = me[(me.index.year == y - 1) & (me.index.month == 12)]
        if len(s) == 48 and len(base):
            paths.append((s.values / base.iloc[0]))
    if paths:
        P = np.log(np.vstack(paths))
        out["pres_path"] = [_r(math.exp(x) - 1) for x in np.median(P, axis=0)]
        out["pres_path_avg"] = [_r(math.exp(x) - 1) for x in P.mean(axis=0)]
        out["pres_path_n"] = len(paths)
    # posisi bulan saat ini dalam siklus
    out["pres_now"] = {"year": cur_year, "k": term_year(cur_year),
                       "month_idx": (term_year(cur_year) - 1) * 12 + c.index[-1].month - 1}

    # ---- 4. siklus dekade
    dec = {k: [] for k in range(10)}
    for y, v in yearly.items():
        if y != cur_year:
            dec[y % 10].append(v)
    out["decennial"] = [{"d": k, **stat(v)} for k, v in dec.items()]

    # ---- 5. drawdown terdalam
    out["drawdowns"] = sorted([x for x in eps if x["depth"] <= -0.15], key=lambda x: x["depth"])[:12]
    vals = c.values

    # ---- 6. return ke depan setelah kondisi
    ath = c.cummax()
    dd = c / ath - 1
    yr_chg = c / c.shift(252) - 1
    conds = [
        ("all", "Semua hari (pembanding)", pd.Series(True, index=c.index)),
        ("ath", "Di rekor tertinggi baru", c >= ath),
        ("dd10", "Turun 10–20% dari puncak", (dd <= -0.10) & (dd > -0.20)),
        ("dd20", "Turun 20–30% (bear market)", (dd <= -0.20) & (dd > -0.30)),
        ("dd30", "Turun > 30% dari puncak", dd <= -0.30),
        ("hot", "Naik > 25% dalam 12 bulan", yr_chg >= 0.25),
        ("cold", "Turun > 15% dalam 12 bulan", yr_chg <= -0.15),
    ]
    out["forward"] = []
    for key, name, mask in conds:
        out["forward"].append({"key": key, "name": name, "share": _r(mask.mean()),
                               "f3m": forward_returns(c, mask, 63), "f1y": forward_returns(c, mask, 252),
                               "f3y": forward_returns(c, mask, 756)})

    # ---- 7. tren jangka panjang & mean reversion
    t = (c.index - c.index[0]).days.values / 365.25
    lc = np.log(c.values)
    b1, b0 = np.polyfit(t, lc, 1)
    trend = np.exp(b0 + b1 * t)
    dev = c.values / trend - 1
    dev_s = pd.Series(dev, index=c.index)
    f10 = (c.shift(-2520) / c) ** (1 / 10) - 1
    quint = pd.qcut(dev_s, 5, labels=False)
    mr_rows = []
    for q in range(5):
        m = (quint == q) & f10.notna()
        mr_rows.append({"q": q + 1, "dev_lo": _r(dev_s[quint == q].min()), "dev_hi": _r(dev_s[quint == q].max()),
                        "f10": _r(f10[m].mean()), "f10_min": _r(f10[m].min()), "f10_max": _r(f10[m].max())})
    wk = c.resample("W").last()
    tw = (wk.index - c.index[0]).days.values / 365.25
    out["trend"] = {
        "cagr": _r(math.exp(b1) - 1), "dev_now": _r(dev[-1]),
        "dev_pct": _r((dev_s < dev[-1]).mean()), "quintiles": mr_rows,
        "series": [[d.strftime("%Y-%m"), _r(v, 2), _r(math.exp(b0 + b1 * tt), 2)]
                   for d, v, tt in zip(wk.index[::4], wk.values[::4], tw[::4])],
    }
    out["trend"]["series"].append([c.index[-1].strftime("%Y-%m"), _r(c.iloc[-1], 2), _r(trend[-1], 2)])
    # deviasi historis puncak/lembah
    out["trend"]["dev_max"] = [dev_s.idxmax().strftime("%Y-%m-%d"), _r(dev_s.max())]
    out["trend"]["dev_min"] = [dev_s.idxmin().strftime("%Y-%m-%d"), _r(dev_s.min())]

    # ---- 8. analisis spektral (deviasi dari tren, data bulanan)
    mdev = dev_s.resample("ME").last().dropna().values
    x = np.log1p(mdev)
    x = x - x.mean()
    win = np.hanning(len(x))
    F = np.abs(np.fft.rfft(x * win)) ** 2
    freqs = np.fft.rfftfreq(len(x), d=1 / 12)  # siklus per tahun
    rows = []
    for f_, p in zip(freqs[1:], F[1:]):
        per = 1 / f_
        if 2 <= per <= 40:
            rows.append((per, p))
    tot = sum(p for _, p in rows)
    # puncak lokal
    peaks = []
    for k in range(1, len(rows) - 1):
        if rows[k][1] > rows[k - 1][1] and rows[k][1] > rows[k + 1][1]:
            peaks.append(rows[k])
    peaks.sort(key=lambda r: -r[1])
    # uji signifikansi: bandingkan dengan 300 deret acak AR(1) dengan autokorelasi sama (red noise)
    a = np.corrcoef(x[:-1], x[1:])[0, 1]
    rng = np.random.default_rng(7)
    sims = []
    for _ in range(300):
        e = rng.normal(0, x.std() * math.sqrt(1 - a * a), len(x))
        y_ = np.zeros(len(x))
        for k in range(1, len(x)):
            y_[k] = a * y_[k - 1] + e[k]
        Fs = np.abs(np.fft.rfft((y_ - y_.mean()) * win)) ** 2
        sims.append(Fs[1:])
    sims = np.array(sims)
    p95 = np.percentile(sims, 95, axis=0)
    per_all = 1 / freqs[1:]

    def signif(per, p):
        k = int(np.argmin(np.abs(per_all - per)))
        return bool(p > p95[k]), _r(p / np.median(sims[:, k]), 2)
    out["spectral"] = {
        "ar1": _r(a, 3),
        "peaks": [{"years": _r(per, 1), "share": _r(p / tot, 3), "sig": signif(per, p)[0], "ratio": signif(per, p)[1]}
                  for per, p in peaks[:6]],
        "curve": [[_r(per, 2), _r(p / tot, 4)] for per, p in rows if per <= 40],
    }

    # ---- 9. barometer Januari
    jb = []
    for y in range(c.index[0].year + 1, cur_year):
        try:
            dec_prev = me[(me.index.year == y - 1) & (me.index.month == 12)].iloc[0]
            jan = me[(me.index.year == y) & (me.index.month == 1)].iloc[0]
            dec_ = me[(me.index.year == y) & (me.index.month == 12)].iloc[0]
            jb.append((jan / dec_prev - 1, dec_ / jan - 1))
        except IndexError:
            pass
    up = [r for j, r in jb if j > 0]
    dn = [r for j, r in jb if j <= 0]
    out["january"] = {"up": stat(up), "down": stat(dn)}

    # reli Sinterklas (5 hari terakhir Des + 2 hari pertama Jan)
    santa = []
    for y in range(c.index[0].year, cur_year):
        d = c[(c.index.year == y) & (c.index.month == 12)]
        n = c[(c.index.year == y + 1) & (c.index.month == 1)]
        if len(d) > 6 and len(n) > 2:
            santa.append(n.iloc[1] / d.iloc[-6] - 1)
    out["santa"] = stat(santa)

    # ---- 10. ringkasan posisi saat ini
    now = c.index[-1]
    mi = now.month - 1
    seas = out["seasonal"]["since1950"]
    nxt = [(mi + k) % 12 for k in range(0, 3)]
    out["now"] = {
        "date": now.strftime("%Y-%m-%d"),
        "regime": cur, "dd_from_ath": _r(dd.iloc[-1]), "ath": _r(ath.iloc[-1], 2),
        "pres_k": term_year(now.year), "next_pres_k": term_year(now.year + 1),
        "season_next3": [{"m": BULAN[k], "avg": seas[k]["avg"], "win": seas[k]["win"]} for k in nxt],
        "trend_dev": out["trend"]["dev_now"], "trend_pct": out["trend"]["dev_pct"],
        "ytd": _r(c.iloc[-1] / ye[ye.index.year == now.year - 1].iloc[0] - 1),
    }
    log(f"  siklus: {len(bulls)} bull, {len(bears)} bear, deviasi tren {dev[-1]*100:.0f}%")
    return out
