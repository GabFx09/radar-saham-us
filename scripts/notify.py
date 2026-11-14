"""
Notifikasi Telegram untuk Radar Saham US.

  python scripts/notify.py digest   -> ringkasan pagi setelah update data harian
  python scripts/notify.py alerts   -> cek harga intraday (dipanggil tiap 30 menit saat bursa buka)
  python scripts/notify.py test     -> kirim pesan uji

Variabel lingkungan (GitHub Secrets):
  TELEGRAM_TOKEN    token bot dari @BotFather (wajib)
  TELEGRAM_CHAT_ID  chat id Anda (wajib)
  GIST_TOKEN        token GitHub ber-scope "gist" — membaca watchlist & alert yang disinkronkan dari aplikasi,
                    dan menyimpan status agar alert tidak terkirim berulang (wajib untuk mode alerts)
  WATCHLIST         cadangan bila tanpa gist, mis. "NVDA,MSFT,MU"
"""
import datetime as dt
import html
import json
import os
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "docs", "data")
GIST_FILE = "radar-saham.json"
STATE_FILE = "radar-saham-state.json"
TOKEN = os.getenv("TELEGRAM_TOKEN", "").strip()
CHAT = os.getenv("TELEGRAM_CHAT_ID", "").strip()
GTOKEN = os.getenv("GIST_TOKEN", "").strip()
# Kabar (https://github.com/GabFx09/kabar): token gist yang sama boleh dipakai untuk keduanya
KTOKEN = (os.getenv("KABAR_TOKEN") or os.getenv("GIST_TOKEN") or "").strip()
KVAPID = os.getenv("KABAR_VAPID", "").strip()
KABAR_CHANNEL = os.getenv("KABAR_SALURAN", "Radar Saham")
CTX = {"gid": None, "state": {}, "cfg": {}}
OUTBOX = []
repo = os.getenv("GITHUB_REPOSITORY", "GabFx09/radar-saham-us")
SITE = os.getenv("SITE_URL") or f"https://{repo.split('/')[0].lower()}.github.io/{repo.split('/')[1]}/"


def log(*a):
    print(*a, flush=True)


def esc(x):
    return html.escape(str(x), quote=False)


def pct(x, d=1, sign=True):
    if x is None:
        return "–"
    v = x * 100
    return f"{'+' if sign and v > 0 else ''}{v:.{d}f}%"


def ago_txt(h):
    return "baru saja" if h < 1 else f"{h:.0f} jam lalu"


def news_lines(items):
    L = []
    for n in items:
        tag = f"<b>{esc(n['sym'])}</b>" if n.get("sym") else "<b>PASAR</b>"
        icon = "🔴" if n["impact"] < 0 else "🟢" if n["impact"] > 0 else "🟡"
        L.append(f"{icon} {tag} · {esc(', '.join(n['cats']))} · skor {n['score']}\n"
                 f"<a href=\"{esc(n['url'] or SITE)}\">{esc(n['title'])}</a>\n"
                 f"<i>{esc(n['source'])} · {ago_txt(n['age_h'])}</i>")
    return L


def important_news(cfg, state, hours, today):
    """Berita penting baru (belum pernah dikirim) untuk watchlist + pasar umum."""
    import berita
    st = cfg["settings"]
    if st.get("news") is False:
        return []
    level = st.get("news_level", "tinggi")
    min_stock, min_market = (40, 55) if level == "tinggi" else (30, 45)
    d = load_json("stocks.json") or {"stocks": []}
    names = {x["sym"]: x["name"] for x in d["stocks"]}
    syms = sorted(set(cfg["watchlist"]) | set(cfg["alerts"].keys()))[:40]
    items = berita.collect(syms, market=st.get("news_market", True), hours=hours,
                           min_stock=min_stock, min_market=min_market, names=names)
    sent = state.setdefault("news_sent", {})
    fresh, used_event = [], set()
    for n in items:
        ev = f"{today}:{n['sym'] or 'MKT'}:{n['cats'][0]}"  # satu peristiwa = satu notifikasi per hari
        if n["key"] in sent or ev in sent or ev in used_event:
            continue
        used_event.add(ev)
        sent[n["key"]] = today
        sent[ev] = today
        fresh.append(n)
    cutoff = (dt.date.today() - dt.timedelta(days=7)).isoformat()
    state["news_sent"] = {k: v for k, v in sent.items() if v >= cutoff}
    return fresh[:8]


def usd(x):
    return "–" if x is None else (f"−${-x:,.2f}" if x < 0 else f"${x:,.2f}")


# ----------------------------------------------------------------------------- Telegram
def send(text):
    if not TOKEN or not CHAT:
        return False
    chunks, cur = [], ""
    for line in text.split("\n"):
        if len(cur) + len(line) > 3800:
            chunks.append(cur)
            cur = ""
        cur += line + "\n"
    chunks.append(cur)
    ok = True
    for c in chunks:
        r = requests.post(f"https://api.telegram.org/bot{TOKEN}/sendMessage", timeout=30,
                          json={"chat_id": CHAT, "text": c, "parse_mode": "HTML", "disable_web_page_preview": True})
        if not r.ok:
            log(f"Telegram gagal: {r.status_code} {r.text[:200]}")
            ok = False
    return ok


# ----------------------------------------------------------------------------- pengiriman multi-saluran
def plain(htm):
    import re
    t = re.sub(r"<[^>]+>", "", htm)
    return html.unescape(t)


def deliver(kind, title, lines, url=None, sym=None, prio="normal", tombol=None, gambar=None):
    """Antrekan satu pesan: dikirim ke aplikasi Kabar (saluran "Radar Saham") + Telegram (opsional)."""
    body = "\n".join(lines).strip()
    tg = send(f"<b>{title}</b>\n{body}")
    OUTBOX.append({"judul": plain(title), "html": body, "url": url, "prioritas": prio, "tombol": tombol, "gambar": gambar})
    log(f"[{kind}] {plain(title)} — telegram={'ya' if tg else 'tidak'}")


def flush():
    """Kirim antrean ke Kabar (kotak pesan + notifikasi push) dan simpan status anti-duplikat ke gist Radar."""
    gid, state = CTX["gid"], CTX["state"]
    if OUTBOX:
        if KTOKEN:
            try:
                import kabar
                kabar.kirim_banyak(list(OUTBOX), saluran=KABAR_CHANNEL, token=KTOKEN, vapid=KVAPID)
                log(f"{len(OUTBOX)} pesan terkirim ke Kabar ({'dengan' if KVAPID else 'tanpa'} notifikasi push).")
            except Exception as e:  # noqa: BLE001
                log(f"Kabar gagal: {e}")
        elif not TOKEN:
            log("Tidak ada saluran aktif (KABAR_TOKEN / TELEGRAM_TOKEN). Pesan:\n" + "\n".join(m["judul"] for m in OUTBOX))
    if gid:
        r = gh("PATCH", f"/gists/{gid}", json={"files": {STATE_FILE: {"content": json.dumps(state, indent=1)}}})
        if not r.ok:
            log(f"Gist gagal ditulis: {r.status_code} {r.text[:150]}")
    OUTBOX.clear()


# ----------------------------------------------------------------------------- gist (watchlist dari aplikasi)
def gh(method, url, **kw):
    return requests.request(method, "https://api.github.com" + url, timeout=30,
                            headers={"Authorization": f"Bearer {GTOKEN}", "Accept": "application/vnd.github+json"}, **kw)


def gist_find():
    if not GTOKEN:
        return None
    for page in range(1, 6):
        r = gh("GET", f"/gists?per_page=100&page={page}")
        if not r.ok:
            log(f"Gist: {r.status_code} {r.text[:120]}")
            return None
        items = r.json()
        for g in items:
            if GIST_FILE in g.get("files", {}):
                return g["id"]
        if len(items) < 100:
            break
    return None


def gist_read(gid):
    r = gh("GET", f"/gists/{gid}")
    r.raise_for_status()
    files = r.json()["files"]

    def load(name):
        f = files.get(name)
        if not f:
            return {}
        content = f.get("content")
        if f.get("truncated"):
            content = requests.get(f["raw_url"], timeout=30).text
        try:
            return json.loads(content or "{}")
        except ValueError:
            return {}
    return load(GIST_FILE), load(STATE_FILE)


def user_config():
    gid = gist_find()
    cfg, state = ({}, {})
    if gid:
        try:
            cfg, state = gist_read(gid)
        except Exception as e:  # noqa: BLE001
            log(f"Gist gagal dibaca: {e}")
    if not cfg.get("watchlist") and os.getenv("WATCHLIST"):
        cfg["watchlist"] = [x.strip().upper() for x in os.getenv("WATCHLIST").split(",") if x.strip()]
    cfg.setdefault("watchlist", [])
    cfg.setdefault("alerts", {})
    cfg.setdefault("settings", {})
    cfg.setdefault("holdings", [])
    CTX.update({"gid": gid, "state": state, "cfg": cfg})
    return gid, cfg, state


# ----------------------------------------------------------------------------- data lokal
def load_json(name):
    try:
        with open(os.path.join(DATA, name), encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:  # noqa: BLE001
        return None


def detail(sym):
    return load_json(os.path.join("detail", f"{sym}.json")) or {}


# ----------------------------------------------------------------------------- tombol aksi dari Kabar
def sym_buttons(sym, cfg):
    b = []
    if sym not in cfg.get("watchlist", []):
        b.append(f"⭐ {sym} ke watchlist")
    b.append(f"🔕 {sym} hari ini")
    return b


def process_actions(gid, cfg, state):
    """Baca jawaban tombol di Kabar (saluran Radar Saham) lalu jalankan: tambah watchlist / bisukan hari ini."""
    if not KTOKEN:
        return
    import re
    try:
        import kabar
        _, box = kabar._read(KTOKEN, kabar._gist_id(KTOKEN))
    except Exception as e:  # noqa: BLE001
        log(f"Aksi Kabar tidak terbaca: {e}")
        return
    done = set(state.get("acted") or [])
    today = dt.date.today().isoformat()
    changed = False
    for m in box.get("messages") or []:
        a = (m.get("resp") or {}).get("a") or ""
        if m.get("ch") != KABAR_CHANNEL or not a or m["id"] in done:
            continue
        done.add(m["id"])
        w = re.match(r"^⭐\s*([A-Z0-9.\-]+)\s+ke watchlist", a)
        q = re.match(r"^🔕\s*([A-Z0-9.\-]+)\s+hari ini", a)
        if w and w.group(1) not in cfg["watchlist"]:
            cfg["watchlist"].append(w.group(1))
            changed = True
            log(f"Aksi: {w.group(1)} ditambahkan ke watchlist")
        if q:
            state.setdefault("mute", {})[q.group(1)] = today
            log(f"Aksi: {q.group(1)} dibisukan hari ini")
    state["acted"] = sorted(done)[-400:]
    state["mute"] = {k: v for k, v in (state.get("mute") or {}).items() if v == today}
    if changed and gid:
        cfg["updated"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        body = {k: v for k, v in cfg.items()}
        r = gh("PATCH", f"/gists/{gid}", json={"files": {GIST_FILE: {"content": json.dumps(body, indent=1)}}})
        if not r.ok:
            log(f"Watchlist gagal disimpan: {r.status_code}")


def muted(state, sym):
    return (state.get("mute") or {}).get(sym) == dt.date.today().isoformat()


# ----------------------------------------------------------------------------- portofolio
def portfolio_lines(cfg, by, rows):
    hs = [h for h in cfg.get("holdings") or [] if h.get("sym") in by and (h.get("qty") or 0) > 0]
    if not hs:
        return []
    val = cost = day = 0.0
    det = []
    for h in hs:
        s = by[h["sym"]]
        q, c = float(h["qty"]), float(h.get("cost") or 0)
        v = q * s["price"]
        val += v
        cost += q * c
        day += v - v / (1 + (s.get("chg1d") or 0))
        pl = (s["price"] / c - 1) if c else None
        det.append((v, h, f"{esc(h['sym'])} {q:g} lbr · {usd(v)} · {pct(pl, 1)} · {esc(s['rating'])}"))
    det.sort(key=lambda x: -x[0])
    import penasihat
    adv = {}
    for v, h, _ in det:
        hist = load_json(os.path.join("history", f"{h['sym']}.json"))
        adv[h["sym"]] = penasihat.advise(h, by[h["sym"]], penasihat.closes_since(hist, h.get("date")), v / val if val else 0)
    CTX["advice"] = adv
    pl_tot = val - cost if cost else None
    L = [f"\n<b>💼 PORTOFOLIO</b> · nilai <b>{usd(val)}</b> · hari ini {'+' if day >= 0 else ''}{usd(day)}"
         + (f" · total {('+' if pl_tot >= 0 else '')}{usd(pl_tot)} ({pct(pl_tot / cost, 1)})" if pl_tot is not None else "")]
    if "IDR=X" in rows:
        L.append(f"≈ Rp {val * rows['IDR=X']['last']:,.0f}".replace(",", "."))
    for _, h, x in det[:12]:
        a = adv[h["sym"]]
        L.append(f"[{a['act']}] {x}" + (f"\n   ↳ {esc(a['reasons'][0]['t'])}" if a["act"] in ("JUAL", "KURANGI") and a["reasons"] else ""))
    return L


def weekly_chart(syms, by, mk):
    """Grafik batang return 1 minggu watchlist + portofolio vs S&P 500 (PNG) untuk laporan Senin."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return None
    data = []
    for sym in syms[:16]:
        h = load_json(os.path.join("history", f"{sym}.json"))
        if h and len(h.get("c", [])) > 6:
            data.append((sym, h["c"][-1] / h["c"][-6] - 1))
    spy = next((r for g in mk.get("assets", []) for r in g["rows"] if r["sym"] == "SPY"), None)
    if spy and spy.get("w1") is not None:
        data.append(("S&P500", spy["w1"]))
    if len(data) < 2:
        return None
    data.sort(key=lambda x: x[1])
    fig, ax = plt.subplots(figsize=(7, 0.42 * len(data) + 1.2), dpi=110)
    fig.patch.set_facecolor("#000000")
    ax.set_facecolor("#000000")
    cols = ["#3cc8ff" if n == "S&P500" else ("#1fe07f" if v >= 0 else "#ff4f4f") for n, v in data]
    ax.barh([n for n, _ in data], [v * 100 for _, v in data], color=cols)
    for i, (_, v) in enumerate(data):
        ax.text(v * 100, i, f" {v * 100:+.1f}%", va="center", ha="left" if v >= 0 else "right", color="#ececec", fontsize=8, family="monospace")
    lo, hi = min(0, min(v for _, v in data)) * 100, max(0, max(v for _, v in data)) * 100
    pad = (hi - lo) * 0.18 or 1
    ax.set_xlim(lo - (pad if lo < 0 else 0), hi + pad)
    ax.axvline(0, color="#767676", lw=0.8)
    ax.tick_params(colors="#b0b0b0", labelsize=8)
    for sp in ax.spines.values():
        sp.set_color("#262626")
    ax.set_title("RETURN 1 MINGGU · WATCHLIST & PORTOFOLIO", color="#ff9f1a", fontsize=10, family="monospace", loc="left")
    fig.tight_layout()
    import tempfile
    path = os.path.join(os.getenv("RUNNER_TEMP") or tempfile.gettempdir(), "radar-mingguan.png")
    fig.savefig(path, facecolor="#000000")
    plt.close(fig)
    return path


# ----------------------------------------------------------------------------- ringkasan pagi
def world_line():
    """Rezim & sikap saham AS dari Prakiraan Dunia (gabfx09.github.io/prakiraan-dunia)."""
    for base in ("https://gabfx09.github.io/prakiraan-dunia/data/", "https://raw.githubusercontent.com/GabFx09/prakiraan-dunia/main/data/"):
        try:
            r = requests.get(base + "snapshot.json", timeout=20)
            r.raise_for_status()
            snap = r.json()
            break
        except Exception:  # noqa: BLE001
            snap = None
    if not snap:
        return []
    nm = {"add": "Tambah", "hold": "Tahan", "care": "Hati-hati", "cut": "Kurangi"}
    us = next((a for a in snap.get("assets", []) if a["n"].startswith("Saham AS")), None)
    out = f"🌍 {esc(snap.get('regimeTitle', ''))} · risiko dunia {snap.get('risk')}/100"
    if us:
        out += f" · saham AS: {nm.get(us['s'][0], us['s'][0])} (1 bln) → {nm.get(us['s'][2], us['s'][2])} (6 bln)"
    return [out]


def digest():
    d = load_json("stocks.json")
    if not d:
        log("stocks.json tidak ada")
        return
    gid, cfg, state = user_config()
    process_actions(gid, cfg, state)
    st = cfg["settings"]
    if st.get("daily") is False:
        log("Ringkasan harian dimatikan di pengaturan.")
        return
    by = {s["sym"]: s for s in d["stocks"]}
    mk = load_json("makro.json") or {}
    wl = [s for s in cfg["watchlist"] if s in by]
    held = [h["sym"] for h in cfg.get("holdings") or [] if h.get("sym") in by]
    mine = list(dict.fromkeys(held + wl))
    now = time.time()
    tgl = dt.datetime.fromisoformat(d["generated"]).astimezone(dt.timezone(dt.timedelta(hours=7)))
    hari = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"][tgl.weekday()]
    title = f"📊 Ringkasan pagi · {hari}, {tgl.strftime('%d/%m/%Y')}"
    L = []

    m = d.get("market") or {}
    rows = {r["sym"]: r for g in mk.get("assets", []) for r in g["rows"]}
    parts = []
    if m:
        parts.append(f"S&amp;P 500 {m['spy']:,.0f} ({pct(m['chg1d'], 2)})")
    if mk.get("fg"):
        parts.append(f"Fear&amp;Greed {mk['fg']['now']:.0f} {esc(mk['fg']['label'])}")
    if "^VIX" in rows:
        parts.append(f"VIX {rows['^VIX']['last']:.1f}")
    if "^TNX" in rows:
        parts.append(f"UST10 {rows['^TNX']['last']:.2f}%")
    if "IDR=X" in rows:
        parts.append(f"USD/IDR {rows['IDR=X']['last']:,.0f}")
    if parts:
        L.append("🌐 " + " · ".join(parts))
    L.extend(world_line())

    # pengingat H-1: laporan keuangan & ex-dividend saham milik/pantauan
    soon = []
    for sym in mine:
        s = by[sym]
        e = s.get("earnings_ts")
        if e and now - 3600 < e < now + 36 * 3600:
            soon.append(f"📅 <b>{esc(sym)}</b> lapor keuangan {dt.datetime.fromtimestamp(e, dt.timezone(dt.timedelta(hours=7))).strftime('%a %d/%m %H:%M')} WIB"
                        + (" (perkiraan)" if s.get("earnings_est") else "") + " — harga bisa bergerak tajam")
        x = s.get("exdiv_ts")
        if x and now - 3600 < x < now + 3 * 86400:
            soon.append(f"💵 <b>{esc(sym)}</b> ex-dividend {dt.datetime.fromtimestamp(x, dt.timezone.utc).strftime('%d/%m')}"
                        + (" (perkiraan)" if s.get("exdiv_est") else "")
                        + (f" · ${s['div_rate']:.2f}/thn" if s.get("div_rate") else "") + " — harus sudah memegang sebelum tanggal ini")
    if soon:
        L.append("\n<b>⏰ SEGERA</b>")
        L.extend(soon)

    L.extend(portfolio_lines(cfg, by, rows))
    ip = load_json("ipo.json") or {}
    big = [x for x in ip.get("upcoming") or [] if x.get("type") == "Perusahaan" and x.get("date")
           and x["date"] <= (dt.date.today() + dt.timedelta(days=8)).isoformat() and (x.get("amount") or 0) >= 50e6]
    if big:
        L.append("\n<b>🆕 IPO MINGGU INI</b>")
        for x in big[:6]:
            rng = f"${x['lo']:.0f}–{x['hi']:.0f}" if x.get("lo") and x.get("hi") and x["lo"] != x["hi"] else (f"${x['hi']:.2f}" if x.get("hi") else "harga belum ada")
            L.append(f"{esc(x.get('sym') or '?')} · {esc(x['name'])} · {x['date'][8:10]}/{x['date'][5:7]} · {rng} · "
                     f"{('$' + format(x['amount'] / 1e6, ',.0f') + ' jt') if x.get('amount') else ''}")
    lk = [x for x in ip.get("lockups") or [] if x["sym"] in mine and x["date"] <= (dt.date.today() + dt.timedelta(days=10)).isoformat()]
    for x in lk:
        L.append(f"🔓 <b>{esc(x['sym'])}</b> lock-up IPO berakhir {x['date'][8:10]}/{x['date'][5:7]} — orang dalam boleh menjual, harga sering tertekan")

    # watchlist
    if wl:
        L.append(f"\n<b>⭐ WATCHLIST ({len(wl)})</b>")
        warn = []
        for sym in wl:
            s = by[sym]
            det = detail(sym)
            plan = det.get("plan") or {}
            up = (s.get("val") or {}).get("upside")
            line = (f"<b>{esc(sym)}</b> {usd(s['price'])} ({pct(s.get('chg1d'), 1)}) · {esc(s['rating'])} "
                    f"{s['score']:.0f} · proyeksi {pct(up, 0)}")
            pv = s.get("prev")
            if pv and pv.get("rating") != s["rating"]:
                arrow = "▲" if ["HINDARI", "HOLD", "BUY", "STRONG BUY"].index(s["rating"]) > \
                    ["HINDARI", "HOLD", "BUY", "STRONG BUY"].index(pv["rating"]) else "▼"
                line += f"\n   {arrow} rekomendasi berubah dari {esc(pv['rating'])}"
            L.append(line)
            if plan.get("stop") and s["price"] <= plan["stop"] * 1.03:
                warn.append(f"🛑 {esc(sym)} dekat/di bawah stop loss {usd(plan['stop'])}")
            if plan.get("target") and s["price"] >= plan["target"] * 0.97:
                warn.append(f"🎯 {esc(sym)} dekat/melewati target {usd(plan['target'])}")
            al = cfg["alerts"].get(sym) or {}
            if al.get("above") and s["price"] >= al["above"]:
                warn.append(f"🔔 {esc(sym)} di atas alert {usd(al['above'])}")
            if al.get("below") and s["price"] <= al["below"]:
                warn.append(f"🔔 {esc(sym)} di bawah alert {usd(al['below'])}")
        if warn:
            L.append("\n<b>⚠️ PERLU PERHATIAN</b>")
            L.extend(warn)

    # laporan keuangan 7 hari (watchlist + Strong Buy/Buy)
    earn = [s for s in d["stocks"] if s.get("earnings_ts") and now - 86400 < s["earnings_ts"] < now + 7 * 86400
            and (s["sym"] in wl or s["rating"] in ("STRONG BUY", "BUY"))]
    if earn:
        earn.sort(key=lambda s: s["earnings_ts"])
        L.append("\n<b>📅 LAPORAN KEUANGAN 7 HARI</b>")
        L.append(" · ".join(f"{'⭐' if s['sym'] in wl else ''}{esc(s['sym'])} "
                            f"{dt.datetime.fromtimestamp(s['earnings_ts'], dt.timezone.utc).strftime('%d/%m')}"
                            for s in earn[:15]))

    # strong buy & perubahan
    sb = [s for s in d["stocks"] if s["rating"] == "STRONG BUY"]
    if sb:
        L.append("\n<b>★ STRONG BUY</b>")
        L.append(" · ".join(f"{esc(s['sym'])} {pct((s.get('val') or {}).get('upside'), 0)}" for s in sb[:10]))
    ch = d.get("changes") or {}
    if ch.get("up") or ch.get("down"):
        L.append(f"\n<b>🔄 PERUBAHAN</b> (vs {esc(ch.get('since', ''))})")
        if ch.get("up"):
            L.append("▲ " + ", ".join(f"{esc(x['sym'])}→{esc(x['to'])}" for x in ch["up"][:8]))
        if ch.get("down"):
            L.append("▼ " + ", ".join(f"{esc(x['sym'])}→{esc(x['to'])}" for x in ch["down"][:8]))
    try:
        import berita
        if st.get("news") is not False:
            names = {x["sym"]: x["name"] for x in d["stocks"]}
            top = berita.collect(wl[:40], market=st.get("news_market", True), hours=24, names=names)[:6]
            if top:
                L.append("\n<b>📰 BERITA PENTING 24 JAM</b>")
                L.extend(news_lines(top))
    except Exception as e:  # noqa: BLE001
        log(f"Berita gagal: {e}")
    L.append(f"\n<a href=\"{SITE}\">Buka Radar Saham</a> · bukan nasihat investasi")
    deliver("digest", title, L, SITE)
    prev = state.get("adv") or {}
    for sym, a in (CTX.get("advice") or {}).items():
        if a["act"] in ("JUAL", "KURANGI") and prev.get(sym) != a["act"]:
            deliver("advice", f"💼 {sym}: saran {a['act']}", [f"{'−' if r['s'] < 0 else '+' if r['s'] > 0 else '·'} {esc(r['t'])}" for r in a["reasons"]],
                    f"{SITE}#/portofolio", sym, prio="tinggi" if a["act"] == "JUAL" else "normal")
    state["adv"] = {k: v["act"] for k, v in (CTX.get("advice") or {}).items()}
    if tgl.weekday() == 0 and mine:  # Senin: laporan mingguan bergrafik
        try:
            png = weekly_chart(mine, by, mk)
            if png:
                deliver("weekly", "📈 Laporan mingguan", ["Return 1 minggu saham watchlist & portofolio dibanding S&amp;P 500."], SITE, gambar=png)
        except Exception as e:  # noqa: BLE001
            log(f"Grafik mingguan gagal: {e}")
    flush()
    log("Ringkasan terkirim." if TOKEN else "")


# ----------------------------------------------------------------------------- alert intraday
def alerts():
    gid, cfg, state = user_config()
    st = cfg["settings"]
    if st.get("intraday") is False and st.get("news") is False:
        log("Alert intraday & berita dimatikan.")
        return
    if not gid:
        log("GIST_TOKEN/gist belum ada — alert & berita butuh gist (watchlist, kotak masuk, dan pencegah pesan berulang).")
        return
    today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    process_actions(gid, cfg, state)
    # ---- berita penting (setiap jadwal, termasuk di luar jam bursa & akhir pekan)
    try:
        fresh = important_news(cfg, state, hours=6, today=today)
        if fresh:
            for n in fresh:
                if n["sym"] and muted(state, n["sym"]):
                    continue
                deliver("news", f"📰 {n['sym'] or 'Pasar'}: {', '.join(n['cats'])}", news_lines([n]), n["url"], n["sym"],
                        prio="tinggi" if n["score"] >= 65 else "normal",
                        tombol=sym_buttons(n["sym"], cfg) if n["sym"] else None)
            log(f"{len(fresh)} berita penting terkirim.")
        else:
            log("Tidak ada berita penting baru.")
    except Exception as e:  # noqa: BLE001
        log(f"Berita gagal: {e}")
    held = {h["sym"] for h in cfg.get("holdings") or [] if h.get("sym")}
    syms = sorted((set(cfg["watchlist"]) | set(cfg["alerts"].keys()) | held) - {x for x in (state.get("mute") or {}) if muted(state, x)})
    ny = dt.datetime.now(dt.timezone(dt.timedelta(hours=-5)))
    mins = ny.hour * 60 + ny.minute
    market_open = ny.weekday() < 5 and 8 * 60 + 30 <= mins <= 17 * 60  # rentang lebar: aman untuk DST
    if not syms or not market_open:
        log("Watchlist kosong." if not syms else "Bursa tutup — cek harga dilewati.")
        state["last_check"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        flush()
        return
    import yfinance as yf
    df = yf.download(syms, period="5d", interval="15m", auto_adjust=True, group_by="ticker", progress=False,
                     threads=True, prepost=False)
    daily = yf.download(syms, period="10d", interval="1d", auto_adjust=True, group_by="ticker", progress=False)
    sent = {k: v for k, v in (state.get("sent") or {}).items() if v >= (dt.date.today() - dt.timedelta(days=5)).isoformat()}
    move_th = float(st.get("move_pct") or 5) / 100
    auto = st.get("auto_plan", True)
    msgs = []
    if st.get("intraday") is False:
        syms = []
    for sym in syms:
        try:
            sub = df[sym] if len(syms) > 1 else df
            px = float(sub["Close"].dropna().iloc[-1])
            dsub = daily[sym] if len(syms) > 1 else daily
            dc = dsub["Close"].dropna()
            last_day = sub["Close"].dropna().index[-1].date()
            prev = float(dc[dc.index.date < last_day].iloc[-1])
        except Exception:  # noqa: BLE001
            continue
        chg = px / prev - 1
        al = cfg["alerts"].get(sym) or {}
        plan = detail(sym).get("plan") or {} if auto else {}
        checks = [
            ("above", al.get("above"), px >= (al.get("above") or 9e18), f"🔔 <b>{esc(sym)}</b> naik ke {usd(px)} — melewati alert {usd(al.get('above'))}"),
            ("below", al.get("below"), px <= (al.get("below") or -1), f"🔔 <b>{esc(sym)}</b> turun ke {usd(px)} — di bawah alert {usd(al.get('below'))}"),
            ("target", plan.get("target"), px >= (plan.get("target") or 9e18), f"🎯 <b>{esc(sym)}</b> {usd(px)} mencapai target nilai wajar {usd(plan.get('target'))}"),
            ("stop", plan.get("stop"), px <= (plan.get("stop") or -1), f"🛑 <b>{esc(sym)}</b> {usd(px)} menembus stop loss {usd(plan.get('stop'))}"),
            ("move", True, abs(chg) >= move_th, f"{'🚀' if chg > 0 else '📉'} <b>{esc(sym)}</b> bergerak {pct(chg, 1)} hari ini ke {usd(px)}"),
        ]
        for kind, level, hit, text in checks:
            if not level or not hit:
                continue
            key = f"{today}:{sym}:{kind}"
            if key in sent:
                continue
            sent[key] = today
            msgs.append((sym, kind, text))
    if msgs:
        for sym in dict.fromkeys(x[0] for x in msgs):
            mine = [x for x in msgs if x[0] == sym]
            urgent = any(k == "stop" for _, k, _ in mine) or (sym in held and any(k == "move" for _, k, _ in mine))
            deliver("alert", f"⚡ Alert {sym}" + (" · portofolio" if sym in held else ""), [t for _, _, t in mine],
                    f"{SITE}#/s/{sym}", sym, prio="tinggi" if urgent else "normal", tombol=sym_buttons(sym, cfg))
        log(f"{len(msgs)} alert terkirim.")
    else:
        log("Tidak ada alert baru.")
    state["sent"] = sent
    state["last_check"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    flush()


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "digest"
    if mode == "digest":
        digest()
    elif mode == "alerts":
        alerts()
    elif mode == "test":
        user_config()
        deliver("test", "✅ Radar Saham terhubung", ["Ringkasan pagi, alert harga, dan berita penting akan muncul di sini."], SITE)
        flush()
