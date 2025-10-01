import os
from datetime import datetime
import uuid

try:
    from pymongo import MongoClient
except Exception:
    MongoClient = None

mongo_client = None
mongo_db = None
phq9_collection = None
chat_collection = None
chat_in_memory = None

def init_mongo():
    global mongo_client, mongo_db, phq9_collection
    global chat_collection
    MONGO_URI = os.getenv("MONGO_URI")
    MONGO_DB = os.getenv("MONGO_DB_NAME")
    if MongoClient and MONGO_URI:
        try:
            mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
            try:
                mongo_db = mongo_client.get_default_database() or mongo_client[MONGO_DB]
            except Exception:
                mongo_db = mongo_client[MONGO_DB]
            phq9_collection = mongo_db["phq9_responses"]
            # chat sessions collection
            try:
                chat_collection = mongo_db["chat_sessions"]
                try:
                    chat_collection.create_index([("user_email", 1), ("createdAt", -1)], name="chat_user_created_desc")
                except Exception:
                    pass
            except Exception:
                chat_collection = None
            try:
                phq9_collection.create_index([("user_email", 1), ("timestamp", -1)], name="user_ts_desc")
            except Exception:
                pass
        except Exception as e:
            print("Warning: could not connect to MongoDB:", e)
            mongo_client = None
    else:
        mongo_client = None
        mongo_db = None
        phq9_collection = None

def get_phq9_collection():
    return phq9_collection


def get_chat_collection():
    return chat_collection


def _safe_objectid(oid):
    try:
        # lazy import so file works without pymongo installed
        from bson.objectid import ObjectId
        return ObjectId(oid)
    except Exception:
        return None


def create_chat_session(user_email: str = None):
    """Create a new chat session for the given email (optional) and return session id (string).

    If user_email is None, a global/anonymous session is created. Falls back to an in-memory list when DB not configured.
    """
    now = datetime.utcnow()
    email_lower = (user_email or None)
    if isinstance(email_lower, str):
        email_lower = email_lower.lower()
    if chat_collection is not None:
        doc = {"user_email": email_lower, "createdAt": now, "messages": []}
        res = chat_collection.insert_one(doc)
        try:
            return str(res.inserted_id)
        except Exception:
            return None

    # in-memory fallback: store sessions as a list
    if chat_in_memory is None:
        globals()['chat_in_memory'] = []
    store = globals().get('chat_in_memory')
    sid = f"mem-{uuid.uuid4().hex}"
    sess = {"id": sid, "user_email": email_lower, "createdAt": now, "messages": []}
    store.insert(0, sess)
    return sid


def append_message_to_session(session_id: str, message: dict):
    """Append a message object to a session; message should contain at least {from, text, timestamp}.

    Returns True on success, False otherwise.
    """
    if not session_id or not isinstance(message, dict):
        return False
    if chat_collection is not None:
        oid = _safe_objectid(session_id)
        try:
            if oid is not None:
                chat_collection.update_one({"_id": oid}, {"$push": {"messages": message}})
                return True
        except Exception:
            return False
        return False

    # in-memory fallback: chat_in_memory is a list of session dicts
    store = globals().get('chat_in_memory') or []
    # find session by id
    for s in store:
        if s.get('id') == session_id:
            s.setdefault('messages', [])
            # append a shallow copy of the message to avoid accidental shared references
            try:
                s['messages'].append(dict(message))
            except Exception:
                s['messages'].append(message)
            return True
    return False


def get_sessions_by_email(email: str = None):
    """Return sessions filtered by email if provided, otherwise return recent sessions globally."""
    out = []
    email_lower = (email or None)
    if isinstance(email_lower, str):
        email_lower = email_lower.lower()

    if chat_collection is not None:
        try:
            query = {}
            if email_lower:
                query['user_email'] = email_lower
            docs = list(chat_collection.find(query).sort([('createdAt', -1)]).limit(200))
            for d in docs:
                s = dict(d)
                try:
                    s['id'] = str(s.pop('_id'))
                except Exception:
                    s.pop('_id', None)
                msgs = s.get('messages', []) or []
                last = msgs[-1] if msgs else None
                # trim lastMessage to a lightweight shape
                lm = None
                if last:
                    lm = {
                        'text': last.get('text') or last.get('message') or last.get('content') or '',
                        'from': last.get('from') or last.get('role') or None,
                        'timestamp': None
                    }
                    try:
                        if 'timestamp' in last and hasattr(last['timestamp'], 'isoformat'):
                            lm['timestamp'] = last['timestamp'].isoformat()
                        else:
                            lm['timestamp'] = last.get('timestamp')
                    except Exception:
                        lm['timestamp'] = last.get('timestamp')
                out.append({
                    'id': s.get('id'),
                    'createdAt': s.get('createdAt'),
                    'messageCount': len(msgs),
                    'lastMessage': lm
                })
            return out
        except Exception:
            return out

    # in-memory fallback: list the sessions, optionally filter by email
    store = globals().get('chat_in_memory') or []
    for s in store:
        if email_lower and s.get('user_email') != email_lower:
            continue
        msgs = s.get('messages', []) or []
        out.append({'id': s.get('id'), 'createdAt': s.get('createdAt'), 'messageCount': len(msgs), 'lastMessage': msgs[-1] if msgs else None})
    return out


def get_session_messages(email: str = None, session_id: str = None, limit: int = None, offset: int = 0, tail: bool = False):
    """Return messages for a session.

    Parameters:
    - email: optional email to verify session ownership
    - session_id: required session id
    - limit: optional number of messages to return
    - offset: optional start index (0-based) when not tail
    - tail: when True and limit provided, return the last `limit` messages
    """
    if not session_id:
        return None
    email_lower = (email or None)
    if isinstance(email_lower, str):
        email_lower = email_lower.lower()

    if chat_collection is not None:
        try:
            oid = _safe_objectid(session_id)
            if oid is None:
                return None
            query = {"_id": oid}
            if email_lower:
                query['user_email'] = email_lower

            # If limit provided, use Mongo projection with $slice to avoid loading huge arrays
            if isinstance(limit, int) and limit > 0:
                if tail:
                    projection = {'messages': {'$slice': -limit}}
                else:
                    # slice with offset and limit
                    try:
                        o = int(offset) if offset and int(offset) >= 0 else 0
                    except Exception:
                        o = 0
                    projection = {'messages': {'$slice': [o, limit]}}
                doc = chat_collection.find_one(query, projection)
            else:
                doc = chat_collection.find_one(query)

            if not doc:
                return None
            msgs = doc.get('messages', []) or []
            # convert datetimes if present
            out = []
            for m in msgs:
                mm = dict(m)
                if 'timestamp' in mm and hasattr(mm['timestamp'], 'isoformat'):
                    try:
                        mm['timestamp'] = mm['timestamp'].isoformat()
                    except Exception:
                        pass
                out.append(mm)
            return out
        except Exception:
            return None

    # in-memory fallback: search globally for the session id
    store = globals().get('chat_in_memory') or []
    for s in store:
        if s.get('id') == session_id:
            # optional email check
            if email_lower and s.get('user_email') and s.get('user_email') != email_lower:
                return None
            msgs = s.get('messages', []) or []
            if isinstance(limit, int) and limit > 0:
                if tail:
                    sel = msgs[-limit:]
                else:
                    try:
                        o = int(offset) if offset and int(offset) >= 0 else 0
                    except Exception:
                        o = 0
                    sel = msgs[o:o+limit]
            else:
                sel = msgs
            out = []
            for m in sel:
                mm = dict(m)
                if 'timestamp' in mm and hasattr(mm['timestamp'], 'isoformat'):
                    try:
                        mm['timestamp'] = mm['timestamp'].isoformat()
                    except Exception:
                        pass
                out.append(mm)
            return out
    return None


def delete_chat_session(session_id: str):
    """Delete a chat session by id. Returns True on success, False otherwise."""
    if not session_id:
        return False
    if chat_collection is not None:
        oid = _safe_objectid(session_id)
        if oid is None:
            return False
        try:
            res = chat_collection.delete_one({"_id": oid})
            return (res.deleted_count > 0)
        except Exception:
            return False

    # in-memory fallback
    store = globals().get('chat_in_memory') or []
    for i, s in enumerate(list(store)):
        if s.get('id') == session_id:
            try:
                store.pop(i)
                return True
            except Exception:
                return False
    return False

def insert_phq9(doc):
    if phq9_collection is not None:
        phq9_collection.insert_one(doc)
        return True
    return False

def find_latest_phq9(email):
    if phq9_collection is not None:
        doc = phq9_collection.find_one({"user_email": email.lower()}, sort=[("timestamp", -1)])
        return doc
    return None
