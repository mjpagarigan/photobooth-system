import { cva, type VariantProps } from 'class-variance-authority';
import { useRender } from '@base-ui/react/use-render';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { SpinnerGap } from './icons';
import { cn } from '../lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border font-sans text-sm font-semibold leading-5 tracking-normal transition-[background-color,border-color,color] duration-100 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:pointer-events-none select-none cursor-pointer',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-white hover:bg-[#0071e3] active:bg-[#00539f] disabled:bg-[#e8e8ed] disabled:text-[#aeaeb2]',
        primary:
          'border-transparent bg-primary text-white hover:bg-[#0071e3] active:bg-[#00539f] disabled:bg-[#e8e8ed] disabled:text-[#aeaeb2]',
        secondary:
          'border-[#d2d2d7] bg-white text-[#1d1d1f] hover:bg-[#f5f5f7] active:bg-[#e8e8ed] disabled:border-[#e8e8ed] disabled:bg-[#e8e8ed] disabled:text-[#aeaeb2]',
        outline:
          'border-[#d2d2d7] bg-white text-[#1d1d1f] hover:bg-[#f5f5f7] active:bg-[#e8e8ed] disabled:border-[#e8e8ed] disabled:bg-transparent disabled:text-[#aeaeb2]',
        destructive:
          'border-transparent bg-[#d70015] text-white hover:bg-[#b80012] active:bg-[#9c0010] disabled:bg-[#e8e8ed] disabled:text-[#aeaeb2]',
        'destructive-outline':
          'border-[#d70015] text-[#d70015] bg-transparent hover:bg-[#ffecee] active:bg-[#ffccd1] disabled:border-[#e8e8ed] disabled:text-[#aeaeb2]',
        ghost:
          'border-transparent text-[#1d1d1f] hover:bg-[#f5f5f7] active:bg-[#e8e8ed] disabled:text-[#aeaeb2]',
        subtle:
          'border-transparent text-[#1d1d1f] hover:bg-[#f5f5f7] active:bg-[#e8e8ed] disabled:text-[#aeaeb2]',
        link: 'h-auto border-transparent p-0 font-normal text-primary underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-6 px-2.5 text-xs',
        sm: 'h-8 px-3 text-sm',
        default: 'h-10 min-h-[40px] px-4 text-sm',
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
  wide?: boolean;
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
    wide = false,
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
      className: cn(buttonVariants({ variant, size }), wide && 'w-full', className),
      disabled: disabled ? true : loading,
      type,
      ...props,
      children: (
        <>
          {loading ? (
            <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center">
              <SpinnerGap aria-hidden="true" className="motion-safe:animate-spin" size={16} />
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
