#!/usr/bin/env python3
"""
Kabar — kirim pesan & notifikasi push ke aplikasi Kabar dari skrip apa pun.

Pustaka:
    import kabar
    kabar.kirim("Server mati", "CPU 100% di server-1", saluran="Server", prioritas="tinggi")
    m = kabar.kirim("Deploy ke produksi?", "versi 2.4.1", saluran="Deploy", tombol=["Lanjut", "Batal"])
    jawab = kabar.tunggu_jawaban(m["id"], batas_detik=600)      # -> "Lanjut" / "Batal" / None
    kabar.kirim("Grafik harian", "lihat lampiran", saluran="Laporan", gambar="grafik.png")
    kabar.kirim_banyak([{"judul": "...", "isi": "..."}, ...], saluran="Radar Saham")

Terminal:
    python kabar.py "Judul" "Isi" --saluran Server --prioritas tinggi --tombol "Ya,Tidak" --gambar foto.jpg
    python kabar.py --jalankan-pengingat        # dipanggil workflow terjadwal (pengingat dari aplikasi)

Lingkungan:
    KABAR_TOKEN   token GitHub ber-scope "gist" (wajib)
    KABAR_VAPID   kunci privat VAPID untuk notifikasi push (opsional)
    KABAR_KUNCI   kata sandi enkripsi (wajib bila enkripsi diaktifkan di aplikasi)
    KABAR_URL     alamat aplikasi (default https://gabfx09.github.io/kabar/)

Format isi: teks biasa dengan **tebal**, _miring_, `kode`, tautan otomatis; atau html=... (b, i, a, br, code).
Dependensi: requests; pywebpush (push); cryptography (enkripsi & push).
"""
import argparse
import base64
import datetime as dt
import json
import mimetypes
import os
import sys
import time

import requests

CONFIG_FILE = "kabar-config.json"
MSG_FILE = "kabar-pesan.json"
MAX_MSG = 1500
MAX_IMG = 600 * 1024
API = "https://api.github.com"


class KabarError(RuntimeError):
    pass


def _env(name, default=""):
    return (os.getenv(name) or default).strip()


def _now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def _b64(b):
    return base64.b64encode(b).decode()


def _gh(token, method, path, **kw):
    r = requests.request(method, API + path, timeout=30, headers={
        "Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "User-Agent": "kabar/2.0"}, **kw)
    if r.status_code == 401:
        raise KabarError("KABAR_TOKEN tidak valid atau kedaluwarsa")
    return r


# ----------------------------------------------------------------------------- gist
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
        "files": {CONFIG_FILE: {"content": json.dumps(cfg, indent=1)}, MSG_FILE: {"content": json.dumps({"messages": []})}}})
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


def _gist_id(token):
    return _find_gist(token) or _create_gist(token)


# ----------------------------------------------------------------------------- enkripsi (AES-256-GCM, PBKDF2)
def _key(cfg, kunci):
    """Kunci AES dari kata sandi; None bila enkripsi tidak aktif. Galat bila aktif tapi kata sandi salah/tidak ada."""
    c = cfg.get("crypto")
    if not c:
        return None
    if not kunci:
        raise KabarError("enkripsi aktif di aplikasi — set KABAR_KUNCI (kata sandi enkripsi)")
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    kdf = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=base64.b64decode(c["salt"]), iterations=int(c.get("iter", 200000)))
    key = kdf.derive(kunci.encode())
    if c.get("check") and _dec(key, c["check"]) != {"ok": "kabar"}:
        raise KabarError("KABAR_KUNCI salah (tidak cocok dengan kata sandi di aplikasi)")
    return key


def _enc(key, obj):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    iv = os.urandom(12)
    return {"iv": _b64(iv), "ct": _b64(AESGCM(key).encrypt(iv, json.dumps(obj, ensure_ascii=False).encode(), None))}


def _dec(key, e):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    try:
        return json.loads(AESGCM(key).decrypt(base64.b64decode(e["iv"]), base64.b64decode(e["ct"]), None))
    except Exception:  # noqa: BLE001
        return None


# ----------------------------------------------------------------------------- push
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


def _plain(htm):
    import html as H
    import re
    return H.unescape(re.sub(r"<[^>]+>", "", htm or ""))


def _push(cfg, previews, saluran, vapid, app_url, urgent):
    """Kirim notifikasi push ke semua perangkat. previews: [(judul, teks)]. Mengembalikan endpoint yang mati."""
    devices = [d for d in cfg.get("devices") or [] if d.get("endpoint")]
    if not devices or not vapid or not previews:
        return set()
    try:
        from pywebpush import WebPushException, webpush
    except ImportError:
        print("kabar: pywebpush belum terpasang — `pip install pywebpush` untuk notifikasi push", file=sys.stderr)
        return set()
    ch = (cfg.get("channels") or {}).get(saluran) or {}
    if ch.get("mute") and not urgent:
        return set()
    if _quiet_now(cfg.get("quiet")) and not urgent:
        print("kabar: jam tenang — pesan disimpan tanpa notifikasi", file=sys.stderr)
        return set()
    if len(previews) == 1:
        j, t = previews[0]
        title, body = (f"{saluran} · {j}" if j else saluran), (t or "").replace("\n", " ")[:220]
    else:
        title = f"{saluran} · {len(previews)} pesan baru"
        body = " · ".join(j or (t or "")[:40] for j, t in previews)[:220]
    payload = json.dumps({"title": title, "body": body, "tag": f"kabar-{saluran}", "prio": "tinggi" if urgent else "normal",
                          "url": f"{app_url}#/c/{requests.utils.quote(saluran)}"})
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


# ----------------------------------------------------------------------------- kirim
def _image_payload(gambar):
    """URL gambar dipakai langsung; berkas lokal disimpan sebagai lampiran (data URL) di gist."""
    if not gambar:
        return None, None
    if str(gambar).startswith(("http://", "https://")):
        return gambar, None
    with open(gambar, "rb") as fh:
        data = fh.read()
    if len(data) > MAX_IMG:
        raise KabarError(f"gambar terlalu besar ({len(data) // 1024} KB, maks {MAX_IMG // 1024} KB)")
    mime = mimetypes.guess_type(gambar)[0] or "image/png"
    return None, f"data:{mime};base64,{_b64(data)}"


def kirim_banyak(pesan, saluran="Umum", token=None, vapid=None, kunci=None, app_url=None, push=True):
    """Kirim beberapa pesan sekaligus (satu tulis ke gist, satu notifikasi ringkas).

    pesan: list dict — judul, isi | html, url, prioritas ("normal"/"tinggi"), tombol (list label), gambar (URL/berkas).
    Mengembalikan pesan yang tersimpan (berisi "id" untuk tunggu_jawaban).
    """
    token = token or _env("KABAR_TOKEN")
    vapid = vapid if vapid is not None else _env("KABAR_VAPID")
    kunci = kunci if kunci is not None else _env("KABAR_KUNCI")
    app_url = (app_url or _env("KABAR_URL", "https://gabfx09.github.io/kabar/")).rstrip("/") + "/"
    if not token:
        raise KabarError("KABAR_TOKEN belum diatur (token GitHub ber-scope gist)")
    if not pesan:
        return []
    gid = _gist_id(token)
    cfg0, _ = _read(token, gid)
    key = _key(cfg0, kunci)
    new, attach, previews = [], {}, []
    base = int(time.time() * 1000)
    for i, p in enumerate(pesan):
        mid = f"{base}{i:03d}"
        body = {"title": (p.get("judul") or "").strip()[:200]}
        if p.get("html"):
            body["html"] = p["html"]
        else:
            body["text"] = str(p.get("isi") or "")[:6000]
        if p.get("url"):
            body["url"] = p["url"]
        if p.get("tombol"):
            body["btn"] = [str(b)[:40] for b in p["tombol"]][:4]
        img_url, img_data = _image_payload(p.get("gambar"))
        if img_url:
            body["img"] = img_url
        if img_data:
            fname = f"kabar-lampiran-{mid}.txt"
            attach[fname] = {"content": json.dumps(_enc(key, {"data": img_data}) if key else {"data": img_data})}
            body["img"] = "gist:" + fname
        m = {"id": mid, "t": _now(), "ch": saluran, "from": "bot", "prio": p.get("prioritas", "normal")}
        if key:
            m["enc"] = _enc(key, body)
        else:
            m.update(body)
        new.append(m)
        previews.append((body["title"], _plain(body.get("html")) or body.get("text", "")))
    urgent = any(m.get("prio") == "tinggi" for m in new)
    for attempt in range(3):  # baca-ubah-tulis dengan ulangan sederhana
        cfg, box = _read(token, gid)
        box = {"messages": ((box.get("messages") or []) + new)[-MAX_MSG:], "updated": _now()}
        files = {MSG_FILE: {"content": json.dumps(box, ensure_ascii=False)}, **attach}
        dead = _push(cfg, previews, saluran, vapid, app_url, urgent) if push and attempt == 0 else set()
        if dead:
            cfg["devices"] = [d for d in cfg.get("devices") or [] if d.get("endpoint") not in dead]
            files[CONFIG_FILE] = {"content": json.dumps(cfg, indent=1)}
        r = _gh(token, "PATCH", f"/gists/{gid}", json={"files": files})
        if r.ok:
            return new
        time.sleep(1.5 * (attempt + 1))
    raise KabarError(f"gagal menulis pesan: HTTP {r.status_code}")


def kirim(judul, isi="", saluran="Umum", url=None, html=None, prioritas="normal", tombol=None, gambar=None, **kw):
    """Kirim satu pesan. Contoh: kirim("Backup selesai", "1,2 GB · 3 menit", saluran="Server")."""
    return kirim_banyak([{"judul": judul, "isi": isi, "html": html, "url": url, "prioritas": prioritas,
                          "tombol": tombol, "gambar": gambar}], saluran=saluran, **kw)[0]


# ----------------------------------------------------------------------------- jawaban tombol
def jawaban(pesan_id, token=None):
    """Label tombol yang diketuk pengguna untuk pesan ini, atau None."""
    token = token or _env("KABAR_TOKEN")
    _, box = _read(token, _gist_id(token))
    for m in box.get("messages") or []:
        if m.get("id") == pesan_id:
            return (m.get("resp") or {}).get("a")
    return None


def tunggu_jawaban(pesan_id, batas_detik=600, jeda=15, token=None):
    """Tunggu sampai pengguna mengetuk tombol (atau batas waktu habis -> None)."""
    akhir = time.time() + batas_detik
    while time.time() < akhir:
        a = jawaban(pesan_id, token)
        if a:
            return a
        time.sleep(jeda)
    return None


# ----------------------------------------------------------------------------- pengingat terjadwal
def _next_at(at, repeat):
    t = dt.datetime.fromisoformat(at.replace("Z", "+00:00"))
    step = {"harian": dt.timedelta(days=1), "mingguan": dt.timedelta(days=7)}.get(repeat)
    if not step:
        return None
    now = dt.datetime.now(dt.timezone.utc)
    while t <= now:
        t += step
    return t.isoformat(timespec="seconds")


def jalankan_pengingat(token=None, vapid=None, app_url=None):
    """Kirim pengingat yang sudah jatuh tempo (dibuat lewat /ingatkan di aplikasi). Dipanggil workflow terjadwal."""
    token = token or _env("KABAR_TOKEN")
    vapid = vapid if vapid is not None else _env("KABAR_VAPID")
    app_url = (app_url or _env("KABAR_URL", "https://gabfx09.github.io/kabar/")).rstrip("/") + "/"
    if not token:
        raise KabarError("KABAR_TOKEN belum diatur")
    gid = _gist_id(token)
    cfg, box = _read(token, gid)
    now = dt.datetime.now(dt.timezone.utc)
    due, keep = [], []
    for r in cfg.get("reminders") or []:
        try:
            at = dt.datetime.fromisoformat(r["at"].replace("Z", "+00:00"))
        except Exception:  # noqa: BLE001
            continue
        if at <= now:
            due.append(r)
            nxt = _next_at(r["at"], r.get("repeat"))
            if nxt:
                keep.append({**r, "at": nxt})
        else:
            keep.append(r)
    if not due:
        print("kabar: tidak ada pengingat jatuh tempo")
        return 0
    base = int(time.time() * 1000)
    new, by_ch = [], {}
    for i, r in enumerate(due):
        m = {"id": f"{base}{i:03d}", "t": _now(), "ch": r.get("ch") or "Pengingat", "from": "bot", "prio": r.get("prio", "normal"), "rem": r.get("id")}
        if r.get("enc"):
            m["enc"] = r["enc"]  # isi terenkripsi diteruskan apa adanya — server tidak perlu kata sandi
            prev = ("⏰ Pengingat", "Ketuk untuk membuka")
        else:
            m.update({"title": "⏰ Pengingat", "text": r.get("text", ""), "btn": ["Selesai", "Tunda 1 jam"]})
            prev = ("⏰ Pengingat", r.get("text", ""))
        new.append(m)
        by_ch.setdefault(m["ch"], []).append(prev)
    box = {"messages": ((box.get("messages") or []) + new)[-MAX_MSG:], "updated": _now()}
    cfg["reminders"] = keep
    dead = set()
    for ch, prevs in by_ch.items():
        dead |= _push(cfg, prevs, ch, vapid, app_url, any(r.get("prio") == "tinggi" for r in due if (r.get("ch") or "Pengingat") == ch))
    if dead:
        cfg["devices"] = [d for d in cfg.get("devices") or [] if d.get("endpoint") not in dead]
    r = _gh(token, "PATCH", f"/gists/{gid}", json={"files": {MSG_FILE: {"content": json.dumps(box, ensure_ascii=False)},
                                                             CONFIG_FILE: {"content": json.dumps(cfg, indent=1)}}})
    if not r.ok:
        raise KabarError(f"gagal menulis: HTTP {r.status_code}")
    print(f"kabar: {len(due)} pengingat terkirim")
    return len(due)


# ----------------------------------------------------------------------------- CLI
def main():
    ap = argparse.ArgumentParser(description="Kirim pesan ke aplikasi Kabar")
    ap.add_argument("judul", nargs="?")
    ap.add_argument("isi", nargs="?", default="", help='isi pesan; "-" = baca dari stdin')
    ap.add_argument("--saluran", "-s", default="Umum", help="nama chat/saluran tujuan (default: Umum)")
    ap.add_argument("--url", "-u")
    ap.add_argument("--html", action="store_true", help="perlakukan isi sebagai HTML sederhana")
    ap.add_argument("--prioritas", "-p", choices=["normal", "tinggi"], default="normal",
                    help="tinggi = tetap bunyi walau saluran dibisukan / jam tenang")
    ap.add_argument("--tombol", "-t", help='tombol aksi dipisah koma, mis. "Setuju,Tolak"')
    ap.add_argument("--gambar", "-g", help="URL gambar atau berkas lokal (maks 600 KB)")
    ap.add_argument("--tunggu", type=int, default=0, help="tunggu jawaban tombol hingga N detik, cetak jawabannya")
    ap.add_argument("--tanpa-push", action="store_true", help="simpan pesan tanpa notifikasi push")
    ap.add_argument("--jalankan-pengingat", action="store_true", help="kirim pengingat yang jatuh tempo")
    a = ap.parse_args()
    try:
        if a.jalankan_pengingat:
            jalankan_pengingat()
            return
        if not a.judul:
            ap.error("judul wajib diisi")
        isi = sys.stdin.read() if a.isi == "-" else a.isi
        m = kirim(a.judul, "" if a.html else isi, saluran=a.saluran, url=a.url, html=isi if a.html else None,
                  prioritas=a.prioritas, tombol=[x.strip() for x in a.tombol.split(",") if x.strip()] if a.tombol else None,
                  gambar=a.gambar, push=not a.tanpa_push)
        print(f"terkirim ke '{a.saluran}' (id {m['id']})")
        if a.tunggu:
            jw = tunggu_jawaban(m["id"], batas_detik=a.tunggu)
            print(f"jawaban: {jw}" if jw else "jawaban: (tidak ada)")
            sys.exit(0 if jw else 2)
    except KabarError as e:
        print(f"kabar: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
