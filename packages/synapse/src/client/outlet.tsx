import type React from 'react';
import { createContext, type ReactNode, useContext } from 'react';

export interface SliceOutletContextValue {
  content?: ReactNode;
  outlets?: Record<string, ReactNode>;
}

const SliceOutletContext = createContext<SliceOutletContextValue>({});

export interface SliceOutletProviderProps {
  content?: ReactNode;
  outlets?: Record<string, ReactNode>;
  children: ReactNode;
}

export function SliceOutletProvider({ content, outlets = {}, children }: SliceOutletProviderProps) {
  return <SliceOutletContext.Provider value={{ content, outlets }}>{children}</SliceOutletContext.Provider>;
}

export interface SliceOutletProps {
  name?: string;
  fallback?: ReactNode;
  children?: ReactNode;
}

/**
 * <SliceOutlet /> renders nested content within Root or Domain Layouts,
 * enabling parallel sub-panels and composable nested views.
 */
export function SliceOutlet({ name, fallback = null, children }: SliceOutletProps): React.ReactElement | null {
  const ctx = useContext(SliceOutletContext);
  if (children) {
    return <>{children}</>;
  }
  if (name && ctx.outlets) {
    return <>{ctx.outlets[name] ?? fallback}</>;
  }
  return <>{ctx.content ?? fallback}</>;
}
