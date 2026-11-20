import {
  PRINTER_HEALTH_EVENT,
  type IpcChannel,
  type IpcRequest,
  type PrinterHealth,
  type PrinterSettings,
} from '@grace-booth/shared';
import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron';

import type { StoredPrinterSettings } from '../database/print-repository.js';
import { AppError } from '../errors.js';
import type { PrintService } from '../print/print-service.js';

type Register = <C extends IpcChannel>(
  channel: C,
  handler: (event: IpcMainInvokeEvent, input: IpcRequest<C>) => unknown,
) => void;

/**
 * Print queue actions are operator actions on the booth itself (no passcode), like Recent
 * photos. Printer configuration needs the admin passcode, like the rest of Settings.
 */
export function registerPrintHandlers(
  register: Register,
  requireAdmin: (event: IpcMainInvokeEvent) => void,
  print: PrintService | undefined,
): () => void {
  const service = (): PrintService => {
    if (!print) throw new AppError('print_unavailable', 'Printing is not available on this booth.');
    return print;
  };

  register('print:get-health', () => print?.getHealth() ?? unavailableHealth());
  register('print:list-jobs', () => service().listJobs());
  register('print:cancel-job', (_event, input) => service().cancel(input.jobId));
  register('print:resolve-job', (_event, input) =>
    service().resolve(input.jobId, input.resolution),
  );
  register('print:reprint', (_event, input) => service().reprint(input.sessionId, input.copies));

  register('admin:printer:list', (event) => {
    requireAdmin(event);
    return service().listPrinters();
  });
  register('admin:printer:get-settings', async (event) => {
    requireAdmin(event);
    const settings = service().getSettings();
    let capabilities = null;
    if (settings.printerName) {
      try {
        capabilities = await service().getCapabilities(settings.printerName, true);
      } catch {
        // The printer may be unplugged or removed; Settings still opens.
      }
    }
    return { settings: publicSettings(settings, print?.adapterKind), capabilities };
  });
  register('admin:printer:get-capabilities', (event, input) => {
    requireAdmin(event);
    return service().getCapabilities(input.printerName, true);
  });
  register('admin:printer:save-settings', async (event, input) => {
    requireAdmin(event);
    return publicSettings(await service().saveSettings(input), print?.adapterKind);
  });
  register('admin:printer:choose-icc-profile', async (event) => {
    requireAdmin(event);
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Choose the printer color profile',
      properties: ['openFile' as const],
      filters: [{ name: 'ICC color profile', extensions: ['icc', 'icm'] }],
    };
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options);
    const path = result.canceled ? undefined : result.filePaths[0];
    if (!path) return publicSettings(service().getSettings(), print?.adapterKind);
    return publicSettings(service().setIccProfile(path), print?.adapterKind);
  });
  register('admin:printer:clear-icc-profile', (event) => {
    requireAdmin(event);
    return publicSettings(service().setIccProfile(null), print?.adapterKind);
  });
  register('admin:printer:print-test-page', (event, input) => {
    requireAdmin(event);
    return service().printTestPage(input.kind);
  });

  const broadcast = (health: PrinterHealth): void => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(PRINTER_HEALTH_EVENT, health);
    }
  };
  print?.on('health', broadcast);
  return () => {
    print?.off('health', broadcast);
  };
}

function publicSettings(
  settings: StoredPrinterSettings,
  adapter: PrinterSettings['adapter'] | undefined,
): PrinterSettings {
  return {
    adapter: adapter ?? settings.adapter,
    printerName: settings.printerName,
    paperRawKind: settings.paperRawKind,
    paperName: settings.paperName,
    timeoutSeconds: settings.timeoutSeconds,
    iccProfileName: settings.iccProfileName,
    revision: settings.revision,
  };
}

function unavailableHealth(): PrinterHealth {
  return {
    status: 'unconfigured',
    printerName: null,
    message: 'Printing is not available on this booth.',
    queuedCount: 0,
    attentionCount: 0,
    checkedAt: Date.now(),
  };
}
