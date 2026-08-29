import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ANNIVERSARY_FRAME_NAME,
  ANNIVERSARY_FRAME_SLOTS,
  DEFAULT_FRAME_SLOTS,
  FrameService,
  MAT_FRAME_SLOTS,
  MAT_FRAME_NAME,
  SUPPORTED_FRAME_ASPECT,
} from '../../src/main/frame/frame-service.js';
import type { ImageProcessor } from '../../src/main/image/image-worker-client.js';
import { createTestStore } from './helpers.js';

const UNUSED_PACKAGED_FRAMES = { option1: 'unused-1.png', option2: 'unused-2.png' };
const PACKAGED_FRAMES = {
  option1: fileURLToPath(new URL('../../resources/frames/mat-frame.png', import.meta.url)),
  option2: fileURLToPath(new URL('../../resources/frames/anniv-frame.png', import.meta.url)),
};
const LEGACY_FRAME_PATH = fileURLToPath(
  new URL('../../resources/frames/default-frame.png', import.meta.url),
);

describe('frame import contract', () => {
  it('rejects a decoded transparent frame outside the supported portrait aspect', async () => {
    const store = createTestStore();
    const processor = fakeProcessor(1_000, 1_000);
    const service = new FrameService(
      store.repository,
      store.vault,
      UNUSED_PACKAGED_FRAMES,
      processor,
    );
    try {
      await expect(
        service.importFrame('square', Buffer.from('png'), DEFAULT_FRAME_SLOTS),
      ).rejects.toThrow(/1:3 vertical photobooth strip/);
      expect(store.repository.getActiveFrame()).toBeNull();
    } finally {
      store.close();
    }
  });

  it('rejects the previously supported 3:2 landscape aspect', async () => {
    const store = createTestStore();
    const service = new FrameService(
      store.repository,
      store.vault,
      UNUSED_PACKAGED_FRAMES,
      fakeProcessor(2_700, 1_800),
    );
    try {
      await expect(
        service.importFrame('landscape', Buffer.from('png'), DEFAULT_FRAME_SLOTS),
      ).rejects.toThrow(/1:3 vertical photobooth strip/);
    } finally {
      store.close();
    }
  });

  it('rejects near-1:3 frames instead of stretching them into production output', async () => {
    const store = createTestStore();
    const service = new FrameService(
      store.repository,
      store.vault,
      UNUSED_PACKAGED_FRAMES,
      fakeProcessor(1_200, 3_599),
    );
    try {
      await expect(
        service.importFrame('near aspect', Buffer.from('png'), DEFAULT_FRAME_SLOTS),
      ).rejects.toThrow(/exact 1:3 vertical/);
    } finally {
      store.close();
    }
  });

  it('validates exactly three slots before persisting an accepted strip frame', async () => {
    const store = createTestStore();
    const service = new FrameService(
      store.repository,
      store.vault,
      UNUSED_PACKAGED_FRAMES,
      fakeProcessor(1_200, 3_600),
    );
    try {
      await expect(
        service.importFrame(
          'bad slots',
          Buffer.from('png'),
          DEFAULT_FRAME_SLOTS.slice(0, 2) as never,
        ),
      ).rejects.toThrow();
      const frame = await service.importFrame(
        'valid frame',
        Buffer.from('png'),
        DEFAULT_FRAME_SLOTS,
      );
      expect(frame.slots).toHaveLength(3);
      expect(frame.width / frame.height).toBeCloseTo(SUPPORTED_FRAME_ASPECT, 6);
    } finally {
      store.close();
    }
  });

  it('keeps every calibrated default slot inside the frame bounds', () => {
    for (const slot of DEFAULT_FRAME_SLOTS) {
      expect(slot.x + slot.width).toBeLessThanOrEqual(1);
      expect(slot.y + slot.height).toBeLessThanOrEqual(1);
    }
  });

  it('stores every imported frame as an independent ordered library entry', async () => {
    const store = createTestStore();
    const service = new FrameService(
      store.repository,
      store.vault,
      UNUSED_PACKAGED_FRAMES,
      fakeProcessor(1_200, 3_600),
    );
    try {
      const frame1 = await service.importFrame('Library A', Buffer.from('png1'));
      const frame2 = await service.importFrame(
        'Library B',
        Buffer.from('png2'),
        ANNIVERSARY_FRAME_SLOTS,
      );

      expect(frame1.id).not.toBe(frame2.id);
      const listed = service.listFrames();
      expect(listed.map((frame) => frame.id)).toEqual([frame1.id, frame2.id]);

      const slot0 = DEFAULT_FRAME_SLOTS[0]!;
      const slot1 = DEFAULT_FRAME_SLOTS[1]!;
      const slot2 = DEFAULT_FRAME_SLOTS[2]!;
      const updatedSlots = [{ ...slot0, x: 0.1 }, slot1, slot2];
      service.updateLayout(frame2.id, 'Renamed B', updatedSlots, frame2.revision);

      const reloaded = store.repository.getFrame(frame2.id);
      expect(reloaded?.name).toBe('Renamed B');
      expect(reloaded?.slots[0]?.x).toBe(0.1);
    } finally {
      store.close();
    }
  });

  it('moves frames up and down within the library ordering', async () => {
    const store = createTestStore();
    const service = new FrameService(
      store.repository,
      store.vault,
      UNUSED_PACKAGED_FRAMES,
      fakeProcessor(1_200, 3_600),
    );
    try {
      const first = await service.importFrame('First', Buffer.from('png1'));
      const second = await service.importFrame('Second', Buffer.from('png2'));
      const third = await service.importFrame('Third', Buffer.from('png3'));

      const movedDown = service.moveFrame(first.id, 'down');
      expect(movedDown.map((frame) => frame.id)).toEqual([second.id, first.id, third.id]);

      const movedUp = service.moveFrame(first.id, 'up');
      expect(movedUp.map((frame) => frame.id)).toEqual([first.id, second.id, third.id]);

      // Boundary moves are no-ops that keep the library intact.
      expect(service.moveFrame(third.id, 'down')).toHaveLength(3);
      expect(service.moveFrame(first.id, 'up')).toHaveLength(3);
    } finally {
      store.close();
    }
  });

  it('deletes unused library entries but refuses frames used by recorded sessions', async () => {
    const store = createTestStore();
    const service = new FrameService(
      store.repository,
      store.vault,
      UNUSED_PACKAGED_FRAMES,
      fakeProcessor(1_200, 3_600),
    );
    try {
      const disposable = await service.importFrame('Disposable', Buffer.from('png1'));
      const used = await service.importFrame('Used', Buffer.from('png2'));

      const sessionId = randomUUID();
      store.repository.createSession(sessionId, 1_000);
      store.database.raw
        .prepare("UPDATE sessions SET state = 'final', selected_frame_id = ? WHERE id = ?")
        .run(used.id, sessionId);

      expect(() => service.deleteFrame(used.id)).toThrow(/used by saved photo sessions/i);
      expect(store.repository.getFrame(used.id)).not.toBeNull();

      const remaining = service.deleteFrame(disposable.id);
      expect(remaining.map((frame) => frame.id)).toEqual([used.id]);
      expect(store.repository.getFrame(disposable.id)).toBeNull();
    } finally {
      store.close();
    }
  });
});

describe('packaged frame seeding', () => {
  it('seeds fresh installations with exactly the two packaged anniversary frames', async () => {
    const store = createTestStore();
    const service = new FrameService(
      store.repository,
      store.vault,
      PACKAGED_FRAMES,
      passthroughProcessor(),
    );
    try {
      const defaults = await service.ensureDefaultFrames();

      expect(defaults.option1.name).toBe(MAT_FRAME_NAME);
      expect(defaults.option1.slots).toEqual(MAT_FRAME_SLOTS);
      expect(defaults.option2.name).toBe(ANNIVERSARY_FRAME_NAME);
      expect(defaults.option2.slots).toEqual(ANNIVERSARY_FRAME_SLOTS);
      expect(defaults.option1.sha256).not.toBe(defaults.option2.sha256);

      const library = service.listFrames();
      expect(library).toHaveLength(2);
      expect(library[0]?.id).toBe(defaults.option1.id);
      expect(library[1]?.id).toBe(defaults.option2.id);
      expect(store.repository.getActiveFrame()?.id).toBe(defaults.option1.id);
    } finally {
      store.close();
    }
  });

  it('upgrades untouched shipped legacy defaults to the two anniversary frames', async () => {
    const store = createTestStore();
    const processor = passthroughProcessor();
    const service = new FrameService(store.repository, store.vault, PACKAGED_FRAMES, processor);
    try {
      const legacyBytes = readFileSync(LEGACY_FRAME_PATH);
      const legacy1 = await service.importFrame(
        'CCF Alabang Ministry Fair Strip',
        legacyBytes,
        DEFAULT_FRAME_SLOTS,
      );
      const legacy2 = await service.importFrame(
        'CCF Alabang Ministry Fair Strip (Collage 2)',
        legacyBytes,
        DEFAULT_FRAME_SLOTS,
      );

      const defaults = await service.ensureDefaultFrames();

      expect(defaults.option1.id).not.toBe(legacy1.id);
      expect(defaults.option2.id).not.toBe(legacy2.id);
      expect(defaults.option1.name).toBe(MAT_FRAME_NAME);
      expect(defaults.option2.name).toBe(ANNIVERSARY_FRAME_NAME);
      expect(service.listFrames()).toHaveLength(2);
    } finally {
      store.close();
    }
  });

  it('preserves operator-imported artwork even when it uses a legacy-looking name', async () => {
    const store = createTestStore();
    const service = new FrameService(
      store.repository,
      store.vault,
      PACKAGED_FRAMES,
      passthroughProcessor(),
    );
    try {
      const custom1 = await service.importFrame(
        'CCF Alabang Ministry Fair Strip',
        Buffer.from('operator artwork one'),
        DEFAULT_FRAME_SLOTS,
      );
      const custom2 = await service.importFrame(
        'Operator anniversary artwork',
        Buffer.from('operator artwork two'),
        ANNIVERSARY_FRAME_SLOTS,
      );

      const defaults = await service.ensureDefaultFrames();

      expect(defaults.option1.id).toBe(custom1.id);
      expect(defaults.option2.id).toBe(custom2.id);
    } finally {
      store.close();
    }
  });

  it('preserves edited slot geometry on a formerly shipped default', async () => {
    const store = createTestStore();
    const service = new FrameService(
      store.repository,
      store.vault,
      PACKAGED_FRAMES,
      passthroughProcessor(),
    );
    try {
      const legacy = await service.importFrame(
        'CCF Alabang Ministry Fair Strip',
        readFileSync(LEGACY_FRAME_PATH),
        DEFAULT_FRAME_SLOTS,
      );
      const editedSlots = legacy.slots.map((slot, index) =>
        index === 0 ? { ...slot, x: slot.x + 0.01 } : slot,
      );
      const edited = service.updateLayout(legacy.id, legacy.name, editedSlots, legacy.revision);

      const defaults = await service.ensureDefaultFrames();

      expect(defaults.option1.id).toBe(edited.id);
      expect(defaults.option1.revision).toBe(1);
      expect(defaults.option1.slots[0]?.x).toBeCloseTo(editedSlots[0]!.x);
      expect(defaults.option2.name).toBe(ANNIVERSARY_FRAME_NAME);
    } finally {
      store.close();
    }
  });

  it('seeds additional ministry frames when present in resources directory', async () => {
    const store = createTestStore();
    const service = new FrameService(
      store.repository,
      store.vault,
      PACKAGED_FRAMES,
      passthroughProcessor(),
    );
    try {
      await service.ensureDefaultFrames();
      const ministryFrames = await service.ensureMinistryFrames();
      expect(Array.isArray(ministryFrames)).toBe(true);
      const totalFrames = service.listFrames();
      expect(totalFrames.length).toBeGreaterThanOrEqual(2);
    } finally {
      store.close();
    }
  });
});

function fakeProcessor(width: number, height: number): ImageProcessor {
  return {
    process: () => Promise.reject(new Error('not used')),
    validateSourceJpeg: () => Promise.reject(new Error('not used')),
    normalizeFramePng: () =>
      Promise.resolve({ bytes: Buffer.from('normalized transparent PNG'), width, height }),
    createThumbnail: () => Promise.reject(new Error('not used')),
    close: () => Promise.resolve(),
  };
}

function passthroughProcessor(): ImageProcessor {
  return {
    process: () => Promise.reject(new Error('not used')),
    validateSourceJpeg: () => Promise.reject(new Error('not used')),
    normalizeFramePng: (bytes) =>
      Promise.resolve({ bytes: Buffer.from(bytes), width: 1_200, height: 3_600 }),
    createThumbnail: () => Promise.reject(new Error('not used')),
    close: () => Promise.resolve(),
  };
}
