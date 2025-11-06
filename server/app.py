from werkzeug.exceptions import NotFound, MethodNotAllowed
from werkzeug.security import check_password_hash
from utils import helpers as helpers
from utils import model as modelutils
from utils import db as dbutils
from flask import Flask, request, jsonify, Blueprint, make_response
from flask_cors import CORS
from dotenv import load_dotenv
from email.message import EmailMessage
from datetime import timezone as _tz
from datetime import datetime

import os
import re
import traceback as _tb
import sys
import traceback
import time
import hashlib
import smtplib


# Load env
load_dotenv()


app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=False)
app.config.update({'JSON_SORT_KEYS': False})

CREDENTIALS_COLLECTION_NAME = os.getenv('CREDENTIALS_COLLECTION_NAME')
RESOURCES_RECORD_COLLECTION_NAME = os.getenv('RESOURCES_RECORD_COLLECTION_NAME')
PEER_COLLECTION_NAME = os.getenv('PEER_COLLECTION_NAME')
MASTER_COLLECTION_NAME = os.getenv('MASTER_COLLECTION_NAME')

# Simple in-memory caches to avoid repeated model calls when quota is low.
# Keys: chat summary keys (email/session/convo-hash) -> { summary: str, ts: float }
CHAT_SUMMARY_CACHE = {}
# TTL for cached chat summaries (seconds). Default 6 hours.
CHAT_SUMMARY_CACHE_TTL = int(
    os.getenv('CHAT_SUMMARY_CACHE_TTL') or 60 * 60 * 6)
# In-memory map to persist last-active session per user when a persistent DB is not configured.
CHAT_ACTIVE_MAP = {}


# Ensure CORS headers are present on every response (including error responses)
@app.after_request
def _add_cors_headers(response):
    try:
        # Mirror wildcard origin — for production consider restricting this to allowed origins
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS, PUT, DELETE'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
        # Do not allow credentials by default here (consistent with CORS(...) above)
        response.headers['Access-Control-Allow-Credentials'] = 'false'
    except Exception:
        pass
    return response


# Global error handler that returns JSON and ensures CORS headers are present
@app.errorhandler(Exception)
def _handle_uncaught_error(err):
    # Log full traceback to the console to help debugging
    traceback.print_exc()
    # Build a simple JSON payload for the client
    payload = {'error': 'internal_server_error', 'details': str(err)}
    resp = make_response(jsonify(payload), 500)
    # Ensure our CORS headers are present on the error response as well
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS, PUT, DELETE'
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    resp.headers['Access-Control-Allow-Credentials'] = 'false'
    return resp


# Return a friendly JSON response for common HTTP errors (NotFound / MethodNotAllowed)


@app.errorhandler(NotFound)
def _handle_not_found(err):
    payload = {'error': 'not_found', 'path': request.path, 'details': str(err)}
    resp = make_response(jsonify(payload), 404)
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS, PUT, DELETE'
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    resp.headers['Access-Control-Allow-Credentials'] = 'false'
    return resp


@app.errorhandler(MethodNotAllowed)
def _handle_method_not_allowed(err):
    payload = {'error': 'method_not_allowed',
               'path': request.path, 'details': str(err)}
    resp = make_response(jsonify(payload), 405)
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS, PUT, DELETE'
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
    resp.headers['Access-Control-Allow-Credentials'] = 'false'
    return resp


# Ensure any CORS preflight (OPTIONS) is answered early with a success status so browsers allow the actual request.
@app.before_request
def _handle_global_options():
    # If it's an OPTIONS preflight, return an empty 200 response; Flask-CORS will add the required headers.
    if request.method == 'OPTIONS':
        resp = make_response('', 200)
        return resp


# Define a local blueprint to keep routes organized inside this master file
bp = Blueprint('api', __name__)

# In-memory fallbacks
bookings = []
screenings = []
resources = [{"id": 1, "title": "Intro to coping skills",
              "type": "video", "language": "English", "url": ""}]
# In-memory resource search records (fallback when Mongo not available)
resource_searches = []
# In-memory fallback store for peer posts when Mongo not configured
peer_posts = []


def startup():
    # Initialize optional backends (safe no-ops if not configured)
    try:
        dbutils.init_mongo()
    except Exception:
        pass
    try:
        modelutils.init_model()
    except Exception:
        pass


# Call startup at import time to ensure utils are initialized for direct script use
startup()


@bp.route('/')
def health():
    return jsonify({"status": "ok", "service": "mindsphere-server"})


@bp.route('/api/chat', methods=['POST', 'OPTIONS'])
def api_chat():
    if request.method == 'OPTIONS':
        return '', 204

    data = request.get_json() or {}
    user_message = data.get('message') or data.get('text')
    if not user_message:
        return jsonify({"error": "Message is required"}), 400

    # Intent detection and optional history loading
    detected = helpers.detect_intent(user_message) or {}
    history = data.get('history') if isinstance(data, dict) else None

    session_id = data.get('session_id') or data.get('sessionId') or None
    session_email = (data.get('user_email') or data.get('userEmail') or None)
    if isinstance(session_email, str):
        session_email = session_email.lower()

    # If no history provided but a session_id exists, load recent messages
    if not history and session_id:
        try:
            msgs = dbutils.get_session_messages(
                session_email, session_id, limit=10, tail=True) or []
            last10 = msgs if isinstance(msgs, list) else []
            hist = []
            for m in last10:
                text = m.get('text') or m.get(
                    'message') or m.get('content') or ''
                role = m.get('from') or m.get('role') or 'user'
                hist.append({'role': role, 'message': text,
                            'timestamp': m.get('timestamp')})
            history = hist
        except Exception:
            history = history or []

    # 2) Topic gate removed: always proceed to normal flow and generate a reply
    # (Previously this branch asked a clarifying question when the message did not
    # appear to be student mental-health related. Per request, we skip that
    # behavior and generate a response to any incoming message.)

    # 3) Normal flow: generate a coping-style reply based on detected intent
    prompt = helpers.build_coping_prompt(
        f"[intent={detected.get('intent')}] {user_message}", history=history)
    try:
        text = modelutils.generate_coping_text(prompt)
    except Exception as e:
        return jsonify({"error": "Model generation failed", "details": str(e)}), 500
    return jsonify({"response": text, "escalate": False, "intent": detected.get('intent'), "intentConfidence": detected.get('confidence'), "detected": detected})


@bp.route('/api/chat/session', methods=['POST', 'GET', 'OPTIONS'])
def api_chat_session():
    """Create a new chat session (POST) or list sessions (GET).

    POST body: { user_email?: str }
    GET query: ?email=... (optional) — when omitted returns recent sessions globally
    """
    if request.method == 'OPTIONS':
        return '', 204
    if request.method == 'POST':
        data = request.get_json() or {}
        email = data.get('user_email') or None
        sid = dbutils.create_chat_session(email)
        if not sid:
            return jsonify({"error": "could not create session"}), 500
        return jsonify({"session_id": sid}), 201

    # GET -> list sessions (optionally filtered by email)
    email = request.args.get('email') or None
    sessions = dbutils.get_sessions_by_email(email)
    return jsonify({"sessions": sessions})


@bp.route('/api/notify/emergency_mail', methods=['POST', 'OPTIONS'])
def api_send_email():
    """SMTP mail function"""
    # Handle CORS preflight quickly
    if request.method == 'OPTIONS':
        return '', 204
    # Expect a JSON body describing the detected info
    data = request.get_json() or {}

    # Build subject and body using a dedicated helper so the route stays small
    try:
        # build_emergency_email now returns a 3-tuple: (subject, plain_text, html_text)
        subject, plain_body, html_body = helpers.build_emergency_email(data)
    except Exception as e:
        return jsonify({'error': 'email_build_failed', 'details': str(e)}), 500
    # SMTP configuration from environment
    smtp_host = os.getenv('SMTP_HOST')
    smtp_port = int(os.getenv('SMTP_PORT') or 587)
    smtp_user = os.getenv('SMTP_USER')
    smtp_pass = os.getenv('SMTP_PASS')
    email_from = os.getenv('EMAIL_FROM')
    email_to = os.getenv('EMAIL_TO')

    if not smtp_host or not email_to:
        # Missing configuration: return 500 with helpful message
        msg = "SMTP_HOST and EMAIL_TO must be set to send emergency mail"
        print(f"[api_send_email] misconfigured: {msg}")
        return jsonify({'error': 'mail_not_configured', 'details': msg}), 500

    # Construct email message
    try:
        em = EmailMessage()
        # Ensure there is a sensible From header
        em['From'] = email_from or smtp_user or 'no-reply@localhost'
        em['To'] = email_to
        em['Subject'] = subject
        # Set plain text body and add HTML alternative when available
        em.set_content(plain_body)
        if html_body:
            try:
                em.add_alternative(html_body, subtype='html')
            except Exception:
                # If adding HTML alternative fails for any reason, continue with plain text
                pass

        # Send via SMTP with STARTTLS when possible
        try:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as s:
                s.ehlo()
                # use starttls for secure transport when port != 25
                try:
                    s.starttls()
                    s.ehlo()
                except Exception:
                    pass
                if smtp_user and smtp_pass:
                    try:
                        s.login(smtp_user, smtp_pass)
                    except Exception as e:
                        print('[api_send_email] SMTP login failed', e)
                s.send_message(em)
        except Exception as e:
            print('[api_send_email] SMTP send failed', e)
            return jsonify({'error': 'smtp_send_failed', 'details': str(e)}), 500

        print('[api_send_email] emergency mail sent to', email_to)
        return jsonify({'ok': True}), 200

    except Exception as e:
        print('[api_send_email] failed to build/send email', e)
        return jsonify({'error': 'send_failed', 'details': str(e)}), 500


@bp.route('/api/chat/session/active', methods=['GET', 'POST', 'OPTIONS'])
def api_chat_session_active():
    """Get or set the last-active session for a given user_email.

    GET ?email=... -> { session_id: ... } or {}
    POST { user_email: ..., session_id: ... } -> { ok: True }
    """
    if request.method == 'OPTIONS':
        return '', 204

    if request.method == 'GET':
        email = request.args.get('email') or None
        if not email:
            return jsonify({}), 200
        email_l = email.lower()
        # Try Mongo-backed storage first (best-effort)
        try:
            mongo_db = getattr(dbutils, 'mongo_db', None)
            if mongo_db is not None:
                coll = mongo_db.get_collection('chat_meta')
                doc = coll.find_one({'user_email': email_l})
                if doc and doc.get('active_session'):
                    return jsonify({'session_id': doc.get('active_session')}), 200
        except Exception:
            pass

        # Fallback to in-memory map
        sid = CHAT_ACTIVE_MAP.get(email_l)
        if sid:
            return jsonify({'session_id': sid}), 200
        return jsonify({}), 200

    if request.method == 'POST':
        data = request.get_json() or {}
        email = data.get('user_email') or data.get('email') or None
        session_id = data.get('session_id') if 'session_id' in data else None
        if not email:
            return jsonify({'error': 'user_email required'}), 400
        email_l = email.lower()
        # Try to persist to Mongo when available
        try:
            mongo_db = getattr(dbutils, 'mongo_db', None)
            if mongo_db is not None:
                coll = mongo_db.get_collection('chat_meta')
                coll.update_one({'user_email': email_l}, {
                                '$set': {'active_session': session_id}}, upsert=True)
                return jsonify({'ok': True}), 200
        except Exception:
            pass

        # Fallback: in-memory map
        CHAT_ACTIVE_MAP[email_l] = session_id
        return jsonify({'ok': True}), 200


@bp.route('/api/chat/session/<session_id>/messages', methods=['GET', 'POST', 'OPTIONS'])
def api_chat_session_messages(session_id):
    if request.method == 'OPTIONS':
        return '', 204

    if request.method == 'GET':
        email = request.args.get('email') or None
        # pagination support
        try:
            limit = int(request.args.get('limit')
                        ) if request.args.get('limit') else None
        except Exception:
            limit = None
        try:
            offset = int(request.args.get('offset') or 0)
        except Exception:
            offset = 0
        tail = request.args.get(
            'tail', 'false').lower() in ('1', 'true', 'yes')
        msgs = dbutils.get_session_messages(
            email, session_id, limit=limit, offset=offset, tail=tail)
        if msgs is None:
            return jsonify({"messages": []})
        return jsonify({"messages": msgs})

    # POST -> append a message
    data = request.get_json() or {}
    email = data.get('user_email') or None
    message = data.get('message') or {}
    if not session_id or not message:
        return jsonify({"error": "session_id and message required"}), 400
    # ensure timestamp
    if 'timestamp' not in message:
        message['timestamp'] = datetime.utcnow()
    ok = dbutils.append_message_to_session(session_id, message)
    if ok:
        return jsonify({"ok": True}), 201
    return jsonify({"error": "could not append message"}), 500


@bp.route('/api/chat/summary', methods=['POST', 'OPTIONS'])
def api_chat_summary():
    """Generate a 500-word summary of a chat history using the configured Gemini model.

    Accepts JSON body: { messages?: [ { text?: str, message?: str, content?: str } ], session_id?: str, email?: str }
    If `messages` supplied, uses those; otherwise if session_id provided, attempts to load messages from DB.
    If `email` supplied and no messages/session_id, fetches all sessions for that email and flattens messages.
    Returns: { summary: str }
    """
    if request.method == 'OPTIONS':
        return '', 204

    # Optional simple auth: if ADMIN_SUMMARY_TOKEN is set, require a matching Bearer token
    admin_token = os.getenv('ADMIN_SUMMARY_TOKEN')
    if admin_token:
        auth_header = request.headers.get('Authorization') or ''
        if not auth_header.lower().startswith('bearer '):
            return jsonify({'error': 'Unauthorized'}), 401
        token = auth_header.split(' ', 1)[1].strip()
        if token != admin_token:
            return jsonify({'error': 'Unauthorized'}), 401

    data = request.get_json() or {}
    messages = data.get('messages')
    session_id = data.get('session_id') or data.get('sessionId')
    email = (data.get('email') or data.get('user_email')
             or data.get('userEmail') or None)

    # Defensive caps for Vercel: limit sessions/messages to avoid timeouts & token overrun
    MAX_SESSIONS = int(os.getenv('CHAT_SUMMARY_MAX_SESSIONS') or 10)
    MAX_MESSAGES_TOTAL = int(os.getenv('CHAT_SUMMARY_MAX_MESSAGES') or 200)
    MAX_MESSAGES_PER_SESSION = int(
        os.getenv('CHAT_SUMMARY_MAX_MESSAGES_PER_SESSION') or 100)

    msgs = []
    # 1) If client supplied explicit messages array, use it (but cap length)
    if isinstance(messages, list) and messages:
        msgs = messages[:MAX_MESSAGES_TOTAL]
    # 2) If a session_id was provided, fetch messages for that session (cap per-session)
    elif session_id:
        session_msgs = dbutils.get_session_messages(email, session_id) or []
        msgs = (session_msgs or [])[-MAX_MESSAGES_PER_SESSION:]
    # 3) If an email was provided, fetch recent sessions for that email and flatten their messages
    elif isinstance(email, str) and email:
        try:
            sessions = dbutils.get_sessions_by_email(email) or []
            # cap sessions
            sessions = sessions[:MAX_SESSIONS]
            all_msgs = []
            for s in sessions:
                sid = s.get('id') or s.get('session_id') or s.get('_id')
                session_msgs = dbutils.get_session_messages(email, sid) or []
                # keep only the most recent turns from each session
                for m in (session_msgs or [])[-MAX_MESSAGES_PER_SESSION:]:
                    all_msgs.append(m)
                # stop if we have enough
                if len(all_msgs) >= MAX_MESSAGES_TOTAL:
                    break
            msgs = all_msgs[:MAX_MESSAGES_TOTAL]
        except Exception:
            msgs = []
    else:
        return jsonify({"error": "messages, session_id, or email required"}), 400

    # join into a single conversation text
    texts = [(m.get('text') or m.get('message') or m.get('content') or '')
             for m in msgs]
    convo = '\n'.join([t for t in texts if t])
    if not convo:
        return jsonify({"summary": ""})

    # ensure model is initialized
    if not getattr(modelutils, 'client', None) or not getattr(modelutils, 'model_name', None):
        return jsonify({"error": "Generative model not configured on server"}), 503

    # Build a concise prompt asking for a MAXIMUM 500-word overall summary. Ask the model to return ONLY the summary.
    prompt = (
        helpers.COPING_SYSTEM_PROMPT + "\n"
        "You are an expert clinical summarizer. Produce a clear, neutral, single overall summary of the chat history below intended for a counsellor. "
        "The summary MUST be no more than 500 words (strict maximum). Do NOT invent details; only summarize the content present. "
        "Output ONLY the summary text, do not include headings, metadata, or commentary. If there are multiple sessions, synthesize them into one coherent assessment.\n\nConversation:\n"
        + convo + "\n\nSummary (MAX 500 words):"
    )

    # Use a simple cache key to avoid repeated model calls on the same conversation

    key_source = (email or '') + '|' + (session_id or '') + '|' + \
        hashlib.sha256(convo.encode('utf-8')).hexdigest()
    cache_entry = CHAT_SUMMARY_CACHE.get(key_source)
    if cache_entry and (time.time() - cache_entry.get('ts', 0) < CHAT_SUMMARY_CACHE_TTL):
        return jsonify({'summary': cache_entry.get('summary', '')})

    # Try generating the summary; handle quota errors gracefully and return a fallback summary
    try:
        summary = modelutils.generate_coping_text(prompt)
        # store in cache
        try:
            CHAT_SUMMARY_CACHE[key_source] = {
                'summary': summary, 'ts': time.time()}
        except Exception:
            pass
        return jsonify({"summary": summary})
    except Exception as e:
        # Detect quota / rate limit messages and return a clear fallback instead of 500
        err_str = str(e) or ''
        # try to extract retry delay in seconds
        retry_after = None
        try:
            m = re.search(r'retry in (\d+(?:\.\d+)?)s', err_str)
            if m:
                retry_after = float(m.group(1))
        except Exception:
            pass
        # Provide a short fallback summary that is safe and non-creative
        fallback = "Summary temporarily unavailable due to model quota limits. Please try again later."
        payload = {"summary": fallback,
                   "warning": "model_unavailable", "model_error": err_str}
        if retry_after is not None:
            payload['retry_after_seconds'] = retry_after
        # return 200 so frontend can display a helpful message instead of an error
        return jsonify(payload), 200


@bp.route('/api/summaries', methods=['POST', 'OPTIONS'])
def api_summaries():
    """Generate Gemini-backed summaries for PHQ-9 entries, forum posts, resource finder history, and optional chat messages.

    Accepts JSON body with optional keys: `phqEntries`, `posts`, `resources`, `chatMsgs`, and `userMeta`.
    Returns: { summary: str }
    """
    if request.method == 'OPTIONS':
        return '', 204
    data = request.get_json() or {}
    phq_entries = data.get('phqEntries') or data.get('phq_entries') or []
    posts = data.get('posts') or []
    resources_list = data.get('resources') or []
    chat_msgs = data.get('chatMsgs') or data.get('chat_msgs') or []
    user_meta = data.get('userMeta') or data.get('user_meta') or {}

    # If nothing supplied, complain
    if not (phq_entries or posts or resources_list or chat_msgs):
        return jsonify({'error': 'Provide at least one of phqEntries, posts, resources, or chatMsgs'}), 400

    # Ensure model is initialized
    if not getattr(modelutils, 'client', None) or not getattr(modelutils, 'model_name', None):
        return jsonify({"error": "Generative model not configured on server"}), 503

    # Truncate/excerpt inputs to reasonable sizes for the prompt
    try:
        phq_excerpt = []
        for p in (phq_entries or [])[:5]:
            ts = p.get('timestamp') or p.get('submittedAt') or ''
            score = p.get('total_score') or p.get('totalScore') or ''
            phq_excerpt.append(f"{ts} — Score: {score}")
    except Exception:
        phq_excerpt = ['No PHQ-9 entries available']

    try:
        posts_excerpt = []
        for p in (posts or [])[:10]:
            title = (p.get('title') or p.get('subject')
                     or '').strip() or '(no title)'
            body = (p.get('content') or p.get('body') or '')
            # short preview
            preview = (body or '').replace('\n', ' ').strip()[:300]
            posts_excerpt.append(f"{title}: {preview}")
    except Exception:
        posts_excerpt = ['No forum posts available']

    try:
        resources_excerpt = []
        for r in (resources_list or [])[:20]:
            title = r.get('title') or r.get('name') or str(r)
            typ = r.get('type') or r.get('category') or 'other'
            lang = r.get('language') or 'unknown'
            resources_excerpt.append(f"- {title} ({typ}, {lang})")
    except Exception:
        resources_excerpt = ['No resources available']

    try:
        chat_excerpt = []
        for m in (chat_msgs or [])[-40:]:
            who = m.get('from') or m.get('role') or ''
            t = (m.get('text') or m.get('message') or m.get('content') or '')
            chat_excerpt.append(f"[{who}] {str(t)[:300]}")
    except Exception:
        chat_excerpt = ['No chat history available']

    # Build the model prompt
    prompt_sections = []
    prompt_sections.append(
        f"Client name: {user_meta.get('name') or user_meta.get('userName') or 'Unknown'}")
    prompt_sections.append(
        f"Email: {user_meta.get('email') or user_meta.get('user_email') or 'Unknown'}")
    prompt_sections.append('\nPHQ-9 entries:')
    prompt_sections.extend(phq_excerpt or ['No PHQ-9 entries found.'])
    prompt_sections.append('\nForum posts (title: preview):')
    prompt_sections.extend(posts_excerpt or ['No forum posts found.'])
    prompt_sections.append('\nResource interactions:')
    prompt_sections.extend(resources_excerpt or ['No resources found.'])
    prompt_sections.append('\nRecent chat messages (most recent last):')
    prompt_sections.extend(chat_excerpt or ['No chat history found.'])

    model_prompt = (
        helpers.COPING_SYSTEM_PROMPT + "\n" +
        "You are an expert clinical summarizer. Using ONLY the data below, produce clear, neutral, counselor-facing summaries for each section: 'PHQ-9 Summary', 'Forum Posts', 'Resource Finder'. \n"
        "For each section output a short Markdown header (e.g., '## PHQ-9 Summary') followed by 3-5 concise bullet points. Do NOT invent facts or add content not present in the data. Keep language neutral and avoid diagnostic conclusions. Limit output to approximately one page. Output ONLY the Markdown text.\n\n"
        "DATA:\n" + "\n".join(prompt_sections) +
        "\n\nProduce the summaries now."
    )

    try:
        summary = modelutils.generate_coping_text(model_prompt)
    except Exception as e:
        return jsonify({"error": "Model generation failed", "details": str(e)}), 500

    return jsonify({'summary': summary}), 200


@bp.route('/api/chat/session/<session_id>', methods=['DELETE', 'OPTIONS'])
def api_chat_session_delete(session_id):
    if request.method == 'OPTIONS':
        return '', 204
    try:
        ok = dbutils.delete_chat_session(session_id)
        if ok:
            return jsonify({"ok": True}), 200
        return jsonify({"error": "not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route('/api/chat/init', methods=['GET'])
def api_chat_init():
    """Return a model-generated opening message for the chatbot (no hardcoded content)."""
    # Construct a prompt instructing the model to produce a concise friendly greeting, using the counseling persona
    prompt = (
        helpers.COPING_SYSTEM_PROMPT + "\n" +
        "Provide a short, welcoming opening message (one or two sentences) that invites the user to share how they're feeling. "
        "Keep the tone warm, approachable, and student-friendly. Avoid medical claims and do not reference internal system names."
    )
    try:
        text = modelutils.generate_coping_text(prompt)
    except Exception as e:
        return jsonify({"error": "Model generation failed", "details": str(e)}), 500
    return jsonify({"response": text})


@bp.route('/api/phq9', methods=['GET', 'POST', 'OPTIONS'])
def phq9_post():
    # Support GET for listing all PHQ-9 submissions and POST for adding a new one.
    if request.method == 'OPTIONS':
        return '', 204

    if request.method == 'GET':
        # Return all PHQ-9 documents (db-backed if available, otherwise in-memory)
        coll = dbutils.get_phq9_collection()
        docs = []
        if coll is not None:
            docs = list(coll.find().sort([('timestamp', -1)]).limit(2000))
            out = []
            for d in docs:
                dd = dict(d)
                if '_id' in dd:
                    try:
                        dd['id'] = str(dd.pop('_id'))
                    except Exception:
                        dd.pop('_id', None)
                try:
                    if 'timestamp' in dd and hasattr(dd['timestamp'], 'isoformat'):
                        dd['timestamp'] = dd['timestamp'].isoformat()
                except Exception:
                    pass
                out.append(dd)
            return jsonify({'phq9_responses': out})

        # No DB configured -> return in-memory responses if present
        out = []
        if hasattr(dbutils, 'phq9_in_memory'):
            for d in dbutils.phq9_in_memory:
                dd = d.copy()
                try:
                    if 'timestamp' in dd and hasattr(dd['timestamp'], 'isoformat'):
                        dd['timestamp'] = dd['timestamp'].isoformat()
                except Exception:
                    pass
                out.append(dd)
        return jsonify({'phq9_responses': out})

    # POST path (create new submission)
    data = request.get_json() or {}
    user_email = data.get('user_email')
    answers = data.get('answers')
    if not user_email or not isinstance(answers, list) or len(answers) != 9:
        return jsonify({"error": "user_email and answers[9] are required"}), 400
    try:
        answers_int = [int(x) for x in answers]
    except Exception:
        return jsonify({"error": "answers must be integers"}), 400
    total_score = sum(answers_int)
    now = datetime.utcnow()
    doc = {"user_email": user_email.lower(), "timestamp": now,
           "answers": answers_int, "total_score": total_score}
    if dbutils.insert_phq9(doc):
        return jsonify({"ok": True}), 201
    if not hasattr(dbutils, 'phq9_in_memory'):
        dbutils.phq9_in_memory = []
    dbutils.phq9_in_memory.insert(0, doc)
    return jsonify(doc), 201


@bp.route('/api/phq9/<email>', methods=['GET', 'OPTIONS'])
def phq9_get_latest(email):
    if request.method == 'OPTIONS':
        return '', 204
    doc = dbutils.find_latest_phq9(email)
    if doc:
        # copy and convert non-JSON types (ObjectId, datetime)
        safe = dict(doc)
        if '_id' in safe:
            try:
                safe['id'] = str(safe.pop('_id'))
            except Exception:
                safe.pop('_id', None)
        try:
            if 'timestamp' in safe and hasattr(safe['timestamp'], 'isoformat'):
                safe['timestamp'] = safe['timestamp'].isoformat()
        except Exception:
            pass
        return jsonify(safe)
    if hasattr(dbutils, 'phq9_in_memory'):
        for d in dbutils.phq9_in_memory:
            if d.get('user_email') == email.lower():
                d2 = d.copy()
                try:
                    if 'timestamp' in d2 and hasattr(d2['timestamp'], 'isoformat'):
                        d2['timestamp'] = d2['timestamp'].isoformat()
                except Exception:
                    pass
                return jsonify(d2)
    return jsonify({}), 200


@bp.route('/api/bookings', methods=['GET', 'POST'])
def api_bookings():
    if request.method == 'POST':
        data = request.get_json() or {}
        entry = {"id": int(datetime.utcnow().timestamp(
        ) * 1000), "name": data.get('name', 'anonymous'), "time": data.get('time')}
        bookings.insert(0, entry)
        return jsonify({"ok": True, "id": entry['id']}), 201
    return jsonify({"bookings": bookings})


@bp.route('/api/summarize', methods=['POST'])
def api_summarize():
    if request.method == 'POST':
        # Lightweight request logging to help debug intermittent 400s from the frontend
        try:
            data = request.get_json(force=False) or {}
        except Exception as _e:
            # If JSON parsing fails, capture raw body for debugging and return default points
            raw = (request.get_data() or b'').decode('utf-8', errors='replace')
            print(f"[api_summarize] JSON parse error, raw body: {raw[:200]}")
            data = {}

        # Log a brief summary of incoming payload for debugging (do not log secrets)
        try:
            keys = list(data.keys()) if isinstance(data, dict) else []
            
        except Exception:
            print("[api_summarize] Received payload (unreadable)")
        text = data.get('text')
        section = data.get('section', '')

        # If no content is provided, return default placeholder points rather than a 400
        if not text:
            default_points = [
                "No data available for this section.",
                "No data available for this section.",
                "No data available for this section.",
                "No data available for this section.",
                "No data available for this section."
            ]
            return jsonify({"points": default_points}), 200

        # Different prompt templates for different section types
        prompts = {
            'chat': """You are a clinical data analyst summarizing chat interactions. Create exactly 5 concise but detailed observations about this chat history. Each point should be a complete sentence focused on patterns, themes, or notable interactions. Avoid diagnostic language or personal interpretations.

IMPORTANT RULES:
- Start each point directly with the observation (no bullet points or numbers)
- Each point should be a single complete sentence
- Focus on objective patterns and factual content
- Do not include formatting instructions or meta-commentary
- Avoid phrases like "the user shows" or "demonstrates"
- Do not use markdown formatting or special characters

Chat History:
{text}

5 observation points:""",

            'peer': """You are a clinical data analyst summarizing forum participation. Create exactly 5 concise but detailed observations about these forum posts. Each point should be a complete sentence focused on topics discussed, engagement patterns, and types of interactions. Avoid diagnostic language or personal interpretations.

IMPORTANT RULES:
- Start each point directly with the observation (no bullet points or numbers)
- Each point should be a single complete sentence
- Focus on objective patterns and factual content
- Do not include formatting instructions or meta-commentary
- Avoid phrases like "the user shows" or "demonstrates"
- Do not use markdown formatting or special characters

Forum Posts:
{text}

5 observation points:""",

            'resources': """You are a clinical data analyst summarizing resource usage patterns. Create exactly 5 concise but detailed observations about these resource interactions. Each point should be a complete sentence focused on types of resources accessed, topics of interest, and engagement patterns. Avoid diagnostic language or personal interpretations.

IMPORTANT RULES:
- Start each point directly with the observation (no bullet points or numbers)
- Each point should be a single complete sentence
- Focus on objective patterns and factual content
- Do not include formatting instructions or meta-commentary
- Avoid phrases like "the user shows" or "demonstrates"
- Do not use markdown formatting or special characters

Resource History:
{text}

5 observation points:""",

            'phq9': """You are a clinical data analyst summarizing PHQ-9 screening data. Create exactly 5 concise but detailed observations about these screening results. Each point should be a complete sentence focused on score patterns, changes over time, and response consistencies. Avoid diagnostic language or personal interpretations.

IMPORTANT RULES:
- Start each point directly with the observation (no bullet points or numbers)
- Each point should be a single complete sentence
- Focus on objective patterns and factual content
- Do not include formatting instructions or meta-commentary
- Avoid phrases like "the user shows" or "demonstrates"
- Do not use markdown formatting or special characters

PHQ-9 History:
{text}

5 observation points:"""
        }

        # Get the appropriate prompt template or use a generic one
        prompt_template = prompts.get(section, """Generate 5 detailed bullet points summarizing the following information. 
Each point should be a complete, informative statement:

{text}

Generate 5 detailed bullet points:""")

        # Prepare text for the prompt
        if isinstance(text, (list, tuple)):
            try:
                # Convert list items to string representation
                # If elements are dict-like, attempt to stringify important fields for the model
                parts = []
                for item in text:
                    if isinstance(item, dict):
                        # try common fields
                        t = item.get('content') or item.get('text') or item.get(
                            'message') or item.get('title') or item.get('name') or str(item)
                        parts.append(str(t))
                    else:
                        parts.append(str(item))
                text_str = "\n".join(parts)
            except Exception:
                # On failure, return default placeholder rather than a 400 so frontend can still build a report
                default_points = [
                    "No data available for this section.",
                    "No data available for this section.",
                    "No data available for this section.",
                    "No data available for this section.",
                    "No data available for this section."
                ]
                return jsonify({"points": default_points}), 200
        else:
            text_str = str(text)

        try:
            # Ensure model is initialized before calling into modelutils
            if not getattr(modelutils, 'client', None) or not getattr(modelutils, 'model_name', None):
                print('[api_summarize] modelutils not initialized')
                return jsonify({"error": "model not initialized"}), 503

            # Generate summary using Gemini
            prompt = prompt_template.format(text=text_str)
            response = None
            try:
                response = modelutils.generate_coping_text(prompt)
            except Exception as _model_err:
                # Print full traceback to server logs for debugging
                _tb.print_exc()
                # Provide a safe fallback to the frontend so the UI can render a report
                # without surfacing a 500. Include a warning and any retry hint if detectable.
                err_str = str(_model_err) or ""
                # default fallback points (5)
                default_points = [
                    "No data available for this section.",
                    "No data available for this section.",
                    "No data available for this section.",
                    "No data available for this section.",
                    "No data available for this section."
                ]
                # Try to extract a retry delay from provider error messages (e.g., "retry in 9.09s")
                retry_after = None
                try:
                    m = re.search(r'retry in (\d+(?:\.\d+)?)s', err_str)
                    if m:
                        retry_after = float(m.group(1))
                except Exception:
                    pass
                payload = {"points": default_points,
                           "warning": "Model generation failed; returning fallback points.", "model_error": err_str}
                if retry_after is not None:
                    payload["retry_after_seconds"] = retry_after
                # Return 200 so frontend can render the fallback seamlessly
                return jsonify(payload), 200

            # Process response to extract clean points
            points = []
            for line in response.split('\n'):
                line = line.strip()
                # Skip empty lines, headers, and meta-text
                if not line or line.startswith('#') or line.lower().startswith(('here are', 'observation', 'generate', 'bullet')):
                    continue

                # Clean up common formatting
                line = line.lstrip('- •*').strip()
                line = line.replace('**', '').replace('*',
                                                      '').replace('\\', '')

                # Skip if the line is too short or is a meta-instruction
                if len(line) < 10 or line.lower().startswith(('each point', 'the following', 'points:', 'summarize')):
                    continue

                points.append(line)

            # Ensure exactly 5 points
            points = [p for p in points if not p.lower().startswith(
                'no additional')]  # Remove placeholder text
            if len(points) > 5:
                points = points[:5]
            while len(points) < 5:
                if len(points) == 0:
                    points.append(
                        "Insufficient data available for meaningful analysis.")
                else:
                    points.append(
                        "Additional aspects of interaction not observed in the available data.")

            return jsonify({"points": points})

        except Exception as e:
            return jsonify({"error": str(e)}), 500

    return jsonify({"error": "Method not allowed"}), 405


@bp.route('/api/resources', methods=['GET', 'POST'])
def api_resources():
    if request.method == 'POST':
        data = request.get_json() or {}
        title = data.get('title')
        if not title:
            return jsonify({"error": "title required"}), 400
        item = {"id": int(datetime.utcnow().timestamp() * 1000), "title": title, "type": data.get(
            'type', 'guide'), "language": data.get('language', 'English'), "url": data.get('url', '')}
        resources.insert(0, item)
        return jsonify(item), 201
    return jsonify({"resources": resources})


@bp.route('/api/resource-searches', methods=['GET', 'POST', 'OPTIONS'])
def api_resource_searches():
    """Record and retrieve resource search events.

    GET: ?email=... returns { searches: [ { query, context?, timestamp, id? }, ... ] }
    POST: { email?, query: str, context?: any } -> stores search event and returns 201
    """
    if request.method == 'OPTIONS':
        # Respond to CORS preflight explicitly with no content
        return '', 204

    if request.method == 'POST':
        data = request.get_json() or {}
        q = data.get('query') or data.get('q') or data.get('term')
        if not q or not str(q).strip():
            return jsonify({'error': 'missing_query'}), 400
        email = data.get('email') or data.get('user_email') or None
        record = {
            'user_email': email.lower() if isinstance(email, str) else None,
            'query': str(q),
            'context': data.get('context') or None,
            'timestamp': datetime.utcnow()
        }
        try:
            # If MongoDB is configured, persist there
            coll = getattr(dbutils, 'mongo_db', None)
            if coll is not None:
                try:
                    # Use a collection
                    rc = coll[RESOURCES_RECORD_COLLECTION_NAME]
                    res = rc.insert_one(record)
                    return jsonify({'ok': True}), 201
                except Exception:
                    # fall back to in-memory on any persistence error
                    pass
        except Exception:
            pass

        # In-memory fallback
        try:
            resource_searches.insert(0, record)
        except Exception:
            # ensure variable exists
            globals()['resource_searches'] = [record]
        try:
            print(
                f"[resource-search] saved in-memory user={record.get('user_email')} query={record.get('query')}")
        except Exception:
            pass
        return jsonify({'ok': True}), 201

    # GET -> list searches for an email (most recent first)
    email = (request.args.get('email') or None)
    email_lower = None
    if isinstance(email, str):
        email_lower = email.lower()

    out = []
    try:
        coll = getattr(dbutils, 'mongo_db', None)
        if coll is not None:
            rc = coll[RESOURCES_RECORD_COLLECTION_NAME]
            query = {}
            if email_lower:
                query['user_email'] = email_lower
            docs = list(rc.find(query).sort([('timestamp', -1)]).limit(200))
            for d in docs:
                rec = dict(d)
                try:
                    rec['id'] = str(rec.pop('_id'))
                except Exception:
                    rec.pop('_id', None)
                # convert timestamp
                try:
                    if 'timestamp' in rec and hasattr(rec['timestamp'], 'isoformat'):
                        rec['timestamp'] = rec['timestamp'].isoformat()
                except Exception:
                    pass
                out.append(rec)
            return jsonify({'searches': out})
    except Exception:
        pass

    # In-memory fallback
    store = globals().get('resource_searches') or []
    for r in store:
        if email_lower and r.get('user_email') and r.get('user_email') != email_lower:
            continue
        rec = dict(r)
        try:
            if 'timestamp' in rec and hasattr(rec['timestamp'], 'isoformat'):
                rec['timestamp'] = rec['timestamp'].isoformat()
        except Exception:
            pass
        out.append(rec)
    return jsonify({'searches': out})


@bp.route('/api/posts', methods=['GET', 'POST', 'DELETE', 'OPTIONS'])
def api_posts():
    """Return or create forum posts. Persists to Mongo DB when configured.

    POST body expected JSON: { mail|email?: str, title?: str, post|content?: str, timestamp?: str }
    GET returns { posts: [ ... ] } newest-first irrespective of mail.
    """

    # Handle CORS preflight quickly
    if request.method == 'OPTIONS':
        return

    # DELETE -> remove a post (Mongo when available, otherwise in-memory)
    if request.method == 'DELETE':
        data = request.get_json() or {}
        post_id = data.get('id') or data.get('postId') or None
        email = data.get('email') or data.get('mail') or None
        createdAt = data.get('createdAt') or data.get('timestamp') or None

        # Debug logging to help tests / developer understand matching path
        print(
            f"[api_posts:DELETE] incoming id={post_id} email={email} createdAt={createdAt}")

        # Normalize createdAt: accept JS trailing 'Z' and try to parse to datetime
        created_at_dt = None
        if isinstance(createdAt, str):
            try:
                s = createdAt
                if s.endswith('Z'):
                    s = s[:-1] + '+00:00'
                created_at_dt = datetime.fromisoformat(s)
                # convert aware -> naive UTC
                try:
                    if created_at_dt.tzinfo is not None:
                        created_at_dt = created_at_dt.astimezone(
                            _tz.utc).replace(tzinfo=None)
                except Exception:
                    try:
                        created_at_dt = created_at_dt.replace(tzinfo=None)
                    except Exception:
                        pass
            except Exception:
                created_at_dt = None
        elif hasattr(createdAt, 'isoformat'):
            created_at_dt = createdAt

        # Try DB-backed deletion first
        try:
            mongo_db = getattr(dbutils, 'mongo_db', None)
            if mongo_db is not None:
                coll = None
                try:
                    coll = mongo_db.get_collection(PEER_COLLECTION_NAME)
                except Exception:
                    try:
                        coll = mongo_db[PEER_COLLECTION_NAME]
                    except Exception:
                        coll = None

                if coll is not None:
                    # import ObjectId if available
                    try:
                        from bson.objectid import ObjectId
                    except Exception:
                        ObjectId = None

                    # 1) Try delete by _id (ObjectId) when possible
                    if post_id and ObjectId:
                        try:
                            if isinstance(post_id, str) and len(post_id) == 24:
                                oid = ObjectId(post_id)
                                found = coll.find_one({'_id': oid}, {'_id': 1})
                                if found:
                                    res = coll.delete_one({'_id': oid})
                                    print(
                                        f"[api_posts:DELETE] deleted by _id (ObjectId) oid={oid} count={getattr(res,'deleted_count',0)}")
                                    if getattr(res, 'deleted_count', 0) > 0:
                                        return jsonify({'deleted': True}), 200
                        except Exception as e:
                            return jsonify({'error': 'invalid id format'}), 400

                    # 2) Try delete by stored string 'id' field
                    if post_id:
                        try:
                            found = coll.find_one({'id': post_id}, {'_id': 1})
                            if found:
                                res = coll.delete_one({'id': post_id})
                                
                                if getattr(res, 'deleted_count', 0) > 0:
                                    return jsonify({'deleted': True}), 200
                        except Exception as e:
                            return jsonify({'error': 'invalid id format'}), 400

                    # 3) If email+createdAt provided, try matching that (createdAt may be datetime or string)
                    if email and created_at_dt is not None:
                        try:
                            query = {'email': email.lower(
                            ), 'createdAt': created_at_dt}
                            found = coll.find_one(query, {'_id': 1})
                            if found:
                                res = coll.delete_one(query)
                                print(
                                    f"[api_posts:DELETE] deleted by email+createdAt query count={getattr(res,'deleted_count',0)}")
                                if getattr(res, 'deleted_count', 0) > 0:
                                    return jsonify({'deleted': True}), 200
                        except Exception as e:
                            print(
                                '[api_posts:DELETE] email+createdAt route failed', e)

                    # 4) If createdAt was a string we couldn't parse, scan same-email docs and compare createdAt isoformats
                    if isinstance(createdAt, str) and email:
                        try:
                            cursor = coll.find(
                                {'email': email.lower()}, {'createdAt': 1})
                            for d in cursor.limit(2000):
                                ca = d.get('createdAt')
                                try:
                                    ca_iso = ca.isoformat() if hasattr(ca, 'isoformat') else str(ca)
                                except Exception:
                                    ca_iso = str(ca)
                                # Accept both variants with or without trailing Z
                                if ca_iso == createdAt or (ca_iso + 'Z') == createdAt or (createdAt.endswith('Z') and createdAt[:-1] == ca_iso):
                                    try:
                                        res = coll.delete_one(
                                            {'_id': d.get('_id')})
                                        print(
                                            f"[api_posts:DELETE] deleted by email+createdAt-iso match _id={d.get('_id')} count={getattr(res,'deleted_count',0)}")
                                        if getattr(res, 'deleted_count', 0) > 0:
                                            return jsonify({'deleted': True}), 200
                                    except Exception:
                                        pass
                        except Exception as e:
                            print(
                                '[api_posts:DELETE] scan-by-email route failed', e)

                    # 5) Fallback: scan a limited set and match stringified _id
                    if post_id:
                        try:
                            for d in coll.find({}, {'_id': 1}).limit(2000):
                                if str(d.get('_id')) == str(post_id):
                                    res = coll.delete_one(
                                        {'_id': d.get('_id')})
                                    print(
                                        f"[api_posts:DELETE] deleted by scan _id match count={getattr(res,'deleted_count',0)}")
                                    if getattr(res, 'deleted_count', 0) > 0:
                                        return jsonify({'deleted': True}), 200
                        except Exception as e:
                            print('[api_posts:DELETE] final-scan route failed', e)

        except Exception as e:
            print('[api_posts:DELETE] mongo block failed', e)

        # In-memory fallback removal (peer_posts)
        store = globals().get('peer_posts') or []
        removed = False
        try:
            for i, p in enumerate(list(store)):
                # 1) Prefer explicit id match (client-side local ids allowed)
                if post_id and (str(p.get('id') or '') == str(post_id) or str(p.get('_id') or '') == str(post_id)):
                    try:
                        store.pop(i)
                    except Exception:
                        pass
                    removed = True
                    break

                # 2) Match on email + createdAt: compare ISO timestamps when possible
                if email and createdAt:
                    p_email = (p.get('email') or '').lower()
                    if p_email == str(email).lower():
                        p_created = p.get('createdAt')
                        try:
                            p_created_str = p_created.isoformat() if hasattr(
                                p_created, 'isoformat') else str(p_created)
                        except Exception:
                            p_created_str = str(p_created)

                        if isinstance(createdAt, str):
                            if p_created_str == createdAt or (p_created_str + 'Z') == createdAt or (createdAt.endswith('Z') and createdAt[:-1] == p_created_str):
                                try:
                                    store.pop(i)
                                except Exception:
                                    pass
                                removed = True
                                break
                        else:
                            try:
                                if hasattr(createdAt, 'isoformat') and p_created_str == createdAt.isoformat():
                                    try:
                                        store.pop(i)
                                    except Exception:
                                        pass
                                    removed = True
                                    break
                            except Exception:
                                pass
        except Exception:
            removed = False

        if removed:
            print('[api_posts:DELETE] removed from in-memory store')
            return jsonify({'deleted': True}), 200
        print('[api_posts:DELETE] not found')
        return jsonify({'deleted': False}), 404

    # Create a new post
    if request.method == 'POST':
        data = request.get_json() or {}
        # accept multiple field names for compatibility
        email = data.get('mail') or data.get(
            'email') or data.get('user_email') or None
        title = (data.get('title') or '').strip()
        post_text = (data.get('post') or data.get('content')
                     or data.get('text') or '').strip()
        timestamp = data.get('timestamp') or data.get('createdAt') or None

        # normalize email
        if isinstance(email, str):
            email = email.lower()
        else:
            email = None

        # require at least some content
        if not post_text and not title:
            return jsonify({'error': 'empty_post'}), 400

        # build doc
        try:
            if timestamp and isinstance(timestamp, str):
                try:
                    s = timestamp
                    if s.endswith('Z'):
                        s = s[:-1] + '+00:00'
                    created_at = datetime.fromisoformat(s)
                    # normalize to naive UTC (we store naive datetimes)
                    try:
                        if created_at.tzinfo is not None:
                            from datetime import timezone as _tz
                            created_at = created_at.astimezone(
                                _tz.utc).replace(tzinfo=None)
                    except Exception:
                        try:
                            created_at = created_at.replace(tzinfo=None)
                        except Exception:
                            pass
                except Exception:
                    created_at = datetime.utcnow()
            elif timestamp and hasattr(timestamp, 'isoformat'):
                created_at = timestamp
            else:
                created_at = datetime.utcnow()
        except Exception:
            created_at = datetime.utcnow()

        # capture optional author field from client payload
        author = data.get('author') or data.get(
            'authorName') or data.get('name') or None

        doc = {
            'email': email,
            'title': title or '(Untitled)',
            # store both `post` and `content` to remain compatible with different clients
            'post': post_text,
            'content': post_text,
            'author': author,
            'createdAt': created_at
        }

        # Try to persist to Mongo if configured
        try:
            mongo_db = getattr(dbutils, 'mongo_db', None)
            if mongo_db is not None:
                coll = mongo_db[PEER_COLLECTION_NAME]
                # Insert the document; then persist a string `id` equal to the inserted ObjectId
                res = coll.insert_one(doc)
                # Best-effort: write the string id back into the stored document so clients can delete by `id` field
                try:
                    str_id = str(res.inserted_id)
                    try:
                        coll.update_one({'_id': res.inserted_id}, {
                                        '$set': {'id': str_id}}, upsert=False)
                    except Exception:
                        # If the update fails for any reason, continue - deletion by ObjectId will still work
                        pass
                except Exception:
                    str_id = None

                # Build a JSON-safe output dict: convert datetimes and ObjectIds to strings
                out = {}
                try:
                    from bson.objectid import ObjectId
                except Exception:
                    ObjectId = None

                for k, v in (doc or {}).items():
                    try:
                        if k == '_id':
                            # skip raw _id if present
                            continue
                        if ObjectId is not None and isinstance(v, ObjectId):
                            out[k] = str(v)
                        elif hasattr(v, 'isoformat'):
                            try:
                                out[k] = v.isoformat()
                            except Exception:
                                out[k] = str(v)
                        else:
                            out[k] = v
                    except Exception:
                        try:
                            out[k] = str(v)
                        except Exception:
                            out[k] = None

                # ensure id field is present and is a string
                try:
                    out['id'] = str_id
                except Exception:
                    out['id'] = None

                # ensure likes metadata present
                try:
                    out['liked_by'] = doc.get('liked_by') or []
                except Exception:
                    out['liked_by'] = []
                try:
                    out['likes_count'] = len(out.get('liked_by') or [])
                except Exception:
                    out['likes_count'] = 0

                return jsonify(out), 201
        except Exception:
            # fall back to in-memory store below
            pass

        # in-memory fallback
        store = globals().get('peer_posts') or []
        # assign an id for optimistic/local use
        local_id = f"local-{int(datetime.utcnow().timestamp() * 1000)}"
        doc_local = dict(doc)
        doc_local['id'] = local_id
        # likes metadata for in-memory posts
        doc_local['liked_by'] = doc_local.get('liked_by') or []
        doc_local['likes_count'] = len(doc_local['liked_by'])
        store.insert(0, doc_local)
        globals()['peer_posts'] = store
        out = dict(doc_local)
        try:
            if hasattr(out['createdAt'], 'isoformat'):
                out['createdAt'] = out['createdAt'].isoformat()
        except Exception:
            pass
        return jsonify(out), 201

    # GET -> return all posts (newest-first)
    out = []
    try:
        mongo_db = getattr(dbutils, 'mongo_db', None)
        # optional email filter (server-side) - exact match on stored email field
        q_email = (request.args.get('email')
                   or request.args.get('mail') or None)
        if isinstance(q_email, str):
            q_email = q_email.strip().lower()
        else:
            q_email = None

        if mongo_db is not None:
            coll = mongo_db[PEER_COLLECTION_NAME]
            query = {}
            if q_email:
                query['email'] = q_email
            docs = list(coll.find(query).sort([('createdAt', -1)]).limit(1000))
            for d in docs:
                item = dict(d)
                try:
                    item['id'] = str(item.pop('_id'))
                except Exception:
                    item.pop('_id', None)
                try:
                    if 'createdAt' in item and hasattr(item['createdAt'], 'isoformat'):
                        item['createdAt'] = item['createdAt'].isoformat()
                except Exception:
                    pass
                    # expose likes metadata
                    try:
                        lb = item.get('liked_by') or item.get('likedBy') or []
                        item['liked_by'] = lb
                        item['likes_count'] = len(lb) if isinstance(
                            lb, (list, tuple)) else 0
                    except Exception:
                        item['liked_by'] = []
                        item['likes_count'] = 0
                out.append(item)
            return jsonify({'posts': out})
    except Exception:
        # fall back to in-memory
        pass

    # In-memory fallback
    store = globals().get('peer_posts') or []
    for p in store:
        item = dict(p)
        # ensure createdAt is serializable
        try:
            if 'createdAt' in item and hasattr(item['createdAt'], 'isoformat'):
                item['createdAt'] = item['createdAt'].isoformat()
        except Exception:
            pass
        try:
            lb = item.get('liked_by') or item.get('likedBy') or []
            item['liked_by'] = lb
            item['likes_count'] = len(lb) if isinstance(
                lb, (list, tuple)) else 0
        except Exception:
            item['liked_by'] = []
            item['likes_count'] = 0
        out.append(item)
    return jsonify({'posts': out})


@bp.route('/api/posts/like', methods=['POST', 'OPTIONS'])
def api_posts_like():
    """Toggle like/unlike for a post.

    Body: { id: string, email: string, action: 'like'|'unlike' }
    Returns: { ok: True, id: ..., likes_count: int, liked: bool }
    """
    if request.method == 'OPTIONS':
        return '', 204

    data = request.get_json() or {}
    post_id = data.get('id') or data.get('postId') or None
    email = data.get('email') or data.get('user_email') or None
    action = (data.get('action') or '').lower() or None

    if not post_id or not email or action not in ('like', 'unlike'):
        return jsonify({'error': 'id, email and action (like|unlike) required'}), 400

    email_l = email.lower() if isinstance(email, str) else email

    # Try Mongo first
    try:
        mongo_db = getattr(dbutils, 'mongo_db', None)
        if mongo_db is not None:
            coll = mongo_db.get_collection(PEER_COLLECTION_NAME)
            try:
                from bson.objectid import ObjectId
            except Exception:
                ObjectId = None

            # locate by _id (ObjectId)
            if ObjectId and isinstance(post_id, str) and len(post_id) == 24:
                try:
                    oid = ObjectId(post_id)
                    if action == 'like':
                        coll.update_one(
                            {'_id': oid}, {'$addToSet': {'liked_by': email_l}})
                    else:
                        coll.update_one(
                            {'_id': oid}, {'$pull': {'liked_by': email_l}})
                    doc = coll.find_one({'_id': oid}, {'liked_by': 1})
                    lb = doc.get('liked_by') if doc else []
                    return jsonify({'ok': True, 'id': post_id, 'likes_count': len(lb or []), 'liked': email_l in (lb or [])}), 200
                except Exception:
                    pass

            # locate by stored id field
            try:
                found = coll.find_one(
                    {'id': post_id}, {'_id': 1, 'liked_by': 1})
                if found:
                    if action == 'like':
                        coll.update_one({'id': post_id}, {
                                        '$addToSet': {'liked_by': email_l}})
                    else:
                        coll.update_one({'id': post_id}, {
                                        '$pull': {'liked_by': email_l}})
                    doc = coll.find_one({'id': post_id}, {'liked_by': 1})
                    lb = doc.get('liked_by') if doc else []
                    return jsonify({'ok': True, 'id': post_id, 'likes_count': len(lb or []), 'liked': email_l in (lb or [])}), 200
            except Exception:
                pass

            # fallback: scan by stringified _id
            try:
                for d in coll.find({}, {'_id': 1, 'liked_by': 1}).limit(2000):
                    if str(d.get('_id')) == str(post_id):
                        if action == 'like':
                            coll.update_one({'_id': d.get('_id')}, {
                                            '$addToSet': {'liked_by': email_l}})
                        else:
                            coll.update_one({'_id': d.get('_id')}, {
                                            '$pull': {'liked_by': email_l}})
                        doc = coll.find_one(
                            {'_id': d.get('_id')}, {'liked_by': 1})
                        lb = doc.get('liked_by') if doc else []
                        return jsonify({'ok': True, 'id': post_id, 'likes_count': len(lb or []), 'liked': email_l in (lb or [])}), 200
            except Exception:
                pass

    except Exception:
        pass

    # In-memory fallback
    try:
        store = globals().get('peer_posts') or []
        for p in store:
            pid = p.get('id') or str(p.get('_id') or '')
            if str(pid) == str(post_id) or (not pid and str(p.get('email')) + '-' + str(p.get('createdAt')) == str(post_id)):
                lb = p.get('liked_by') or []
                if action == 'like':
                    if email_l not in [x.lower() for x in lb]:
                        lb = lb + [email_l]
                else:
                    lb = [x for x in lb if str(
                        x).lower() != str(email_l).lower()]
                p['liked_by'] = lb
                p['likes_count'] = len(lb)
                return jsonify({'ok': True, 'id': post_id, 'likes_count': p['likes_count'], 'liked': email_l in [x.lower() for x in lb]}), 200
    except Exception:
        pass

    return jsonify({'error': 'not found'}), 404


@bp.route('/api/screenings', methods=['GET', 'POST'])
def api_screenings():
    if request.method == 'POST':
        data = request.get_json() or {}
        score = data.get('score')
        if score is None:
            return jsonify({"error": "score required"}), 400
        entry = {"id": int(datetime.utcnow().timestamp()
                           * 1000), "score": score}
        screenings.insert(0, entry)
        return jsonify({"ok": True}), 201
    return jsonify({"screenings": screenings})


@bp.route('/api/clients', methods=['GET'])
def api_clients():
    try:
        if getattr(dbutils, 'mongo_db', None) is not None:
            coll = dbutils.mongo_db.get_collection(MASTER_COLLECTION_NAME)
            docs = list(coll.find().sort([('createdAt', -1)]).limit(200))
            for d in docs:
                d['id'] = str(d.get('_id'))
                if '_id' in d:
                    del d['_id']
                if 'createdAt' in d:
                    try:
                        d['createdAt'] = d['createdAt'].isoformat()
                    except Exception:
                        d['createdAt'] = str(d['createdAt'])
            return jsonify({MASTER_COLLECTION_NAME: docs})
        sample = [{'id': 'sample-1', 'name': 'Student A',
                   'email': 'a@example.edu', 'submittedAt': '2025-01-01T10:00:00'}]
        return jsonify({MASTER_COLLECTION_NAME: sample})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/clients-with-phq', methods=['GET'])
def api_clients_with_phq():
    """Return clients with their latest PHQ-9 attached as `latest_phq` when available.

    Behavior:
    - If MongoDB configured: read clients from `clients` collection and query `phq9_responses`
      for the most recent PHQ per client (matching by lowercased email).
    - If no clients collection is present, fall back to returning PHQ-only entries as client-like
      records (so the front-end always receives useful data).
    """
    try:
        phq_coll = dbutils.get_phq9_collection()
        out = []
        if getattr(dbutils, 'mongo_db', None) is not None:
            coll = dbutils.mongo_db.get_collection(MASTER_COLLECTION_NAME)
            docs = list(coll.find().sort([('createdAt', -1)]).limit(200))
            for d in docs:
                cd = dict(d)
                # normalize id/createdAt
                if '_id' in cd:
                    try:
                        cd['id'] = str(cd.get('_id'))
                        del cd['_id']
                    except Exception:
                        cd.pop('_id', None)
                if 'createdAt' in cd:
                    try:
                        cd['createdAt'] = cd['createdAt'].isoformat()
                    except Exception:
                        cd['createdAt'] = str(cd['createdAt'])

                email = (cd.get('email') or cd.get(
                    'emailAddress') or '').lower()
                latest = None
                if phq_coll is not None and email:
                    try:
                        latest = phq_coll.find_one(
                            {'user_email': email}, sort=[('timestamp', -1)])
                    except Exception:
                        latest = None
                if latest:
                    lp = dict(latest)
                    if '_id' in lp:
                        try:
                            lp['id'] = str(lp.pop('_id'))
                        except Exception:
                            lp.pop('_id', None)
                    try:
                        if 'timestamp' in lp and hasattr(lp['timestamp'], 'isoformat'):
                            lp['timestamp'] = lp['timestamp'].isoformat()
                    except Exception:
                        pass
                    cd['latest_phq'] = lp
                out.append(cd)
            return jsonify({MASTER_COLLECTION_NAME: out})

        # No DB: try to synthesize clients from PHQ in-memory
        if hasattr(dbutils, 'phq9_in_memory') and dbutils.phq9_in_memory:
            # group by email and pick latest
            grouped = {}
            for p in dbutils.phq9_in_memory:
                email = (p.get('user_email') or '').lower()
                if not email:
                    continue
                if email not in grouped or p.get('timestamp') > grouped[email].get('timestamp'):
                    grouped[email] = p
            for email, p in grouped.items():
                rec = {'id': f'phq-{email}', 'name': None,
                       'email': email, 'latest_phq': p}
                # convert timestamp to iso if present
                try:
                    if 'timestamp' in rec['latest_phq'] and hasattr(rec['latest_phq']['timestamp'], 'isoformat'):
                        rec['latest_phq']['timestamp'] = rec['latest_phq']['timestamp'].isoformat(
                        )
                except Exception:
                    pass
                out.append(rec)
            return jsonify({MASTER_COLLECTION_NAME: out})

        # Nothing to return
        return jsonify({MASTER_COLLECTION_NAME: []})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# Admin API endpoints
@bp.route('/api/admin', methods=['GET'])
def api_admin_metrics():
    """Return overall admin metrics for dashboard."""
    try:
        # Get basic metrics
        active_users = 0
        screenings = 0
        bookings_count = len(bookings)

        # Count PHQ-9 screenings
        phq_coll = dbutils.get_phq9_collection()
        if phq_coll is not None:
            screenings = phq_coll.count_documents({})
        elif hasattr(dbutils, 'phq9_in_memory'):
            screenings = len(dbutils.phq9_in_memory)

        # Count active users (unique emails from PHQ-9)
        unique_emails = set()
        if phq_coll is not None:
            for doc in phq_coll.find({}, {'user_email': 1}):
                unique_emails.add(doc.get('user_email', ''))
        elif hasattr(dbutils, 'phq9_in_memory'):
            for doc in dbutils.phq9_in_memory:
                unique_emails.add(doc.get('user_email', ''))
        active_users = len(unique_emails)

        return jsonify({
            'activeUsers': active_users,
            'screenings': screenings,
            'bookings': bookings_count
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/admin/login', methods=['GET', 'POST', 'PUT', 'OPTIONS'])
def admin_login():
    # Handle CORS preflight explicitly
    if request.method == 'OPTIONS':
        return '', 204

    # If GET: support optional ?email=... and return the admin credentials
    if request.method == 'GET':
        mongo_db = getattr(dbutils, 'mongo_db', None)
        if mongo_db is None:
            return jsonify({'error': 'mongo_not_configured'}), 503
        try:
            coll = mongo_db.get_collection(CREDENTIALS_COLLECTION_NAME)
            email = request.args.get('email') or None
            if isinstance(email, str) and email:
                doc = coll.find_one({'email': email})
            else:
                preferred_email = 'admin123456'
                doc = coll.find_one(
                    {'email': preferred_email}) or coll.find_one({})

            if not doc:
                return jsonify({'error': 'not_found'}), 404

            out = dict(doc)
            try:
                out['id'] = str(out.pop('_id'))
            except Exception:
                out['id'] = None

            # Return only the minimal admin JSON (email, id, password) as requested
            minimal = {
                'email': out.get('email'),
                'id': out.get('id'),
                'password': out.get('password')
            }
            # Wrap in a list as requested by the client
            return jsonify([minimal]), 200
        except Exception as e:
            traceback.print_exc()
            return jsonify({'error': 'internal_error', 'details': str(e)}), 500

    # If PUT: update existing admin credentials in the collection
    if request.method == 'PUT':
        try:
            data = request.get_json() or {}
        except Exception:
            data = {}

        old_email = data.get('oldEmail') or data.get('old_email') or None
        old_password = data.get('oldPassword') or data.get('old_password') or None
        new_email = data.get('newEmail') or data.get('new_email') or None
        new_password = data.get('newPassword') or data.get('new_password') or None

        # Basic validation
        if not (old_password and new_password and new_email):
            return jsonify({'error': 'missing_fields', 'details': 'oldPassword, newEmail and newPassword are required'}), 400

        mongo_db = getattr(dbutils, 'mongo_db', None)
        if mongo_db is None:
            return jsonify({'error': 'mongo_not_configured'}), 503

        try:
            coll = mongo_db.get_collection(CREDENTIALS_COLLECTION_NAME)
            if isinstance(old_email, str) and old_email:
                doc = coll.find_one({'email': old_email})
            else:
                preferred_email = 'admin123456'
                doc = coll.find_one({'email': preferred_email}) or coll.find_one({})

            if not doc:
                return jsonify({'error': 'not_found'}), 404

            # Verify the provided current password matches stored password
            stored_password = doc.get('password') or ''
            if str(old_password) != str(stored_password):
                return jsonify({'error': 'invalid_current_credentials'}), 403

            # Perform the update
            try:
                res = coll.update_one({'_id': doc.get('_id')}, {'$set': {'email': new_email, 'password': new_password}})
            except Exception:
                # Fallback to finding by email if _id update fails
                res = coll.update_one({'email': doc.get('email')}, {'$set': {'email': new_email, 'password': new_password}})

            # Fetch updated doc
            updated = coll.find_one({'_id': doc.get('_id')}) or coll.find_one({'email': new_email})
            if not updated:
                return jsonify({'error': 'update_failed'}), 500

            out = dict(updated)
            try:
                out['id'] = str(out.pop('_id'))
            except Exception:
                out['id'] = None

            minimal = {
                'email': out.get('email'),
                'id': out.get('id'),
                'password': out.get('password')
            }
            return jsonify([minimal]), 200
        except Exception as e:
            traceback.print_exc()
            return jsonify({'error': 'internal_error', 'details': str(e)}), 500

    # POST -> read JSON body and return admin credentials (same behavior)
    try:
        data = request.get_json() or {}
    except Exception:
        data = {}

    mongo_db = getattr(dbutils, 'mongo_db', None)
    if mongo_db is None:
        return jsonify({'error': 'mongo_not_configured'}), 503

    try:
        coll = mongo_db.get_collection(CREDENTIALS_COLLECTION_NAME)
        email = (data.get('email') or None)
        if isinstance(email, str) and email:
            doc = coll.find_one({'email': email})
        else:
            preferred_email = 'admin123456'
            doc = coll.find_one({'email': preferred_email}
                                ) or coll.find_one({})

        if not doc:
            return jsonify({'error': 'not_found'}), 404

        out = dict(doc)
        try:
            out['id'] = str(out.pop('_id'))
        except Exception:
            out['id'] = None

        # Return only the minimal admin JSON (email, id, password) as requested
        minimal = {
            'email': out.get('email'),
            'id': out.get('id'),
            'password': out.get('password')
        }
        # Wrap in a list as requested by the client
        return jsonify([minimal]), 200
    except Exception as e:
        traceback.print_exc()
        return jsonify({'error': 'internal_error', 'details': str(e)}), 500


@bp.route('/api/admin/institutions', methods=['GET'])
def api_admin_institutions():
    """Return institution data for admin dashboard."""
    try:
        # Mock institution data - in a real implementation, this would come from a database
        institutions = [
            {
                'id': 'university-tech',
                'name': 'University of Technology',
                        'studentCount': 15000,
                        'counsellorCount': 12,
                        'screeningCount': 450
            },
            {
                'id': 'college-arts',
                'name': 'College of Arts & Sciences',
                        'studentCount': 8500,
                        'counsellorCount': 8,
                        'screeningCount': 320
            },
            {
                'id': 'community-college',
                'name': 'Community College District',
                        'studentCount': 12000,
                        'counsellorCount': 6,
                        'screeningCount': 280
            }
        ]
        return jsonify(institutions)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/admin/phq9', methods=['GET'])
def api_admin_phq9():
    """Return PHQ-9 analytics for admin dashboard."""
    try:
        phq_coll = dbutils.get_phq9_collection()
        total_screenings = 0
        total_score = 0
        high_risk_cases = 0
        risk_distribution = {'minimal': 0,
                             'mild': 0, 'moderate': 0, 'severe': 0}

        if phq_coll is not None:
            docs = list(phq_coll.find())
            total_screenings = len(docs)
            for doc in docs:
                score = doc.get('total_score', 0)
                total_score += score

                # Risk categorization
                if score >= 20:
                    risk_distribution['severe'] += 1
                    high_risk_cases += 1
                elif score >= 15:
                    risk_distribution['moderate'] += 1
                elif score >= 10:
                    risk_distribution['mild'] += 1
                else:
                    risk_distribution['minimal'] += 1
        elif hasattr(dbutils, 'phq9_in_memory'):
            docs = dbutils.phq9_in_memory
            total_screenings = len(docs)
            for doc in docs:
                score = doc.get('total_score', 0)
                total_score += score

                # Risk categorization
                if score >= 20:
                    risk_distribution['severe'] += 1
                    high_risk_cases += 1
                elif score >= 15:
                    risk_distribution['moderate'] += 1
                elif score >= 10:
                    risk_distribution['mild'] += 1
                else:
                    risk_distribution['minimal'] += 1

        average_score = total_score / total_screenings if total_screenings > 0 else 0

        return jsonify({
            'totalScreenings': total_screenings,
            'averageScore': average_score,
            'highRiskCases': high_risk_cases,
            'riskDistribution': risk_distribution
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/admin/counsellors', methods=['GET'])
def api_admin_counsellors():
    """Return counsellor registration information for admin dashboard."""
    try:
        # Try to fetch from MongoDB first
        if getattr(dbutils, 'mongo_db', None) is not None:
            coll = dbutils.mongo_db.get_collection('counsellors')
            docs = list(coll.find().sort([('createdAt', -1)]).limit(100))
            counsellors = []
            for d in docs:
                counsellor = dict(d)
                if '_id' in counsellor:
                    counsellor['id'] = str(counsellor.pop('_id'))
                if 'createdAt' in counsellor:
                    try:
                        counsellor['createdAt'] = counsellor['createdAt'].isoformat()
                    except Exception:
                        counsellor['createdAt'] = str(counsellor['createdAt'])
                counsellors.append(counsellor)
            return jsonify(counsellors)

        # Fallback to empty array if no database
        return jsonify([])
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/admin/users', methods=['GET'])
def api_admin_users():
    """Return user registration information for admin dashboard."""
    try:
        # Try to fetch from MongoDB first
        if getattr(dbutils, 'mongo_db', None) is not None:
            coll = dbutils.mongo_db.get_collection('users')
            docs = list(coll.find().sort([('createdAt', -1)]).limit(100))
            users = []
            for d in docs:
                user = dict(d)
                if '_id' in user:
                    user['id'] = str(user.pop('_id'))
                if 'createdAt' in user:
                    try:
                        user['createdAt'] = user['createdAt'].isoformat()
                    except Exception:
                        user['createdAt'] = str(user['createdAt'])
                if 'lastLogin' in user:
                    try:
                        user['lastLogin'] = user['lastLogin'].isoformat()
                    except Exception:
                        user['lastLogin'] = str(user['lastLogin'])
                users.append(user)
            return jsonify(users)

        # Fallback to empty array if no database
        return jsonify([])
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/admin/profile', methods=['GET'])
def api_admin_profile():
    """Return admin profile information."""
    try:
        # Try to fetch admin profile from MongoDB
        if getattr(dbutils, 'mongo_db', None) is not None:
            coll = dbutils.mongo_db.get_collection('users')
            admin_doc = coll.find_one({'role': 'admin'})
            if admin_doc:
                profile = dict(admin_doc)
                if '_id' in profile:
                    profile['id'] = str(profile.pop('_id'))
                if 'createdAt' in profile:
                    try:
                        profile['createdAt'] = profile['createdAt'].isoformat()
                    except Exception:
                        profile['createdAt'] = str(profile['createdAt'])
                if 'lastLogin' in profile:
                    try:
                        profile['lastLogin'] = profile['lastLogin'].isoformat()
                    except Exception:
                        profile['lastLogin'] = str(profile['lastLogin'])
                profile['permissions'] = ['Full Access',
                                          'Data Export', 'User Management', 'Analytics']
                return jsonify(profile)

        # Fallback to default admin profile
        profile = {
            'name': 'Admin User',
            'email': 'admin@mindsphere.edu',
            'role': 'System Administrator',
            'lastLogin': '2024-01-15',
            'permissions': ['Full Access', 'Data Export', 'User Management', 'Analytics'],
            'registrationDate': '2023-01-01',
            'status': 'Active'
        }
        return jsonify(profile)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/appointments/<appt_id>/status', methods=['POST', 'OPTIONS'])
def api_appointment_status(appt_id):
    """Update appointment status (accepted/rejected) and persist to MongoDB if configured.

    Body: { status: 'accepted'|'rejected', counsellorId?: str, email?: str }
    """
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        return '', 204
    try:
        data = request.get_json() or {}
        status = data.get('status')
        counsellorId = data.get('counsellorId')
        email = data.get('email')
        if status not in ('accepted', 'rejected'):
            return jsonify({'error': 'invalid status'}), 400

        # Persist to MongoDB if available
        if getattr(dbutils, 'mongo_db', None) is not None:
            coll = dbutils.mongo_db.get_collection('appointments')
            try:
                res = coll.update_one({'_id': appt_id}, {'$set': {
                                      'status': status, 'updatedAt': datetime.utcnow(), 'counsellorId': counsellorId}}, upsert=False)
                # If not matched by _id string, try matching by id field
                if res.matched_count == 0:
                    coll.update_one({'id': appt_id}, {'$set': {'status': status, 'updatedAt': datetime.utcnow(
                    ), 'counsellorId': counsellorId}}, upsert=False)
            except Exception:
                # Fallback: try updating by string-id field
                try:
                    coll.update_one({'id': appt_id}, {'$set': {'status': status, 'updatedAt': datetime.utcnow(
                    ), 'counsellorId': counsellorId}}, upsert=False)
                except Exception:
                    pass
        # send notification to user (best-effort)
        try:
            helpers._send_notification_email(
                email or '', f"Appointment {status}", f"Your appointment (id: {appt_id}) has been {status} by the counsellor.")
        except Exception:
            pass

        return jsonify({'ok': True}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@bp.route('/api/appointments/<appt_id>/report', methods=['POST', 'OPTIONS'])
def api_appointment_report(appt_id):
    """Generate a one-page professional report for an appointment using the configured generative AI.

    Expects JSON body (optional) with fields:
      - email: user's email (preferred)
      - appointment: optional appointment object (fallback if DB not available)
      - phqEntries: optional list of PHQ entries to include

    Returns JSON: { report: "...markdown-like text..." }
    """
    # Handle CORS preflight
    if request.method == 'OPTIONS':
        return '', 204
    try:
        data = request.get_json() or {}
        email = (data.get('email') or '').lower()
        appt_obj = data.get('appointment') or None

        # Try to load appointment from MongoDB if available and appt_id looks like an id
        appt = None
        if getattr(dbutils, 'mongo_db', None) is not None:
            try:
                coll = dbutils.mongo_db.get_collection('appointments')
                # try by _id (ObjectId) or by id string
                try:
                    from bson.objectid import ObjectId
                    appt_doc = coll.find_one({'_id': ObjectId(appt_id)})
                except Exception:
                    appt_doc = coll.find_one({'id': appt_id})
                if appt_doc:
                    appt = dict(appt_doc)
                    if '_id' in appt:
                        appt['id'] = str(appt.pop('_id'))
            except Exception:
                appt = None

        # fallback to provided appointment info
        if not appt and appt_obj:
            appt = appt_obj

        # If email not provided, try to infer from appointment
        if not email and appt:
            email = (appt.get('email') or appt.get('user_email') or '').lower()

        # Gather PHQ-9 entries for the user
        phq_entries = []
        try:
            if email:
                phq_coll = dbutils.get_phq9_collection()
                if phq_coll is not None:
                    docs = list(phq_coll.find({'user_email': email}).sort(
                        'timestamp', -1).limit(10))
                    for d in docs:
                        dd = dict(d)
                        if '_id' in dd:
                            try:
                                dd['id'] = str(dd.pop('_id'))
                            except Exception:
                                dd.pop('_id', None)
                        phq_entries.append(dd)
        except Exception:
            phq_entries = data.get('phqEntries') or []

        # Chat history: get recent sessions and messages
        chat_msgs = []
        try:
            if email:
                sessions = dbutils.get_sessions_by_email(email)
                if sessions:
                    sid = sessions[0].get('id')
                    msgs = dbutils.get_session_messages(email, sid)
                    if msgs:
                        chat_msgs = msgs[-100:] if isinstance(
                            msgs, list) else []
        except Exception:
            chat_msgs = []

        # Peer posts: try to read from posts collection
        posts = []
        try:
            if getattr(dbutils, 'mongo_db', None) is not None:
                posts_coll = dbutils.mongo_db.get_collection('posts')
                if posts_coll is not None and email:
                    namepart = email.split('@')[0]
                    docs = list(posts_coll.find({'$or': [{'author': {'$regex': namepart, '$options': 'i'}}, {'authorName': {
                                '$regex': namepart, '$options': 'i'}}, {'email': email}]}).sort('createdAt', -1).limit(20))
                    for p in docs:
                        pp = dict(p)
                        if '_id' in pp:
                            try:
                                pp['id'] = str(pp.pop('_id'))
                            except Exception:
                                pp.pop('_id', None)
                        posts.append(pp)
        except Exception:
            posts = []

        # Resources: include any server-side resources list and appointment-level resources
        resources_list = []
        try:
            resources_list = list(resources)
        except Exception:
            resources_list = []
        # Also include appointment.accessedResources if present
        if appt and isinstance(appt, dict) and appt.get('accessedResources'):
            try:
                resources_list = resources_list + \
                    list(appt.get('accessedResources'))
            except Exception:
                pass

        # Build prompt for model
        user_meta = {
            'name': (appt.get('userName') if appt else None) or data.get('name') or 'Unknown',
            'email': email or 'Unknown',
            'contact': (appt.get('contact') if appt else None) or data.get('contact') or ''
        }

        # Limit sizes for prompt
        chat_excerpt = []
        try:
            for m in (chat_msgs or [])[-40:]:
                t = m.get('text') or m.get('message') or m.get('content') or ''
                who = m.get('from') or m.get('role') or ''
                chat_excerpt.append(f"[{who}] {t}")
        except Exception:
            chat_excerpt = []

        posts_excerpt = []
        try:
            for p in (posts or [])[:20]:
                posts_excerpt.append(
                    f"{p.get('title','(no title)')}: {p.get('content') or p.get('body') or ''}")
        except Exception:
            posts_excerpt = []

        # Build a PHQ-9 excerpt and a detailed per-question breakdown (map 0..3 to text)
        phq_excerpt = []
        phq_detailed_lines = []
        try:
            # mapping per the PHQ-9 options
            phq_map = {0: 'Not at all', 1: 'Several days',
                       2: 'More than half the days', 3: 'Nearly every day'}
            for p in (phq_entries or [])[:5]:
                score = p.get('total_score') or p.get('totalScore') or ''
                ts = p.get('timestamp') or p.get('submittedAt') or ''
                phq_excerpt.append(f"{ts} — Score: {score}")
                # include per-question breakdown if answers available
                answers = p.get('answers') or p.get(
                    'response') or p.get('answers_int') or []
                if isinstance(answers, list) and len(answers) >= 9:
                    phq_detailed_lines.append(
                        f"Entry: {ts} — Total score: {score}")
                    for qi in range(min(9, len(answers))):
                        val = None
                        try:
                            val = int(answers[qi])
                        except Exception:
                            val = None
                        phq_text = phq_map.get(
                            val, str(val) if val is not None else 'Unknown')
                        phq_detailed_lines.append(f"Q{qi+1}: {phq_text}")
        except Exception:
            phq_excerpt = []
            phq_detailed_lines = []

        prompt_sections = []
        prompt_sections.append(f"Client name: {user_meta['name']}")
        prompt_sections.append(f"Email: {user_meta['email']}")
        if user_meta.get('contact'):
            prompt_sections.append(f"Contact: {user_meta['contact']}")
        # Include PHQ-9 summary lines and detailed per-question breakdown when available
        prompt_sections.append('\nPHQ-9 entries:')
        prompt_sections.extend(phq_excerpt or ['No PHQ-9 entries found.'])
        if phq_detailed_lines:
            prompt_sections.append(
                '\nPHQ-9 detailed breakdown (most recent first):')
            prompt_sections.extend(phq_detailed_lines[:200])
        prompt_sections.append('\nRecent chat messages (most recent last):')
        prompt_sections.extend(chat_excerpt or ['No chat history found.'])
        prompt_sections.append('\nRecent forum posts:')
        prompt_sections.extend(posts_excerpt or ['No forum posts found.'])
        prompt_sections.append('\nResources known/suggested:')
        for r in (resources_list or [])[:20]:
            prompt_sections.append(f"- {r.get('title') or r.get('name') or r}")

        # Ask model to format a concise one-page report in Markdown style with headings and bullets
        # NOTE: request the model avoid inline bold markup ("**bold**") because the client renderer prefers headings and simple bullets.
        model_prompt = (
            helpers.COPING_SYSTEM_PROMPT + "\n" +
            "You are a professional counselor assistant. Create a concise, one-page clinical-style report for a counsellor, using the information below. "
            "Structure the report with a clear Title, a short Client Info section (name, email, contact), followed by sections: 'PHQ-9 Summary', 'Chatbot History', 'Forum Posts', and 'Resources Accessed'. "
            "Use Markdown-style headings (e.g., # Title, ## Section) and bullet points for lists. Keep each section brief and focused; use bullet points for key observations. Begin with the user's basic details. Avoid any medical diagnosis; instead summarize severity and notable indicators. Limit output to approximately one page.\n\n"
            "IMPORTANT: Do NOT use inline bold markup like **bold text**. Use heading lines starting with #/## and simple '-' bullets. Avoid other Markdown decorations; plain text is preferred.\n\n"
            "DATA:\n" + "\n".join(prompt_sections) +
            "\n\nProduce the report now in Markdown format."
        )

        # Prefer a deterministic, structured report generated locally for reliability and privacy.
        try:
            structured = helpers.generate_structured_report(
                user_meta, phq_entries, chat_msgs, posts, resources_list)
        except Exception:
            structured = None

        # If deterministic generator produced output, return it. Otherwise, fall back to the model-based prompt.
        if structured:
            # Build a structured PHQ breakdown to help the client render deterministic per-question bullets
            phq_breakdown = []
            try:
                for p in (phq_entries or [])[:5]:
                    item = dict(p)
                    if '_id' in item:
                        try:
                            item['id'] = str(item.pop('_id'))
                        except Exception:
                            item.pop('_id', None)
                    # ensure timestamp is JSON-safe
                    try:
                        if 'timestamp' in item and hasattr(item['timestamp'], 'isoformat'):
                            item['timestamp'] = item['timestamp'].isoformat()
                    except Exception:
                        pass
                    # normalize answers to ints when possible
                    answers = item.get('answers') or item.get('response') or []
                    if isinstance(answers, list):
                        try:
                            item['answers'] = [int(x) for x in answers]
                        except Exception:
                            pass
                    phq_breakdown.append(item)
            except Exception:
                phq_breakdown = []
            return jsonify({'report': structured, 'phq_breakdown': phq_breakdown}), 200
        # Fallback to model-based generation (should rarely be needed)
        try:
            report_text = modelutils.generate_coping_text(model_prompt)
        except Exception as e:
            return jsonify({'error': 'model generation failed', 'details': str(e)}), 500
        return jsonify({'report': report_text}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# Register the blueprint now that all routes are ready
app.register_blueprint(bp)


if __name__ == '__main__':
    dbutils.init_mongo()
    modelutils.init_model()
    # Default to 5000 if PORT not set; bind to all interfaces for local testing
    port = int(os.getenv('PORT'))
    app.run(port=port, debug=True)
