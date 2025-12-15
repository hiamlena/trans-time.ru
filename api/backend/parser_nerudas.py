# api/backend/parser_nerudas.py
import json
import re
import time
from pathlib import Path
from typing import Dict, Any, List, Optional

import requests
from bs4 import BeautifulSoup

BASE = "https://nerudas.ru"
SOURCES_FILE = Path(__file__).with_name("nerudas_sources.txt")
OUT_DIR = Path(__file__).with_name("out")
OUT_FILE = OUT_DIR / "frames_parsed_latest.geojson"

HEADERS = {
    "User-Agent": "Trans-TimeBot/1.0 (+https://trans-time.ru)",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
}

def read_sources() -> List[str]:
    if not SOURCES_FILE.exists():
        raise FileNotFoundError(f"Нет файла со ссылками: {SOURCES_FILE}")
    urls = []
    for line in SOURCES_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        urls.append(line)
    if not urls:
        raise RuntimeError("nerudas_sources.txt пустой — добавь ссылки на рамки.")
    return urls

def extract_id(url: str) -> str:
    # берём числовую часть из .../apvk/10233-.... или .../spvk/4146-....
    m = re.search(r"/(apvk|spvk)/(\d+)", url)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    # запасной вариант
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", url).strip("-")[:80]

def safe_float(x: str) -> Optional[float]:
    try:
        return float(x.replace(",", "."))
    except Exception:
        return None

def guess_coords(text: str) -> Optional[List[float]]:
    # Пытаемся выцепить "55.12345, 37.12345" или "55.12345 37.12345"
    # (Если на сайте координаты не явные — вернём None)
    m = re.search(r"(\d{2}\.\d+)\s*[, ]\s*(\d{2}\.\d+)", text)
    if not m:
        return None
    lat = safe_float(m.group(1))
    lon = safe_float(m.group(2))
    if lat is None or lon is None:
        return None
    # GeoJSON: [lon, lat]
    return [lon, lat]

def parse_page(url: str) -> Dict[str, Any]:
    r = requests.get(url, headers=HEADERS, timeout=25)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")

    title = (soup.find("h1").get_text(" ", strip=True) if soup.find("h1") else "").strip()
    page_text = soup.get_text("\n", strip=True)

    # Комментарий/описание: берём первые осмысленные куски текста со страницы
    # (потом улучшим под реальную верстку)
    comment = ""
    # попытка найти блок статьи
    article = soup.find("article") or soup.find("div", class_=re.compile("content|entry|post", re.I))
    if article:
        comment = article.get_text("\n", strip=True)
    else:
        comment = page_text

    # Координаты (если есть на странице)
    coords = guess_coords(page_text)

    return {
        "title": title or url,
        "comment": comment[:2000],  # ограничим размер, чтобы geojson не раздувать
        "coords": coords,
    }

def build_feature(url: str, data: Dict[str, Any]) -> Dict[str, Any]:
    fid = extract_id(url)
    coords = data.get("coords") or [37.6173, 55.7558]  # fallback: Москва (чтобы geojson был валидный)
    props = {
        "id": fid,
        "source_url": url,
        "title": data.get("title", ""),
        "comment": data.get("comment", ""),
        "source": "nerudas.ru",
    }
    return {
        "type": "Feature",
        "id": fid,
        "geometry": {"type": "Point", "coordinates": coords},
        "properties": props,
    }

def main():
    OUT_DIR.mkdir(exist_ok=True)
    urls = read_sources()
    features = []
    errors = 0

    for i, url in enumerate(urls, 1):
        try:
            data = parse_page(url)
            features.append(build_feature(url, data))
        except Exception as e:
            errors += 1
            # всё равно добавим feature, чтобы не терять рамку
            features.append(build_feature(url, {"title": url, "comment": f"PARSE_ERROR: {e}", "coords": None}))
        time.sleep(0.4)

        if i % 25 == 0:
            print(f"[parser] processed {i}/{len(urls)}")

    fc = {"type": "FeatureCollection", "features": features}
    OUT_FILE.write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
    print(f"[parser] done. features={len(features)} errors={errors}")
    print(f"[parser] wrote: {OUT_FILE}")

if __name__ == "__main__":
    main()
