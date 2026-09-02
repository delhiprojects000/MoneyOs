import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

/**
 * Light/dark mode and the accent palette.
 *
 * Both are per-device preferences held in localStorage: MoneyOS has no shared
 * workspace, so there is nothing to sync. The palette writes its HSL values
 * onto CSS custom properties; see DEVDOC "Theming".
 *
 * @module theming
 */

type Mode = 'light' | 'dark';
export type ColorPalette = 'emerald' | 'ocean' | 'sunset' | 'violet' | 'rose' | 'slate' | 'custom';

/** Converts `#rrggbb` to the `"H S% L%"` triple Tailwind's tokens expect. @public */
export function hexToHSL(hex: string): string {
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function withLightness(hsl: string, lightness: number, saturationScale = 1): string {
  const [h, s] = hsl.match(/[\d.]+/g)!.map(Number);
  return `${h} ${Math.min(100, Math.round(s * saturationScale))}% ${lightness}%`;
}

export const colorPalettes: Record<Exclude<ColorPalette, 'custom'>, Record<string, string>> = {
  emerald: {
    primary: hexToHSL('#059669'), accent: hexToHSL('#0d9488'),
    darkPrimary: hexToHSL('#34d399'), darkAccent: hexToHSL('#2dd4bf'),
  },
  ocean: {
    primary: hexToHSL('#0284c7'), accent: hexToHSL('#0891b2'),
    darkPrimary: hexToHSL('#38bdf8'), darkAccent: hexToHSL('#22d3ee'),
  },
  sunset: {
    primary: hexToHSL('#ea580c'), accent: hexToHSL('#d97706'),
    darkPrimary: hexToHSL('#fb923c'), darkAccent: hexToHSL('#fbbf24'),
  },
  violet: {
    primary: hexToHSL('#7c3aed'), accent: hexToHSL('#a21caf'),
    darkPrimary: hexToHSL('#a78bfa'), darkAccent: hexToHSL('#e879f9'),
  },
  rose: {
    primary: hexToHSL('#e11d48'), accent: hexToHSL('#db2777'),
    darkPrimary: hexToHSL('#fb7185'), darkAccent: hexToHSL('#f472b6'),
  },
  slate: {
    primary: hexToHSL('#334155'), accent: hexToHSL('#0f766e'),
    darkPrimary: hexToHSL('#94a3b8'), darkAccent: hexToHSL('#5eead4'),
  },
};

function buildCustomPalette(primaryHex: string, accentHex: string): Record<string, string> {
  const primary = hexToHSL(primaryHex);
  const accent = hexToHSL(accentHex);
  return { primary, accent, darkPrimary: withLightness(primary, 62), darkAccent: withLightness(accent, 58) };
}

const PALETTE_IDS: ColorPalette[] = ['emerald', 'ocean', 'sunset', 'violet', 'rose', 'slate', 'custom'];

interface ThemeContextType {
  theme: Mode;
  toggleTheme: () => void;
  setThemeMode: (mode: Mode) => void;
  colorPalette: ColorPalette;
  setColorPalette: (palette: ColorPalette) => void;
  customPrimaryHex: string;
  customAccentHex: string;
  setCustomColors: (primaryHex: string, accentHex: string) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const DEFAULT_CUSTOM_PRIMARY = '#059669';
const DEFAULT_CUSTOM_ACCENT = '#0d9488';

/** @public */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Mode>(() => {
    const stored = localStorage.getItem('moneyos-theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [colorPalette, setColorPaletteState] = useState<ColorPalette>(() => {
    const stored = localStorage.getItem('moneyos-palette');
    return PALETTE_IDS.includes(stored as ColorPalette) ? (stored as ColorPalette) : 'emerald';
  });
  const [customPrimaryHex, setCustomPrimaryHex] = useState(() => localStorage.getItem('moneyos-custom-primary') || DEFAULT_CUSTOM_PRIMARY);
  const [customAccentHex, setCustomAccentHex] = useState(() => localStorage.getItem('moneyos-custom-accent') || DEFAULT_CUSTOM_ACCENT);

  const applyColors = () => {
    const colors = colorPalette === 'custom' ? buildCustomPalette(customPrimaryHex, customAccentHex) : colorPalettes[colorPalette];
    const root = document.documentElement;
    const isDark = root.classList.contains('dark');
    const primary = isDark ? colors.darkPrimary : colors.primary;
    const accent = isDark ? colors.darkAccent : colors.accent;
    root.style.setProperty('--primary', primary);
    root.style.setProperty('--ring', primary);
    root.style.setProperty('--accent', accent);
  };

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    localStorage.setItem('moneyos-theme', theme);
    applyColors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, colorPalette, customPrimaryHex, customAccentHex]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  const setThemeMode = (mode: Mode) => setTheme(mode);

  const setColorPalette = (palette: ColorPalette) => {
    setColorPaletteState(palette);
    localStorage.setItem('moneyos-palette', palette);
  };

  const setCustomColors = (primaryHex: string, accentHex: string) => {
    setColorPaletteState('custom');
    setCustomPrimaryHex(primaryHex);
    setCustomAccentHex(accentHex);
    localStorage.setItem('moneyos-palette', 'custom');
    localStorage.setItem('moneyos-custom-primary', primaryHex);
    localStorage.setItem('moneyos-custom-accent', accentHex);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setThemeMode, colorPalette, setColorPalette, customPrimaryHex, customAccentHex, setCustomColors }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** @throws If used outside ThemeProvider. @public */
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
