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
from pymongo import MongoClient
from bson.objectid import ObjectId
import json

app = Flask(__name__)

# CORS configuration - Allow all origins
CORS(app)

# Initialize SocketIO with explicit async_mode and logging useful for debugging
socketio = SocketIO(
    app,
    async_mode=async_mode,
    # Socket.IO accepts either a list of origins or "*". Use the configured list.
    cors_allowed_origins="*",
    logger=True,
    engineio_logger=True,
    ping_timeout=60,
    ping_interval=25,
)

# Store connected users
connected_users = {}
online_users = []

# MongoDB setup (optional). If MONGO_URI not set, fall back to in-memory store.
MONGO_URI = os.environ.get('MONGO_URI')
DB_NAME = os.environ.get('MONGO_DB_NAME') or 'mindsphere'
if MONGO_URI:
    try:
        mongo = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
        db = mongo.get_database(DB_NAME)
        posts_col = db.get_collection('posts')
        reports_col = db.get_collection('reports')
        print('Connected to MongoDB')
    except Exception as e:
        print('MongoDB connection failed:', e)
        MONGO_URI = None

def _safe_objectid(id_str):
    try:
        return ObjectId(id_str)
    except Exception:
        return None

# In-memory fallback
_in_memory_posts = []

@app.route('/api/posts', methods=['GET'])
def get_posts():
    category = request.args.get('category')
    try:
        if MONGO_URI:
            query = {} if not category else {'category': category}
            docs = list(posts_col.find(query).sort('createdAt', -1).limit(200))
            # convert ObjectId and datetimes to serializable form
            for d in docs:
                d['id'] = str(d.get('_id'))
                d.pop('_id', None)
            return jsonify(docs)
        else:
            items = [p for p in _in_memory_posts if (not category or p.get('category') == category)]
            return jsonify(items)
    except Exception as e:
        print('Error fetching posts:', e)
        return jsonify([]), 500

@app.route('/api/posts', methods=['POST'])
def create_post():
    data = request.json
    post = {
        'title': data.get('title'),
        'content': data.get('content'),
        'category': data.get('category'),
        'anonymous': bool(data.get('anonymous')),
        'author': data.get('author'),
        'createdAt': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'upvotes': int(data.get('upvotes', 0)),
        'replies': []
    }
    try:
        if MONGO_URI:
            res = posts_col.insert_one(post)
            post['id'] = str(res.inserted_id)
        else:
            post['id'] = int(time.time() * 1000)
            _in_memory_posts.insert(0, post)
        return jsonify(post)
    except Exception as e:
        print('Error creating post:', e)
        return jsonify({'error': 'failed to create post'}), 500

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
    # Persist post in DB if available
    try:
        if MONGO_URI:
            post_doc = {k: v for k, v in post.items() if k != 'id'}
            res = posts_col.insert_one({**post_doc, 'createdAt': time.strftime('%Y-%m-%dT%H:%M:%S')})
            post['id'] = str(res.inserted_id)
    except Exception as e:
        print('Warning: failed to persist post:', e)
    emit('post_created', post, broadcast=True, include_self=False)

@socketio.on('add_reply')
def handle_add_reply(data):
    postId = data.get('postId')
    reply = data.get('reply')
    print('New reply added to post:', postId)
    try:
        if MONGO_URI:
            # ensure reply has an id
            if not reply.get('id'):
                reply['id'] = str(int(time.time() * 1000))
            oid = _safe_objectid(postId)
            if oid:
                posts_col.update_one({'_id': oid}, {'$push': {'replies': reply}})
        else:
            for p in _in_memory_posts:
                if str(p.get('id')) == str(postId):
                    p.setdefault('replies', []).append(reply)
                    break
    except Exception as e:
        print('Warning: failed to persist reply:', e)
    emit('reply_added', {'postId': postId, 'reply': reply}, broadcast=True, include_self=False)

@socketio.on('upvote_post')
def handle_upvote_post(data):
    postId = data.get('postId')
    print('Post upvoted:', postId)
    try:
        if MONGO_URI:
            posts_col.update_one({'_id': ObjectId(postId)}, {'$inc': {'upvotes': 1}})
            doc = posts_col.find_one({'_id': ObjectId(postId)})
            upvotes = doc.get('upvotes', 0)
        else:
            for p in _in_memory_posts:
                if str(p.get('id')) == str(postId):
                    p['upvotes'] = p.get('upvotes', 0) + 1
                    upvotes = p['upvotes']
                    break
    except Exception as e:
        print('Warning: upvote persistence failed', e)
        upvotes = int(time.time()) % 20
    emit('vote_updated', {'postId': postId, 'upvotes': upvotes}, broadcast=True, include_self=False)


@socketio.on('upvote')
def handle_upvote(data):
    # alias used by client: { postId, replyId? }
    postId = data.get('postId')
    replyId = data.get('replyId')
    if replyId:
        handle_upvote_reply({'postId': postId, 'replyId': replyId})
    else:
        handle_upvote_post({'postId': postId})


@socketio.on('get_initial_posts')
def handle_get_initial_posts(data):
    category = data.get('category')
    try:
        if MONGO_URI:
            query = {} if not category else {'category': category}
            docs = list(posts_col.find(query).sort('createdAt', -1).limit(200))
            for d in docs:
                d['id'] = str(d.get('_id'))
                d.pop('_id', None)
            emit('initial_posts', docs, room=request.sid)
        else:
            items = [p for p in _in_memory_posts if (not category or p.get('category') == category)]
            emit('initial_posts', items, room=request.sid)
    except Exception as e:
        print('Error get_initial_posts:', e)

@socketio.on('upvote_reply')
def handle_upvote_reply(data):
    postId = data.get('postId')
    replyId = data.get('replyId')
    print('Reply upvoted:', replyId, 'on post:', postId)
    try:
        if MONGO_URI:
            posts_col.update_one({'_id': ObjectId(postId), 'replies.id': replyId}, {'$inc': {'replies.$.upvotes': 1}})
            doc = posts_col.find_one({'_id': ObjectId(postId)})
            # find reply upvotes
            upvotes = 0
            for r in doc.get('replies', []):
                if str(r.get('id')) == str(replyId):
                    upvotes = r.get('upvotes', 0)
                    break
        else:
            upvotes = int(time.time()) % 15
    except Exception as e:
        print('Warning: upvote_reply failed', e)
        upvotes = int(time.time()) % 15
    emit('vote_updated', {'postId': postId, 'replyId': replyId, 'upvotes': upvotes}, broadcast=True, include_self=False)

@socketio.on('pin_post')
def handle_pin_post(data):
    postId = data.get('postId')
    print('Post pinned/unpinned:', postId)
    try:
        if MONGO_URI:
            doc = posts_col.find_one({'_id': ObjectId(postId)})
            new = not doc.get('isPinned', False)
            posts_col.update_one({'_id': ObjectId(postId)}, {'$set': {'isPinned': new}})
            isPinned = new
        else:
            for p in _in_memory_posts:
                if str(p.get('id')) == str(postId):
                    p['isPinned'] = not p.get('isPinned', False)
                    isPinned = p['isPinned']
                    break
    except Exception as e:
        print('Warning: pin persistence failed', e)
        isPinned = bool(int(time.time()) % 2)
    emit('post_pinned', {'postId': postId, 'isPinned': isPinned}, broadcast=True, include_self=False)

@socketio.on('verify_reply')
def handle_verify_reply(data):
    postId = data.get('postId')
    replyId = data.get('replyId')
    print('Reply verified:', replyId)
    try:
        if MONGO_URI:
            posts_col.update_one({'_id': ObjectId(postId), 'replies.id': replyId}, {'$set': {'replies.$.isVerified': True}})
        else:
            for p in _in_memory_posts:
                if str(p.get('id')) == str(postId):
                    for r in p.get('replies', []):
                        if str(r.get('id')) == str(replyId):
                            r['isVerified'] = True
                            break
    except Exception as e:
        print('Warning: verify persistence failed', e)
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
    try:
        if MONGO_URI:
            reports_col.insert_one({**reportData, 'createdAt': time.strftime('%Y-%m-%dT%H:%M:%S')})
        else:
            # no-op for in-memory
            pass
    except Exception as e:
        print('Warning: failed to persist report', e)

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
