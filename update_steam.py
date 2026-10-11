#!/usr/bin/env python3
"""Collecte périodiquement les fiches publiques du magasin Steam, région France.

Exécution : python3 update_steam.py
Aucune clé API nécessaire. Les limites et erreurs côté Steam sont possibles ;
une indisponibilité n'est jamais remplacée par un prix approximatif.
"""
import html
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
CATALOGUE = ROOT / "catalogue.json"
DESTINATION = ROOT / "steam-data.json"
AGENT = "GameLab/1.0 (public game wishlist price snapshot)"


def fetch(appid: int):
    query = urlencode({"appids": appid, "cc": "fr", "l": "french"})
    url = f"https://store.steampowered.com/api/appdetails?{query}"
    request = Request(url, headers={"User-Agent": AGENT, "Accept": "application/json"})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=25) as response:
                blob = response.read(2_000_000)
            result = json.loads(blob).get(str(appid), {})
            return result.get("data") if result.get("success") else None
        except (HTTPError, URLError, ValueError, TimeoutError) as exc:
            print(f"  Essai {attempt + 1}/3 raté : {exc}", flush=True)
            if attempt < 2:
                time.sleep(3 * (attempt + 1))
    return None


def clean_text(value, limit=300):
    value = str(value or "")
    value = re.sub(r"<[^>]+>", " ", value)
    return " ".join(html.unescape(value).split())[:limit]


def parse(appid, item, checked_at):
    base = {
        "appid": appid,
        "checkedAt": checked_at,
        "available": False,
        "currency": None,
        "initial": None,
        "final": None,
        "discountPercent": 0,
        "name": clean_text(item.get("name"), 120),
        "shortDescription": clean_text(item.get("short_description"), 500),
        "image": str(item.get("header_image") or ""),
        "developer": clean_text(", ".join(item.get("developers") or []), 140),
        "releaseDate": clean_text((item.get("release_date") or {}).get("date"), 80),
    }
    if item.get("is_free") is True:
        base.update({"available": True, "currency": "EUR", "initial": 0.0, "final": 0.0})
        return base
    price = item.get("price_overview") or {}
    if price.get("currency") == "EUR" and isinstance(price.get("final"), int):
        base.update({
            "available": True, "currency": "EUR",
            "initial": (price.get("initial", price["final"]) / 100),
            "final": price["final"] / 100,
            "discountPercent": int(price.get("discount_percent") or 0)
        })
    return base


def main():
    entries = json.loads(CATALOGUE.read_text(encoding="utf-8"))
    try:
        previous = json.loads(DESTINATION.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        previous = {"updatedAt": None, "games": {}}
    old = previous.get("games") if isinstance(previous.get("games"), dict) else {}
    records = {}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    successful = 0
    for entry in entries:
        appid = entry.get("appid")
        if not isinstance(appid, int) or appid <= 0:
            continue
        print(f"Steam {appid} : {entry['name']}", flush=True)
        data = fetch(appid)
        if data is None:
            # Préserve une information passée et sa vraie date ; ne modifie jamais checkedAt.
            if str(appid) in old:
                records[str(appid)] = old[str(appid)]
            else:
                records[str(appid)] = {"available": False, "checkedAt": None}
            continue
        records[str(appid)] = parse(appid, data, now)
        successful += 1
        time.sleep(1.15)  # politesse : évite une rafale de requêtes
    latest = now if successful else previous.get("updatedAt")
    result = {"source": "Steam Store /api/appdetails?cc=fr", "region": "FR", "updatedAt": latest, "games": records}
    temp = DESTINATION.with_suffix('.json.tmp')
    temp.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temp.replace(DESTINATION)
    print(f"Terminé : {successful} fiches récupérées sur {len(records)} jeux, relevé {latest}")
    if not successful:
        print('ATTENTION : aucun retour Steam ; conserver les prix précédents, vérifier la disponibilité du service.')


if __name__ == "__main__":
    main()
