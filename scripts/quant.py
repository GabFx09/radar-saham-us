"""
Modul kuantitatif lanjutan untuk Radar Saham US.

1. Simulasi Monte Carlo per saham (bootstrap return historis, volatilitas EWMA,
   drift = gabungan pandangan model nilai wajar + ekuilibrium CAPM).
2. Metrik risiko (volatilitas, max drawdown, Sharpe, Sortino, beta, VaR).
3. Profil faktor (Value, Quality, Growth, Momentum, Low-Vol, Size) dalam persentil.
4. Model portofolio (mean-variance dengan batas bobot & sektor, kovarians shrinkage)
   untuk tiga profil risiko + backtest 1 tahun.
5. Rekam jejak: snapshot harian rekomendasi & kinerjanya terhadap S&P 500.
"""
import datetime as dt
import json
import math
import os

import numpy as np
import pandas as pd

RF = 0.043
ERP = 0.05
TD = 252
MC_PATHS = 3000
FAN_MONTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]


def _r(x, n=4):
    if x is None:
        return None
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return round(x, n) if math.isfinite(x) else None


# ----------------------------------------------------------------------------- risiko
def risk_metrics(close, spy_close):
    c = close.astype(float).dropna()
    if len(c) < 130:
        return None
    lr = np.log(c).diff().dropna()
    last = lr.iloc[-TD:]
    vol = float(last.std() * math.sqrt(TD))
    # EWMA (RiskMetrics, lambda 0.94) -> volatilitas "saat ini"
    ew = float(np.sqrt((lr ** 2).ewm(alpha=0.06, adjust=False).mean().iloc[-1]) * math.sqrt(TD))
    down = last[last < 0]
    dvol = float(down.std() * math.sqrt(TD)) if len(down) > 10 else vol
    c1 = c.iloc[-TD:]
    dd = c1 / c1.cummax() - 1
    mdd = float(dd.min())
    ret1y = float(c1.iloc[-1] / c1.iloc[0] - 1)
    sharpe = (ret1y - RF) / vol if vol > 0 else None
    sortino = (ret1y - RF) / dvol if dvol > 0 else None
    beta = None
    if spy_close is not None:
        sr = np.log(spy_close.astype(float)).diff()
        j = pd.concat([lr, sr], axis=1, join="inner").dropna().iloc[-TD:]
        if len(j) > 100:
            cov = np.cov(j.iloc[:, 0], j.iloc[:, 1])
            beta = float(cov[0, 1] / cov[1, 1]) if cov[1, 1] > 0 else None
    var95 = float(np.percentile(last, 5))  # VaR harian 95%
    return {"vol": vol, "vol_now": ew, "down_vol": dvol, "mdd": mdd, "sharpe": sharpe,
            "sortino": sortino, "beta_calc": beta, "var95_d": var95}


# ----------------------------------------------------------------------------- Monte Carlo
def expected_return(upside, beta, conf):
    """Gabungan pandangan model (nilai wajar) dan ekuilibrium pasar (CAPM).
    Bobot pandangan model bergantung keyakinan (ala Black-Litterman sederhana)."""
    b = beta if beta is not None and math.isfinite(beta) else 1.0
    capm = RF + clamp(b, 0.4, 2.0) * ERP
    if upside is None:
        return capm, capm, 0.0
    view = clamp(upside, -0.5, 0.8)
    w = {"Tinggi": 0.5, "Sedang": 0.38, "Rendah": 0.22}.get(conf, 0.3)
    return w * view + (1 - w) * capm, capm, w


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def monte_carlo(close, price, exp_ret, vol_hist, vol_now, fair, target, stop, seed):
    c = close.astype(float).dropna()
    lr = np.log(c).diff().dropna().values[-2 * TD:]
    if len(lr) < 120 or not price:
        return None
    sigma = clamp(0.5 * vol_hist + 0.5 * vol_now, 0.12, 1.2)
    # residual terstandar -> mempertahankan ekor gemuk (fat tails) data historis
    z = (lr - lr.mean()) / (lr.std() or 1)
    rng = np.random.default_rng(seed)
    idx = rng.integers(0, len(z), size=(MC_PATHS, TD))
    sd = sigma / math.sqrt(TD)
    mu_d = math.log(1 + exp_ret) / TD  # drift log harian sehingga median ~ exp_ret... dikoreksi di bawah
    steps = mu_d + sd * z[idx]
    paths = np.cumsum(steps, axis=1)
    # koreksi agar rata-rata return 12 bln = exp_ret (bukan median)
    final = np.exp(paths[:, -1])
    adj = math.log((1 + exp_ret) / final.mean()) / TD
    paths += adj * np.arange(1, TD + 1)
    rel = np.exp(paths)  # harga relatif terhadap harga sekarang
    fin = rel[:, -1]

    fan = []
    for m in FAN_MONTHS:
        if m == 0:
            fan.append([1, 1, 1, 1, 1])
            continue
        col = rel[:, min(TD - 1, int(round(m * TD / 12)) - 1)]
        fan.append([round(float(x), 3) for x in np.percentile(col, [5, 25, 50, 75, 95])])

    out = {
        "exp": exp_ret,
        "sigma": sigma,
        "p_up": float((fin > 1).mean()),
        "p_fair": float((fin >= fair / price).mean()) if fair else None,
        "p_loss20": float((fin < 0.8).mean()),
        "p_gain20": float((fin > 1.2).mean()),
        "median": float(np.median(fin) - 1),
        "p5": float(np.percentile(fin, 5) - 1),
        "p95": float(np.percentile(fin, 95) - 1),
        "cvar5": float(fin[fin <= np.percentile(fin, 5)].mean() - 1),
        "fan": fan,
    }
    # peluang menyentuh target sebelum stop loss (path-dependent)
    if target and stop and target > price > stop:
        hit_t = rel >= target / price
        hit_s = rel <= stop / price
        t_first = np.where(hit_t.any(1), hit_t.argmax(1), TD + 1)
        s_first = np.where(hit_s.any(1), hit_s.argmax(1), TD + 1)
        out["p_target_first"] = float(((t_first < s_first) & (t_first <= TD)).mean())
        out["p_stop_first"] = float(((s_first < t_first) & (s_first <= TD)).mean())
        hit_days = t_first[t_first <= TD]
        out["days_to_target"] = int(np.median(hit_days)) if len(hit_days) > MC_PATHS * 0.1 else None
    return out


# ----------------------------------------------------------------------------- faktor
def factor_profile(records):
    """Persentil faktor gaya investasi (0-100) untuk seluruh universe."""
    def rank(vals):
        s = pd.Series(vals, dtype=float)
        return (s.rank(pct=True) * 100).round(0)

    syms = [r["sym"] for r in records]
    val = rank({r["sym"]: r["pillars"]["value"] for r in records})
    qual = rank({r["sym"]: r["pillars"]["quality"] for r in records})
    gro = rank({r["sym"]: r["pillars"]["growth"] for r in records})
    mom = rank({r["sym"]: r["t"].get("mom") for r in records})
    lowv = rank({r["sym"]: -(r["q_risk"]["vol"] if r.get("q_risk") else np.nan) for r in records})
    size = rank({r["sym"]: math.log(r["mcap"]) if r.get("mcap") else np.nan for r in records})
    for r in records:
        s = r["sym"]
        g = lambda ser: None if pd.isna(ser.get(s)) else int(ser.get(s))  # noqa: E731
        r["factors"] = {"value": g(val), "quality": g(qual), "growth": g(gro),
                        "momentum": g(mom), "lowvol": g(lowv), "size": g(size)}
    return syms


# ----------------------------------------------------------------------------- portofolio
PROFILES = {
    "konservatif": {"name": "Konservatif", "lam": 9.0, "max_w": 0.08, "max_sec": 0.25, "n": 22,
                    "desc": "Volatilitas rendah, terdiversifikasi luas, condong ke saham defensif & dividen."},
    "seimbang": {"name": "Seimbang", "lam": 4.0, "max_w": 0.10, "max_sec": 0.30, "n": 18,
                 "desc": "Keseimbangan antara potensi return dan risiko — profil default."},
    "agresif": {"name": "Agresif", "lam": 1.6, "max_w": 0.14, "max_sec": 0.40, "n": 14,
                "desc": "Mengejar return tertinggi, terima fluktuasi lebih besar dan konsentrasi lebih tinggi."},
}


def _proj_box(v, u, total):
    """Proyeksi Euclidean ke {0 <= w <= u, sum(w) = total} (bisection pada pergeseran tau)."""
    if total <= 0 or len(v) == 0:
        return np.zeros_like(v)
    if u * len(v) <= total:
        return np.full_like(v, u)
    lo, hi = float(v.min() - u), float(v.max())
    for _ in range(80):
        tau = (lo + hi) / 2
        if np.clip(v - tau, 0, u).sum() > total:
            lo = tau
        else:
            hi = tau
    return np.clip(v - (lo + hi) / 2, 0, u)


def _project(v, max_w, sectors, max_sec):
    """Proyeksi ke: 0<=w<=max_w, total=1, bobot per sektor <= max_sec.
    Sektor yang melanggar dikunci di batasnya, sisanya diproyeksikan ulang."""
    free = np.ones(len(v), bool)
    w = np.zeros(len(v))
    remaining = 1.0
    for _ in range(len(set(sectors)) + 1):
        w[free] = _proj_box(v[free], max_w, remaining)
        over = [sec for sec in set(sectors[free]) if w[free & (sectors == sec)].sum() > max_sec + 1e-9]
        if not over:
            break
        for sec in over:
            m = free & (sectors == sec)
            w[m] = _proj_box(v[m], max_w, max_sec)
            free &= ~m
            remaining -= max_sec
    return w


def optimize(mu, cov, sectors, prof):
    n = len(mu)
    lam = prof["lam"]
    step = 1.0 / (lam * np.linalg.eigvalsh(cov).max() + 1e-9)
    active = np.ones(n, bool)
    w = np.full(n, 1 / n)
    for _round in range(2):
        idx = np.where(active)[0]
        mu_a, cov_a, sec_a = mu[idx], cov[np.ix_(idx, idx)], sectors[idx]
        wa = _project(np.full(len(idx), 1 / len(idx)), prof["max_w"], sec_a, prof["max_sec"])
        for _ in range(1500):
            grad = mu_a - lam * cov_a @ wa
            wa = _project(wa + step * grad, prof["max_w"], sec_a, prof["max_sec"])
        w = np.zeros(n)
        w[idx] = wa
        # buang posisi < 1.5% lalu optimasi ulang hanya pada sisanya
        keep = w >= 0.015
        if keep.sum() == active.sum() or keep.sum() * prof["max_w"] < 1:
            break
        active = keep
    w[w < 0.004] = 0
    return w / w.sum()


def shrink_cov(R):
    """Kovarians tahunan dengan shrinkage 50% ke korelasi konstan (Ledoit-Wolf sederhana)."""
    S = np.cov(R, rowvar=False) * TD
    sd = np.sqrt(np.diag(S))
    corr = S / np.outer(sd, sd)
    n = len(sd)
    rbar = (corr.sum() - n) / (n * (n - 1)) if n > 1 else 0
    F = rbar * np.outer(sd, sd)
    np.fill_diagonal(F, sd ** 2)
    return 0.5 * S + 0.5 * F, corr


def build_portfolios(records, prices, spy_close, log=print):
    cands = [r for r in records if r["rating"] in ("STRONG BUY", "BUY") and r.get("mc")]
    cands.sort(key=lambda r: -r["score"])
    cands = cands[:60]
    if len(cands) < 8:
        return None
    syms = [r["sym"] for r in cands]
    rets = pd.concat({s: np.log(prices[s]["Close"].astype(float)).diff() for s in syms}, axis=1)
    rets = rets.iloc[-TD:].dropna(axis=1, thresh=int(TD * 0.9)).fillna(0)
    syms = [s for s in syms if s in rets.columns]
    by = {r["sym"]: r for r in cands}
    R = rets[syms].values
    cov, corr = shrink_cov(R)
    # return harapan: gabungan model, sedikit dimiringkan ke skor (keyakinan kualitas)
    mu = np.array([by[s]["mc"]["exp"] + (by[s]["score"] - 65) / 100 * 0.05 for s in syms])
    secs = np.array([by[s]["sector_id"] for s in syms])
    vols = np.sqrt(np.diag(cov))

    spy_r = np.log(spy_close.astype(float)).diff().reindex(rets.index).fillna(0).values if spy_close is not None else None
    out = {}
    for key, prof in PROFILES.items():
        # batasi jumlah kandidat: konservatif condong ke volatilitas rendah
        if key == "konservatif":
            order = np.argsort(vols)[: prof["n"] + 10]
        elif key == "agresif":
            order = np.argsort(-mu)[: prof["n"] + 10]
        else:
            order = np.arange(min(len(syms), prof["n"] + 12))
        order = np.sort(order)
        sub_cov = cov[np.ix_(order, order)]
        w_sub = optimize(mu[order], sub_cov, secs[order], prof)
        w = np.zeros(len(syms))
        w[order] = w_sub
        nz = np.where(w > 0)[0]
        exp_p = float(w @ mu)
        vol_p = float(math.sqrt(w @ cov @ w))
        port_daily = R @ w
        eq = np.exp(np.cumsum(port_daily))
        bt = {"ret": float(eq[-1] - 1),
              "mdd": float((eq / np.maximum.accumulate(eq) - 1).min()),
              "vol": float(port_daily.std() * math.sqrt(TD))}
        curve = []
        spy_eq = np.exp(np.cumsum(spy_r)) if spy_r is not None else None
        for i in range(0, len(eq), 5):
            curve.append([rets.index[i].strftime("%Y-%m-%d"), round(float(eq[i]), 4),
                          round(float(spy_eq[i]), 4) if spy_eq is not None else None])
        curve.append([rets.index[-1].strftime("%Y-%m-%d"), round(float(eq[-1]), 4),
                      round(float(spy_eq[-1]), 4) if spy_eq is not None else None])
        if spy_eq is not None:
            bt["spy"] = float(spy_eq[-1] - 1)
            cv = np.cov(port_daily, spy_r)
            beta_p = float(cv[0, 1] / cv[1, 1]) if cv[1, 1] > 0 else None
        else:
            beta_p = None
        div_ratio = float((w @ vols) / vol_p) if vol_p > 0 else None
        sec_w = {}
        for i in nz:
            sec_w[secs[i]] = sec_w.get(secs[i], 0) + float(w[i])
        hold = []
        for i in sorted(nz, key=lambda i: -w[i]):
            r = by[syms[i]]
            hold.append({"sym": syms[i], "w": _r(w[i], 4), "exp": _r(mu[i]), "vol": _r(vols[i]),
                         "sector": r["sector_id"], "rating": r["rating"], "score": r["score"],
                         "upside": _r(r["val"]["upside"]) if r.get("val") else None,
                         "price": _r(r["t"]["price"], 2)})
        top = [i for i in sorted(nz, key=lambda i: -w[i])][:10]
        out[key] = {
            "name": prof["name"], "desc": prof["desc"],
            "rules": {"max_w": prof["max_w"], "max_sec": prof["max_sec"]},
            "exp": _r(exp_p), "vol": _r(vol_p), "sharpe": _r((exp_p - RF) / vol_p if vol_p else None, 2),
            "beta": _r(beta_p, 2), "div_ratio": _r(div_ratio, 2), "n": len(nz),
            "var95": _r(exp_p - 1.645 * vol_p),
            "sectors": sorted([[k, _r(v, 4)] for k, v in sec_w.items()], key=lambda x: -x[1]),
            "holdings": hold, "backtest": {k: _r(v) for k, v in bt.items()}, "curve": curve,
            "corr": {"syms": [syms[i] for i in top],
                     "m": [[_r(corr[i, j], 2) for j in top] for i in top]},
        }
        log(f"  portofolio {prof['name']}: {len(nz)} saham, exp {exp_p*100:.1f}%, vol {vol_p*100:.1f}%")
    return out


# ----------------------------------------------------------------------------- rekam jejak
# ----------------------------------------------------------------------------- penyetelan bobot otomatis
BASE_PILLAR = {"quality": 0.30, "value": 0.28, "growth": 0.22, "health": 0.20}
BASE_TOP = {"fund": 0.65, "tech": 0.20}
RW_MIN_N = 20      # minimal 20 snapshot yang sudah berumur >= 60 hari (±3 bulan data harian)
RW_IC_FULL = 0.05  # IC sebesar ini = kemiringan penuh


def reweight(ic_rows):
    """Usulan bobot pilar & skor dari IC 3 bulan (h60). Konservatif: maks ±50% dari bobot bawaan,
    kekuatan penyesuaian naik bertahap sesuai jumlah data (penuh setelah 60 snapshot)."""
    by = {r["key"]: r for r in ic_rows or []}
    keys = list(BASE_PILLAR) + list(BASE_TOP)
    have = min(((by.get(k) or {}).get("h60_n") or 0) for k in keys)
    base = {"base_pillar": BASE_PILLAR, "base_top": BASE_TOP, "have": have, "need": RW_MIN_N}
    if have < RW_MIN_N or any((by.get(k) or {}).get("h60") is None for k in keys):
        return {"status": "menunggu", "pillar": BASE_PILLAR, "top": BASE_TOP, **base}
    conf = min(1.0, have / 60)

    def tilt(bw):
        w = {k: bw[k] * (1 + 0.5 * conf * max(-1.0, min(1.0, by[k]["h60"] / RW_IC_FULL))) for k in bw}
        tgt = sum(bw.values())
        for _ in range(5):
            tot = sum(w.values())
            w = {k: min(bw[k] * 1.5, max(bw[k] * 0.5, v / tot * tgt)) for k, v in w.items()}
        tot = sum(w.values())
        return {k: round(v / tot * tgt, 3) for k, v in w.items()}

    return {"status": "aktif", "conf": round(conf, 2), "pillar": tilt(BASE_PILLAR), "top": tilt(BASE_TOP),
            "ic": {k: by[k]["h60"] for k in keys}, **base}


def load_reweight(path):
    """Bobot aktif dari quant.json sebelumnya (None = pakai bawaan). Matikan dengan env REWEIGHT=0."""
    if os.environ.get("REWEIGHT", "1") == "0":
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            rw = (json.load(fh).get("track") or {}).get("reweight")
    except Exception:  # noqa: BLE001
        return None
    return rw if rw and rw.get("status") == "aktif" else None


def world_snapshot():
    """Rezim Prakiraan Dunia hari ini — dicatat agar skor Waktu Masuk bisa diuji ke belakang nanti."""
    import requests
    for base in ("https://gabfx09.github.io/prakiraan-dunia/data/", "https://raw.githubusercontent.com/GabFx09/prakiraan-dunia/main/data/"):
        try:
            r = requests.get(base + "snapshot.json", timeout=20)
            r.raise_for_status()
            s = r.json()
            us = next((a for a in s.get("assets", []) if a.get("n", "").startswith("Saham AS")), None)
            return {"risk": s.get("risk"), "regime": s.get("regimeTitle"), "us": us.get("s") if us else None}
        except Exception:  # noqa: BLE001
            continue
    return None


def update_track(path, date, stocks, spy_price, prices, world=None, mk=None):
    """Tambahkan snapshot hari ini lalu hitung kinerja setiap kohort sampai harga terakhir."""
    try:
        with open(path, encoding="utf-8") as fh:
            track = json.load(fh)
    except Exception:
        track = {"snaps": []}
    FK = ["score", "fund", "value", "quality", "growth", "health", "tech", "upside", "rev", "mom"]
    fac = {}
    for s in stocks:
        p = s.get("pillars") or {}
        fac[s["sym"]] = [s.get("price"), s.get("score"), s.get("fund"), p.get("value"), p.get("quality"), p.get("growth"),
                         p.get("health"), s.get("tech"), (s.get("val") or {}).get("upside"), s.get("rev"),
                         (s.get("factors") or {}).get("momentum")]
    snap = {"d": date, "spy": _r(spy_price, 2), "fk": FK, "f": fac,
            "sb": {s["sym"]: s["price"] for s in stocks if s["rating"] == "STRONG BUY"},
            "b": {s["sym"]: s["price"] for s in stocks if s["rating"] == "BUY"},
            "h": {s["sym"]: s["price"] for s in stocks if s["rating"] == "HINDARI"}}
    if world:
        snap["w"] = world
    if mk:
        snap["m"] = mk
    track["snaps"] = [x for x in track["snaps"] if x["d"] != date] + [snap]
    track["snaps"].sort(key=lambda x: x["d"])
    track["snaps"] = track["snaps"][-400:]
    # snapshot lama: simpan faktor hanya 130 snapshot terakhir agar berkas tidak membengkak
    for sn in track["snaps"][:-130]:
        sn.pop("f", None)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(track, fh, separators=(",", ":"))

    last = {s["sym"]: s["price"] for s in stocks}

    def last_px(sym):
        if sym in last:
            return last[sym]
        df = prices.get(sym)
        return float(df["Close"].iloc[-1]) if df is not None and len(df) else None

    def basket(d):
        rets = []
        for sym, p0 in d.items():
            p1 = last_px(sym)
            if p0 and p1:
                rets.append(p1 / p0 - 1)
        return rets

    today = dt.date.fromisoformat(date)
    cohorts = []
    for sn in track["snaps"][:-1] if len(track["snaps"]) > 1 else []:
        d0 = dt.date.fromisoformat(sn["d"])
        spy_ret = spy_price / sn["spy"] - 1 if sn.get("spy") and spy_price else None
        row = {"d": sn["d"], "days": (today - d0).days, "spy": _r(spy_ret)}
        for k in ("sb", "b", "h"):
            rr = basket(sn.get(k, {}))
            row[k] = _r(float(np.mean(rr))) if rr else None
            row[k + "_n"] = len(rr)
            row[k + "_hit"] = _r(float(np.mean([x > (spy_ret or 0) for x in rr]))) if rr else None
        cohorts.append(row)
    # ringkasan: rata-rata alpha (vs SPY) semua kohort
    def avg_alpha(k):
        xs = [c[k] - c["spy"] for c in cohorts if c.get(k) is not None and c.get("spy") is not None]
        return _r(float(np.mean(xs))) if xs else None

    # kinerja terbaik/terburuk dari kohort tertua
    best = []
    if len(track["snaps"]) > 1:
        old = track["snaps"][0]
        for sym, p0 in {**old.get("sb", {}), **old.get("b", {})}.items():
            p1 = last_px(sym)
            if p0 and p1:
                best.append([sym, _r(p1 / p0 - 1)])
        best.sort(key=lambda x: -x[1])
    ic = signal_ic(track["snaps"], last)
    return {
        "ic": ic, "reweight": reweight(ic),
        "since": track["snaps"][0]["d"], "n_snaps": len(track["snaps"]),
        "cohorts": cohorts[::-1][:60],
        "alpha": {"sb": avg_alpha("sb"), "b": avg_alpha("b"), "h": avg_alpha("h")},
        "first_movers": {"best": best[:5], "worst": best[-5:][::-1]} if best else None,
    }


def signal_ic(snaps, last_px):
    """Information Coefficient: korelasi peringkat (Spearman) antara nilai faktor pada tanggal snapshot dan return
    sesudahnya. IC rata-rata > 0,05 yang konsisten = faktor punya daya prediksi."""
    names = {"score": "Skor gabungan", "fund": "Fundamental", "value": "Valuasi", "quality": "Kualitas", "growth": "Pertumbuhan",
             "health": "Kesehatan", "tech": "Teknikal", "upside": "Proyeksi naik", "rev": "Revisi estimasi", "mom": "Momentum"}
    today = dt.date.today()
    buckets = {"h5": (5, 19), "h20": (20, 59), "h60": (60, 10_000)}
    acc = {k: {b: [] for b in buckets} for k in names}
    for sn in snaps:
        if "f" not in sn:
            continue
        age = (today - dt.date.fromisoformat(sn["d"])).days
        b = next((k for k, (lo, hi) in buckets.items() if lo <= age <= hi), None)
        if not b:
            continue
        fk = sn["fk"]
        rows = []
        for sym, vals in sn["f"].items():
            p0, p1 = vals[0], last_px.get(sym)
            if p0 and p1:
                rows.append([p1 / p0 - 1] + vals[1:])
        if len(rows) < 50:
            continue
        df = pd.DataFrame(rows, columns=["ret"] + fk)
        for k in names:
            if k in df and df[k].notna().sum() > 40:
                ic = df["ret"].corr(df[k], method="spearman")
                if pd.notna(ic):
                    acc[k][b].append(float(ic))
    out = []
    for k, n in names.items():
        row = {"key": k, "name": n}
        for b in buckets:
            xs = acc[k][b]
            row[b] = _r(float(np.mean(xs)), 3) if xs else None
            row[b + "_n"] = len(xs)
        out.append(row)
    return out


def rating_changes(prev_path, stocks):
    """Bandingkan dengan data sebelumnya: upgrade/downgrade rekomendasi & lonjakan skor."""
    try:
        with open(prev_path, encoding="utf-8") as fh:
            prev = json.load(fh)
    except Exception:
        return None, {}
    order = {"HINDARI": 0, "HOLD": 1, "BUY": 2, "STRONG BUY": 3}
    pmap = {s["sym"]: s for s in prev.get("stocks", [])}
    pdate = prev.get("generated", "")[:10]
    ups, downs, movers, per = [], [], [], {}
    for s in stocks:
        p = pmap.get(s["sym"])
        if not p:
            continue
        per[s["sym"]] = {"rating": p["rating"], "score": p["score"], "d": pdate}
        d = order[s["rating"]] - order.get(p["rating"], 1)
        item = {"sym": s["sym"], "name": s["name"], "from": p["rating"], "to": s["rating"],
                "score": s["score"], "ds": _r(s["score"] - p["score"], 1)}
        if d > 0:
            ups.append(item)
        elif d < 0:
            downs.append(item)
        elif abs(s["score"] - p["score"]) >= 3:
            movers.append(item)
    ups.sort(key=lambda x: -x["score"])
    downs.sort(key=lambda x: x["score"])
    movers.sort(key=lambda x: -abs(x["ds"]))
    return {"since": pdate, "up": ups[:40], "down": downs[:40], "movers": movers[:20]}, per
