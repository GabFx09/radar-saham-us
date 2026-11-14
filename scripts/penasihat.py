"""
Penasihat portofolio: saran TAMBAH / TAHAN / KURANGI / JUAL untuk tiap saham yang dimiliki.

Aturan yang sama dipakai di aplikasi (docs/porto.js, fungsi advise) — ubah keduanya bersamaan.

Masukan per saham:
  h  : {"sym", "qty", "cost", "date", "buy": {"rating", "score", "fund", "fair"}}   (buy = snapshot saat dibeli)
  s  : data ringkas saham dari stocks.json
  closes : harga penutupan harian (list) sejak tanggal beli (atau 1 tahun terakhir bila tanggal tidak diketahui)
  weight : bobot saham di portofolio (0-1)
"""
import time

RANK = {"HINDARI": 0, "HOLD": 1, "BUY": 2, "STRONG BUY": 3}


def _pct(x, d=0):
    return "–" if x is None else f"{x * 100:+.{d}f}%"


def _abs(x, d=0):
    return "–" if x is None else f"{abs(x) * 100:.{d}f}%"


def advise(h, s, closes=None, weight=0.0, now=None):
    now = now or time.time()
    price = s.get("price") or 0
    val = s.get("val") or {}
    up = val.get("upside")
    q = s.get("q") or {}
    vol = q.get("vol") or 0.35
    cost = float(h.get("cost") or 0)
    buy = h.get("buy") or {}
    pts, R, hard, soft = 0.0, [], None, None

    def add(p, sign, text):
        nonlocal pts
        pts += p
        R.append({"s": sign, "t": text})

    # 1. rekomendasi model saat ini
    rt = s.get("rating")
    add({"STRONG BUY": 2, "BUY": 1, "HOLD": 0, "HINDARI": -2}.get(rt, 0), 1 if rt in ("STRONG BUY", "BUY") else -1 if rt == "HINDARI" else 0,
        f"Rekomendasi model sekarang {rt} (skor {s.get('score', 0):.0f})")
    # 2. jarak ke nilai wajar
    if up is not None:
        if up >= 0.25:
            add(2, 1, f"Nilai wajar ${val.get('fair', 0):.2f} — potensi naik {_abs(up)}")
        elif up >= 0.10:
            add(1, 1, f"Nilai wajar ${val.get('fair', 0):.2f} — potensi naik {_abs(up)}")
        elif up > -0.10:
            add(0, 0, f"Harga sudah dekat nilai wajar ${val.get('fair', 0):.2f} ({_pct(up)})")
        elif up > -0.25:
            add(-1, -1, f"Harga di atas nilai wajar ${val.get('fair', 0):.2f} — potensi {_pct(up)}, mulai mahal")
        else:
            add(-2, -1, f"Harga jauh di atas nilai wajar ${val.get('fair', 0):.2f} — potensi {_pct(up)}, mahal")
    # 3. tesis sejak beli
    if buy.get("fund") is not None and s.get("fund") is not None:
        dfund = s["fund"] - buy["fund"]
        if dfund <= -10:
            add(-2, -1, f"Fundamental melemah sejak dibeli (skor {buy['fund']:.0f} → {s['fund']:.0f})")
        elif dfund >= 5:
            add(1, 1, f"Fundamental membaik sejak dibeli ({buy['fund']:.0f} → {s['fund']:.0f})")
    if buy.get("rating") and rt and RANK.get(rt, 1) < RANK.get(buy["rating"], 1):
        add(-1, -1, f"Rekomendasi turun sejak dibeli ({buy['rating']} → {rt})")
    # 4. untung/rugi & trailing stop
    pl = price / cost - 1 if cost else None
    trail = max(0.10, min(0.30, vol * 0.45))
    if closes:
        peak = max(closes + [price])
        dd = price / peak - 1 if peak else 0
        if dd <= -trail:
            msg = f"Turun {_abs(dd)} dari puncak sejak dibeli — melewati batas trailing stop {trail * 100:.0f}% (volatilitas {vol * 100:.0f}%/thn)"
            if rt in ("STRONG BUY", "BUY") and (up or 0) >= 0.20:
                soft = msg + "; tapi fundamental & valuasi masih kuat — kurangi sebagian atau pasang stop ketat, bukan jual semua"
            else:
                hard = msg
    else:
        dd = None
    if pl is not None:
        if pl <= -trail * 1.2 and rt not in ("STRONG BUY", "BUY"):
            hard = hard or f"Rugi {_abs(pl)} dari harga beli dan model tidak lagi merekomendasikan beli — batasi kerugian"
        if pl >= 0.5 and (up is None or up < 0.05):
            add(-1, -1, f"Sudah untung {_abs(pl)} dan dekat/di atas nilai wajar — pertimbangkan ambil sebagian untung")
    # 5. teknikal & risiko
    tech = s.get("tech")
    if tech is not None and tech < 30:
        add(-1, -1, f"Tren teknikal lemah (skor teknikal {tech:.0f})")
    elif tech is not None and tech >= 70:
        add(0.5, 1, f"Tren teknikal kuat ({tech:.0f})")
    fl = s.get("flow")
    if fl is not None and fl <= 30:
        add(-1, -1, f"Uang keluar: aliran dana {fl:.0f}/100 — tekanan jual dominan")
    elif fl is not None and fl >= 70:
        add(0.5, 1, f"Uang masuk: aliran dana {fl:.0f}/100 — akumulasi")
    mc = q.get("mc") or {}
    if (mc.get("p_loss20") or 0) >= 0.35:
        add(-1, -1, f"Simulasi: peluang turun >20% dalam 12 bln {mc['p_loss20'] * 100:.0f}%")
    # 6. aksi
    if hard:
        act = "JUAL"
        R.insert(0, {"s": -1, "t": hard})
    elif soft:
        act = "KURANGI"
        R.insert(0, {"s": -1, "t": soft})
    elif rt == "HINDARI" and (up is None or up < 0):
        act = "JUAL"
    elif pts >= 3:
        act = "TAMBAH"
    elif pts >= 0:
        act = "TAHAN"
    elif pts >= -2:
        act = "KURANGI"
    else:
        act = "JUAL"
    if weight > 0.25 and act in ("TAMBAH", "TAHAN"):
        act = "KURANGI"
        R.append({"s": -1, "t": f"Bobot {weight * 100:.0f}% dari portofolio — kurangi sebagian untuk diversifikasi (saran ≤ 20–25%)"})
    elif weight > 0.20 and act == "TAMBAH":
        act = "TAHAN"
        R.append({"s": 0, "t": f"Bobot sudah {weight * 100:.0f}% — jangan ditambah lagi"})
    e = s.get("earnings_ts")
    if e and now - 86400 < e < now + 3 * 86400:
        R.append({"s": 0, "t": "Laporan keuangan dalam 3 hari — harga bisa bergerak tajam"})
    return {"act": act, "pts": round(pts, 1), "reasons": R, "trail": round(trail, 3), "dd": None if dd is None else round(dd, 4),
            "pl": None if pl is None else round(pl, 4)}


def closes_since(hist, date_iso=None):
    """Harga penutupan dari berkas history ({"d": [...], "c": [...]}) sejak tanggal beli (default 1 tahun)."""
    if not hist or not hist.get("c"):
        return None
    d, c = hist["d"], hist["c"]
    if date_iso:
        return [v for dd, v in zip(d, c) if dd >= date_iso] or None
    return c[-252:]
