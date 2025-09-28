try:
    # when executed as a package
    from .app import app, socketio
    import handlers as _handlers  # registers routes and socket handlers
except Exception:
    # fallback when running as a script (python index.py)
    from app import app, socketio
    import handlers as _handlers
import os

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 3000))
    print('WebSocket server ready for connections')
    socketio.run(app, port=port)
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

# helper to safely log the Mongo host without leaking credentials
def _mask_mongo_uri(uri: str):
    """Return a redacted summary of a Mongo URI for safe logging."""
    try:
        if not uri:
            return 'None'
        # Try to extract host part without credentials
        if '//' in uri:
            after = uri.split('//', 1)[1]
        else:
            after = uri
        # if credentials present, host follows '@'
        if '@' in after:
            host_part = after.split('@', 1)[1]
        else:
            host_part = after
        # host is up to first slash
        host = host_part.split('/', 1)[0]
        return f'<mongo host={host}>'
    except Exception:
        return '<mongo uri masked>'

# MongoDB setup (optional). If MONGO_URI not set, fall back to in-memory store.
# Read from environment first, then try to load the project's server/.env (useful during
# local development where the .env values may include surrounding quotes).
MONGO_URI = os.environ.get('MONGO_URI')
DB_NAME = os.environ.get('MONGO_DB_NAME')

# Attempt to read server/.env relative to the repository root (socketserver/api -> ../../server/.env)
try:
    env_path = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', 'server', '.env'))
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                k, v = line.split('=', 1)
                k = k.strip()
                v = v.strip()
                # strip surrounding single/double quotes if present
                if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                    v = v[1:-1]
                if k == 'MONGO_URI' and not MONGO_URI:
                    MONGO_URI = v
                if k == 'MONGO_DB_NAME' and (not os.environ.get('MONGO_DB_NAME')):
                    DB_NAME = v or DB_NAME
except Exception as e:
    print('Warning reading server/.env for socketserver:', e)

if MONGO_URI:
    try:
        mongo = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
        # ping to ensure connection works and credentials/URI are valid
        mongo.admin.command('ping')
        db = mongo.get_database(DB_NAME)
        posts_col = db.get_collection('posts')
        reports_col = db.get_collection('reports')
        print('Connected to MongoDB', _mask_mongo_uri(MONGO_URI))
    except Exception as e:
        print('MongoDB connection failed (socketserver):', e)
        # disable DB usage and fall back to in-memory store
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
    # Send current online users to the connecting client for initial state
    try:
        emit('users_online', online_users, room=request.sid)
    except Exception:
        pass

@socketio.on('user_join')
def handle_user_join(userData):
    # Normalize user data and store with socket id
    u = userData or {}
    if 'id' not in u:
        u['id'] = u.get('userId') or u.get('uid') or str(request.sid)
    if 'name' not in u:
        u['name'] = u.get('displayName') or 'Anonymous'
    connected_users[request.sid] = u

    # Ensure we don't have duplicate socket entries
    # remove any existing entry with same socketId first
    online_users[:] = [o for o in online_users if o.get('socketId') != request.sid]
    online_users.append({**u, 'socketId': request.sid})

    # Broadcast updated user list
    try:
        emit('users_online', online_users, broadcast=True)
        emit('user_joined', u, broadcast=True, include_self=False)
    except Exception as e:
        print('Warning: emit users_online failed', e)

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
        emit('post_created', post, broadcast=True, include_self=True)

@socketio.on('add_reply')
def handle_add_reply(data):
    postId = data.get('postId')
    reply = data.get('reply')
    print('New reply added to post:', postId)
    try:
        parentId = reply.get('parentId') if isinstance(reply, dict) else None
        if MONGO_URI:
            print('handle_add_reply: persisting reply to MongoDB', _mask_mongo_uri(MONGO_URI), 'parentId=', parentId)
            # ensure reply has an id
            if not reply.get('id'):
                reply['id'] = str(int(time.time() * 1000))
            oid = _safe_objectid(postId)
            if oid:
                if parentId:
                    # try to push into parent's children array (one-level threading)
                    res = posts_col.update_one({'_id': oid, 'replies.id': parentId}, {'$push': {'replies.$.children': reply}})
                    if res.modified_count == 0:
                        # fallback: fetch document and insert in Python (supports slightly more complex nesting)
                        doc = posts_col.find_one({'_id': oid})
                        if doc:
                            modified = False
                            for r in doc.get('replies', []):
                                if str(r.get('id')) == str(parentId):
                                    r.setdefault('children', []).append(reply)
                                    modified = True
                                    break
                            if modified:
                                posts_col.replace_one({'_id': oid}, doc)
                else:
                    # push reply atomically at top-level
                    posts_col.update_one({'_id': oid}, {'$push': {'replies': reply}})
        else:
            # in-memory fallback: support parentId threading
            for p in _in_memory_posts:
                if str(p.get('id')) == str(postId):
                    if parentId:
                        # find parent reply and append to its children
                        for r in p.setdefault('replies', []):
                            if str(r.get('id')) == str(parentId):
                                r.setdefault('children', []).append(reply)
                                break
                    else:
                        p.setdefault('replies', []).append(reply)
                    break
    except Exception as e:
        print('Warning: failed to persist reply:', e)
        emit('reply_added', {'postId': postId, 'reply': reply}, broadcast=True, include_self=True)

@socketio.on('upvote_post')
def handle_upvote_post(data):
    postId = data.get('postId')
    print('Post upvoted:', postId)
    try:
        if MONGO_URI:
            oid = _safe_objectid(postId)
            if oid:
                posts_col.update_one({'_id': oid}, {'$inc': {'upvotes': 1}})
                doc = posts_col.find_one({'_id': oid})
                upvotes = doc.get('upvotes', 0)
            else:
                upvotes = 0
        else:
            for p in _in_memory_posts:
                if str(p.get('id')) == str(postId):
                    p['upvotes'] = p.get('upvotes', 0) + 1
                    upvotes = p['upvotes']
                    break
    except Exception as e:
        print('Warning: upvote persistence failed', e)
        upvotes = int(time.time()) % 20
        emit('vote_updated', {'postId': postId, 'upvotes': upvotes}, broadcast=True, include_self=True)


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
            oid = _safe_objectid(postId)
            if oid:
                # Try top-level reply increment first
                res = posts_col.update_one({'_id': oid, 'replies.id': replyId}, {'$inc': {'replies.$.upvotes': 1}})
                if res.modified_count:
                    # fetch new upvote count
                    doc = posts_col.find_one({'_id': oid})
                    upvotes = 0
                    for r in doc.get('replies', []):
                        if str(r.get('id')) == str(replyId):
                            upvotes = r.get('upvotes', 0)
                            break
                else:
                    # Maybe it's a nested child (reply.children[].id). Do a find & update in Python
                    doc = posts_col.find_one({'_id': oid})
                    upvotes = 0
                    if doc:
                        modified = False
                        for r in doc.get('replies', []):
                            for c in r.get('children', []):
                                if str(c.get('id')) == str(replyId):
                                    c['upvotes'] = c.get('upvotes', 0) + 1
                                    upvotes = c['upvotes']
                                    modified = True
                                    break
                            if modified:
                                break
                        if modified:
                            posts_col.replace_one({'_id': oid}, doc)
            else:
                upvotes = 0
        else:
            upvotes = int(time.time()) % 15
    except Exception as e:
        print('Warning: upvote_reply failed', e)
        upvotes = int(time.time()) % 15
        emit('vote_updated', {'postId': postId, 'replyId': replyId, 'upvotes': upvotes}, broadcast=True, include_self=True)

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
        emit('post_pinned', {'postId': postId, 'isPinned': isPinned}, broadcast=True, include_self=True)

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
        emit('reply_verified', {'postId': postId, 'replyId': replyId, 'isVerified': True}, broadcast=True, include_self=True)

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
