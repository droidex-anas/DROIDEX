import { useCallback, useEffect, useRef } from 'react';

/**
 * Whether the calling component is still mounted, for a reply that must not
 * act for a view the user has already left.
 */
export function useIsMounted(): () => boolean {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return useCallback(() => mounted.current, []);
}
