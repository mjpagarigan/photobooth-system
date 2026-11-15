import { useEffect, useState } from 'react';

import type { GraceBoothBridge, PrinterHealth } from '@grace-booth/shared';

function getBridge(): GraceBoothBridge | null {
  return window.graceBooth ?? null;
}

/** Live printer health pushed from the main process to every window. */
export function usePrinterHealth(): PrinterHealth | null {
  const [health, setHealth] = useState<PrinterHealth | null>(null);
  useEffect(() => {
    const bridge = getBridge();
    if (!bridge?.print) return;
    let active = true;
    void bridge.print.getHealth().then((result) => {
      if (active && result.ok) setHealth(result.data);
    });
    const unsubscribe = bridge.print.subscribe((next) => {
      if (active) setHealth(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return health;
}

export function isPrinterReady(health: PrinterHealth | null): boolean {
  return health?.status === 'ready' || health?.status === 'printing';
}
