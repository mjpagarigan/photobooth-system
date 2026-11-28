import { useEffect, useRef } from 'react';

function nextLocalMidnightMs(nowMs: number = Date.now()): number {
  const now = new Date(nowMs);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).getTime();
}

/** Invokes `onMidnight` just after each local calendar midnight while `active` is true. */
export function useMidnightRefresh(active: boolean, onMidnight: () => void): void {
  const callbackRef = useRef(onMidnight);

  useEffect(() => {
    callbackRef.current = onMidnight;
  }, [onMidnight]);

  useEffect(() => {
    if (!active) {
      return;
    }

    let cancelled = false;
    let timerId: number | null = null;

    const scheduleMidnightRefresh = () => {
      const now = Date.now();
      const delayMs = Math.max(250, nextLocalMidnightMs(now) - now + 250);
      timerId = window.setTimeout(() => {
        if (cancelled) {
          return;
        }
        callbackRef.current();
        scheduleMidnightRefresh();
      }, delayMs);
    };

    scheduleMidnightRefresh();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [active]);
}
