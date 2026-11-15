import { CheckCircle, Printer, SquaresFour, Switch, Warning } from '@grace-booth/ui';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';

import type { FrameSummary, PrinterHealth, SessionPrintRequest } from '@grace-booth/shared';
import { isPrintableFrameSize } from '@grace-booth/shared';
import {
  Button as CossButton,
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@grace-booth/ui';

import { Button } from '../components/Button';
import { Photostrip } from '../components/Photostrip';
import { CopyStepper } from '../components/Printing';
import { isPrinterReady } from '../hooks/usePrinterHealth';
import { DEFAULT_FRAME_PREVIEW } from '../local-fixtures';

type ReviewScreenProps = {
  busy?: boolean;
  canAccept: boolean;
  canRetake: boolean;
  captureUrls: string[];
  frames?: FrameSummary[] | undefined;
  /** Null hides the print controls (no print support in this build). */
  printerHealth?: PrinterHealth | null | undefined;
  onAccept: (frameId: string, print: SessionPrintRequest | null) => void;
  onRetake: () => void;
};

export function ReviewScreen({
  busy = false,
  canAccept,
  canRetake,
  captureUrls,
  frames,
  printerHealth = null,
  onAccept,
  onRetake,
}: ReviewScreenProps) {
  // Printing is off by default for every session; the operator turns it on per session.
  const [printOn, setPrintOn] = useState(false);
  const [copies, setCopies] = useState(1);
  const [printerWarningOpen, setPrinterWarningOpen] = useState(false);
  const fallbackFrames = useMemo(() => [DEFAULT_FRAME_PREVIEW], []);
  const options = frames && frames.length > 0 ? frames : fallbackFrames;
  const [selectedRawId, setSelectedRawId] = useState<string | null>(null);
  const selectedId =
    selectedRawId !== null && options.some((option) => option.id === selectedRawId)
      ? selectedRawId
      : options[0]?.id;
  const selectedOption = options.find((option) => option.id === selectedId);
  const printable =
    printerHealth !== null &&
    selectedOption !== undefined &&
    isPrintableFrameSize(selectedOption.width, selectedOption.height);
  // Switching to a 1:3 frame hides the controls and turns printing off.
  const printRequested = printable && printOn;
  const [layoutsModalOpen, setLayoutsModalOpen] = useState(false);

  const accept = (force: boolean) => {
    if (selectedId === undefined) return;
    if (printRequested && !force && !isPrinterReady(printerHealth)) {
      setPrinterWarningOpen(true);
      return;
    }
    setPrinterWarningOpen(false);
    onAccept(selectedId, printRequested ? { copies } : null);
  };
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const handleRetake = () => {
    setSelectedRawId(null);
    onRetake();
  };

  const moveSelection = (step: 1 | -1) => {
    const index = Math.max(
      0,
      Math.min(options.length - 1, currentIndex(options, selectedId) + step),
    );
    const next = options[index];
    if (next) {
      setSelectedRawId(next.id);
      const target = document.querySelector<HTMLElement>(`[data-collage-option="${next.id}"]`);
      target?.focus();
    }
  };

  useEffect(() => {
    if (!selectedId) return;
    const element = document.querySelector<HTMLElement>(`[data-collage-option="${selectedId}"]`);
    element?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [selectedId]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>, option: FrameSummary) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      setSelectedRawId(option.id);
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(1);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(-1);
    }
  };

  return (
    <main className="screen screen--review" data-testid="review-screen">
      <div
        className={`review-layout${
          selectedOption && selectedOption.width >= selectedOption.height ? ' is-landscape' : ''
        }`}
      >
        <div className="review-stage">
          {selectedOption ? (
            <Photostrip
              captureUrls={captureUrls}
              frame={selectedOption}
              label={`Selected collage: ${selectedOption.name}`}
              variant="preview"
            />
          ) : null}
        </div>

        <section className="review-panel" aria-labelledby="review-title">
          <p className="review-panel__eyebrow">
            <CheckCircle aria-hidden="true" weight="fill" />
            All {captureUrls.length} {captureUrls.length === 1 ? 'photo' : 'photos'} captured
          </p>
          <h1 id="review-title" data-screen-heading ref={headingRef} tabIndex={-1}>
            Looking good. <span>Pick a layout, then use these photos.</span>
          </h1>

          <ul className="review-shots" aria-label="Your photos">
            {captureUrls.map((url, index) => (
              <li key={url}>
                <img src={url} alt={`Photo ${index + 1}`} draggable="false" />
              </li>
            ))}
          </ul>

          <div className="review-layouts">
            <div className="review-layouts__header">
              <p className="review-layouts__label">Layout</p>
              <button
                type="button"
                className="review-layouts__all"
                onClick={() => setLayoutsModalOpen(true)}
              >
                All layouts ({options.length})
              </button>
            </div>
            <div className="review-options" role="radiogroup" aria-label="Collage options">
              {options.map((option, index) => (
                <div
                  className={`review-option-card ${option.width >= option.height ? 'is-landscape' : 'is-portrait'}${
                    selectedId === option.id ? ' is-selected' : ''
                  }`}
                  role="radio"
                  aria-checked={selectedId === option.id}
                  tabIndex={selectedId === option.id ? 0 : -1}
                  key={option.id}
                  onClick={() => setSelectedRawId(option.id)}
                  onKeyDown={(e) => handleKeyDown(e, option)}
                  data-testid={`collage-option-${index + 1}`}
                  data-collage-option={option.id}
                  aria-label={`Collage Option ${index + 1}: ${option.name}`}
                >
                  <span className="review-option-preview">
                    <Photostrip
                      captureUrls={captureUrls}
                      frame={option}
                      label={`Preview in Collage Option ${index + 1}`}
                      variant="preview"
                    />
                  </span>
                  <span className="review-option-title" title={option.name}>
                    {option.name}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {printable ? (
            <div className="review-print" data-testid="review-print">
              <label className="review-print__toggle">
                <Switch
                  aria-label="Print this photo"
                  checked={printOn}
                  data-testid="print-toggle"
                  onCheckedChange={(checked) => {
                    setPrintOn(checked);
                    setPrinterWarningOpen(false);
                  }}
                />
                <span>
                  <Printer aria-hidden="true" /> Print on 4R
                </span>
              </label>
              {printOn ? <CopyStepper value={copies} onChange={setCopies} disabled={busy} /> : null}
            </div>
          ) : null}

          {printerWarningOpen && printRequested ? (
            <div
              className="review-printer-warning"
              data-testid="review-printer-warning"
              role="alert"
            >
              <p className="review-printer-warning__title">
                <Warning aria-hidden="true" weight="bold" />
                {printerHealth.status === 'paper_out'
                  ? 'The printer is out of paper.'
                  : printerHealth.status === 'offline'
                    ? 'The printer is offline.'
                    : 'The printer is not ready.'}
              </p>
              <p>
                {printerHealth.message} Proceed to finish this session now; the{' '}
                {copies === 1 ? 'copy' : `${copies} copies`} will wait in the print queue and print
                when the printer is back.
              </p>
              <Button
                data-testid="print-proceed"
                disabled={!canAccept}
                loading={busy}
                onClick={() => accept(true)}
              >
                Proceed
              </Button>
            </div>
          ) : null}

          <div className="review-actions">
            <Button
              className="button--review-retake"
              aria-label="Retake all photos"
              disabled={!canRetake || busy}
              onClick={handleRetake}
              variant="secondary"
            >
              Retake all photos
            </Button>
            <Button
              className="button--review-accept"
              aria-label="Use these photos"
              disabled={!canAccept}
              loading={busy}
              onClick={() => accept(false)}
            >
              Use these photos
            </Button>
          </div>
        </section>
      </div>

      <Dialog open={layoutsModalOpen} onOpenChange={setLayoutsModalOpen}>
        <DialogPopup maxWidthClass="max-w-4xl" className="layouts-picker-modal">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SquaresFour aria-hidden="true" weight="bold" className="size-5 text-primary" />
              <span>All frame layouts</span>
            </DialogTitle>
            <DialogDescription>
              Choose from all {options.length} photo templates for your photostrip.
            </DialogDescription>
          </DialogHeader>

          <DialogPanel className="layouts-picker-panel">
            <div className="layouts-picker-grid">
              {options.map((option) => {
                const isSelected = selectedId === option.id;
                return (
                  <button
                    type="button"
                    key={option.id}
                    className={`layouts-picker-tile ${option.width >= option.height ? 'is-landscape' : 'is-portrait'} ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => {
                      setSelectedRawId(option.id);
                      setLayoutsModalOpen(false);
                    }}
                    aria-label={`Select layout: ${option.name}`}
                  >
                    <div className="layouts-picker-preview-wrapper">
                      <Photostrip
                        captureUrls={captureUrls}
                        frame={option}
                        label={`Preview in ${option.name}`}
                        variant="preview"
                      />
                      {isSelected && (
                        <div className="layouts-picker-selected-badge" aria-hidden="true">
                          <CheckCircle weight="fill" className="size-5 text-primary" />
                        </div>
                      )}
                    </div>
                    <span className="layouts-picker-name" title={option.name}>
                      {option.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </DialogPanel>

          <DialogFooter>
            <DialogClose render={<CossButton type="button" variant="secondary" />}>
              Close
            </DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </main>
  );
}

function currentIndex(options: FrameSummary[], id: string | undefined): number {
  if (id === undefined) return 0;
  const index = options.findIndex((option) => option.id === id);
  return index === -1 ? 0 : index;
}
