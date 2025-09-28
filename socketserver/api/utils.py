from bson.objectid import ObjectId

def safe_objectid(id_str):
    try:
        return ObjectId(id_str)
    except Exception:
        return None
