import { cva, type VariantProps } from 'class-variance-authority';
import { useRender } from '@base-ui/react/use-render';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-sans text-sm font-semibold tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-[#8f503c] active:bg-[#7d4432] shadow-sm',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[#3a3a3a] active:bg-[#252525] border border-border/50',
        outline:
          'border border-border bg-transparent text-foreground hover:bg-secondary/60 active:bg-secondary',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-[#a51d1d] active:bg-[#8a1818] shadow-sm',
        'destructive-outline':
          'border border-destructive text-destructive bg-transparent hover:bg-destructive/10 active:bg-destructive/20',
        ghost: 'text-foreground hover:bg-secondary/60 active:bg-secondary',
        link: 'text-primary underline-offset-4 hover:underline p-0 h-auto font-normal',
      },
      size: {
        xs: 'h-7 px-2.5 text-xs',
        sm: 'h-9 px-3 text-xs',
        default: 'h-11 px-5 text-sm min-h-[44px]',
        lg: 'h-14 px-7 text-base font-bold min-h-[56px]',
        xl: 'h-16 px-8 text-lg font-bold min-h-[64px]',
        'icon-xs': 'size-7 p-0',
        'icon-sm': 'size-9 p-0',
        icon: 'size-11 p-0 min-w-[44px] min-h-[44px]',
        'icon-lg': 'size-14 p-0 min-w-[56px] min-h-[56px]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type ButtonProps = {
  loading?: boolean;
  icon?: ReactNode;
  iconAfter?: ReactNode;
  render?: useRender.RenderProp;
} & ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant,
    size,
    loading = false,
    disabled,
    icon,
    iconAfter,
    children,
    render,
    type = 'button',
    ...props
  },
  ref,
) {
  return useRender({
    defaultTagName: 'button',
    render,
    ref,
    props: {
      'aria-busy': loading ? 'true' : undefined,
      className: cn(buttonVariants({ variant, size, className })),
      disabled: disabled ? true : loading,
      type,
      ...props,
      children: (
        <>
          {loading ? (
            <span
              aria-hidden="true"
              className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            />
          ) : icon ? (
            <span className="inline-flex shrink-0 items-center justify-center [&>svg]:size-5">
              {icon}
            </span>
          ) : null}
          {children}
          {loading ? <span className="sr-only">Loading</span> : null}
          {!loading && iconAfter ? (
            <span className="inline-flex shrink-0 items-center justify-center [&>svg]:size-5">
              {iconAfter}
            </span>
          ) : null}
        </>
      ),
    },
  });
});
