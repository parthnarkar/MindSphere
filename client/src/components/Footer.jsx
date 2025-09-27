import React from 'react';

export default function Footer() {
  return (
    // footer is placed at the bottom by the parent flex container
    <footer className="border-t bg-white/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between text-sm text-gray-600">
        <div className="mb-2 sm:mb-0">© {new Date().getFullYear()} MindSphere — A student wellbeing prototype</div>
        <div className="flex items-center gap-4">
          <a className="hover:underline" href="#">Privacy</a>
          <a className="hover:underline" href="#">Terms</a>
          <a className="hover:underline" href="#">Contact</a>
        </div>
      </div>
    </footer>
  );
}
