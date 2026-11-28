"""
Kalender ekonomi AS (sumber: faireconomy / ForexFactory, tanpa API key).

Hanya rilis USD berdampak Tinggi/Sedang (CPI, FOMC, NFP, PCE, GDP, ...). Dipakai:
- live.json  → kartu "Agenda ekonomi" di aplikasi (diperbarui ± tiap 3 jam),
- notify.py  → baris agenda di ringkasan pagi + peringatan di sinyal BUY bila ada rilis besar ≤ 24 jam.
"""
import datetime as dt

import requests

URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
UA = {"User-Agent": "Mozilla/5.0 (radar-saham)"}
WIB = dt.timezone(dt.timedelta(hours=7))
# nama Indonesia singkat untuk rilis yang paling menggerakkan pasar saham
KAMUS = [
    ("FOMC", "Keputusan suku bunga The Fed"), ("Federal Funds Rate", "Suku bunga The Fed"),
    ("Fed Chair", "Pidato Ketua The Fed"), ("Core CPI", "Inflasi inti (CPI)"), ("CPI", "Inflasi (CPI)"),
    ("Core PCE", "Inflasi PCE inti"), ("PCE", "Inflasi PCE"), ("Non-Farm", "Data tenaga kerja (NFP)"),
    ("Unemployment Rate", "Tingkat pengangguran"), ("Unemployment Claims", "Klaim pengangguran"),
    ("Advance GDP", "PDB awal"), ("GDP", "PDB"), ("Core PPI", "Inflasi produsen inti"), ("PPI", "Inflasi produsen"),
    ("Retail Sales", "Penjualan ritel"), ("ISM Manufacturing PMI", "PMI manufaktur ISM"),
    ("ISM Services PMI", "PMI jasa ISM"), ("JOLTS", "Lowongan kerja JOLTS"), ("Consumer Sentiment", "Sentimen konsumen"),
    ("Consumer Confidence", "Keyakinan konsumen"), ("ADP", "Tenaga kerja ADP"), ("Average Hourly Earnings", "Upah per jam"),
]
# rilis yang biasanya membuat pasar saham bergejolak (dampak "Tinggi" plus kata kunci ini = "besar")
BESAR = ("FOMC", "Federal Funds", "CPI", "Non-Farm", "PCE", "Fed Chair", "GDP")


def nama_id(title):
    for k, v in KAMUS:
        if k.lower() in title.lower():
            return v
    return ""


def fetch(log=print):
    try:
        js = requests.get(URL, headers=UA, timeout=20).json()
    except Exception as e:  # noqa: BLE001
        log(f"  kalender: gagal ({e})")
        return None
    out = []
    for e in js if isinstance(js, list) else []:
        if str(e.get("country")) != "USD" or e.get("impact") not in ("High", "Medium"):
            continue
        try:
            t = dt.datetime.fromisoformat(str(e.get("date"))).astimezone(dt.timezone.utc)
        except ValueError:
            continue
        title = str(e.get("title", ""))[:90]
        out.append({
            "t": t.strftime("%Y-%m-%dT%H:%MZ"), "title": title, "id": nama_id(title),
            "imp": "tinggi" if e["impact"] == "High" else "sedang",
            "big": e["impact"] == "High" and any(k.lower() in title.lower() for k in BESAR),
            "fc": str(e.get("forecast") or "")[:16], "prev": str(e.get("previous") or "")[:16],
            "act": str(e.get("actual") or "")[:16],
        })
    out.sort(key=lambda x: x["t"])
    log(f"  kalender: {len(out)} rilis USD (tinggi/sedang)")
    return out


def upcoming(events, hours=24, now=None, big_only=True):
    """Rilis dalam `hours` jam ke depan (default: yang besar saja)."""
    now = now or dt.datetime.now(dt.timezone.utc)
    res = []
    for e in events or []:
        t = dt.datetime.strptime(e["t"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc)
        if now - dt.timedelta(minutes=30) <= t <= now + dt.timedelta(hours=hours) and (e.get("big") or not big_only):
            res.append(e)
    return res


def wib(e):
    t = dt.datetime.strptime(e["t"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=dt.timezone.utc).astimezone(WIB)
    hari = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"][t.weekday()]
    return f"{hari} {t.strftime('%H:%M')} WIB"


def label(e):
    return e.get("id") or e.get("title")
