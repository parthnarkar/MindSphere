# Flask + Flask-SocketIO version of the test-socket-server.js
from flask import Flask, request, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from flask_cors import CORS
import os
import time

# Prefer eventlet (or gevent) for real WebSocket support. If eventlet is available
# we'll monkey-patch the stdlib so the server can handle sockets correctly.
async_mode = 'threading'
try:
    import eventlet  # type: ignore
    eventlet.monkey_patch()
    async_mode = 'eventlet'
    print('Using eventlet for async_mode (better WebSocket support)')
except Exception:
    # eventlet not installed; fall back to threading. Threading works but the
    # Werkzeug development server can behave poorly with native websockets.
    print('eventlet not available; falling back to threading (development only)')

app = Flask(__name__)
# Allow all origins for production 
ALLOWED_ORIGINS = [
    "*", 
    "http://localhost:5173",
]
# Apply Flask-CORS for regular HTTP endpoints (socket upgrades are handled by python-socketio)
CORS(app, supports_credentials=True, origins=ALLOWED_ORIGINS)
app.config['SECRET_KEY'] = 'secret!'
# Enable engineio/socketio logging to help diagnose origin checks
socketio = SocketIO(app, cors_allowed_origins=ALLOWED_ORIGINS, async_mode=async_mode, logger=True, engineio_logger=True)

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
    port = 3000
    print(f'Server running on port {port}')
    print('WebSocket server ready for connections')
    socketio.run(app, port=port)
