import os
import sys

# Путь к папке /api/backend внутри репозитория
BASE_DIR = os.path.dirname(__file__)
BACKEND_DIR = os.path.join(BASE_DIR, "backend")

# Чтобы работали импорты: from db import ... / from models import ...
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

# Подхватываем Flask-приложение
from app_flask import app as application  # noqa
