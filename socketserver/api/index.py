# Flask + Flask-SocketIO version of the test-socket-server.js
import os
import time

# Detect and enable an async backend (eventlet or gevent) before importing
# socket-related libraries so monkey-patching takes effect early.
async_mode = 'threading'
use_eventlet = False
use_gevent = False
try:
    import eventlet  # type: ignore
    eventlet.monkey_patch()
    async_mode = 'eventlet'
    use_eventlet = True
    print('Using eventlet for async_mode (better WebSocket support)')
except Exception:
    try:
        from gevent import monkey  # type: ignore
        monkey.patch_all()
        async_mode = 'gevent'
        use_gevent = True
        print('Using gevent for async_mode (better WebSocket support)')
    except Exception:
        async_mode = 'threading'
        print('No eventlet/gevent available; falling back to threading (development only)')

from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__)

# Configure allowed origins. Keep explicit hosts and also support wildcard where
# required by the environment. Using '*' is fine for development but restrict in prod.
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:3000",
    "*",
]

# Apply Flask-CORS for HTTP endpoints. Socket.IO will use its own CORS checks
CORS(app, resources={r"/api/*": {"origins": ALLOWED_ORIGINS}}, supports_credentials=True)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'secret!')

# Initialize SocketIO with explicit async_mode and logging useful for debugging
socketio = SocketIO(
    app,
    async_mode=async_mode,
    cors_allowed_origins=ALLOWED_ORIGINS,
    logger=True,
    engineio_logger=True,
    ping_timeout=60,
    ping_interval=25,
)

# Store connected users
connected_users = {}
online_users = []

@app.route('/api/posts', methods=['GET'])
def get_posts():
    # Mock posts data
    return jsonify([])

@app.route('/api/posts', methods=['POST'])
def create_post():
    data = request.json
    post = {
        'id': int(time.time() * 1000),
        **data,
        'createdAt': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'upvotes': 0,
        'replies': []
    }
    return jsonify(post)

@socketio.on('connect')
def handle_connect():
    print('User connected:', request.sid)

@socketio.on('user_join')
def handle_user_join(userData):
    connected_users[request.sid] = userData
    online_users.append({**userData, 'socketId': request.sid})
    emit('users_online', online_users, broadcast=True)
    emit('user_joined', userData, broadcast=True, include_self=False)

@socketio.on('create_post')
def handle_create_post(post):
    print('New post created:', post.get('title'))
    emit('post_created', post, broadcast=True, include_self=False)

@socketio.on('add_reply')
def handle_add_reply(data):
    postId = data.get('postId')
    reply = data.get('reply')
    print('New reply added to post:', postId)
    emit('reply_added', {'postId': postId, 'reply': reply}, broadcast=True, include_self=False)

@socketio.on('upvote_post')
def handle_upvote_post(data):
    postId = data.get('postId')
    print('Post upvoted:', postId)
    emit('vote_updated', {'postId': postId, 'upvotes': int(time.time()) % 20}, broadcast=True, include_self=False)

@socketio.on('upvote_reply')
def handle_upvote_reply(data):
    postId = data.get('postId')
    replyId = data.get('replyId')
    print('Reply upvoted:', replyId, 'on post:', postId)
    emit('vote_updated', {'postId': postId, 'replyId': replyId, 'upvotes': int(time.time()) % 15}, broadcast=True, include_self=False)

@socketio.on('pin_post')
def handle_pin_post(data):
    postId = data.get('postId')
    print('Post pinned/unpinned:', postId)
    emit('post_pinned', {'postId': postId, 'isPinned': bool(int(time.time()) % 2)}, broadcast=True, include_self=False)

@socketio.on('verify_reply')
def handle_verify_reply(data):
    postId = data.get('postId')
    replyId = data.get('replyId')
    print('Reply verified:', replyId)
    emit('reply_verified', {'postId': postId, 'replyId': replyId, 'isVerified': True}, broadcast=True, include_self=False)

@socketio.on('typing_start')
def handle_typing_start(data):
    postId = data.get('postId')
    user = connected_users.get(request.sid)
    if user:
        emit('user_typing', {
            'userId': user.get('id'),
            'userName': user.get('name'),
            'postId': postId
        }, broadcast=True, include_self=False)

@socketio.on('typing_stop')
def handle_typing_stop(data):
    postId = data.get('postId')
    user = connected_users.get(request.sid)
    if user:
        emit('user_stopped_typing', {
            'userId': user.get('id'),
            'postId': postId
        }, broadcast=True, include_self=False)

@socketio.on('report_content')
def handle_report_content(reportData):
    print('Content reported:', reportData)
    # In production, save to database and notify moderators

@socketio.on('disconnect')
def handle_disconnect():
    print('User disconnected:', request.sid)
    user = connected_users.get(request.sid)
    if user:
        online_users[:] = [u for u in online_users if u.get('socketId') != request.sid]
        connected_users.pop(request.sid, None)
        emit('users_online', online_users, broadcast=True)
        emit('user_left', user.get('id'), broadcast=True, include_self=False)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    print('WebSocket server ready for connections')
    # If we're using the threading fallback on development servers, allow the
    # unsafe werkzeug option to avoid socket upgrade issues during local testing.
    socketio.run(app, port=port)
