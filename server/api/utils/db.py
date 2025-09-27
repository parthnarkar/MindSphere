import os
from datetime import datetime

try:
    from pymongo import MongoClient
except Exception:
    MongoClient = None

mongo_client = None
mongo_db = None
phq9_collection = None

def init_mongo():
    global mongo_client, mongo_db, phq9_collection
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
