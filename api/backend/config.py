# api/backend/config.py
from pathlib import Path

# Папка backend/ (…/trans-time.ru/api/backend)
BASE_DIR = Path(__file__).resolve().parent

# Корень проекта (…/trans-time.ru)
PROJECT_ROOT = BASE_DIR.parent.parent

# Путь до базы SQLite
SQLITE_PATH = BASE_DIR / "frames.db"
SQLALCHEMY_DATABASE_URL = f"sqlite:///{SQLITE_PATH}"

# Путь до исходного GeoJSON
# У тебя он: trans-time.ru/map/data/frames_ready.geojson
FRAMES_GEOJSON_PATH = PROJECT_ROOT / "map" / "data" / "frames_ready.geojson"


def debug_print_paths():
    print("[config] BASE_DIR        =", BASE_DIR)
    print("[config] PROJECT_ROOT    =", PROJECT_ROOT)
    print("[config] SQLITE_PATH     =", SQLITE_PATH)
    print("[config] FRAMES_GEOJSON  =", FRAMES_GEOJSON_PATH)
