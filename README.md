# MindSphere

[![React](https://img.shields.io/badge/React-19.1.1-blue.svg)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-7.1.7-yellow.svg)](https://vitejs.dev/)
[![Flask](https://img.shields.io/badge/Flask-2.3+-lightgrey.svg)](https://flask.palletsprojects.com/)
[![MongoDB](https://img.shields.io/badge/Database-MongoDB-green.svg)](https://www.mongodb.com/)
[![Firebase](https://img.shields.io/badge/Auth-Firebase-orange.svg)](https://firebase.google.com/)
[![Tailwind](https://img.shields.io/badge/TailwindCSS-4.1.13-teal.svg)](https://tailwindcss.com/)

MindSphere is a research/prototype digital mental-health support system focused on student-facing workflows. It combines a modern frontend with a lightweight backend to demonstrate chat-based support, screenings, bookings, resources and forum features.

![MindSphere Landing Page](client/public/Hero%20Section%20Banner.png)

## Demo & Slides

- **YouTube Demo**: <a href="https://youtu.be/nXVGe-jcuzI" target="_blank">**Watch Here**</a>  
- **Project PPT**: <a href="https://drive.google.com/file/d/1mNmLvwJcKor3MNabqPwNcCbr2fcVI5Jx/view?usp=sharing" target="_blank">**Click Here**</a>
 
## Contents

- `client/` — React + Vite frontend (UI: chat, screening, bookings, resources, forum, admin pages)
- `server/` — Flask backend (REST API + optional integrations with MongoDB and Google Generative AI)

IMPORTANT: This project is a prototype. It is NOT production-ready. Do not use with real sensitive data or PII without adding proper security, privacy, and clinical governance.

This README consolidates setup, development, testing, deployment, API reference, and operational guidance.

---

## Quick start (local development)

Prerequisites
- Node 18+ and npm
- Python 3.10+ and pip
- Recommended locally: MailHog or smtp4dev (SMTP capture)

1) Start frontend (React + Vite)

```powershell
cd client
copy .env.example .env
# edit client/.env if needed (VITE_API_BASE)
npm install
npm run dev
# Open the Vite URL (usually http://localhost:5173)
```

2) Start backend (Flask)

```powershell
cd server
python -m venv .venv
. .venv\Scripts\Activate.ps1
copy .env.example .env
# edit server/.env to add MONGO_URI, GEMINI_API_KEY, SMTP configs etc.
pip install -r requirements.txt
python app.py
# Server will listen on port 5000 by default (http://localhost:5000)
```

Notes
- `server/app.py` is the main Flask app; `server/api/index.py` is a shim used for serverless hosts.
- When MongoDB is not configured the server falls back to in-memory stores for many features to simplify local development.

## Architecture & design overview

- Frontend: React + Vite, Tailwind CSS, React Router. Uses Firebase for optional auth and Firestore for user metadata.
- Backend: Flask application with routes mounted on a blueprint. Helpers live in `server/utils/` (DB helpers, prompt builders, model wrapper).
- Generative AI integration: optional Google Generative AI (Gemini) via `server/utils/model.py` when `GEMINI_API_KEY` and `MODEL_NAME` are set.
- Persistence: optional MongoDB. If absent the app uses in-memory stores (suitable for demos only).
- Email: SMTP (smtplib) configured via env vars; emergency notification route constructs multipart plain+HTML messages.

Design choices
- The backend separates prompt building (helpers) from model invocation (model.py) and database persistence (db.py) for clear responsibilities.
- Safety: the code includes prompt instructions and caps in some endpoints (e.g., summary endpoints ask for MAX 500 words). These are prompt-level constraints rather than enforced truncation in many places.

## Environment variables (summary)

Client (Vite) environment variables (prefix `VITE_`) are used by the frontend and are embedded at build time.
- `VITE_API_BASE` — backend base URL for dev (e.g., http://localhost:5000)
- `VITE_YT_API_KEY` — optional YouTube API key for resources page

Server environment variables (edit `server/.env` or set in host):
- `MONGO_URI` — MongoDB connection string (optional)
- `MONGO_DB_NAME` — DB name (default: mindsphere)
- `GEMINI_API_KEY` — API key for Gemini (optional)
- `MODEL_NAME` — model identifier for generative calls (optional)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` — SMTP configuration for outgoing emails
- `EMAIL_FROM`, `EMAIL_TO` — emergency email addresses
- `ADMIN_SUMMARY_TOKEN` — optional admin token for protected endpoints

Security note: Do not store private secrets in client-side `VITE_` variables for production. Use server-side environment variables or a secrets manager.

## Key endpoints (selected)

Base: http://localhost:5000

| Method(s) | Path | Description | Request / Response / Notes |
|---|---|---|---|
| GET | / | Health check | Returns: `{ status: 'ok' }` |
| POST | /api/chat | Chat message handler: generate a response from the model | Request body: `{ message: string, session_id?: string, history?: [] }` — Response: `{ response: string, escalate: bool, intent: string, intentConfidence: number }`. Notes: calls `modelutils.generate_coping_text(prompt)`; server does not forcibly truncate model output (provider/model limits still apply).
| GET, POST | /api/chat/session | Create or list chat sessions | GET: list sessions. POST: create a new session (returns session id).
| GET, POST | /api/chat/session/<session_id>/messages | Read or append messages to a session | GET: list messages for session. POST: append a message to the session.
| POST | /api/notify/emergency_mail | Build and send an emergency notification email | Constructs a multipart plain+HTML message and sends via configured SMTP settings.
| GET, POST | /api/phq9 | Submit or list PHQ-9 screening forms | POST to submit a screening; GET to list stored screenings (in-memory or Mongo depending on config).
| GET | /api/phq9/<email> | Retrieve latest PHQ-9 for a user | Returns the most recent PHQ-9 entry for the provided email (if available).
| GET, POST | /api/posts | Forum post CRUD | Create, list and manage forum posts. Storage: in-memory or Mongo depending on configuration.
| GET, POST | /api/resources | Resource CRUD used by the Resources page | Manage learning / help resources used by the frontend.
| GET | /api/admin | Basic admin metrics | Returns counts/metrics such as active users, screenings and bookings.

For full request/response shapes and optional query params, read handler docstrings in `server/app.py` and the helper modules.

## Development tips & workflows

- Frontend:
	- `npm run dev` for development, `npm run build` to produce production assets, `npm run preview` to preview build.
	- Linting is available via `npm run lint` (ESLint configured). Tailwind config in `tailwind.config.js`.

- Backend:
	- `python app.py` runs the Flask dev server. For production testing use a WSGI server.
	- `server/utils/model.py` exposes `init_model()` and `generate_coping_text()` which wrap the provider client. If `GEMINI_API_KEY` is not set the model client is disabled and callers must handle missing model behavior.

- Common:
	- Ensure `VITE_API_BASE` points to your running backend during local dev.
	- Use MailHog/smtp4dev for capturing outgoing emails in dev.

## Testing, CI & health checks

- The repo includes `server/ultimate_server_test.py` — a lightweight integration-style tester that imports the WSGI app and exercises endpoints. Useful for CI smoke tests.

Suggested CI (GitHub Actions):
- Install server deps, run `python server/ultimate_server_test.py` as a smoke test
- Install client deps, run `npm ci && npm run build` to validate frontend builds

## Deployment notes

Vercel (serverless)
- `server/api/index.py` is intended to be the serverless entrypoint for Vercel. Vercel will import the Flask app.
- Ensure environment variables are set in the Vercel project settings.
- Serverless cold-starts mean model initialization and DB connection patterns should be tolerant to occasional re-initialization and timeouts.

Traditional / containerized deployment
- For production workloads or to avoid serverless connection limits, consider containerizing the Flask app and running in Cloud Run, ECS, or a VM with managed MongoDB and secrets store.

AI & model usage considerations
- The model provider enforces token limits (context + response). Your server code generally forwards the model output unchanged to clients (no hard truncation in `/api/chat`). For cost and reliability you may want to:
	- Set a `max_tokens` arg when calling the provider client inside `utils/model.py` (if supported by provider SDK)
	- Implement streaming to relay tokens to clients as they arrive
	- Post-truncate output on the server using a configurable word/char cap (if you require a strict client limit)

## Observability, scaling & costs

- Add structured logs and an error tracking service (Sentry) before production.
- Track request rates and model token usage to estimate costs for AI calls.
- Consider caching common model outputs where possible and respecting rate limits.

## Security, privacy & compliance

- Authentication and authorization: many endpoints currently accept client-supplied emails; for production enforce auth and verify tokens server-side (e.g., Firebase ID tokens).
- Minimize PII in logs. Consider hashing or using internal ids instead of raw emails in arrays or public objects.
- Rate-limit endpoints that invoke models or send emails to avoid abuse.

## Troubleshooting

- Import errors when running server: ensure virtualenv is activated and dependencies are installed.
- `model not configured` errors: set `GEMINI_API_KEY` and `MODEL_NAME` or handle missing model client in the calling code.
- SMTP failures: point `SMTP_HOST`/`SMTP_PORT` to MailHog for local testing and check logs for exceptions.

## Files and places to start reading code

- Frontend: `client/src/pages/*` and `client/src/components/*`
- Backend entry: `server/app.py` (routes) and `server/api/index.py` (serverless shim)
- Utility modules: `server/utils/db.py`, `server/utils/helpers.py`, `server/utils/model.py`

## Contributors

| [![](https://github.com/parthnarkar.png?size=100)](https://github.com/parthnarkar) | [![](https://github.com/tanish-jain-225.png?size=100)](https://github.com/tanish-jain-225) | [![](https://github.com/architchitte.png?size=100)](https://github.com/architchitte) |
| :--------------------------------------------------------------------------------: | :----------------------------------------------------------------------------------------: | :--------------------------------------------------------------------------------: |
| [**Parth Narkar**](https://github.com/parthnarkar) | [**Tanish Sanghvi**](https://github.com/tanish-jain-225) | [**Archit Chitte**](https://github.com/architchitte) |

| [![](https://github.com/Anshul-patil10.png?size=100)](https://github.com/Anshul-patil10) | [![](https://github.com/harshpatil110.png?size=100)](https://github.com/harshpatil110) | [![](https://github.com/Achu80.png?size=100)](https://github.com/Achu80) |
| :--------------------------------------------------------------------------------------: | :--------------------------------------------------------------------------------: | :----------------------------------------------------------------------------: |
| [**Anshul Patil**](https://github.com/Anshul-patil10) | [**Harshvardhan Patil**](https://github.com/harshpatil110) | [**Gowri Nair**](https://github.com/Achu80) |


## For Contributing

1. Fork the repo and create a feature branch
2. Run local dev (client + server)
3. Add tests where useful and update docs
4. Open a PR with a clear description and testing notes


*Built with ❤️ by Team CollabCoders*



