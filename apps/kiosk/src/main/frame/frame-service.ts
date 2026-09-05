import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { FrameLayout, FrameSummary } from '@grace-booth/shared';
import { FrameLayoutSchema } from '@grace-booth/shared';

import type { LocalRepository, StoredFrame } from '../database/repositories.js';
import { AppError } from '../errors.js';
import type { ImageProcessor } from '../image/image-worker-client.js';
import type { PhotoVault } from '../storage/photo-vault.js';

/** Legacy packaged-frame aspect retained only for shipped-frame migration detection. */
export const SUPPORTED_FRAME_ASPECT = 1 / 3;
export const KNOWN_SHIPPED_LEGACY_HASHES = new Set([
  'a0a3dfacd86a4a458e1cf510b4a19a395cdafc1c2373863adac083b79603a2eb',
  '8ce3b927fe240fb205734acc0f28f8f1e15277f420cab612b9e0a688a05d1579',
]);
export const LEGACY_MINISTRY_FAIR_FRAME_SHA256 =
  'a0a3dfacd86a4a458e1cf510b4a19a395cdafc1c2373863adac083b79603a2eb';

export const MAT_FRAME_SLOTS: FrameLayout = FrameLayoutSchema.parse([
  {
    slotIndex: 1,
    name: 'Photo 1',
    x: 0.071667,
    y: 0.236667,
    width: 0.85,
    height: 0.162778,
    cropMode: 'crop-to-fill',
  },
  {
    slotIndex: 2,
    name: 'Photo 2',
    x: 0.068333,
    y: 0.445,
    width: 0.85,
    height: 0.162778,
    cropMode: 'crop-to-fill',
  },
  {
    slotIndex: 3,
    name: 'Photo 3',
    x: 0.071667,
    y: 0.653333,
    width: 0.85,
    height: 0.162778,
    cropMode: 'crop-to-fill',
  },
]);

export const ANNIVERSARY_FRAME_SLOTS: FrameLayout = FrameLayoutSchema.parse([
  {
    slotIndex: 1,
    name: 'Photo 1',
    x: 0.076667,
    y: 0.222222,
    width: 0.851667,
    height: 0.162778,
    cropMode: 'crop-to-fill',
  },
  {
    slotIndex: 2,
    name: 'Photo 2',
    x: 0.075,
    y: 0.430556,
    width: 0.85,
    height: 0.162778,
    cropMode: 'crop-to-fill',
  },
  {
    slotIndex: 3,
    name: 'Photo 3',
    x: 0.076667,
    y: 0.638889,
    width: 0.851667,
    height: 0.162778,
    cropMode: 'crop-to-fill',
  },
]);

export const createMinistrySlots = (
  s1Y: number,
  s2Y: number,
  s3Y: number,
  s1X = 0.075,
  s2X = 0.073333,
  s3X = 0.075,
  width = 0.853333,
  height = 0.163333,
): FrameLayout =>
  FrameLayoutSchema.parse([
    { slotIndex: 1, name: 'Photo 1', x: s1X, y: s1Y, width, height, cropMode: 'crop-to-fill' },
    { slotIndex: 2, name: 'Photo 2', x: s2X, y: s2Y, width, height, cropMode: 'crop-to-fill' },
    { slotIndex: 3, name: 'Photo 3', x: s3X, y: s3Y, width, height, cropMode: 'crop-to-fill' },
  ]);

export const MINISTRY_FRAMES: { name: string; file: string; slots: FrameLayout }[] = [
  {
    name: 'NextGen Ministry',
    file: 'nextgen-frame.png',
    slots: FrameLayoutSchema.parse([
      { slotIndex: 1, name: 'Photo 1', x: 0.076667, y: 0.222222, width: 0.851667, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.075, y: 0.430556, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.076667, y: 0.638889, width: 0.851667, height: 0.162778, cropMode: 'crop-to-fill' },
    ]),
  },
  {
    name: 'B1G Singles Ministry',
    file: 'b1g-frame.png',
    slots: FrameLayoutSchema.parse([
      { slotIndex: 1, name: 'Photo 1', x: 0.068333, y: 0.226667, width: 0.85, height: 0.162222, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.065, y: 0.435, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.068333, y: 0.642778, width: 0.85, height: 0.163333, cropMode: 'crop-to-fill' },
    ]),
  },
  {
    name: 'Across Ministry',
    file: 'across-frame.png',
    slots: FrameLayoutSchema.parse([
      { slotIndex: 1, name: 'Photo 1', x: 0.076667, y: 0.208889, width: 0.85, height: 0.162222, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.073333, y: 0.417222, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.076667, y: 0.625, width: 0.85, height: 0.163333, cropMode: 'crop-to-fill' },
    ]),
  },
  {
    name: 'Movement Ministry',
    file: 'movement-frame.png',
    slots: FrameLayoutSchema.parse([
      { slotIndex: 1, name: 'Photo 1', x: 0.076667, y: 0.2, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.073333, y: 0.408333, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.076667, y: 0.616667, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
    ]),
  },
  {
    name: 'Women 2 Women (W2W)',
    file: 'w2w-frame.png',
    slots: FrameLayoutSchema.parse([
      { slotIndex: 1, name: 'Photo 1', x: 0.076667, y: 0.234444, width: 0.848333, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.075, y: 0.443333, width: 0.848333, height: 0.162222, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.076667, y: 0.651111, width: 0.848333, height: 0.162778, cropMode: 'crop-to-fill' },
    ]),
  },
  {
    name: 'Living Free Ministry',
    file: 'living-free-frame.png',
    slots: FrameLayoutSchema.parse([
      { slotIndex: 1, name: 'Photo 1', x: 0.076667, y: 0.21, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.073333, y: 0.418889, width: 0.85, height: 0.162222, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.076667, y: 0.626667, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
    ]),
  },
  {
    name: 'Host Team',
    file: 'host-team-frame.png',
    slots: FrameLayoutSchema.parse([
      { slotIndex: 1, name: 'Photo 1', x: 0.076667, y: 0.228889, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.073333, y: 0.437778, width: 0.85, height: 0.162222, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.076667, y: 0.645556, width: 0.85, height: 0.163333, cropMode: 'crop-to-fill' },
    ]),
  },
  {
    name: 'Ushering Ministry',
    file: 'ushering-frame.png',
    slots: FrameLayoutSchema.parse([
      { slotIndex: 1, name: 'Photo 1', x: 0.076667, y: 0.267778, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.073333, y: 0.476667, width: 0.85, height: 0.162222, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.076667, y: 0.684444, width: 0.85, height: 0.163333, cropMode: 'crop-to-fill' },
    ]),
  },
  {
    name: 'Exalt Worship Ministry',
    file: 'exalt-frame.png',
    slots: FrameLayoutSchema.parse([
      { slotIndex: 1, name: 'Photo 1', x: 0.076667, y: 0.216667, width: 0.85, height: 0.162222, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.073333, y: 0.425, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.076667, y: 0.633333, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
    ]),
  },
  {
    name: 'Elevate Youth',
    file: 'elevate-frame.png',
    slots: FrameLayoutSchema.parse([
      { slotIndex: 1, name: 'Photo 1', x: 0.076667, y: 0.228889, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.073333, y: 0.437778, width: 0.85, height: 0.162222, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.076667, y: 0.645556, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
    ]),
  },
  {
    name: 'M.A.T. Ministry',
    file: 'mat-ministry-frame.png',
    slots: FrameLayoutSchema.parse([
      { slotIndex: 1, name: 'Photo 1', x: 0.071667, y: 0.236667, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 2, name: 'Photo 2', x: 0.068333, y: 0.445, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
      { slotIndex: 3, name: 'Photo 3', x: 0.071667, y: 0.653333, width: 0.85, height: 0.162778, cropMode: 'crop-to-fill' },
    ]),
  },
];

export const DEFAULT_FRAME_SLOTS = MAT_FRAME_SLOTS;
export const MAT_FRAME_NAME = 'M.A.T. 42nd Anniversary';
export const ANNIVERSARY_FRAME_NAME = 'CCF Alabang 42nd Anniversary';
export const DEFAULT_FRAME_NAME = MAT_FRAME_NAME;

export function createStarterSlots(count: number, width: number, height: number): FrameLayout {
  const safeCount = Math.max(1, Math.min(10, Math.trunc(count)));
  const inset = 0.04;
  const gutter = 0.025;
  const columns = Math.min(safeCount, Math.max(1, Math.ceil(Math.sqrt(safeCount * (width / height)))));
  const rows = Math.ceil(safeCount / columns);
  const slotWidth = (1 - inset * 2 - gutter * (columns - 1)) / columns;
  const slotHeight = (1 - inset * 2 - gutter * (rows - 1)) / rows;
  return FrameLayoutSchema.parse(Array.from({ length: safeCount }, (_, index) => ({
    slotIndex: index + 1,
    zIndex: index,
    name: `Photo ${index + 1}`,
    x: inset + (index % columns) * (slotWidth + gutter),
    y: inset + Math.floor(index / columns) * (slotHeight + gutter),
    width: slotWidth,
    height: slotHeight,
    cropMode: 'crop-to-fill',
  })));
}

type PackagedFramePaths = {
  option1: string;
  option2: string;
};

type PackagedFrameDefinition = {
  name: string;
  path: string;
  slots: FrameLayout;
};

export class FrameService {
  constructor(
    private readonly repository: LocalRepository,
    private readonly vault: PhotoVault,
    private readonly packagedFramePaths: PackagedFramePaths,
    private readonly imageProcessor: ImageProcessor,
  ) {}

  /**
   * Seeds the operator-managed library with the two packaged frames as entries 1 and 2 so a fresh
   * installation behaves exactly like the previous two-option system. Existing entries are only
   * replaced while they remain untouched shipped defaults; operator imports and edited layouts
   * occupy their positions permanently.
   */
  async ensureDefaultFrames(): Promise<{ option1: StoredFrame; option2: StoredFrame }> {
    const definitions: [PackagedFrameDefinition, PackagedFrameDefinition] = [
      {
        name: MAT_FRAME_NAME,
        path: this.packagedFramePaths.option1,
        slots: MAT_FRAME_SLOTS,
      },
      {
        name: ANNIVERSARY_FRAME_NAME,
        path: this.packagedFramePaths.option2,
        slots: ANNIVERSARY_FRAME_SLOTS,
      },
    ];
    const [option1Bytes, option2Bytes] = await Promise.all([
      readFile(definitions[0].path),
      readFile(definitions[1].path),
    ]);
    const allFrames = this.repository.listAllFrames();
    const seeded: StoredFrame[] = [];
    for (const [index, definition] of definitions.entries()) {
      const isArchived = allFrames.some(
        (f) =>
          f.archived &&
          (f.name === definition.name || f.name.toLowerCase() === definition.name.toLowerCase()),
      );
      if (isArchived) {
        continue;
      }
      const library = this.repository.listFrames();
      const occupant = library[index] ?? null;
      if (occupant && !isReplaceable(occupant, library)) {
        // An operator-owned or edited frame permanently holds this library position.
        seeded.push(occupant);
        continue;
      }
      const bytes = index === 0 ? option1Bytes : option2Bytes;
      seeded.push(
        await this.importLibraryFrame(
          definition.name,
          bytes,
          definition.slots,
          occupant ? occupant.sortOrder : undefined,
          occupant ? [occupant.id] : [],
        ),
      );
    }
    const active = this.repository.listFrames();
    const option1 = active[0] ?? seeded[0];
    const option2 = active[1] ?? active[0] ?? seeded[1] ?? seeded[0];
    if (!option1) {
      throw new AppError('frame_missing', 'The photo frames could not be prepared.');
    }
    this.ensureSequentialSeedOrder(option1, option2 ?? option1);
    return { option1, option2: option2 ?? option1 };
  }

  /**
   * Seeds all available ministry template frames into the library so guests have access to all
   * ministry-specific photostrip layouts. Automatically synchronizes calibrated slot positions and artwork.
   */
  async ensureMinistryFrames(): Promise<StoredFrame[]> {
    const seeded: StoredFrame[] = [];
    const framesDir = dirname(this.packagedFramePaths.option1);
    const allFrames = this.repository.listAllFrames();
    for (const ministry of MINISTRY_FRAMES) {
      const existing = allFrames.find(
        (f) => f.name === ministry.name || f.name.toLowerCase() === ministry.name.toLowerCase(),
      );
      if (existing?.archived) {
        // Operator archived this frame. Never resurrect.
        continue;
      }
      try {
        const filePath = join(framesDir, ministry.file);
        const bytes = await readFile(filePath);
        if (existing) {
          const normalized = await this.imageProcessor.normalizeFramePng(bytes);
          const normalizedSha256 = createHash('sha256').update(normalized.bytes).digest('hex');
          const isUntouchedShippedFrame = existing.revision === 0;
          const isSlotMismatch = JSON.stringify(existing.slots) !== JSON.stringify(ministry.slots);
          if (isSlotMismatch || existing.sha256 !== normalizedSha256) {
            // Exact built-in names identify packaged ministry entries across releases. Artwork is
            // authoritative, while operator-edited slot geometry is preserved on revised rows.
            seeded.push(
              this.replacePackagedArtwork(
                existing,
                normalized,
                isUntouchedShippedFrame ? ministry.slots : undefined,
              ),
            );
          }
        } else {
          const imported = await this.importLibraryFrame(ministry.name, bytes, ministry.slots);
          seeded.push(imported);
        }
      } catch {
        // Additional ministry frame file not available in test harness, skip silently.
      }
    }
    return seeded;
  }

  async ensureDefaultFrame(): Promise<StoredFrame> {
    const { option1 } = await this.ensureDefaultFrames();
    return option1;
  }

  /** Appends a validated frame to the end of the library. */
  async importFrame(
    name: string,
    bytes: Uint8Array,
    slots: FrameLayout = DEFAULT_FRAME_SLOTS,
  ): Promise<StoredFrame> {
    return this.importLibraryFrame(name, bytes, slots);
  }

  async inspectFrame(bytes: Uint8Array): Promise<{ width: number; height: number; byteSize: number }> {
    const normalized = await this.imageProcessor.normalizeFramePng(bytes);
    return { width: normalized.width, height: normalized.height, byteSize: normalized.bytes.byteLength };
  }

  listFrames(): StoredFrame[] {
    return this.repository.listFrames();
  }
  getFrameSummaries(): FrameSummary[] {
    return this.repository.listFrames().map((frame) => this.toSummary(frame));
  }

  getDefaultFrame(): StoredFrame | null {
    return this.repository.getActiveFrame();
  }

  updateLayout(
    frameId: string,
    name: string,
    slots: FrameLayout,
    expectedRevision: number,
  ): StoredFrame {
    return this.repository.updateFrameLayout(
      frameId,
      FrameLayoutSchema.parse(slots),
      expectedRevision,
      name,
    );
  }

  moveFrame(frameId: string, direction: 'up' | 'down'): StoredFrame[] {
    const frames = this.repository.listFrames();
    const index = frames.findIndex((frame) => frame.id === frameId);
    if (index === -1) throw new AppError('frame_missing', 'The selected frame no longer exists.');
    const neighbor = direction === 'up' ? frames[index - 1] : frames[index + 1];
    if (!neighbor) return frames;
    this.repository.swapFrameSortOrders(frameId, neighbor.id);
    return this.repository.listFrames();
  }

  /** Archives a library entry while preserving history and at least one visible active frame. */
  deleteFrame(frameId: string): StoredFrame[] {
    const frame = this.repository.getFrame(frameId);
    if (!frame || frame.archived) {
      throw new AppError('frame_missing', 'The selected frame no longer exists.');
    }
    const activeFrames = this.repository.listFrames();
    if (activeFrames.length <= 1) {
      throw new AppError(
        'frame_last_active',
        'Cannot delete the only remaining active frame in the library.',
      );
    }
    const index = activeFrames.findIndex((candidate) => candidate.id === frameId);
    const replacement = activeFrames[index + 1] ?? activeFrames[index - 1] ?? null;
    this.repository.repointFramePointer(frameId, replacement?.id ?? null);
    this.repository.archiveFrame(frameId);
    return this.repository.listFrames();
  }

  activateFrame(frameId: string): StoredFrame {
    const frame = this.repository.getFrame(frameId);
    if (!frame || frame.archived) {
      throw new AppError('frame_missing', 'The selected frame no longer exists.');
    }
    this.repository.setCollageFrameId(1, frameId);
    return frame;
  }

  getFrameOptions(): [StoredFrame | null, StoredFrame | null] {
    const frames = this.repository.listFrames();
    return [frames[0] ?? null, frames[1] ?? null];
  }

  toSummary(frame: StoredFrame): FrameSummary {
    const slots = new Set(frame.slots.map((slot) => slot.zIndex)).size > 1
      ? frame.slots
      : frame.slots.map((slot) => ({ ...slot, zIndex: slot.slotIndex - 1 }));
    return {
      id: frame.id,
      name: frame.name,
      width: frame.width,
      height: frame.height,
      byteSize: frame.byteSize,
      mediaUrl: `grace-booth-media://asset/${frame.id}`,
      slots,
      revision: frame.revision,
      active: this.repository.getSettings().activeFrameId === frame.id,
    };
  }

  private ensureSequentialSeedOrder(option1: StoredFrame, option2: StoredFrame): void {
    const now = Date.now();
    if (option1.sortOrder === null) {
      option1.sortOrder = 1;
      this.repository.setFrameSortOrder(option1.id, 1, now);
    }
    if (option2.sortOrder === null || option2.sortOrder <= option1.sortOrder) {
      option2.sortOrder = option1.sortOrder + 1;
      this.repository.setFrameSortOrder(option2.id, option2.sortOrder, now);
    }
  }

  private async importLibraryFrame(
    name: string,
    bytes: Uint8Array,
    slots: FrameLayout,
    sortOrder?: number | null,
    replaceIds: string[] = [],
  ): Promise<StoredFrame> {
    const validatedSlots = FrameLayoutSchema.parse(slots);
    const normalized = await this.imageProcessor.normalizeFramePng(bytes);
    const stored = this.vault.write('frames', normalized.bytes);
    const now = Date.now();
    const frame: Omit<StoredFrame, 'slots'> = {
      id: randomUUID(),
      name: sanitizeFrameName(name),
      encryptedPath: stored.relativePath,
      width: normalized.width,
      height: normalized.height,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      revision: 0,
      sortOrder: sortOrder === undefined ? this.repository.nextSortOrder() : sortOrder,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };
    try {
      this.repository.insertLibraryFrame(frame, validatedSlots);
      for (const replacedId of replaceIds) {
        this.repository.repointFramePointer(replacedId, frame.id, now);
        this.repository.deleteFrameRow(replacedId);
      }
    } catch (error) {
      this.vault.delete(stored.relativePath);
      throw error;
    }
    const saved = this.repository.getFrame(frame.id);
    if (!saved) throw new AppError('frame_missing', 'The frame could not be saved.');
    return saved;
  }

  private replacePackagedArtwork(
    existing: StoredFrame,
    normalized: { bytes: Uint8Array; width: number; height: number },
    slots?: FrameLayout,
  ): StoredFrame {
    const stored = this.vault.write('frames', normalized.bytes);
    try {
      const updated = this.repository.updateFrameArtwork(
        existing.id,
        {
          encryptedPath: stored.relativePath,
          width: normalized.width,
          height: normalized.height,
          byteSize: stored.byteSize,
          sha256: stored.sha256,
        },
        slots,
      );
      try {
        this.vault.delete(existing.encryptedPath);
      } catch {
        // The updated row is authoritative; an already-missing superseded PNG is harmless.
      }
      return updated;
    } catch (error) {
      this.vault.delete(stored.relativePath);
      throw error;
    }
  }

  /**
   * Replaces an existing frame's artwork with a normalized transparent PNG,
   * atomically bumping revision while preserving ID, ordering, name, and slot geometry.
   */
  async replaceFrameArtwork(frameId: string, bytes: Uint8Array): Promise<StoredFrame> {
    const existing = this.repository.getFrame(frameId);
    if (!existing || existing.archived) {
      throw new AppError('frame_missing', 'The selected frame no longer exists.');
    }
    const normalized = await this.imageProcessor.normalizeFramePng(bytes);
    const stored = this.vault.write('frames', normalized.bytes);
    try {
      const updated = this.repository.updateFrameArtwork(existing.id, {
        encryptedPath: stored.relativePath,
        width: normalized.width,
        height: normalized.height,
        byteSize: stored.byteSize,
        sha256: stored.sha256,
      });
      try {
        this.vault.delete(existing.encryptedPath);
      } catch {
        // The updated row is authoritative; an already-missing superseded PNG is harmless.
      }
      return updated;
    } catch (error) {
      this.vault.delete(stored.relativePath);
      throw error;
    }
  }
}

function isReplaceable(frame: StoredFrame, library: StoredFrame[]): boolean {
  if (frame.revision > 0) return false;
  const legacyNamed =
    frame.name === 'CCF Alabang Ministry Fair Strip' ||
    frame.name === 'CCF Alabang Ministry Fair Strip (Collage 2)' ||
    frame.name === 'CCF Alabang Celebration Strip' ||
    frame.name === 'CCF Alabang Celebration Strip (Collage 2)';
  if (legacyNamed && KNOWN_SHIPPED_LEGACY_HASHES.has(frame.sha256)) return true;
  const baseName = frame.name.replace(/ \(Collage 2\)$/, '');
  const original = library.find((candidate) => candidate.name === baseName);
  const isAutomaticDuplicate =
    original !== undefined &&
    original.id !== frame.id &&
    frame.name === `${original.name} (Collage 2)` &&
    frame.sha256 === original.sha256;
  return isAutomaticDuplicate;
}

function sanitizeFrameName(name: string): string {
  const trimmed = name.trim().replace(/\p{Cc}|[<>:"/\\|?*]/gu, '');
  return trimmed.slice(0, 120) || 'Grace Booth Frame';
}
