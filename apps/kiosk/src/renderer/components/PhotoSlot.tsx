import type { CSSProperties } from 'react';

import type { CropMode } from '@grace-booth/shared';

type PhotoSlotProps = {
  index: number;
  src?: string | undefined;
  label?: string;
  framed?: boolean;
  className?: string;
  cropMode?: CropMode;
  style?: CSSProperties;
};

export function PhotoSlot({
  className = '',
  cropMode = 'crop-to-fill',
  framed = true,
  index,
  label = `Photo ${index}`,
  src,
  style,
}: PhotoSlotProps) {
  return (
    <figure
      className={`photo-slot${framed ? ' photo-slot--framed' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      <div className="photo-slot__media">
        {src ? (
          <img
            className={cropMode === 'fit' ? 'photo-slot__image--fit' : undefined}
            src={src}
            alt={label}
            draggable="false"
          />
        ) : (
          <div className="photo-slot__empty" aria-hidden="true" />
        )}
      </div>
    </figure>
  );
}
