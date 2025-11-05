import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useScroll, useTransform } from 'framer-motion';
import {
  IoChatbubblesOutline,
  IoClipboardOutline,
  IoCalendarOutline,
  IoPeopleOutline,
  IoBookOutline,
  IoShieldCheckmarkOutline,
  IoSparklesOutline,
  IoGlobeOutline,
  IoFingerPrintOutline,
  IoArrowForward,
  IoBulbOutline,
  IoCubeOutline,
  IoRocketOutline,
  IoFlashOutline,
  IoSearchOutline
} from 'react-icons/io5';

// Firebase auth instance (used to gate navigation)
import { auth } from '../services/firebase';

// Image imports
// ...existing image imports
import heroBgIllustration from '../assets/hero-bg-illustration.png'; // New blurred background image for hero
import heroAbstractElements from '../assets/hero-abstract-elements.png'; // New abstract elements image
import testimonialAvatar from '../assets/testimonial-avatar.png';

// --- Reusable UI Components based on your Design System ---

const GradientText = ({ children, className = '' }) => (
  <span className={`bg-gradient-to-r from-[#FF8C42] to-[#e6732f] text-transparent bg-clip-text ${className}`}>
    {children}
  </span>
);

const UiCard = ({ children, className = '', hoverEffect = true }) => (
  <motion.div
    initial={{ opacity: 0, y: 30, scale: 0.98 }}
    whileInView={{ opacity: 1, y: 0, scale: 1 }}
    viewport={{ once: true, amount: 0.2 }}
    transition={{ duration: 0.7, ease: "easeOut", type: "spring", stiffness: 100 }}
    whileHover={hoverEffect ? { y: -5, boxShadow: "0 15px 30px rgba(0,0,0,0.15)", scale: 1.01 } : {}}
    className={`group relative bg-white/70 backdrop-blur-md rounded-2xl shadow-xl border border-gray-100/50 overflow-hidden ${className}`}
  >
    {children}
    {hoverEffect && (
      <div className="absolute inset-0 z-0 opacity-0 transition-opacity duration-300 pointer-events-none group-hover:opacity-100"
           style={{ background: 'radial-gradient(circle at center, rgba(255,140,66,0.1) 0%, transparent 70%)' }} />
    )}
  </motion.div>
);

const PrimaryButton = ({ children, onClick, className = '', ...props }) => (
  <motion.button
    whileHover={{ scale: 1.03, boxShadow: "0 10px 25px rgba(255,140,66,0.4)" }}
    whileTap={{ scale: 0.97 }}
    onClick={props.disabled ? undefined : onClick}
    aria-disabled={props.disabled ? 'true' : 'false'}
    disabled={props.disabled}
    className={`relative overflow-hidden px-8 py-3 bg-[#FF8C42] text-white rounded-lg font-semibold shadow-lg hover:bg-[#e6732f] transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-[#FF8C42]/50 group ${className}`}
    {...props}
  >
    {children}
    <span className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 animate-shimmer" />
  </motion.button>
);

// --- LandingPage Component ---
const LandingPage = () => {
  const navigate = useNavigate();
  const { scrollYProgress } = useScroll();
  const mainRef = useRef(null);

  const scale = useTransform(scrollYProgress, [0, 0.5], [1, 0.8]);
  const yTranslate = useTransform(scrollYProgress, [0, 0.5], [0, -100]);
  const descriptionY = useTransform(scrollYProgress, [0, 0.3], [0, -30]);

  // State and ref for mouse-following glow
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const heroRef = useRef(null); // Ref to the hero section

  useEffect(() => {
    const handleMouseMove = (event) => {
      if (heroRef.current) {
        const { left, top } = heroRef.current.getBoundingClientRect();
        // Calculate mouse position relative to the hero section
        setMousePosition({
          x: event.clientX - left,
          y: event.clientY - top,
        });
      }
    };

    const currentHeroRef = heroRef.current; // Capture current ref value
    if (currentHeroRef) {
      currentHeroRef.addEventListener('mousemove', handleMouseMove);
    }

    return () => {
      if (currentHeroRef) {
        currentHeroRef.removeEventListener('mousemove', handleMouseMove);
      }
    };
  }, []); // Empty dependency array means this runs once on mount and cleans up on unmount

  const handleGetStarted = () => {
    navigateToAuthWithRole('user');
  };

  // Focus main for accessibility when the page mounts
  React.useEffect(() => {
    try {
      if (mainRef && mainRef.current) mainRef.current.focus({ preventScroll: true });
    } catch (e) {}
  }, []);

  const isAdminSession = () => {
    try {
      return sessionStorage && sessionStorage.getItem && sessionStorage.getItem('authRole') === 'admin';
    } catch (e) {
      return false;
    }
  };

  const navigateToAuthWithRole = (role = 'user') => {
    // If this browser session represents an admin (optimistic session storage),
    // do not navigate anywhere from the landing page. This intentionally keeps
    // landing links inert for admins per product requirement.
    try {
      if (isAdminSession()) return;
      // Only navigate to the auth page when the user is NOT authenticated.
      // We intentionally do NOT include a role query parameter in links.
      // If auth.currentUser exists (user is signed in), do nothing.
      if (!auth || !auth.currentUser) {
        navigate('/auth');
      }
    } catch (e) {
      // Fallback: if navigate failed for some reason, attempt a generic /auth
      try { navigate('/auth'); } catch (_) {}
    }
  };

  // Signal to the top-level App that the landing page is ready immediately on mount.
  React.useEffect(() => {
    try { window.dispatchEvent(new CustomEvent('mindsphere:pageReady')); } catch(e) {}
  }, []);

  // Generic handler for "Service" buttons to redirect to auth with a role
  const handleServiceButtonClick = (role = 'user') => {
    // If current browser session is an admin fallback session, do not navigate.
    if (isAdminSession()) return;
    navigateToAuthWithRole(role);
  };

  return (
  <div ref={mainRef} tabIndex={-1} aria-label="MindSphere landing" className="min-h-screen bg-[#F0F2F5] font-sans text-[#263238] overflow-x-hidden antialiased relative">
  {/* Global CSS for shimmer and custom animations */}
  <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 1.5s infinite;
        }
        @keyframes marquee {
          0% { transform: translateX(0%); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee {
          animation: marquee 30s linear infinite;
          width: fit-content;
        }
        @keyframes glowPulse {
          0% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.05); opacity: 0.6; }
          100% { transform: scale(1); opacity: 0.3; }
        }
        .animate-glowPulse {
          animation: glowPulse 4s infinite alternate ease-in-out;
        }
        @keyframes bounce-horizontal {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(5px); }
        }
        .animate-bounce-horizontal {
          animation: bounce-horizontal 1.5s infinite ease-in-out;
        }
        @keyframes rotate-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .hover\\:animate-spin-slow:hover {
          animation: rotate-slow 8s linear infinite;
        }
        @keyframes animate-blob {
          0% { transform: translate(0px, 0px) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
          100% { transform: translate(0px, 0px) scale(1); }
        }
        .animate-blob {
          animation: animate-blob 7s infinite ease-in-out;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        .bg-grid {
            background-image: linear-gradient(#3a3a4c 1px, transparent 1px), linear-gradient(to right, #3a3a4c 1px, transparent 1px);
            background-size: 40px 40px;
        }
  `}</style>

      {/* Navbar removed — single global Header is mounted in App.jsx */}

      {/* Hero Section */}
      <section ref={heroRef} className="relative bg-gradient-to-br from-[#1A1A2E] to-[#0F0F1A] min-h-screen flex items-center justify-center pt-24 pb-12 overflow-hidden">
        {/* Dynamic Starfield/Grid Background */}
        <div className="absolute inset-0 z-0 opacity-20 bg-grid"></div>

        {/* New blurred background image for hero section */}
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: `url(${heroBgIllustration})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(10px)', // Adjust blur as needed
            opacity: 0.3, // Adjust opacity as needed
          }}
        ></div>

        {/* Mouse-following glow (responsive size, centered via transform) */}
        <div
          className="absolute z-10 pointer-events-none"
          style={{
            background: 'radial-gradient(circle at center, rgba(255,140,66,0.3) 0%, transparent 70%)',
            filter: 'blur(40px)',
            width: 'min(320px, 40vw)', // responsive size
            height: 'min(320px, 40vw)',
            left: `${mousePosition.x}px`, // positioned at cursor, then centered with transform
            top: `${mousePosition.y}px`,
            transform: 'translate(-50%, -50%)',
            transition: 'transform 0.12s ease-out, opacity 0.25s ease-out', // Smooth movement
            opacity: mousePosition.x === 0 && mousePosition.y === 0 ? 0 : 1 // Hide until mouse moves
          }}
        ></div>

        {/* Hero Content */}
        <motion.div style={{ y: yTranslate }} className="max-w-7xl mx-auto p-4 relative z-20 grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          {/* Left Panel: Brand Panel with strong headline */}
          <motion.div
            initial={{ opacity: 0, x: -80 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.9, ease: [0.17, 0.55, 0.55, 1], delay: 0.3 }}
            className="text-white text-center md:text-left"
          >
            <h1 className="text-3xl md:text-5xl lg:text-6xl font-extrabold leading-tight mb-6">
              <GradientText className="inline text-white">MindSphere:</GradientText> <br />
              <GradientText className="inline">Nurturing Minds, Powering Potential.</GradientText>
            </h1>
            <motion.p
              style={{ y: descriptionY }}
              className="text-lg leading-relaxed mb-8 max-w-lg mx-auto md:mx-0 text-white/70 font-light"
            >
              Your intelligent companion for academic and personal growth. Experience next-gen support, from AI-driven insights to confidential human connection.
            </motion.p>
            <PrimaryButton onClick={handleGetStarted} disabled={isAdminSession()} aria-label="Launch your future" className="text-xl cursor-pointer">
              Launch Your Future <IoRocketOutline className="inline-block ml-2 text-2xl animate-bounce-horizontal" />
            </PrimaryButton>
            <div className="mt-12 flex flex-wrap justify-center md:justify-start items-center gap-6 text-white/70">
              <IoSparklesOutline className="text-4xl text-[#FF8C42] animate-pulse" />
              <IoGlobeOutline className="text-4xl text-[#FF8C42] hover:animate-spin-slow" />
              <IoFingerPrintOutline className="text-4xl text-[#FF8C42] hover:scale-110 transition-transform" />
              <span className="text-lg font-medium tracking-wide">Empowering over 10,000 students globally</span>
            </div>
          </motion.div>
          {/* Right Panel: Now with hero-abstract-elements.png */}
          <motion.div
            initial={{ opacity: 0, x: 80 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.9, ease: [0.17, 0.55, 0.55, 1], delay: 0.5 }}
            className="hidden md:flex justify-center relative p-4"
          >
            {/* The illustration itself is now part of the background, no need for an <img> tag here. */}
            {/* Abstract elements image */}
      <img
        src={heroAbstractElements}
        alt="Abstract elements"
        className="absolute top-8 right-4 left-1/2  transform -translate-x-1/2 -translate-y-60 w-[90%] md:w-[550px] max-w-[90%] h-auto" // responsive sizing and positioning
      />

            {/* Dynamic glow effect around the illustration (removed pulsing, now relies on mouse-follow) */}
            <div className="absolute inset-0 rounded-2xl z-0" style={{
              background: 'radial-gradient(circle at center, rgba(255,140,66,0.3) 0%, transparent 70%)',
              filter: 'blur(40px)',
              opacity: 0.3 // Keep a subtle background glow
            }}></div>
            {/* Abstract shapes/particles (these can stay or be removed if heroAbstractElements covers enough) */}
            {/* <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1, duration: 1, type: "spring", stiffness: 50 }}
              className="absolute top-1/4 left-1/4 w-20 h-20 bg-[#e6732f] rounded-full mix-blend-screen opacity-10 animate-blob"
            ></motion.div>
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.2, duration: 1, type: "spring", stiffness: 50 }}
              className="absolute bottom-1/4 right-1/4 w-16 h-16 bg-[#FF8C42] rounded-full mix-blend-screen opacity-10 animate-blob animation-delay-2000"
            ></motion.div> */}
          </motion.div>
        </motion.div>
      </section>

      {/* Why Choose Us Section */}
      <section className="py-20 bg-[#F0F2F5]" id="why-choose-us">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-[#FF8C42] font-semibold mb-3 text-base"
          >
            Why Choose Us?
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-2xl lg:text-3xl font-extrabold text-[#263238] mb-12"
          >
            Your Best Choice for Comprehensive <br /> Mental Health Support
          </motion.h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <UiCard className="col-span-1 p-6 md:p-8 flex flex-col items-center group">
              <div className="text-5xl text-[#FF8C42] mb-4 transition-transform group-hover:scale-110"><IoCubeOutline /></div>
              <h3 className="text-xl font-bold text-[#263238] mb-2">Holistic Approach</h3>
              <p className="text-[#90A4AE] text-sm leading-relaxed">Our consultants consider all aspects of your well-being, integrating various therapeutic techniques for comprehensive care.</p>
            </UiCard>
            <UiCard className="col-span-1 p-6 md:p-8 flex flex-col items-center bg-gradient-to-br from-white/90 to-white/70 group">
              <div className="text-5xl text-[#FF8C42] mb-4 transition-transform group-hover:scale-110"><IoPeopleOutline /></div>
              <h3 className="text-xl font-bold text-[#263238] mb-2">Expert Team</h3>
              <p className="text-[#90A4AE] text-sm leading-relaxed">Access a team of highly qualified and experienced mental health professionals dedicated to student support.</p>
            </UiCard>
            <UiCard className="col-span-1 p-6 md:p-8 flex flex-col items-center group">
              <div className="text-5xl text-[#FF8C42] mb-4 transition-transform group-hover:scale-110"><IoBulbOutline /></div>
              <h3 className="text-xl font-bold text-[#263238] mb-2">Unmatched Accessibility</h3>
              <p className="text-[#90A4AE] text-sm leading-relaxed">Mental health support should be easy to reach. MindSphere makes it accessible from anywhere, anytime, to all students.</p>
            </UiCard>
          </div>
        </div>
      </section>

      {/* Services Section */}
      <section className="py-20 bg-gradient-to-br from-[#EAF4FF] to-white" id="features">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-[#FF8C42] font-semibold mb-3 text-base"
          >
            Core Services
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.3 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-2xl lg:text-3xl font-extrabold text-[#263238] mb-12"
          >
            Empowering Minds: Our Mental Health Consulting Services
          </motion.h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Service Card 1: Anonymous Chatbot */}
            <UiCard className="p-6 md:p-8 flex flex-col items-center justify-center group"> {/* Added justify-center */}
              <div className="text-6xl text-[#FF8C42] mb-6 transition-transform group-hover:scale-110"><IoChatbubblesOutline /></div>
              <h3 className="text-xl font-bold text-[#263238] mb-3">Anonymous Chatbot</h3>
              <p className="text-base text-[#90A4AE] mb-6">Get supportive, non-clinical help for stress, anxiety, and study issues powered by Gemini AI.</p>
              <PrimaryButton onClick={() => handleServiceButtonClick('user')} disabled={isAdminSession()} aria-label="Chat now" className="w-full text-base"> {/* Redirect to login */}
                Chat Now <IoArrowForward className="inline-block ml-2" />
              </PrimaryButton>
            </UiCard>

            {/* Service Card 2: Screening Tools */}
            <UiCard className="p-6 md:p-8 flex flex-col items-center justify-center group"> {/* Added justify-center */}
              <div className="text-6xl text-[#FF8C42] mb-6 transition-transform group-hover:scale-110"><IoClipboardOutline /></div>
              <h3 className="text-xl font-bold text-[#263238] mb-3">Screening Tools</h3>
              <p className="text-base text-[#90A4AE] mb-6">Confidential PHQ-9 style assessments to help you understand your mental well-being.</p>
              <PrimaryButton onClick={() => handleServiceButtonClick('user')} disabled={isAdminSession()} aria-label="Take assessment" className="w-full text-base"> {/* Redirect to login */}
                Take Assessment <IoArrowForward className="inline-block ml-2" />
              </PrimaryButton>
            </UiCard>

            {/* Service Card 3: Confidential Booking */}
            <UiCard className="p-6 md:p-8 flex flex-col items-center justify-center group"> {/* Added justify-center */}
              <div className="text-6xl text-[#FF8C42] mb-6 transition-transform group-hover:scale-110"><IoCalendarOutline /></div>
              <h3 className="text-xl font-bold text-[#263238] mb-3">Confidential Booking</h3>
              <p className="text-base text-[#90A4AE] mb-6">Easily book appointments with qualified counselors, with options for anonymous sessions.</p>
              <PrimaryButton onClick={() => handleServiceButtonClick('user')} disabled={isAdminSession()} aria-label="Book a session" className="w-full text-base"> {/* Redirect to login */}
                Book a Session <IoArrowForward className="inline-block ml-2" />
              </PrimaryButton>
            </UiCard>

            {/* Service Card 4: Peer-to-Peer Support */}
            <UiCard className="p-6 md:p-8 flex flex-col items-center justify-center group"> {/* Added justify-center */}
              <div className="text-6xl text-[#FF8C42] mb-6 transition-transform group-hover:scale-110"><IoPeopleOutline /></div>
              <h3 className="text-xl font-bold text-[#263238] mb-3">Peer-to-Peer Support</h3>
              <p className="text-base text-[#90A4AE] mb-6">Connect in a moderated, anonymous forum with other students for shared experiences and support.</p>
              <PrimaryButton onClick={() => handleServiceButtonClick('user')} disabled={isAdminSession()} aria-label="Join forum" className="w-full text-base"> {/* Redirect to login */}
                Join Forum <IoArrowForward className="inline-block ml-2" />
              </PrimaryButton>
            </UiCard>

            {/* Service Card 5: Resource Library */}
            <UiCard className="p-6 md:p-8 flex flex-col items-center justify-center group"> {/* Added justify-center */}
              <div className="text-6xl text-[#FF8C42] mb-6 transition-transform group-hover:scale-110"><IoBookOutline /></div>
              <h3 className="text-xl font-bold text-[#263238] mb-3">Resource Library</h3>
              <p className="text-base text-[#90A4AE] mb-6">Access a curated collection of videos, articles, books, and local support services in our website.</p>
              <PrimaryButton onClick={() => handleServiceButtonClick('user')} disabled={isAdminSession()} aria-label="Explore resources" className="w-full text-base"> {/* Redirect to login */}
                Explore Resources <IoArrowForward className="inline-block ml-2" />
              </PrimaryButton>
            </UiCard>

            {/* Service Card 6: Admin & Counselor Dashboards */}
            <UiCard className="p-6 md:p-8 flex flex-col items-center justify-center group"> {/* Added justify-center */}
              <div className="text-6xl text-[#FF8C42] mb-6 transition-transform group-hover:scale-110"><IoShieldCheckmarkOutline /></div>
              <h3 className="text-xl font-bold text-[#263238] mb-3">Admin & Counselor Dashboards</h3>
              <p className="text-base text-[#90A4AE] mb-6">(Internal) Tools for administrators and counselors to manage users, bookings, and monitor trends.</p>
              <PrimaryButton onClick={() => handleServiceButtonClick('user')} disabled={isAdminSession()} aria-label="Access dashboards" className="w-full text-base"> {/* Redirect to login */}
                Access Dashboards <IoArrowForward className="inline-block ml-2" />
              </PrimaryButton>
            </UiCard>
          </div>
        </div>
      </section>

      {/* Footer removed; global Footer component is mounted in App.jsx */}
    </div>
  );
};

export default LandingPage;