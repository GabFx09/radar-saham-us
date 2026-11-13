#!/usr/bin/env python3
"""
Kabar — kirim pesan & notifikasi push ke aplikasi Kabar dari skrip apa pun.

Pakai sebagai pustaka:
    import kabar
    kabar.kirim("Server mati", "CPU 100% di server-1", saluran="Server", prioritas="tinggi")
    kabar.kirim_banyak([{"judul": "...", "isi": "..."}, ...], saluran="Radar Saham")

Pakai dari terminal:
    python kabar.py "Judul" "Isi pesan" --saluran "Pengingat" --url https://contoh.com --prioritas tinggi

Lingkungan:
    KABAR_TOKEN   token GitHub ber-scope "gist" (wajib) — kotak pesan disimpan di gist rahasia Anda
    KABAR_VAPID   kunci privat VAPID (opsional) — tanpa ini pesan tetap masuk, tapi tanpa notifikasi push
    KABAR_URL     alamat aplikasi (default https://gabfx09.github.io/kabar/)

Format isi: teks biasa. Mendukung **tebal**, _miring_, `kode`, tautan otomatis, dan baris baru.
Untuk HTML sederhana (b, i, a, br, code) pakai argumen html=... (pustaka) atau --html (CLI).
Dependensi: requests, pywebpush (opsional untuk push).
"""
import argparse
import datetime as dt
import json
import os
import sys
import time

import requests

CONFIG_FILE = "kabar-config.json"
MSG_FILE = "kabar-pesan.json"
MAX_MSG = 1500
API = "https://api.github.com"


class KabarError(RuntimeError):
    pass


def _env(name, default=""):
    return (os.getenv(name) or default).strip()


def _gh(token, method, path, **kw):
    r = requests.request(method, API + path, timeout=30, headers={
        "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "User-Agent": "kabar/1.0"}, **kw)
    if r.status_code == 401:
        raise KabarError("KABAR_TOKEN tidak valid atau kedaluwarsa")
    return r


def _find_gist(token):
    for page in range(1, 6):
        r = _gh(token, "GET", f"/gists?per_page=100&page={page}")
        if not r.ok:
            raise KabarError(f"gagal membaca gist: HTTP {r.status_code}")
        items = r.json()
        for g in items:
            if CONFIG_FILE in (g.get("files") or {}):
                return g["id"]
        if len(items) < 100:
            break
    return None


def _create_gist(token):
    cfg = {"v": 1, "devices": [], "channels": {}, "created": _now()}
    r = _gh(token, "POST", "/gists", json={
        "description": "Kabar — kotak pesan pribadi (dibuat otomatis)", "public": False,
        "files": {CONFIG_FILE: {"content": json.dumps(cfg, indent=1)},
                  MSG_FILE: {"content": json.dumps({"messages": []})}}})
    if not r.ok:
        raise KabarError(f"gagal membuat gist: HTTP {r.status_code} {r.text[:120]}")
    return r.json()["id"]


def _read(token, gid):
    r = _gh(token, "GET", f"/gists/{gid}")
    if not r.ok:
        raise KabarError(f"gagal membaca gist: HTTP {r.status_code}")
    files = r.json()["files"]

    def load(name, default):
        f = files.get(name)
        if not f:
            return default
        content = f.get("content")
        if f.get("truncated"):
            content = requests.get(f["raw_url"], timeout=30).text
        try:
            return json.loads(content or "null") or default
        except ValueError:
            return default
    return load(CONFIG_FILE, {"devices": [], "channels": {}}), load(MSG_FILE, {"messages": []})


def _now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def _plain(htm):
    import html as H
    import re
    return H.unescape(re.sub(r"<[^>]+>", "", htm or ""))


def _quiet_now(q):
    """True bila sekarang berada di jam tenang pengguna (diatur di Setelan aplikasi)."""
    if not q or not q.get("on"):
        return False
    try:
        from zoneinfo import ZoneInfo
        h = dt.datetime.now(ZoneInfo(q.get("tz") or "UTC")).hour
    except Exception:  # noqa: BLE001
        h = dt.datetime.now(dt.timezone.utc).hour
    a, b = int(q.get("from", 22)), int(q.get("to", 6))
    return (a <= h < b) if a < b else (h >= a or h < b)


def _origin(url):
    """Klaim VAPID "sub" harus mailto: atau URL https tanpa path."""
    from urllib.parse import urlparse
    u = urlparse(url)
    return f"{u.scheme}://{u.netloc}"


def _push(cfg, msgs, saluran, vapid, app_url):
    """Kirim notifikasi push ke semua perangkat terdaftar. Mengembalikan endpoint yang sudah mati."""
    devices = [d for d in cfg.get("devices") or [] if d.get("endpoint")]
    if not devices or not vapid or not msgs:
        return set()
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        print("kabar: pywebpush belum terpasang — `pip install pywebpush` untuk notifikasi push", file=sys.stderr)
        return set()
    ch = (cfg.get("channels") or {}).get(saluran) or {}
    urgent = any(m.get("prio") == "tinggi" for m in msgs)
    if ch.get("mute") and not urgent:
        return set()
    if _quiet_now(cfg.get("quiet")) and not urgent:
        print("kabar: jam tenang — pesan disimpan tanpa notifikasi", file=sys.stderr)
        return set()
    last = msgs[-1]
    if len(msgs) == 1:
        title = f"{saluran} · {last['title']}" if last.get("title") else saluran
        body = (_plain(last.get("html")) or last.get("text") or "").replace("\n", " ")[:220]
    else:
        title = f"{saluran} · {len(msgs)} pesan baru"
        body = " · ".join(m.get("title") or (m.get("text") or "")[:40] for m in msgs)[:220]
    payload = json.dumps({"title": title, "body": body, "tag": f"kabar-{saluran}", "url": f"{app_url}#/c/{requests.utils.quote(saluran)}",
                          "prio": "tinggi" if urgent else "normal"})
    dead = set()
    for d in devices:
        try:
            webpush(subscription_info={"endpoint": d["endpoint"], "keys": d.get("keys") or {}}, data=payload,
                    vapid_private_key=vapid, vapid_claims={"sub": _origin(app_url)}, ttl=86400,
                    headers={"Urgency": "high" if urgent else "normal"})
        except WebPushException as e:
            code = getattr(e.response, "status_code", None)
            if code in (404, 410):
                dead.add(d["endpoint"])
            else:
                print(f"kabar: push ke {d.get('name', 'perangkat')} gagal ({code})", file=sys.stderr)
        except Exception as e:  # noqa: BLE001
            print(f"kabar: push gagal: {e}", file=sys.stderr)
    return dead


def kirim_banyak(pesan, saluran="Umum", token=None, vapid=None, app_url=None, push=True):
    """Kirim beberapa pesan sekaligus (satu tulis ke gist, satu notifikasi ringkas).

    pesan: list dict dengan kunci judul, isi (teks) atau html, url, prioritas ("normal"/"tinggi").
    """
    token = token or _env("KABAR_TOKEN")
    vapid = vapid if vapid is not None else _env("KABAR_VAPID")
    app_url = (app_url or _env("KABAR_URL", "https://gabfx09.github.io/kabar/")).rstrip("/") + "/"
    if not token:
        raise KabarError("KABAR_TOKEN belum diatur (token GitHub ber-scope gist)")
    if not pesan:
        return []
    gid = _find_gist(token) or _create_gist(token)
    new = []
    base = int(time.time() * 1000)
    for i, p in enumerate(pesan):
        m = {"id": f"{base}{i:03d}", "t": _now(), "ch": saluran, "from": "bot",
             "title": (p.get("judul") or "").strip()[:200], "prio": p.get("prioritas", "normal")}
        if p.get("html"):
            m["html"] = p["html"]
        else:
            m["text"] = str(p.get("isi") or "")[:6000]
        if p.get("url"):
            m["url"] = p["url"]
        new.append(m)
    for attempt in range(3):  # baca-ubah-tulis dengan ulangan sederhana
        cfg, box = _read(token, gid)
        msgs = (box.get("messages") or []) + new
        box = {"messages": msgs[-MAX_MSG:], "updated": _now()}
        files = {MSG_FILE: {"content": json.dumps(box, ensure_ascii=False)}}
        dead = _push(cfg, new, saluran, vapid, app_url) if push and attempt == 0 else set()
        if dead:
            cfg["devices"] = [d for d in cfg.get("devices") or [] if d.get("endpoint") not in dead]
            files[CONFIG_FILE] = {"content": json.dumps(cfg, indent=1)}
        r = _gh(token, "PATCH", f"/gists/{gid}", json={"files": files})
        if r.ok:
            return new
        time.sleep(1.5 * (attempt + 1))
    raise KabarError(f"gagal menulis pesan: HTTP {r.status_code}")


def kirim(judul, isi="", saluran="Umum", url=None, html=None, prioritas="normal", **kw):
    """Kirim satu pesan. Contoh: kirim("Backup selesai", "1,2 GB · 3 menit", saluran="Server")."""
    return kirim_banyak([{"judul": judul, "isi": isi, "html": html, "url": url, "prioritas": prioritas}], saluran=saluran, **kw)[0]


def main():
    ap = argparse.ArgumentParser(description="Kirim pesan ke aplikasi Kabar")
    ap.add_argument("judul")
    ap.add_argument("isi", nargs="?", default="")
    ap.add_argument("--saluran", "-s", default="Umum", help="nama chat/saluran tujuan (default: Umum)")
    ap.add_argument("--url", "-u")
    ap.add_argument("--html", action="store_true", help="perlakukan isi sebagai HTML sederhana")
    ap.add_argument("--prioritas", "-p", choices=["normal", "tinggi"], default="normal",
                    help="tinggi = tetap bunyi walau saluran dibisukan")
    ap.add_argument("--tanpa-push", action="store_true", help="simpan pesan tanpa notifikasi push")
    a = ap.parse_args()
    isi = a.isi if a.isi != "-" else sys.stdin.read()
    try:
        m = kirim(a.judul, "" if a.html else isi, saluran=a.saluran, url=a.url, html=isi if a.html else None,
                  prioritas=a.prioritas, push=not a.tanpa_push)
    except KabarError as e:
        print(f"kabar: {e}", file=sys.stderr)
        sys.exit(1)
    print(f"terkirim ke '{a.saluran}' (id {m['id']})")


if __name__ == "__main__":
    main()
