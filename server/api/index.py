from flask import Flask, request, jsonify
from flask_cors import CORS
import time

app = Flask(__name__)
CORS(app)

# In-memory prototype storage (replace with DB in production)
bookings = []
forum_posts = []
screenings = []
resources = [
	{"id": 1, "title": "Intro to coping skills", "type": "video", "language": "English", "url": ""},
	{"id": 2, "title": "How to support a friend", "type": "video", "language": "Hindi", "url": ""},
	{"id": 3, "title": "Offline resource map", "type": "guide", "language": "Regional", "url": ""},
]


@app.route("/")
def health():
	return jsonify({"status": "ok", "service": "mindsphere-server"})


@app.route("/", methods=["POST"])
def root_post():
	# Some platforms or misconfigured frontends POST to the site root.
	# Attempt to dispatch based on the JSON payload keys to a matching handler.
	data = request.get_json(silent=True) or {}
	if not isinstance(data, dict):
		return jsonify({"error": "invalid payload"}), 400

	# Route heuristics:
	if "text" in data:
		return api_chat()
	if "score" in data:
		return api_screenings()
	if "title" in data:
		return api_resources()
	if "name" in data and "time" in data:
		return api_bookings()
	if "text" in data:
		return api_forum()

	return jsonify({"error": "unrecognized payload"}), 400


@app.route("/api/bookings", methods=["GET", "POST"])
def api_bookings():
	if request.method == "POST":
		data = request.get_json() or {}
		entry = {"id": int(time.time() * 1000), "name": data.get("name", "anonymous"), "time": data.get("time")}
		bookings.append(entry)
		return jsonify({"ok": True, "id": entry["id"]}), 201
	return jsonify({"bookings": bookings})


@app.route("/api/resources", methods=["GET", "POST"])
def api_resources():
	if request.method == "POST":
		data = request.get_json() or {}
		title = data.get("title")
		if not title:
			return jsonify({"error": "title required"}), 400
		item = {
			"id": int(time.time() * 1000),
			"title": title,
			"type": data.get("type", "guide"),
			"language": data.get("language", "English"),
			"url": data.get("url", ""),
		}
		resources.insert(0, item)
		return jsonify(item), 201
	return jsonify({"resources": resources})


@app.route("/api/forum", methods=["GET", "POST"])
def api_forum():
	if request.method == "POST":
		data = request.get_json() or {}
		text = data.get("text")
		if not text:
			return jsonify({"error": "text required"}), 400
		post = {"id": int(time.time() * 1000), "text": text, "anon": True}
		forum_posts.insert(0, post)
		return jsonify(post), 201
	return jsonify({"posts": forum_posts})


@app.route("/api/screenings", methods=["GET", "POST"])
def api_screenings():
	if request.method == "POST":
		data = request.get_json() or {}
		score = data.get("score")
		if score is None:
			return jsonify({"error": "score required"}), 400
		entry = {"id": int(time.time() * 1000), "score": score}
		screenings.insert(0, entry)
		return jsonify({"ok": True}), 201
	return jsonify({"screenings": screenings})


@app.route("/api/admin", methods=["GET"])
def api_admin():
	# anonymized metrics
	metrics = {
		"activeUsers": 124,
		"screenings": len(screenings),
		"bookings": len(bookings),
		"forumPosts": len(forum_posts),
	}
	return jsonify(metrics)


@app.route("/api/chat", methods=["POST"])
def api_chat():
	# Prototype echo chat with a safety placeholder. In production integrate a safe LLM and human-in-loop.
	data = request.get_json() or {}
	text = data.get("text", "")
	# simple safety: reject messages that contain 'suicide' and return a safe escalation note
	if "suicide" in text.lower():
		return jsonify({"reply": "If you are in immediate danger or thinking about harming yourself, please contact local emergency services or the university counselor immediately."}), 200
	# Echo reply for prototype
	return jsonify({"reply": f"Prototype reply: I hear you — \"{text}\""}), 200


if __name__ == "__main__":
	app.run(port=5000, debug=True)
