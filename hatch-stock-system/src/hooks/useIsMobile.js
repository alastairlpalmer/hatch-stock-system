import { useState, useEffect } from 'react';

// Single source of truth for the app's mobile breakpoint (matches Tailwind's
// `md`). Drives the bottom-nav vs sidebar chrome swap and the /restock index
// (hub on phones, workflow on desktop).
export const MOBILE_BREAKPOINT = 768;

export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return isMobile;
}
