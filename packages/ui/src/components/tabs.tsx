import { Tabs as BaseTabs } from '@base-ui/react';
import React, { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const Tabs = BaseTabs.Root;

export type TabsListProps = {
  variant?: 'default' | 'underline' | 'segmented';
  size?: 'sm' | 'default' | 'lg';
} & React.ComponentPropsWithoutRef<typeof BaseTabs.List>;

export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(function TabsList(
  { className, variant = 'underline', size = 'default', ...props },
  ref,
) {
  return (
    <BaseTabs.List
      className={cn(
        'inline-flex items-center gap-0 border-b border-[#e0e0e0] bg-transparent p-0 text-[#616161]',
        variant === 'segmented' &&
          'grid w-full grid-flow-col auto-cols-fr rounded-[4px] border-none bg-[#f5f5f5] p-1',
        variant === 'default' && 'gap-2 border-b border-[#e0e0e0] bg-transparent',
        size === 'sm' && 'min-h-[32px] text-sm',
        size === 'default' && 'min-h-[44px] text-sm',
        size === 'lg' && 'min-h-[50px] text-base',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

export type TabsTabProps = {
  size?: 'sm' | 'default' | 'lg';
} & React.ComponentPropsWithoutRef<typeof BaseTabs.Tab>;

export const TabsTab = forwardRef<HTMLButtonElement, TabsTabProps>(function TabsTab(
  { className, size, ...props },
  ref,
) {
  return (
    <BaseTabs.Tab
      className={cn(
        'relative inline-flex cursor-pointer select-none items-center justify-center whitespace-nowrap rounded-t-[4px] px-4 py-2 font-sans font-semibold tracking-normal text-[#616161] transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-white focus-visible:shadow-[0_0_0_2px_#000] disabled:pointer-events-none disabled:text-[#bdbdbd]',
        'hover:bg-[#f5f5f5] hover:text-[#242424] active:bg-[#e0e0e0]',
        'data-active:text-[#242424] data-active:font-semibold',
        'after:absolute after:bottom-0 after:left-2 after:right-2 after:h-[3px] after:rounded-t-[2px] after:bg-transparent data-active:after:bg-primary',
        size === 'sm' && 'px-3 py-1.5 text-xs',
        size === 'default' && 'px-4 py-2 text-sm min-h-[40px]',
        size === 'lg' && 'px-6 py-2.5 text-base min-h-[48px]',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});

export const TabsPanel = forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<typeof BaseTabs.Panel>
>(function TabsPanel({ className, ...props }, ref) {
  return (
    <BaseTabs.Panel
      className={cn('flex-1 focus-visible:outline-none', className)}
      ref={ref}
      {...props}
    />
  );
});
