import { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { get, set, update } from 'idb-keyval';
import api from '../api';

// Generate a stable station_id per browser session
const STATION_ID =
  sessionStorage.getItem('station_id') ||
  (() => {
    const id = `station-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem('station_id', id);
    return id;
  })();

const IDB_KEY_PENDING = 'offline_scans_pending';
const IDB_KEY_HISTORY = 'offline_scans_history';

export default function ScannerPage() {
  const [scanResult, setScanResult] = useState(null); // { type, data }
  const [scanning, setScanning] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncHistory, setSyncHistory] = useState([]); // Array of { client_scan_id, status, attendee, etc. }
  const [isSyncing, setIsSyncing] = useState(false);
  const isSyncingRef = useRef(false);

  const scannerRef = useRef(null);
  const containerRef = useRef(null);
  const processingRef = useRef(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const loadIDB = async () => {
      const pending = await get(IDB_KEY_PENDING) || [];
      setPendingCount(pending.length);
      const history = await get(IDB_KEY_HISTORY) || [];
      setSyncHistory(history);
    };
    loadIDB();
  }, []);

  const syncPendingScans = useCallback(async () => {
    if (!isOnline || isSyncingRef.current) return;
    
    const pending = await get(IDB_KEY_PENDING) || [];
    if (pending.length === 0) return;

    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      const res = await api.post('/checkin/sync', { scans: pending });
      const results = res.data.results || [];
      
      await set(IDB_KEY_PENDING, []);
      setPendingCount(0);

      // Update history items in-place
      await update(IDB_KEY_HISTORY, (old = []) => {
        const updated = [...old];
        results.forEach(r => {
          const idx = updated.findIndex(h => h.client_scan_id === r.client_scan_id);
          const historyItem = {
            client_scan_id: r.client_scan_id,
            status: r.status,
            reason: r.reason,
            attendee: r.attendee,
            checked_in_at: r.checked_in_at || r.original_checkin?.checked_in_at,
            station_id: r.station_id || r.original_checkin?.station_id,
            synced_at: new Date().toISOString()
          };
          if (idx !== -1) {
            // Merge with existing
            updated[idx] = { ...updated[idx], ...historyItem };
          } else {
            updated.unshift(historyItem);
          }
        });
        return updated.slice(0, 50); // Keep last 50
      });
      
      const newHistory = await get(IDB_KEY_HISTORY);
      setSyncHistory(newHistory);
      
    } catch (err) {
      console.error('Failed to sync offline scans:', err);
      // If we got a 429, pause sync operations for a few seconds to backoff
      if (err.response?.status === 429) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [isOnline]); // Removed isSyncing to prevent infinite loop

  useEffect(() => {
    if (isOnline) {
      syncPendingScans();
    }
  }, [isOnline, syncPendingScans]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (isOnline) {
        syncPendingScans();
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [isOnline, syncPendingScans]); // Removed pendingCount to prevent interval thrashing


  const startScanner = useCallback(async () => {
    if (scannerRef.current) return;

    const scanner = new Html5Qrcode('qr-reader');
    scannerRef.current = scanner;

    try {
      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1,
        },
        async (decodedText) => {
          if (processingRef.current) return;
          processingRef.current = true;
          setProcessing(true);

          const client_scan_id = crypto.randomUUID();
          const device_scanned_at = new Date().toISOString();

          try {
            const res = await api.post('/checkin', {
              qr_token: decodedText,
              station_id: STATION_ID,
              client_scan_id
            });

            const data = res.data;
            const checkedInAt = new Date(data.checked_in_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

            setScanResult({
              type: 'success',
              data: {
                attendee: data.attendee,
                checkedInAt,
                station: data.station_id,
              },
            });
            
            // Add to sync history for live scans too (so the panel shows all activity)
            const historyItem = {
              client_scan_id,
              status: 'synced',
              attendee: data.attendee,
              checked_in_at: data.checked_in_at,
              station_id: data.station_id,
              synced_at: new Date().toISOString()
            };
            await update(IDB_KEY_HISTORY, (old = []) => [historyItem, ...old].slice(0, 50));
            setSyncHistory(prev => [historyItem, ...prev].slice(0, 50));

          } catch (err) {
            if (!err.response) {
              // Network error - Queue it
              const pendingScan = {
                client_scan_id,
                qr_token: decodedText,
                station_id: STATION_ID,
                device_scanned_at
              };
              
              await update(IDB_KEY_PENDING, (old = []) => [...old, pendingScan]);
              setPendingCount(prev => prev + 1);

              const historyItem = {
                client_scan_id,
                status: 'queued',
                device_scanned_at
              };
              await update(IDB_KEY_HISTORY, (old = []) => [historyItem, ...old].slice(0, 50));
              setSyncHistory(prev => [historyItem, ...prev].slice(0, 50));

              setScanResult({ type: 'queued' });

            } else {
              const status = err.response.status;
              const body = err.response.data;

              if (status === 409 && body?.status === 'conflict') {
                const checkedInAt = body.original_checkin?.checked_in_at
                  ? new Date(body.original_checkin.checked_in_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
                  : 'unknown time';

                setScanResult({
                  type: 'conflict',
                  data: { 
                    attendee: body.attendee,
                    checkedInAt,
                    station: body.original_checkin?.station_id || 'unknown station'
                  },
                });
                
                // Add conflict to history
                const historyItem = {
                  client_scan_id,
                  status: 'conflict',
                  attendee: body.attendee,
                  checked_in_at: body.original_checkin?.checked_in_at,
                  station_id: body.original_checkin?.station_id,
                  synced_at: new Date().toISOString()
                };
                await update(IDB_KEY_HISTORY, (old = []) => [historyItem, ...old].slice(0, 50));
                setSyncHistory(prev => [historyItem, ...prev].slice(0, 50));

              } else if (status === 404) {
                setScanResult({ type: 'invalid' });
              } else if (status === 403) {
                setScanResult({
                  type: 'error',
                  data: { message: body?.error || 'You do not have permission' },
                });
              } else {
                setScanResult({
                  type: 'error',
                  data: { message: body?.error || 'Check-in failed' },
                });
              }
            }
          } finally {
            setProcessing(false);
            setTimeout(() => {
              processingRef.current = false;
            }, 2000);
          }
        },
        () => {}
      );
      setCameraReady(true);
      setScanning(true);
    } catch (err) {
      console.error('Camera start failed:', err);
      setScanResult({
        type: 'error',
        data: { message: `Camera access denied: ${err}` },
      });
    }
  }, []);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {}
      scannerRef.current = null;
      setScanning(false);
      setCameraReady(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
      }
    };
  }, []);

  const resetScan = () => {
    setScanResult(null);
    processingRef.current = false;
  };

  const clearHistory = async () => {
    await set(IDB_KEY_HISTORY, []);
    setSyncHistory([]);
  };

  const formatHistoryTime = (isoString) => {
    if (!isoString) return '';
    return new Date(isoString).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  return (
    <div className="page-container max-w-lg mx-auto">
      <div className="text-center mb-6">
        <h1 className="text-2xl font-bold text-white mb-2">QR Scanner</h1>
        <div className="flex items-center justify-center gap-2">
          <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-blue-500 animate-pulse'}`}></span>
          <span className="text-sm font-medium text-surface-300">
            {isOnline ? 'Online' : 'Offline Mode'}
          </span>
          <span className="text-surface-500 text-xs ml-2 border-l border-surface-700 pl-2">
            Station: {STATION_ID}
          </span>
        </div>
      </div>
      
      {pendingCount > 0 && (
        <div className="mb-4 bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
            </svg>
            <span className="text-blue-200 text-sm">{pendingCount} scan(s) queued for sync</span>
          </div>
          {isSyncing && <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-400 border-t-transparent" />}
        </div>
      )}

      <div className="card mb-6">
        <div id="qr-reader" ref={containerRef} className="rounded-xl overflow-hidden bg-surface-800" style={{ minHeight: scanning ? 'auto' : '300px' }} />

        <div className="flex justify-center gap-3 mt-4">
          {!scanning ? (
            <button onClick={startScanner} className="btn-primary w-full">Start Camera</button>
          ) : (
            <button onClick={stopScanner} className="btn-ghost w-full">Stop Camera</button>
          )}
        </div>

        {processing && (
          <div className="flex items-center justify-center gap-2 mt-4 text-primary-400">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary-500 border-t-transparent" />
            <span className="text-sm">Processing scan...</span>
          </div>
        )}
      </div>

      {/* Human Readable Result Cards */}
      {scanResult && (
        <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          
          {/* Success */}
          {scanResult.type === 'success' && (
            <div className="card border-2 border-emerald-500/40 bg-emerald-500/10 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 mb-2">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-emerald-400 mb-1">✓ CHECK-IN SUCCESSFUL</h2>
              <p className="text-lg text-white font-medium mb-1">{scanResult.data.attendee?.email}</p>
              <p className="text-sm text-emerald-200/70">
                {scanResult.data.checkedInAt} • {scanResult.data.station}
              </p>
            </div>
          )}

          {/* Conflict */}
          {scanResult.type === 'conflict' && (
            <div className="card border-2 border-amber-500/40 bg-amber-500/10 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-500/20 text-amber-400 mb-2">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-amber-400 mb-1">⚠ ALREADY CHECKED IN</h2>
              <p className="text-lg text-white font-medium mb-1">{scanResult.data.attendee?.email}</p>
              <p className="text-sm text-amber-200/70">
                Original check-in: {scanResult.data.checkedInAt} • {scanResult.data.station}
              </p>
            </div>
          )}

          {/* Queued */}
          {scanResult.type === 'queued' && (
            <div className="card border-2 border-blue-500/40 bg-blue-500/10 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-500/20 text-blue-400 mb-2">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-blue-400 mb-1">☁ SCAN SAVED OFFLINE</h2>
              <p className="text-sm text-blue-200/80">
                Will sync automatically when connection returns
              </p>
            </div>
          )}

          {/* Invalid */}
          {scanResult.type === 'invalid' && (
            <div className="card border-2 border-red-500/40 bg-red-500/10 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-500/20 text-red-400 mb-2">
                <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-red-400">Invalid QR code</h2>
            </div>
          )}

          {scanResult.type === 'error' && (
            <div className="card border-2 border-red-500/40 bg-red-500/10 text-center">
              <h2 className="text-lg font-bold text-red-400 mb-1">Error</h2>
              <p className="text-sm text-red-200/80">{scanResult.data.message}</p>
            </div>
          )}

          <button onClick={resetScan} className="btn-ghost w-full mt-4">Scan Next Attendee</button>
        </div>
      )}

      {/* Sync History Panel */}
      <div className="card">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-white">Recent Activity</h3>
          {syncHistory.length > 0 && (
            <button onClick={clearHistory} className="text-xs text-surface-400 hover:text-white">Clear</button>
          )}
        </div>
        {syncHistory.length === 0 ? (
          <p className="text-sm text-surface-500 text-center py-4">No recent scans on this device</p>
        ) : (
          <div className="space-y-3">
            {syncHistory.map((item, idx) => {
              const isSuccess = item.status === 'synced' || item.status === 'already_synced';
              const isConflict = item.status === 'conflict';
              const isQueued = item.status === 'queued';
              const email = item.attendee?.email || 'Unknown Attendee';
              const time = formatHistoryTime(item.checked_in_at || item.device_scanned_at);
              const station = item.station_id || STATION_ID;
              
              return (
                <div key={item.client_scan_id + idx} className="text-sm border-l-2 pl-3 py-1 border-surface-700">
                  {isSuccess && (
                    <p className="text-surface-300">
                      <span className="text-emerald-400 font-bold mr-1">✓</span>
                      Synced Successfully — <span className="text-white">{email}</span> — Checked in at {time} — Station: {station}
                    </p>
                  )}
                  {isConflict && (
                    <p className="text-surface-300">
                      <span className="text-amber-400 font-bold mr-1">⚠</span>
                      Sync Conflict — <span className="text-white">{email}</span> — Already checked in at {time} — Original station: {station}
                    </p>
                  )}
                  {isQueued && (
                    <p className="text-surface-300">
                      <span className="text-blue-400 font-bold mr-1">☁</span>
                      Queued Offline — Scan captured at {time} — Waiting for network connection
                    </p>
                  )}
                  {!isSuccess && !isConflict && !isQueued && (
                    <p className="text-surface-300">
                      <span className="text-red-400 font-bold mr-1">✗</span>
                      Error processing scan
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
