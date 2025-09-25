import React, { useState, useEffect, useRef } from 'react';
import useSocket from '../hooks/useSocket';
import { forumApi, utils } from '../hooks/forumApi';

// Mock user data - in real app, this would come from authentication
const mockUser = {
  id: 1,
  name: 'John Doe',
  email: 'john@example.com',
  role: 'student', // student, counselor, admin
  avatar: 'https://via.placeholder.com/40'
};

// Crisis Resources Sidebar Component
const CrisisResourcesSidebar = () => {
  const crisisAlert = utils.getCrisisAlertProps();
  
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
      <h3 className="font-semibold text-red-800 mb-3 flex items-center">
        {crisisAlert.title}
      </h3>
      <div className="space-y-3 text-sm">
        {crisisAlert.resources.map((resource, index) => (
          <div key={index} className="p-2 bg-white border border-red-100 rounded">
            <p className="font-medium text-red-700">{resource.name}</p>
            <p className="text-red-600 font-mono">{resource.contact}</p>
            <p className="text-red-500 text-xs mt-1">{resource.description}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 p-2 bg-yellow-50 border border-yellow-200 rounded">
        <p className="text-xs text-yellow-800">
          <strong>Remember:</strong> If you're having thoughts of self-harm, you're not alone. 
          Reach out for help - these resources are available 24/7.
        </p>
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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-semibold mb-4">Report Content</h3>
        <p className="text-sm text-gray-600 mb-4">
          Help us maintain a safe community by reporting inappropriate content.
        </p>
        
        <form onSubmit={handleSubmit}>
          <div className="space-y-3 mb-6">
            <label className="flex items-center">
              <input 
                type="radio" 
                name="report" 
                value="inappropriate"
                checked={reportReason === 'inappropriate'}
                onChange={(e) => setReportReason(e.target.value)}
                className="mr-2" 
              />
              <span className="text-sm">Inappropriate content</span>
            </label>
            <label className="flex items-center">
              <input 
                type="radio" 
                name="report" 
                value="harassment"
                checked={reportReason === 'harassment'}
                onChange={(e) => setReportReason(e.target.value)}
                className="mr-2" 
              />
              <span className="text-sm">Harassment or bullying</span>
            </label>
            <label className="flex items-center">
              <input 
                type="radio" 
                name="report" 
                value="spam"
                checked={reportReason === 'spam'}
                onChange={(e) => setReportReason(e.target.value)}
                className="mr-2" 
              />
              <span className="text-sm">Spam or irrelevant content</span>
            </label>
            <label className="flex items-center">
              <input 
                type="radio" 
                name="report" 
                value="misinformation"
                checked={reportReason === 'misinformation'}
                onChange={(e) => setReportReason(e.target.value)}
                className="mr-2" 
              />
              <span className="text-sm">False information</span>
            </label>
            <label className="flex items-center">
              <input 
                type="radio" 
                name="report" 
                value="crisis"
                checked={reportReason === 'crisis'}
                onChange={(e) => setReportReason(e.target.value)}
                className="mr-2" 
              />
              <span className="text-sm">Someone may be in crisis</span>
            </label>
          </div>
          
          <textarea
            value={reportDetails}
            onChange={(e) => setReportDetails(e.target.value)}
            placeholder="Additional details (optional)"
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
          />
          
          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!reportReason || isSubmitting}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
  const [formErrors, setFormErrors] = useState([]);

  // WebSocket connection
  const socketConnection = useSocket();
  const { isConnected, onlineUsers } = socketConnection;

  // Typing timeout ref
  const typingTimeoutRef = useRef(null);

  // Initialize data and WebSocket listeners
  useEffect(() => {
    loadInitialData();
    setupSocketListeners();

    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  // Load initial data
  const loadInitialData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Load categories (in production, fetch from API)
      // const categoriesRes = await forumApi.getCategories();
      // setCategories(categoriesRes.data);

      // Load posts (in production, fetch from API)
      // const postsRes = await forumApi.getPosts(selectedCategory);
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
    }
  };

  // Setup WebSocket event listeners
  const setupSocketListeners = () => {
    if (!socketConnection.socket) return;

    // Real-time post updates
    socketConnection.on('post_created', (post) => {
      setPosts(prev => [post, ...prev]);
    });

    socketConnection.on('post_updated', ({ postId, updates }) => {
      setPosts(prev => prev.map(post => 
        post.id === postId ? { ...post, ...updates } : post
      ));
    });

    socketConnection.on('post_deleted', ({ postId }) => {
      setPosts(prev => prev.filter(post => post.id !== postId));
    });

    // Real-time reply updates
    socketConnection.on('reply_added', ({ postId, reply }) => {
      setPosts(prev => prev.map(post => 
        post.id === postId 
          ? { ...post, replies: [...post.replies, reply] }
          : post
      ));
    });

    socketConnection.on('reply_updated', ({ postId, replyId, updates }) => {
      setPosts(prev => prev.map(post => {
        if (post.id === postId) {
          return {
            ...post,
            replies: post.replies.map(reply => 
              reply.id === replyId ? { ...reply, ...updates } : reply
            )
          };
        }
        return post;
      }));
    });

    // Real-time voting updates
    socketConnection.on('vote_updated', ({ postId, replyId, upvotes }) => {
      setPosts(prev => prev.map(post => {
        if (post.id === postId) {
          if (replyId) {
            return {
              ...post,
              replies: post.replies.map(reply => 
                reply.id === replyId ? { ...reply, upvotes } : reply
              )
            };
          } else {
            return { ...post, upvotes };
          }
        }
        return post;
      }));
    });

    // Typing indicators
    socketConnection.on('user_typing', ({ userId, userName, postId }) => {
      setTypingUsers(prev => ({
        ...prev,
        [postId]: [...(prev[postId] || []), { userId, userName }]
      }));
    });

    socketConnection.on('user_stopped_typing', ({ userId, postId }) => {
      setTypingUsers(prev => ({
        ...prev,
        [postId]: (prev[postId] || []).filter(user => user.userId !== userId)
      }));
    });

    // Moderation updates
    socketConnection.on('post_pinned', ({ postId, isPinned }) => {
      setPosts(prev => prev.map(post => 
        post.id === postId ? { ...post, isPinned } : post
      ));
    });

    socketConnection.on('reply_verified', ({ postId, replyId, isVerified }) => {
      setPosts(prev => prev.map(post => {
        if (post.id === postId) {
          return {
            ...post,
            replies: post.replies.map(reply => 
              reply.id === replyId ? { ...reply, isVerified } : reply
            )
          };
        }
        return post;
      }));
    });
  };

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
      // const response = await forumApi.createPost(postData);
      // const createdPost = response.data;

      // Mock post creation for demo
      const post = {
        id: Date.now(),
        ...postData,
        author: newPost.anonymous 
          ? { id: user.id, name: 'Anonymous', role: user.role }
          : { id: user.id, name: user.name, role: user.role },
        createdAt: new Date(),
        upvotes: 0,
        isPinned: false,
        replies: []
      };

      setPosts(prev => [post, ...prev]);
      setNewPost({ title: '', content: '', category: 'General', anonymous: false });
      setShowCreatePost(false);

      // Emit to WebSocket for real-time updates
      socketConnection.createPost(post);
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
              replies: post.replies.map(reply => 
                reply.id === replyId 
                  ? { ...reply, upvotes: reply.upvotes + 1 }
                  : reply
              )
            };
          } else {
            return { ...post, upvotes: post.upvotes + 1 };
          }
        }
        return post;
      }));

      // In production, call API
      if (replyId) {
        // await forumApi.upvoteReply(postId, replyId);
        socketConnection.upvoteReply(postId, replyId);
      } else {
        // await forumApi.upvotePost(postId);
        socketConnection.upvotePost(postId);
      }
    } catch (err) {
      // Revert optimistic update on error
      setPosts(prev => prev.map(post => {
        if (post.id === postId) {
          if (replyId) {
            return {
              ...post,
              replies: post.replies.map(reply => 
                reply.id === replyId 
                  ? { ...reply, upvotes: reply.upvotes - 1 }
                  : reply
              )
            };
          } else {
            return { ...post, upvotes: post.upvotes - 1 };
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
        content: utils.sanitizeContent(replyContent.trim())
      };

      // In production, call API
      // const response = await forumApi.createReply(postId, replyData);
      // const createdReply = response.data;

      // Mock reply creation for demo
      const reply = {
        id: Date.now(),
        ...replyData,
        author: { id: user.id, name: user.name, role: user.role },
        createdAt: new Date(),
        upvotes: 0,
        isVerified: false
      };

      setPosts(prev => prev.map(post => 
        post.id === postId 
          ? { ...post, replies: [...post.replies, reply] }
          : post
      ));

      setReplyContent('');
      setActiveReplyTo(null);

      // Stop typing indicator
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      socketConnection.stopTyping(postId);

      // Emit new reply for real-time updates
      socketConnection.addReply(postId, reply);
    } catch (err) {
      setError(utils.formatError(err));
    }
  };

  // Handle typing in reply box
  const handleReplyTyping = (postId, content) => {
    setReplyContent(content);
    
    // Start typing indicator
    socketConnection.startTyping(postId);
    
    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    // Stop typing after 3 seconds of inactivity
    typingTimeoutRef.current = setTimeout(() => {
      socketConnection.stopTyping(postId);
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
      // await forumApi.pinPost(postId);
      
      socketConnection.pinPost(postId);
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
      // await forumApi.verifyReply(postId, replyId);
      
      socketConnection.verifyReply(postId, replyId);
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
      // await forumApi.reportContent(fullReportData);
      
      socketConnection.reportContent(fullReportData);
      
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
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Peer Support Forum</h1>
              <p className="mt-1 text-sm text-gray-600">
                Connect with peers and get support from verified counselors
              </p>
            </div>
            <div className="mt-4 sm:mt-0 flex items-center space-x-3">
              <div className="flex items-center space-x-4">
                <div className="flex items-center text-sm text-gray-500">
                  <div className={`w-2 h-2 rounded-full mr-2 ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}></div>
                  {isConnected ? `${onlineUsers.length} online` : 'Connecting...'}
                </div>
                {error && (
                  <div className="text-sm text-red-600 bg-red-50 px-2 py-1 rounded">
                    {error}
                  </div>
                )}
              </div>
              {utils.isAdmin(user.role) && (
                <button
                  onClick={() => setShowAdminPanel(!showAdminPanel)}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
                >
                  Admin Panel
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-3">
            {/* Category Filter & Create Post */}
            <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4">
                <div className="flex flex-wrap gap-2 mb-4 sm:mb-0">
                  {['All', ...categories].map(category => (
                    <button
                      key={category}
                      onClick={() => setSelectedCategory(category)}
                      className={`px-3 py-1 rounded-full text-sm transition-colors ${
                        selectedCategory === category
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      {category}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setShowCreatePost(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Create Post
                </button>
              </div>
            </div>

            {/* Create Post Modal */}
            {showCreatePost && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                <div className="bg-white rounded-lg p-6 w-full max-w-md">
                  <h3 className="text-lg font-semibold mb-4">Create New Post</h3>
                  {formErrors.length > 0 && (
                    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                      <ul className="text-sm text-red-600">
                        {formErrors.map((error, index) => (
                          <li key={index}>• {error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <CrisisWarning content={newPost.content} />
                  <form onSubmit={handleCreatePost}>
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Title
                      </label>
                      <input
                        type="text"
                        value={newPost.title}
                        onChange={(e) => setNewPost({...newPost, title: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="What's on your mind?"
                        required
                      />
                    </div>
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Content
                      </label>
                      <textarea
                        value={newPost.content}
                        onChange={(e) => setNewPost({...newPost, content: e.target.value})}
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Share your thoughts or ask for support..."
                        required
                      />
                    </div>
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Category
                      </label>
                      <select
                        value={newPost.category}
                        onChange={(e) => setNewPost({...newPost, category: e.target.value})}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        {categories.map(category => (
                          <option key={category} value={category}>{category}</option>
                        ))}
                      </select>
                    </div>
                    <div className="mb-6">
                      <label className="flex items-center">
                        <input
                          type="checkbox"
                          checked={newPost.anonymous}
                          onChange={(e) => setNewPost({...newPost, anonymous: e.target.checked})}
                          className="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                        />
                        <span className="ml-2 text-sm text-gray-600">Post anonymously</span>
                      </label>
                    </div>
                    <div className="flex justify-end space-x-3">
                      <button
                        type="button"
                        onClick={() => setShowCreatePost(false)}
                        className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={loading}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {loading ? 'Posting...' : 'Post'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {/* Loading State */}
            {loading && (
              <div className="flex justify-center items-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <span className="ml-2 text-gray-600">Loading posts...</span>
              </div>
            )}

            {/* Empty State */}
            {!loading && sortedPosts.length === 0 && (
              <div className="text-center py-12">
                <div className="text-gray-400 text-6xl mb-4">💬</div>
                <h3 className="text-lg font-medium text-gray-900 mb-2">No posts yet</h3>
                <p className="text-gray-600">Be the first to start a conversation!</p>
              </div>
            )}

            {/* Posts List */}
            <div className="space-y-6">
              {sortedPosts.map(post => (
                <div key={post.id} className="bg-white rounded-lg shadow-sm p-6">
                  {/* Post Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-start space-x-3">
                      <img
                        src={post.author.avatar || 'https://via.placeholder.com/40'}
                        alt=""
                        className="w-10 h-10 rounded-full"
                      />
                      <div>
                        <div className="flex items-center space-x-2">
                          <h3 className="font-semibold text-gray-900">{post.author.name}</h3>
                          {getRoleBadge(post.author.role)}
                          {post.isPinned && (
                            <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-full">
                              📌 Pinned
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-2 text-sm text-gray-500">
                          <span>{utils.formatTimeAgo(post.createdAt)}</span>
                          <span>•</span>
                          <span className="px-2 py-1 bg-gray-100 rounded-full text-xs">
                            {post.category}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {utils.canModerate(user.role) && (
                        <button
                          onClick={() => handlePin(post.id)}
                          className={`p-2 rounded-lg transition-colors ${
                            post.isPinned 
                              ? 'text-yellow-600 hover:bg-yellow-50' 
                              : 'text-gray-400 hover:bg-gray-50'
                          }`}
                          title={post.isPinned ? 'Unpin post' : 'Pin post'}
                        >
                          📌
                        </button>
                      )}
                      <button
                        onClick={() => handleReport({ type: 'post', id: post.id })}
                        className="p-2 text-gray-400 hover:bg-gray-50 hover:text-red-500 rounded-lg transition-colors"
                        title="Report content"
                      >
                        🚨
                      </button>
                    </div>
                  </div>

                  {/* Post Content */}
                  <CrisisWarning content={post.content} />
                  <div className="mb-4">
                    <h2 className="text-lg font-semibold text-gray-900 mb-2">{post.title}</h2>
                    <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{post.content}</p>
                  </div>

                  {/* Post Actions */}
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center space-x-4">
                      <button
                        onClick={() => handleUpvote(post.id)}
                        className="flex items-center space-x-1 text-gray-500 hover:text-blue-600 transition-colors"
                      >
                        <span>👍</span>
                        <span>{post.upvotes}</span>
                      </button>
                      <button
                        onClick={() => setActiveReplyTo(activeReplyTo === post.id ? null : post.id)}
                        className="text-gray-500 hover:text-blue-600 transition-colors"
                      >
                        💬 Reply ({post.replies.length})
                      </button>
                    </div>
                  </div>

                  {/* Reply Form */}
                  {activeReplyTo === post.id && (
                    <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                      {formErrors.length > 0 && (
                        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">
                          {formErrors.map((error, index) => (
                            <div key={index}>• {error}</div>
                          ))}
                        </div>
                      )}
                      <CrisisWarning content={replyContent} />
                      <textarea
                        value={replyContent}
                        onChange={(e) => handleReplyTyping(post.id, e.target.value)}
                        placeholder="Share your thoughts or advice..."
                        rows={3}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-3"
                      />
                      <TypingIndicator postId={post.id} />
                      <div className="flex justify-end space-x-2">
                        <button
                          onClick={() => {
                            setActiveReplyTo(null);
                            setReplyContent('');
                            setFormErrors([]);
                          }}
                          className="px-3 py-1 text-gray-600 hover:text-gray-800 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleAddReply(post.id)}
                          disabled={loading}
                          className="px-3 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {loading ? 'Posting...' : 'Reply'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Replies */}
                  {post.replies.length > 0 && (
                    <div className="space-y-4">
                      <h4 className="font-medium text-gray-900">Replies</h4>
                      {post.replies.map(reply => (
                        <div key={reply.id} className="flex space-x-3 pl-4 border-l-2 border-gray-100">
                          <img
                            src={reply.author.avatar || 'https://via.placeholder.com/32'}
                            alt=""
                            className="w-8 h-8 rounded-full"
                          />
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-1">
                              <span className="font-medium text-gray-900">{reply.author.name}</span>
                              {getRoleBadge(reply.author.role)}
                              {reply.isVerified && (
                                <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">
                                  ✅ Verified
                                </span>
                              )}
                              <span className="text-xs text-gray-500">{utils.formatTimeAgo(reply.createdAt)}</span>
                            </div>
                            <CrisisWarning content={reply.content} />
                            <p className="text-gray-700 mb-2 whitespace-pre-wrap">{reply.content}</p>
                            <div className="flex items-center space-x-4">
                              <button
                                onClick={() => handleUpvote(post.id, reply.id)}
                                className="flex items-center space-x-1 text-gray-500 hover:text-blue-600 transition-colors text-sm"
                              >
                                <span>👍</span>
                                <span>{reply.upvotes}</span>
                              </button>
                              {utils.canModerate(user.role) && (
                                <button
                                  onClick={() => handleVerifyReply(post.id, reply.id)}
                                  className={`text-sm transition-colors ${
                                    reply.isVerified 
                                      ? 'text-green-600 hover:text-green-800' 
                                      : 'text-gray-500 hover:text-green-600'
                                  }`}
                                >
                                  {reply.isVerified ? '✅ Verified' : 'Verify'}
                                </button>
                              )}
                              <button
                                onClick={() => handleReport({ type: 'reply', id: reply.id, postId: post.id })}
                                className="text-gray-400 hover:text-red-500 transition-colors text-sm"
                              >
                                Report
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1">
            {/* Crisis Resources */}
            <CrisisResourcesSidebar />

            {/* Online Users */}
            <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
              <h3 className="font-semibold text-gray-900 mb-3">Online Now ({onlineUsers.length})</h3>
              <div className="space-y-2">
                {onlineUsers.map(onlineUser => (
                  <div key={onlineUser.id} className="flex items-center space-x-2">
                    <div className="w-2 h-2 bg-green-400 rounded-full"></div>
                    <span className="text-sm text-gray-700">{onlineUser.name}</span>
                    {getRoleBadge(onlineUser.role)}
                  </div>
                ))}
              </div>
            </div>

            {/* Guidelines */}
            <div className="bg-white rounded-lg shadow-sm p-4">
              <h3 className="font-semibold text-gray-900 mb-3">Community Guidelines</h3>
              <div className="space-y-2 text-sm text-gray-600">
                <p>• Be respectful and supportive</p>
                <p>• No personal attacks or harassment</p>
                <p>• Keep discussions relevant</p>
                <p>• Report inappropriate content</p>
                <p>• Seek professional help for crisis situations</p>
              </div>
            </div>
          </div>
        </div>

        {/* Report Modal */}
        <ReportModal 
          show={showReportModal}
          target={reportTarget}
          onClose={() => {
            setShowReportModal(false);
            setReportTarget(null);
          }}
          onSubmit={handleSubmitReport}
        />

        {/* Admin Panel */}
        {showAdminPanel && user.role === 'admin' && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-4xl max-h-[80vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-lg font-semibold">Admin Dashboard</h3>
                <button
                  onClick={() => setShowAdminPanel(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <h4 className="font-semibold text-blue-900">Total Posts</h4>
                  <p className="text-2xl font-bold text-blue-600">{posts.length}</p>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <h4 className="font-semibold text-green-900">Active Users</h4>
                  <p className="text-2xl font-bold text-green-600">{onlineUsers.length}</p>
                </div>
                <div className="bg-yellow-50 p-4 rounded-lg">
                  <h4 className="font-semibold text-yellow-900">Reports</h4>
                  <p className="text-2xl font-bold text-yellow-600">3</p>
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <h4 className="font-semibold mb-3">Category Management</h4>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {categories.map(category => (
                      <span key={category} className="px-3 py-1 bg-gray-100 rounded-full text-sm">
                        {category}
                      </span>
                    ))}
                  </div>
                  <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm">
                    Add Category
                  </button>
                </div>

                <div>
                  <h4 className="font-semibold mb-3">Recent Reports</h4>
                  <div className="space-y-2">
                    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                      <p className="text-sm font-medium">Inappropriate content reported</p>
                      <p className="text-xs text-gray-600">Post: "Managing Test Anxiety" - 2 hours ago</p>
                      <div className="mt-2 space-x-2">
                        <button className="px-2 py-1 bg-red-600 text-white rounded text-xs">Remove</button>
                        <button className="px-2 py-1 bg-gray-600 text-white rounded text-xs">Dismiss</button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PeerToPeer;