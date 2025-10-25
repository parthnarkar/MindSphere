
# MindSphere — Server

This document describes how to run and test the Flask server used by the MindSphere project. It is intended for local development, CI checks, and deployment (for example to Vercel serverless functions).

## Quick start (local)

1. Create a virtual environment and activate it (PowerShell):

```powershell
cd server
python -m venv .venv
. .venv\Scripts\Activate.ps1
```

2. Install dependencies:

```powershell
pip install -r requirements.txt
```

3. Copy the example env and fill values:

```powershell
copy .env.example .env
# Edit .env and fill MONGO_URI, GEMINI_API_KEY, ADMIN_SUMMARY_TOKEN, etc.
```

4. Run the server (development):

```powershell
python api\index.py
# or use your preferred WSGI server in production
```

The server exposes REST endpoints under `/api/*` (see top-level README for a list).

## Environment variables

See `server/.env.example`. Important variables:

- `MONGO_URI` — MongoDB connection string (e.g. `mongodb+srv://<user>:<pass>@cluster0...`).
- `MONGO_DB_NAME` — database name (default: `mindsphere`).
- `GEMINI_API_KEY` and `MODEL_NAME` — required if you use the Gemini AI features.
- `ADMIN_SUMMARY_TOKEN` — a short admin token used by some admin routes (change for production).

Notes:
- If `MONGO_URI` uses `mongodb+srv://`, `dnspython` is required (included in `requirements.txt`).
- Do not commit secrets. Use a secrets manager or the deployment provider's environment variable UI for production.

## Tests and health checks

This repository includes `server/ultimate_server_test.py` — a production-style integration tester that:

- Imports the WSGI app via `api/index.py` (mimics Vercel import behavior)
- Exercises key endpoints: GET/POST/DELETE `/api/posts`, POST `/api/posts/like`
- Optionally checks MongoDB connectivity and inspects `requirements.txt` imports

Run it locally (ensure required env vars are set):

```powershell
cd server
python .\ultimate_server_test.py
```

Exit codes:
- `0` — success
- non-zero — failure (useful for CI)

## Health endpoint

We recommend adding a lightweight `/api/health` endpoint that returns 200 and basic diagnostics (optional DB connectivity check). The `ultimate_server_test.py` will attempt to call `/api/health` but will continue if it's missing.

## Deployment (Vercel)

- The repository includes `server/vercel.json` and `api/index.py` suitable for Vercel's Python builder. Vercel will execute the file inside `api/` as the function entrypoint.
- Ensure you set the same environment variables in Vercel (GEMINI_API_KEY, MONGO_URI, MONGO_DB_NAME, ADMIN_SUMMARY_TOKEN, etc.).
- If your app depends on an external MongoDB cluster, ensure network egress from Vercel to your DB is allowed (Vercel serverless functions need outbound access to the DB).

Tips:
- Pin Python runtime (optional) by adding a `runtime.txt` (e.g., `python-3.11.4`) in the `server/` folder.
- Prefer using Vercel environment variables rather than embedding secrets in `.env` for production.

## Security & production notes

- The current implementation trusts client-supplied `email` on some endpoints (delete/like). For production, enforce server-side authentication and verify ID tokens (for example, verify Firebase ID tokens on the server and use the verified `uid`/email for access control).
- Avoid storing raw email addresses in `liked_by` — store user ids or hashed identifiers instead to reduce PII exposure.
- Use HTTPS and middleware for rate-limiting, input validation and sanitization.

## CI suggestion

Add a simple GitHub Actions job that runs the `ultimate_server_test.py` after installing dependencies. Example (pseudo):

```yaml
jobs:
	server-tests:
		runs-on: ubuntu-latest
		steps:
			- uses: actions/checkout@v4
			- name: Set up Python
				uses: actions/setup-python@v4
				with:
					python-version: '3.11'
			- name: Install dependencies
				run: |
					cd server
					python -m venv .venv
					. .venv/bin/activate
					pip install -r requirements.txt
			- name: Run ultimate server tests
				run: |
					cd server
					python .\ultimate_server_test.py
				env:
					MONGO_URI: ${{ secrets.MONGO_URI }}
					MONGO_DB_NAME: ${{ secrets.MONGO_DB_NAME }}
					GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

## Troubleshooting

- Import errors when Vercel runs functions: ensure `api/index.py` imports the app correctly and the repository root is discoverable (see `api/index.py` which adjusts `sys.path` if necessary).
- Mongo connectivity failures: verify `MONGO_URI`, username/password, and that Atlas IP/network access allows the server IPs to connect.
- Missing package errors: confirm `server/requirements.txt` is up to date and that Vercel installs dependencies successfully during build.

## Contact / Maintainers

See top-level README for project credits. For changes to server behavior, edit `server/api/index.py` and the utilities in `server/utils/`.

