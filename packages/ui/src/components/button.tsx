import { cva, type VariantProps } from 'class-variance-authority';
import { useRender } from '@base-ui/react/use-render';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Spinner } from '@fluentui/react-components';
import { cn } from '../lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-[4px] border font-sans text-sm font-semibold leading-5 tracking-normal transition-[background-color,border-color,color,box-shadow] duration-100 focus-visible:outline-2 focus-visible:outline-white focus-visible:outline-offset-0 focus-visible:shadow-[0_0_0_2px_#000] disabled:pointer-events-none disabled:shadow-none select-none cursor-pointer',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-white shadow-[var(--shadow-2)] hover:bg-[#115ea3] active:bg-[#0c3b5e] active:shadow-none disabled:bg-[#f0f0f0] disabled:text-[#bdbdbd]',
        primary:
          'border-transparent bg-primary text-white shadow-[var(--shadow-2)] hover:bg-[#115ea3] active:bg-[#0c3b5e] active:shadow-none disabled:bg-[#f0f0f0] disabled:text-[#bdbdbd]',
        secondary:
          'border-[#d1d1d1] bg-white text-[#242424] shadow-[var(--shadow-2)] hover:bg-[#f5f5f5] active:bg-[#e0e0e0] active:shadow-none disabled:border-[#e0e0e0] disabled:bg-[#f0f0f0] disabled:text-[#bdbdbd]',
        outline:
          'border-[#d1d1d1] bg-white text-[#242424] hover:bg-[#f5f5f5] active:bg-[#e0e0e0] disabled:border-[#e0e0e0] disabled:bg-transparent disabled:text-[#bdbdbd]',
        destructive:
          'border-transparent bg-[#c50f1f] text-white shadow-[var(--shadow-2)] hover:bg-[#b10e1c] active:bg-[#960b18] disabled:bg-[#f0f0f0] disabled:text-[#bdbdbd]',
        'destructive-outline':
          'border-[#c50f1f] text-[#c50f1f] bg-transparent hover:bg-[#fdf3f4] active:bg-[#f9d9dc] disabled:border-[#e0e0e0] disabled:text-[#bdbdbd]',
        ghost: 'border-transparent text-[#242424] hover:bg-[#f5f5f5] active:bg-[#e0e0e0] disabled:text-[#bdbdbd]',
        subtle: 'border-transparent text-[#242424] hover:bg-[#f5f5f5] active:bg-[#e0e0e0] disabled:text-[#bdbdbd]',
        link: 'h-auto border-transparent p-0 font-normal text-primary underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-6 px-2 text-xs',
        sm: 'h-8 px-3 text-sm',
        default: 'h-10 min-h-[40px] px-3 text-sm',
        lg: 'h-12 min-h-[48px] px-5 text-base font-semibold',
        xl: 'h-14 px-7 text-base font-semibold min-h-[56px]',
        'icon-xs': 'size-6 p-0',
        'icon-sm': 'size-8 p-0',
        icon: 'size-10 p-0 min-w-[40px] min-h-[40px]',
        'icon-lg': 'size-12 p-0 min-w-[48px] min-h-[48px]',
        'icon-xl': 'size-14 p-0 min-w-[56px] min-h-[56px]',
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
            <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center">
              <Spinner size="tiny" />
            </span>
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
