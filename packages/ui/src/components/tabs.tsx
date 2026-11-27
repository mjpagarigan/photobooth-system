import { Tabs as BaseTabs } from '@base-ui/react';
import React, { createContext, forwardRef, useContext } from 'react';
import { cn } from '../lib/utils';

export type TabsVariant = 'default' | 'underline' | 'segmented';

const TabsVariantContext = createContext<TabsVariant>('underline');

export const Tabs = BaseTabs.Root;

export type TabsListProps = {
  variant?: TabsVariant;
  size?: 'sm' | 'default' | 'lg';
} & React.ComponentPropsWithoutRef<typeof BaseTabs.List>;

export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(function TabsList(
  { className, variant = 'underline', size = 'default', ...props },
  ref,
) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <BaseTabs.List
        className={cn(
          variant === 'segmented'
            ? 'grid w-full grid-flow-col auto-cols-fr items-center gap-[2px] rounded-[10px] border-0 bg-[#f5f5f7] p-[3px] text-[#424245]'
            : 'inline-flex items-center border-b border-[#e8e8ed] bg-transparent p-0 text-[#636366]',
          variant === 'underline' && 'gap-0',
          variant === 'default' && 'gap-2',
          size === 'sm' && 'min-h-[32px] text-sm',
          size === 'default' && 'min-h-[44px] text-sm',
          size === 'lg' && 'min-h-[48px] text-base',
          className,
        )}
        ref={ref}
        {...props}
      />
    </TabsVariantContext.Provider>
  );
});

export type TabsTabProps = {
  size?: 'sm' | 'default' | 'lg';
} & React.ComponentPropsWithoutRef<typeof BaseTabs.Tab>;

export const TabsTab = forwardRef<HTMLButtonElement, TabsTabProps>(function TabsTab(
  { className, size, ...props },
  ref,
) {
  const variant = useContext(TabsVariantContext);

  return (
    <BaseTabs.Tab
      className={cn(
        'relative inline-flex cursor-pointer select-none items-center justify-center whitespace-nowrap font-sans tracking-normal transition-colors focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:pointer-events-none disabled:text-[#aeaeb2]',
        variant === 'segmented'
          ? 'rounded-[8px] border-0 bg-transparent px-3 py-1.5 font-medium text-[#424245] hover:text-[#1d1d1f] data-active:bg-white data-active:font-semibold data-active:text-[#1d1d1f] data-active:shadow-[var(--shadow-2)]'
          : 'rounded-t-[6px] px-4 py-2 font-semibold text-[#636366] hover:bg-[#f5f5f7] hover:text-[#1d1d1f] active:bg-[#e8e8ed] data-active:text-[#1d1d1f] after:absolute after:bottom-0 after:left-2 after:right-2 after:h-[2px] after:rounded-full after:bg-transparent data-active:after:bg-primary',
        size === 'sm' && 'px-3 py-1.5 text-xs',
        size === 'default' && 'px-4 py-2 text-sm min-h-[40px]',
        size === 'lg' && 'px-6 py-2.5 text-base min-h-[44px]',
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
