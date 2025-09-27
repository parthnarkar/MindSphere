import { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';


const resolveSocketUrl = () => {
  const URL = import.meta.env.VITE_SOCKET_URL;

  // If an explicit env var is provided and not the literal string 'undefined', use it.
  if (URL && URL !== 'undefined') return URL;

  // Fallback: construct a backend URL on the same host using port 3000 (socketserver default).
  // Use https when page is https.
  try {
    const proto = window.location.protocol === 'https:' ? 'https' : 'http';
    const host = window.location.hostname || 'localhost';
    const port = '3000'; // socketserver default port
    return `${proto}://${host}:${port}`;
  } catch (e) {
    // If window is not available for some reason, fall back to localhost
    return 'http://localhost:5000';
  }
};

const useSocket = (serverUrl = resolveSocketUrl()) => {
  const socketRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState([]);

  useEffect(() => {
    // Initialize socket connection
    if (!serverUrl || serverUrl === 'undefined') {
      console.warn('useSocket: invalid serverUrl, skipping socket init:', serverUrl);
      return;
    }

    try {
      // Log the resolved URL for easier debugging when connection fails
      console.debug('useSocket: connecting to', serverUrl);

      socketRef.current = io(serverUrl, {
        // Prefer polling first in development. When the Python Socket.IO server
        // runs with the threading fallback (no eventlet/gevent), websocket
        // upgrades are not supported and a raw HTTP response can cause the
        // "Invalid frame header" error in the browser. Listing 'polling'
        // first avoids attempting a websocket upgrade immediately.
        transports: ['polling', 'websocket'],
        timeout: 20000,
        reconnectionAttempts: 10,
        reconnectionDelayMax: 5000,
        autoConnect: true,
      });
    } catch (err) {
      // Some environments may throw synchronously
      console.error('useSocket: failed to initialize socket.io client', err);
      return;
    }

    const socket = socketRef.current;

    // Connection event handlers
    socket.on('connect', () => {
      console.log('Connected to server');
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    });

    let reconnectAttempts = 0;
    socket.on('connect_error', (error) => {
      // Connection error (server not reachable / websocket blocked)
      console.warn('useSocket: connection error (will retry):', error && error.message ? error.message : error);
      setIsConnected(false);
      // Exponential backoff for reconnect attempts
      reconnectAttempts += 1;
      const backoff = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
      setTimeout(() => {
        try {
          if (socket && !socket.connected) socket.connect();
        } catch (e) {
          // swallow
        }
      }, backoff);
    });

    // Online users tracking
    socket.on('users_online', (users) => {
      setOnlineUsers(users);
    });

    socket.on('user_joined', (user) => {
      setOnlineUsers(prev => [...prev, user]);
    });

    socket.on('user_left', (userId) => {
      setOnlineUsers(prev => prev.filter(user => user.id !== userId));
    });

    // Cleanup on unmount
    return () => {
      if (socket) {
        try { socket.disconnect(); } catch (e) { /* ignore */ }
      }
    };
  }, [serverUrl]);

  // Exposed helper to announce the current user to the socket server
  const joinUser = (userData) => {
    if (socketRef.current && (socketRef.current.connected || socketRef.current.connecting)) {
      socketRef.current.emit('user_join', userData);
    } else if (socketRef.current) {
      // wait for connect then emit
      const onceConnect = () => {
        socketRef.current.emit('user_join', userData);
        socketRef.current.off('connect', onceConnect);
      };
      socketRef.current.on('connect', onceConnect);
    }
  };

  // Socket event listeners
  const on = (event, callback) => {
    if (socketRef.current) {
      socketRef.current.on(event, callback);
    }
  };

  const off = (event, callback) => {
    if (socketRef.current) {
      socketRef.current.off(event, callback);
    }
  };

  // Socket event emitters
  const emit = (event, data) => {
    if (socketRef.current && isConnected) {
      socketRef.current.emit(event, data);
    }
  };

  // Join a room (for category-based discussions)
  const joinRoom = (roomId) => {
    emit('join_room', { roomId });
  };

  const leaveRoom = (roomId) => {
    emit('leave_room', { roomId });
  };

  // Real-time post operations
  const createPost = (post) => {
    emit('create_post', post);
  };

  const updatePost = (postId, updates) => {
    emit('update_post', { postId, updates });
  };

  const deletePost = (postId) => {
    emit('delete_post', { postId });
  };

  const addReply = (postId, reply) => {
    emit('add_reply', { postId, reply });
  };

  const upvotePost = (postId) => {
    emit('upvote_post', { postId });
  };

  const upvoteReply = (postId, replyId) => {
    emit('upvote_reply', { postId, replyId });
  };

  const pinPost = (postId) => {
    emit('pin_post', { postId });
  };

  const verifyReply = (postId, replyId) => {
    emit('verify_reply', { postId, replyId });
  };

  const reportContent = (reportData) => {
    emit('report_content', reportData);
  };

  // Typing indicators
  const startTyping = (postId) => {
    emit('typing_start', { postId });
  };

  const stopTyping = (postId) => {
    emit('typing_stop', { postId });
  };

  return {
    socket: socketRef.current,
    isConnected,
    onlineUsers,
    on,
    off,
    emit,
    joinRoom,
    leaveRoom,
    createPost,
    updatePost,
    deletePost,
    addReply,
    upvotePost,
    upvoteReply,
    pinPost,
    verifyReply,
    reportContent,
    startTyping,
    stopTyping
  };
};

export default useSocket;