import React from 'react';

export const FigmaBrandLogo: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
  <svg viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg" className={`block shrink-0 ${className}`} aria-hidden="true">
    <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE" />
    <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83" />
    <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262" />
    <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E" />
    <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF" />
  </svg>
);

export const AxureBrandLogo: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
  <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className={`block shrink-0 ${className}`} aria-hidden="true">
    <rect x="2" y="2" width="36" height="36" rx="9" fill="#0F172A" />
    {/* Iconic Axure RP tricolor intersecting X/prism ribbons */}
    <path d="M10.5 10.5L19.8 20L10.5 29.5" stroke="#00A8E8" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M29.5 10.5L20.2 20L29.5 29.5" stroke="#8CC63F" strokeWidth="4.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M15.2 10.5L24.8 29.5" stroke="#EC008C" strokeWidth="3.6" strokeLinecap="round" opacity="0.92" />
    <circle cx="20" cy="20" r="2.6" fill="#FFFFFF" />
  </svg>
);
