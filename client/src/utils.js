// Lightweight utilities used by the demo Peer-to-Peer page
// Implemented to match the functions expected by Peer-to-Peer.jsx

export function getCrisisAlertProps() {
  return {
    title: 'Immediate Help Available',
    resources: [
      { name: 'National Suicide Prevention Lifeline', contact: '988', description: '24/7 confidential support in the US' },
      { name: 'Emergency Services', contact: '112', description: 'Call if you or someone is in immediate danger' }
    ]
  };
}

export function formatError(err) {
  try {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    if (err.message) return err.message;
    return JSON.stringify(err);
  } catch (e) {
    return String(err);
  }
}

export function validatePost(title = '', content = '') {
  const errors = [];
  if (!title || title.trim().length < 3) errors.push('Title must be at least 3 characters');
  if (!content || content.trim().length < 10) errors.push('Content must be at least 10 characters');
  return errors;
}

export function validateReply(content = '') {
  const errors = [];
  if (!content || content.trim().length < 2) errors.push('Reply must be at least 2 characters');
  return errors;
}

export function detectCrisisContent(text = '') {
  if (!text) return false;
  const lowered = text.toLowerCase();
  const crisisKeywords = ['suicide', 'kill myself', 'end my life', 'harm myself', 'i can\'t go on', 'want to die'];
  return crisisKeywords.some(k => lowered.includes(k));
}

export function sanitizeContent(text = '') {
  // very small sanitizer for demo — remove script tags
  return text.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '').trim();
}

export function canModerate(role = '') {
  return ['counselor', 'counsellor', 'admin', 'moderator'].includes((role || '').toLowerCase());
}

export function getRoleBadgeConfig(role = '') {
  const r = (role || '').toLowerCase();
  if (r === 'counselor' || r === 'counsellor') return { text: 'Counsellor', className: 'px-2 py-1 rounded-full text-xs bg-indigo-100 text-indigo-700' };
  if (r === 'admin') return { text: 'Admin', className: 'px-2 py-1 rounded-full text-xs bg-red-100 text-red-700' };
  return { text: 'Student', className: 'px-2 py-1 rounded-full text-xs bg-green-100 text-green-700' };
}

export function formatTimeAgo(date) {
  try {
    const d = new Date(date);
    const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch (e) {
    return '';
  }
}

export default {
  getCrisisAlertProps,
  formatError,
  validatePost,
  validateReply,
  detectCrisisContent,
  sanitizeContent,
  canModerate,
  getRoleBadgeConfig,
  formatTimeAgo
};
