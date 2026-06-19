import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { usePlatform } from '../context/PlatformContext';

/** Supabase default page size */
const PAGE_SIZE = 1000;

interface UseRecordsResult {
  records: any[];
  loading: boolean;
  error: string | null;
}

/** Cache keyed by periodId */
const recordCache = new Map<string, any[]>();

/**
 * Fetches all consolidated records for the given period.
 * Uses range-based pagination (1000 rows per page) to handle large datasets.
 * Results are cached in memory — if the same periodId is requested again, serves from cache.
 */
export function useRecords(periodId: string | null): UseRecordsResult {
  const { platform } = usePlatform();
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  const fetchAll = useCallback(async (id: string) => {
    // Serve from cache if available
    const cacheKey = `${platform}_${id}`;
    if (recordCache.has(cacheKey)) {
      setRecords(recordCache.get(cacheKey)!);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    abortRef.current = false;

    const allRows: any[] = [];
    const periodsTable = platform === 'shopify' ? 'shopify_periods' : 'periods';
    const recordsTable = platform === 'shopify' ? 'shopify_records' : 'consolidated_records';

    try {
      let periodIds: string[] = [id];

      // Handle MULTI and YTD virtual periods
      if (id.startsWith('MULTI_')) {
        periodIds = id.replace('MULTI_', '').split(',');
      } else if (id.startsWith('YTD_')) {
        const year = parseInt(id.split('_')[1], 10);
        const { data: matchingPeriods, error: periodsError } = await supabase
          .from(periodsTable)
          .select('id')
          .eq('year', year);

        if (periodsError) throw new Error(periodsError.message);
        periodIds = (matchingPeriods ?? []).map((p) => p.id);
        
        if (periodIds.length === 0) {
          if (!abortRef.current) {
            setRecords([]);
            setLoading(false);
          }
          return;
        }
      }

      // Get count first
      const { count, error: countError } = await supabase
        .from(recordsTable)
        .select('*', { count: 'exact', head: true })
        .in('period_id', periodIds);

      if (countError) throw new Error(countError.message);

      const totalCount = count ?? 0;
      if (totalCount > 0) {
        const pages = Math.ceil(totalCount / PAGE_SIZE);
        const promises = Array.from({ length: pages }, (_, i) => {
          const fromOffset = i * PAGE_SIZE;
          return supabase
            .from(recordsTable)
            .select('*')
            .in('period_id', periodIds)
            .range(fromOffset, fromOffset + PAGE_SIZE - 1);
        });

        const responses = await Promise.all(promises);
        for (const res of responses) {
          if (res.error) throw new Error(res.error.message);
          allRows.push(...(res.data ?? []));
        }
      }

      if (!abortRef.current) {
        recordCache.set(cacheKey, allRows);
        setRecords(allRows);
      }
    } catch (err) {
      if (!abortRef.current) {
        const msg = err instanceof Error ? err.message : 'Failed to fetch records';
        setError(msg);
      }
    } finally {
      if (!abortRef.current) {
        setLoading(false);
      }
    }
  }, [platform]);

  useEffect(() => {
    if (!periodId) {
      Promise.resolve().then(() => {
        setRecords([]);
        setLoading(false);
        setError(null);
      });
      return;
    }

    void fetchAll(periodId);

    return () => {
      abortRef.current = true;
    };
  }, [periodId, fetchAll]);

  return { records, loading, error };
}

/** Clears cache for a specific period (call after re-upload) */
export function invalidateRecordsCache(periodId: string): void {
  // Clear both amazon and shopify cache keys for this period id
  recordCache.delete(`amazon_${periodId}`);
  recordCache.delete(`shopify_${periodId}`);
}

/** Clears entire cache */
export function clearRecordsCache(): void {
  recordCache.clear();
}
