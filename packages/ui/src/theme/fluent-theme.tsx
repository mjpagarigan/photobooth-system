import {
  createLightTheme,
  FluentProvider,
  type BrandVariants,
  type Theme,
} from '@fluentui/react-components';
import React, { type ReactNode } from 'react';

/**
 * Brand ramp anchored to the Apple-style action blue #0071E3
 */
export const fluentBrandRamp: BrandVariants = {
  10: '#001a33',
  20: '#00264d',
  30: '#003366',
  40: '#004c99',
  50: '#005bb8',
  60: '#0066cc',
  70: '#006edb',
  80: '#0071e3',
  90: '#0077ed',
  100: '#2b8cf0',
  110: '#4d9ff2',
  120: '#70b2f5',
  130: '#94c6f7',
  140: '#b8d9fa',
  150: '#d6e8fb',
  160: '#e8f2fd',
};

const baseTheme = createLightTheme(fluentBrandRamp);

const appleFontStack =
  "'Inter Variable', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

export const graceBoothFluentTheme: Theme = {
  ...baseTheme,

  colorBrandBackground: '#0071E3',
  colorBrandBackgroundHover: '#0077ED',
  colorBrandBackgroundPressed: '#006EDB',
  colorBrandBackground2: '#E8F2FD',
  colorBrandForeground1: '#0066CC',
  colorBrandForeground2: '#004C99',

  colorNeutralForeground1: '#1D1D1F',
  colorNeutralForeground2: '#424245',
  colorNeutralForeground3: '#6E6E73',
  colorNeutralForeground4: '#86868B',
  colorNeutralForegroundDisabled: '#AEAEB2',
  colorNeutralForegroundOnBrand: '#FFFFFF',

  colorNeutralBackground1: '#FFFFFF',
  colorNeutralBackground2: '#FBFBFD',
  colorNeutralBackground3: '#F5F5F7',
  colorNeutralBackground4: '#E8E8ED',
  colorNeutralBackground1Hover: '#F5F5F7',
  colorNeutralBackground1Pressed: '#E8E8ED',
  colorNeutralBackground1Selected: '#E8E8ED',
  colorSubtleBackground: 'transparent',
  colorSubtleBackgroundHover: '#F5F5F7',
  colorSubtleBackgroundPressed: '#E8E8ED',

  colorNeutralStroke1: '#D2D2D7',
  colorNeutralStroke2: '#E8E8ED',
  colorNeutralStroke3: '#F0F0F2',
  colorNeutralStrokeSubtle: '#F0F0F2',

  shadow2: '0px 1px 2px rgba(0,0,0,0.04), 0px 1px 1px rgba(0,0,0,0.03)',
  shadow4: '0px 2px 8px rgba(0,0,0,0.06)',
  shadow8: '0px 4px 16px rgba(0,0,0,0.07)',
  shadow16: '0px 10px 30px rgba(0,0,0,0.08)',
  shadow28: '0px 16px 40px rgba(0,0,0,0.12)',
  shadow64: '0px 24px 60px rgba(0,0,0,0.16)',

  borderRadiusSmall: '6px',
  borderRadiusMedium: '12px',
  borderRadiusLarge: '18px',
  borderRadiusXLarge: '28px',

  fontFamilyBase: appleFontStack,
  fontFamilyMonospace: "ui-monospace, 'SF Mono', Consolas, monospace",
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
