import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { parseSettlementFiles } from '../lib/processing/parseSettlement';
import { parseMTRFile } from '../lib/processing/parseMTR';
import { aggregateSettlement, consolidate } from '../lib/processing/consolidate';
import { enrichRows } from '../lib/processing/enrichment';
import { buildFeeRecords, uploadToSupabase } from '../lib/processing/upload';
import { parseShopifyFile } from '../lib/processing/shopifyParser';
import { uploadShopifyToSupabase } from '../lib/processing/shopifyUpload';
import { supabase } from '../lib/supabase';
import { usePeriodContext } from '../context/PeriodContext';
import { usePlatform } from '../context/PlatformContext';
import { ProgressBar } from '../components/ui/ProgressBar';
import { invalidateRecordsCache } from '../hooks/useRecords';
import { invalidateFeesCache } from '../hooks/useFees';
import type { LogEntry, Period } from '../types';
import {
  Calendar,
  FileSpreadsheet,
  AlertTriangle,
  FileText,
  Upload,
  ClipboardList,
  CheckCircle2,
  ChevronRight,
  Play,
  Loader2,
  Truck,
} from 'lucide-react';
import './UploadPage.css';

/** Months for the month dropdown */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const CURRENT_YEAR = new Date().getFullYear();

export function UploadPage() {
  const navigate = useNavigate();
  const { dispatch } = usePeriodContext();
  const { platform } = usePlatform();

  // Form state
  const [selectedMonth, setSelectedMonth] = useState('');
  const [selectedYear, setSelectedYear] = useState(String(CURRENT_YEAR));
  const [settlementFiles, setSettlementFiles] = useState<FileList | null>(null);
  const [mtrFiles, setMtrFiles] = useState<File[]>([]);
  const [shopifyFile, setShopifyFile] = useState<File | null>(null);

  // Reconciliation states
  const [recoTallyFile, setRecoTallyFile] = useState<File | null>(null);
  const [recoAwbFile, setRecoAwbFile] = useState<File | null>(null);
  const [recoResult, setRecoResult] = useState<any[] | null>(null);
  const [recoSummary, setRecoSummary] = useState<any | null>(null);
  const [recoRunning, setRecoRunning] = useState(false);
  const [recoTallyDragging, setRecoTallyDragging] = useState(false);
  const [recoAwbDragging, setRecoAwbDragging] = useState(false);
  const [recoError, setRecoError] = useState<string | null>(null);

  // Processing state
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [uploadDone, setUploadDone] = useState(false);

  // Period conflict
  const [existingPeriod, setExistingPeriod] = useState<Period | null>(null);
  const [conflictConfirmed, setConflictConfirmed] = useState(false);

  // Drag state
  const [settlementDragging, setSettlementDragging] = useState(false);
  const [mtrDragging, setMtrDragging] = useState(false);
  const [shopifyDragging, setShopifyDragging] = useState(false);

  const settlementInputRef = useRef<HTMLInputElement>(null);
  const mtrInputRef = useRef<HTMLInputElement>(null);
  const shopifyInputRef = useRef<HTMLInputElement>(null);
  const recoTallyInputRef = useRef<HTMLInputElement>(null);
  const recoAwbInputRef = useRef<HTMLInputElement>(null);
  const logBottomRef = useRef<HTMLDivElement>(null);

  function addLog(message: string, type: LogEntry['type'] = 'info') {
    const timestamp = new Date().toLocaleTimeString('en-IN', { hour12: false });
    setLogs((prev) => [...prev, { timestamp, message, type }]);
    setTimeout(() => {
      logBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  }

  async function checkPeriodConflict(month: string, year: number): Promise<Period | null> {
    const table = platform === 'shopify' ? 'shopify_periods' : 'periods';
    const { data } = await supabase
      .from(table)
      .select('*')
      .eq('month', month)
      .eq('year', year)
      .maybeSingle();
    return (data as Period | null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const year = parseInt(selectedYear, 10);
    if (isNaN(year) || year < 2000 || year > 2100) {
      addLog('❌ Please enter a valid year (2000–2100).', 'error');
      return;
    }

    if (platform === 'shopify') {
      if (!selectedMonth || !selectedYear || !shopifyFile) {
        addLog('❌ Please fill in all fields and select a Shopify GST file.', 'error');
        return;
      }

      setProcessing(true);
      setLogs([]);
      setUploadDone(false);
      setProgress(0);

      try {
        // Check for conflict
        const conflict = await checkPeriodConflict(selectedMonth, year);
        if (conflict && !conflictConfirmed) {
          setExistingPeriod(conflict);
          setProcessing(false);
          return;
        }

        addLog(`Parsing Shopify report: ${shopifyFile.name}...`, 'info');
        setProgress(20);
        const parsedRows = await parseShopifyFile(shopifyFile);
        addLog(`Successfully parsed ${parsedRows.length} rows (filtered out CAN_INVOICE records).`, 'success');
        setProgress(50);

        addLog('Uploading to database...', 'info');
        const uploadResult = await uploadShopifyToSupabase(
          selectedMonth,
          year,
          parsedRows,
          (_step, pct, log) => {
            setProgress(50 + Math.round(pct * 0.5));
            if (log) addLog(log, 'info');
          }
        );

        addLog(`✅ Done! ${uploadResult.rowCount} rows uploaded.`, 'success');
        setProgress(100);
        setUploadDone(true);

        // Invalidate frontend data caches
        invalidateRecordsCache(uploadResult.periodId);

        // Update context
        const { data: newPeriod } = await supabase
          .from('shopify_periods')
          .select('*')
          .eq('id', uploadResult.periodId)
          .single();

        if (newPeriod) {
          dispatch({ type: 'ADD_PERIOD', payload: newPeriod as Period });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'An unexpected error occurred';
        addLog(`❌ ${msg}`, 'error');
        setProgress(0);
      } finally {
        setProcessing(false);
      }
      return;
    }

    // Amazon upload path
    if (!selectedMonth || !selectedYear || !settlementFiles || mtrFiles.length === 0) {
      addLog('❌ Please fill in all fields before processing.', 'error');
      return;
    }

    setProcessing(true);
    setLogs([]);
    setUploadDone(false);
    setProgress(0);

    try {
      // Check for conflict
      const conflict = await checkPeriodConflict(selectedMonth, year);
      if (conflict && !conflictConfirmed) {
        setExistingPeriod(conflict);
        setProcessing(false);
        return;
      }

      // Step 1 — Parse settlement files
      addLog(`Loading ${settlementFiles.length} settlement file(s)...`, 'info');
      setProgress(5);
      const { rows: settlementRows, allUnfilteredRows, depositDateMap, warnings } = await parseSettlementFiles(settlementFiles);
      addLog(`  Loaded ${settlementRows.length} settlement rows`, 'info');
      warnings.forEach((w) => addLog(w, 'warning'));

      // Step 2 — Validate headers
      addLog('Validating headers...', 'info');
      setProgress(15);

      // Step 3 — Aggregate settlement data
      addLog('Aggregating settlement data...', 'info');
      setProgress(25);
      const summaryMap = aggregateSettlement(settlementRows, depositDateMap);
      addLog(`  Aggregated ${summaryMap.size} unique orders from settlement`, 'info');

      // Step 4 — Parse MTR files
      addLog(`Loading ${mtrFiles.length} MTR file(s)...`, 'info');
      setProgress(35);
      let mtrRows: any[] = [];
      for (const file of mtrFiles) {
        addLog(`  Parsing ${file.name}...`, 'info');
        const isB2B = file.name.toUpperCase().includes('B2B');
        const fileType = isB2B ? 'B2B' : 'B2C';
        const fileRows = await parseMTRFile(file);
        const taggedRows = fileRows.map((r) => ({
          ...r,
          type: fileType,
        }));
        addLog(`    Loaded ${fileRows.length} rows (${fileType}) from ${file.name}`, 'info');
        mtrRows = mtrRows.concat(taggedRows);
      }
      addLog(`  Combined MTR records: ${mtrRows.length} rows`, 'info');

      // Step 5 — Join datasets
      addLog('Joining datasets...', 'info');
      setProgress(45);
      const joinWarnings: string[] = [];
      const rawConsolidated = consolidate(mtrRows, summaryMap, 'placeholder', joinWarnings);
      joinWarnings.forEach((w) => addLog(w, 'warning'));
      addLog(`  Joined ${rawConsolidated.length} records`, 'info');

      // Step 6 — Proportional split + enrichment
      addLog('Splitting charges for multi-invoice orders...', 'info');
      setProgress(55);
      const enriched = enrichRows(rawConsolidated, mtrRows);
      addLog(`  Enriched ${enriched.length} records with payment type & fulfillment channel`, 'info');

      // Build fee records
      const feeRecords = buildFeeRecords(allUnfilteredRows, 'placeholder');
      addLog(`  Built ${feeRecords.length} settlement fee records`, 'info');

      // Step 7 — Upload to database
      addLog('Uploading to database...', 'info');
      setProgress(60);

      const uploadResult = await uploadToSupabase(
        selectedMonth,
        year,
        enriched,
        feeRecords,
        summaryMap,
        (_step, pct, log) => {
          setProgress(60 + Math.round(pct * 0.4));
          if (log) addLog(log, 'info');
        }
      );

      const { periodId, invoicesReconciled, settlementsReconciled, placeholdersCreated } = uploadResult;

      addLog(`✅ Done! ${enriched.length} rows uploaded.`, 'success');
      addLog(`📊 Cross-Period Reconciliation Report:`, 'info');
      addLog(`   • Reconciled: Matched and updated ${invoicesReconciled} older database invoices with newly uploaded settlements.`, 'success');
      addLog(`   • Reconciled: Resolved and matched ${settlementsReconciled} new invoices with previously pending database settlements.`, 'success');
      if (placeholdersCreated > 0) {
        addLog(`   • Reconciled: Created ${placeholdersCreated} temporary placeholders for settlements without invoices (will heal automatically on MTR upload).`, 'warning');
      }
      setProgress(100);
      setUploadDone(true);

      // Invalidate frontend data caches
      invalidateRecordsCache(periodId);
      invalidateFeesCache(periodId);

      // Update context
      const { data: newPeriod } = await supabase
        .from('periods')
        .select('*')
        .eq('id', periodId)
        .single();

      if (newPeriod) {
        dispatch({ type: 'ADD_PERIOD', payload: newPeriod as Period });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An unexpected error occurred';
      addLog(`❌ ${msg}`, 'error');
      setProgress(0);
    } finally {
      setProcessing(false);
    }
  }

  const handleSettlementDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setSettlementDragging(false);
    const files = e.dataTransfer.files;
    const txtFiles = Array.from(files).filter((f) => f.name.endsWith('.txt'));
    if (txtFiles.length) {
      const dt = new DataTransfer();
      txtFiles.forEach((f) => dt.items.add(f));
      setSettlementFiles(dt.files);
    }
  }, []);

  const handleMtrDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setMtrDragging(false);
    const files = e.dataTransfer.files;
    const validFiles = Array.from(files).filter(
      (f) => f.name.endsWith('.csv') || f.name.endsWith('.xlsx') || f.name.endsWith('.xls')
    );
    if (validFiles.length) {
      setMtrFiles((prev) => {
        const filtered = prev.filter((pf) => !validFiles.some((nf) => nf.name === pf.name));
        return [...filtered, ...validFiles];
      });
    }
  }, []);

  const handleShopifyDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setShopifyDragging(false);
    const files = e.dataTransfer.files;
    const validFile = Array.from(files).find(
      (f) => f.name.endsWith('.csv') || f.name.endsWith('.xlsx') || f.name.endsWith('.xls')
    );
    if (validFile) {
      setShopifyFile(validFile);
    }
  }, []);

  const handleRecoTallyDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setRecoTallyDragging(false);
    const files = e.dataTransfer.files;
    const validFile = Array.from(files).find(
      (f) => f.name.endsWith('.csv') || f.name.endsWith('.xlsx') || f.name.endsWith('.xls')
    );
    if (validFile) {
      setRecoTallyFile(validFile);
    }
  }, []);

  const handleRecoAwbDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setRecoAwbDragging(false);
    const files = e.dataTransfer.files;
    const validFile = Array.from(files).find(
      (f) => f.name.endsWith('.csv') || f.name.endsWith('.xlsx') || f.name.endsWith('.xls')
    );
    if (validFile) {
      setRecoAwbFile(validFile);
    }
  }, []);

  const handleRunReconciliation = async () => {
    if (!recoTallyFile || !recoAwbFile) return;
    setRecoRunning(true);
    setRecoError(null);
    setRecoResult(null);
    setRecoSummary(null);

    try {
      const { runCodReconciliation } = await import('../lib/processing/shopifyReconciliation');
      const { rows, summary } = await runCodReconciliation(recoTallyFile, recoAwbFile);
      setRecoResult(rows);
      setRecoSummary(summary);
    } catch (err) {
      setRecoError(err instanceof Error ? err.message : 'Failed to reconcile files.');
    } finally {
      setRecoRunning(false);
    }
  };

  const handleDownloadReco = () => {
    if (!recoResult || recoResult.length === 0) return;
    const worksheet = XLSX.utils.json_to_sheet(recoResult);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'COD Reconciliation');
    
    // Auto-fit column widths
    const maxLens = recoResult.reduce((acc, row) => {
      Object.keys(row).forEach((key) => {
        const valStr = String(row[key as keyof typeof row] ?? '');
        acc[key] = Math.max(acc[key] || 0, valStr.length, key.length);
      });
      return acc;
    }, {} as Record<string, number>);
    
    worksheet['!cols'] = Object.keys(maxLens).map((key) => ({
      wch: maxLens[key] + 3
    }));

    XLSX.writeFile(workbook, `shopify_cod_reco_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const canProcess = platform === 'shopify' 
    ? (selectedMonth && selectedYear && shopifyFile && (!existingPeriod || conflictConfirmed))
    : (selectedMonth && selectedYear && settlementFiles && mtrFiles.length > 0 && (!existingPeriod || conflictConfirmed));

  return (
    <div className="upload-page">
      <div className="upload-header">
        <h2 className="upload-title">Upload {platform === 'shopify' ? 'Shopify' : 'Amazon'} Sales Data</h2>
        <p className="upload-subtitle">
          {platform === 'shopify'
            ? 'Upload a single Shopify Tally GST Report (.csv, .xlsx, .xls) to populate dashboard metrics.'
            : 'Process Amazon settlement TXT files and Monthly Tax Report (MTR) CSV to upload consolidated data.'}
        </p>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} noValidate>
        <div className="upload-grid">
          {/* Period Selection */}
          <div className="card">
            <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Calendar size={18} style={{ color: 'var(--color-primary-light)' }} />
              Reporting Period
            </h3>
            <div className="upload-form-row">
              <div className="upload-form-field">
                <label htmlFor="month-select" className="label">Month</label>
                <select
                  id="month-select"
                  className="input select"
                  value={selectedMonth}
                  onChange={(e) => {
                    setSelectedMonth(e.target.value);
                    setExistingPeriod(null);
                    setConflictConfirmed(false);
                  }}
                  required
                >
                  <option value="">Select month...</option>
                  {MONTHS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="upload-form-field">
                <label htmlFor="year-input" className="label">Year</label>
                <input
                  id="year-input"
                  type="number"
                  className="input"
                  value={selectedYear}
                  onChange={(e) => {
                    setSelectedYear(e.target.value);
                    setExistingPeriod(null);
                    setConflictConfirmed(false);
                  }}
                  min={2000}
                  max={2100}
                  required
                />
              </div>
            </div>

            {existingPeriod && (
              <div className="upload-conflict-warning">
                <div className="conflict-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <AlertTriangle size={20} style={{ color: 'var(--color-warning)' }} />
                </div>
                <div>
                  <p className="conflict-title">
                    Data for {existingPeriod.month} {existingPeriod.year} already exists
                  </p>
                  <p className="conflict-desc">
                    {existingPeriod.row_count?.toLocaleString('en-IN')} rows will be overwritten.
                  </p>
                  <label className="conflict-confirm">
                    <input
                      type="checkbox"
                      checked={conflictConfirmed}
                      onChange={(e) => setConflictConfirmed(e.target.checked)}
                      id="conflict-confirm-checkbox"
                    />
                    <span>I confirm — overwrite existing data</span>
                  </label>
                </div>
              </div>
            )}
          </div>

          {/* File Inputs */}
          <div className="card">
            <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <FileSpreadsheet size={18} style={{ color: 'var(--color-primary-light)' }} />
              File Selection
            </h3>

            {platform === 'shopify' ? (
              /* Shopify Upload Field */
              <div className="upload-field-group">
                <label className="label">Tally GST Report (.csv, .xlsx, .xls)</label>
                <div
                  className={`upload-dropzone ${shopifyDragging ? 'upload-dropzone--dragging' : ''} ${shopifyFile ? 'upload-dropzone--filled' : ''}`}
                  onDragEnter={() => setShopifyDragging(true)}
                  onDragLeave={() => setShopifyDragging(false)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleShopifyDrop}
                  onClick={() => shopifyInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  aria-label="Click or drag to upload Shopify Tally report"
                  onKeyDown={(e) => e.key === 'Enter' && shopifyInputRef.current?.click()}
                >
                  <input
                    ref={shopifyInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={(e) => {
                      const files = e.target.files;
                      if (files && files.length > 0) {
                        setShopifyFile(files[0]);
                      }
                    }}
                    style={{ display: 'none' }}
                    id="shopify-file-input"
                  />
                  {shopifyFile ? (
                    <div className="upload-dropzone-filled">
                      <span className="upload-dropzone-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
                        <FileSpreadsheet size={24} style={{ color: 'var(--color-primary-light)' }} />
                      </span>
                      <div>
                        <p className="upload-dropzone-filename">{shopifyFile.name}</p>
                        <p className="upload-dropzone-hint">
                          Size: {(shopifyFile.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="upload-dropzone-empty">
                      <span className="upload-dropzone-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
                        <Upload size={24} style={{ color: 'var(--color-text-muted)' }} />
                      </span>
                      <p className="upload-dropzone-text">
                        Drag & drop <strong>Tally GST report</strong> file here, or click to browse
                      </p>
                      <p className="upload-dropzone-hint">Supports .csv, .xls, .xlsx formats</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Amazon Upload Fields */
              <>
                {/* Settlement Files */}
                <div className="upload-field-group">
                  <label className="label">Settlement Files (.txt)</label>
                  <div
                    className={`upload-dropzone ${settlementDragging ? 'upload-dropzone--dragging' : ''} ${settlementFiles ? 'upload-dropzone--filled' : ''}`}
                    onDragEnter={() => setSettlementDragging(true)}
                    onDragLeave={() => setSettlementDragging(false)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleSettlementDrop}
                    onClick={() => settlementInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    aria-label="Click or drag to upload settlement files"
                    onKeyDown={(e) => e.key === 'Enter' && settlementInputRef.current?.click()}
                  >
                    <input
                      ref={settlementInputRef}
                      type="file"
                      accept=".txt"
                      multiple
                      onChange={(e) => setSettlementFiles(e.target.files)}
                      style={{ display: 'none' }}
                      id="settlement-file-input"
                    />
                    {settlementFiles ? (
                      <div className="upload-dropzone-filled">
                        <span className="upload-dropzone-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
                          <FileText size={24} style={{ color: 'var(--color-primary-light)' }} />
                        </span>
                        <div>
                          <p className="upload-dropzone-filename">
                            {settlementFiles.length} file(s) selected
                          </p>
                          <div className="upload-file-badges">
                            {Array.from(settlementFiles).map((f, i) => (
                              <span key={i} className="upload-file-badge">{f.name}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="upload-dropzone-empty">
                        <span className="upload-dropzone-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
                          <Upload size={24} style={{ color: 'var(--color-text-muted)' }} />
                        </span>
                        <p className="upload-dropzone-text">
                          Drag & drop <strong>.txt</strong> files here, or click to browse
                        </p>
                        <p className="upload-dropzone-hint">Multiple files supported</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* MTR File */}
                <div className="upload-field-group">
                  <label className="label">MTR Files (.csv, .xlsx, .xls)</label>
                  <div
                    className={`upload-dropzone ${mtrDragging ? 'upload-dropzone--dragging' : ''} ${mtrFiles.length > 0 ? 'upload-dropzone--filled' : ''}`}
                    onDragEnter={() => setMtrDragging(true)}
                    onDragLeave={() => setMtrDragging(false)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleMtrDrop}
                    onClick={() => mtrInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    aria-label="Click or drag to upload MTR CSV or Excel files"
                    onKeyDown={(e) => e.key === 'Enter' && mtrInputRef.current?.click()}
                  >
                    <input
                      ref={mtrInputRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      multiple
                      onChange={(e) => {
                        const files = e.target.files;
                        if (files) {
                          const newFiles = Array.from(files);
                          setMtrFiles((prev) => {
                            const filtered = prev.filter((pf) => !newFiles.some((nf) => nf.name === pf.name));
                            return [...filtered, ...newFiles];
                          });
                        }
                      }}
                      style={{ display: 'none' }}
                      id="mtr-file-input"
                    />
                    {mtrFiles.length > 0 ? (
                      <div className="upload-dropzone-filled">
                        <span className="upload-dropzone-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
                          <FileSpreadsheet size={24} style={{ color: 'var(--color-primary-light)' }} />
                        </span>
                        <div style={{ width: '100%' }}>
                          <p className="upload-dropzone-filename">
                            {mtrFiles.length} file(s) selected
                          </p>
                          <div className="upload-file-badges">
                            {mtrFiles.map((f, i) => (
                              <span key={i} className="upload-file-badge">{f.name}</span>
                            ))}
                          </div>
                          <div style={{ marginTop: 'var(--space-2)' }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMtrFiles([]);
                              }}
                            >
                              Clear files
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="upload-dropzone-empty">
                        <span className="upload-dropzone-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
                          <Upload size={24} style={{ color: 'var(--color-text-muted)' }} />
                        </span>
                        <p className="upload-dropzone-text">
                          Drag & drop <strong>.csv</strong> or <strong>.xlsx</strong> files here, or click to browse
                        </p>
                        <p className="upload-dropzone-hint">Multiple files supported (e.g. B2C and B2B)</p>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Submit */}
        <div className="upload-actions" style={{ marginTop: 'var(--space-6)', marginBottom: 'var(--space-2)' }}>
          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={!canProcess || processing}
            id="process-upload-btn"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}
          >
            {processing ? (
              <>
                <Loader2 size={18} className="animate-spin" /> Processing...
              </>
            ) : (
              <>
                <Play size={18} /> Process & Upload
              </>
            )}
          </button>
        </div>
      </form>

      {/* Log Panel */}
      {logs.length > 0 && (
        <div className="card upload-log-panel">
          <div className="upload-log-header">
            <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <ClipboardList size={18} style={{ color: 'var(--color-primary-light)' }} />
              Processing Log
            </h3>
            {progress > 0 && progress < 100 && (
              <ProgressBar percent={progress} showPercent={true} />
            )}
            {progress === 100 && (
              <span className="upload-log-complete" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                <CheckCircle2 size={16} /> Complete
              </span>
            )}
          </div>
          <div className="upload-log-entries">
            {logs.map((log, i) => (
              <div
                key={i}
                className={`upload-log-entry upload-log-entry--${log.type}`}
                style={{ animationDelay: `${i * 20}ms` }}
              >
                <span className="upload-log-time">{log.timestamp}</span>
                <span className="upload-log-message">{log.message}</span>
              </div>
            ))}
            <div ref={logBottomRef} />
          </div>

          {uploadDone && (
            <div className="upload-success-cta">
              <p className="upload-success-text">
                Data uploaded successfully for {selectedMonth} {selectedYear}
              </p>
              <button
                className="btn btn-primary"
                onClick={() => navigate('/')}
                id="view-dashboard-btn"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}
              >
                View Dashboard <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Shopify COD Reconciliation Tool Section */}
      {platform === 'shopify' && (
        <div className="reco-section">
          <div className="upload-header">
            <h2 className="upload-title">Shopify COD Reconciliation Tool</h2>
            <p className="upload-subtitle">
              Upload both the Tally GST Report and the AWB-wise Remittance Report to reconcile COD order values by AWB numbers.
            </p>
          </div>

          <div className="reco-grid">
            {/* Tally GST Report Dropzone */}
            <div className="card">
              <h3 className="section-title">1. Shopify Tally GST Report</h3>
              <div
                className={`upload-dropzone ${recoTallyDragging ? 'upload-dropzone--dragging' : ''} ${recoTallyFile ? 'upload-dropzone--filled' : ''}`}
                onDragEnter={() => setRecoTallyDragging(true)}
                onDragLeave={() => setRecoTallyDragging(false)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleRecoTallyDrop}
                onClick={() => recoTallyInputRef.current?.click()}
                role="button"
                tabIndex={0}
                aria-label="Click or drag to upload Tally report for reconciliation"
                onKeyDown={(e) => e.key === 'Enter' && recoTallyInputRef.current?.click()}
              >
                <input
                  ref={recoTallyInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) setRecoTallyFile(files[0]);
                  }}
                  style={{ display: 'none' }}
                />
                {recoTallyFile ? (
                  <div className="upload-dropzone-filled">
                    <span className="upload-dropzone-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
                      <FileSpreadsheet size={24} style={{ color: 'var(--color-success)' }} />
                    </span>
                    <div>
                      <p className="upload-dropzone-filename">{recoTallyFile.name}</p>
                      <p className="upload-dropzone-hint">{(recoTallyFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </div>
                ) : (
                  <div className="upload-dropzone-empty">
                    <span className="upload-dropzone-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
                      <Upload size={24} style={{ color: 'var(--color-text-muted)' }} />
                    </span>
                    <p className="upload-dropzone-text">Drag & drop <strong>Tally GST report</strong> here</p>
                  </div>
                )}
              </div>
            </div>

            {/* AWB Billing Report Dropzone */}
            <div className="card">
              <h3 className="section-title">2. AWB Billing / Remittance Statement</h3>
              <div
                className={`upload-dropzone ${recoAwbDragging ? 'upload-dropzone--dragging' : ''} ${recoAwbFile ? 'upload-dropzone--filled' : ''}`}
                onDragEnter={() => setRecoAwbDragging(true)}
                onDragLeave={() => setRecoAwbDragging(false)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleRecoAwbDrop}
                onClick={() => recoAwbInputRef.current?.click()}
                role="button"
                tabIndex={0}
                aria-label="Click or drag to upload AWB remittance statement"
                onKeyDown={(e) => e.key === 'Enter' && recoAwbInputRef.current?.click()}
              >
                <input
                  ref={recoAwbInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => {
                    const files = e.target.files;
                    if (files && files.length > 0) setRecoAwbFile(files[0]);
                  }}
                  style={{ display: 'none' }}
                />
                {recoAwbFile ? (
                  <div className="upload-dropzone-filled">
                    <span className="upload-dropzone-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
                      <Truck size={24} style={{ color: 'var(--color-success)' }} />
                    </span>
                    <div>
                      <p className="upload-dropzone-filename">{recoAwbFile.name}</p>
                      <p className="upload-dropzone-hint">{(recoAwbFile.size / 1024).toFixed(1)} KB</p>
                    </div>
                  </div>
                ) : (
                  <div className="upload-dropzone-empty">
                    <span className="upload-dropzone-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
                      <Upload size={24} style={{ color: 'var(--color-text-muted)' }} />
                    </span>
                    <p className="upload-dropzone-text">Drag & drop <strong>AWB Wise statement</strong> here</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {recoError && (
            <div className="reco-error">
              <AlertTriangle size={18} />
              <span>{recoError}</span>
            </div>
          )}

          {recoSummary && (
            <div className="reco-summary-card">
              <h4 className="reco-summary-title">Reconciliation Results Summary</h4>
              <div className="reco-summary-grid">
                <div className="reco-summary-item">
                  <p className="reco-summary-label">COD Orders</p>
                  <p className="reco-summary-value">{recoSummary.totalCodOrders}</p>
                </div>
                <div className="reco-summary-item reco-summary-item--matched">
                  <p className="reco-summary-label">Matched</p>
                  <p className="reco-summary-value" style={{ color: 'var(--color-success)' }}>{recoSummary.matched}</p>
                </div>
                <div className="reco-summary-item reco-summary-item--mismatch">
                  <p className="reco-summary-label">Mismatches</p>
                  <p className="reco-summary-value" style={{ color: 'var(--color-warning)' }}>{recoSummary.valueMismatch}</p>
                </div>
                <div className="reco-summary-item reco-summary-item--not-remitted">
                  <p className="reco-summary-label">Not Remitted</p>
                  <p className="reco-summary-value" style={{ color: 'var(--color-danger)' }}>{recoSummary.notRemitted}</p>
                </div>
                <div className="reco-summary-item reco-summary-item--missing">
                  <p className="reco-summary-label">No AWB</p>
                  <p className="reco-summary-value" style={{ color: 'var(--color-text-muted)' }}>{recoSummary.missingAwb}</p>
                </div>
              </div>
            </div>
          )}

          <div className="reco-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setRecoTallyFile(null);
                setRecoAwbFile(null);
                setRecoResult(null);
                setRecoSummary(null);
                setRecoError(null);
              }}
              disabled={recoRunning || (!recoTallyFile && !recoAwbFile)}
            >
              Clear
            </button>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleRunReconciliation()}
                disabled={recoRunning || !recoTallyFile || !recoAwbFile}
              >
                {recoRunning ? 'Reconciling...' : 'Run Reconciliation'}
              </button>
              {recoResult && (
                <button
                  type="button"
                  className="btn btn-success"
                  onClick={handleDownloadReco}
                  style={{ backgroundColor: 'var(--color-success)', color: '#fff' }}
                >
                  Download Reco Report
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
