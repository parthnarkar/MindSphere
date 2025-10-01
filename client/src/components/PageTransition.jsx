import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

// PageTransition: simple fade wrapper. On route change it briefly hides content
// and then reveals new children with a short opacity transition to reduce flicker.
export default function PageTransition({ children }) {
  // No-op wrapper: animations removed per request.
  return <>{children}</>;
}
