import axios from 'axios';

const URL = import.meta.env.VITE_SOCKET_API_BASE;

// Create axios instance with base configuration
// Resolve API base URL from Vite env or sensible defaults depending on environment
const resolveApiBase = () => {
  // Prefer explicit VITE_API_BASE
  if (import.meta.env.VITE_API_BASE) return import.meta.env.VITE_API_BASE;

  // If running in browser, prefer same origin /api (works in production when proxied)
  if (typeof window !== 'undefined') {
    // If we're on localhost in development, default to local server
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return `${URL}/api`;
    }
    return '/api';
  }

  // Fallback
  return `${URL}/api`;
};

const api = axios.create({
  baseURL: resolveApiBase(),
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('authToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Handle unauthorized access
      localStorage.removeItem('authToken');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Forum API endpoints
export const forumApi = {
  // Posts
  getPosts: (category = null, page = 1, limit = 10) => 
    api.get('/posts', { params: { category, page, limit } }),
  
  createPost: (postData) => 
    api.post('/posts', postData),
  
  updatePost: (postId, updates) => 
    api.put(`/posts/${postId}`, updates),
  
  deletePost: (postId) => 
    api.delete(`/posts/${postId}`),
  
  pinPost: (postId) => 
    api.patch(`/posts/${postId}/pin`),
  
  upvotePost: (postId) => 
    api.post(`/posts/${postId}/upvote`),

  // Replies
  getReplies: (postId) => 
    api.get(`/posts/${postId}/replies`),
  
  createReply: (postId, replyData) => 
    api.post(`/posts/${postId}/replies`, replyData),
  
  updateReply: (postId, replyId, updates) => 
    api.put(`/posts/${postId}/replies/${replyId}`, updates),
  
  deleteReply: (postId, replyId) => 
    api.delete(`/posts/${postId}/replies/${replyId}`),
  
  upvoteReply: (postId, replyId) => 
    api.post(`/posts/${postId}/replies/${replyId}/upvote`),
  
  verifyReply: (postId, replyId) => 
    api.patch(`/posts/${postId}/replies/${replyId}/verify`),

  // Categories
  getCategories: () => 
    api.get('/categories'),
  
  createCategory: (categoryData) => 
    api.post('/categories', categoryData),
  
  updateCategory: (categoryId, updates) => 
    api.put(`/categories/${categoryId}`, updates),
  
  deleteCategory: (categoryId) => 
    api.delete(`/categories/${categoryId}`),

  // Reports
  reportContent: (reportData) => 
    api.post('/reports', reportData),
  
  getReports: (status = null) => 
    api.get('/reports', { params: { status } }),
  
  updateReport: (reportId, updates) => 
    api.put(`/reports/${reportId}`, updates),

  // Users
  getOnlineUsers: () => 
    api.get('/users/online'),
  
  getUserProfile: (userId) => 
    api.get(`/users/${userId}`),
  
  updateUserRole: (userId, role) => 
    api.patch(`/users/${userId}/role`, { role }),
  
  banUser: (userId, reason) => 
    api.post(`/users/${userId}/ban`, { reason }),

  // Analytics (Admin only)
  getAnalytics: (period = '7d') => 
    api.get('/analytics', { params: { period } }),
  
  getPostsAnalytics: () => 
    api.get('/analytics/posts'),
  
  getUsersAnalytics: () => 
    api.get('/analytics/users'),

  // Crisis resources
  getCrisisResources: () => 
    api.get('/crisis-resources'),
  
  updateCrisisResources: (resources) => 
    api.put('/crisis-resources', resources),
};

// Utility functions for common operations
export const utils = {
  // Format error messages
  formatError: (error) => {
    if (error.response?.data?.message) {
      return error.response.data.message;
    }
    if (error.message) {
      return error.message;
    }
    return 'An unexpected error occurred';
  },

  // Format time ago
  formatTimeAgo: (date) => {
    const now = new Date();
    const diff = now - new Date(date);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    const weeks = Math.floor(diff / 604800000);
    const months = Math.floor(diff / 2629746000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    if (weeks < 4) return `${weeks}w ago`;
    return `${months}mo ago`;
  },

  // Validate post content
  validatePost: (title, content) => {
    const errors = [];
    
    if (!title || title.trim().length < 5) {
      errors.push('Title must be at least 5 characters long');
    }
    if (title && title.length > 200) {
      errors.push('Title must be less than 200 characters');
    }
    if (!content || content.trim().length < 10) {
      errors.push('Content must be at least 10 characters long');
    }
    if (content && content.length > 5000) {
      errors.push('Content must be less than 5000 characters');
    }
    
    return errors;
  },

  // Validate reply content
  validateReply: (content) => {
    const errors = [];
    
    if (!content || content.trim().length < 5) {
      errors.push('Reply must be at least 5 characters long');
    }
    if (content && content.length > 2000) {
      errors.push('Reply must be less than 2000 characters');
    }
    
    return errors;
  },

  // Check if user can moderate
  canModerate: (userRole) => {
    return userRole === 'counselor' || userRole === 'admin';
  },

  // Check if user is admin
  isAdmin: (userRole) => {
    return userRole === 'admin';
  },

  // Sanitize content for display
  sanitizeContent: (content) => {
    // Basic HTML sanitization - in production, use a proper library like DOMPurify
    return content
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;');
  },

  // Get user role badge configuration
  getRoleBadgeConfig: (role) => {
    const configs = {
      student: null,
      counselor: {
        text: 'Counselor',
        className: 'px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full'
      },
      admin: {
        text: 'Admin',
        className: 'px-2 py-1 text-xs bg-purple-100 text-purple-800 rounded-full'
      }
    };
    return configs[role] || null;
  },

  // Generate user avatar URL
  generateAvatarUrl: (userId, name) => {
    // Use a service like Gravatar or generate initials-based avatar
    const initials = name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
    
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff&size=40&rounded=true`;
  },

  // Check if content might be in crisis
  detectCrisisContent: (content) => {
    const crisisKeywords = [
      'suicide', 'kill myself', 'end it all', 'can\'t go on',
      'want to die', 'hurt myself', 'self harm', 'cutting',
      'overdose', 'jump off', 'hanging', 'crisis'
    ];
    
    const lowerContent = content.toLowerCase();
    return crisisKeywords.some(keyword => lowerContent.includes(keyword));
  },

  // Get crisis alert component props
  getCrisisAlertProps: () => ({
    title: '🆘 Crisis Resources',
    resources: [
      {
        name: 'Crisis Text Line',
        contact: 'Text HOME to 741741',
        description: '24/7 crisis support via text'
      },
      {
        name: 'National Suicide Prevention Lifeline',
        contact: '988',
        description: '24/7 suicide prevention hotline'
      },
      {
        name: 'Campus Counseling Center',
        contact: '(555) 123-4567',
        description: 'On-campus mental health support'
      },
      {
        name: 'Emergency Services',
        contact: '911',
        description: 'For immediate life-threatening emergencies'
      }
    ]
  })
};

export default api;