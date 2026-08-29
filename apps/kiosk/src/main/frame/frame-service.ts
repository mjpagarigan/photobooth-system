import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { FrameLayout, FrameSummary } from '@grace-booth/shared';
import { FrameLayoutSchema } from '@grace-booth/shared';

import type { LocalRepository, StoredFrame } from '../database/repositories.js';
import { AppError } from '../errors.js';
import type { ImageProcessor } from '../image/image-worker-client.js';
import { hasExactProductionStripAspect } from '../image/strip-export-config.js';
import type { PhotoVault } from '../storage/photo-vault.js';

/** 1:3 Vertical photobooth strip aspect of the CCF Alabang Ministry Fair frame (1200 x 3600 pixels). */
export const SUPPORTED_FRAME_ASPECT = 1 / 3;
const LEGACY_MINISTRY_FAIR_FRAME_SHA256 =
  'a0a3dfacd86a4a458e1cf510b4a19a395cdafc1c2373863adac083b79603a2eb';

/**
 * Normalized photo slots calibrated against the transparent camera LCD cutouts in the default 3-strip frame.
 */
export const MAT_FRAME_SLOTS: FrameLayout = FrameLayoutSchema.parse([
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
]);

export const ANNIVERSARY_FRAME_SLOTS: FrameLayout = FrameLayoutSchema.parse([
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
]);

export const MINISTRY_FRAMES: Array<{ name: string; file: string; slots: FrameLayout }> = [
  { name: 'Across Ministry', file: 'across-frame.png', slots: ANNIVERSARY_FRAME_SLOTS },
  { name: 'B1G Singles Ministry', file: 'b1g-frame.png', slots: ANNIVERSARY_FRAME_SLOTS },
  { name: 'Elevate Youth', file: 'elevate-frame.png', slots: ANNIVERSARY_FRAME_SLOTS },
  { name: 'Exalt Worship Ministry', file: 'exalt-frame.png', slots: ANNIVERSARY_FRAME_SLOTS },
  { name: 'Host Team', file: 'host-team-frame.png', slots: ANNIVERSARY_FRAME_SLOTS },
  { name: 'Living Free Ministry', file: 'living-free-frame.png', slots: ANNIVERSARY_FRAME_SLOTS },
  { name: 'Movement Ministry', file: 'movement-frame.png', slots: ANNIVERSARY_FRAME_SLOTS },
  { name: 'NextGen Ministry', file: 'nextgen-frame.png', slots: ANNIVERSARY_FRAME_SLOTS },
  { name: 'Ushering Ministry', file: 'ushering-frame.png', slots: ANNIVERSARY_FRAME_SLOTS },
  { name: 'Women 2 Women (W2W)', file: 'w2w-frame.png', slots: ANNIVERSARY_FRAME_SLOTS },
];

export const DEFAULT_FRAME_SLOTS = MAT_FRAME_SLOTS;
export const MAT_FRAME_NAME = 'M.A.T. 42nd Anniversary';
export const ANNIVERSARY_FRAME_NAME = 'CCF Alabang 42nd Anniversary';
export const DEFAULT_FRAME_NAME = MAT_FRAME_NAME;

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
    // Deduplicate any duplicate frames with identical sha256
    const initialLibrary = this.repository.listFrames();
    const seenHashes = new Map<string, StoredFrame>();
    for (const frame of initialLibrary) {
      if (seenHashes.has(frame.sha256)) {
        const canonical = seenHashes.get(frame.sha256);
        if (!canonical) continue;
        this.repository.repointFramePointer(frame.id, canonical.id);
        this.repository.deleteFrameRow(frame.id);
        try {
          this.vault.delete(frame.encryptedPath);
        } catch {
          // The library row removal is authoritative; a missing PNG is not a deletion failure.
        }
      } else {
        seenHashes.set(frame.sha256, frame);
      }
    }

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
    const seeded: StoredFrame[] = [];
    for (const [index, definition] of definitions.entries()) {
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
    const [option1, option2] = seeded;
    if (!option1 || !option2) {
      throw new AppError('frame_missing', 'The photo frames could not be prepared.');
    }
    this.ensureSequentialSeedOrder(option1, option2);
    return { option1, option2 };
  }

  /**
   * Seeds all available ministry template frames into the library so guests have access to all
   * ministry-specific photostrip layouts.
   */
  async ensureMinistryFrames(): Promise<StoredFrame[]> {
    const seeded: StoredFrame[] = [];
    const framesDir = dirname(this.packagedFramePaths.option1);
    for (const ministry of MINISTRY_FRAMES) {
      const currentLibrary = this.repository.listFrames();
      const alreadyPresent = currentLibrary.some(
        (f) => f.name === ministry.name || f.name.toLowerCase() === ministry.name.toLowerCase(),
      );
      if (!alreadyPresent) {
        try {
          const filePath = join(framesDir, ministry.file);
          const bytes = await readFile(filePath);
          const imported = await this.importLibraryFrame(ministry.name, bytes, ministry.slots);
          seeded.push(imported);
        } catch {
          // Additional ministry frame file not available in test harness, skip silently.
        }
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

  /**
   * Deletes an unused library entry. Frames referenced by any recorded session are rejected so
   * archived collages can always be traced back to their artwork.
   */
  deleteFrame(frameId: string): StoredFrame[] {
    const frame = this.repository.getFrame(frameId);
    if (!frame) throw new AppError('frame_missing', 'The selected frame no longer exists.');
    const usage = this.repository.countSessionsReferencingFrame(frameId);
    if (usage > 0) {
      throw new AppError(
        'frame_in_use',
        'This frame is used by saved photo sessions and cannot be deleted.',
      );
    }
    const replacement = this.repository.listFrames().find((candidate) => candidate.id !== frameId);
    this.repository.repointFramePointer(frameId, replacement?.id ?? null);
    this.repository.deleteFrameRow(frameId);
    try {
      this.vault.delete(frame.encryptedPath);
    } catch {
      // The library row removal is authoritative; a missing PNG is not a deletion failure.
    }
    return this.repository.listFrames();
  }

  getFrameOptions(): [StoredFrame | null, StoredFrame | null] {
    const frames = this.repository.listFrames();
    return [frames[0] ?? null, frames[1] ?? null];
  }

  toSummary(frame: StoredFrame): FrameSummary {
    return {
      id: frame.id,
      name: frame.name,
      width: frame.width,
      height: frame.height,
      byteSize: frame.byteSize,
      mediaUrl: `grace-booth-media://asset/${frame.id}`,
      slots: frame.slots,
      revision: frame.revision,
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
    if (!hasExactProductionStripAspect(normalized.width, normalized.height)) {
      throw new AppError(
        'frame_aspect',
        'The frame must use an exact 1:3 vertical photobooth strip aspect.',
      );
    }
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
}

function isReplaceable(frame: StoredFrame, library: StoredFrame[]): boolean {
  if (frame.revision > 0) return false;
  const legacyNamed =
    frame.name === 'CCF Alabang Ministry Fair Strip' ||
    frame.name === 'CCF Alabang Ministry Fair Strip (Collage 2)';
  if (legacyNamed && frame.sha256 === LEGACY_MINISTRY_FAIR_FRAME_SHA256) return true;
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
