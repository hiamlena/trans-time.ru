# api/backend/db.py
from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# SQLite файл рядом с кодом backend
BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "frames.db"

# Можно переопределить через переменную окружения (удобно для CI)
DB_URL = os.getenv("TT_DB_URL", f"sqlite:///{DB_PATH.as_posix()}")

# check_same_thread=False нужно для SQLite в веб-приложениях, в CI тоже ок
engine = create_engine(
    DB_URL,
    connect_args={"check_same_thread": False} if DB_URL.startswith("sqlite") else {},
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

Base = declarative_base()
