# api/backend/geojson_import.py
import json
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from config import FRAMES_GEOJSON_PATH
from db import engine, SessionLocal, Base
from models import FrameRaw


def import_frames_from_geojson():
    path = Path(FRAMES_GEOJSON_PATH)

    print(f"[import] Ожидаем GeoJSON по пути: {path}")
    if not path.exists():
        raise FileNotFoundError(f"Файл frames_ready.geojson не найден по пути: {path}")

    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    print(f"[import] Найдено объектов: {len(features)}")

    db: Session = SessionLocal()

    try:
        # На первый запуск просто очищаем таблицу raw
        deleted = db.query(FrameRaw).delete()
        print(f"[import] Очищено старых записей frames_raw: {deleted}")
        db.commit()

        now = datetime.utcnow()

        added = 0
        skipped = 0

        for feature in features:
            geom = feature.get("geometry") or {}
            props = feature.get("properties") or {}

            coords = geom.get("coordinates") or [None, None]
            if not isinstance(coords, (list, tuple)) or len(coords) < 2:
                skipped += 1
                continue

            lon, lat = coords[0], coords[1]

            frame_id = props.get("frame_id") or feature.get("id")
            if frame_id is None or lon is None or lat is None:
                skipped += 1
                continue

            time_windows = props.get("time_windows")
            tags = props.get("tags")

            fr = FrameRaw(
                frame_id=frame_id,
                frame_url=props.get("frame_url"),

                lon=float(lon),
                lat=float(lat),

                road_id=props.get("road_id"),
                road_name=props.get("road_name"),
                clazz=props.get("class"),
                object_type=props.get("object_type"),
                hgv_access=props.get("hgv_access"),
                weight_limit_tons=props.get("weight_limit_tons"),
                axle_load_tons=props.get("axle_load_tons"),
                time_windows=json.dumps(time_windows) if time_windows is not None else None,
                valid_from=props.get("valid_from"),
                valid_to=props.get("valid_to"),
                direction=props.get("direction"),

                source_type=props.get("source_type"),
                source_name=props.get("source_name"),

                comment_raw=props.get("comment_raw"),
                comment_human=props.get("comment_human"),
                priority=props.get("priority"),
                tags=json.dumps(tags) if tags is not None else None,

                frame_row_id_raw=props.get("frame_row_id_raw"),
                frame_status_raw=props.get("frame_status_raw"),
                frame_error_raw=props.get("frame_error_raw"),
                frame_state=props.get("frame_state"),

                frame_first_seen=props.get("frame_first_seen"),
                frame_last_seen=props.get("frame_last_seen"),
                frame_is_active=bool(props.get("frame_is_active")) if props.get("frame_is_active") is not None else True,
                frame_change_type=props.get("frame_change_type"),

                created_at=now,
                updated_at=now,
            )

            db.add(fr)
            added += 1

        db.commit()
        print(f"[import] Импорт завершен. Добавлено: {added}, пропущено: {skipped}")

    finally:
        db.close()


if __name__ == "__main__":
    print("[import] Создаем таблицы, если их ещё нет...")
    Base.metadata.create_all(bind=engine)
    import_frames_from_geojson()
