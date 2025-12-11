from sqlalchemy import Column, Integer, String, Float, Boolean, Text
from sqlalchemy.orm import declarative_base

Base = declarative_base()


class FrameRaw(Base):
    __tablename__ = "frames_raw"

    id = Column(Integer, primary_key=True)
    frame_id = Column(String, unique=True)

    lon = Column(Float)
    lat = Column(Float)

    comment_human = Column(Text)
    comment_raw = Column(Text)

    frame_url = Column(String)
    hgv_access = Column(String)
    direction = Column(String)

    frame_first_seen = Column(String)
    frame_last_seen = Column(String)
    frame_is_active = Column(Boolean, default=True)


class FrameManual(Base):
    __tablename__ = "frames_manual"

    id = Column(Integer, primary_key=True)
    frame_id = Column(String)

    lon_override = Column(Float)
    lat_override = Column(Float)

    comment_admin = Column(Text)

    is_deleted_by_admin = Column(Boolean, default=False)
    manual_only = Column(Boolean, default=False)
