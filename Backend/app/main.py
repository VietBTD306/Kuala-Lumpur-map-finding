import logging
import os
import tempfile
import threading
import time
import webbrowser
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.config import get_settings
from app.api import auth
from app.api import path
from app.api import scenarios 

logger = logging.getLogger(__name__)
setting=get_settings()

# Configure logging
logging.basicConfig(
    level=logging.INFO if setting.debug else logging.WARNING,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)

from app.database import init_database, get_db_connection
from app.Services.auth import create_admin_user

# Create FastAPI application
app = FastAPI(
    title=setting.app_name,
    description=" Tìm tuyến Metro khu vực đô thị Kuala Lumpur",
    version="1.0.0",
    debug=setting.debug
)

def open_browser():
    lock_file = Path(tempfile.gettempdir()) / "pathfinding_browser_opened.lock"
    # Prevent uvicorn hot-reloads from opening multiple browser tabs
    if lock_file.exists():
        try:
            mtime = lock_file.stat().st_mtime
            if time.time() - mtime < 10:
                return
        except Exception:
            pass
    try:
        lock_file.touch()
    except Exception:
        pass
    time.sleep(2.0)
    webbrowser.open("http://localhost:8000")

@app.on_event("startup")
def startup_event():
    logger.info("Initializing database...")
    init_database()
    
    # Check if admin user exists, if not, seed the default admin
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM admin")
        if cursor.fetchone()[0] == 0:
            if setting.default_admin_password:
                logger.info("Seeding configured admin user...")
                create_admin_user(setting.default_admin_username, setting.default_admin_password)
                logger.info(f"Admin seeded: {setting.default_admin_username}")
            else:
                logger.warning("No admin was created. Set DEFAULT_ADMIN_PASSWORD in Backend/.env.")
            
    # Pre-load pathfinding graphs into RAM
    logger.info("Pre-loading pathfinding graphs into RAM...")
    from app.Services.pathfinding import get_pathfinding_service
    get_pathfinding_service()
    
    # Automatically open default browser
    logger.info("Launching browser...")
    threading.Thread(target=open_browser, daemon=True).start()

# Configure CoRS (use setting instead of wildcard)

app.add_middleware(
    CORSMiddleware,
    allow_origins=setting.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scenarios.router, prefix="/api")
#Include Routers
app.include_router(auth.router)
app.include_router(path.router)

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

# Serve frontend static files
current_dir = Path(__file__).resolve().parent
frontend_dir = current_dir.parent.parent / "frontend"
if frontend_dir.exists():
    logger.info(f"Mounting static files from {frontend_dir}")
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
else:
    logger.warning(f"Frontend directory not found at {frontend_dir}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
