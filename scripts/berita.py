"""
Deteksi berita penting untuk notifikasi Radar Saham US.

Setiap berita (judul + ringkasan) dinilai 0-100 berdasarkan kata kunci peristiwa yang biasanya
menggerakkan harga secara tajam (akuisisi, kebangkrutan, investigasi, panduan laba, keputusan
The Fed, perang, dll.), lalu diberi label kategori berbahasa Indonesia.

  score_news(title, summary, sym=None) -> (skor, [kategori], dampak)  dampak: +1 positif, -1 negatif, 0 netral
  collect(symbols, market=True, hours=6) -> daftar berita penting terurut
"""
import datetime as dt
import hashlib
import re
import time

import yfinance as yf

# (pola regex, bobot, kategori, arah dampak)
COMPANY_RULES = [
    (r"\bchapter 11\b|\bbankrupt|\binsolven", 70, "Kebangkrutan", -1),
    (r"\bfraud\b|\baccounting (?:irregular|probe|scandal)|\brestat(?:e|es|ement)\b", 60, "Dugaan penipuan/akuntansi", -1),
    (r"\bsec (?:charges|probe|investigat|sues)|\bdoj\b|\bsubpoena|\bindict|\braid(?:ed)?\b", 50, "Investigasi regulator", -1),
    (r"\bto acquire\b|\bacquisition of\b|\bagrees to (?:buy|acquire)|\bmerger\b|\bbuyout\b|\btakeover\b|\btender offer|\bto be acquired|\bin talks to (?:buy|acquire)", 55, "Akuisisi/merger", 0),
    (r"\bfda (?:approv|clear|grants)", 50, "Persetujuan FDA", 1),
    (r"\bfda (?:reject|declin|refus)|complete response letter|\bclinical hold\b|trial (?:fail|halt)", 55, "Penolakan/kegagalan uji FDA", -1),
    (r"\b(?:cuts?|lowers?|slashes?|withdraws?) (?:its |full-year |annual )?(?:guidance|outlook|forecast)|profit warning|\bwarns\b", 50, "Panduan laba dipangkas", -1),
    (r"\b(?:raises?|lifts?|boosts?|hikes?) (?:its |full-year |annual )?(?:guidance|outlook|forecast)", 45, "Panduan laba dinaikkan", 1),
    (r"\bmiss(?:es|ed)? (?:estimates|expectations|forecasts)|\bfalls? short\b|\bdisappoint", 40, "Laba di bawah estimasi", -1),
    (r"\bbeats? (?:estimates|expectations|forecasts)|\btops? (?:estimates|expectations)|\bblowout\b|\brecord (?:revenue|profit|quarter)", 35, "Laba di atas estimasi", 1),
    (r"\bdowngrade", 30, "Penurunan peringkat analis", -1),
    (r"\bupgrade", 25, "Kenaikan peringkat analis", 1),
    (r"\b(?:ceo|cfo|chief executive|chairman)\b.{0,40}\b(?:resign|steps? down|ousted|fired|depart|exit|retire|replaced)", 50, "Pergantian pimpinan", -1),
    (r"\bstock split\b", 35, "Pemecahan saham", 1),
    (r"\b(?:buyback|share repurchase)\b", 25, "Pembelian kembali saham", 1),
    (r"\b(?:cuts?|suspends?|eliminates?) (?:its |the |quarterly )?dividend", 50, "Dividen dipangkas", -1),
    (r"\b(?:raises?|hikes?|boosts?) (?:its |the |quarterly )?dividend|\bspecial dividend", 25, "Dividen dinaikkan", 1),
    (r"\blayoffs?\b|\bjob cuts?\b|\bcut(?:s|ting)? \d[\d,]* jobs", 30, "PHK", 0),
    (r"\brecall", 40, "Penarikan produk", -1),
    (r"\bdata breach|\bcyberattack|\bhack(?:ed|ers)\b|\bransomware|\boutage\b", 40, "Serangan siber/gangguan", -1),
    (r"\bantitrust|\blawsuit|\bsued\b|\bverdict|\bfine[sd]? \$|\bpenalt", 35, "Hukum/antimonopoli", -1),
    (r"\bdelist|\btrading halt|\bhalted\b", 55, "Penghentian perdagangan", -1),
    (r"\bscandal\b|\bsmuggl|\bbribery\b|\bwhistleblower", 50, "Skandal", -1),
    (r"\bousted\b|\bouster\b|\bresigns?\b|\bsteps? down\b", 40, "Pergantian pimpinan", -1),
    (r"\bshort seller|\bshort report\b|hindenburg|muddy waters", 50, "Laporan short seller", -1),
    (r"\bspin[- ]?off\b|\bbreak up\b|\bsplit into\b", 40, "Pemisahan bisnis", 0),
    (r"\bexport (?:ban|curbs?|controls?|restrictions?)|\bentity list\b|\bsanction|\bbanned chips", 45, "Pembatasan ekspor/sanksi", -1),
    (r"\bs&p 500 (?:index )?(?:inclusion|addition)|added to (?:the )?s&p 500|join(?:s|ing)? the s&p 500", 40, "Masuk indeks S&P 500", 1),
    (r"\bpartnership with (?:nvidia|microsoft|apple|google|amazon|openai|meta)|\bmulti-?billion(?:-dollar)? (?:deal|contract|order)", 35, "Kontrak/kemitraan besar", 1),
]
MARKET_RULES = [
    (r"\b(?:fed|federal reserve|fomc|powell)\b.{0,50}\b(?:raises?|raised|hikes?|hiked|cuts?|lowers?|lowered|holds?|keeps?|leaves?|pauses?)\b.{0,25}\brates?\b|\bfomc (?:decision|statement|minutes)", 55, "Keputusan suku bunga The Fed", 0),
    (r"\bemergency (?:rate|meeting|cut|move|action)|\bcircuit breaker|\bflash crash|\bmarket crash|\bbloodbath", 75, "Gejolak pasar ekstrem", -1),
    (r"\b(?:cpi|inflation)\b.{0,30}\b(?:hotter|cooler|surges?|jumps?|unexpected|accelerat|eases?)|\binflation report", 45, "Data inflasi", 0),
    (r"\b(?:jobs report|nonfarm payrolls?|unemployment rate)\b", 40, "Data tenaga kerja", 0),
    (r"\brecession\b", 40, "Risiko resesi", -1),
    (r"\b(?:invasion|invades|declares? war|missile strikes?|air ?strikes?|nuclear|attack on)\b", 60, "Konflik/perang", -1),
    (r"\bceasefire|\bpeace (?:deal|talks|agreement)", 45, "Gencatan senjata/perdamaian", 1),
    (r"\btariffs?\b.{0,40}\b(?:impose|announce|raise|hike|new|retaliat|threat|exempt|pause|lift)", 50, "Tarif perdagangan", -1),
    (r"\b(?:government shutdown|debt ceiling|default on)\b", 50, "Krisis fiskal AS", -1),
    (r"\bopec\+?\b.{0,40}\b(?:cut|boost|output|production)", 40, "Kebijakan OPEC", 0),
    (r"\bbank (?:run|failure|collapse)|\bcontagion\b|\bbailout", 65, "Krisis perbankan", -1),
    (r"\bdowngrades? (?:the )?(?:us|u\.s\.|united states) (?:credit|sovereign)", 65, "Peringkat utang AS turun", -1),
    (r"\b(?:stocks|s&p 500|dow|nasdaq|markets?)\b.{0,30}\b(?:plunge|tumble|crash|sink|rout|sell-?off|worst day)", 45, "Pasar anjlok", -1),
    (r"\b(?:stocks|s&p 500|dow|nasdaq)\b.{0,30}\b(?:record high|all-time high|surge|soar|best day|rally)", 30, "Pasar menguat tajam", 1),
]
INTENSIFIERS = [(r"\b(?:plunge|plummet|crater|collapse|tank|tumble|soar|skyrocket|surge|spike|jump)s?\b|\bhistoric\b|\bbreaking\b", 10),
                (r"\b(?:\d{2,3}(?:\.\d)?) ?%", 8)]
MARKET_SYMS = ["SPY", "^GSPC", "QQQ", "^VIX", "CL=F", "GC=F", "DX-Y.NYB"]


def relevant(n, sym, name):
    """Berita di feed saham kadang membahas perusahaan lain; pastikan saham ini disebut."""
    if not sym:
        return True
    text = f"{n['title']} {n['summary']}".lower()
    keys = {sym.lower()}
    if name:
        first = re.sub(r"[^a-z0-9&]", "", name.lower().split()[0])
        if first == "the" and len(name.split()) > 1:
            first = re.sub(r"[^a-z0-9&]", "", name.lower().split()[1])
        if len(first) >= 3 and first not in {"first", "american", "united", "general", "international"}:
            keys.add(first)
    return any(re.search(rf"\b{re.escape(k)}\b", text) for k in keys)


def score_news(title, summary="", sym=None, market=False):
    text = f"{title} . {summary}".lower()
    t_low = title.lower()
    best, cats, impact = 0, [], 0
    rules = (MARKET_RULES + COMPANY_RULES) if market else (COMPANY_RULES + MARKET_RULES)
    for pat, w, cat, imp in rules:
        if re.search(pat, t_low):
            w_eff = w
        elif re.search(pat, text):
            w_eff = w * 0.6  # hanya di ringkasan: kurang kuat
        else:
            continue
        cats.append(cat)
        if w_eff > best:
            best, impact = w_eff, imp
    if not cats:
        return 0, [], 0
    score = best + 8 * (len(set(cats)) - 1)
    title_hit = any(re.search(p, t_low) for p, *_ in rules)
    for pat, w in INTENSIFIERS:
        if title_hit and re.search(pat, t_low):
            score += w
    # berita yang menyebut ticker/perusahaan di judul lebih relevan
    if sym and not market and re.search(rf"\b{re.escape(sym.lower())}\b", t_low):
        score += 5
    return min(100, round(score)), list(dict.fromkeys(cats))[:3], impact


def _parse(items):
    out = []
    for it in items or []:
        c = it.get("content", it) if isinstance(it, dict) else {}
        title = (c.get("title") or "").strip()
        if not title:
            continue
        url = ((c.get("canonicalUrl") or {}).get("url") or (c.get("clickThroughUrl") or {}).get("url")
               or c.get("previewUrl") or c.get("link") or "")
        pub = c.get("pubDate") or c.get("displayTime")
        if not pub and c.get("providerPublishTime"):
            pub = dt.datetime.fromtimestamp(c["providerPublishTime"], dt.timezone.utc).isoformat()
        out.append({"title": title, "summary": (c.get("summary") or "")[:300], "url": url,
                    "source": (c.get("provider") or {}).get("displayName") or c.get("publisher") or "", "date": pub})
    return out


def _age_h(iso):
    try:
        d = dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return (dt.datetime.now(dt.timezone.utc) - d).total_seconds() / 3600
    except Exception:  # noqa: BLE001
        return 999


def news_key(title):
    norm = re.sub(r"[^a-z0-9 ]", "", title.lower())
    norm = " ".join(norm.split()[:12])
    return hashlib.sha1(norm.encode()).hexdigest()[:12]


def fetch(sym):
    for _ in range(2):
        try:
            return _parse(yf.Ticker(sym).news)
        except Exception:  # noqa: BLE001
            time.sleep(1.5)
    return []


def collect(symbols, market=True, hours=6, min_stock=40, min_market=55, names=None):
    """Kumpulkan berita penting: saham pantauan (ambang lebih rendah) + pasar umum (ambang tinggi)."""
    names = names or {}
    seen, out = set(), []
    jobs = [(s, False) for s in symbols] + ([(m, True) for m in MARKET_SYMS] if market else [])
    for sym, is_mkt in jobs:
        for n in fetch(sym):
            age = _age_h(n["date"])
            if age > hours:
                continue
            k = news_key(n["title"])
            if k in seen or (not is_mkt and not relevant(n, sym, names.get(sym))):
                continue
            sc, cats, imp = score_news(n["title"], n["summary"], None if is_mkt else sym, is_mkt)
            if sc < (min_market if is_mkt else min_stock):
                continue
            seen.add(k)
            out.append({**n, "sym": None if is_mkt else sym, "score": sc, "cats": cats, "impact": imp,
                        "age_h": round(age, 1), "key": k})
        time.sleep(0.3)
    out.sort(key=lambda x: (-x["score"], x["age_h"]))
    return out


if __name__ == "__main__":
    # uji cepat aturan penilaian
    tests = [
        ("Nvidia faces new US export curbs on AI chips to China", "NVDA"),
        ("Apple to acquire Perplexity in $14 billion deal", "AAPL"),
        ("Fed cuts interest rates by 50 basis points in emergency move", None),
        ("XYZ Corp files for Chapter 11 bankruptcy protection", "XYZ"),
        ("Micron raises full-year guidance as AI memory demand soars", "MU"),
        ("5 stocks to watch this week", "SPY"),
        ("Tesla CEO Elon Musk steps down as chairman", "TSLA"),
    ]
    for t, s in tests:
        print(score_news(t, "", s, market=s is None), "|", t)
