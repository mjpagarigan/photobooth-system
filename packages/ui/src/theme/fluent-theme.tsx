import {
  createLightTheme,
  FluentProvider,
  type BrandVariants,
  type Theme,
} from '@fluentui/react-components';
import React, { type ReactNode } from 'react';

/**
 * Microsoft Fluent 2 Web Brand Ramp anchored to #0F6CBD
 */
export const fluentBrandRamp: BrandVariants = {
  10: '#061724',
  20: '#082338',
  30: '#0a2e4a',
  40: '#0C3B5E', // pressed
  50: '#0E4775',
  60: '#0F548C',
  70: '#115EA3', // hover
  80: '#0F6CBD', // primary / fill
  90: '#2886de',
  100: '#479ef5',
  110: '#62abf5',
  120: '#77b7f7',
  130: '#96c6fa',
  140: '#b4d6fa',
  150: '#cfe4fa',
  160: '#EBF3FC', // tint / light
};

const baseTheme = createLightTheme(fluentBrandRamp);

/**
 * Customized Microsoft Fluent 2 Web theme for Grace Booth
 */
export const graceBoothFluentTheme: Theme = {
  ...baseTheme,

  // Brand Ramp
  colorBrandBackground: '#0F6CBD',
  colorBrandBackgroundHover: '#115EA3',
  colorBrandBackgroundPressed: '#0C3B5E',
  colorBrandBackground2: '#EBF3FC',
  colorBrandForeground1: '#0F6CBD',
  colorBrandForeground2: '#115EA3',

  // Neutral Foregrounds
  colorNeutralForeground1: '#242424',
  colorNeutralForeground2: '#424242',
  colorNeutralForeground3: '#616161',
  colorNeutralForeground4: '#707070',
  colorNeutralForegroundDisabled: '#BDBDBD',
  colorNeutralForegroundOnBrand: '#FFFFFF',

  // Neutral Backgrounds & Surfaces
  colorNeutralBackground1: '#FFFFFF',
  colorNeutralBackground2: '#FAFAFA',
  colorNeutralBackground3: '#F5F5F5',
  colorNeutralBackground4: '#F0F0F0',
  colorNeutralBackground1Hover: '#F5F5F5',
  colorNeutralBackground1Pressed: '#E0E0E0',
  colorNeutralBackground1Selected: '#EBEBEB',
  colorSubtleBackground: 'transparent',
  colorSubtleBackgroundHover: '#F5F5F5',
  colorSubtleBackgroundPressed: '#E0E0E0',

  // Strokes & Dividers
  colorNeutralStroke1: '#D1D1D1',
  colorNeutralStroke2: '#E0E0E0',
  colorNeutralStroke3: '#EDEBE9',
  colorNeutralStrokeSubtle: '#EBEBEB',

  // Shadows
  shadow2: '0px 0px 2px 0px rgba(0,0,0,0.12), 0px 1px 2px 0px rgba(0,0,0,0.14)',
  shadow4: '0px 0px 2px 0px rgba(0,0,0,0.12), 0px 2px 4px 0px rgba(0,0,0,0.14)',
  shadow8: '0px 0px 2px 0px rgba(0,0,0,0.12), 0px 4px 8px 0px rgba(0,0,0,0.14)',
  shadow16: '0px 0px 2px 0px rgba(0,0,0,0.12), 0px 8px 16px 0px rgba(0,0,0,0.14)',
  shadow28: '0px 0px 8px 0px rgba(0,0,0,0.12), 0px 14px 28px 0px rgba(0,0,0,0.14)',
  shadow64: '0px 0px 8px 0px rgba(0,0,0,0.12), 0px 32px 64px 0px rgba(0,0,0,0.14)',

  // Typography
  fontFamilyBase:
    "'Segoe UI Variable', 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, Roboto, sans-serif",
  fontFamilyMonospace: "Consolas, 'Courier New', monospace",
};

export type GraceBoothFluentProviderProps = {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

export function GraceBoothFluentProvider({
  children,
  className,
  style,
}: GraceBoothFluentProviderProps): React.JSX.Element {
  return (
    <FluentProvider
      className={className}
      style={{
        display: 'contents',
        ...style,
      }}
      theme={graceBoothFluentTheme}
    >
      {children}
    </FluentProvider>
  );
}
