import os
import time
from pymongo import MongoClient

_in_memory_posts = []

def _mask_mongo_uri(uri: str):
    try:
        if not uri:
            return 'None'
        if '//' in uri:
            after = uri.split('//', 1)[1]
        else:
            after = uri
        if '@' in after:
            host_part = after.split('@', 1)[1]
        else:
            host_part = after
        host = host_part.split('/', 1)[0]
        return f'<mongo host={host}>'
    except Exception:
        return '<mongo uri masked>'


def load_db_from_env(env_path=None):
    MONGO_URI = os.environ.get('MONGO_URI')
    DB_NAME = os.environ.get('MONGO_DB_NAME') or 'mindsphere'

    # try reading project .env for development
    if not MONGO_URI:
        try:
            env_path = env_path or os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'server', '.env'))
            if os.path.exists(env_path):
                with open(env_path, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith('#') or '=' not in line:
                            continue
                        k, v = line.split('=', 1)
                        k = k.strip(); v = v.strip()
                        if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                            v = v[1:-1]
                        if k == 'MONGO_URI' and not MONGO_URI:
                            MONGO_URI = v
                        if k == 'MONGO_DB_NAME' and (not os.environ.get('MONGO_DB_NAME')):
                            DB_NAME = v or DB_NAME
        except Exception:
            pass

    if MONGO_URI:
        try:
            mongo = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
            mongo.admin.command('ping')
            db = mongo.get_database(DB_NAME)
            posts_col = db.get_collection('posts')
            reports_col = db.get_collection('reports')
            # Ensure useful indexes exist for performance and correctness
            try:
                posts_col.create_index([('createdAt', -1)])
                posts_col.create_index([('category', 1)])
                # replies will be stored embedded inside posts, so no separate replies collection/indexes
            except Exception:
                # indexing failures shouldn't block startup
                pass
            print('Connected to MongoDB', _mask_mongo_uri(MONGO_URI))
            return {'mongo': mongo, 'db': db, 'posts_col': posts_col, 'reports_col': reports_col, 'replies_col': None, 'MONGO_URI': MONGO_URI}
        except Exception as e:
            print('MongoDB connection failed (socketserver):', e)
            return {'mongo': None, 'db': None, 'posts_col': None, 'reports_col': None, 'MONGO_URI': None}
    return {'mongo': None, 'db': None, 'posts_col': None, 'reports_col': None, 'replies_col': None, 'MONGO_URI': None}


def get_in_memory_posts():
    return _in_memory_posts
