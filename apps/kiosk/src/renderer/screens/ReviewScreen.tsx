import {
  ArrowCounterClockwise,
  ArrowRight,
  CaretLeft,
  CaretRight,
  CheckCircle,
  SquaresFour,
} from '@grace-booth/ui';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { FrameSummary } from '@grace-booth/shared';
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
import { DEFAULT_FRAME_PREVIEW } from '../local-fixtures';

type ReviewScreenProps = {
  busy?: boolean;
  canAccept: boolean;
  canRetake: boolean;
  captureUrls: string[];
  frames?: FrameSummary[] | undefined;
  onAccept: (frameId: string) => void;
  onRetake: () => void;
};

export function ReviewScreen({
  busy = false,
  canAccept,
  canRetake,
  captureUrls,
  frames,
  onAccept,
  onRetake,
}: ReviewScreenProps) {
  const fallbackFrames = useMemo(() => [DEFAULT_FRAME_PREVIEW], []);
  const options = frames && frames.length > 0 ? frames : fallbackFrames;
  const [selectedRawId, setSelectedRawId] = useState<string | null>(null);
  const selectedId =
    selectedRawId !== null && options.some((option) => option.id === selectedRawId)
      ? selectedRawId
      : options[0]?.id;
  const [layoutsModalOpen, setLayoutsModalOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const hasMovedRef = useRef(false);

  const updateScrollState = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 10);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 10);
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    updateScrollState();
    const el = stageRef.current;
    if (!el) return;
    const handleResize = () => updateScrollState();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [options.length, updateScrollState]);

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

  const scrollContainer = (direction: 'left' | 'right') => {
    const el = stageRef.current;
    if (!el) return;
    const scrollAmount = el.clientWidth * 0.6;
    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const el = stageRef.current;
    if (!el) return;
    isDraggingRef.current = true;
    hasMovedRef.current = false;
    startXRef.current = e.pageX - el.offsetLeft;
    scrollLeftRef.current = el.scrollLeft;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current) return;
    const el = stageRef.current;
    if (!el) return;
    e.preventDefault();
    const x = e.pageX - el.offsetLeft;
    const walk = (x - startXRef.current) * 1.5;
    if (Math.abs(walk) > 6) {
      hasMovedRef.current = true;
    }
    el.scrollLeft = scrollLeftRef.current - walk;
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleCardClick = (optionId: string) => {
    if (hasMovedRef.current) {
      return;
    }
    setSelectedRawId(optionId);
  };

  const handleWheel = (e: React.WheelEvent) => {
    const el = stageRef.current;
    if (!el) return;
    if (Math.abs(e.deltaX) > 0) return;
    if (el.scrollWidth > el.clientWidth) {
      el.scrollLeft += e.deltaY;
    }
  };

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
      <div className="review-layout">
        <div className="review-carousel-column">
          <div className="review-carousel-header">
            <span className="review-carousel-heading">Choose layout</span>
            <Button
              icon={<SquaresFour aria-hidden="true" weight="bold" />}
              onClick={() => setLayoutsModalOpen(true)}
              variant="secondary"
            >
              All layouts ({options.length})
            </Button>
          </div>

          <div className="review-carousel-container">
            {options.length > 2 && (
              <button
                type="button"
                className="review-carousel-arrow review-carousel-arrow--left"
                onClick={() => scrollContainer('left')}
                disabled={!canScrollLeft}
                aria-label="Previous collage layouts"
              >
                <CaretLeft aria-hidden="true" weight="bold" />
              </button>
            )}

            <section
              className="review-options-stage"
              role="radiogroup"
              aria-label="Collage options"
              ref={stageRef}
              onScroll={updateScrollState}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleWheel}
            >
              {options.map((option, index) => (
                <div
                  className={`review-option-card ${selectedId === option.id ? 'is-selected' : ''}`}
                  role="radio"
                  aria-checked={selectedId === option.id}
                  tabIndex={selectedId === option.id ? 0 : -1}
                  key={option.id}
                  onClick={() => handleCardClick(option.id)}
                  onKeyDown={(e) => handleKeyDown(e, option)}
                  data-testid={`collage-option-${index + 1}`}
                  data-collage-option={option.id}
                  aria-label={`Collage Option ${index + 1}: ${option.name}`}
                >
                  <div className="review-option-badge">
                    <span className="review-option-title" title={option.name}>
                      Collage {index + 1}
                    </span>
                    {selectedId === option.id && (
                      <span className="selected-indicator" aria-hidden="true">
                        <CheckCircle weight="fill" /> Selected
                      </span>
                    )}
                  </div>
                  <div className="review-option-preview">
                    <Photostrip
                      captureUrls={captureUrls}
                      frame={option}
                      label={`Preview in Collage Option ${index + 1}`}
                      variant="preview"
                    />
                  </div>
                </div>
              ))}
            </section>

            {options.length > 2 && (
              <button
                type="button"
                className="review-carousel-arrow review-carousel-arrow--right"
                onClick={() => scrollContainer('right')}
                disabled={!canScrollRight}
                aria-label="Next collage layouts"
              >
                <CaretRight aria-hidden="true" weight="bold" />
              </button>
            )}
          </div>
        </div>

        <section className="review-decision-panel" aria-label="Review decisions">
          <div className="review-decision-card">
            <div className="capture-complete-badge">
              <CheckCircle aria-hidden="true" weight="bold" />
              <span>All 3 photos captured</span>
            </div>
            <h1 id="review-title" data-screen-heading ref={headingRef} tabIndex={-1}>
              Choose your collage
            </h1>
            <p className="review-copy">
              Check your three-photo strip. Retake if you want another try, or continue to finish
              your collage.
            </p>
            <div className="review-actions">
              <Button
                aria-label="Retake all photos"
                disabled={!canRetake || busy}
                icon={<ArrowCounterClockwise aria-hidden="true" weight="bold" />}
                onClick={handleRetake}
                variant="secondary"
              >
                <span className="button__two-line">
                  <span className="button__line">Retake all</span>
                  <span className="button__line">photos</span>
                </span>
              </Button>
              <Button
                aria-label="Use these photos"
                disabled={!canAccept}
                iconAfter={<ArrowRight aria-hidden="true" weight="bold" />}
                loading={busy}
                onClick={() => {
                  if (selectedId !== undefined) onAccept(selectedId);
                }}
              >
                <span className="button__two-line">
                  <span className="button__line">Use these</span>
                  <span className="button__line">photos</span>
                </span>
              </Button>
            </div>
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
                    className={`layouts-picker-tile ${isSelected ? 'is-selected' : ''}`}
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
