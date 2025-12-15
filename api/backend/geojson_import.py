# api/backend/geojson_import.py
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict

from sqlalchemy import delete

from db import engine, SessionLocal, Base
from models import FrameRaw


def get_geojson_path() -> Path:
    # 1) если передали аргументом — берём его
    if len(sys.argv) >= 2:
        return Path(sys.argv[1]).resolve()

    # 2) иначе по умолчанию берём результат парсера
    return (Path(__file__).resolve().parent / "out" / "frames_parsed_latest.geojson").resolve()


def normalize_feature(feature: Dict[str, Any]) -> Dict[str, Any]:
    props = feature.get("properties") or {}
    geom = feature.get("geometry") or {}
    coords = geom.get("coordinates") or [None, None]

    external_id = props.get("id") or feature.get("id") or props.get("external_id") or ""
    external_id = str(external_id)[:64] if external_id else "unknown"

    lon = None
    lat = None
    if isinstance(coords, list) and len(coords) >= 2:
        lon = coords[0]
        lat = coords[1]

    return {
        "external_id": external_id,
        "source_url": props.get("source_url") or props.get("url"),
        "source": props.get("source") or "nerudas.ru",
        "title": props.get("title") or props.get("name"),
        "comment": props.get("comment") or props.get("description"),
        "lon": lon,
        "lat": lat,
        "height_m": props.get("height_m") or props.get("height"),
        "width_m": props.get("width_m") or props.get("width"),
        "weight_t": props.get("weight_t") or props.get("weight"),
        "raw_json": json.dumps(feature, ensure_ascii=False),
    }


def main():
    print("[import] Создаем таблицы, если их ещё нет...")
    Base.metadata.create_all(bind=engine)

    path = get_geojson_path()
    print(f"[import] GeoJSON путь: {path}")

    if not path.exists():
        raise FileNotFoundError(f"GeoJSON не найден: {path}")

    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("type") != "FeatureCollection":
        raise ValueError("Ожидался GeoJSON FeatureCollection")

    features = data.get("features") or []
    print(f"[import] Найдено объектов: {len(features)}")

    with SessionLocal() as db:
        # очищаем raw слой перед новой загрузкой (manual/suggestions будут в других таблицах позже)
        db.execute(delete(FrameRaw))
        db.commit()

        added = 0
        for f in features:
            row = normalize_feature(f)
            db.add(FrameRaw(**row))
            added += 1

        db.commit()

    print(f"[import] Импорт завершен. Добавлено: {added}")


if __name__ == "__main__":
    main()
