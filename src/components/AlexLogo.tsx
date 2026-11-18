import React, { useId } from 'react';

interface AlexLogoProps {
  size?: number;
  className?: string;
}

export const AlexLogo: React.FC<AlexLogoProps> = ({ size = 32, className = '' }) => {
  const uid = useId().replace(/:/g, '');
  const bgId = `pf-bg-${uid}`;
  const cyanId = `pf-cyan-${uid}`;
  const indigoId = `pf-indigo-${uid}`;
  const rimId = `pf-rim-${uid}`;
  const bottomId = `pf-bot-${uid}`;
  const midId = `pf-mid-${uid}`;
  const topId = `pf-top-${uid}`;
  const starId = `pf-star-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 select-none ${className}`}
    >
      <defs>
        <linearGradient id={bgId} x1="40" y1="24" x2="472" y2="488" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#090D1A" />
          <stop offset="48%" stopColor="#0F1E46" />
          <stop offset="100%" stopColor="#1D4ED8" />
        </linearGradient>

        <radialGradient
          id={cyanId}
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(388 112) rotate(135) scale(320)"
        >
          <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.48" />
          <stop offset="55%" stopColor="#2563EB" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#090D1A" stopOpacity="0" />
        </radialGradient>

        <radialGradient
          id={indigoId}
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(116 408) rotate(-45) scale(280)"
        >
          <stop offset="0%" stopColor="#6366F1" stopOpacity="0.38" />
          <stop offset="100%" stopColor="#090D1A" stopOpacity="0" />
        </radialGradient>

        <linearGradient id={rimId} x1="56" y1="32" x2="456" y2="480" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#BAE6FD" stopOpacity="0.6" />
          <stop offset="45%" stopColor="#60A5FA" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#818CF8" stopOpacity="0.42" />
        </linearGradient>

        <linearGradient id={bottomId} x1="136" y1="280" x2="376" y2="412" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#4F46E5" stopOpacity="0.75" />
        </linearGradient>

        <linearGradient id={midId} x1="120" y1="196" x2="388" y2="332" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38BDF8" />
          <stop offset="55%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#3B82F6" />
        </linearGradient>

        <linearGradient id={topId} x1="132" y1="112" x2="364" y2="256" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="68%" stopColor="#F0F9FF" />
          <stop offset="100%" stopColor="#BAE6FD" />
        </linearGradient>

        <linearGradient id={starId} x1="336" y1="104" x2="416" y2="184" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="45%" stopColor="#7DD3FC" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>
      </defs>

      <rect x="24" y="24" width="464" height="464" rx="108" fill={`url(#${bgId})`} />
      <rect x="24" y="24" width="464" height="464" rx="108" fill={`url(#${cyanId})`} />
      <rect x="24" y="24" width="464" height="464" rx="108" fill={`url(#${indigoId})`} />
      <rect x="26" y="26" width="460" height="460" rx="106" stroke={`url(#${rimId})`} strokeWidth="5" />

      <path
        d="M256 266L382 332C393 337.8 393 352.2 382 358L272 415.5C262 420.7 250 420.7 240 415.5L130 358C119 352.2 119 337.8 130 332L256 266Z"
        fill={`url(#${bottomId})`}
        stroke="#93C5FD"
        strokeOpacity="0.4"
        strokeWidth="4"
      />

      <path
        d="M256 188L382 254C393 259.8 393 274.2 382 280L272 337.5C262 342.7 250 342.7 240 337.5L130 280C119 274.2 119 259.8 130 254L256 188Z"
        fill={`url(#${midId})`}
        stroke="#E0F2FE"
        strokeOpacity="0.6"
        strokeWidth="4"
      />

      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M256 110L382 176C393 181.8 393 196.2 382 202L272 259.5C262 264.7 250 264.7 240 259.5L130 202C119 196.2 119 181.8 130 176L256 110ZM256 154L188 189L256 224L324 189L256 154Z"
        fill={`url(#${topId})`}
      />

      <circle cx="256" cy="189" r="15" fill="#38BDF8" />
      <circle cx="256" cy="189" r="6.5" fill="#FFFFFF" />

      <path
        d="M380 96C384.2 122.8 393.2 131.8 420 136C393.2 140.2 384.2 149.2 380 176C375.8 149.2 366.8 140.2 340 136C366.8 131.8 375.8 122.8 380 96Z"
        fill={`url(#${starId})`}
      />
    </svg>
  );
};
