import type { GraceBoothBridge } from '@grace-booth/shared';
import { useEffect, useState } from 'react';

type GraceBoothBooth = GraceBoothBridge['booth'];

export type NikonPreviewResolution = {
  width: number;
  height: number;
};

export type NikonLivePreviewState = {
  frameUrl: string | null;
  resolution: NikonPreviewResolution | null;
  ready: boolean;
};

const IDLE_PREVIEW: NikonLivePreviewState = {
  frameUrl: null,
  resolution: null,
  ready: false,
};

/**
 * Streams Nikon USB Live View frames from the main-process camera helper when active.
 */
export function useNikonLivePreview(enabled: boolean): NikonLivePreviewState {
  const [state, setState] = useState<NikonLivePreviewState>(IDLE_PREVIEW);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const booth =
      typeof window === 'undefined'
        ? undefined
        : (window.graceBooth?.booth as Partial<GraceBoothBooth> | undefined);
    if (!booth) {
      return;
    }

    let active = true;
    const unsubscribe = booth.onCameraPreviewFrame?.((frame) => {
      if (!active) return;
      setState({
        frameUrl: `data:image/jpeg;base64,${frame.jpegBase64}`,
        resolution: { width: frame.width, height: frame.height },
        ready: true,
      });
    });

    void booth.setCameraPreview?.(true, 'nikon').catch(() => undefined);

    return () => {
      active = false;
      unsubscribe?.();
      void booth.setCameraPreview?.(false, 'nikon').catch(() => undefined);
      setState(IDLE_PREVIEW);
    };
  }, [enabled]);

  return enabled ? state : IDLE_PREVIEW;
}
