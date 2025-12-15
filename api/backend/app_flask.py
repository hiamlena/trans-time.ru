# api/backend/app_flask.py
import json
from datetime import datetime, timezone
from typing import Dict, Optional, List

from flask import Flask, jsonify, request, abort

from db import SessionLocal
from models import FrameRaw, FrameManual, FrameSuggestion

app = Flask(__name__)

API_PREFIX = "/api"


@app.route(f"{API_PREFIX}/health")
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


def _merge_raw_and_manual(raw: FrameRaw, manual: Optional[FrameManual]):
    """Склеиваем данные raw + manual в properties + coords."""

    def pick(override, base):
        return override if override is not None else base

    # координаты
    lon = pick(manual.lon_override if manual else None, raw.lon)
    lat = pick(manual.lat_override if manual else None, raw.lat)

    # time_windows и tags
    time_windows = _parse_json_field(
        manual.time_windows_override if manual and manual.time_windows_override is not None else raw.time_windows,
        default=[]
    )

    tags_raw = _parse_json_field(raw.tags, default=[])
    tags_admin = _parse_json_field(manual.tags_admin, default=[]) if manual else []
    tags = list(dict.fromkeys(tags_raw + tags_admin))

    properties = {
        "road_id": pick(manual.road_id_override if manual else None, raw.road_id),
        "road_name": pick(manual.road_name_override if manual else None, raw.road_name),
        "class": pick(manual.clazz_override if manual else None, raw.clazz),
        "object_type": raw.object_type,
        "hgv_access": pick(manual.hgv_access_override if manual else None, raw.hgv_access),
        "weight_limit_tons": pick(
            manual.weight_limit_tons_override if manual else None,
            raw.weight_limit_tons,
        ),
        "axle_load_tons": pick(
            manual.axle_load_tons_override if manual else None,
            raw.axle_load_tons,
        ),
        "time_windows": time_windows,
        "valid_from": pick(manual.valid_from_override if manual else None, raw.valid_from),
        "valid_to": pick(manual.valid_to_override if manual else None, raw.valid_to),
        "direction": pick(manual.direction_override if manual else None, raw.direction),
        "source_type": raw.source_type,
        "source_name": raw.source_name,
        "priority": raw.priority,
        "tags": tags,
        "frame_id": raw.frame_id,
        "frame_row_id_raw": raw.frame_row_id_raw,
        "frame_url": raw.frame_url,
        "frame_status_raw": raw.frame_status_raw,
        "frame_error_raw": raw.frame_error_raw,
        "frame_state": pick(
            manual.frame_state_override if manual else None,
            raw.frame_state,
        ),
        "frame_first_seen": raw.frame_first_seen,
        "frame_last_seen": raw.frame_last_seen,
        "frame_is_active": bool(raw.frame_is_active),
        "frame_change_type": raw.frame_change_type,
    }

    # комментарии
    comment_raw = raw.comment_raw or ""
    comment_admin = manual.comment_admin if manual else None

    if comment_admin:
        base_human = raw.comment_human or ""
        if base_human:
            human = f"{base_human} Комментарий администратора: {comment_admin}"
        else:
            human = f"Комментарий администратора: {comment_admin}"
    else:
        human = raw.comment_human

    properties["comment_raw"] = comment_raw
    properties["comment_human"] = human

    return {
        "type": "Feature",
        "id": raw.frame_id,
        "geometry": {
            "type": "Point",
            "coordinates": [lon, lat],
        },
        "properties": properties,
    }


def _feature_from_manual_only(manual: FrameManual):
    """Рамка, созданная только руками админа, без raw."""
    if manual.lon_override is None or manual.lat_override is None:
        return None

    time_windows = _parse_json_field(manual.time_windows_override, default=[])
    tags_admin = _parse_json_field(manual.tags_admin, default=[])

    properties = {
        "road_id": manual.road_id_override,
        "road_name": manual.road_name_override,
        "class": manual.clazz_override,
        "object_type": "frame",
        "hgv_access": manual.hgv_access_override,
        "weight_limit_tons": manual.weight_limit_tons_override,
        "axle_load_tons": manual.axle_load_tons_override,
        "time_windows": time_windows,
        "valid_from": manual.valid_from_override,
        "valid_to": manual.valid_to_override,
        "direction": manual.direction_override,
        "source_type": "manual",
        "source_name": "manual_admin",
        "priority": 1,
        "tags": tags_admin,
        "frame_id": manual.frame_id,
        "frame_row_id_raw": None,
        "frame_url": None,
        "frame_status_raw": None,
        "frame_error_raw": None,
        "frame_state": manual.frame_state_override,
        "frame_first_seen": None,
        "frame_last_seen": None,
        "frame_is_active": True,
        "frame_change_type": "manual_only",
        "comment_raw": "",
        "comment_human": manual.comment_admin,
    }

    return {
        "type": "Feature",
        "id": manual.frame_id,
        "geometry": {
            "type": "Point",
            "coordinates": [manual.lon_override, manual.lat_override],
        },
        "properties": properties,
    }


def _suggestion_to_dict(s: FrameSuggestion) -> dict:
    return {
        "id": s.id,
        "frame_id": s.frame_id,
        "type": s.type,
        "suggested_lon": s.suggested_lon,
        "suggested_lat": s.suggested_lat,
        "suggested_weight_limit_tons": s.suggested_weight_limit_tons,
        "suggested_axle_load_tons": s.suggested_axle_load_tons,
        "suggested_direction": s.suggested_direction,
        "suggested_frame_state": s.suggested_frame_state,
        "comment_driver": s.comment_driver,
        "contact_phone": s.contact_phone,
        "contact_name": s.contact_name,
        "status": s.status,
        "resolution_comment": s.resolution_comment,
        "processed_at": s.processed_at.isoformat() if s.processed_at else None,
        "processed_by": s.processed_by,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


# ---------- API: объединённый слой рамок ----------

@app.route(f"{API_PREFIX}/frames", methods=["GET"])
def get_frames():
    """
    GET /api/frames
    Возвращает FeatureCollection с рамками (raw + manual).
    """
    only_active = request.args.get("only_active", "1") != "0"

    db = SessionLocal()
    try:
        query = db.query(FrameRaw)
        if only_active:
            query = query.filter(FrameRaw.frame_is_active == True)  # noqa: E712
        raws: List[FrameRaw] = query.all()

        manuals: List[FrameManual] = db.query(FrameManual).all()

        manual_by_frame: Dict[str, FrameManual] = {}
        manual_only_list: List[FrameManual] = []

        for m in manuals:
            if m.is_deleted_by_admin:
                manual_by_frame[m.frame_id] = m
                continue
            if m.manual_only:
                manual_only_list.append(m)
            manual_by_frame.setdefault(m.frame_id, m)

        features: List[dict] = []

        for raw in raws:
            m = manual_by_frame.get(raw.frame_id)
            if m and m.is_deleted_by_admin:
                continue
            features.append(_merge_raw_and_manual(raw, m))

        raw_ids = {r.frame_id for r in raws}
        for m in manual_only_list:
            if m.frame_id in raw_ids:
                continue
            feat = _feature_from_manual_only(m)
            if feat:
                features.append(feat)

        return jsonify({"type": "FeatureCollection", "features": features})
    finally:
        db.close()


# ---------- API: предложения от водителей ----------

@app.route(f"{API_PREFIX}/frames/<frame_id>/suggest", methods=["POST"])
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
            comment_driver=str(comment).strip(),
            contact_phone=data.get("contact_phone"),
            contact_name=data.get("contact_name"),
            status="new",
            created_at=datetime.now(timezone.utc),
        )
        db.add(suggestion)
        db.commit()
        db.refresh(suggestion)
        return jsonify(_suggestion_to_dict(suggestion)), 201
    finally:
        db.close()


@app.route(f"{API_PREFIX}/frames/suggest", methods=["POST"])
def suggest_new_frame():
    data = request.get_json(silent=True) or {}
    comment = data.get("comment_driver")
    if not comment or len(str(comment).strip()) < 3:
        abort(400, description="comment_driver is required")

    if data.get("suggested_lon") is None or data.get("suggested_lat") is None:
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
            comment_driver=str(comment).strip(),
            contact_phone=data.get("contact_phone"),
            contact_name=data.get("contact_name"),
            status="new",
            created_at=datetime.now(timezone.utc),
        )
        db.add(suggestion)
        db.commit()
        db.refresh(suggestion)
        return jsonify(_suggestion_to_dict(suggestion)), 201
    finally:
        db.close()


@app.route(f"{API_PREFIX}/frame_suggestions", methods=["GET"])
def list_suggestions():
    status = request.args.get("status")
    db = SessionLocal()
    try:
        q = db.query(FrameSuggestion)
        if status:
            q = q.filter(FrameSuggestion.status == status)
        items = q.order_by(FrameSuggestion.created_at.desc()).all()
        return jsonify([_suggestion_to_dict(s) for s in items])
    finally:
        db.close()


# Локальный запуск: python app_flask.py
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
