import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import utils from '../utils';

// Mock user data - in real app, this would come from authentication
const mockUser = {
  id: 1,
  name: 'John Doe',
  email: 'john@example.com',
  role: 'student', // student, counselor, admin
  avatar: 'https://via.placeholder.com/40'
};

// Socket backend URL (per your request). Falls back to same origin for dev if not configured.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || window.location.origin || '';

// Crisis Resources Sidebar Component
const CrisisResourcesSidebar = () => {
  const crisisAlert = utils.getCrisisAlertProps();
  
  return (
    <div className="bg-gradient-to-br from-red-50 to-pink-50 border border-red-200 rounded-2xl p-6 mb-6 shadow-lg">
      <div className="flex items-center space-x-2 mb-4">
        <span className="text-red-600 text-xl">🆘</span>
        <h3 className="font-bold text-red-800 text-lg">
          {crisisAlert.title}
        </h3>
      </div>
      <div className="space-y-4 text-sm">
        {crisisAlert.resources.map((resource, index) => (
          <div key={index} className="p-4 bg-white/80 backdrop-blur-sm border border-red-100 rounded-xl shadow-sm hover:shadow-md transition-shadow duration-200">
            <p className="font-semibold text-red-700 mb-1">{resource.name}</p>
            <p className="text-red-600 font-mono text-lg font-bold">{resource.contact}</p>
            <p className="text-red-500 text-xs mt-2">{resource.description}</p>
          </div>
        ))}
      </div>
      <div className="mt-6 p-4 bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 rounded-xl">
        <div className="flex items-start space-x-2">
          <span className="text-yellow-600 text-lg">💛</span>
          <p className="text-sm text-yellow-800">
            <strong>Remember:</strong> If you're having thoughts of self-harm, you're not alone. 
            Reach out for help - these resources are available 24/7.
          </p>
        </div>
      </div>
    </div>
  );
};

// Report Modal Component
const ReportModal = ({ show, target, onClose, onSubmit }) => {
  const [reportReason, setReportReason] = useState('');
  const [reportDetails, setReportDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reportReason) return;

    setIsSubmitting(true);
    try {
      await onSubmit({
        reason: reportReason,
        details: reportDetails.trim()
      });
      setReportReason('');
      setReportDetails('');
    } catch (error) {
      console.error('Failed to submit report:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-white/20 p-8 w-full max-w-md">
        <div className="flex items-center space-x-3 mb-6">
          <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center">
            <span className="text-red-600 text-lg">🚨</span>
          </div>
          <h3 className="text-xl font-bold text-gray-900">Report Content</h3>
        </div>
        <p className="text-gray-600 mb-6 leading-relaxed">
          Help us maintain a safe community by reporting inappropriate content.
        </p>
        
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 mb-6">
            <label className="flex items-center p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer">
              <input 
                type="radio" 
                name="report" 
                value="inappropriate"
                checked={reportReason === 'inappropriate'}
                onChange={(e) => setReportReason(e.target.value)}
                className="mr-3 text-red-600 focus:ring-red-500" 
              />
              <span className="text-sm font-medium">Inappropriate content</span>
            </label>
            <label className="flex items-center p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer">
              <input 
                type="radio" 
                name="report" 
                value="harassment"
                checked={reportReason === 'harassment'}
                onChange={(e) => setReportReason(e.target.value)}
                className="mr-3 text-red-600 focus:ring-red-500" 
              />
              <span className="text-sm font-medium">Harassment or bullying</span>
            </label>
            <label className="flex items-center p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer">
              <input 
                type="radio" 
                name="report" 
                value="spam"
                checked={reportReason === 'spam'}
                onChange={(e) => setReportReason(e.target.value)}
                className="mr-3 text-red-600 focus:ring-red-500" 
              />
              <span className="text-sm font-medium">Spam or irrelevant content</span>
            </label>
            <label className="flex items-center p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer">
              <input 
                type="radio" 
                name="report" 
                value="misinformation"
                checked={reportReason === 'misinformation'}
                onChange={(e) => setReportReason(e.target.value)}
                className="mr-3 text-red-600 focus:ring-red-500" 
              />
              <span className="text-sm font-medium">False information</span>
            </label>
            <label className="flex items-center p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer">
              <input 
                type="radio" 
                name="report" 
                value="crisis"
                checked={reportReason === 'crisis'}
                onChange={(e) => setReportReason(e.target.value)}
                className="mr-3 text-red-600 focus:ring-red-500" 
              />
              <span className="text-sm font-medium">Someone may be in crisis</span>
            </label>
          </div>
          
          <textarea
            value={reportDetails}
            onChange={(e) => setReportDetails(e.target.value)}
            placeholder="Additional details (optional)"
            rows={3}
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent mb-6 bg-gray-50 focus:bg-white transition-colors"
          />
          
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 text-gray-600 hover:text-gray-800 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!reportReason || isSubmitting}
              className="px-6 py-3 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-xl hover:from-red-700 hover:to-red-800 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-lg hover:shadow-xl"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const PeerToPeer = () => {
  // Main state
  const [user] = useState(mockUser);
  const [posts, setPosts] = useState([]);
  const [categories, setCategories] = useState(['General', 'Anxiety', 'Depression', 'Study Tips', 'Relationships']);
  const [selectedCategory, setSelectedCategory] = useState('General');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [typingUsers, setTypingUsers] = useState({});
  
  // UI state
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  
  // Form state
  const [newPost, setNewPost] = useState({
    title: '',
    content: '',
    category: 'General',
    anonymous: false
  });
  const [replyContent, setReplyContent] = useState('');
  const [activeReplyTo, setActiveReplyTo] = useState(null);
  const [replyTargetPostId, setReplyTargetPostId] = useState(null);
  const [formErrors, setFormErrors] = useState([]);

  // WebSocket connection
  // inline socket client (replaces useSocket hook)
  const socketRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState([]);

  // Typing timeout ref
  const typingTimeoutRef = useRef(null);

  // Initialize data and WebSocket listeners
  useEffect(() => {
    loadInitialData();
    // initialize socket and attach listeners
    try {
      socketRef.current = io(SOCKET_URL, { transports: ['polling', 'websocket'] });
    } catch (e) {
      console.warn('Socket init failed', e);
      socketRef.current = null;
    }

    if (socketRef.current) {
      const s = socketRef.current;
      s.on('connect', () => {
        setIsConnected(true);
        s.emit('user_join', { id: user.id, name: user.name });
        // ask for initial posts for the selected category
        s.emit('get_initial_posts', { category: selectedCategory });
      });

      s.on('disconnect', () => setIsConnected(false));

      s.on('users_online', (users) => setOnlineUsers(users || []));

      // wire up the same listeners setupSocketListeners used to register
      s.on('initial_posts', (items) => setPosts(items || []));
      // When server confirms a created post, replace any optimistic post that has the same clientTempId
      s.on('post_created', (serverPost) => {
        try {
          if (serverPost && serverPost.clientTempId) {
            setPosts(prev => {
              let replaced = false;
              const next = prev.map(p => {
                if (p && p.clientTempId && p.clientTempId === serverPost.clientTempId) {
                  replaced = true;
                  return serverPost;
                }
                return p;
              });
              if (!replaced) return [serverPost, ...prev];
              return next;
            });
          } else {
            setPosts(prev => [serverPost, ...prev]);
          }
        } catch (e) {
          console.warn('post_created handler failed', e);
          setPosts(prev => [serverPost, ...prev]);
        }
      });
      // post_updated may now send the full post object; accept both shapes
      s.on('post_updated', (payload) => {
        // payload could be { postId, updates } or the full post document
        if (!payload) return;
        if (payload.id) {
          const fullPost = payload;
          setPosts(prev => prev.map(p => String(p.id) === String(fullPost.id) ? fullPost : p));
        } else if (payload.postId) {
          const { postId, updates } = payload;
          setPosts(prev => prev.map(post => String(post.id) === String(postId) ? { ...post, ...(updates || {}) } : post));
        }
      });
      s.on('post_deleted', ({ postId }) => setPosts(prev => prev.filter(post => post.id !== postId)));

      s.on('reply_added', ({ postId, reply }) => setPosts(prev => prev.map(post => {
        // Normalize id comparison (server may send string ObjectId)
        if (String(post.id) !== String(postId)) return post;
        const replies = Array.isArray(post.replies) ? [...post.replies] : [];
        // If reply already exists (optimistic or duplicate), replace it
        let replaced = false;
        for (let i = 0; i < replies.length; i++) {
          if (String(replies[i].id) === String(reply.id)) {
            replies[i] = { ...replies[i], ...reply };
            replaced = true;
            break;
          }
          // check children
          const children = replies[i].children || [];
          for (let j = 0; j < children.length; j++) {
            if (String(children[j].id) === String(reply.id)) {
              replies[i].children = [...children.slice(0, j), { ...children[j], ...reply }, ...children.slice(j + 1)];
              replaced = true;
              break;
            }
          }
          if (replaced) break;
        }

        if (replaced) {
          return { ...post, replies };
        }

        // Otherwise, attach reply in correct place
        if (reply && reply.parentId) {
          let attached = false;
          const newReplies = replies.map(r => {
            if (String(r.id) === String(reply.parentId)) {
              attached = true;
              return { ...r, children: [...(r.children || []), reply] };
            }
            return r;
          });
          if (attached) return { ...post, replies: newReplies };
          // parent not found -> treat as top-level
          return { ...post, replies: [...replies, reply] };
        }
        return { ...post, replies: [...replies, reply] };
      })));

      s.on('reply_updated', ({ postId, replyId, updates }) => setPosts(prev => prev.map(post => {
        if (String(post.id) !== String(postId)) return post;
        return {
          ...post,
          replies: (post.replies || []).map(r => {
            if (String(r.id) === String(replyId)) return { ...r, ...updates };
            // update nested children
            return { ...r, children: (r.children || []).map(c => String(c.id) === String(replyId) ? { ...c, ...updates } : c) };
          })
        };
      })));

      s.on('vote_updated', ({ postId, replyId, upvotes }) => setPosts(prev => prev.map(post => {
        if (String(post.id) !== String(postId)) return post;
        // replyId present -> update either top-level reply or nested child
        if (replyId) {
          return {
            ...post,
            replies: (post.replies || []).map(r => {
              if (String(r.id) === String(replyId)) return { ...r, upvotes };
              // update nested children
              const children = (r.children || []).map(c => String(c.id) === String(replyId) ? { ...c, upvotes } : c);
              return { ...r, children };
            })
          };
        }
        // no replyId => update post upvotes
        return { ...post, upvotes };
      })));

      s.on('user_typing', ({ userId, userName, postId }) => {
        // add typing user for specific post, avoid duplicates
        setTypingUsers(prev => {
          const list = prev[postId] || [];
          if (list.find(u => u.userId === userId)) return prev;
          return { ...prev, [postId]: [...list, { userId, userName }] };
        });
      });
      s.on('user_stopped_typing', ({ userId, postId }) => {
        setTypingUsers(prev => ({ ...prev, [postId]: (prev[postId] || []).filter(u => u.userId !== userId) }));
      });

      s.on('post_pinned', ({ postId, isPinned }) => {
        setPosts(prev => prev.map(post => post.id === postId ? { ...post, isPinned } : post));
      });

      s.on('reply_verified', ({ postId, replyId, isVerified }) => {
        setPosts(prev => prev.map(post => {
          if (String(post.id) !== String(postId)) return post;
          return { ...post, replies: (post.replies || []).map(r => String(r.id) === String(replyId) ? { ...r, isVerified } : r) };
        }));
      });
    }
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      try { if (socketRef.current) socketRef.current.disconnect(); } catch(e) {}
      socketRef.current = null;
    };
  }, []);

  // re-request posts when category changes
  useEffect(() => {
    try { socketRef.current && socketRef.current.emit('get_initial_posts', { category: selectedCategory }); } catch (e) {}
  }, [selectedCategory]);

  // Load initial data
  const loadInitialData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load categories (in production, fetch from API)
      // setCategories(categoriesRes.data);
      // setPosts(postsRes.data);

      // Mock initial posts for demo
      const mockPosts = [
        {
          id: 1,
          title: 'Managing Test Anxiety',
          content: 'I get really nervous before exams. Any tips?',
          author: { id: 2, name: 'Anonymous', role: 'student' },
          category: 'Anxiety',
          anonymous: true,
          createdAt: new Date(Date.now() - 3600000),
          upvotes: 8,
          isPinned: true,
          replies: [
            {
              id: 1,
              content: 'Deep breathing exercises work well for me!',
              author: { id: 3, name: 'Sarah M.', role: 'student' },
              createdAt: new Date(Date.now() - 3000000),
              upvotes: 5,
              isVerified: false
            },
            {
              id: 2,
              content: 'Try progressive muscle relaxation. Start by tensing and releasing each muscle group.',
              author: { id: 4, name: 'Dr. Smith', role: 'counselor' },
              createdAt: new Date(Date.now() - 2400000),
              upvotes: 12,
              isVerified: true
            }
          ]
        },
        {
          id: 2,
          title: 'Study Group Formation',
          content: 'Looking for people to form a study group for upcoming finals.',
          author: { id: 5, name: 'Mike Johnson', role: 'student' },
          category: 'Study Tips',
          anonymous: false,
          createdAt: new Date(Date.now() - 7200000),
          upvotes: 3,
          isPinned: false,
          replies: []
        }
      ];
      setPosts(mockPosts);
    } catch (err) {
      setError(utils.formatError(err));
    } finally {
        setLoading(false);
        try { window.dispatchEvent(new CustomEvent('mindsphere:pageReady')); } catch(e) {}
    }
  };

  // Note: inline listeners are registered in the initialization `useEffect` using socketRef.current.
  // The previous helper referenced an undefined `socketConnection` and could throw a ReferenceError.
  // If a reusable listener setup is needed later, re-implement using `socketRef.current` and guards.

  // Handle creating new post
  const handleCreatePost = async (e) => {
    e.preventDefault();
    
    // Validate form
    const titleErrors = utils.validatePost(newPost.title, newPost.content);
    if (titleErrors.length > 0) {
      setFormErrors(titleErrors);
      return;
    }

    // Check for crisis content
    const hasCrisisContent = utils.detectCrisisContent(newPost.content);
    if (hasCrisisContent) {
      alert('Your post contains content that suggests you may be in crisis. Please reach out to the crisis resources in the sidebar or contact emergency services if you need immediate help.');
    }

    try {
      setLoading(true);
      setFormErrors([]);

      const postData = {
        title: newPost.title.trim(),
        content: utils.sanitizeContent(newPost.content.trim()),
        category: newPost.category,
        anonymous: newPost.anonymous
      };

      // In production, call API
      // const createdPost = response.data;

      // Mock post creation for demo (optimistic with clientTempId)
      const tempId = `tmp-${Date.now()}`;
      const post = {
        id: tempId,
        clientTempId: tempId,
        ...postData,
        author: newPost.anonymous 
          ? { id: user.id, name: 'Anonymous', role: user.role, email: user.email }
          : { id: user.id, name: user.name, role: user.role, email: user.email },
        createdAt: new Date(),
        upvotes: 0,
        isPinned: false,
        replies: []
      };

      // Insert optimistic post locally. Server will echo canonical post_created including clientTempId
      setPosts(prev => [post, ...prev]);
      setNewPost({ title: '', content: '', category: 'General', anonymous: false });
      setShowCreatePost(false);

    // Emit to WebSocket for real-time updates (include author email)
    try { socketRef.current && socketRef.current.emit('create_post', post); } catch (e) { console.warn('emit create_post failed', e); }
    } catch (err) {
      setError(utils.formatError(err));
    } finally {
      setLoading(false);
    }
  };

  // Handle upvoting
  const handleUpvote = async (postId, replyId = null) => {
    try {
      // Optimistically update UI
      setPosts(prev => prev.map(post => {
        if (post.id === postId) {
          if (replyId) {
            return {
              ...post,
              replies: (post.replies || []).map(reply => {
                if (reply.id === replyId) return { ...reply, upvotes: (reply.upvotes || 0) + 1 };
                // update nested children if present
                return { ...reply, children: (reply.children || []).map(c => c.id === replyId ? { ...c, upvotes: (c.upvotes || 0) + 1 } : c) };
              })
            };
          } else {
            return { ...post, upvotes: (post.upvotes || 0) + 1 };
          }
        }
        return post;
      }));

      // In production, call API
      try {
        if (socketRef.current) socketRef.current.emit('upvote', { postId, replyId });
      } catch (e) { console.warn('emit upvote failed', e); }
    } catch (err) {
      // Revert optimistic update on error
      setPosts(prev => prev.map(post => {
        if (post.id === postId) {
          if (replyId) {
            return {
              ...post,
              replies: (post.replies || []).map(reply => {
                if (reply.id === replyId) return { ...reply, upvotes: (reply.upvotes || 1) - 1 };
                return { ...reply, children: (reply.children || []).map(c => c.id === replyId ? { ...c, upvotes: (c.upvotes || 1) - 1 } : c) };
              })
            };
          } else {
            return { ...post, upvotes: (post.upvotes || 1) - 1 };
          }
        }
        return post;
      }));
      setError(utils.formatError(err));
    }
  };

  // Handle adding reply
  const handleAddReply = async (postId) => {
    // Validate reply
    const errors = utils.validateReply(replyContent);
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }

    // Check for crisis content
    const hasCrisisContent = utils.detectCrisisContent(replyContent);
    if (hasCrisisContent) {
      alert('Your reply contains content that suggests you may be in crisis. Please reach out to the crisis resources in the sidebar or contact emergency services if you need immediate help.');
    }

    try {
      setFormErrors([]);
      
      const replyData = {
        content: utils.sanitizeContent(replyContent.trim()),
        parentId: activeReplyTo || null,
        author: { id: user.id, name: user.name, role: user.role, email: user.email }
      };

      // Emit new reply for real-time updates and persistence. Wait for server to broadcast `reply_added`.
      try { socketRef.current && socketRef.current.emit('add_reply', { postId, reply: replyData }); } catch (e) { console.warn('emit add_reply failed', e); }

      // Clear composer immediately for a snappy UX; server will provide the canonical reply via reply_added.
      setReplyContent('');
      setActiveReplyTo(null);
      setReplyTargetPostId(null);

      // Stop typing indicator
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      try { socketRef.current && socketRef.current.emit('typing_stop', { postId }); } catch (e) {}
    } catch (err) {
      setError(utils.formatError(err));
    }
  };

  // Handle typing in reply box
  const handleReplyTyping = (postId, content) => {
    setReplyContent(content);
    
  // Start typing indicator
  try { socketRef.current && socketRef.current.emit('typing_start', { postId }); } catch (e) {}
    
    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    // Stop typing after 3 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      try { socketRef.current && socketRef.current.emit('typing_stop', { postId }); } catch (e) {}
    }, 3000);
  };

  // Handle pinning (counselor/admin only)
  const handlePin = async (postId) => {
    if (!utils.canModerate(user.role)) return;

    try {
      // Optimistically update UI
      setPosts(prev => prev.map(post => 
        post.id === postId 
          ? { ...post, isPinned: !post.isPinned }
          : post
      ));

      // In production, call API
      
  try { socketRef.current && socketRef.current.emit('pin_post', { postId }); } catch (e) { console.warn('emit pin_post failed', e); }
    } catch (err) {
      // Revert optimistic update on error
      setPosts(prev => prev.map(post => 
        post.id === postId 
          ? { ...post, isPinned: !post.isPinned }
          : post
      ));
      setError(utils.formatError(err));
    }
  };

  // Handle verifying reply (counselor/admin only)
  const handleVerifyReply = async (postId, replyId) => {
    if (!utils.canModerate(user.role)) return;

    try {
      // Optimistically update UI
      setPosts(prev => prev.map(post => {
        if (post.id === postId) {
          return {
            ...post,
            replies: post.replies.map(reply => 
              reply.id === replyId 
                ? { ...reply, isVerified: !reply.isVerified }
                : reply
            )
          };
        }
        return post;
      }));

      // In production, call API
      
  try { socketRef.current && socketRef.current.emit('verify_reply', { postId, replyId }); } catch (e) { console.warn('emit verify_reply failed', e); }
    } catch (err) {
      // Revert optimistic update on error
      setPosts(prev => prev.map(post => {
        if (post.id === postId) {
          return {
            ...post,
            replies: post.replies.map(reply => 
              reply.id === replyId 
                ? { ...reply, isVerified: !reply.isVerified }
                : reply
            )
          };
        }
        return post;
      }));
      setError(utils.formatError(err));
    }
  };

  // Handle reporting
  const handleReport = (target) => {
    setReportTarget(target);
    setShowReportModal(true);
  };

  // Handle submitting report
  const handleSubmitReport = async (reportData) => {
    try {
      const fullReportData = {
        ...reportData,
        target: reportTarget,
        reportedBy: user.id,
        createdAt: new Date()
      };

      // In production, call API
      
  try { socketRef.current && socketRef.current.emit('report_content', fullReportData); } catch (e) { console.warn('emit report_content failed', e); }
      
      setShowReportModal(false);
      setReportTarget(null);
      alert('Report submitted successfully. Our moderators will review it shortly.');
    } catch (err) {
      setError(utils.formatError(err));
    }
  };

  // Filter posts by category
  const filteredPosts = posts.filter(post => 
    selectedCategory === 'All' || post.category === selectedCategory
  );

  // Sort posts (pinned first, then by date)
  const sortedPosts = filteredPosts.sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  // Utility functions
  const getRoleBadge = (role) => {
    const config = utils.getRoleBadgeConfig(role);
    return config ? <span className={config.className}>{config.text}</span> : null;
  };

  // Component for displaying typing indicators
  const TypingIndicator = ({ postId }) => {
    const users = typingUsers[postId] || [];
    if (users.length === 0) return null;

    const names = users.map(u => u.userName).join(', ');
    return (
      <div className="text-xs text-gray-500 italic animate-pulse mb-2">
        {names} {users.length === 1 ? 'is' : 'are'} typing...
      </div>
    );
  };

  // Component for crisis content warning
  const CrisisWarning = ({ content }) => {
    if (!utils.detectCrisisContent(content)) return null;

    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <span className="text-red-400 text-lg">⚠️</span>
          </div>
          <div className="ml-3">
            <p className="text-sm text-red-800">
              This content may indicate someone is in crisis. If you're experiencing thoughts of self-harm, 
              please reach out to the crisis resources in the sidebar or contact emergency services.
            </p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header Section with Guidelines */}
        <div className="mb-8">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 p-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center space-x-4 mb-3">
                  <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                    <span className="text-white text-2xl">💬</span>
                  </div>
                  <div>
                    <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                      Peer Support
                    </h1>
                    <p className="mt-1 text-calm-blue text-lg">
                      A safe space to connect and share with peers
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Guidelines Card */}
              <div className="mt-4 sm:mt-0 p-6 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl max-w-sm border border-blue-100 shadow-lg">
                <div className="flex items-center space-x-2 mb-3">
                  <span className="text-blue-600 text-lg">📋</span>
                  <h3 className="text-sm font-semibold text-deep-blue">
                    Community Guidelines
                  </h3>
                </div>
                <ul className="text-xs text-calm-blue space-y-2">
                  <li className="flex items-center space-x-2">
                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full"></span>
                    <span>Be respectful and supportive</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full"></span>
                    <span>Maintain privacy and confidentiality</span>
                  </li>
                  <li className="flex items-center space-x-2">
                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full"></span>
                    <span>Focus on positive interactions</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Filters and New Post */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div className="flex flex-wrap gap-3">
            {['Recent', 'Popular', 'My Posts'].map(filter => (
              <button
                key={filter}
                className="px-6 py-3 text-sm font-medium text-calm-blue bg-white/80 backdrop-blur-sm rounded-full hover:bg-blue-50 hover:shadow-md transition-all duration-200 border border-white/40 hover:border-blue-200"
              >
                {filter}
              </button>
            ))}
          </div>
          
          <button 
            onClick={() => setShowCreatePost(true)}
            className="px-8 py-3 bg-gradient-to-r from-warm-orange to-orange-500 text-white rounded-full hover:from-warm-orange/90 hover:to-orange-600 transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
          >
            <span className="text-lg">✍️</span>
            <span className="text-sm font-medium">New Post</span>
          </button>
        </div>

        {/* Posts Grid */}
        <div className="grid gap-8">
          {posts.map((post, index) => (
            <div 
              key={post.id || index}
              className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-8 hover:shadow-xl hover:bg-white/90 transition-all duration-300 transform hover:-translate-y-1"
            >
              {/* Post Header */}
              <div className="flex items-start justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center shadow-md">
                    <span className="text-calm-blue font-bold text-lg">
                      {(post.author?.name || 'Anonymous').charAt(0)}
                    </span>
                  </div>
                  <div>
                    <h3 className="font-semibold text-deep-blue text-lg">{post.author?.name || 'Anonymous'}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <p className="text-sm text-calm-blue">{utils.formatTimeAgo(post.createdAt)}</p>
                      <span className="w-1 h-1 bg-calm-blue rounded-full"></span>
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">
                        {post.category}
                      </span>
                    </div>
                  </div>
                </div>
                
                <button className="text-gray-400 hover:text-calm-blue transition-colors duration-200 p-2 hover:bg-gray-50 rounded-lg">
                  <span className="text-lg">⋯</span>
                </button>
              </div>

              {/* Post Content */}
              <div className="text-deep-blue leading-relaxed mb-6 text-lg">
                <h2 className="font-semibold text-xl mb-3 text-gray-900">{post.title}</h2>
                <p className="text-gray-700">{post.content}</p>
              </div>

              {/* Post Footer */}
              <div className="pt-6 border-t border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <button onClick={() => { setReplyTargetPostId(post.id); setActiveReplyTo(null); }} className="flex items-center gap-2 text-sm font-medium text-calm-blue hover:text-blue-700 transition-colors duration-200 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-full">
                      <span className="text-lg">💭</span>
                      <span>Reply</span>
                    </button>
                    <button onClick={() => handleUpvote(post.id)} className="flex items-center gap-2 text-sm font-medium text-calm-blue hover:text-green-700 transition-colors duration-200 bg-green-50 hover:bg-green-100 px-4 py-2 rounded-full">
                      <span className="text-lg">👍</span>
                      <span>Helpful</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-3 text-sm text-calm-blue">
                    <span className="flex items-center gap-1">
                      <span className="text-lg">💬</span>
                      <span>{post.replies?.length || 0} replies</span>
                    </span>
                    <span className="w-1 h-1 bg-calm-blue rounded-full"></span>
                    <span className="flex items-center gap-1">
                      <span className="text-lg">👍</span>
                      <span>{post.upvotes || 0} found helpful</span>
                    </span>
                  </div>
                </div>

                {/* Replies list */}
                <div className="space-y-4">
                  {(post.replies || []).map(reply => (
                    <div key={reply.id} className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-md bg-blue-50 flex items-center justify-center text-sm font-semibold">{(reply.author?.name || 'A').charAt(0)}</div>
                            <div>
                              <div className="text-sm font-medium text-gray-800">{reply.author?.name || 'Anonymous'}</div>
                              <div className="text-xs text-gray-500">{utils.formatTimeAgo(reply.createdAt)}</div>
                            </div>
                          </div>
                          <div className="mt-3 text-gray-700">{reply.content}</div>
                        </div>
                        <div className="text-sm text-gray-500 flex flex-col items-end gap-2">
                          <button onClick={() => handleUpvote(post.id, reply.id)} className="px-3 py-1 rounded-full bg-white border text-sm">👍 {reply.upvotes || 0}</button>
                          {utils.canModerate(user.role) && (
                            <button onClick={() => handleVerifyReply(post.id, reply.id)} className={`px-3 py-1 rounded-full text-sm ${reply.isVerified ? 'bg-green-100 text-green-700' : 'bg-white border'}`}>{reply.isVerified ? 'Verified' : 'Verify'}</button>
                          )}
                          <button onClick={() => { setActiveReplyTo(reply.id); setReplyTargetPostId(post.id); }} className="text-xs text-calm-blue">Reply</button>
                        </div>
                      </div>

                      {/* Nested children */}
                      {(reply.children || []).length > 0 && (
                        <div className="mt-3 ml-10 space-y-3">
                          {reply.children.map(child => (
                            <div key={child.id} className="bg-white rounded-lg p-3 border border-gray-100">
                              <div className="flex items-center justify-between">
                                <div className="text-sm text-gray-800">{child.author?.name || 'Anonymous'}</div>
                                <div className="text-xs text-gray-500">{utils.formatTimeAgo(child.createdAt)}</div>
                              </div>
                              <div className="mt-2 text-gray-700">{child.content}</div>
                              <div className="mt-2 flex items-center gap-3">
                                <button onClick={() => handleUpvote(post.id, child.id)} className="text-sm">👍 {child.upvotes || 0}</button>
                                {utils.canModerate(user.role) && <button onClick={() => handleVerifyReply(post.id, child.id)} className="text-sm">{child.isVerified ? 'Verified' : 'Verify'}</button>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Reply composer (visible when this post is targeted) */}
                {replyTargetPostId === post.id && (
                  <div className="mt-4">
                    <textarea value={replyContent} onChange={(e) => setReplyContent(e.target.value)} placeholder={activeReplyTo ? 'Replying to a comment...' : 'Write a reply...'} className="w-full p-3 border border-gray-200 rounded-xl mb-3" rows={3} />
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-500">Replying as {user.name}{user.email ? ` (${user.email})` : ''}</div>
                      <div className="flex items-center gap-3">
                        <button onClick={() => { setReplyContent(''); setReplyTargetPostId(null); setActiveReplyTo(null); }} className="px-4 py-2">Cancel</button>
                        <button onClick={() => handleAddReply(post.id)} className="px-4 py-2 bg-blue-600 text-white rounded-xl">Reply</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex justify-center items-center py-16">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-8">
              <LogoLoader active={true} minDuration={2000} size={64} text={"Loading discussions..."} />
            </div>
          </div>
        )}

        {/* Empty State */}
        {!loading && posts.length === 0 && (
          <div className="text-center py-16">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/20 p-12">
              <div className="text-8xl mb-6">💭</div>
              <h3 className="text-2xl font-semibold text-deep-blue mb-3">
                No discussions yet
              </h3>
              <p className="text-calm-blue text-lg mb-6">
                Start a conversation to connect with peers
              </p>
              <button 
                onClick={() => setShowCreatePost(true)}
                className="px-8 py-3 bg-gradient-to-r from-warm-orange to-orange-500 text-white rounded-full hover:from-warm-orange/90 hover:to-orange-600 transition-all duration-200 flex items-center gap-2 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 mx-auto"
              >
                <span className="text-lg">✍️</span>
                <span className="font-medium">Create First Post</span>
              </button>
            </div>
          </div>
        )}

        {/* Create Post Modal */}
        {showCreatePost && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-white/20 p-8 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex items-center space-x-3 mb-6">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <span className="text-blue-600 text-lg">✍️</span>
                </div>
                <h3 className="text-xl font-bold text-gray-900">Create New Post</h3>
              </div>
              
              {formErrors.length > 0 && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
                  <ul className="text-sm text-red-600">
                    {formErrors.map((error, index) => (
                      <li key={index} className="flex items-center space-x-2">
                        <span>⚠️</span>
                        <span>{error}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              
              <CrisisWarning content={newPost.content} />
              
              <form onSubmit={handleCreatePost}>
                <div className="mb-6">
                  <label className="block text-sm font-semibold text-gray-700 mb-3">
                    Title
                  </label>
                  <input
                    type="text"
                    value={newPost.title}
                    onChange={(e) => setNewPost({...newPost, title: e.target.value})}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 focus:bg-white transition-colors"
                    placeholder="What's on your mind?"
                    required
                  />
                </div>
                
                <div className="mb-6">
                  <label className="block text-sm font-semibold text-gray-700 mb-3">
                    Content
                  </label>
                  <textarea
                    value={newPost.content}
                    onChange={(e) => setNewPost({...newPost, content: e.target.value})}
                    rows={6}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 focus:bg-white transition-colors"
                    placeholder="Share your thoughts or ask for support..."
                    required
                  />
                </div>
                
                <div className="mb-6">
                  <label className="block text-sm font-semibold text-gray-700 mb-3">
                    Category
                  </label>
                  <select
                    value={newPost.category}
                    onChange={(e) => setNewPost({...newPost, category: e.target.value})}
                    className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 focus:bg-white transition-colors"
                  >
                    {categories.map(category => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </div>
                
                <div className="mb-8">
                  <label className="flex items-center p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors cursor-pointer">
                    <input
                      type="checkbox"
                      checked={newPost.anonymous}
                      onChange={(e) => setNewPost({...newPost, anonymous: e.target.checked})}
                      className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50 mr-3"
                    />
                    <span className="text-sm font-medium text-gray-700">Post anonymously</span>
                  </label>
                </div>
                
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowCreatePost(false)}
                    className="px-6 py-3 text-gray-600 hover:text-gray-800 transition-colors font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium shadow-lg hover:shadow-xl"
                  >
                    {loading ? 'Posting...' : 'Create Post'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PeerToPeer;
