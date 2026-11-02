# Kuala Lumpur Metro Pathfinding

FastAPI backend and static frontend for route finding around Kuala Lumpur.

## Run locally

1. Install Python 3.12 or newer.
2. Create a virtual environment and install the backend dependencies:

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\python -m pip install -r Backend\requirements.txt
   ```

3. Copy `Backend/.env.example` to `Backend/.env` and set a strong `DEFAULT_ADMIN_PASSWORD`.
4. Place the route graph database at `Backend/data/pathfinding.db`.
5. Start the app from the `Backend` directory:

   ```powershell
   cd Backend
   ..\.venv\Scripts\python.exe -m app.main
   ```

   Then open <http://localhost:8000>.

The route graph database is a local 361 MB file and is excluded from this repository. The app needs that database to load route data.
