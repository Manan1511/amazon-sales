import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type Platform = 'amazon' | 'shopify';

interface PlatformContextValue {
  platform: Platform;
  setPlatform: (platform: Platform) => void;
}

const PlatformContext = createContext<PlatformContextValue | null>(null);

const STORAGE_KEY = 'dashboard_active_platform';

export function PlatformProvider({ children }: { children: ReactNode }) {
  const [platform, setPlatformState] = useState<Platform>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return (saved === 'shopify' ? 'shopify' : 'amazon') as Platform;
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, platform);
  }, [platform]);

  const setPlatform = (p: Platform) => {
    setPlatformState(p);
  };

  return (
    <PlatformContext.Provider value={{ platform, setPlatform }}>
      {children}
    </PlatformContext.Provider>
  );
}

export function usePlatform(): PlatformContextValue {
  const ctx = useContext(PlatformContext);
  if (!ctx) {
    throw new Error('usePlatform must be used inside PlatformProvider');
  }
  return ctx;
}
