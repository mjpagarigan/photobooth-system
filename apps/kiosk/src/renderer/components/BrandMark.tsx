import { Aperture } from '@grace-booth/ui';

type BrandMarkProps = {
  compact?: boolean;
  muted?: boolean;
};

export function BrandMark({ compact = false, muted = false }: BrandMarkProps) {
  return (
    <div
      className={`brand-mark${compact ? ' brand-mark--compact' : ''}${muted ? ' brand-mark--muted' : ''}`}
      aria-label="M.A.T. Photobooth"
    >
      <Aperture aria-hidden="true" weight="bold" />
      <span className="brand-mark__text">
        <strong>M.A.T.</strong>
        <span className="brand-mark__sub">Photobooth</span>
      </span>
    </div>
  );
}
