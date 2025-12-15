# api/backend/app_flask.py
import json
from datetime import datetime
from typing import Dict, Optional, List

from flask import Flask, jsonify, request, abort

from db import SessionLocal

# --- модели: FrameManual может отсутствовать в models.py на текущем шаге ---
try:
    from models import FrameRaw, FrameManual, FrameSuggestion  # type: ignore
except Exception:
    from models import FrameRaw, FrameSuggestion  # type: ignore
    FrameManual = None  # временно: manual-слой подключим на следующем шаге

app = Flask(__name__)


@app.route("/health")
def health():
    return jsonify({"status": "ok"})


# ---------- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ----------

def _parse_json_field(text: Optional[str], default):
    if not text:
        return default
    try:
        return json.loads(text)
    except Exception:
        return default


def _getattr(obj, name: str, default=None):
    return getattr(obj, name, default)


def _merge_raw_and_manual(raw, manual):
    """Склеиваем данные raw + manual в один Feature.
       Если manual нет — просто отдаём raw.
    """

    def pick(override, base):
        return override if override is not None else base

    # координаты
    lon = pick(_getattr(manual, "lon_override", None), _getattr(raw, "lon", None))
    lat = pick(_getattr(manual, "lat_override", None), _getattr(raw, "lat", None))

    # time_windows и tags
    time_windows = _parse_json_field(
        _getattr(manual, "time_windows_override", None) if manual and _getattr(manual, "time_windows_override", None) is not None
        else _getattr(raw, "time_windows", None),
        default=[]
    )

    tags_raw = _parse_json_field(_getattr(raw, "tags", None), default=[])
    tags_admin = _parse_json_field(_getattr(manual, "tags_admin", None), default=[]) if manual else []
    tags = list(dict.fromkeys(tags_raw + tags_admin))

    properties = {
        "road_id": pick(_getattr(manual, "road_id_override", None), _getattr(raw, "road_id", None)),
        "road_name": pick(_getattr(manual, "road_name_override", None), _getattr(raw, "road_name", None)),
        "class": pick(_getattr(manual, "clazz_override", None), _getattr(raw, "clazz", None)),
        "object_type": _getattr(raw, "object_type", "frame"),
        "hgv_access": pick(_getattr(manual, "hgv_access_override", None), _getattr(raw, "hgv_access", None)),
        "weight_limit_tons": pick(_getattr(manual, "weight_limit_tons_override", None), _getattr(raw, "weight_limit_tons", None)),
        "axle_load_tons": pick(_getattr(manual, "axle_load_tons_override", None), _getattr(raw, "axle_load_tons", None)),
        "time_windows": time_windows,
        "valid_from": pick(_getattr(manual, "valid_from_override", None), _getattr(raw, "valid_from", None)),
        "valid_to": pick(_getattr(manual, "valid_to_override", None), _getattr(raw, "valid_to", None)),
        "direction": pick(_getattr(manual, "direction_override", None), _getattr(raw, "direction", None)),
        "source_type": _getattr(raw, "source_type", None),
        "source_name": _getattr(raw, "source_name", None),
        "priority": _getattr(raw, "priority", None),
        "tags": tags,

        "frame_id": _getattr(raw, "frame_id", None),
        "frame_row_id_raw": _getattr(raw, "frame_row_id_raw", None),
        "frame_url": _getattr(raw, "frame_url", None),
        "frame_status_raw": _getattr(raw, "frame_status_raw", None),
        "frame_error_raw": _getattr(raw, "frame_error_raw", None),

        "frame_state": pick(_getattr(manual, "frame_state_override", None), _getattr(raw, "frame_state", None)),
        "frame_first_seen": _getattr(raw, "frame_first_seen", None),
        "frame_last_seen": _getattr(raw, "frame_last_seen", None),
        "frame_is_active": bool(_getattr(raw, "frame_is_active", True)),
        "frame_change_type": _getattr(raw, "frame_change_type", None),
    }

    # комментарии
    comment_raw = _getattr(raw, "comment_raw", "") or ""
    comment_human_raw = _getattr(raw, "comment_human", None)
    comment_admin = _getattr(manual, "comment_admin", None) if manual else None

    if comment_admin:
        base_human = comment_human_raw or ""
        human = f"{base_human} Комментарий администратора: {comment_admin}".strip() if base_human else f"Комментарий администратора: {comment_admin}"
    else:
        human = comment_human_raw

    properties["comment_raw"] = comment_raw
    properties["comment_human"] = human

    return {
        "type": "Feature",
        "id": _getattr(raw, "frame_id", None),
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": properties,
    }


def _suggestion_to_dict(s) -> dict:
    return {
        "id": _getattr(s, "id", None),
        "frame_id": _getattr(s, "frame_id", None),
        "type": _getattr(s, "type", None),
        "suggested_lon": _getattr(s, "suggested_lon", None),
        "suggested_lat": _getattr(s, "suggested_lat", None),
        "suggested_weight_limit_tons": _getattr(s, "suggested_weight_limit_tons", None),
        "suggested_axle_load_tons": _getattr(s, "suggested_axle_load_tons", None),
        "suggested_direction": _getattr(s, "suggested_direction", None),
        "suggested_frame_state": _getattr(s, "suggested_frame_state", None),
        "comment_driver": _getattr(s, "comment_driver", None),
        "contact_phone": _getattr(s, "contact_phone", None),
        "contact_name": _getattr(s, "contact_name", None),
        "status": _getattr(s, "status", None),
        "resolution_comment": _getattr(s, "resolution_comment", None),
        "processed_at": _getattr(s, "processed_at", None).isoformat() if _getattr(s, "processed_at", None) else None,
        "processed_by": _getattr(s, "processed_by", None),
        "created_at": _getattr(s, "created_at", None).isoformat() if _getattr(s, "created_at", None) else None,
    }


# ---------- API: объединённый слой рамок ----------

@app.route("/frames", methods=["GET"])
def get_frames():
    """
    GET /api/frames  (или /frames, если проксируешь без префикса)
    Возвращает FeatureCollection с рамками.
    На этом шаге: raw-слой точно, manual — если модель есть.
    """
    only_active = request.args.get("only_active", "1") != "0"

    db = SessionLocal()
    try:
        query = db.query(FrameRaw)
        if only_active and hasattr(FrameRaw, "frame_is_active"):
            query = query.filter(FrameRaw.frame_is_active == True)  # noqa: E712

        raws = query.all()

        manual_by_frame: Dict[str, object] = {}
        manual_only_list: List[object] = []

        if FrameManual is not None:
            manuals = db.query(FrameManual).all()
            for m in manuals:
                if _getattr(m, "is_deleted_by_admin", False):
                    manual_by_frame[_getattr(m, "frame_id")] = m
                    continue
                if _getattr(m, "manual_only", False):
                    manual_only_list.append(m)
                manual_by_frame.setdefault(_getattr(m, "frame_id"), m)

        features: List[dict] = []

        for raw in raws:
            m = manual_by_frame.get(_getattr(raw, "frame_id"))
            if m and _getattr(m, "is_deleted_by_admin", False):
                continue
            features.append(_merge_raw_and_manual(raw, m))

        # manual-only добавим позже (когда подтвердим поля/модель)
        return jsonify({"type": "FeatureCollection", "features": features})
    finally:
        db.close()


# ---------- API: предложения от водителей ----------

@app.route("/frames/<frame_id>/suggest", methods=["POST"])
def suggest_for_existing_frame(frame_id: str):
    data = request.get_json(silent=True) or {}
    comment = data.get("comment_driver")
    if not comment or len(str(comment).strip()) < 3:
        abort(400, description="comment_driver is required")

    db = SessionLocal()
    try:
        raw = db.query(FrameRaw).filter(FrameRaw.frame_id == frame_id).first()
        if not raw:
            abort(404, description="Frame not found")

        suggestion = FrameSuggestion(
            frame_id=frame_id,
            type="change_existing",
            suggested_lon=data.get("suggested_lon"),
            suggested_lat=data.get("suggested_lat"),
            suggested_weight_limit_tons=data.get("suggested_weight_limit_tons"),
            suggested_axle_load_tons=data.get("suggested_axle_load_tons"),
            suggested_direction=data.get("suggested_direction"),
            suggested_frame_state=data.get("suggested_frame_state"),
            comment_driver=comment,
            contact_phone=data.get("contact_phone"),
            contact_name=data.get("contact_name"),
            status="new",
            created_at=datetime.utcnow(),
        )
        db.add(suggestion)
        db.commit()
        db.refresh(suggestion)
        return jsonify(_suggestion_to_dict(suggestion)), 201
    finally:
        db.close()


@app.route("/frames/suggest", methods=["POST"])
def suggest_new_frame():
    data = request.get_json(silent=True) or {}
    comment = data.get("comment_driver")
    if not comment or len(str(comment).strip()) < 3:
        abort(400, description="comment_driver is required")

    if "suggested_lon" not in data or "suggested_lat" not in data:
        abort(400, description="suggested_lon and suggested_lat are required for new_frame")

    db = SessionLocal()
    try:
        suggestion = FrameSuggestion(
            frame_id=None,
            type="new_frame",
            suggested_lon=data.get("suggested_lon"),
            suggested_lat=data.get("suggested_lat"),
            suggested_weight_limit_tons=data.get("suggested_weight_limit_tons"),
            suggested_axle_load_tons=data.get("suggested_axle_load_tons"),
            suggested_direction=data.get("suggested_direction"),
            suggested_frame_state=data.get("suggested_frame_state"),
            comment_driver=comment,
            contact_phone=data.get("contact_phone"),
            contact_name=data.get("contact_name"),
            status="new",
            created_at=datetime.utcnow(),
        )
        db.add(suggestion)
        db.commit()
        db.refresh(suggestion)
        return jsonify(_suggestion_to_dict(suggestion)), 201
    finally:
        db.close()


@app.route("/frame_suggestions", methods=["GET"])
def list_suggestions():
    status = request.args.get("status")

    db = SessionLocal()
    try:
        q = db.query(FrameSuggestion)
        if status and hasattr(FrameSuggestion, "status"):
            q = q.filter(FrameSuggestion.status == status)
        items = q.order_by(FrameSuggestion.created_at.desc()).all()
        return jsonify([_suggestion_to_dict(s) for s in items])
    finally:
        db.close()


if __name__ == "__main__":
    app.run(debug=True)
