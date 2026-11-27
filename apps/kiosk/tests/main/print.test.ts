import { randomUUID } from 'node:crypto';

import { isPrintableFrameSize, type PaperCandidate } from '@grace-booth/shared';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import { PrintRepository } from '../../src/main/database/print-repository.js';
import {
  MOCK_PRINTER_NAME,
  MockPrinterAdapter,
} from '../../src/main/print/mock-printer-adapter.js';
import { choose4rPaper, placeOn4rLandscape, printDpi } from '../../src/main/print/print-layout.js';
import {
  renderCalibrationPage,
  renderColorTestPage,
  renderPhotoPage,
} from '../../src/main/print/print-renderer.js';
import { PrintService } from '../../src/main/print/print-service.js';
import type { SessionPrintChangeEvent } from '../../src/main/print/session-print-status.js';
import { createTestStore, type TestStore } from './helpers.js';

// Driver data read from this machine's printers on 2026-11-13 (see docs/PRINTING_DESIGN.md).
const L3210_MARGINS = { left: 13.333, top: 11.944, right: 13.333, bottom: 19.445 };
const L110_MARGINS = { left: 11.667, top: 11.667, right: 11.667, bottom: 11.667 };

describe('4R paper matching', () => {
  const sizes = (entries: [number, string, number, number][]): PaperCandidate[] =>
    entries.map(([rawKind, name, widthHundredths, heightHundredths]) => ({
      rawKind,
      name,
      widthHundredths,
      heightHundredths,
    }));

  it('finds 4 x 6 in by physical size across driver naming', () => {
    expect(
      choose4rPaper(
        sizes([
          [9, 'A4', 827, 1169],
          [127, '102 x 152 mm (4 x 6 in)', 400, 600],
        ]),
      )?.rawKind,
    ).toBe(127);
    expect(choose4rPaper(sizes([[285, '10 x 15 cm (4 x 6 in)', 400, 600]]))?.rawKind).toBe(285);
    expect(choose4rPaper(sizes([[183, 'North America 4x 6', 600, 400]]))?.rawKind).toBe(183);
  });

  it('prefers a bordered size and rejects near-misses', () => {
    const paper = choose4rPaper(
      sizes([
        [300, '4 x 6 in (Borderless)', 400, 600],
        [301, '4 x 6 in', 400, 600],
      ]),
    );
    expect(paper?.rawKind).toBe(301);
    expect(choose4rPaper(sizes([[129, 'Postcard 100 x 148 mm', 393, 583]]))).toBeNull();
  });

  it('uses the driver resolution, falling back to 300 DPI', () => {
    expect(printDpi(360)).toBe(360);
    expect(printDpi(null)).toBe(300);
    expect(printDpi(-4)).toBe(300);
    expect(printDpi(1_440)).toBe(600);
  });
});

describe('decision A layout: whole photo, centered, never cropped', () => {
  it('fits a 3:2 photo inside the L3210 asymmetric margin with centered borders', () => {
    const placement = placeOn4rLandscape({ width: 3_600, height: 2_400 }, L3210_MARGINS, 300);
    expect(placement.pageWidth).toBe(1_800);
    expect(placement.pageHeight).toBe(1_200);
    // Whole photo kept: aspect preserved within one pixel of rounding.
    expect(Math.abs(placement.width / placement.height - 1.5)).toBeLessThan(0.002);
    // Every edge clears the largest margin on its axis.
    const insetX = Math.ceil(0.19445 * 300);
    const insetY = Math.ceil(0.13333 * 300);
    expect(placement.left).toBeGreaterThanOrEqual(insetX);
    expect(placement.pageWidth - placement.left - placement.width).toBeGreaterThanOrEqual(insetX);
    expect(placement.top).toBeGreaterThanOrEqual(insetY);
    expect(placement.pageHeight - placement.top - placement.height).toBeGreaterThanOrEqual(insetY);
    // Centered on both axes.
    expect(
      Math.abs(placement.left - (placement.pageWidth - placement.left - placement.width)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(placement.top - (placement.pageHeight - placement.top - placement.height)),
    ).toBeLessThanOrEqual(1);
    // Side borders are the wider ones (the trade-off chosen with decision A).
    expect(placement.left).toBeGreaterThan(placement.top);
  });

  it('handles symmetric margins and drivers that report none', () => {
    const l110 = placeOn4rLandscape({ width: 1_800, height: 1_200 }, L110_MARGINS, 360);
    expect(l110.pageWidth).toBe(2_160);
    expect(l110.top).toBeGreaterThanOrEqual(Math.ceil(0.11667 * 360));
    const none = placeOn4rLandscape({ width: 1_800, height: 1_200 }, null, 300);
    expect(none).toMatchObject({ left: 0, top: 0, width: 1_800, height: 1_200 });
  });
});

describe('print page rendering', () => {
  it('renders a white 6 x 4 in landscape page with the photo inside the printable area', async () => {
    const photo = await sharp({
      create: { width: 3_600, height: 2_400, channels: 3, background: { r: 200, g: 20, b: 20 } },
    })
      .jpeg()
      .toBuffer();
    const page = await renderPhotoPage(photo, {
      margins: L3210_MARGINS,
      dpi: 300,
      iccProfilePath: null,
    });
    const meta = await sharp(page.png).metadata();
    expect(meta).toMatchObject({ width: 1_800, height: 1_200, format: 'png' });
    const { data, info } = await sharp(page.png).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number): number[] => {
      const offset = (y * info.width + x) * info.channels;
      return [data[offset]!, data[offset + 1]!, data[offset + 2]!];
    };
    expect(pixel(2, 2)).toEqual([255, 255, 255]);
    const center = pixel(900, 600);
    expect(center[0]).toBeGreaterThan(150);
    expect(center[1]).toBeLessThan(80);
  });

  it('renders the calibration and color test pages at page size', async () => {
    for (const render of [renderCalibrationPage, renderColorTestPage]) {
      const page = await render({ margins: L110_MARGINS, dpi: 300, iccProfilePath: null });
      expect(await sharp(page.png).metadata()).toMatchObject({ width: 1_800, height: 1_200 });
    }
  });

  it('classifies only landscape 3:2 Frames as printable', () => {
    expect(isPrintableFrameSize(3_600, 2_400)).toBe(true);
    expect(isPrintableFrameSize(1_800, 1_200)).toBe(true);
    expect(isPrintableFrameSize(1_200, 3_600)).toBe(false);
    expect(isPrintableFrameSize(2_400, 3_600)).toBe(false);
    expect(isPrintableFrameSize(1_920, 1_080)).toBe(false);
  });
});

type Harness = {
  store: TestStore;
  prints: PrintRepository;
  printer: MockPrinterAdapter;
  service: PrintService;
  sessionId: string;
  assetId: string;
};

let harness: Harness | null = null;
afterEach(async () => {
  await harness?.service.stop();
  harness?.store.close();
  harness = null;
});

async function createHarness(
  options: { photo?: { width: number; height: number }; printDurationMs?: number } = {},
): Promise<Harness> {
  const store = createTestStore();
  const prints = new PrintRepository(store.database);
  const printer = new MockPrinterAdapter({
    outputDirectory: null,
    printDurationMs: options.printDurationMs ?? 1,
  });
  const settings = prints.getPrinterSettings();
  prints.updatePrinterSettings({
    printerName: MOCK_PRINTER_NAME,
    paperRawKind: 127,
    paperName: '102 x 152 mm (4 x 6 in)',
    timeoutSeconds: 240,
    expectedRevision: settings.revision,
  });
  const size = options.photo ?? { width: 1_800, height: 1_200 };
  const jpeg = await sharp({
    create: { ...size, channels: 3, background: { r: 30, g: 90, b: 160 } },
  })
    .jpeg()
    .toBuffer();
  const sessionId = randomUUID();
  store.repository.createSession(sessionId, 1_000);
  const stored = store.vault.write('completed', jpeg);
  const assetId = randomUUID();
  store.database.raw
    .prepare(
      `INSERT INTO session_assets
        (id, session_id, kind, retake_round, shot_number, encrypted_path, content_type, width, height, byte_size, sha256, created_at)
      VALUES (?, ?, 'collage', 0, NULL, ?, 'image/jpeg', ?, ?, ?, ?, 1)`,
    )
    .run(
      assetId,
      sessionId,
      stored.relativePath,
      size.width,
      size.height,
      stored.byteSize,
      stored.sha256,
    );
  store.database.raw
    .prepare('UPDATE sessions SET collage_asset_id = ? WHERE id = ?')
    .run(assetId, sessionId);
  const service = new PrintService(prints, store.repository, store.vault, store.paths, printer, {
    tickMs: 1_000_000,
  });
  harness = { store, prints, printer, service, sessionId, assetId };
  return harness;
}

const settle = (ms = 25): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('print queue', () => {
  it('waits for the finished photo, then prints each copy exactly once in order', async () => {
    const { service, prints, printer, sessionId, assetId } = await createHarness();
    await service.start();
    const jobs = service.requestSessionPrint(sessionId, 3);
    expect(jobs.map((job) => job.state)).toEqual([
      'waiting_for_photo',
      'waiting_for_photo',
      'waiting_for_photo',
    ]);
    await service.runQueuePass();
    expect(printer.printed).toHaveLength(0);

    service.attachSessionPhoto(sessionId, assetId);
    for (let pass = 0; pass < 8; pass += 1) {
      await service.runQueuePass();
      await settle(5);
    }
    const states = jobs.map((job) => prints.requireJob(job.id).state);
    expect(states).toEqual(['printed', 'printed', 'printed']);
    expect(printer.printed).toEqual(jobs.map((job) => `GraceBooth-${job.id}`));
    expect(new Set(printer.printed).size).toBe(3);
  });

  it('holds copies while the printer is offline and prints them once it is back', async () => {
    const { service, prints, printer, sessionId } = await createHarness();
    printer.setStatus('offline');
    await service.start();
    const [job] = service.reprint(sessionId, 1);
    await service.runQueuePass();
    expect(prints.requireJob(job!.id).state).toBe('queued');
    expect(service.getHealth()).toMatchObject({ status: 'offline', queuedCount: 1 });

    printer.setStatus('ready');
    await service.runQueuePass();
    await settle();
    await service.runQueuePass();
    expect(prints.requireJob(job!.id).state).toBe('printed');
    expect(printer.printed).toEqual([`GraceBooth-${job!.id}`]);
    expect(service.getHealth()).toMatchObject({ status: 'ready', queuedCount: 0 });
  });

  it('reports paper-out from a waiting copy and finishes it after paper is loaded', async () => {
    const { service, prints, printer, sessionId } = await createHarness();
    await service.start();
    const [job] = service.reprint(sessionId, 1);
    printer.setStatus('paper_out');
    // Spool it while the queue still believes the printer is ready.
    printer.setStatus('ready');
    await service.runQueuePass();
    printer.setStatus('paper_out');
    await service.runQueuePass();
    expect(prints.requireJob(job!.id).state).toBe('spooled');
    expect(service.getHealth().status).toBe('paper_out');
    printer.setStatus('ready');
    await settle();
    await service.runQueuePass();
    expect(prints.requireJob(job!.id).state).toBe('printed');
  });

  it('lets the operator cancel a backlog before the printer returns', async () => {
    const { service, prints, printer, sessionId } = await createHarness();
    printer.setStatus('offline');
    await service.start();
    const jobs = service.reprint(sessionId, 2);
    await service.cancel(jobs[0]!.id);
    printer.setStatus('ready');
    for (let pass = 0; pass < 4; pass += 1) {
      await service.runQueuePass();
      await settle(5);
    }
    expect(prints.requireJob(jobs[0]!.id).state).toBe('cancelled');
    expect(prints.requireJob(jobs[1]!.id).state).toBe('printed');
    expect(printer.printed).toEqual([`GraceBooth-${jobs[1]!.id}`]);
  });

  it('cancels a copy already handed to Windows by removing it from the spooler', async () => {
    const { service, prints, printer, sessionId } = await createHarness();
    await service.start();
    const [job] = service.reprint(sessionId, 1);
    await service.runQueuePass();
    printer.setStatus('offline');
    expect(prints.requireJob(job!.id).state).toBe('spooled');
    await service.cancel(job!.id);
    expect(printer.pendingDocumentKeys()).toEqual([]);
    printer.setStatus('ready');
    await settle();
    expect(printer.printed).toEqual([]);
  });

  it('re-queues a copy the spooler provably never received', async () => {
    const { service, prints, printer, sessionId } = await createHarness();
    await service.start();
    const [job] = service.reprint(sessionId, 1);
    printer.failNext('not_submitted');
    await service.runQueuePass();
    expect(prints.requireJob(job!.id)).toMatchObject({
      state: 'queued',
      lastErrorCode: 'printer_missing',
    });
    expect(service.getHealth().status).toBe('error');
    expect(printer.printed).toEqual([]);
  });

  it('adopts a copy the spooler accepted even when the submit call failed', async () => {
    const { service, prints, printer, sessionId } = await createHarness();
    await service.start();
    const [job] = service.reprint(sessionId, 1);
    printer.setStatus('ready');
    printer.failNext('unknown');
    // Keep it in the spooler long enough to be found.
    const slow = printer as unknown as { options: { printDurationMs: number } };
    slow.options.printDurationMs = 10_000;
    await service.runQueuePass();
    expect(prints.requireJob(job!.id).state).toBe('spooled');
  });

  it('asks the operator after a crash mid-submit instead of risking a second print', async () => {
    const { service, prints, sessionId, store } = await createHarness();
    const [job] = prints.createRequest({
      kind: 'reprint',
      sessionId,
      sourceAssetId: harness!.assetId,
      copies: 1,
    });
    prints.beginSubmit(job!.id, {
      printerName: MOCK_PRINTER_NAME,
      paperRawKind: 127,
      paperName: null,
    });
    // Restart: the mock spooler has no record of it.
    await service.start();
    const settled = prints.requireJob(job!.id);
    expect(settled).toMatchObject({
      state: 'needs_attention',
      lastErrorCode: 'print_submit_uncertain',
    });
    expect(service.getHealth().attentionCount).toBe(1);

    expect(service.resolve(job!.id, 'printed').state).toBe('printed');
    expect(
      store.database.raw
        .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE operation = 'print_resolve'")
        .get(),
    ).toEqual({ n: 1 });
  });

  it('treats a spooled copy that left the Windows queue as printed after restart', async () => {
    const { service, prints, sessionId } = await createHarness();
    const [job] = prints.createRequest({
      kind: 'reprint',
      sessionId,
      sourceAssetId: harness!.assetId,
      copies: 1,
    });
    prints.beginSubmit(job!.id, {
      printerName: MOCK_PRINTER_NAME,
      paperRawKind: 127,
      paperName: null,
    });
    prints.markSpooled(job!.id, 7);
    await service.start();
    expect(prints.requireJob(job!.id).state).toBe('printed');
  });

  it('re-attaches waiting session copies whose photo was saved just before a crash', async () => {
    const { service, prints, sessionId } = await createHarness();
    const [job] = prints.createRequest({
      kind: 'session',
      sessionId,
      sourceAssetId: null,
      copies: 1,
    });
    await service.start();
    expect(['queued', 'spooled', 'printed']).toContain(prints.requireJob(job!.id).state);
  });

  it('refuses to reprint a 1:3 photo', async () => {
    const { service, sessionId } = await createHarness({ photo: { width: 1_200, height: 3_600 } });
    expect(() => service.reprint(sessionId, 1)).toThrow(/landscape 4R/);
  });

  it('keeps sessions with unprinted copies out of retention cleanup', async () => {
    const { store, prints, sessionId } = await createHarness();
    store.database.raw
      .prepare('UPDATE sessions SET retention_anchor_at = 1 WHERE id = ?')
      .run(sessionId);
    prints.createRequest({
      kind: 'reprint',
      sessionId,
      sourceAssetId: harness!.assetId,
      copies: 1,
    });
    expect(store.repository.sessionsOlderThan(10).map((session) => session.id)).not.toContain(
      sessionId,
    );
    const [job] = prints.listJobsInState(['queued']);
    prints.cancel(job!.id);
    expect(store.repository.sessionsOlderThan(10).map((session) => session.id)).toContain(
      sessionId,
    );
  });

  it('flags a copy that never finishes as a printer problem without reprinting it', async () => {
    const { service, prints, printer, sessionId } = await createHarness();
    let clock = 10_000;
    const timed = new PrintService(
      prints,
      harness!.store.repository,
      harness!.store.vault,
      harness!.store.paths,
      printer,
      {
        tickMs: 1_000_000,
        now: () => clock,
      },
    );
    await service.stop();
    harness!.service = timed;
    const slow = printer as unknown as { options: { printDurationMs: number } };
    slow.options.printDurationMs = 60_000;
    await timed.start();
    const [job] = timed.reprint(sessionId, 1);
    await timed.runQueuePass();
    expect(prints.requireJob(job!.id).state).toBe('spooled');
    clock += 241_000;
    await timed.runQueuePass();
    expect(timed.getHealth()).toMatchObject({ status: 'error' });
    expect(timed.getHealth().message).toMatch(/longer than expected/);
    expect(prints.requireJob(job!.id).state).toBe('spooled');
  });

  it('lists every job for a session without truncation and discards only waiting session rows', async () => {
    const { prints, sessionId, assetId } = await createHarness();
    const otherSessionId = randomUUID();
    harness!.store.repository.createSession(otherSessionId, 1_000);

    const sessionJobs = prints.createRequest({
      kind: 'session',
      sessionId,
      sourceAssetId: null,
      copies: 2,
    });
    const reprintJobs = prints.createRequest({
      kind: 'reprint',
      sessionId,
      sourceAssetId: assetId,
      copies: 1,
    });
    for (let index = 0; index < 35; index += 1) {
      const [other] = prints.createRequest({
        kind: 'reprint',
        sessionId: otherSessionId,
        sourceAssetId: assetId,
        copies: 1,
      });
      prints.cancel(other!.id);
    }

    expect(prints.listJobsForSession(sessionId).map((job) => job.id)).toEqual([
      ...sessionJobs.map((job) => job.id),
      ...reprintJobs.map((job) => job.id),
    ]);

    expect(prints.discardWaitingForSession(sessionId)).toBe(2);
    expect(prints.discardWaitingForSession(sessionId)).toBe(0);
    expect(prints.listJobsForSession(sessionId).map((job) => job.id)).toEqual(
      reprintJobs.map((job) => job.id),
    );
  });

  it('emits session-change events and tracks live session print status through pauses, completion, and reprints', async () => {
    const { service, printer, sessionId, assetId } = await createHarness({ printDurationMs: 40 });
    await service.start();

    const events: SessionPrintChangeEvent[] = [];
    const unsubscribe = service.subscribeSessionChanges((event) => events.push(event));

    expect(service.getSessionPrintStatus(sessionId)).toBeNull();

    service.requestSessionPrint(sessionId, 2);
    expect(service.getSessionPrintStatus(sessionId)).toEqual({
      phase: 'preparing',
      origin: 'session',
      pendingCopies: 2,
      totalCopies: 2,
    });
    expect(events).toContainEqual({ scope: 'session', sessionId });

    printer.setStatus('offline');
    await service.runQueuePass();
    expect(events).toContainEqual({ scope: 'health' });

    service.attachSessionPhoto(sessionId, assetId);
    expect(service.getSessionPrintStatus(sessionId)).toMatchObject({
      phase: 'paused',
      origin: 'session',
      reason: 'offline',
      printedCopies: 0,
      remainingCopies: 2,
      totalCopies: 2,
    });

    printer.setStatus('ready');
    await service.runQueuePass();
    expect(service.getSessionPrintStatus(sessionId)).toEqual({
      phase: 'printing',
      origin: 'session',
      stage: 'active',
      printedCopies: 0,
      remainingCopies: 2,
      totalCopies: 2,
    });

    for (let pass = 0; pass < 6; pass += 1) {
      await settle(50);
      await service.runQueuePass();
      if (service.getSessionPrintStatus(sessionId)?.phase === 'completed') break;
    }
    expect(service.getSessionPrintStatus(sessionId)).toMatchObject({
      phase: 'completed',
      origin: 'session',
      totalCopies: 2,
    });

    service.reprint(sessionId, 1);
    expect(service.getSessionPrintStatus(sessionId)).toEqual({
      phase: 'printing',
      origin: 'reprint',
      stage: 'queued',
      printedCopies: 0,
      remainingCopies: 1,
      totalCopies: 1,
    });

    for (let pass = 0; pass < 4; pass += 1) {
      await settle(50);
      await service.runQueuePass();
      if (service.getSessionPrintStatus(sessionId)?.phase === 'completed') break;
    }
    expect(service.getSessionPrintStatus(sessionId)).toMatchObject({
      phase: 'completed',
      origin: 'reprint',
      totalCopies: 1,
    });

    unsubscribe();
  });
});
