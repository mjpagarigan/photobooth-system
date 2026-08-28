import type { FrameLayout, FrameSummary } from '@grace-booth/shared';

export const LOCAL_FIXTURES = {
  attractBackground: '/backgrounds/attract.jpg',
  finalBackground: '/backgrounds/ministry-fair-download.jpeg',
  processingBackground: '/backgrounds/processing.jpg',
  processingAnimation: '/animations/loading.json',
  countdownAudio: '/audio/countdown.wav',
  annivFrame: '/frames/anniv-frame.png',
  defaultFrame: '/frames/mat-frame.png',
  matFrame: '/frames/mat-frame.png',
  mockPhotos: ['/mock/photo-1.jpg', '/mock/photo-2.jpg', '/mock/photo-3.jpg'],
  recoveryBackground: '/backgrounds/recovery.jpg',
  shutterAudio: '/audio/shutter.wav',
  ministryIdleBackground: '/backgrounds/ministry-idle.jpg',
} as const;

export const DEFAULT_FRAME_LAYOUT = [
  {
    slotIndex: 1,
    name: 'Photo 1',
    x: 0.25,
    y: 0.295556,
    width: 0.538333,
    height: 0.142778,
    cropMode: 'crop-to-fill',
  },
  {
    slotIndex: 2,
    name: 'Photo 2',
    x: 0.138333,
    y: 0.491667,
    width: 0.553333,
    height: 0.147778,
    cropMode: 'crop-to-fill',
  },
  {
    slotIndex: 3,
    name: 'Photo 3',
    x: 0.271667,
    y: 0.742778,
    width: 0.465,
    height: 0.126667,
    cropMode: 'crop-to-fill',
  },
] satisfies FrameLayout;

export const ANNIVERSARY_FRAME_LAYOUT = [
  {
    slotIndex: 1,
    name: 'Photo 1',
    x: 0.068333,
    y: 0.28,
    width: 0.86,
    height: 0.166111,
    cropMode: 'crop-to-fill',
  },
  {
    slotIndex: 2,
    name: 'Photo 2',
    x: 0.065,
    y: 0.487778,
    width: 0.86,
    height: 0.166667,
    cropMode: 'crop-to-fill',
  },
  {
    slotIndex: 3,
    name: 'Photo 3',
    x: 0.068333,
    y: 0.696667,
    width: 0.86,
    height: 0.166667,
    cropMode: 'crop-to-fill',
  },
] satisfies FrameLayout;

export const DEFAULT_FRAME_PREVIEW: FrameSummary = {
  id: '00000000-0000-4000-8000-0000000000d0',
  name: 'Default frame',
  width: 1_200,
  height: 3_600,
  byteSize: 44_090,
  mediaUrl: LOCAL_FIXTURES.matFrame,
  slots: DEFAULT_FRAME_LAYOUT,
  revision: 0,
};

export const ANNIVERSARY_FRAME_PREVIEW: FrameSummary = {
  id: '00000000-0000-4000-8000-0000000000d1',
  name: 'Anniversary frame',
  width: 1_200,
  height: 3_600,
  byteSize: 44_090,
  mediaUrl: LOCAL_FIXTURES.annivFrame,
  slots: ANNIVERSARY_FRAME_LAYOUT,
  revision: 0,
};

export function mockPhotoFor(slotIndex: number): string {
  return (
    LOCAL_FIXTURES.mockPhotos[Math.max(0, Math.min(2, slotIndex - 1))] ??
    LOCAL_FIXTURES.mockPhotos[0]
  );
}
