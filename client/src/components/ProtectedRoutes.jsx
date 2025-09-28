import React from 'react';
import { Navigate } from 'react-router-dom';

export function PrivateRoute({ user, children }) {
  // Check if user exists AND has completed signup
  return user && user.signedUp ? children : <Navigate to="/" />;
}

export function CounsellorRoute({ user, children }) {
  return user && user.signedUp && user.role === 'counsellor' ? children : <Navigate to="/" />;
}

export function AdminRoute({ user, children }) {
  return user && user.signedUp && user.role === 'admin' ? children : <Navigate to="/" />;
}