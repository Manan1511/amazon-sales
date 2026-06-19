import React, { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import type { Period } from '../types';
import { usePlatform } from './PlatformContext';

interface PeriodState {
  selectedPeriod: Period | null;
  periods: Period[];
}

type PeriodAction =
  | { type: 'SET_PERIOD'; payload: Period | null }
  | { type: 'SET_PERIODS'; payload: Period[] }
  | { type: 'ADD_PERIOD'; payload: Period }
  | { type: 'REMOVE_PERIOD'; payload: string };

function periodReducer(state: PeriodState, action: PeriodAction): PeriodState {
  switch (action.type) {
    case 'SET_PERIOD':
      return { ...state, selectedPeriod: action.payload };
    case 'SET_PERIODS':
      return { ...state, periods: action.payload };
    case 'ADD_PERIOD':
      return {
        ...state,
        periods: [action.payload, ...state.periods.filter((p) => p.id !== action.payload.id)],
      };
    case 'REMOVE_PERIOD':
      return {
        ...state,
        periods: state.periods.filter((p) => p.id !== action.payload),
        selectedPeriod:
          state.selectedPeriod?.id === action.payload ? null : state.selectedPeriod,
      };
    default:
      return state;
  }
}

interface PeriodContextValue {
  state: PeriodState;
  dispatch: React.Dispatch<PeriodAction>;
  setSelectedPeriod: (period: Period | null) => void;
}

const PeriodContext = createContext<PeriodContextValue | null>(null);

interface PeriodProviderProps {
  children: ReactNode;
}

export function PeriodProvider({ children }: PeriodProviderProps) {
  const { platform } = usePlatform();
  const STORAGE_KEY = `dashboard_period_id_${platform}`;

  const [state, dispatch] = useReducer(periodReducer, {
    selectedPeriod: null,
    periods: [],
  });

  // Reset/restore selected period when platform changes
  useEffect(() => {
    const savedId = localStorage.getItem(`dashboard_period_id_${platform}`);
    if (savedId) {
      if (savedId.startsWith('YTD_')) {
        const year = parseInt(savedId.split('_')[1], 10);
        const ytdPeriod: Period = {
          id: savedId,
          month: 'YTD',
          year,
          uploaded_at: new Date().toISOString(),
          row_count: null,
        };
        dispatch({ type: 'SET_PERIOD', payload: ytdPeriod });
      } else {
        const found = state.periods.find((p) => p.id === savedId);
        if (found) {
          dispatch({ type: 'SET_PERIOD', payload: found });
        } else {
          dispatch({ type: 'SET_PERIOD', payload: null });
        }
      }
    } else {
      dispatch({ type: 'SET_PERIOD', payload: null });
    }
  }, [platform, state.periods]);

  // Persist selected period ID to localStorage
  useEffect(() => {
    if (state.selectedPeriod) {
      localStorage.setItem(STORAGE_KEY, state.selectedPeriod.id);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, [state.selectedPeriod, STORAGE_KEY]);

  // Restore selected period from localStorage after periods load
  useEffect(() => {
    if (state.periods.length === 0) return;
    const savedId = localStorage.getItem(STORAGE_KEY);
    if (savedId && !state.selectedPeriod) {
      if (savedId.startsWith('YTD_')) {
        const year = parseInt(savedId.split('_')[1], 10);
        const ytdPeriod: Period = {
          id: savedId,
          month: 'YTD',
          year,
          uploaded_at: new Date().toISOString(),
          row_count: null,
        };
        dispatch({ type: 'SET_PERIOD', payload: ytdPeriod });
      } else if (savedId.startsWith('MULTI_')) {
        const ids = savedId.replace('MULTI_', '').split(',');
        const first = state.periods.find((p) => p.id === ids[0]);
        const last = state.periods.find((p) => p.id === ids[ids.length - 1]);
        if (first && last) {
           const multiPeriod: Period = {
             id: savedId,
             month: `${first.month} - ${last.month}`,
             year: first.year === last.year ? first.year : ('Multiple' as any),
             uploaded_at: new Date().toISOString(),
             row_count: null,
           };
           dispatch({ type: 'SET_PERIOD', payload: multiPeriod });
        }
      } else {
        const found = state.periods.find((p) => p.id === savedId);
        if (found) {
          dispatch({ type: 'SET_PERIOD', payload: found });
        }
      }
    }
  }, [state.periods, state.selectedPeriod, STORAGE_KEY]);

  function setSelectedPeriod(period: Period | null) {
    dispatch({ type: 'SET_PERIOD', payload: period });
  }

  return (
    <PeriodContext.Provider value={{ state, dispatch, setSelectedPeriod }}>
      {children}
    </PeriodContext.Provider>
  );
}

export function usePeriodContext(): PeriodContextValue {
  const ctx = useContext(PeriodContext);
  if (!ctx) {
    throw new Error('usePeriodContext must be used inside PeriodProvider');
  }
  return ctx;
}
