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
INBOX_FILE = "radar-saham-inbox.json"
STATE_FILE = "radar-saham-state.json"
TOKEN = os.getenv("TELEGRAM_TOKEN", "").strip()
CHAT = os.getenv("TELEGRAM_CHAT_ID", "").strip()
GTOKEN = os.getenv("GIST_TOKEN", "").strip()
VAPID = os.getenv("VAPID_PRIVATE_KEY", "").strip()
CTX = {"gid": None, "state": {}, "inbox": {"messages": []}, "cfg": {}}
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
    return "–" if x is None else f"${x:,.2f}"


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


def deliver(kind, title, lines, url=None, sym=None):
    """Kirim satu pesan ke semua saluran: kotak masuk aplikasi (gist), notifikasi push, dan Telegram (opsional)."""
    body = "\n".join(lines).strip()
    tg = send(f"<b>{title}</b>\n{body}")
    OUTBOX.append({"id": f"{int(time.time() * 1000)}{len(OUTBOX)}", "t": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                   "kind": kind, "title": plain(title), "html": body, "url": url, "sym": sym})
    log(f"[{kind}] {plain(title)} — telegram={'ya' if tg else 'tidak'}")


def push_all(cfg, state):
    subs = [x for x in (cfg.get("push") or []) if x.get("endpoint")]
    if not subs or not VAPID or not OUTBOX:
        if subs and not VAPID:
            log("VAPID_PRIVATE_KEY belum diatur — notifikasi push dilewati.")
        return
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        log("pywebpush tidak terpasang")
        return
    dead = set(state.get("dead_push") or [])
    last = OUTBOX[-1]
    title = last["title"] if len(OUTBOX) == 1 else f"{len(OUTBOX)} pesan baru · Radar Saham"
    body = plain(last["html"]).replace("\n", " · ")[:180] if len(OUTBOX) == 1 else \
        " · ".join(m["title"] for m in OUTBOX)[:180]
    payload = json.dumps({"title": title, "body": body, "url": SITE + "#/pesan", "tag": last["kind"]})
    for sub in subs:
        if sub["endpoint"] in dead:
            continue
        try:
            webpush(subscription_info={"endpoint": sub["endpoint"], "keys": sub.get("keys", {})}, data=payload,
                    vapid_private_key=VAPID, vapid_claims={"sub": SITE.rstrip("/")}, ttl=86400)
            log("push terkirim ke " + sub.get("ua", "perangkat"))
        except WebPushException as e:
            code = getattr(e.response, "status_code", None)
            log(f"push gagal ({code}): {str(e)[:120]}")
            if code in (404, 410):
                dead.add(sub["endpoint"])
        except Exception as e:  # noqa: BLE001
            log(f"push gagal: {e}")
    state["dead_push"] = sorted(dead)[-50:]


def flush():
    """Simpan pesan ke kotak masuk gist + status, lalu kirim notifikasi push."""
    gid, state, cfg = CTX["gid"], CTX["state"], CTX["cfg"]
    if OUTBOX:
        push_all(cfg, state)
    if not gid:
        if OUTBOX and not TOKEN:
            log("Tidak ada saluran aktif (GIST_TOKEN / TELEGRAM_TOKEN). Pesan:\n" + "\n".join(m["title"] for m in OUTBOX))
        return
    files = {STATE_FILE: {"content": json.dumps(state, indent=1)}}
    if OUTBOX:
        inbox = CTX["inbox"] or {"messages": []}
        inbox["messages"] = (inbox.get("messages") or []) + OUTBOX
        inbox["messages"] = inbox["messages"][-300:]
        inbox["updated"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        files[INBOX_FILE] = {"content": json.dumps(inbox, ensure_ascii=False, indent=0)}
    r = gh("PATCH", f"/gists/{gid}", json={"files": files})
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
    return load(GIST_FILE), load(STATE_FILE), load(INBOX_FILE)


def user_config():
    gid = gist_find()
    cfg, state, inbox = ({}, {}, {"messages": []})
    if gid:
        try:
            cfg, state, inbox = gist_read(gid)
        except Exception as e:  # noqa: BLE001
            log(f"Gist gagal dibaca: {e}")
    if not cfg.get("watchlist") and os.getenv("WATCHLIST"):
        cfg["watchlist"] = [x.strip().upper() for x in os.getenv("WATCHLIST").split(",") if x.strip()]
    cfg.setdefault("watchlist", [])
    cfg.setdefault("alerts", {})
    cfg.setdefault("settings", {})
    CTX.update({"gid": gid, "state": state, "inbox": inbox or {"messages": []}, "cfg": cfg})
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


# ----------------------------------------------------------------------------- ringkasan pagi
def digest():
    d = load_json("stocks.json")
    if not d:
        log("stocks.json tidak ada")
        return
    gid, cfg, _ = user_config()
    st = cfg["settings"]
    if st.get("daily") is False:
        log("Ringkasan harian dimatikan di pengaturan.")
        return
    by = {s["sym"]: s for s in d["stocks"]}
    mk = load_json("makro.json") or {}
    wl = [s for s in cfg["watchlist"] if s in by]
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
    # ---- berita penting (setiap jadwal, termasuk di luar jam bursa & akhir pekan)
    try:
        fresh = important_news(cfg, state, hours=6, today=today)
        if fresh:
            for n in fresh:
                deliver("news", f"📰 {n['sym'] or 'Pasar'}: {', '.join(n['cats'])}", news_lines([n]), n["url"], n["sym"])
            log(f"{len(fresh)} berita penting terkirim.")
        else:
            log("Tidak ada berita penting baru.")
    except Exception as e:  # noqa: BLE001
        log(f"Berita gagal: {e}")
    syms = sorted(set(cfg["watchlist"]) | set(cfg["alerts"].keys()))
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
            msgs.append(text)
    if msgs:
        deliver("alert", "⚡ Alert harga", msgs, SITE)
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
