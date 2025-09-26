MindSphere

**Digital Mental Health and Psychological Support System for Students in Higher Education**

---

## Overview

MindSphere is a full-stack prototype designed to provide stigma-free, confidential, and supportive mental health resources for students. It combines an anonymous chatbot, peer-to-peer forum, screening tools, booking system for counselors, and a resource library. The system is built with a React + Vite frontend, Flask and Node.js backend APIs, and real-time communication via WebSockets.

---

## Features

### 1. Anonymous Chatbot
- Supportive, non-clinical mental health assistant powered by Gemini AI.
- Offers coping strategies for stress, anxiety, depression, sleep, and study issues.
- **No diagnosis or medical advice.** Crisis detection and escalation to resources.

### 2. Screening Tools
- PHQ-9 style screening for depression (prototype).
- Results stored securely in MongoDB.
- Modal-based UI for easy completion.

### 3. Confidential Booking System
- Students can book appointments with counselors.
- Option for anonymous booking.
- Counselor dashboard to view appointments and client submissions.

### 4. Peer-to-Peer Forum
- Anonymous, moderated discussion space for students.
- Real-time posts, replies, upvotes, and moderation via WebSockets.
- Crisis content detection and escalation.

### 5. Resource Library
- Aggregates YouTube, Wikipedia, books, and local resources.
- Searchable and categorized for easy access.

### 6. Admin Dashboard
- View anonymized metrics: active users, screenings, bookings, forum posts.
- Export anonymized CSV (prototype).

---

## Folder Structure

```
client/         # React + Vite frontend
  src/
    components/         # UI components (PHQ9Modal, etc.)
    hooks/              # API hooks (forumApi, useSocket, etc.)
    pages/              # Main pages (Chatbot, Booking, Forum, etc.)
    services/           # Auth and backend services
    assets/             # Static assets
  public/               # Static files
  package.json          # Frontend dependencies

server/         # Flask backend API (main REST endpoints)
  api/
    index.py            # Flask app, Gemini integration, MongoDB, endpoints
  server.js             # Node.js server (alternative backend)
  requirements.txt      # Python dependencies
  package.json          # Node.js dependencies

socketserver/   # Flask-SocketIO backend for real-time forum
  api/
    index.py            # WebSocket events, post/reply handling
  requirements.txt      # Python dependencies
```

---

## Setup & Installation

### 1. Backend (Flask API)

```powershell
cd server
python -m venv .venv
. .venv/Scripts/Activate.ps1   # Or source .venv/bin/activate (Linux/Mac)
pip install -r requirements.txt
python api/index.py
```
- The backend runs on [http://localhost:5000](http://localhost:5000).
- Requires MongoDB (set `MONGO_URI` in `.env`).

### 2. Frontend (React + Vite)

```powershell
cd client
npm install
npm run dev
```
- Frontend runs on [http://localhost:5173](http://localhost:5173).
- Set API base URL in `.env` with `VITE_API_BASE` if needed.

### 3. Real-Time Socket Server (Optional)

```powershell
cd socketserver
pip install -r requirements.txt
python api/index.py
```
- WebSocket server for real-time forum features (default port: 3000).

---

## Key Endpoints

### Flask API (`server/api/index.py`)
- `/api/chat` — Chatbot (POST)
- `/api/phq9` — PHQ-9 submission (POST), fetch latest (GET)
- `/api/bookings` — Book counselor (GET/POST)
- `/api/resources` — Resource search (GET/POST)
- `/api/forum` — Forum posts (GET/POST)
- `/api/screenings` — Screening results (GET/POST)
- `/api/clients` — Client submissions (GET/POST)
- `/api/admin` — Metrics (GET)

### SocketIO API (`socketserver/api/index.py`)
- Real-time events: `create_post`, `add_reply`, `upvote_post`, `pin_post`, `verify_reply`, `typing_start`, `report_content`, etc.

---

## Security & Privacy

- **Prototype only:** No real authentication or encryption.
- **Do not store PII in production.**
- Crisis detection routes users to emergency resources.
- For production: implement end-to-end encryption, authentication, and safety routing.

---

## Deployment

- Vercel supported (see `vercel.json` in both client and server).
- Push to GitHub, import in Vercel, set framework to Vite (React).
- Frontend and serverless functions auto-deployed.

---

## Credits

- Created by CollabCoders (Tanish Sanghvi, Parth Narkar, et al.)
- AI content via Gemini (see PDF for project vision and goals).

---

## License

MIT License

---

## For More Information

See the attached project PPT for vision, goals, and mental health context.
