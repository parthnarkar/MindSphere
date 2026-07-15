# MindSphere — Server

This document describes how to run, test and deploy the Flask-based backend used by MindSphere. It's focused on local development, CI checks, deployment (e.g., Vercel) and practical production considerations.

Summary
- Quick local dev steps (venv, install, env)
- How to run tests and recommended health checks
- Deployment notes (Vercel and general)
- Security, observability and CI advice

---

## Quick start (local)

1. Create and activate a virtual environment (PowerShell):

```powershell
cd server
python -m venv .venv
. .venv\Scripts\Activate.ps1
```

2. Install dependencies:

```powershell
pip install -r requirements.txt
```

3. Copy example env and fill in required values:

```powershell
copy .env.example .env
# Edit .env and fill MONGO_URI, MONGO_DB_NAME, GEMINI_API_KEY, MODEL_NAME, ADMIN_SUMMARY_TOKEN, etc.
```

4. Run the server for development:

```powershell
python api\index.py
# Or use a WSGI server (gunicorn/uvicorn) for production testing
```

The API root is mounted under `/api/*` (see `api/index.py` for route registration).

## Environment variables

The project reads configuration from environment variables (see `.env.example`). Important ones:

- `MONGO_URI` — MongoDB connection string (e.g., mongodb+srv://...)
- `MONGO_DB_NAME` — DB name (default: `mindsphere`)
- `GEMINI_API_KEY` and `MODEL_NAME` — required for Gemini AI features
- `ADMIN_SUMMARY_TOKEN` — short admin token used by admin routes

Notes:
- If `MONGO_URI` uses the `+srv` form, make sure `dnspython` is installed (included in `requirements.txt`).
- Do not commit secrets; use a secrets manager or your host's environment settings for production.

## Tests & health checks

- The repo includes `server/ultimate_server_test.py`, a lightweight integration-style tester that imports the WSGI app and exercises key endpoints. It is useful for CI smoke tests.

Run it locally (make sure required env vars are set):

```powershell
cd server
python .\ultimate_server_test.py
```

Exit code `0` means success; any non-zero exit indicates failures for CI to pick up.

Health endpoint
- Add a simple `/api/health` endpoint that returns 200 and optionally checks DB connectivity. `ultimate_server_test.py` will probe it if present but continues if absent.

## Running in production / deployment notes

Vercel
- This repo contains `server/vercel.json` and `api/index.py` prepared for Vercel's serverless functions. Vercel will import `api/index.py` as the function entrypoint.
- Ensure environment variables (GEMINI_API_KEY, MONGO_URI, MONGO_DB_NAME, etc.) are set in Vercel project settings.
- For MongoDB connections from serverless functions, ensure your DB allows connections from Vercel (set IP/network access or use a managed private endpoint where possible).

General production
- Prefer a managed service (Cloud Run, ECS, or a VM) for long-running servers if you need persistent connections or larger models.
- Pin Python runtime (e.g., add `runtime.txt` with `python-3.11.4`) if your host supports it.

## Observability & reliability

- Add structured logging (JSON) and a request logger for production to track failures.
- Add basic metrics (request count, latency) and an error tracker (Sentry or similar).
- Consider request-size and rate-limiting middleware to protect the model and DB endpoints.

## Security & production hardening

- Require authenticated requests for actions that modify state (likes, delete posts, admin endpoints). Verify tokens server-side (e.g., Firebase ID tokens) and use the verified uid/email.
- Avoid storing raw email addresses in public-facing arrays; prefer user ids or hashed identifiers to reduce PII exposure.
- Validate and sanitize incoming payloads. Use strict JSON schema validation for critical endpoints when possible.
- Use HTTPS, enable CORS selectively and add rate limiting.

## AI-specific considerations

- Many endpoints call the generative model via `utils/model.py`:
	- The model provider (Gemini) enforces context+response token limits. Your server currently does not impose a hard character/word limit for `/api/chat`; the provider will determine the final size.
	- For predictable cost/behavior, either set `max_tokens` when calling the provider or post-process/truncate outputs before returning to clients.
	- For large responses consider streaming tokens to the client (if provider/SDK supports it) to improve UX.

## CI recommendations

- Add a GitHub Actions workflow that:
	1. Checks out code
	2. Sets up Python
	3. Installs dependencies
	4. Runs `ultimate_server_test.py` as a smoke test

Example job snippet (adapt to your CI):

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
			- name: Run server smoke tests
				run: |
					cd server
					python .\ultimate_server_test.py
				env:
					MONGO_URI: ${{ secrets.MONGO_URI }}
					MONGO_DB_NAME: ${{ secrets.MONGO_DB_NAME }}
					GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
```

## Troubleshooting

- Import errors in serverless hosts: ensure `api/index.py` sets `sys.path` correctly or Vercel's project layout matches expectations.
- Mongo connection failures: double-check `MONGO_URI`, credentials and network egress rules (Atlas IP allowlist or VPC peering).
- Model-related failures: if `GEMINI_API_KEY` or `MODEL_NAME` are not set, `utils/model.py` will disable model access; code expects callers to handle missing model client.
