from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DB_PATH = "frames.db"

engine = create_engine(f"sqlite:///{DB_PATH}", echo=False, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
