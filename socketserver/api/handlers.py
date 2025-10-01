import time
from flask import jsonify, request
from bson.objectid import ObjectId
from flask_socketio import emit
try:
    # when used as a package
    from .app import app, socketio
    from .db import load_db_from_env, get_in_memory_posts
    from .utils import safe_objectid
except Exception:
    # fallback when running as a script
    from app import app, socketio
    from db import load_db_from_env, get_in_memory_posts
    from utils import safe_objectid

# Initialize DB/collections
db_state = load_db_from_env()
posts_col = db_state.get('posts_col')
reports_col = db_state.get('reports_col')
# replies_col intentionally removed - all data stored in posts collection
replies_col = None
MONGO_URI = db_state.get('MONGO_URI')
_in_memory_posts = get_in_memory_posts()


def _emit_full_post(postId):
    """Fetch the canonical post from Mongo or in-memory, normalize replies into nested children,
    and emit 'post_updated' to all clients (including the emitter). Returns True on success."""
    try:
        if MONGO_URI:
            oid = safe_objectid(postId)
            if oid:
                doc = posts_col.find_one({'_id': oid})
                if doc:
                    doc['id'] = str(doc.get('_id'))
                    doc.pop('_id', None)
                    doc.setdefault('replies', [])
                    for r in doc['replies']:
                        r.setdefault('children', [])
                    # build nested children mapping for embedded replies
                    by_id = {str(r.get('id')): r for r in doc.get('replies', [])}
                    roots = []
                    for r in list(doc.get('replies', [])):
                        parent = r.get('parentId')
                        if parent and str(parent) in by_id:
                            by_id[str(parent)].setdefault('children', []).append(r)
                        else:
                            roots.append(r)
                    doc['replies'] = roots
                    emit('post_updated', doc, broadcast=True)
                    return True
        else:
            for p in _in_memory_posts:
                if str(p.get('id')) == str(postId):
                    emit('post_updated', p, broadcast=True)
                    return True
    except Exception as e:
        print('Warning: failed to emit full post_updated', e)
    return False


@app.route('/api/posts', methods=['GET'])
def get_posts():
    category = request.args.get('category')
    try:
        if MONGO_URI:
            query = {} if not category else {'category': category}
            docs = list(posts_col.find(query).sort('createdAt', -1).limit(200))
            for d in docs:
                pid = str(d.get('_id'))
                d['id'] = pid
                d.pop('_id', None)
                # Ensure replies exist and have ids
                d.setdefault('replies', [])
                for r in d['replies']:
                    if not r.get('id') and r.get('_id'):
                        r['id'] = str(r.get('_id'))
                    r.pop('_id', None)
                    r.setdefault('children', [])
                # build nested children mapping for embedded replies
                by_id = {str(r.get('id')): r for r in d.get('replies', [])}
                roots = []
                for r in list(d.get('replies', [])):
                    parent = r.get('parentId')
                    if parent and str(parent) in by_id:
                        by_id[str(parent)].setdefault('children', []).append(r)
                    else:
                        roots.append(r)
                d['replies'] = roots
            return jsonify(docs)
        else:
            items = [p for p in _in_memory_posts if (not category or p.get('category') == category)]
            return jsonify(items)
    except Exception as e:
        print('Error fetching posts:', e)
        return jsonify([]), 500


@app.route('/api/posts', methods=['POST'])
def create_post_http():
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


# Socket handlers
@socketio.on('connect')
def handle_connect():
    print('User connected:', request.sid)
    try:
        emit('users_online', [], room=request.sid)
    except Exception:
        pass


@socketio.on('disconnect')
def handle_disconnect():
    print('User disconnected:', request.sid)


@socketio.on('create_post')
def handle_create_post(post):
    print('New post created:', post.get('title'))
    try:
        # Persist post to Mongo if available (no longer require author.email)
        if MONGO_URI:
            # preserve clientTempId if provided so clients can reconcile optimistic posts
            client_temp = post.get('clientTempId')
            post_doc = {k: v for k, v in post.items() if k not in ('id', 'clientTempId')}
            res = posts_col.insert_one({**post_doc, 'createdAt': time.strftime('%Y-%m-%dT%H:%M:%S'), 'replies': []})
            post['id'] = str(res.inserted_id)
            if client_temp:
                post['clientTempId'] = client_temp
        # broadcast canonical post to all clients (including emitter)
        emit('post_created', post, broadcast=True)
    except Exception as e:
        print('Warning: failed to persist post:', e)
        emit('post_created', post, broadcast=True)


@socketio.on('add_reply')
def handle_add_reply(data):
    postId = data.get('postId')
    reply = data.get('reply')
    print('New reply added to post:', postId)
    try:
        parentId = reply.get('parentId') if isinstance(reply, dict) else None
        # Persist reply embedded inside the post document (no longer require author.email)
        try:
            # prepare reply object
            reply_obj = {k: v for k, v in reply.items() if k != 'id'}
            reply_obj['id'] = reply.get('id') or str(int(time.time() * 1000))
            reply_obj['parentId'] = parentId or None
            reply_obj['createdAt'] = time.strftime('%Y-%m-%dT%H:%M:%S')
            reply_obj['upvotes'] = int(reply_obj.get('upvotes', 0))

            if MONGO_URI:
                # atomic update: pull existing reply id if present (avoid duplicates), then push
                oid = safe_objectid(postId)
                if oid:
                    # load post, update embedded replies array
                    doc = posts_col.find_one({'_id': oid})
                    if not doc:
                        raise Exception('post not found')
                    replies = doc.get('replies', []) or []
                    # if parentId present, attach as child under that reply; otherwise top-level
                    if reply_obj['parentId']:
                        # find parent in flat list or nested children
                        attached = False
                        for r in replies:
                            if str(r.get('id')) == str(reply_obj['parentId']):
                                r.setdefault('children', []).append(reply_obj)
                                attached = True
                                break
                            # search children
                            for c in r.get('children', []):
                                if str(c.get('id')) == str(reply_obj['parentId']):
                                    c.setdefault('children', []).append(reply_obj)
                                    attached = True
                                    break
                            if attached:
                                break
                        if not attached:
                            # parent not found; treat as top-level
                            replies.append(reply_obj)
                    else:
                        replies.append(reply_obj)
                    posts_col.update_one({'_id': oid}, {'$set': {'replies': replies}})
                else:
                    # fallback for non-objectid ids
                    pass
            else:
                # in-memory fallback: attach to post.replies
                for p in _in_memory_posts:
                    if str(p.get('id')) == str(postId):
                        if parentId:
                            attached = False
                            for r in p.setdefault('replies', []):
                                if str(r.get('id')) == str(parentId):
                                    r.setdefault('children', []).append(reply_obj)
                                    attached = True
                                    break
                                for c in r.get('children', []):
                                    if str(c.get('id')) == str(parentId):
                                        c.setdefault('children', []).append(reply_obj)
                                        attached = True
                                        break
                                if attached:
                                    break
                            if not attached:
                                p.setdefault('replies', []).append(reply_obj)
                        else:
                            p.setdefault('replies', []).append(reply_obj)
                        break
            # canonicalize reply variable for broadcast
            reply = reply_obj
        except Exception as e:
            print('Warning: failed to persist reply:', e)
    except Exception as e:
        print('Warning: failed to persist reply:', e)
    # broadcast canonical reply object to all clients (including emitter)
    # Also emit the full updated post so clients can replace entire thread state
    try:
        if MONGO_URI:
            oid = safe_objectid(postId)
            if oid:
                doc = posts_col.find_one({'_id': oid})
                if doc:
                    # normalize and emit full updated post
                    doc['id'] = str(doc.get('_id'))
                    doc.pop('_id', None)
                    doc.setdefault('replies', [])
                    for r in doc['replies']:
                        r.setdefault('children', [])
                    # build nested children
                    by_id = {str(r.get('id')): r for r in doc.get('replies', [])}
                    roots = []
                    for r in list(doc.get('replies', [])):
                        parent = r.get('parentId')
                        if parent and str(parent) in by_id:
                            by_id[str(parent)].setdefault('children', []).append(r)
                        else:
                            roots.append(r)
                    doc['replies'] = roots
                    emit('post_updated', doc, broadcast=True)
                    return
        else:
            # emit in-memory post
            for p in _in_memory_posts:
                if str(p.get('id')) == str(postId):
                    emit('post_updated', p, broadcast=True)
                    return
    except Exception as e:
        print('Warning: failed to emit full post_updated', e)
    # fallback: emit minimal reply event
    emit('reply_added', {'postId': postId, 'reply': reply}, broadcast=True)


@socketio.on('upvote')
def handle_upvote(data):
    postId = data.get('postId')
    replyId = data.get('replyId')
    if replyId:
        handle_upvote_reply({'postId': postId, 'replyId': replyId})
    else:
        handle_upvote_post({'postId': postId})


def handle_upvote_post(data):
    postId = data.get('postId')
    print('Post upvoted:', postId)
    upvotes = 0
    try:
        if MONGO_URI:
            oid = safe_objectid(postId)
            if oid:
                # atomic increment on embedded upvotes field
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
    safe_upvotes = locals().get('upvotes', 0)
    # Emit full post to keep clients fully synced
    if not _emit_full_post(postId):
        emit('vote_updated', {'postId': postId, 'upvotes': safe_upvotes}, broadcast=True)


def handle_upvote_reply(data):
    postId = data.get('postId')
    replyId = data.get('replyId')
    print('Reply upvoted:', replyId, 'on post:', postId)
    try:
        # Update embedded reply upvotes inside the post document
        if MONGO_URI:
            oid = safe_objectid(postId)
            if oid:
                doc = posts_col.find_one({'_id': oid})
                upvotes = 0
                if doc:
                    modified = False
                    replies = doc.get('replies', []) or []
                    for r in replies:
                        if str(r.get('id')) == str(replyId):
                            r['upvotes'] = r.get('upvotes', 0) + 1
                            upvotes = r['upvotes']
                            modified = True
                            break
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
            upvotes = None
            for p in _in_memory_posts:
                if str(p.get('id')) == str(postId):
                    for r in p.get('replies', []):
                        if str(r.get('id')) == str(replyId):
                            r['upvotes'] = r.get('upvotes', 0) + 1
                            upvotes = r['upvotes']
                            break
                        for c in r.get('children', []):
                            if str(c.get('id')) == str(replyId):
                                c['upvotes'] = c.get('upvotes', 0) + 1
                                upvotes = c['upvotes']
                                break
                        if upvotes is not None:
                            break
                    break
            if upvotes is None:
                upvotes = int(time.time()) % 15
    except Exception as e:
        print('Warning: upvote_reply failed', e)
        upvotes = int(time.time()) % 15
    emit('vote_updated', {'postId': postId, 'replyId': replyId, 'upvotes': upvotes}, broadcast=True)
    # Try to broadcast full post after reply upvote
    _emit_full_post(postId)


@socketio.on('get_initial_posts')
def handle_get_initial_posts(data):
    category = data.get('category')
    try:
        if MONGO_URI:
            query = {} if not category else {'category': category}
            docs = list(posts_col.find(query).sort('createdAt', -1).limit(200))
            for d in docs:
                pid = str(d.get('_id'))
                d['id'] = pid
                d.pop('_id', None)
                d.setdefault('replies', [])
                for r in d['replies']:
                    r.setdefault('children', [])
                # build nested children mapping for embedded replies
                by_id = {str(r.get('id')): r for r in d.get('replies', [])}
                roots = []
                for r in list(d.get('replies', [])):
                    parent = r.get('parentId')
                    if parent and str(parent) in by_id:
                        by_id[str(parent)].setdefault('children', []).append(r)
                    else:
                        roots.append(r)
                d['replies'] = roots
            emit('initial_posts', docs, room=request.sid)
        else:
            items = [p for p in _in_memory_posts if (not category or p.get('category') == category)]
            emit('initial_posts', items, room=request.sid)
    except Exception as e:
        print('Error get_initial_posts:', e)


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
    # Emit full post so clients receive authoritative state (include_self=False to avoid duplicating optimistic toggles)
    if not _emit_full_post(postId):
        emit('post_pinned', {'postId': postId, 'isPinned': isPinned}, broadcast=True, include_self=False)


@socketio.on('verify_reply')
def handle_verify_reply(data):
    postId = data.get('postId')
    replyId = data.get('replyId')
    print('Reply verified:', replyId)
    try:
        # Prefer replies_col verification
        if MONGO_URI and replies_col:
            rid = safe_objectid(replyId)
            if rid:
                res = replies_col.update_one({'_id': rid}, {'$set': {'isVerified': True}})
                if res.modified_count == 0:
                    # fallback to embedded
                    try:
                        oid = safe_objectid(postId)
                        if oid:
                            doc = posts_col.find_one({'_id': oid})
                            if doc:
                                modified = False
                                for r in doc.get('replies', []):
                                    if str(r.get('id')) == str(replyId):
                                        r['isVerified'] = True
                                        modified = True
                                        break
                                    for c in r.get('children', []):
                                        if str(c.get('id')) == str(replyId):
                                            c['isVerified'] = True
                                            modified = True
                                            break
                                    if modified:
                                        break
                                if modified:
                                    posts_col.replace_one({'_id': oid}, doc)
                    except Exception:
                        pass
        else:
            for p in _in_memory_posts:
                if str(p.get('id')) == str(postId):
                    for r in p.get('replies', []):
                        if str(r.get('id')) == str(replyId):
                            r['isVerified'] = True
                            break
                        for c in r.get('children', []):
                            if str(c.get('id')) == str(replyId):
                                c['isVerified'] = True
                                break
                    break
    except Exception as e:
        print('Warning: verify persistence failed', e)
    # Emit full post so clients receive authoritative state
    if not _emit_full_post(postId):
        emit('reply_verified', {'postId': postId, 'replyId': replyId, 'isVerified': True}, broadcast=True, include_self=False)


@socketio.on('typing_start')
def handle_typing_start(data):
    postId = data.get('postId')
    user = None
    try:
        user = request.sid
    except Exception:
        pass
    if user:
        emit('user_typing', {
            'userId': user,
            'userName': user,
            'postId': postId
        }, broadcast=True, include_self=False)


@socketio.on('typing_stop')
def handle_typing_stop(data):
    postId = data.get('postId')
    user = None
    try:
        user = request.sid
    except Exception:
        pass
    if user:
        emit('user_stopped_typing', {
            'userId': user,
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
