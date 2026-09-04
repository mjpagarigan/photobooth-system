import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ANNIVERSARY_FRAME_NAME,
  ANNIVERSARY_FRAME_SLOTS,
  DEFAULT_FRAME_SLOTS,
  FrameService,
  LEGACY_MINISTRY_FAIR_FRAME_SHA256,
  MAT_FRAME_SLOTS,
  MAT_FRAME_NAME,
  MINISTRY_FRAMES,
  SUPPORTED_FRAME_ASPECT,
} from '../../src/main/frame/frame-service.js';
import type { ImageProcessor } from '../../src/main/image/image-worker-client.js';
import { createTestStore } from './helpers.js';

const UNUSED_PACKAGED_FRAMES = { option1: 'unused-1.png', option2: 'unused-2.png' };
const PACKAGED_FRAMES = {
  option1: fileURLToPath(new URL('../../resources/frames/mat-frame.png', import.meta.url)),
  option2: fileURLToPath(new URL('../../resources/frames/anniv-frame.png', import.meta.url)),
};

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

  it('soft-archives referenced frames, deletes unreferenced frames, and guards the last active frame', async () => {
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
      const extra = await service.importFrame('Extra', Buffer.from('png3'));

      const sessionId = randomUUID();
      store.repository.createSession(sessionId, 1_000);
      store.database.raw
        .prepare("UPDATE sessions SET state = 'final', selected_frame_id = ? WHERE id = ?")
        .run(used.id, sessionId);

      // Deleting a referenced frame soft-archives it, excluding it from active lists
      const afterArchive = service.deleteFrame(used.id);
      expect(afterArchive.map((frame) => frame.id)).not.toContain(used.id);
      expect(service.listFrames().map((frame) => frame.id)).not.toContain(used.id);
      const archivedFrame = store.repository.getFrame(used.id);
      expect(archivedFrame).not.toBeNull();
      expect(archivedFrame?.archived).toBe(true);

      // Deleting an unreferenced frame deletes the row and file
      const remaining = service.deleteFrame(disposable.id);
      expect(remaining.map((frame) => frame.id)).toEqual([extra.id]);
      expect(store.repository.getFrame(disposable.id)).toBeNull();

      // Attempting to delete the last active frame must be rejected
      expect(() => service.deleteFrame(extra.id)).toThrow(/Cannot delete the only remaining active frame/i);
      expect(store.repository.getFrame(extra.id)).not.toBeNull();
    } finally {
      store.close();
    }
  });

  it('permits identical artwork as separate entries without deduplication on ensureDefaultFrames', async () => {
    const store = createTestStore();
    const service = new FrameService(
      store.repository,
      store.vault,
      PACKAGED_FRAMES,
      fakeProcessor(1_200, 3_600),
    );
    try {
      const first = await service.importFrame('Custom Strip 1', Buffer.from('identical-png'));
      const second = await service.importFrame('Custom Strip 2', Buffer.from('identical-png'));

      expect(first.sha256).toBe(second.sha256);
      expect(first.id).not.toBe(second.id);
      expect(service.listFrames()).toHaveLength(2);

      // ensureDefaultFrames should NOT deduplicate them
      await service.ensureDefaultFrames();
      const frames = service.listFrames();
      expect(frames.map((f) => f.id)).toContain(first.id);
      expect(frames.map((f) => f.id)).toContain(second.id);
    } finally {
      store.close();
    }
  });

  it('replaces frame artwork while preserving ID, sortOrder, name, and slots', async () => {
    const store = createTestStore();
    const service = new FrameService(
      store.repository,
      store.vault,
      UNUSED_PACKAGED_FRAMES,
      passthroughProcessor(),
    );
    try {
      const initial = await service.importFrame('Custom Frame', Buffer.from('png-v1'));
      expect(initial.revision).toBe(0);

      const replaced = await service.replaceFrameArtwork(initial.id, Buffer.from('png-v2'));
      expect(replaced.id).toBe(initial.id);
      expect(replaced.name).toBe(initial.name);
      expect(replaced.sortOrder).toBe(initial.sortOrder);
      expect(replaced.slots).toEqual(initial.slots);
      expect(replaced.revision).toBe(1);
      expect(replaced.sha256).not.toBe(initial.sha256);
    } finally {
      store.close();
    }
  });

  it('never resurrects archived frames in ensureDefaultFrames or ensureMinistryFrames', async () => {
    const store = createTestStore();
    const service = new FrameService(
      store.repository,
      store.vault,
      PACKAGED_FRAMES,
      fakeProcessor(1_200, 3_600),
    );
    try {
      const defaults = await service.ensureDefaultFrames();
      const option2Id = defaults.option2.id;

      // Add a session reference so option2 is archived rather than deleted
      const sId = randomUUID();
      store.repository.createSession(sId, 1_000);
      store.database.raw
        .prepare("UPDATE sessions SET state = 'final', selected_frame_id = ? WHERE id = ?")
        .run(option2Id, sId);

      // Archive option2
      service.deleteFrame(option2Id);
      expect(service.listFrames().map((f) => f.id)).not.toContain(option2Id);
      expect(store.repository.getFrame(option2Id)?.archived).toBe(true);

      // Running ensureDefaultFrames must not resurrect option2
      await service.ensureDefaultFrames();
      expect(service.listFrames().map((f) => f.id)).not.toContain(option2Id);
      expect(service.listFrames().find((f) => f.name === defaults.option2.name)).toBeUndefined();

      // Running ensureMinistryFrames must not resurrect an archived ministry frame
      const importedMinistry = await service.importFrame('NextGen Ministry', Buffer.from('nextgen-png'));
      const sId2 = randomUUID();
      store.repository.createSession(sId2, 1_000);
      store.database.raw
        .prepare("UPDATE sessions SET state = 'final', selected_frame_id = ? WHERE id = ?")
        .run(importedMinistry.id, sId2);
      service.deleteFrame(importedMinistry.id);
      expect(service.listFrames().map((f) => f.id)).not.toContain(importedMinistry.id);

      await service.ensureMinistryFrames();
      expect(service.listFrames().map((f) => f.id)).not.toContain(importedMinistry.id);
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
      const stored1 = store.vault.write('frames', Buffer.from('legacy-art-1'));
      const stored2 = store.vault.write('frames', Buffer.from('legacy-art-2'));
      const now = Date.now();
      const legacy1 = {
        id: randomUUID(),
        name: 'CCF Alabang Celebration Strip',
        encryptedPath: stored1.relativePath,
        width: 1200,
        height: 3600,
        byteSize: stored1.byteSize,
        sha256: LEGACY_MINISTRY_FAIR_FRAME_SHA256,
        revision: 0,
        sortOrder: 1,
        archived: false,
        createdAt: now,
        updatedAt: now,
      };
      const legacy2 = {
        id: randomUUID(),
        name: 'CCF Alabang Celebration Strip (Collage 2)',
        encryptedPath: stored2.relativePath,
        width: 1200,
        height: 3600,
        byteSize: stored2.byteSize,
        sha256: LEGACY_MINISTRY_FAIR_FRAME_SHA256,
        revision: 0,
        sortOrder: 2,
        archived: false,
        createdAt: now,
        updatedAt: now,
      };
      store.repository.insertLibraryFrame(legacy1, DEFAULT_FRAME_SLOTS);
      store.repository.insertLibraryFrame(legacy2, DEFAULT_FRAME_SLOTS);

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
        'CCF Alabang Celebration Strip',
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
    const processor = passthroughProcessor();
    const service = new FrameService(store.repository, store.vault, PACKAGED_FRAMES, processor);
    try {
      const legacyBytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAADCAYAAABS3WWCAAAAEElEQVR42mNk+M9QzwAEGAAe/wP553Zf2wAAAABJRU5ErkJggg==',
        'base64',
      );
      const legacy = await service.importFrame(
        'CCF Alabang Celebration Strip',
        legacyBytes,
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

  it('upgrades prior shipped ministry artwork while preserving edited slot geometry', async () => {
    const store = createTestStore();
    const service = new FrameService(
      store.repository,
      store.vault,
      PACKAGED_FRAMES,
      passthroughProcessor(),
    );
    try {
      const ministry = MINISTRY_FRAMES[0]!;
      const previous = await service.importFrame(
        ministry.name,
        Buffer.from('previous shipped ministry artwork'),
        ministry.slots,
      );
      const editedSlots = previous.slots.map((slot, index) =>
        index === 0 ? { ...slot, x: slot.x + 0.005 } : slot,
      );
      const edited = service.updateLayout(previous.id, previous.name, editedSlots, previous.revision);
      const previousArtworkHash = edited.sha256;

      await service.ensureMinistryFrames();

      const upgraded = store.repository.getFrame(edited.id);
      const packagedBytes = readFileSync(
        fileURLToPath(new URL(`../../resources/frames/${ministry.file}`, import.meta.url)),
      );
      expect(upgraded?.id).toBe(edited.id);
      expect(upgraded?.sha256).toBe(createHash('sha256').update(packagedBytes).digest('hex'));
      expect(upgraded?.sha256).not.toBe(previousArtworkHash);
      expect(upgraded?.slots).toEqual(editedSlots);
      expect(upgraded?.revision).toBeGreaterThan(edited.revision);
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
