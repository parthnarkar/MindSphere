import React from 'react';
import { Navigate } from 'react-router-dom';

function getFallbackRole() {
  try {
    if (typeof window === 'undefined') return null;
    return sessionStorage.getItem('authRole') || null;
  } catch (_) {
    return null;
  }
}

export function PrivateRoute({ user, children }) {
  // Check if user exists AND has completed signup
  return user && user.signedUp ? children : <Navigate to="/" />;
}

export function CounsellorRoute({ user, children }) {
  return user && user.signedUp && user.role === 'counsellor' ? children : <Navigate to="/" />;
}

export function AdminRoute({ user, children }) {
  // Allow an optimistic admin session when no Firebase user is present by
  // checking sessionStorage.authRole === 'admin'. This supports the admin
  // login flow which authenticates against MongoDB and stores a short-lived
  // role in sessionStorage without creating a Firebase user.
  const fallback = getFallbackRole();
  const isAdminFallback = !user && fallback === 'admin';
  if (isAdminFallback) return children;

  return user && user.signedUp && user.role === 'admin' ? children : <Navigate to="/" />;
}