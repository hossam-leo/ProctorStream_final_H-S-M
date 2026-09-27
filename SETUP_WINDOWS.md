# Windows setup

Two supported paths: **Docker** (fewer moving parts) or **native** (Python/Node/PostgreSQL installed directly).
Both work without a GPU.

## Option A — Docker Desktop (recommended)

1. Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/) (WSL2 backend).
2. Open PowerShell in the project folder:
   ```powershell
   copy .env.example .env
   docker compose up --build
   ```
3. Open http://localhost:8080.

This runs everything (PostgreSQL, backend, frontend) in containers on CPU. **This path was written and reviewed
but could not be built in the Linux development sandbox used to build this project (no Docker daemon there) — test
it on your machine before relying on it, and see `docs/DEPLOYMENT.md`.**

## Option B — Native install

### Prerequisites

- [Python 3.10+](https://www.python.org/downloads/windows/) (check "Add python.exe to PATH" during install)
- [Node.js 20+](https://nodejs.org/)
- [PostgreSQL 14+](https://www.postgresql.org/download/windows/) (remember the superuser password)
- [ffmpeg](https://www.gyan.dev/ffmpeg/builds/) — download a release build, extract, and add its `bin` folder to
  your PATH

### Steps (PowerShell)

```powershell
copy .env.example .env

python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
pip install -e .

cd frontend
npm ci
cd ..

# PostgreSQL role/databases (uses the superuser you set during install; adjust -U if needed)
psql -U postgres -c "CREATE USER proctorstream WITH PASSWORD 'proctorstream' CREATEDB;"
psql -U postgres -c "CREATE DATABASE proctorstream OWNER proctorstream;"
psql -U postgres -c "CREATE DATABASE proctorstream_test OWNER proctorstream;"
alembic upgrade head
```

Try demo mode first — it needs none of the above except the Python environment:

```powershell
python scripts\demo_session.py --scenario multi
```

Outputs land in `demo_output\`. Open the `.report.html` file in a browser.

Then the full stack (two terminals):

```powershell
# Terminal 1
uvicorn proctorstream_api.main:app --reload --port 8000

# Terminal 2
cd frontend
npm run dev
```

Dashboard: http://localhost:5173. API docs: http://127.0.0.1:8000/docs.

## CPU vs GPU

Nothing above requires a GPU. Detector inference uses ONNX Runtime, which uses a GPU execution provider
automatically if you have a compatible NVIDIA GPU with the CUDA/cuDNN runtime installed and the appropriate
`onnxruntime-gpu` package — this is an optional swap, not required to start or use the system. See
`docs/DEPLOYMENT.md`.

## Troubleshooting

- **`psql` not found**: add PostgreSQL's `bin` folder (e.g. `C:\Program Files\PostgreSQL\16\bin`) to PATH, or run
  the commands from the "SQL Shell (psql)" Start Menu shortcut instead.
- **`ffmpeg` not found / video extraction fails**: confirm `ffmpeg -version` works from a fresh PowerShell window
  (PATH changes need a new terminal to take effect).
- **`npm ci` fails on a corporate network**: if you're behind a proxy, set `npm config set proxy` /
  `https-proxy` first, or use a network with registry access.
- **Port already in use**: change `--port 8000` (backend) or set `PORT` for `npm run dev` (frontend) if something
  else is already listening.
- **PowerShell blocks `Activate.ps1`**: run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, then retry.
- **Demo mode runs but the full stack doesn't**: demo mode only needs Python + PyYAML/NumPy/pandas — if it works
  but `uvicorn`/`npm run dev` don't, the problem is in the Node/PostgreSQL setup, not the risk engine itself.
