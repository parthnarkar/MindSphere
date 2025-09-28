import os
try:
    import eventlet  # type: ignore
    eventlet.monkey_patch()
    async_mode = 'eventlet'
    print('Using eventlet for async_mode (better WebSocket support)')
except Exception:
    try:
        from gevent import monkey  # type: ignore
        monkey.patch_all()
        async_mode = 'gevent'
        print('Using gevent for async_mode (better WebSocket support)')
    except Exception:
        async_mode = 'threading'
        print('No eventlet/gevent available; falling back to threading (development only)')

from flask import Flask
from flask_cors import CORS
from flask_socketio import SocketIO

app = Flask(__name__)
CORS(app)

socketio = SocketIO(
    app,
    async_mode=async_mode,
    cors_allowed_origins="*",
    logger=True,
    engineio_logger=True,
    ping_timeout=60,
    ping_interval=25,
)
