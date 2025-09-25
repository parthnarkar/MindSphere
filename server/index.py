from flask import Flask, request, jsonify
from flask_cors import CORS
import time

app = Flask(__name__)
CORS(app)

# In-memory prototype storage (replace with DB in production)
bookings = []
forum_posts = []
screenings = []


@app.route("/api/health")
def health():
	return jsonify({"status": "ok", "service": "mindsphere-server"})


@app.route("/api/bookings", methods=["GET", "POST"])
def api_bookings():
	if request.method == "POST":
		data = request.get_json() or {}
		entry = {"id": int(time.time() * 1000), "name": data.get("name", "anonymous"), "time": data.get("time")}
		bookings.append(entry)
		return jsonify({"ok": True, "id": entry["id"]}), 201
	return jsonify({"bookings": bookings})


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
	app.run(host="0.0.0.0", port=5000, debug=True)
