# api/backend/app_flask.py
import json
from datetime import datetime, timezone
from typing import Dict, Optional, List, Any

from flask import Flask, jsonify, request, abort

from db import SessionLocal
from models import FrameRaw, FrameManual, FrameSuggestion

app = Flask(__name__)


@app.route("/health")
def health():
    # будет доступно как /api/health если приложение смонтировано под /api
    return jsonify({"status": "ok", "ts": datetime.now(timezone.utc).isoformat()})


# ---------- helpers ----------

def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


def _parse_json_field(text: Optional[str], default):
    if text is None:
        return default
    if isinstance(text, (list, dict)):
        return text
    s = str(text).strip()
    if not s:
        return default
    try:
        return json.loads(s)
    except Exception:
        return default


def _pick(override, base):
    return override if override is not None else base


def _merge_raw_and_manual(raw: FrameRaw, manual: Optional[FrameManual]) -> dict:
    """Склеиваем raw + manual в 1 Feature."""

    # координаты
    lon = _pick(manual.lon_override if manual else None, raw.lon)
    lat = _pick(manual.lat_override if manual else None, raw.lat)

    # time_windows и tags
    time_windows = _parse_json_field(
        (manual.time_windows_override if manual and manual.time_windows_override is not None else raw.time_windows),
        default=[]
    )

    tags_raw = _parse_json_field(raw.tags, default=[])
    tags_admin = _parse_json_field(manual.tags_admin, default=[]) if manual else []
    tags = list(dict.fromkeys((tags_raw or []) + (tags_admin or [])))  # uniq preserving order

    # комментарии
    comment_raw = (raw.comment_raw or "").strip()
    comment_admin = (manual.comment_admin.strip() if manual and manual.comment_admin else "")

    if comment_admin:
        base_human = (raw.comment_human or "").strip()
        human = f"{base_human} Комментарий администратора: {comment_admin}".strip() if base_human else f"Комментарий администратора: {comment_admin}"
    else:
        human = (raw.comment_human or "").strip() or None

    properties = {
        "road_id": _pick(manual.road_id_override if manual else None, raw.road_id),
        "road_name": _pick(manual.road_name_override if manual else None, raw.road_name),
        "class": _pick(manual.clazz_override if manual else None, raw.clazz),
        "object_type": raw.object_type,
        "hgv_access": _pick(manual.hgv_access_override if manual else None, raw.hgv_access),
        "weight_limit_tons": _pick(manual.weight_limit_tons_override if manual else None, raw.weight_limit_tons),
        "axle_load_tons": _pick(manual.axle_load_tons_override if manual else None, raw.axle_load_tons),
        "time_windows": time_windows,
        "valid_from": _pick(manual.valid_from_override if manual else None, raw.valid_from),
        "valid_to": _pick(manual.valid_to_override if manual else None, raw.valid_to),
        "direction": _pick(manual.direction_override if manual else None, raw.direction),
        "source_type": raw.source_type,
        "source_name": raw.source_name,
        "priority": raw.priority,
        "tags": tags,
        "frame_id": raw.frame_id,
        "frame_row_id_raw": raw.frame_row_id_raw,
        "frame_url": raw.frame_url,
        "frame_status_raw": raw.frame_status_raw,
        "frame_error_raw": raw.frame_error_raw,
        "frame_state": _pick(manual.frame_state_override if manual else None, raw.frame_state),

        # ВАЖНО: datetime -> строка, иначе Flask может упасть
        "frame_first_seen": iso(raw.frame_first_seen),
        "frame_last_seen": iso(raw.frame_last_seen),

        "frame_is_active": bool(raw.frame_is_active),
        "frame_change_type": raw.frame_change_type,

        "comment_raw": comment_raw or None,
        "comment_human": human,
    }

    return {
        "type": "Feature",
        "id": raw.frame_id,
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": properties,
    }


def _feature_from_manual_only(manual: FrameManual) -> Optional[dict]:
    """Рамка созданная только руками админа, без raw."""
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
        "tags": tags_admin or [],
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
        "comment_raw": None,
        "comment_human": (manual.comment_admin.strip() if manual.comment_admin else None),
    }

    return {
        "type": "Feature",
        "id": manual.frame_id,
        "geometry": {"type": "Point", "coordinates": [manual.lon_override, manual.lat_override]},
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
        "processed_at": iso(s.processed_at),
        "processed_by": s.processed_by,
        "created_at": iso(s.created_at),
    }


# ---------- API: merged frames ----------

@app.route("/frames", methods=["GET"])
def get_frames():
    """
    GET /api/frames  (если приложение смонтировано под /api)
    FeatureCollection (raw + manual)
    """
    only_active = request.args.get("only_active", "1") != "0"

    db = SessionLocal()
    try:
        q = db.query(FrameRaw)
        if only_active:
            q = q.filter(FrameRaw.frame_is_active == True)  # noqa: E712
        raws: List[FrameRaw] = q.all()

        raw_ids = {r.frame_id for r in raws}

        manuals: List[FrameManual] = db.query(FrameManual).all()
        manual_by_frame: Dict[str, FrameManual] = {}
        manual_only_list: List[FrameManual] = []

        for m in manuals:
            # если админ пометил "удалить" — не показываем
            if m.is_deleted_by_admin:
                manual_by_frame[m.frame_id] = m
                continue
            # ручная рамка без raw
            if m.manual_only:
                manual_only_list.append(m)
            manual_by_frame.setdefault(m.frame_id, m)

        features: List[dict] = []

        # raw + manual
        for raw in raws:
            m = manual_by_frame.get(raw.frame_id)
            if m and m.is_deleted_by_admin:
                continue
            features.append(_merge_raw_and_manual(raw, m))

        # manual-only
        for m in manual_only_list:
            if m.frame_id in raw_ids:
                continue
            feat = _feature_from_manual_only(m)
            if feat:
                features.append(feat)

        return jsonify({"type": "FeatureCollection", "features": features})
    finally:
        db.close()


# ---------- API: suggestions ----------

@app.route("/frames/<frame_id>/suggest", methods=["POST"])
def suggest_for_existing_frame(frame_id: str):
    data = request.get_json(silent=True) or {}
    comment = (str(data.get("comment_driver", "")).strip())
    if len(comment) < 3:
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
            created_at=utc_now(),
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
    comment = (str(data.get("comment_driver", "")).strip())
    if len(comment) < 3:
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
            comment_driver=comment,
            contact_phone=data.get("contact_phone"),
            contact_name=data.get("contact_name"),
            status="new",
            created_at=utc_now(),
        )
        db.add(suggestion)
        db.commit()
        db.refresh(suggestion)
        return jsonify(_suggestion_to_dict(suggestion)), 201
    finally:
        db.close()


@app.route("/frame_suggestions", methods=["GET"])
def list_suggestions():
    """
    GET /api/frame_suggestions?status=new|approved|rejected
    """
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


# локально: python app_flask.py
if __name__ == "__main__":
    app.run(debug=True)
