import json
import sys
from pathlib import Path

from db import engine, SessionLocal
from models import Base, FrameRaw


def main():
    Base.metadata.create_all(bind=engine)

    if len(sys.argv) > 1:
        geo_path = Path(sys.argv[1])
    else:
        print("Использование: python geojson_import.py path/to/file.geojson")
        return

    if not geo_path.exists():
        print("[import] Файл не найден")
        return

    with geo_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])
    print(f"[import] Загружено объектов: {len(features)}")

    db = SessionLocal()

    for feat in features:
        props = feat["properties"]
        geom = feat["geometry"]

        frame_id = props["frame_id"]
        lon, lat = geom["coordinates"]

        row = db.query(FrameRaw).filter(FrameRaw.frame_id == frame_id).first()

        if not row:
            row = FrameRaw(frame_id=frame_id)

        row.lon = lon
        row.lat = lat
        row.comment_human = props.get("comment_human")
        row.frame_url = props.get("frame_url")
        row.hgv_access = props.get("hgv_access")
        row.direction = props.get("direction")
        row.frame_first_seen = props.get("frame_first_seen")
        row.frame_last_seen = props.get("frame_last_seen")
        row.frame_is_active = props.get("frame_is_active")

        db.merge(row)

    db.commit()
    db.close()

    print("[import] Импорт завершён.")


if __name__ == "__main__":
    main()
