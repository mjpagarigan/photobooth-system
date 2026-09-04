import {
  ArrowClockwise,
  CloudArrowUp,
  Images,
  MagnifyingGlassPlus,
  QrCode,
  X,
} from '@grace-booth/ui';
import { useState } from 'react';

import type { GalleryItem, GalleryUploadStatus, UploadJobSummary } from '@grace-booth/shared';
import {
  Badge,
  Button as CossButton,
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Skeleton,
} from '@grace-booth/ui';

import { Button } from './Button';

type RecentGalleryProps = {
  items: GalleryItem[];
  busy?: boolean | undefined;
  error?: string | null | undefined;
  operator?: boolean | undefined;
  jobs?: UploadJobSummary[] | undefined;
  onRetryJob?: ((jobId: string) => void) | undefined;
  onRepairCloudPhoto?: ((sessionId: string) => void) | undefined;
  repairingSessionId?: string | null | undefined;
  onClose: () => void;
};

const STATUS_LABEL: Record<GalleryUploadStatus, string> = {
  pending: 'Pending upload',
  uploaded: 'Uploaded',
  failed: 'Upload failed',
  'local-receipt': 'Local receipt',
  unavailable: 'Cloud copy unavailable',
  'verification-failed': 'Availability check failed',
};

export function RecentGallery({
  items,
  busy = false,
  error,
  operator = false,
  jobs = [],
  onRetryJob,
  onRepairCloudPhoto,
  repairingSessionId = null,
  onClose,
}: RecentGalleryProps) {
  const [detailItem, setDetailItem] = useState<GalleryItem | null>(null);

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
    >
      {!operator ? (
        <header className="recent-gallery__header">
          <h2>
            <Images aria-hidden="true" weight="bold" /> Recent photos
          </h2>
          <CossButton
            aria-label="Close recent photos"
            onClick={onClose}
            size="icon"
            type="button"
            variant="ghost"
          >
            <X aria-hidden="true" weight="bold" />
          </CossButton>
        </header>
      ) : null}

      {busy ? (
        <div className="recent-gallery__loading" role="status">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
          <span className="sr-only">Loading recent photos…</span>
        </div>
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
              className={`gallery-tile${operator ? ' gallery-tile--operator' : ''}`}
              data-testid={`gallery-item-${index + 1}`}
              key={item.sessionId}
            >
              <button
                aria-label={`View photo strip captured at ${formatTimestamp(item.metadata.capturedAt)}`}
                className="gallery-tile__open"
                onClick={() => setDetailItem(item)}
                type="button"
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
              </button>

              <div className="gallery-tile__summary">
                <span className="gallery-tile__captured">
                  {formatTimestamp(item.metadata.capturedAt)}
                </span>
                <Badge className={`status-pill status-pill--${item.metadata.uploadStatus}`}>
                  {STATUS_LABEL[item.metadata.uploadStatus]}
                </Badge>
              </div>
              {item.qrDataUrl ? (
                <div className="gallery-tile__qr-wrapper">
                  <img
                    alt={`QR code for the photo captured at ${formatTimestamp(item.metadata.capturedAt)}`}
                    className="gallery-tile__qr"
                    draggable="false"
                    src={item.qrDataUrl}
                  />
                </div>
              ) : null}
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
              {operator && item.metadata.uploadStatus === 'unavailable' ? (
                <div className="gallery-tile__action" onClick={(e) => e.stopPropagation()}>
                  <Button
                    icon={<CloudArrowUp aria-hidden="true" weight="bold" />}
                    loading={repairingSessionId === item.sessionId}
                    onClick={() => onRepairCloudPhoto?.(item.sessionId)}
                    variant="secondary"
                    wide
                  >
                    Repair cloud copy
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

      <Dialog onOpenChange={(open) => !open && setDetailItem(null)} open={Boolean(detailItem)}>
        {detailItem ? (
          <DialogPopup className="recent-detail-modal" maxWidthClass="max-w-4xl" showCloseButton={false}>
            <DialogHeader className="recent-detail-modal__header">
              <div className="recent-detail-modal__title-group">
                <DialogTitle>
                  <Images aria-hidden="true" weight="bold" /> Photo Strip Details
                </DialogTitle>
                <DialogDescription className="recent-detail-modal__subtitle">
                  {formatTimestamp(detailItem.metadata.capturedAt)}
                </DialogDescription>
              </div>
              <DialogClose
                render={<CossButton aria-label="Close photo details" size="icon" type="button" variant="ghost" />}
              >
                <X aria-hidden="true" weight="bold" />
              </DialogClose>
            </DialogHeader>

            <DialogPanel
              aria-label="Scrollable photo details"
              className="recent-detail-modal__body"
              tabIndex={0}
            >
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
                {operator && detailItem.metadata.uploadStatus === 'unavailable' ? (
                  <div className="recent-detail-modal__retry-box">
                    <Button
                      icon={<CloudArrowUp aria-hidden="true" weight="bold" />}
                      loading={repairingSessionId === detailItem.sessionId}
                      onClick={() => onRepairCloudPhoto?.(detailItem.sessionId)}
                      variant="secondary"
                      wide
                    >
                      Repair cloud copy
                    </Button>
                  </div>
                ) : null}
              </div>
            </DialogPanel>

            <DialogFooter className="recent-detail-modal__footer">
              <DialogClose render={<CossButton type="button" variant="secondary" />}>
                Close
              </DialogClose>
            </DialogFooter>
          </DialogPopup>
        ) : null}
      </Dialog>
    </section>
  );

  if (operator) {
    return content;
  }

  return (
    <Dialog onOpenChange={(open) => !open && onClose()} open>
      <DialogPopup className="recent-gallery-shell" maxWidthClass="max-w-6xl" showCloseButton={false}>
        <DialogHeader className="sr-only">
          <DialogTitle>Recent photos</DialogTitle>
          <DialogDescription>Recently captured photostrips available on this booth.</DialogDescription>
        </DialogHeader>
        <DialogPanel className="p-0">{content}</DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString();
}
