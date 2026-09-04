import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import {
  Button as FluentButton,
  type ButtonProps as FluentButtonProps,
} from '@grace-booth/ui';

type LegacyVariant =
  | 'primary'
  | 'secondary'
  | 'quiet'
  | 'danger'
  | 'ghost'
  | 'outline'
  | 'default'
  | 'destructive'
  | 'subtle';

export type ButtonProps = {
  children: ReactNode;
  icon?: ReactNode;
  iconAfter?: ReactNode;
  loading?: boolean;
  size?: FluentButtonProps['size'];
  variant?: LegacyVariant;
  wide?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>;

function mapVariant(v?: LegacyVariant): FluentButtonProps['variant'] {
  if (!v || v === 'primary' || v === 'default') return 'primary';
  if (v === 'secondary') return 'secondary';
  if (v === 'quiet' || v === 'ghost' || v === 'subtle') return 'subtle';
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
    size,
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
    <FluentButton
      aria-busy={loading ? 'true' : undefined}
      className={`${legacyVariantClass} ${wide ? 'w-full' : ''} ${className}`.trim()}
      disabled={disabled ? true : loading}
      icon={icon}
      iconAfter={iconAfter}
      loading={loading}
      ref={ref}
      size={size}
      type={type}
      variant={mappedVariant}
      {...props}
    >
      <span className="button__label">{children}</span>
    </FluentButton>
  );
});
