from flask import Flask, request, jsonify, Blueprint
from flask_cors import CORS
from dotenv import load_dotenv
import os
import sys
from datetime import datetime

# Load env
load_dotenv()

from utils import db as dbutils
from utils import model as modelutils
from utils import helpers as helpers


app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=False)
app.config.update({'JSON_SORT_KEYS': False})


# Ensure any CORS preflight (OPTIONS) is answered early with a success status so browsers allow the actual request.
@app.before_request
def _handle_global_options():
	# If it's an OPTIONS preflight, return an empty 200 response; Flask-CORS will add the required headers.
	if request.method == 'OPTIONS':
		from flask import make_response
		resp = make_response('', 200)
		return resp

# Define a local blueprint to keep routes organized inside this master file
bp = Blueprint('api', __name__)

# In-memory fallbacks
bookings = []
screenings = []
resources = [{"id": 1, "title": "Intro to coping skills", "type": "video", "language": "English", "url": ""}]


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


# NOTE: register blueprint after all route handlers are defined (done below)


@bp.route('/api/chat', methods=['POST', 'OPTIONS'])
def api_chat():
	if request.method == 'OPTIONS':
		return '', 204
	data = request.get_json() or {}
	# Ignore any client-side intent hints; detect on server for a single source of truth
	user_message = data.get('message') or data.get('text')
	if not user_message:
		return jsonify({"error": "Message is required"}), 400
	# Run server-side intent detection first
	detected = helpers.detect_intent(user_message)
	# Allow optional conversation history passed from the client so the model can reference prior turns
	history = data.get('history') if isinstance(data, dict) else None

	# Crisis handling: ask the model to generate the crisis-aware reply so no hardcoded text is returned
	if detected.get('intent') == 'crisis' or helpers.detect_crisis(user_message):
		# Use the global coping prompt persona as a base and ask for a brief crisis-aware reply
		prompt = (
			helpers.COPING_SYSTEM_PROMPT + "\n" +
			"The user message indicates a possible crisis. Provide a short, empathetic reply that urges the user to seek immediate help and lists crisis resources (hotlines, emergency services) where appropriate. "
			"Do NOT provide medical diagnoses or medical advice beyond recommending contacting emergency services or a crisis hotline." 
			f"\nUser message: {user_message}"
		)
		try:
			text = modelutils.generate_coping_text(prompt)
		except Exception as e:
			return jsonify({"error": "Model generation failed", "details": str(e)}), 500
		return jsonify({"response": text, "escalate": True, "intent": "crisis", "intentConfidence": detected.get('confidence', 1.0)})

	# Topic gate: if message isn't clearly student MH-related, ask the model to craft a clarifying question
	if not helpers.looks_student_mh_related(user_message):
		# Use the same persona + prompt builder so history (if provided) is included and the model keeps the conversational style
		clarify_text = (
			"[clarify] Please generate one brief clarifying question (one sentence) asking whether the user is discussing how they are feeling or a different topic. "
			f"If helpful, reference prior turns from the conversation history.\nUser message: {user_message}"
		)
		prompt = helpers.build_coping_prompt(clarify_text, history=history)
		try:
			text = modelutils.generate_coping_text(prompt)
		except Exception as e:
			return jsonify({"error": "Model generation failed", "details": str(e)}), 500
		return jsonify({"response": text, "escalate": False, "intent": detected.get('intent'), "intentConfidence": detected.get('confidence')})
	prompt = helpers.build_coping_prompt(f"[intent={detected.get('intent')}] {user_message}", history=history)
	try:
		text = modelutils.generate_coping_text(prompt)
	except Exception as e:
		# Surface the model error to the client (5xx). Caller requested strict model-only behavior.
		return jsonify({"error": "Model generation failed", "details": str(e)}), 500
	return jsonify({"response": text, "escalate": False, "intent": detected.get('intent'), "intentConfidence": detected.get('confidence')})


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


@bp.route('/api/chat/session/<session_id>/messages', methods=['GET', 'POST', 'OPTIONS'])
def api_chat_session_messages(session_id):
    if request.method == 'OPTIONS':
        return '', 204
    if request.method == 'GET':
        email = request.args.get('email') or None
        msgs = dbutils.get_session_messages(email, session_id)
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
    Returns: { summary: str }
    """
    if request.method == 'OPTIONS':
        return '', 204
    data = request.get_json() or {}
    messages = data.get('messages')
    session_id = data.get('session_id')
    email = data.get('email')

    msgs = []
    if isinstance(messages, list) and messages:
        msgs = messages
    elif session_id:
        msgs = dbutils.get_session_messages(email, session_id) or []
    else:
        return jsonify({"error": "messages or session_id required"}), 400

    # join into a single conversation text
    texts = [(m.get('text') or m.get('message') or m.get('content') or '') for m in msgs]
    convo = '\n'.join([t for t in texts if t])
    if not convo:
        return jsonify({"summary": ""})

    # ensure model is initialized
    if not getattr(modelutils, 'client', None) or not getattr(modelutils, 'model_name', None):
        return jsonify({"error": "Generative model not configured on server"}), 503

    # Build a concise prompt asking for a 500-word summary. Ask the model to return ONLY the summary.
    prompt = (
        helpers.COPING_SYSTEM_PROMPT + "\n"
        "You are an expert clinical summarizer. Produce a clear, neutral, 500-word summary of the following chat conversation between a student and an automated chatbot. "
        "Do NOT invent details; only summarize the content present. Output ONLY the summary text and do not include headings or commentary.\n\nConversation:\n"
        + convo + "\n\nSummary (approx. 500 words):"
    )

    try:
        summary = modelutils.generate_coping_text(prompt)
    except Exception as e:
        return jsonify({"error": "Model generation failed", "details": str(e)}), 500

    return jsonify({"summary": summary})



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
				title = (p.get('title') or p.get('subject') or '').strip() or '(no title)'
				body = (p.get('content') or p.get('body') or '')
				# short preview
				preview = (body or '').replace('\n',' ').strip()[:300]
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
		prompt_sections.append(f"Client name: {user_meta.get('name') or user_meta.get('userName') or 'Unknown'}")
		prompt_sections.append(f"Email: {user_meta.get('email') or user_meta.get('user_email') or 'Unknown'}")
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
			"DATA:\n" + "\n".join(prompt_sections) + "\n\nProduce the summaries now."
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
	doc = {"user_email": user_email.lower(), "timestamp": now, "answers": answers_int, "total_score": total_score}
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
		entry = {"id": int(datetime.utcnow().timestamp() * 1000), "name": data.get('name', 'anonymous'), "time": data.get('time')}
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
			print(f"[api_summarize] Received payload keys={keys} size={len(str(data))}")
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
						t = item.get('content') or item.get('text') or item.get('message') or item.get('title') or item.get('name') or str(item)
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
			# Generate summary using Gemini
			prompt = prompt_template.format(text=text_str)
			response = modelutils.generate_coping_text(prompt)

			# Process response to extract clean points
			points = []
			for line in response.split('\n'):
				line = line.strip()
				# Skip empty lines, headers, and meta-text
				if not line or line.startswith('#') or line.lower().startswith(('here are', 'observation', 'generate', 'bullet')):
					continue

				# Clean up common formatting
				line = line.lstrip('- •*').strip()
				line = line.replace('**', '').replace('*', '').replace('\\', '')

				# Skip if the line is too short or is a meta-instruction
				if len(line) < 10 or line.lower().startswith(('each point', 'the following', 'points:', 'summarize')):
					continue

				points.append(line)

			# Ensure exactly 5 points
			points = [p for p in points if not p.lower().startswith('no additional')]  # Remove placeholder text
			if len(points) > 5:
				points = points[:5]
			while len(points) < 5:
				if len(points) == 0:
					points.append("Insufficient data available for meaningful analysis.")
				else:
					points.append("Additional aspects of interaction not observed in the available data.")

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
        item = {"id": int(datetime.utcnow().timestamp() * 1000), "title": title, "type": data.get('type', 'guide'), "language": data.get('language', 'English'), "url": data.get('url', '')}
        resources.insert(0, item)
        return jsonify(item), 201
    return jsonify({"resources": resources})



@bp.route('/api/posts', methods=['GET'])
def api_posts():
	"""Return forum posts. If Mongo configured, read from `posts` collection.

	Optional query param: ?email=... will filter posts by exact email or author/name substring.
	"""
	try:
		email = (request.args.get('email') or '').strip().lower()
		namepart = ''
		if email:
			namepart = email.split('@')[0]
		if getattr(dbutils, 'mongo_db', None) is not None:
			coll = dbutils.mongo_db.get_collection('posts')
			query = {}
			if email:
				# match by email or author/name containing the local-part
				query = {'$or': [{'email': email}, {'author': {'$regex': namepart, '$options': 'i'}}, {'authorName': {'$regex': namepart, '$options': 'i'}}]}
			docs = list(coll.find(query).sort([('createdAt', -1)]).limit(200))
			out = []
			for d in docs:
				p = dict(d)
				if '_id' in p:
					try:
						p['id'] = str(p.pop('_id'))
					except Exception:
						p.pop('_id', None)
				# convert createdAt
				try:
					if 'createdAt' in p and hasattr(p['createdAt'], 'isoformat'):
						p['createdAt'] = p['createdAt'].isoformat()
				except Exception:
					pass
				out.append(p)
			return jsonify({'posts': out})
		return jsonify({'posts': []})
	except Exception as e:
		return jsonify({'error': str(e)}), 500



@bp.route('/api/screenings', methods=['GET', 'POST'])
def api_screenings():
	if request.method == 'POST':
		data = request.get_json() or {}
		score = data.get('score')
		if score is None:
			return jsonify({"error": "score required"}), 400
		entry = {"id": int(datetime.utcnow().timestamp() * 1000), "score": score}
		screenings.insert(0, entry)
		return jsonify({"ok": True}), 201
	return jsonify({"screenings": screenings})



@bp.route('/api/clients', methods=['GET'])
def api_clients():
	try:
		if getattr(dbutils, 'mongo_db', None) is not None:
			coll = dbutils.mongo_db.get_collection('clients')
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
			return jsonify({'clients': docs})
		sample = [{ 'id': 'sample-1', 'name': 'Student A', 'email': 'a@example.edu', 'submittedAt': '2025-01-01T10:00:00' }]
		return jsonify({'clients': sample})
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
			coll = dbutils.mongo_db.get_collection('clients')
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

				email = (cd.get('email') or cd.get('emailAddress') or '').lower()
				latest = None
				if phq_coll is not None and email:
					try:
						latest = phq_coll.find_one({'user_email': email}, sort=[('timestamp', -1)])
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
			return jsonify({'clients': out})

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
				rec = {'id': f'phq-{email}', 'name': None, 'email': email, 'latest_phq': p}
				# convert timestamp to iso if present
				try:
					if 'timestamp' in rec['latest_phq'] and hasattr(rec['latest_phq']['timestamp'], 'isoformat'):
						rec['latest_phq']['timestamp'] = rec['latest_phq']['timestamp'].isoformat()
				except Exception:
					pass
				out.append(rec)
			return jsonify({'clients': out})

		# Nothing to return
		return jsonify({'clients': []})
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
		risk_distribution = {'minimal': 0, 'mild': 0, 'moderate': 0, 'severe': 0}
		
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
				profile['permissions'] = ['Full Access', 'Data Export', 'User Management', 'Analytics']
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
					res = coll.update_one({'_id': appt_id}, {'$set': {'status': status, 'updatedAt': datetime.utcnow(), 'counsellorId': counsellorId}}, upsert=False)
					# If not matched by _id string, try matching by id field
					if res.matched_count == 0:
						coll.update_one({'id': appt_id}, {'$set': {'status': status, 'updatedAt': datetime.utcnow(), 'counsellorId': counsellorId}}, upsert=False)
				except Exception:
					# Fallback: try updating by string-id field
					try:
						coll.update_one({'id': appt_id}, {'$set': {'status': status, 'updatedAt': datetime.utcnow(), 'counsellorId': counsellorId}}, upsert=False)
					except Exception:
						pass
			# send notification to user (best-effort)
			try:
				helpers._send_notification_email(email or '', f"Appointment {status}", f"Your appointment (id: {appt_id}) has been {status} by the counsellor.")
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
						docs = list(phq_coll.find({'user_email': email}).sort('timestamp', -1).limit(10))
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
							chat_msgs = msgs[-100:] if isinstance(msgs, list) else []
			except Exception:
				chat_msgs = []

			# Peer posts: try to read from posts collection
			posts = []
			try:
				if getattr(dbutils, 'mongo_db', None) is not None:
					posts_coll = dbutils.mongo_db.get_collection('posts')
					if posts_coll is not None and email:
						namepart = email.split('@')[0]
						docs = list(posts_coll.find({'$or': [{'author': {'$regex': namepart, '$options': 'i'}}, {'authorName': {'$regex': namepart, '$options': 'i'}}, {'email': email}] }).sort('createdAt', -1).limit(20))
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
					resources_list = resources_list + list(appt.get('accessedResources'))
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
					posts_excerpt.append(f"{p.get('title','(no title)')}: {p.get('content') or p.get('body') or ''}")
			except Exception:
				posts_excerpt = []

			# Build a PHQ-9 excerpt and a detailed per-question breakdown (map 0..3 to text)
			phq_excerpt = []
			phq_detailed_lines = []
			try:
				# mapping per the PHQ-9 options
				phq_map = {0: 'Not at all', 1: 'Several days', 2: 'More than half the days', 3: 'Nearly every day'}
				for p in (phq_entries or [])[:5]:
					score = p.get('total_score') or p.get('totalScore') or ''
					ts = p.get('timestamp') or p.get('submittedAt') or ''
					phq_excerpt.append(f"{ts} — Score: {score}")
					# include per-question breakdown if answers available
					answers = p.get('answers') or p.get('response') or p.get('answers_int') or []
					if isinstance(answers, list) and len(answers) >= 9:
						phq_detailed_lines.append(f"Entry: {ts} — Total score: {score}")
						for qi in range(min(9, len(answers))):
							val = None
							try:
								val = int(answers[qi])
							except Exception:
								val = None
							phq_text = phq_map.get(val, str(val) if val is not None else 'Unknown')
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
				prompt_sections.append('\nPHQ-9 detailed breakdown (most recent first):')
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
				"DATA:\n" + "\n".join(prompt_sections) + "\n\nProduce the report now in Markdown format."
			)

			# Prefer a deterministic, structured report generated locally for reliability and privacy.
			try:
				structured = helpers.generate_structured_report(user_meta, phq_entries, chat_msgs, posts, resources_list)
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
	port = int(os.getenv('PORT') or 5000)
	print(f"Starting REST API")
	app.run(port=port, debug=True)
