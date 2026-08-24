import {
  ArrowClockwiseIcon as ArrowClockwise,
  ImagesIcon as Images,
  MagnifyingGlassPlusIcon as MagnifyingGlassPlus,
  QrCodeIcon as QrCode,
  XIcon as X,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import type { GalleryItem, GalleryUploadStatus, UploadJobSummary } from '@grace-booth/shared';

import { Button } from './Button';

type RecentGalleryProps = {
  items: GalleryItem[];
  busy?: boolean | undefined;
  error?: string | null | undefined;
  operator?: boolean | undefined;
  jobs?: UploadJobSummary[] | undefined;
  onRetryJob?: ((jobId: string) => void) | undefined;
  onClose: () => void;
};

const STATUS_LABEL: Record<GalleryUploadStatus, string> = {
  pending: 'Pending upload',
  uploaded: 'Uploaded',
  failed: 'Upload failed',
  'local-receipt': 'Local receipt',
};

export function RecentGallery({
  items,
  busy = false,
  error,
  operator = false,
  jobs = [],
  onRetryJob,
  onClose,
}: RecentGalleryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [detailItem, setDetailItem] = useState<GalleryItem | null>(null);

  useEffect(() => {
    if (operator) return;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const focusable = containerRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (detailItem !== null) {
          setDetailItem(null);
        } else {
          onClose();
        }
        return;
      }
      if (event.key === 'Tab' && containerRef.current && !detailItem) {
        const focusables = Array.from(
          containerRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [operator, onClose, detailItem]);

  const jobForSession = (sessionId: string): UploadJobSummary | null =>
    jobs.find((job) => job.sessionId === sessionId) ?? null;

  const detailJob = detailItem ? jobForSession(detailItem.sessionId) : null;

  const content = (
    <section
      className={`recent-gallery${operator ? ' recent-gallery--operator' : ''}`}
      role={operator ? undefined : 'dialog'}
      aria-modal={operator ? undefined : 'true'}
      aria-label="Recently captured photostrips"
      data-testid="recent-gallery"
      ref={containerRef}
    >
      {!operator ? (
        <header className="recent-gallery__header">
          <h2>
            <Images aria-hidden="true" weight="bold" /> Recent photos
          </h2>
          <button
            aria-label="Close recent photos"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" weight="bold" />
          </button>
        </header>
      ) : null}

      {busy ? (
        <p className="recent-gallery__status" role="status">
          Loading recent photos…
        </p>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {!busy && !error && items.length === 0 ? (
        <p className="recent-gallery__status">No finished photos yet.</p>
      ) : null}

      <div className="recent-gallery__grid" data-testid="recent-gallery-grid">
        {items.map((item, index) => {
          const job = operator ? jobForSession(item.sessionId) : null;
          return (
            <article
              className={`gallery-tile gallery-tile--clickable${operator ? ' gallery-tile--operator' : ''}`}
              data-testid={`gallery-item-${index + 1}`}
              key={item.sessionId}
              onClick={() => setDetailItem(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setDetailItem(item);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`View photo strip captured at ${formatTimestamp(item.metadata.capturedAt)}`}
            >
              <div className="gallery-tile__preview-container">
                <img
                  alt={`Photostrip captured at ${formatTimestamp(item.metadata.capturedAt)}`}
                  className="gallery-tile__preview"
                  draggable="false"
                  src={item.previewDataUrl}
                />
                <span className="gallery-tile__zoom-badge" aria-hidden="true">
                  <MagnifyingGlassPlus weight="bold" />
                </span>
              </div>

              {item.qrDataUrl ? (
                <img
                  alt={`QR code for the photo captured at ${formatTimestamp(item.metadata.capturedAt)}`}
                  className="gallery-tile__qr"
                  draggable="false"
                  src={item.qrDataUrl}
                />
              ) : (
                <span className="gallery-tile__qr gallery-tile__qr--empty" aria-hidden="true" />
              )}
              <span className="gallery-tile__captured">
                {formatTimestamp(item.metadata.capturedAt)}
              </span>
              {operator ? (
                <table className="gallery-tile__metadata">
                  <tbody>
                    <tr>
                      <th scope="row">Captured</th>
                      <td>{formatTimestamp(item.metadata.capturedAt)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Photos</th>
                      <td>{item.metadata.photoCount}</td>
                    </tr>
                    <tr>
                      <th scope="row">Frame</th>
                      <td>{item.metadata.frameName ?? '—'}</td>
                    </tr>
                    <tr>
                      <th scope="row">Upload</th>
                      <td>{STATUS_LABEL[item.metadata.uploadStatus]}</td>
                    </tr>
                    <tr>
                      <th scope="row">Cloud expiry</th>
                      <td>
                        {item.metadata.cloudExpiresAt
                          ? formatTimestamp(item.metadata.cloudExpiresAt)
                          : '—'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              ) : null}
              {operator && item.metadata.uploadStatus === 'failed' && job ? (
                <div className="gallery-tile__action" onClick={(e) => e.stopPropagation()}>
                  <Button
                    icon={<ArrowClockwise aria-hidden="true" weight="bold" />}
                    onClick={() => onRetryJob?.(job.id)}
                    variant="secondary"
                    wide
                  >
                    Retry upload
                  </Button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {!operator ? (
        <footer className="recent-gallery__footer">
          <Button onClick={onClose} variant="secondary">
            Back
          </Button>
        </footer>
      ) : null}

      {detailItem ? (
        <div
          className="recent-detail-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Enlarged photo strip details"
          onClick={() => setDetailItem(null)}
        >
          <div
            className="recent-detail-modal"
            onClick={(e) => e.stopPropagation()}
            role="document"
          >
            <header className="recent-detail-modal__header">
              <div className="recent-detail-modal__title-group">
                <h2>
                  <Images aria-hidden="true" weight="bold" /> Photo Strip Details
                </h2>
                <span className="recent-detail-modal__subtitle">
                  {formatTimestamp(detailItem.metadata.capturedAt)}
                </span>
              </div>
              <button
                aria-label="Close photo details"
                className="icon-button"
                onClick={() => setDetailItem(null)}
                type="button"
              >
                <X aria-hidden="true" weight="bold" />
              </button>
            </header>

            <div className="recent-detail-modal__body">
              <div className="recent-detail-modal__strip-col">
                <img
                  alt={`Enlarged photostrip captured at ${formatTimestamp(detailItem.metadata.capturedAt)}`}
                  className="recent-detail-modal__image"
                  draggable="false"
                  src={detailItem.previewDataUrl}
                />
              </div>

              <div className="recent-detail-modal__info-col">
                {detailItem.qrDataUrl ? (
                  <div className="recent-detail-modal__qr-card">
                    <div className="recent-detail-modal__qr-label">
                      <QrCode aria-hidden="true" weight="bold" />
                      <span>Guest Download QR Code</span>
                    </div>
                    <img
                      alt="Guest download QR code"
                      className="recent-detail-modal__qr-img"
                      draggable="false"
                      src={detailItem.qrDataUrl}
                    />
                    <p className="recent-detail-modal__qr-hint">
                      Scan with your smartphone camera to download this photo strip.
                    </p>
                  </div>
                ) : null}

                <div className="recent-detail-modal__meta-card">
                  <h3>Metadata</h3>
                  <table className="recent-detail-modal__table">
                    <tbody>
                      <tr>
                        <th scope="row">Captured</th>
                        <td>{formatTimestamp(detailItem.metadata.capturedAt)}</td>
                      </tr>
                      <tr>
                        <th scope="row">Photo Count</th>
                        <td>{detailItem.metadata.photoCount} photos</td>
                      </tr>
                      <tr>
                        <th scope="row">Frame Layout</th>
                        <td>{detailItem.metadata.frameName ?? 'Default Frame'}</td>
                      </tr>
                      <tr>
                        <th scope="row">Upload Status</th>
                        <td>
                          <span
                            className={`status-pill status-pill--${detailItem.metadata.uploadStatus}`}
                          >
                            {STATUS_LABEL[detailItem.metadata.uploadStatus]}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Cloud Expiry</th>
                        <td>
                          {detailItem.metadata.cloudExpiresAt
                            ? formatTimestamp(detailItem.metadata.cloudExpiresAt)
                            : 'Not uploaded / Local only'}
                        </td>
                      </tr>
                      <tr>
                        <th scope="row">Session ID</th>
                        <td className="recent-detail-modal__session-id">
                          <code>{detailItem.sessionId}</code>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {operator && detailItem.metadata.uploadStatus === 'failed' && detailJob ? (
                  <div className="recent-detail-modal__retry-box">
                    <Button
                      icon={<ArrowClockwise aria-hidden="true" weight="bold" />}
                      onClick={() => {
                        onRetryJob?.(detailJob.id);
                        setDetailItem(null);
                      }}
                      variant="secondary"
                      wide
                    >
                      Retry cloud upload
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>

            <footer className="recent-detail-modal__footer">
              <Button onClick={() => setDetailItem(null)} variant="secondary">
                Close
              </Button>
            </footer>
          </div>
        </div>
      ) : null}
    </section>
  );

  if (operator) {
    return content;
  }

  return (
    <div className="recent-gallery-backdrop" role="presentation">
      {content}
    </div>
  );
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString();
}
