import {
  ArrowCounterClockwiseIcon as ArrowCounterClockwise,
  ArrowDownIcon as ArrowDown,
  ArrowUpIcon as ArrowUp,
  CropIcon as Crop,
  FilePngIcon as FilePng,
  FloppyDiskIcon as FloppyDisk,
  FilmStripIcon as FilmStrip,
  TrashIcon as Trash,
} from '@phosphor-icons/react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Rnd } from 'react-rnd';

import type { CropMode, FrameLayout, FrameSlot, FrameSummary } from '@grace-booth/shared';

import { Button } from '../components/Button';
import { LOCAL_FIXTURES, mockPhotoFor } from '../local-fixtures';

type FrameEditorProps = {
  busy?: boolean | undefined;
  error?: string | null | undefined;
  frames?: FrameSummary[] | undefined;
  onAddFrame: () => void;
  onDeleteFrame: (frameId: string) => void;
  onMoveFrame: (frameId: string, direction: 'up' | 'down') => void;
  onSave: (frameId: string, name: string, slots: FrameLayout, expectedRevision: number) => void;
  status?: string | null | undefined;
};

type StageSize = {
  height: number;
  width: number;
};

type SlotDraft = {
  frameKey: string;
  slots: FrameLayout;
};

function constrainSlot(slot: FrameSlot): FrameSlot {
  const width = Math.max(0.05, Math.min(1, slot.width));
  const height = Math.max(0.05, Math.min(1, slot.height));
  const x = Math.max(0, Math.min(1 - width, slot.x));
  const y = Math.max(0, Math.min(1 - height, slot.y));
  return { ...slot, x, y, width, height };
}

function percent(value: number): string {
  return (value * 100).toFixed(1);
}

function parsePercent(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 100 : fallback;
}

export function FrameEditor({
  busy = false,
  error,
  frames = [],
  onAddFrame,
  onDeleteFrame,
  onMoveFrame,
  onSave,
  status,
}: FrameEditorProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  // Name edits are scoped to the frame they started on so switching frames never leaks a draft.
  const [nameDraft, setNameDraft] = useState<{ frameId: string; value: string } | null>(null);

  const selectedFrame = useMemo(
    () => frames.find((frame) => frame.id === selectedId) ?? frames[0] ?? null,
    [frames, selectedId],
  );

  const selectFrame = (frameId: string) => {
    setSelectedId(frameId);
    setConfirmingDeleteId(null);
  };

  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<StageSize>({ width: 540, height: 720 });
  const [draft, setDraft] = useState<SlotDraft | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(1);

  const frameKey = selectedFrame ? `${selectedFrame.id}:${selectedFrame.revision}` : '';
  const currentSlots = useMemo<FrameLayout>(
    () => (draft?.frameKey === frameKey ? draft.slots : (selectedFrame?.slots ?? [])),
    [draft, frameKey, selectedFrame],
  );
  const nameValue =
    selectedFrame && nameDraft?.frameId === selectedFrame.id
      ? nameDraft.value
      : (selectedFrame?.name ?? '');

  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) {
      return;
    }

    const update = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setStageSize({ width: rect.width, height: rect.height });
      }
    };

    update();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [selectedFrame?.height, selectedFrame?.width, selectedFrame?.id]);

  const selectedSlot = useMemo(
    () => currentSlots.find((slot) => slot.slotIndex === selectedIndex) ?? currentSlots[0],
    [selectedIndex, currentSlots],
  );

  const updateSlot = (slotIndex: number, update: Partial<FrameSlot>) => {
    if (!selectedFrame) return;
    const nextSlots = currentSlots.map((slot) =>
      slot.slotIndex === slotIndex ? constrainSlot({ ...slot, ...update }) : slot,
    );
    setDraft({ frameKey, slots: nextSlots });
  };

  const updateSelectedPercent = (field: 'x' | 'y' | 'width' | 'height', value: string) => {
    if (!selectedSlot) {
      return;
    }
    updateSlot(selectedSlot.slotIndex, {
      [field]: parsePercent(value, selectedSlot[field]),
    });
  };

  const setCropMode = (cropMode: CropMode) => {
    if (selectedSlot) {
      updateSlot(selectedSlot.slotIndex, { cropMode });
    }
  };

  const resetSelected = () => {
    const persisted = selectedFrame?.slots.find((slot) => slot.slotIndex === selectedIndex);
    if (persisted) {
      updateSlot(selectedIndex, persisted);
    }
  };

  const nudgeSelected = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction || !selectedSlot) {
      return;
    }
    event.preventDefault();
    const step = event.shiftKey ? 0.02 : 0.005;
    updateSlot(selectedIndex, {
      x: selectedSlot.x + direction[0] * step,
      y: selectedSlot.y + direction[1] * step,
    });
  };

  const handleSave = () => {
    if (!selectedFrame) return;
    onSave(
      selectedFrame.id,
      nameValue.trim() || selectedFrame.name,
      currentSlots,
      selectedFrame.revision,
    );
  };

  const handleDeleteRow = (frameId: string) => {
    if (confirmingDeleteId === frameId) {
      onDeleteFrame(frameId);
      setConfirmingDeleteId(null);
    } else {
      setConfirmingDeleteId(frameId);
    }
  };

  return (
    <div className="frame-editor" data-testid="frame-editor">
      <header className="admin-page-header">
        <div>
          <h1 data-screen-heading tabIndex={-1}>
            FRAME LIBRARY
          </h1>
          <p>
            Manage every collage frame available at review time and its three-photo slot geometry.
          </p>
        </div>
        <div className="admin-page-header__actions">
          <Button
            data-testid="frame-add"
            disabled={busy}
            icon={<FilePng aria-hidden="true" weight="bold" />}
            onClick={onAddFrame}
            variant="secondary"
          >
            Add frame
          </Button>
          <Button
            disabled={!selectedFrame || busy}
            icon={<FloppyDisk aria-hidden="true" weight="bold" />}
            loading={busy}
            onClick={handleSave}
          >
            Save configuration
          </Button>
        </div>
      </header>
      <div className="frame-editor__workspace frame-editor__workspace--library">
        <aside className="frame-library" aria-label="Frame library" data-testid="frame-library">
          {frames.map((item, index) => (
            <div
              className={`frame-library__item${selectedFrame?.id === item.id ? ' is-selected' : ''}`}
              key={item.id}
            >
              <button
                className="frame-library__select"
                onClick={() => selectFrame(item.id)}
                type="button"
                data-testid={`frame-item-${index + 1}`}
                title={item.name}
              >
                <FilmStrip aria-hidden="true" weight="bold" />
                <span className="frame-library__name">{item.name}</span>
                <span className="frame-library__meta">
                  {item.slots.length} slots · rev {item.revision}
                </span>
              </button>
              <span className="frame-library__controls">
                <button
                  aria-label={`Move ${item.name} up`}
                  disabled={busy || index === 0}
                  onClick={() => onMoveFrame(item.id, 'up')}
                  type="button"
                >
                  <ArrowUp aria-hidden="true" weight="bold" />
                </button>
                <button
                  aria-label={`Move ${item.name} down`}
                  disabled={busy || index === frames.length - 1}
                  onClick={() => onMoveFrame(item.id, 'down')}
                  type="button"
                >
                  <ArrowDown aria-hidden="true" weight="bold" />
                </button>
                <button
                  aria-label={
                    confirmingDeleteId === item.id
                      ? `Confirm delete ${item.name}`
                      : `Delete ${item.name}`
                  }
                  className={confirmingDeleteId === item.id ? 'is-danger' : ''}
                  disabled={busy}
                  onClick={() => handleDeleteRow(item.id)}
                  type="button"
                >
                  <Trash aria-hidden="true" weight="bold" />
                </button>
              </span>
            </div>
          ))}
          <p className="frame-library__hint">
            Add transparent PNG strips (1:3). Frames used by saved sessions cannot be deleted.
          </p>
        </aside>

        {selectedFrame ? (
          <>
            <section className="frame-stage-wrapper" aria-label="Visual frame layout preview">
              <div className="frame-stage-card">
                <div
                  className="frame-stage"
                  ref={stageRef}
                  style={{
                    aspectRatio: `${selectedFrame.width} / ${selectedFrame.height}`,
                  }}
                >
                  {currentSlots.map((slot) => {
                    const selected = slot.slotIndex === selectedIndex;
                    return (
                      <Rnd
                        bounds="parent"
                        className={`frame-slot${selected ? ' is-selected' : ''}`}
                        key={slot.slotIndex}
                        minHeight={40}
                        minWidth={40}
                        onDragStart={() => setSelectedIndex(slot.slotIndex)}
                        onDragStop={(_, position) =>
                          updateSlot(slot.slotIndex, {
                            x: position.x / stageSize.width,
                            y: position.y / stageSize.height,
                          })
                        }
                        onResizeStart={() => setSelectedIndex(slot.slotIndex)}
                        onResizeStop={(_, __, element, ___, position) =>
                          updateSlot(slot.slotIndex, {
                            x: position.x / stageSize.width,
                            y: position.y / stageSize.height,
                            width: element.offsetWidth / stageSize.width,
                            height: element.offsetHeight / stageSize.height,
                          })
                        }
                        position={{
                          x: slot.x * stageSize.width,
                          y: slot.y * stageSize.height,
                        }}
                        size={{
                          width: slot.width * stageSize.width,
                          height: slot.height * stageSize.height,
                        }}
                      >
                        <div
                          aria-label={`${slot.name} preview`}
                          className="frame-slot__inner"
                          onClick={() => setSelectedIndex(slot.slotIndex)}
                          onKeyDown={nudgeSelected}
                          role="button"
                          tabIndex={0}
                          style={{ backgroundImage: `url(${mockPhotoFor(slot.slotIndex)})` }}
                        >
                          <span className="frame-slot__label">
                            <FilmStrip aria-hidden="true" weight="bold" />
                            <span>SLOT_0{slot.slotIndex}</span>
                          </span>
                        </div>
                      </Rnd>
                    );
                  })}
                  <img
                    className="frame-stage__overlay"
                    src={selectedFrame.mediaUrl || LOCAL_FIXTURES.defaultFrame}
                    alt="Current transparent frame overlay"
                    draggable="false"
                  />
                </div>
              </div>
            </section>
            <aside className="slot-inspector" aria-label="Selected photo slot settings">
              <fieldset className="slot-inspector__group">
                <legend>FRAME NAME</legend>
                <input
                  aria-label="Frame name"
                  className="text-input"
                  maxLength={120}
                  onChange={(event) =>
                    setNameDraft({ frameId: selectedFrame.id, value: event.target.value })
                  }
                  type="text"
                  value={nameValue}
                />
              </fieldset>
              <div className="slot-inspector__heading">
                <span>SELECTED SLOT</span>
                <h2>{selectedSlot?.name ?? 'Photo slot'}</h2>
              </div>
              <div className="slot-tabs" role="tablist" aria-label="Photo slots">
                {currentSlots.map((slot) => (
                  <button
                    aria-selected={selectedIndex === slot.slotIndex}
                    className={selectedIndex === slot.slotIndex ? 'is-active' : ''}
                    key={slot.slotIndex}
                    onClick={() => setSelectedIndex(slot.slotIndex)}
                    role="tab"
                    type="button"
                  >
                    {slot.slotIndex}
                  </button>
                ))}
              </div>
              {selectedSlot ? (
                <>
                  <fieldset className="slot-inspector__group">
                    <legend>POSITION &amp; SCALE (%)</legend>
                    <div className="coordinate-grid">
                      {(['x', 'y', 'width', 'height'] as const).map((field) => (
                        <label key={field}>
                          <span>
                            {field === 'x'
                              ? 'X'
                              : field === 'y'
                                ? 'Y'
                                : field === 'width'
                                  ? 'Width'
                                  : 'Height'}{' '}
                            (%)
                          </span>
                          <input
                            aria-label={`${field} percent`}
                            max="100"
                            min="0"
                            onChange={(event) => updateSelectedPercent(field, event.target.value)}
                            step="0.1"
                            type="number"
                            value={percent(selectedSlot[field])}
                          />
                        </label>
                      ))}
                    </div>
                    <p>
                      Drag the slot on the canvas or enter coordinates. Arrow keys nudge selected
                      slot.
                    </p>
                  </fieldset>
                  <fieldset className="slot-inspector__group">
                    <legend>
                      <Crop aria-hidden="true" weight="bold" /> CROP BEHAVIOR
                    </legend>
                    <label
                      className={`crop-option${selectedSlot.cropMode === 'crop-to-fill' ? ' is-selected' : ''}`}
                    >
                      <input
                        checked={selectedSlot.cropMode === 'crop-to-fill'}
                        name={`crop-${selectedSlot.slotIndex}`}
                        onChange={() => setCropMode('crop-to-fill')}
                        type="radio"
                      />
                      <span>
                        <strong>Crop to fill</strong>
                        <small>Fill entire slot bounds and crop outer margins.</small>
                      </span>
                    </label>
                    <label
                      className={`crop-option${selectedSlot.cropMode === 'fit' ? ' is-selected' : ''}`}
                    >
                      <input
                        checked={selectedSlot.cropMode === 'fit'}
                        name={`crop-${selectedSlot.slotIndex}`}
                        onChange={() => setCropMode('fit')}
                        type="radio"
                      />
                      <span>
                        <strong>Fit</strong>
                        <small>Preserve complete uncropped frame inside bounds.</small>
                      </span>
                    </label>
                  </fieldset>
                  <Button
                    icon={<ArrowCounterClockwise aria-hidden="true" weight="bold" />}
                    onClick={resetSelected}
                    variant="secondary"
                    wide
                  >
                    Reset slot
                  </Button>
                </>
              ) : null}
              {status ? (
                <p className="form-success" role="status">
                  {status}
                </p>
              ) : null}
              {error ? (
                <p className="form-error" role="alert">
                  {error}
                </p>
              ) : null}
            </aside>
          </>
        ) : (
          <section className="frame-stage-wrapper" aria-label="No frame selected">
            <div className="frame-stage-card">
              <p className="review-copy">Add a frame to begin configuring the photo library.</p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
