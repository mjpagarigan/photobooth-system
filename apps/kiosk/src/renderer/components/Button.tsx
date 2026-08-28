import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import {
  Button as CossButton,
  type ButtonProps as CossButtonProps,
} from '@grace-booth/ui';

type LegacyVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'ghost' | 'outline' | 'default' | 'destructive';

export type ButtonProps = {
  children: ReactNode;
  icon?: ReactNode;
  iconAfter?: ReactNode;
  loading?: boolean;
  variant?: LegacyVariant;
  wide?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>;

function mapVariant(v?: LegacyVariant): CossButtonProps['variant'] {
  if (!v || v === 'primary' || v === 'default') return 'default';
  if (v === 'secondary') return 'secondary';
  if (v === 'quiet' || v === 'ghost') return 'ghost';
  if (v === 'danger' || v === 'destructive') return 'destructive';
  return 'outline';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    children,
    className = '',
    disabled,
    icon,
    iconAfter,
    loading = false,
    type = 'button',
    variant = 'primary',
    wide = false,
    ...props
  },
  ref,
) {
  const mappedVariant = mapVariant(variant);
  const legacyVariantClass = `button button--${variant}${wide ? ' button--wide' : ''}`;

  return (
    <CossButton
      aria-busy={loading ? 'true' : undefined}
      className={`${legacyVariantClass} ${wide ? 'w-full' : ''} ${className}`.trim()}
      disabled={disabled ? true : loading}
      icon={icon}
      iconAfter={iconAfter}
      loading={loading}
      ref={ref}
      type={type}
      variant={mappedVariant}
      {...props}
    >
      <span className="button__label">{children}</span>
    </CossButton>
  );
});
