#!/usr/bin/env python3
"""
Analisis portofolio pribadi dari terminal (dipakai juga oleh Claude untuk menganalisis posisi Anda).

    python scripts/analisis_porto.py            # baca portofolio dari gist sinkronisasi Radar Saham
    python scripts/analisis_porto.py --json     # keluaran JSON

Token: GIST_TOKEN, atau otomatis dari `gh auth token` (GitHub CLI). Data saham dari docs/data (jalankan `git pull` dulu).
"""
import argparse
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import penasihat  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "docs", "data")


def token():
    t = os.getenv("GIST_TOKEN", "").strip()
    if t:
        return t
    try:
        return subprocess.check_output(["gh", "auth", "token"], text=True).strip()
    except Exception:  # noqa: BLE001
        return ""


def load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as fh:
        return json.load(fh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    os.environ["GIST_TOKEN"] = token()
    import notify  # noqa: E402  (memakai pencari gist yang sama)
    notify.GTOKEN = os.environ["GIST_TOKEN"]
    gid, cfg, _ = notify.user_config()
    hs = [h for h in cfg.get("holdings") or [] if h.get("sym")]
    if not hs:
        print("Portofolio kosong atau sinkronisasi cloud belum aktif (Radar Saham → Pengaturan → Sinkronisasi Cloud).")
        return
    d = load("stocks.json")
    by = {s["sym"]: s for s in d["stocks"]}
    rows = []
    tot = sum(float(h.get("qty") or 0) * by[h["sym"]]["price"] for h in hs if h["sym"] in by)
    for h in hs:
        s = by.get(h["sym"])
        if not s:
            rows.append({"sym": h["sym"], "err": "tidak ada di universe"})
            continue
        try:
            hist = load(os.path.join("history", f"{h['sym']}.json"))
        except Exception:  # noqa: BLE001
            hist = None
        det = {}
        try:
            det = load(os.path.join("detail", f"{h['sym']}.json"))
        except Exception:  # noqa: BLE001
            pass
        v = float(h.get("qty") or 0) * s["price"]
        adv = penasihat.advise(h, s, penasihat.closes_since(hist, h.get("date")), v / tot if tot else 0,
                               profile=(cfg.get("settings") or {}).get("profile"))
        rows.append({"sym": h["sym"], "name": s["name"], "qty": h.get("qty"), "cost": h.get("cost"), "date": h.get("date"),
                     "price": s["price"], "value": round(v, 2), "weight": round(v / tot, 4) if tot else None,
                     "rating": s["rating"], "score": s["score"], "fund": s["fund"], "tech": s["tech"],
                     "fair": (s.get("val") or {}).get("fair"), "upside": (s.get("val") or {}).get("upside"),
                     "plan": det.get("plan"), "pros": [p["text"] for p in (det.get("pros") or [])[:3]],
                     "cons": [c["text"] for c in (det.get("cons") or [])[:3]], **adv})
    if a.json:
        print(json.dumps({"data_per": d["generated"], "holdings": rows}, ensure_ascii=False, indent=1))
        return
    print(f"Data per {d['generated']} · {len(rows)} saham · nilai ${tot:,.0f}\n")
    for r in rows:
        if r.get("err"):
            print(f"{r['sym']}: {r['err']}\n")
            continue
        print(f"[{r['act']}] {r['sym']} — {r['name']}")
        print(f"  {r['qty']} lbr @ ${r['cost'] or 0:,.2f} → ${r['price']:,.2f} ({(r['pl'] or 0) * 100:+.1f}%) · bobot {(r['weight'] or 0) * 100:.0f}%"
              f" · {r['rating']} skor {r['score']:.0f} · nilai wajar ${r['fair'] or 0:,.2f} ({(r['upside'] or 0) * 100:+.0f}%)")
        for x in r["reasons"]:
            print(f"   {'+' if x['s'] > 0 else '-' if x['s'] < 0 else '·'} {x['t']}")
        print()


if __name__ == "__main__":
    main()
