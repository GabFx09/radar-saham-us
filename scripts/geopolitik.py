"""
Analisis geopolitik untuk Radar Saham US.

Tiga lapis:
  1. Indeks Stres Geopolitik  — dari pasar: emas, minyak, VIX, dolar, ETF pertahanan/Tiongkok/Taiwan/semikonduktor.
  2. Intensitas 10 tema      — gabungan indikator pasar + frekuensi berita terkini (Yahoo Finance).
  3. Eksposur per saham       — industri, isi profil bisnis, negara domisili, dan berita perusahaan.

Eksposur bernilai -1 (sangat dirugikan) s.d. +1 (sangat diuntungkan). Dampak = eksposur × intensitas tema.
"""
import datetime as dt
import math
import re
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import yfinance as yf

MACRO = {
    "gold": "GC=F", "oil": "CL=F", "vix": "^VIX", "dxy": "DX-Y.NYB",
    "defense": "ITA", "china": "FXI", "taiwan": "EWT", "semis": "SOXX",
}
NEWS_PROXIES = ["SPY", "QQQ", "GLD", "USO", "ITA", "FXI", "EWT", "SOXX", "XLE", "UUP", "KWEB", "EWG"]

# ----------------------------------------------------------------------------- tema
THEMES = {
    "trade": {
        "name": "Perang Dagang & Tarif",
        "icon": "⚖️",
        "desc": "Tarif impor AS dan balasan mitra dagang (terutama Tiongkok) menaikkan biaya perusahaan yang "
                "bergantung pada impor atau penjualan ke luar negeri, sekaligus melindungi produsen domestik.",
        "kw": r"tariff|trade war|trade deal|trade talks|trade truce|import dut|retaliat|section 301|section 232|"
              r"de minimis|customs dut|trade tension|trade deficit",
        "base": 45,
    },
    "tech": {
        "name": "Kontrol Ekspor Chip & Selat Taiwan",
        "icon": "🔌",
        "desc": "Pembatasan ekspor teknologi canggih ke Tiongkok dan risiko ketegangan di Selat Taiwan — pusat "
                "produksi chip dunia — mengancam pendapatan & pasokan industri semikonduktor dan hardware.",
        "kw": r"export control|chip ban|entity list|\btaiwan\b|\btsmc\b|chip export|chip curb|huawei|"
              r"semiconductor (?:curb|restriction|ban)|ai chip|beijing.*chip|chip.*beijing",
        "base": 45,
    },
    "mideast": {
        "name": "Timur Tengah & Harga Minyak",
        "icon": "🛢️",
        "desc": "Konflik di Timur Tengah dan keputusan OPEC+ menggerakkan harga minyak: menguntungkan produsen "
                "energi & pertahanan, membebani maskapai, logistik, dan konsumen.",
        "kw": r"\biran\b|israel|gaza|hezbollah|houthi|middle east|\bopec|strait of hormuz|red sea|saudi|"
              r"crude (?:jump|surge|spike|soar)|oil (?:jump|surge|spike|soar)",
        "base": 40,
    },
    "europe": {
        "name": "Rusia–Ukraina & Belanja Pertahanan",
        "icon": "🛡️",
        "desc": "Perang di Eropa Timur mendorong anggaran pertahanan NATO, keamanan energi, dan harga komoditas "
                "(gas, pupuk, gandum) — positif bagi kontraktor pertahanan, negatif bagi bisnis yang terpapar Eropa.",
        "kw": r"russia|ukrain|\bnato\b|kremlin|putin|zelensk|defen[cs]e spending|defen[cs]e budget|"
              r"military aid|pentagon|missile|drone strike",
        "base": 40,
    },
    "reshoring": {
        "name": "Reshoring & Kebijakan Industri AS",
        "icon": "🏭",
        "desc": "Insentif membangun pabrik di AS (chip, energi, infrastruktur, data center) menguntungkan "
                "industri peralatan listrik, konstruksi, dan bahan bangunan.",
        "kw": r"chips act|reshor|onshor|nearshor|made in america|industrial policy|inflation reduction act|"
              r"manufacturing investment|new (?:plant|factory)|domestic manufacturing|build.*factor(?:y|ies) in",
        "base": 50,
    },
    "cyber": {
        "name": "Perang Siber",
        "icon": "🛰️",
        "desc": "Serangan siber yang didukung negara meningkatkan permintaan keamanan siber dan memberi risiko "
                "operasional bagi utilitas, bank, dan infrastruktur kritis.",
        "kw": r"cyberattack|cyber attack|cyber-attack|ransomware|\bhack(?:ed|ers|ing)?\b|data breach|"
              r"cybersecurity|state-sponsored|espionage",
        "base": 45,
    },
    "supply": {
        "name": "Rantai Pasok & Jalur Pelayaran",
        "icon": "🚢",
        "desc": "Gangguan jalur pelayaran (Laut Merah, Terusan Suez/Panama), pemogokan pelabuhan, dan kelangkaan "
                "komponen menaikkan biaya pengiriman dan stok bagi peritel & manufaktur.",
        "kw": r"supply chain|shipping (?:rate|cost|disrupt)|freight rate|port strike|\bsuez\b|panama canal|"
              r"shortage|logistics disrupt|container rate",
        "base": 35,
    },
    "dollar": {
        "name": "Dolar Kuat, Sanksi & Pasar Berkembang",
        "icon": "💵",
        "desc": "Dolar yang menguat dan sanksi keuangan menggerus pendapatan luar negeri perusahaan multinasional "
                "saat dikonversi ke USD.",
        "kw": r"sanction|strong dollar|dollar (?:index|rall|surge|strength)|\byuan\b|emerging market|"
              r"capital control|\bbrics\b|currency (?:war|crisis)|de-dollar",
        "base": 35,
    },
    "minerals": {
        "name": "Mineral Kritis & Tanah Jarang",
        "icon": "⛏️",
        "desc": "Dominasi Tiongkok atas tanah jarang, galium, germanium, grafit, dan pemrosesan lithium membuat "
                "pembatasan ekspor dapat mengganggu produsen EV, chip, dan pertahanan — dan menguntungkan penambang non-Tiongkok.",
        "kw": r"rare earth|lithium|cobalt|critical mineral|gallium|germanium|graphite|antimony|"
              r"copper (?:supply|shortage)|mineral export",
        "base": 40,
    },
    "regulation": {
        "name": "Regulasi & Antitrust Global",
        "icon": "🏛️",
        "desc": "Penegakan antitrust AS/Uni Eropa, pajak digital, dan aturan kedaulatan data menekan raksasa "
                "teknologi dan platform internet.",
        "kw": r"antitrust|digital markets act|\bdma\b|european commission|\beu (?:fine|probe|regulator)|"
              r"\bfined\b|doj (?:lawsuit|sues)|\bftc\b|digital (?:services )?tax|monopoly",
        "base": 40,
    },
}
THEME_KEYS = list(THEMES)

# ----------------------------------------------------------------------------- eksposur industri
# (regex industri Yahoo, {tema: eksposur}) — aturan pertama yang cocok dipakai, lalu digabung dengan aturan sektor
INDUSTRY_RULES = [
    (r"semiconductor equipment", {"trade": -.5, "tech": -.8, "reshoring": .5, "minerals": -.3}),
    (r"semiconductor", {"trade": -.5, "tech": -.8, "reshoring": .4, "minerals": -.3, "supply": -.2}),
    (r"aerospace & defense", {"europe": .8, "mideast": .5, "cyber": .2, "reshoring": .3, "supply": -.2, "minerals": -.2}),
    (r"oil & gas (?:e&p|integrated|drilling)", {"mideast": .7, "europe": .4, "dollar": -.1}),
    (r"oil & gas equipment", {"mideast": .5, "europe": .3}),
    (r"oil & gas refining", {"mideast": .2, "europe": .2}),
    (r"oil & gas midstream", {"mideast": .2, "europe": .3, "reshoring": .2}),
    (r"uranium|thermal coal", {"europe": .5, "reshoring": .3, "mideast": .2}),
    (r"airlines", {"mideast": -.8, "europe": -.3, "supply": -.2}),
    (r"travel services|lodging|resorts & casinos|gambling", {"mideast": -.3, "trade": -.3, "dollar": -.2, "europe": -.1}),
    (r"consumer electronics", {"trade": -.7, "tech": -.6, "supply": -.5, "regulation": -.2, "dollar": -.2}),
    (r"computer hardware|communication equipment|electronic components|electronics & computer distribution",
     {"trade": -.5, "tech": -.5, "supply": -.4, "reshoring": .1}),
    (r"scientific & technical instruments", {"trade": -.4, "tech": -.3, "supply": -.3}),
    (r"software", {"regulation": -.2, "dollar": -.2, "cyber": .1}),
    (r"information technology services", {"dollar": -.2, "cyber": .1}),
    (r"internet content|internet retail", {"regulation": -.6, "trade": -.2, "dollar": -.2}),
    (r"auto manufacturers", {"trade": -.6, "supply": -.6, "minerals": -.5, "mideast": -.2}),
    (r"auto parts|recreational vehicles", {"trade": -.6, "supply": -.5, "minerals": -.3}),
    (r"apparel|footwear|luxury goods|leisure|furnishings|home improvement retail|specialty retail|"
     r"department stores|toys", {"trade": -.5, "supply": -.6, "dollar": -.1}),
    (r"discount stores|grocery", {"trade": -.3, "supply": -.3}),
    (r"gold|silver|precious metals", {"mideast": .6, "europe": .5, "trade": .3, "dollar": -.2}),
    (r"copper|industrial metals|aluminum", {"minerals": .6, "reshoring": .5, "trade": -.2}),
    (r"steel", {"trade": .4, "reshoring": .5, "minerals": .1}),
    (r"agricultural inputs", {"europe": .5, "trade": -.3, "mideast": .2}),
    (r"farm products", {"trade": -.5, "europe": .3}),
    (r"farm & heavy construction", {"trade": -.4, "reshoring": .4, "europe": .1, "supply": -.2}),
    (r"electrical equipment", {"reshoring": .8, "trade": -.2, "supply": -.2, "minerals": -.2}),
    (r"specialty industrial machinery|engineering & construction|building products|infrastructure operations|"
     r"building materials", {"reshoring": .7, "trade": -.1, "supply": -.2}),
    (r"solar", {"trade": .4, "reshoring": .6, "minerals": -.3, "regulation": -.3}),
    (r"utilities.*renewable", {"reshoring": .3, "trade": -.3, "cyber": -.2, "regulation": -.2}),
    (r"utilities", {"reshoring": .3, "cyber": -.3, "mideast": -.1}),
    (r"marine shipping", {"mideast": .3, "supply": .3, "trade": -.3}),
    (r"railroads|trucking|integrated freight", {"trade": -.3, "supply": -.3, "mideast": -.3, "reshoring": .2}),
    (r"drug manufacturers|biotechnology", {"trade": -.3, "supply": -.3, "regulation": -.3, "dollar": -.2}),
    (r"medical devices|medical instruments|diagnostics|medical distribution", {"trade": -.4, "supply": -.3, "dollar": -.2}),
    (r"healthcare plans|medical care facilities", {"regulation": -.1}),
    (r"packaged foods|beverages|household & personal|tobacco|confectioners", {"dollar": -.3, "supply": -.2, "mideast": -.1}),
    (r"restaurants", {"mideast": -.1, "trade": -.1, "dollar": -.1}),
    (r"chemicals", {"trade": -.4, "mideast": -.3, "europe": -.1, "supply": -.2}),
    (r"credit services", {"europe": -.2, "dollar": -.3, "regulation": -.2, "cyber": -.1}),
    (r"banks", {"dollar": -.1, "cyber": -.2, "europe": -.1}),
    (r"capital markets|asset management|financial data", {"dollar": -.1, "cyber": -.1, "trade": -.1}),
    (r"insurance", {"cyber": -.2, "mideast": -.1}),
    (r"telecom", {"cyber": -.2, "regulation": -.1}),
    (r"entertainment|electronic gaming|advertising", {"trade": -.2, "regulation": -.2, "dollar": -.2}),
    (r"reit.*industrial", {"supply": -.1, "trade": -.2, "reshoring": .2}),
    (r"reit", {"cyber": -.05}),
    (r"waste management|security & protection", {"cyber": .1}),
    (r"aerospace", {"europe": .4}),
]

SUMMARY_RULES = [
    (r"\bchina\b|chinese|greater china|mainland", {"trade": -.25}, "Profil bisnis menyebut operasi/penjualan di Tiongkok"),
    (r"\btaiwan\b", {"tech": -.25}, "Profil bisnis menyebut Taiwan"),
    (r"cybersecurity|cyber security|security platform|threat (?:detection|intelligence)|zero trust|"
     r"endpoint security|identity security", {"cyber": .8, "europe": .2}, "Penyedia keamanan siber"),
    (r"department of defense|\bmilitary\b|national security|defense (?:and|&) (?:government|intelligence)|"
     r"missile|munitions", {"europe": .35, "mideast": .25}, "Pemasok sektor pertahanan/pemerintah"),
    (r"\buranium\b|nuclear (?:power|reactor|fuel|energy)", {"europe": .3, "reshoring": .3}, "Terkait energi nuklir"),
    (r"data center", {"reshoring": .2}, "Terkait pembangunan data center"),
    (r"rare earth|lithium|graphite|cobalt", {"minerals": .3}, "Terkait mineral kritis"),
    (r"\beurope\b|european|\bemea\b", {"europe": -.1, "regulation": -.05}, None),
    (r"\bmexico\b", {"trade": -.1}, None),
    (r"\bindia\b|southeast asia|vietnam", {"trade": -.05}, None),
    (r"\brussia\b", {"europe": -.3}, "Profil bisnis menyebut Rusia"),
    (r"\bisrael\b", {"mideast": -.2}, "Memiliki operasi di Israel"),
    (r"approximately \d+ countries|over \d+ countries|more than \d+ countries|worldwide|internationally|globally",
     {"dollar": -.15}, "Pendapatan tersebar global (sensitif terhadap dolar)"),
    (r"oil and natural gas|crude oil|hydrocarbon", {"mideast": .2}, None),
    (r"jet fuel|fuel costs", {"mideast": -.2}, None),
    (r"\bimport", {"trade": -.1, "supply": -.1}, None),
]

SECTOR_DEFAULT = {
    "Technology": {"trade": -.2, "tech": -.2, "dollar": -.2},
    "Energy": {"mideast": .5, "europe": .3},
    "Basic Materials": {"trade": -.2, "minerals": .2},
    "Industrials": {"reshoring": .3, "supply": -.2},
    "Consumer Cyclical": {"trade": -.3, "supply": -.3},
    "Consumer Defensive": {"dollar": -.15},
    "Healthcare": {"trade": -.1, "regulation": -.1},
    "Financial Services": {"dollar": -.1},
    "Communication Services": {"regulation": -.3},
    "Utilities": {"reshoring": .2, "cyber": -.2},
    "Real Estate": {},
}


def sf(x):
    try:
        x = float(x)
        return x if math.isfinite(x) else None
    except Exception:
        return None


def lin(x, bad, good):
    if x is None:
        return None
    t = (x - bad) / (good - bad)
    return 100.0 * max(0.0, min(1.0, t))


# ----------------------------------------------------------------------------- berita
def _parse_news(items):
    out = []
    for it in items or []:
        c = it.get("content", it) if isinstance(it, dict) else {}
        title = c.get("title")
        if not title:
            continue
        url = ((c.get("canonicalUrl") or {}).get("url") or (c.get("clickThroughUrl") or {}).get("url")
               or c.get("previewUrl") or c.get("link") or "")
        pub = c.get("pubDate") or c.get("displayTime")
        if not pub and c.get("providerPublishTime"):
            pub = dt.datetime.fromtimestamp(c["providerPublishTime"], dt.timezone.utc).isoformat()
        out.append({
            "title": title.strip(),
            "summary": (c.get("summary") or "")[:280],
            "url": url,
            "source": (c.get("provider") or {}).get("displayName") or c.get("publisher") or "",
            "date": pub,
        })
    return out


def fetch_news(sym):
    for attempt in range(2):
        try:
            return sym, _parse_news(yf.Ticker(sym).news)
        except Exception:
            time.sleep(1.5)
    return sym, []


def tag_themes(text):
    text = text.lower()
    return [k for k, t in THEMES.items() if re.search(t["kw"], text)]


def _age_days(iso):
    try:
        d = dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return (dt.datetime.now(dt.timezone.utc) - d).total_seconds() / 86400
    except Exception:
        return 99


# ----------------------------------------------------------------------------- indikator pasar
def _series(prices, key):
    df = prices.get(MACRO[key])
    if df is None:
        return None
    c = df["Close"].dropna().astype(float)
    return c if len(c) > 70 else None


def _ret(c, k):
    if c is None or len(c) <= k:
        return None
    return float(c.iloc[-1] / c.iloc[-1 - k] - 1)


def market_indicators(prices, spy_close):
    gold, oil, vix, dxy = (_series(prices, k) for k in ("gold", "oil", "vix", "dxy"))
    dfn, chn, twn, smi = (_series(prices, k) for k in ("defense", "china", "taiwan", "semis"))
    spy3 = _ret(spy_close, 63) if spy_close is not None else None
    spy1 = _ret(spy_close, 21) if spy_close is not None else None

    def rel(c, k, base):
        r_ = _ret(c, k)
        return None if r_ is None or base is None else r_ - base

    oil_vol = None
    if oil is not None and len(oil) > 22:
        oil_vol = float(np.log(oil).diff().iloc[-21:].std() * math.sqrt(252))

    ind = []

    def add(key, name, value, fmt, score, note):
        ind.append({"key": key, "name": name, "value": value, "fmt": fmt,
                    "score": None if score is None else round(score, 1), "note": note})

    v = sf(vix.iloc[-1]) if vix is not None else None
    add("vix", "Indeks ketakutan (VIX)", v, "num", lin(v, 13, 35), "Volatilitas yang diharapkan pasar 30 hari ke depan")
    g3 = _ret(gold, 63)
    add("gold", "Emas 3 bulan", g3, "pct", lin(g3, -0.03, 0.18), "Emas naik tajam = investor mencari aset aman")
    o1 = _ret(oil, 21)
    s_oil = None
    if o1 is not None:
        s_oil = 0.6 * lin(o1, -0.05, 0.20) + 0.4 * (lin(oil_vol, 0.22, 0.60) if oil_vol is not None else 50)
    add("oil", "Minyak WTI 1 bulan", o1, "pct", s_oil, "Lonjakan & volatilitas minyak = risiko pasokan")
    d3 = _ret(dxy, 63)
    add("dxy", "Indeks dolar 3 bulan", d3, "pct", lin(d3, -0.03, 0.06), "Dolar menguat = arus dana ke aset aman AS")
    r_def = rel(dfn, 63, spy3)
    add("defense", "Saham pertahanan vs S&P 500", r_def, "pct", lin(r_def, -0.06, 0.12),
        "Pertahanan unggul = pasar memperhitungkan konflik")
    r_chn = rel(chn, 63, spy3)
    add("china", "Saham Tiongkok vs S&P 500", r_chn, "pct", lin(r_chn, 0.08, -0.15),
        "Tiongkok tertinggal = ketegangan dagang/politik")
    r_twn = rel(twn, 21, spy1)
    add("taiwan", "Saham Taiwan vs S&P 500 (1 bln)", r_twn, "pct", lin(r_twn, 0.04, -0.08),
        "Taiwan tertekan = risiko Selat Taiwan/chip")
    r_smi = rel(smi, 21, spy1)
    add("semis", "Semikonduktor vs S&P 500 (1 bln)", r_smi, "pct", lin(r_smi, 0.05, -0.10),
        "Chip tertinggal = kekhawatiran kontrol ekspor")

    valid = [i["score"] for i in ind if i["score"] is not None]
    weights = {"vix": 1.3, "gold": 1.2, "oil": 1.0, "dxy": 0.6, "defense": 1.0, "china": 0.8, "taiwan": 0.8, "semis": 0.5}
    tot = sum(i["score"] * weights[i["key"]] for i in ind if i["score"] is not None)
    wsum = sum(weights[i["key"]] for i in ind if i["score"] is not None)
    gsi = tot / wsum if wsum else 50.0

    # riwayat indeks 6 bulan (mingguan) untuk grafik tren — versi sederhana dari komponen harga
    hist = []
    try:
        if vix is not None and gold is not None and spy_close is not None:
            idx = vix.index[-130:]
            for d in idx[::5]:
                vv = sf(vix.loc[:d].iloc[-1])
                gg = gold.loc[:d]
                g3h = float(gg.iloc[-1] / gg.iloc[-64] - 1) if len(gg) > 64 else None
                oo = oil.loc[:d] if oil is not None else None
                o1h = float(oo.iloc[-1] / oo.iloc[-22] - 1) if oo is not None and len(oo) > 22 else None
                parts = [(lin(vv, 13, 35), 1.3), (lin(g3h, -0.03, 0.18), 1.2), (lin(o1h, -0.05, 0.20), 1.0)]
                if dfn is not None:
                    dd, ss = dfn.loc[:d], spy_close.loc[:d]
                    if len(dd) > 64 and len(ss) > 64:
                        parts.append((lin(float(dd.iloc[-1] / dd.iloc[-64] - 1) - float(ss.iloc[-1] / ss.iloc[-64] - 1),
                                          -0.06, 0.12), 1.0))
                parts = [(a, w) for a, w in parts if a is not None]
                if parts:
                    hist.append([d.strftime("%Y-%m-%d"), round(sum(a * w for a, w in parts) / sum(w for _, w in parts), 1)])
    except Exception:
        hist = []
    return ind, round(gsi, 1), hist, {k: i["score"] for k, i in ((x["key"], x) for x in ind)}


def stress_label(x):
    if x >= 70:
        return "Sangat Tinggi"
    if x >= 55:
        return "Tinggi"
    if x >= 40:
        return "Sedang"
    return "Rendah"


# ----------------------------------------------------------------------------- eksposur saham
def stock_exposure(industry, sector, summary, country):
    exp = {k: 0.0 for k in THEME_KEYS}
    evidence = []
    ind = (industry or "").lower()
    matched = False
    for pat, m in INDUSTRY_RULES:
        if re.search(pat, ind):
            for k, v in m.items():
                exp[k] += v
            matched = True
            break
    if not matched:
        for k, v in SECTOR_DEFAULT.get(sector, {}).items():
            exp[k] += v
    s = (summary or "").lower()
    for pat, m, why in SUMMARY_RULES:
        if re.search(pat, s):
            for k, v in m.items():
                exp[k] += v
            if why:
                evidence.append(why)
    if country and country != "United States":
        exp["trade"] -= 0.2
        exp["dollar"] -= 0.1
        evidence.append(f"Berdomisili di luar AS ({country})")
    for k in exp:
        exp[k] = round(max(-1.0, min(1.0, exp[k])), 2)
    return exp, evidence


def score_stock(exp, intensity, beta):
    impacts = {k: exp[k] * intensity[k] / 100 for k in THEME_KEYS}
    neg = -sum(v for v in impacts.values() if v < 0)
    pos = sum(v for v in impacts.values() if v > 0)
    risk = max(0.0, min(100.0, neg / 1.4 * 100))
    opp = max(0.0, min(100.0, pos / 1.0 * 100))
    b = beta if beta is not None else 1.0
    score = 62 - 0.5 * risk + 0.4 * opp - max(0.0, b - 1.2) * 10
    return {k: round(v, 3) for k, v in impacts.items()}, round(risk, 1), round(opp, 1), round(max(0, min(100, score)), 1)


def risk_label(r):
    if r >= 60:
        return "Sangat Tinggi"
    if r >= 40:
        return "Tinggi"
    if r >= 20:
        return "Sedang"
    return "Rendah"


# ----------------------------------------------------------------------------- orkestrasi
def build(records, prices, spy_close, news_for, workers=6, log=print):
    """records: list rekaman screener (mutasi: rec['geo']). Mengembalikan payload global geopolitik."""
    log("  geopolitik: indikator pasar...")
    ind, gsi, gsi_hist, ind_score = market_indicators(prices, spy_close)

    log("  geopolitik: berita...")
    syms = list(dict.fromkeys(NEWS_PROXIES + list(news_for)))
    news_by = {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for s, items in ex.map(fetch_news, syms):
            news_by[s] = items

    seen, all_news = set(), []
    for s, items in news_by.items():
        for n in items:
            key = n["title"].lower()[:90]
            if key in seen:
                continue
            seen.add(key)
            th = tag_themes(n["title"] + " " + n["summary"])
            if th:
                all_news.append({**n, "themes": th, "sym": s if s not in NEWS_PROXIES else None})
    all_news.sort(key=lambda n: str(n["date"] or ""), reverse=True)
    recent = [n for n in all_news if _age_days(n["date"]) <= 14]
    log(f"  geopolitik: {len(all_news)} berita relevan dari {len(syms)} sumber")

    # ---- intensitas tema
    counts = {k: sum(1 for n in recent if k in n["themes"]) for k in THEME_KEYS}
    maxc = max(counts.values()) if counts else 0
    mk = {
        "trade": [ind_score.get("china"), ind_score.get("dxy")],
        "tech": [ind_score.get("taiwan"), ind_score.get("semis"), ind_score.get("china")],
        "mideast": [ind_score.get("oil"), ind_score.get("gold"), ind_score.get("defense")],
        "europe": [ind_score.get("defense"), ind_score.get("gold"), ind_score.get("vix")],
        "reshoring": [],
        "cyber": [ind_score.get("vix")],
        "supply": [ind_score.get("oil")],
        "dollar": [ind_score.get("dxy"), ind_score.get("gold")],
        "minerals": [ind_score.get("china"), ind_score.get("gold")],
        "regulation": [],
    }
    themes_out, intensity = [], {}
    for k, t in THEMES.items():
        m_scores = [x for x in mk[k] if x is not None]
        m_val = sum(m_scores) / len(m_scores) if m_scores else t["base"]
        n_val = min(100, 25 + 75 * (counts[k] / maxc)) if maxc else t["base"]
        if counts[k] == 0:
            n_val = t["base"] * 0.7
        val = 0.35 * t["base"] + 0.35 * m_val + 0.30 * n_val
        intensity[k] = round(max(10, min(100, val)), 1)
        themes_out.append({
            "key": k, "name": t["name"], "icon": t["icon"], "desc": t["desc"],
            "intensity": intensity[k], "news_count": counts[k],
            "trend": "naik" if (n_val > t["base"] + 10 or m_val > 60) else ("turun" if m_val < 35 and counts[k] == 0 else "stabil"),
            "headlines": [{"title": n["title"], "url": n["url"], "source": n["source"], "date": n["date"]}
                          for n in recent if k in n["themes"]][:4],
        })

    # ---- per saham
    stock_news = {}
    for s, items in news_by.items():
        if s in NEWS_PROXIES:
            continue
        geo_items = []
        for n in items:
            th = tag_themes(n["title"] + " " + n["summary"])
            if th and _age_days(n["date"]) <= 30:
                geo_items.append({"title": n["title"], "url": n["url"], "source": n["source"],
                                  "date": n["date"], "themes": th})
        stock_news[s] = geo_items

    for rec in records:
        exp, evidence = stock_exposure(rec["industry"], rec["sector"], rec.get("summary_full") or rec["summary"],
                                       rec.get("country"))
        sn = stock_news.get(rec["sym"], [])
        for n in sn:  # berita perusahaan yang menyinggung tema → perkuat eksposur ke arah yang sudah ada
            for th in n["themes"]:
                if exp[th] != 0:
                    exp[th] = round(max(-1, min(1, exp[th] * 1.15)), 2)
                else:
                    exp[th] = -0.1
        impacts, risk, opp, gscore = score_stock(exp, intensity, rec["f"].get("beta"))
        rec["geo"] = {"exp": exp, "impact": impacts, "risk": risk, "opp": opp, "score": gscore,
                      "risk_label": risk_label(risk), "evidence": evidence[:5], "news": sn[:4]}

    # ---- pemenang & pecundang per tema
    for t in themes_out:
        k = t["key"]
        ranked = sorted(records, key=lambda r: -r["geo"]["exp"][k] * 100 - r["score"] * 0.01)
        t["winners"] = [r["sym"] for r in ranked if r["geo"]["exp"][k] >= 0.3][:8]
        t["losers"] = [r["sym"] for r in sorted(records, key=lambda r: r["geo"]["exp"][k] * 100 - r["score"] * 0.01)
                       if r["geo"]["exp"][k] <= -0.3][:8]

    # ---- sektor
    sec = {}
    for r in records:
        d = sec.setdefault(r["sector_id"], [])
        d.append(r["geo"]["score"])
    sectors = sorted([{"name": k, "score": round(sum(v) / len(v), 1), "n": len(v)} for k, v in sec.items()],
                     key=lambda x: -x["score"])

    themes_out.sort(key=lambda t: -t["intensity"])
    top = themes_out[:3]
    summary = (f"Indeks Stres Geopolitik berada di level {gsi:.0f}/100 ({stress_label(gsi).lower()}). "
               f"Tema paling dominan saat ini: {top[0]['name']} ({top[0]['intensity']:.0f}), "
               f"{top[1]['name']} ({top[1]['intensity']:.0f}), dan {top[2]['name']} ({top[2]['intensity']:.0f}).")
    hi = [i for i in ind if i["score"] is not None and i["score"] >= 65]
    if hi:
        summary += " Sinyal pasar yang menyala: " + ", ".join(i["name"].lower() for i in hi[:3]) + "."
    else:
        summary += " Belum ada sinyal pasar yang menunjukkan kepanikan geopolitik."

    return {
        "gsi": gsi, "gsi_label": stress_label(gsi), "gsi_hist": gsi_hist, "indicators": ind,
        "themes": themes_out, "sectors": sectors, "summary": summary,
        "news": [{"title": n["title"], "url": n["url"], "source": n["source"], "date": n["date"],
                  "themes": n["themes"], "sym": n["sym"]} for n in recent[:40]],
    }
