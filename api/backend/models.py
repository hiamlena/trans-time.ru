# api/backend/models.py
from __future__ import annotations

from sqlalchemy import Column, Integer, String, Float, Text, DateTime
from sqlalchemy.sql import func

from db import Base


class FrameRaw(Base):
    __tablename__ = "frames_raw"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # стабильный идентификатор рамки (например apvk-10233)
    external_id = Column(String(64), index=True, nullable=False)

    source_url = Column(Text, nullable=True)
    source = Column(String(32), nullable=False, default="nerudas.ru")

    title = Column(Text, nullable=True)
    comment = Column(Text, nullable=True)

    lon = Column(Float, nullable=True)
    lat = Column(Float, nullable=True)

    # строковые поля под ограничения (потом нормально нормализуем)
    height_m = Column(Float, nullable=True)
    width_m = Column(Float, nullable=True)
    weight_t = Column(Float, nullable=True)

    raw_json = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
