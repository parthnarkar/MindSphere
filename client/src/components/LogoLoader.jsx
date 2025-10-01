import React, { useEffect, useRef, useState } from 'react';
import logo from '../assets/mindsphere-logo.png';

// LogoLoader now enforces a minimum visible duration when activated.
// Props:
// - active: boolean - whether the loader should be active
// - minDuration: minimum milliseconds to remain visible after activation (default 2000)
// - size: number (px) width/height of the logo image (default 96)
// - text: optional string shown under the logo
// - overlay: boolean - if true, renders a full-screen opaque white overlay centered
// Note: this component enforces a fully opaque white background for both overlay
// and non-overlay variants to avoid any transparent loaders in the app.
const LogoLoader = ({ active = false, minDuration = 2000, size = 96, text = '', overlay = true, overlayOpacity = 1, blockInteraction = true }) => {
  const [visible, setVisible] = useState(false);
  const startRef = useRef(0);
  const timeoutRef = useRef(null);

  useEffect(() => {
    // Clear any pending timeout on unmount
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (active) {
      // Show immediately and record start
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      startRef.current = Date.now();
      setVisible(true);
    } else {
      // If deactivated, ensure at least minDuration has passed
      const elapsed = Date.now() - (startRef.current || 0);
      const remaining = Math.max(0, minDuration - elapsed);
      if (remaining <= 0) {
        setVisible(false);
      } else {
        // schedule hide after remaining time
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          setVisible(false);
          timeoutRef.current = null;
        }, remaining);
      }
    }
  }, [active, minDuration]);

  if (!visible) return null;

  const containerBase = 'fixed inset-0 z-50 flex items-center justify-center';
  const nonOverlayClass = 'flex items-center justify-center';
  const imgStyle = { width: size, height: size, objectFit: 'contain' };

  if (overlay) {
    // Force fully opaque white overlay regardless of overlayOpacity passed in
    const bgStyle = { backgroundColor: '#ffffff', transition: 'opacity 260ms ease' };
    const pointerEvents = blockInteraction ? 'auto' : 'none';
    return (
      <div className={containerBase} style={{ ...bgStyle, pointerEvents }} aria-live="polite" aria-busy="true">
        <div className="flex flex-col items-center">
          <img src={logo} alt="MindSphere" style={imgStyle} className="animate-pulse" />
          {text ? <div className="mt-3 text-base text-[#263238]">{text}</div> : null}
        </div>
      </div>
    );
  }

  // Non-overlay variant: render the logo inside a white card to avoid transparency
  return (
    <div className={nonOverlayClass} aria-live="polite" aria-busy="true">
      <div className="flex flex-col items-center bg-white rounded-md p-3 shadow-sm">
        <img src={logo} alt="MindSphere" style={imgStyle} className="animate-pulse" />
        {text ? <div className="mt-3 text-base text-[#263238]">{text}</div> : null}
      </div>
    </div>
  );
};

export default LogoLoader;
