#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

BASE_DIR = Path(__file__).resolve().parent
SOURCES_FILE = BASE_DIR / "nerudas_sources.txt"
OUT_DIR = BASE_DIR / "out"


def load_sources():
    urls = []
    if not SOURCES_FILE.exists():
        print(f"[parser] Нет файла со ссылками: {SOURCES_FILE}")
        return urls

    with SOURCES_FILE.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            urls.append(line)

    print(f"[parser] Загружено ссылок: {len(urls)}")
    return urls


def fetch_page(url):
    try:
        resp = requests.get(url, timeout=20, headers={"User-Agent": "TransTimeBot"})
        resp.raise_for_status()
        return resp.text
    except Exception as e:
        print(f"[parser] Ошибка загрузки {url}: {e}")
        return None


def parse_frame_page(html, url):
    soup = BeautifulSoup(html, "html.parser")

    frame_id = url.rstrip("/").split("/")[-1]

    # ЗАГЛУШКИ, ПОТОМ ЗАМЕНИМ ПОД РЕАЛЬНЫЕ CSS-селекторы
    lon = None
    lat = None

    coords = soup.select_one(".coords")
    if coords:
        txt = coords.get_text(strip=True)
        parts = txt.replace(" ", "").split(",")
        if len(parts) == 2:
            try:
                lat = float(parts[0])
                lon = float(parts[1])
            except:
                pass

    comment = None
    info = soup.select_one(".frame-info")
    if info:
        comment = info.get_text(" ", strip=True)

    if not comment:
        comment = f"Данные парсера для {url}"

    return {
        "frame_id": frame_id,
        "frame_url": url,
        "lon": lon,
        "lat": lat,
        "comment_human": comment,
        "direction": "both",
        "hgv_access": "unknown"
    }


def feature_from_parsed(p):
    lon = p["lon"]
    lat = p["lat"]

    if lon is None or lat is None:
        print(f"[parser] Пропуск: нет координат {p['frame_id']}")
        return None

    today = datetime.date.today().isoformat()

    return {
        "type": "Feature",
        "id": p["frame_id"],
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": {
            "frame_id": p["frame_id"],
            "frame_url": p["frame_url"],
            "object_type": "frame",
            "hgv_access": p["hgv_access"],
            "direction": p["direction"],
            "comment_human": p["comment_human"],
            "source_type": "parser",
            "source_name": "nerudas",
            "frame_first_seen": today,
            "frame_last_seen": today,
            "frame_is_active": True,
            "tags": ["frame", "nerudas"]
        }
    }


def main():
    print("[parser] Старт")

    urls = load_sources()
    if not urls:
        print("[parser] Нет ссылок, завершение.")
        return

    OUT_DIR.mkdir(exist_ok=True)

    out_path = OUT_DIR / "frames_parsed_latest.geojson"
    features = []

    for url in urls:
        html = fetch_page(url)
        if not html:
            continue

        parsed = parse_frame_page(html, url)
        f = feature_from_parsed(parsed)
        if f:
            features.append(f)

    fc = {"type": "FeatureCollection", "features": features}

    with out_path.open("w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, indent=2)

    print(f"[parser] Готово. Фич: {len(features)}")
    print(f"[parser] Файл: {out_path}")


if __name__ == "__main__":
    main()
