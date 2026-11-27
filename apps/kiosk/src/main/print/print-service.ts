import { EventEmitter } from 'node:events';
import { copyFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import {
  isPrintableFrameSize,
  type PrinterCapabilities,
  type PrinterHealth,
  type PrinterStatusKind,
  type PrinterSummary,
  type PrintJobSummary,
  type SessionPrintStatus,
} from '@grace-booth/shared';

import type { LocalRepository } from '../database/repositories.js';
import {
  printJobSummary,
  type PrintRepository,
  type StoredPrinterSettings,
  type StoredPrintJob,
} from '../database/print-repository.js';
import { AppError, toSafeError } from '../errors.js';
import type { AppPaths } from '../storage/paths.js';
import type { PhotoVault } from '../storage/photo-vault.js';
import { choose4rPaper, printDpi } from './print-layout.js';
import {
  renderCalibrationPage,
  renderColorTestPage,
  renderPhotoPage,
  type PrintRenderOptions,
} from './print-renderer.js';
import { PrintNotSubmittedError, type PrinterAdapter } from './printer-adapter.js';
import {
  deriveSessionPrintStatus,
  printerBlockerFromHealth,
  type SessionPrintChangeEvent,
  type SessionPrintDeriveOptions,
} from './session-print-status.js';

const TICK_MS = 3_000;
const NOT_SUBMITTED_BACKOFF_MS = 30_000;
const UNCERTAIN_MESSAGE =
  'The printer did not confirm this copy. Check the output tray, then choose Print again or It printed.';

export type PrintServiceOptions = {
  now?: () => number;
  tickMs?: number;
};

export type WorkflowPrintPort = {
  requestSessionPrint(sessionId: string, copies: number): unknown;
  attachSessionPhoto(sessionId: string, assetId: string): void;
  discardWaitingSessionPrint(sessionId: string): void;
  getSessionPrintStatus(
    sessionId: string,
    options?: SessionPrintDeriveOptions,
  ): SessionPrintStatus | null;
  subscribeSessionChanges(listener: (event: SessionPrintChangeEvent) => void): () => void;
};

type JobProblem = { status: PrinterStatusKind; message: string } | null;

/**
 * The print queue. Copies go to the spooler one at a time, so a printer that stops mid-request
 * leaves every remaining copy visible and cancellable in Grace Booth instead of inside Windows.
 */
export class PrintService extends EventEmitter implements WorkflowPrintPort {
  private readonly now: () => number;
  private readonly tickMs: number;
  private timer: NodeJS.Timeout | null = null;
  private startPromise: Promise<void> | null = null;
  private activeTick: Promise<void> | null = null;
  private running = false;
  private wakeRequested = false;
  private stopped = true;
  private capabilitiesCache: { printerName: string; value: PrinterCapabilities } | null = null;
  private notSubmittedUntil = 0;
  private lastSubmitError: string | null = null;
  private health: PrinterHealth;

  constructor(
    private readonly prints: PrintRepository,
    private readonly repository: LocalRepository,
    private readonly vault: PhotoVault,
    private readonly paths: AppPaths,
    private readonly adapter: PrinterAdapter,
    options: PrintServiceOptions = {},
  ) {
    super();
    this.now = options.now ?? Date.now;
    this.tickMs = options.tickMs ?? TICK_MS;
    this.health = {
      status: 'unknown',
      printerName: null,
      message: 'Checking the printer.',
      queuedCount: 0,
      attentionCount: 0,
      checkedAt: this.now(),
    };
  }

  get adapterKind(): PrinterAdapter['kind'] {
    return this.adapter.kind;
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.stopped = false;
    const run = (async () => {
      this.clearStaging();
      await this.recover();
      if (this.stopped) return;
      await this.tick();
    })().finally(() => {
      if (this.startPromise === run) this.startPromise = null;
    });
    this.startPromise = run;
    return run;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.startPromise;
    await this.activeTick;
    await this.adapter.close();
  }

  /** Runs a queue pass soon (after a new request, a cancel or a settings change). */
  wake(): void {
    if (this.stopped) return;
    if (this.running) {
      this.wakeRequested = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), 0);
  }

  getHealth(): PrinterHealth {
    return this.health;
  }

  private isRunning(): boolean {
    return !this.stopped;
  }

  /** One queue pass, awaited. Used by tests and the native self-test. */
  async runQueuePass(): Promise<void> {
    if (this.activeTick) await this.activeTick;
    await this.tick();
  }

  listJobs(): PrintJobSummary[] {
    return this.prints.listJobsForOperator().map(printJobSummary);
  }

  getSessionPrintStatus(
    sessionId: string,
    options?: SessionPrintDeriveOptions,
  ): SessionPrintStatus | null {
    return deriveSessionPrintStatus(
      this.prints.listJobsForSession(sessionId),
      printerBlockerFromHealth(this.health),
      options,
    );
  }

  subscribeSessionChanges(listener: (event: SessionPrintChangeEvent) => void): () => void {
    this.on('session-change', listener);
    return () => {
      this.off('session-change', listener);
    };
  }

  // ---- requests ----------------------------------------------------------------------------

  /** Called when the operator accepts a 4R session with printing on. */
  requestSessionPrint(sessionId: string, copies: number): PrintJobSummary[] {
    const jobs = this.prints.createRequest(
      { kind: 'session', sessionId, sourceAssetId: null, copies },
      this.now(),
    );
    this.refreshHealth();
    this.emitSessionChange(sessionId);
    return jobs.map(printJobSummary);
  }

  /** Called once the finished photo for a session exists. */
  attachSessionPhoto(sessionId: string, assetId: string): void {
    if (this.prints.attachSessionPhoto(sessionId, assetId, this.now()) > 0) {
      this.emitSessionChange(sessionId);
      this.wake();
    }
  }

  discardWaitingSessionPrint(sessionId: string): void {
    if (this.prints.discardWaitingForSession(sessionId) > 0) {
      this.refreshHealth();
      this.emitSessionChange(sessionId);
    }
  }

  reprint(sessionId: string, copies: number): PrintJobSummary[] {
    const session = this.repository.requireSession(sessionId);
    const asset = session.collageAssetId ? this.repository.getAsset(session.collageAssetId) : null;
    if (asset?.cleanupState !== 'active') {
      throw new AppError('print_source_missing', 'That photo is no longer stored on this booth.');
    }
    if (!isPrintableFrameSize(asset.width, asset.height)) {
      throw new AppError(
        'print_frame_unsupported',
        'Only photos made with a landscape 4R frame can be printed.',
      );
    }
    const jobs = this.prints.createRequest(
      { kind: 'reprint', sessionId, sourceAssetId: asset.id, copies },
      this.now(),
    );
    this.emitSessionChange(sessionId);
    this.wake();
    return jobs.map(printJobSummary);
  }

  printTestPage(kind: 'calibration' | 'color_test'): PrintJobSummary {
    if (!this.prints.getPrinterSettings().printerName) {
      throw new AppError('printer_unconfigured', 'Choose a printer first.');
    }
    const [job] = this.prints.createRequest(
      { kind, sessionId: null, sourceAssetId: null, copies: 1 },
      this.now(),
    );
    if (!job) throw new AppError('print_job_missing', 'The test page could not be queued.');
    this.wake();
    return printJobSummary(job);
  }

  async cancel(jobId: string): Promise<PrintJobSummary> {
    const job = this.prints.requireJob(jobId);
    if (job.state === 'spooled' && job.printerName) {
      // Remove it from Windows first; if that fails the copy keeps printing and stays visible.
      await this.adapter.cancel(job.printerName, job.documentKey);
    }
    const cancelled = this.prints.cancel(jobId, this.now());
    this.refreshHealth();
    this.emitSessionChange(cancelled.sessionId);
    this.wake();
    return printJobSummary(cancelled);
  }

  resolve(jobId: string, resolution: 'print_again' | 'printed'): PrintJobSummary {
    const job = this.prints.resolve(jobId, resolution, this.now());
    this.refreshHealth();
    this.emitSessionChange(job.sessionId);
    this.wake();
    return printJobSummary(job);
  }

  // ---- settings ----------------------------------------------------------------------------

  listPrinters(): Promise<PrinterSummary[]> {
    return this.adapter.listPrinters();
  }

  getSettings(): StoredPrinterSettings {
    return this.prints.getPrinterSettings();
  }

  async getCapabilities(printerName: string, refresh = false): Promise<PrinterCapabilities> {
    if (!refresh && this.capabilitiesCache?.printerName === printerName) {
      return this.capabilitiesCache.value;
    }
    const value = await this.adapter.getCapabilities(printerName);
    this.capabilitiesCache = { printerName, value };
    return value;
  }

  async saveSettings(input: {
    printerName: string | null;
    paperRawKind: number | null;
    paperName: string | null;
    timeoutSeconds: number;
    expectedRevision: number;
  }): Promise<StoredPrinterSettings> {
    let { paperRawKind, paperName } = input;
    if (input.printerName) {
      const capabilities = await this.getCapabilities(input.printerName, true);
      const chosen =
        capabilities.paperCandidates.find((paper) => paper.rawKind === paperRawKind) ??
        choose4rPaper(capabilities.paperCandidates);
      if (!chosen) {
        throw new AppError(
          'printer_paper_unsupported',
          'This printer does not list a 4 x 6 in (4R) paper size.',
        );
      }
      paperRawKind = chosen.rawKind;
      paperName = chosen.name;
    } else {
      paperRawKind = null;
      paperName = null;
    }
    const saved = this.prints.updatePrinterSettings(
      { ...input, paperRawKind, paperName },
      this.now(),
    );
    this.notSubmittedUntil = 0;
    this.lastSubmitError = null;
    this.wake();
    return saved;
  }

  setIccProfile(sourcePath: string | null): StoredPrinterSettings {
    const previous = this.prints.getPrinterSettings().iccProfilePath;
    if (sourcePath === null) {
      const saved = this.prints.setIccProfile(null, null, this.now());
      if (previous) rmSync(previous, { force: true });
      return saved;
    }
    const extension = extname(sourcePath).toLowerCase();
    if (extension !== '.icc' && extension !== '.icm') {
      throw new AppError('icc_profile_invalid', 'Choose an .icc or .icm color profile.');
    }
    const target = join(this.paths.printProfiles, `printer-profile-${this.now()}${extension}`);
    copyFileSync(sourcePath, target);
    const saved = this.prints.setIccProfile(target, basename(sourcePath), this.now());
    if (previous && previous !== target) rmSync(previous, { force: true });
    return saved;
  }

  // ---- queue -------------------------------------------------------------------------------

  /** After a crash or power loss: settle every copy that was handed to Windows. */
  private async recover(): Promise<void> {
    for (const sessionId of this.prints.listWaitingSessionIds()) {
      const session = this.repository.getSession(sessionId);
      if (
        session?.collageAssetId &&
        this.prints.attachSessionPhoto(sessionId, session.collageAssetId, this.now()) > 0
      ) {
        this.emitSessionChange(sessionId);
      }
    }
    for (const job of this.prints.listJobsInState(['submitting'])) {
      const probe = await this.probe(job);
      if (probe?.found) this.prints.markSpooled(job.id, probe.spoolerJobId, this.now());
      else
        this.prints.markNeedsAttention(
          job.id,
          'print_submit_uncertain',
          UNCERTAIN_MESSAGE,
          this.now(),
        );
      this.emitSessionChange(job.sessionId);
    }
  }

  private tick(): Promise<void> {
    if (this.stopped || this.running) return this.activeTick ?? Promise.resolve();
    const run = this.runTick();
    this.activeTick = run;
    return run;
  }

  private async runTick(): Promise<void> {
    this.running = true;
    this.timer = null;
    try {
      const settings = this.prints.getPrinterSettings();
      const problem = await this.followSpooledJobs(settings);
      if (!this.isRunning()) return;
      const queueStatus = await this.queueStatus(settings);
      if (!this.isRunning()) return;
      const status = problem ?? queueStatus;
      if (
        settings.printerName &&
        (status.status === 'ready' || status.status === 'printing') &&
        this.prints.listJobsInState(['spooled', 'submitting']).length === 0 &&
        this.now() >= this.notSubmittedUntil
      ) {
        const next = this.prints.nextQueuedJob();
        if (next) await this.submit(next, settings);
      }
      if (!this.isRunning()) return;
      this.setHealth(settings, problem ?? (await this.queueStatus(settings)));
    } catch (error) {
      if (!this.isRunning()) return;
      this.setHealth(this.prints.getPrinterSettings(), {
        status: 'unknown',
        message: toSafeError(error).safeMessage,
      });
    } finally {
      this.running = false;
      this.activeTick = null;
      if (this.isRunning()) {
        const delay = this.wakeRequested ? 0 : this.tickMs;
        this.wakeRequested = false;
        this.timer = setTimeout(() => void this.tick(), delay);
        this.timer.unref();
      }
    }
  }

  /** Marks finished copies printed and reports a printer problem seen on a waiting copy. */
  private async followSpooledJobs(settings: StoredPrinterSettings): Promise<JobProblem> {
    let problem: JobProblem = null;
    for (const job of this.prints.listJobsInState(['spooled'])) {
      const probe = await this.probe(job);
      if (probe === null) continue;
      if (!probe.found || probe.printed) {
        this.prints.markPrinted(job.id, this.now());
        this.emitSessionChange(job.sessionId);
        continue;
      }
      if (probe.problem) {
        problem = {
          status: probe.problem,
          message:
            probe.problem === 'paper_out'
              ? 'Printer is out of paper. The copy will print when paper is loaded.'
              : probe.problem === 'offline'
                ? 'Printer is offline. The copy will print when it is back.'
                : 'Printer needs attention. Check the printer.',
        };
      } else if (
        job.submittedAt !== null &&
        this.now() - job.submittedAt > settings.timeoutSeconds * 1_000
      ) {
        // Some drivers never report paper-out; a copy that will not finish means trouble.
        problem = {
          status: 'error',
          message: 'A copy is taking longer than expected. Check paper, ink and the printer.',
        };
      }
    }
    return problem;
  }

  private async submit(job: StoredPrintJob, settings: StoredPrinterSettings): Promise<void> {
    const printerName = settings.printerName;
    if (!printerName) return;
    let page: Buffer;
    try {
      page = await this.renderJob(job, settings, printerName);
    } catch (error) {
      const safe = toSafeError(error);
      this.prints.markFailed(job.id, safe.code, safe.safeMessage, this.now());
      this.emitSessionChange(job.sessionId);
      return;
    }
    const imagePath = join(this.paths.printStaging, `${job.documentKey}.png`);
    writeFileSync(imagePath, page, { mode: 0o600 });
    try {
      const submitting = this.prints.beginSubmit(
        job.id,
        { printerName, paperRawKind: settings.paperRawKind, paperName: settings.paperName },
        this.now(),
      );
      this.emitSessionChange(submitting.sessionId);
      try {
        const result = await this.adapter.submit({
          printerName,
          paperRawKind: settings.paperRawKind,
          paperName: settings.paperName,
          documentKey: submitting.documentKey,
          imagePath,
        });
        this.prints.markSpooled(job.id, result.spoolerJobId, this.now());
        this.emitSessionChange(job.sessionId);
        this.lastSubmitError = null;
      } catch (error) {
        if (error instanceof PrintNotSubmittedError) {
          this.prints.returnToQueue(job.id, error.code, error.message, this.now());
          this.emitSessionChange(job.sessionId);
          this.notSubmittedUntil = this.now() + NOT_SUBMITTED_BACKOFF_MS;
          this.lastSubmitError = error.message;
          return;
        }
        const probe = await this.probe(submitting);
        if (probe?.found) this.prints.markSpooled(job.id, probe.spoolerJobId, this.now());
        else {
          this.prints.markNeedsAttention(
            job.id,
            'print_submit_uncertain',
            UNCERTAIN_MESSAGE,
            this.now(),
          );
        }
        this.emitSessionChange(job.sessionId);
      }
    } finally {
      rmSync(imagePath, { force: true });
    }
  }

  private async renderJob(
    job: StoredPrintJob,
    settings: StoredPrinterSettings,
    printerName: string,
  ): Promise<Buffer> {
    const capabilities = await this.getCapabilities(printerName);
    const options: PrintRenderOptions = {
      margins: capabilities.margins,
      dpi: printDpi(capabilities.dpi),
      iccProfilePath: settings.iccProfilePath,
    };
    if (job.kind === 'calibration') return (await renderCalibrationPage(options)).png;
    if (job.kind === 'color_test') return (await renderColorTestPage(options)).png;
    const asset = job.sourceAssetId ? this.repository.getAsset(job.sourceAssetId) : null;
    if (asset?.cleanupState !== 'active') {
      throw new AppError('print_source_missing', 'The photo for this copy is no longer stored.');
    }
    return (await renderPhotoPage(this.vault.read(asset.encryptedPath), options)).png;
  }

  private async probe(
    job: StoredPrintJob,
  ): Promise<Awaited<ReturnType<PrinterAdapter['findJob']>> | null> {
    if (!job.printerName) return { found: false };
    try {
      return await this.adapter.findJob(job.printerName, job.documentKey);
    } catch {
      return null;
    }
  }

  private async queueStatus(
    settings: StoredPrinterSettings,
  ): Promise<{ status: PrinterStatusKind; message: string }> {
    if (!settings.printerName) {
      return { status: 'unconfigured', message: 'No printer is set up. Choose one in Settings.' };
    }
    try {
      const status = await this.adapter.getStatus(settings.printerName);
      if (this.lastSubmitError && (status.status === 'ready' || status.status === 'printing')) {
        return { status: 'error', message: this.lastSubmitError };
      }
      return status;
    } catch (error) {
      return { status: 'unknown', message: toSafeError(error).safeMessage };
    }
  }

  private refreshHealth(): void {
    const counts = this.prints.countOpen();
    this.publish({ ...this.health, queuedCount: counts.queued, attentionCount: counts.attention });
  }

  private setHealth(
    settings: StoredPrinterSettings,
    status: { status: PrinterStatusKind; message: string },
  ): void {
    const counts = this.prints.countOpen();
    this.publish({
      status: status.status,
      printerName: settings.printerName,
      message: status.message.slice(0, 300),
      queuedCount: counts.queued,
      attentionCount: counts.attention,
      checkedAt: this.now(),
    });
  }

  private publish(next: PrinterHealth): void {
    const healthDetailsChanged =
      next.status !== this.health.status ||
      next.printerName !== this.health.printerName ||
      next.message !== this.health.message;
    const changed =
      healthDetailsChanged ||
      next.queuedCount !== this.health.queuedCount ||
      next.attentionCount !== this.health.attentionCount;
    this.health = next;
    if (changed) this.emit('health', next);
    if (healthDetailsChanged) {
      this.emit('session-change', { scope: 'health' } satisfies SessionPrintChangeEvent);
    }
  }

  private emitSessionChange(sessionId: string | null): void {
    if (sessionId) {
      this.emit('session-change', {
        scope: 'session',
        sessionId,
      } satisfies SessionPrintChangeEvent);
    }
  }

  private clearStaging(): void {
    for (const name of readdirSync(this.paths.printStaging)) {
      rmSync(join(this.paths.printStaging, name), { force: true });
    }
  }
}
