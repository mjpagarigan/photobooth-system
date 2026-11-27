import { CheckCircle, Printer, Trash, Warning } from '@grace-booth/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  GraceBoothBridge,
  PaperCandidate,
  PrinterCapabilities,
  PrinterSettings,
  PrinterSummary,
} from '@grace-booth/shared';
import { PAPER_4R_HUNDREDTHS } from '@grace-booth/shared';
import {
  Button,
  Field,
  FieldLabel,
  Form,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@grace-booth/ui';

function getBridge(): GraceBoothBridge | null {
  return window.graceBooth ?? null;
}

const NO_PRINTER = '__none__';
const TIMEOUT_CHOICES = [120, 240, 480, 900] as const;

function is4r(paper: PaperCandidate): boolean {
  const short = Math.min(paper.widthHundredths, paper.heightHundredths);
  const long = Math.max(paper.widthHundredths, paper.heightHundredths);
  return (
    Math.abs(short - PAPER_4R_HUNDREDTHS.shortEdge) <= 2 &&
    Math.abs(long - PAPER_4R_HUNDREDTHS.longEdge) <= 2
  );
}

function formatMargins(capabilities: PrinterCapabilities | null): string {
  const margins = capabilities?.margins;
  if (!margins) return 'Not reported by the driver';
  const mm = (hundredths: number) => ((hundredths / 100) * 25.4).toFixed(1);
  return `${mm(margins.left)} / ${mm(margins.top)} / ${mm(margins.right)} / ${mm(margins.bottom)} mm (L / T / R / B, portrait)`;
}

/** Settings > Printer: choose the printer and 4R paper, color profile, and test pages. */
export function PrinterSettingsCard() {
  const [settings, setSettings] = useState<PrinterSettings | null>(null);
  const [printers, setPrinters] = useState<PrinterSummary[]>([]);
  const [capabilities, setCapabilities] = useState<PrinterCapabilities | null>(null);
  const [printerName, setPrinterName] = useState<string>(NO_PRINTER);
  const [paperRawKind, setPaperRawKind] = useState<number | null>(null);
  const [timeoutSeconds, setTimeoutSeconds] = useState<number>(240);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge?.admin.getPrinterSettings) return;
    const [settingsResult, printersResult] = await Promise.all([
      bridge.admin.getPrinterSettings(),
      bridge.admin.listPrinters(),
    ]);
    if (settingsResult.ok) {
      setSettings(settingsResult.data.settings);
      setCapabilities(settingsResult.data.capabilities);
      setPrinterName(settingsResult.data.settings.printerName ?? NO_PRINTER);
      setPaperRawKind(settingsResult.data.settings.paperRawKind);
      setTimeoutSeconds(settingsResult.data.settings.timeoutSeconds);
    } else {
      setMessage({ kind: 'error', text: settingsResult.error.message });
    }
    if (printersResult.ok) setPrinters(printersResult.data);
    else setMessage({ kind: 'error', text: printersResult.error.message });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const choosePrinter = async (name: string) => {
    setPrinterName(name);
    setMessage(null);
    setCapabilities(null);
    setPaperRawKind(null);
    if (name === NO_PRINTER) return;
    const bridge = getBridge();
    if (!bridge) return;
    const result = await bridge.admin.getPrinterCapabilities(name);
    if (result.ok) {
      setCapabilities(result.data);
      setPaperRawKind(result.data.paperCandidates.find(is4r)?.rawKind ?? null);
    } else {
      setMessage({ kind: 'error', text: result.error.message });
    }
  };

  const fourRPapers = useMemo(
    () => capabilities?.paperCandidates.filter(is4r) ?? [],
    [capabilities],
  );

  const run = async (action: () => Promise<{ ok: boolean; text: string }>) => {
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await action();
      setMessage({ kind: outcome.ok ? 'ok' : 'error', text: outcome.text });
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const bridge = getBridge();
      if (!bridge || !settings) return { ok: false, text: 'Printer settings are unavailable.' };
      const chosen = fourRPapers.find((paper) => paper.rawKind === paperRawKind) ?? null;
      const result = await bridge.admin.savePrinterSettings({
        printerName: printerName === NO_PRINTER ? null : printerName,
        paperRawKind: chosen?.rawKind ?? null,
        paperName: chosen?.name ?? null,
        timeoutSeconds,
        expectedRevision: settings.revision,
      });
      if (!result.ok) return { ok: false, text: result.error.message };
      setSettings(result.data);
      return { ok: true, text: 'Printer settings saved.' };
    });

  const chooseProfile = () =>
    run(async () => {
      const bridge = getBridge();
      if (!bridge) return { ok: false, text: 'Printer settings are unavailable.' };
      const result = await bridge.admin.chooseIccProfile();
      if (!result.ok) return { ok: false, text: result.error.message };
      setSettings(result.data);
      return {
        ok: true,
        text: result.data.iccProfileName
          ? `Color profile set: ${result.data.iccProfileName}. Turn off color adjustment in the printer driver.`
          : 'No color profile chosen.',
      };
    });

  const clearProfile = () =>
    run(async () => {
      const bridge = getBridge();
      if (!bridge) return { ok: false, text: 'Printer settings are unavailable.' };
      const result = await bridge.admin.clearIccProfile();
      if (!result.ok) return { ok: false, text: result.error.message };
      setSettings(result.data);
      return { ok: true, text: 'Color profile removed. Prints use sRGB.' };
    });

  const testPage = (kind: 'calibration' | 'color_test') =>
    run(async () => {
      const bridge = getBridge();
      if (!bridge) return { ok: false, text: 'Printer settings are unavailable.' };
      const result = await bridge.admin.printTestPage(kind);
      if (!result.ok) return { ok: false, text: result.error.message };
      return {
        ok: true,
        text:
          kind === 'calibration'
            ? 'Calibration chart queued. Measure it: 152 x 102 mm, outline fully visible.'
            : 'Color test queued. Compare it with the same page on screen.',
      };
    });

  const dirty =
    settings !== null &&
    ((settings.printerName ?? NO_PRINTER) !== printerName ||
      settings.paperRawKind !== paperRawKind ||
      settings.timeoutSeconds !== timeoutSeconds);
  const printerItems = [
    { label: 'No printer', value: NO_PRINTER },
    ...printers.map((printer) => ({
      label: `${printer.name}${printer.isNetwork ? ' (network)' : ''}`,
      value: printer.name,
    })),
  ];

  return (
    <Form
      className="settings-card settings-form"
      data-testid="printer-settings"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="settings-card__title">
        <Printer aria-hidden="true" />
        <div>
          <h3>4R photo printer</h3>
          <p>
            Prints landscape 6 x 4 in, bordered. Any Windows printer works, over USB or the network.
            {settings?.adapter === 'mock' ? ' (Test printer active.)' : ''}
          </p>
        </div>
      </div>
      {message ? (
        <p
          className={message.kind === 'ok' ? 'form-status' : 'form-error'}
          role={message.kind === 'ok' ? 'status' : 'alert'}
        >
          {message.text}
        </p>
      ) : null}
      <Field name="printer-name">
        <FieldLabel>Printer</FieldLabel>
        <Select
          items={printerItems}
          value={printerName}
          onValueChange={(value) => value !== null && void choosePrinter(value)}
        >
          <SelectTrigger aria-label="Printer">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {printerItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </Field>
      {printerName !== NO_PRINTER ? (
        fourRPapers.length > 0 ? (
          <Field name="printer-paper">
            <FieldLabel>4R paper size (as this driver names it)</FieldLabel>
            <Select
              items={fourRPapers.map((paper) => ({ label: paper.name, value: paper.rawKind }))}
              value={paperRawKind ?? fourRPapers[0]?.rawKind ?? null}
              onValueChange={(value) => value !== null && setPaperRawKind(value)}
            >
              <SelectTrigger aria-label="4R paper size">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {fourRPapers.map((paper) => (
                  <SelectItem key={paper.rawKind} value={paper.rawKind}>
                    {paper.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </Field>
        ) : capabilities ? (
          <p className="form-error" role="alert">
            <Warning aria-hidden="true" /> This printer does not list a 4 x 6 in paper size.
          </p>
        ) : null
      ) : null}
      {capabilities ? (
        <dl className="printer-facts">
          <div>
            <dt>Driver margins</dt>
            <dd>{formatMargins(capabilities)}</dd>
          </div>
          <div>
            <dt>Resolution</dt>
            <dd>{capabilities.dpi ? `${capabilities.dpi} DPI` : 'Not reported (300 DPI used)'}</dd>
          </div>
        </dl>
      ) : null}
      <Field name="printer-timeout">
        <FieldLabel>Warn when a copy has not finished after</FieldLabel>
        <Select
          items={TIMEOUT_CHOICES.map((value) => ({ label: `${value / 60} minutes`, value }))}
          value={timeoutSeconds}
          onValueChange={(value) => value !== null && setTimeoutSeconds(value)}
        >
          <SelectTrigger aria-label="Print timeout">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {TIMEOUT_CHOICES.map((value) => (
              <SelectItem key={value} value={value}>
                {value / 60} minutes{value === 240 ? ' (Default)' : ''}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </Field>
      <div className="printer-profile">
        <p>
          <strong>Color profile:</strong> {settings?.iccProfileName ?? 'None (sRGB)'}
        </p>
        <div className="two-field-grid">
          <Button
            disabled={busy}
            onClick={() => void chooseProfile()}
            type="button"
            variant="secondary"
          >
            Choose ICC profile
          </Button>
          <Button
            disabled={busy || !settings?.iccProfileName}
            icon={<Trash aria-hidden="true" />}
            onClick={() => void clearProfile()}
            type="button"
            variant="secondary"
          >
            Remove profile
          </Button>
        </div>
      </div>
      <div className="two-field-grid">
        <Button
          disabled={busy || dirty || !settings?.printerName}
          onClick={() => void testPage('calibration')}
          type="button"
          variant="secondary"
        >
          Print calibration chart
        </Button>
        <Button
          disabled={busy || dirty || !settings?.printerName}
          onClick={() => void testPage('color_test')}
          type="button"
          variant="secondary"
        >
          Print color test
        </Button>
      </div>
      <Button
        disabled={!dirty || (printerName !== NO_PRINTER && fourRPapers.length === 0)}
        icon={<CheckCircle aria-hidden="true" weight="bold" />}
        loading={busy}
        type="submit"
      >
        Save printer
      </Button>
    </Form>
  );
}
