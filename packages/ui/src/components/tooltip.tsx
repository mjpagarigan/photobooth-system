import { Tooltip as BaseTooltip } from '@base-ui/react';
import React, { forwardRef } from 'react';
import { cn } from '../lib/utils';

export const TooltipProvider = BaseTooltip.Provider;
export const Tooltip = BaseTooltip.Root;
export const TooltipTrigger = BaseTooltip.Trigger;

export type TooltipPopupProps = {
  portalProps?: React.ComponentPropsWithoutRef<typeof BaseTooltip.Portal>;
  positionerProps?: React.ComponentPropsWithoutRef<typeof BaseTooltip.Positioner>;
} & React.ComponentPropsWithoutRef<typeof BaseTooltip.Popup>

export const TooltipPopup = forwardRef<HTMLDivElement, TooltipPopupProps>(
  function TooltipPopup({ className, children, portalProps, positionerProps, ...props }, ref) {
    return (
      <BaseTooltip.Portal {...portalProps}>
        <BaseTooltip.Positioner sideOffset={4} {...positionerProps}>
          <BaseTooltip.Popup
            className={cn(
              'z-50 overflow-hidden rounded-md border border-border/40 bg-card px-3 py-1.5 font-sans text-xs text-foreground shadow-md transition-all duration-150',
              className,
            )}
            ref={ref}
            {...props}
          >
            {children}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    );
  },
);
