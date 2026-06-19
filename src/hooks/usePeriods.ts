import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { usePeriodContext } from '../context/PeriodContext';
import { usePlatform } from '../context/PlatformContext';
import type { Period } from '../types';

interface UsePeriodsResult {
  periods: Period[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Fetches all periods from Supabase, ordered by year and month descending.
 * Also populates the PeriodContext with the fetched list.
 */
export function usePeriods(): UsePeriodsResult {
  const { dispatch } = usePeriodContext();
  const { platform } = usePlatform();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const table = platform === 'shopify' ? 'shopify_periods' : 'periods';
      const { data, error: dbError } = await supabase
        .from(table)
        .select('*')
        .order('year', { ascending: false })
        .order('uploaded_at', { ascending: false });

      if (dbError) throw new Error(dbError.message);

      const result = (data ?? []) as Period[];
      setPeriods(result);
      dispatch({ type: 'SET_PERIODS', payload: result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch periods';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [dispatch, platform]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  return { periods, loading, error, refetch: fetch };
}
