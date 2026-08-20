import { useState, useEffect, useRef, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import api from '../api';

// Generate a stable station_id per browser session
const STATION_ID =
  sessionStorage.getItem('station_id') ||
  (() => {
    const id = `station-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem('station_id', id);
    return id;
  })();

export default function ScannerPage() {
  const [scanResult, setScanResult] = useState(null); // { type, data }
  const [scanning, setScanning] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const scannerRef = useRef(null);
  const containerRef = useRef(null);
  const processingRef = useRef(false); // lock to prevent double-submit

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
          // Debounce: if we're already processing a scan, ignore
          if (processingRef.current) return;
          processingRef.current = true;
          setProcessing(true);

          try {
            const res = await api.post('/checkin', {
              qr_token: decodedText,
              station_id: STATION_ID,
            });

            const checkedInAt = new Date(res.data.checked_in_at).toLocaleTimeString(
              'en-US',
              { hour: 'numeric', minute: '2-digit', hour12: true }
            );

            setScanResult({
              type: 'success',
              data: {
                email: res.data.attendee?.email,
                checkedInAt,
                event: res.data.event,
              },
            });
          } catch (err) {
            const status = err.response?.status;
            const body = err.response?.data;

            if (status === 409 && body?.error === 'Already checked in') {
              const checkedInAt = body.checked_in_at
                ? new Date(body.checked_in_at).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true,
                  })
                : 'unknown time';

              setScanResult({
                type: 'duplicate',
                data: { checkedInAt },
              });
            } else if (status === 404) {
              setScanResult({
                type: 'invalid',
                data: { message: 'Invalid QR code' },
              });
            } else if (status === 403) {
              setScanResult({
                type: 'error',
                data: {
                  message:
                    body?.error || 'You do not have permission to check in attendees for this event',
                },
              });
            } else {
              setScanResult({
                type: 'error',
                data: { message: body?.error || 'Check-in failed' },
              });
            }
          } finally {
            setProcessing(false);
            // Reset the processing lock after a brief delay to allow
            // the user to see the result before scanning again
            setTimeout(() => {
              processingRef.current = false;
            }, 2000);
          }
        },
        () => {
          // QR scan error (no code found in frame) — ignore
        }
      );
      setCameraReady(true);
      setScanning(true);
    } catch (err) {
      console.error('Camera start failed:', err);
      setScanResult({
        type: 'error',
        data: { message: `Camera access denied or unavailable: ${err}` },
      });
    }
  }, []);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // Ignore cleanup errors
      }
      scannerRef.current = null;
      setScanning(false);
      setCameraReady(false);
    }
  }, []);

  // Cleanup on unmount
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

  return (
    <div className="page-container max-w-lg mx-auto">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 shadow-lg shadow-primary-900/40 mb-4">
          <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75H16.5v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75H16.5v-.75z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-white">QR Check-In Scanner</h1>
        <p className="text-surface-400 mt-1">
          Scan attendee QR codes to check them in
        </p>
        <p className="text-xs text-surface-500 mt-1 font-mono">
          Station: {STATION_ID}
        </p>
      </div>

      {/* Scanner viewport */}
      <div className="card mb-6">
        <div
          id="qr-reader"
          ref={containerRef}
          className="rounded-xl overflow-hidden bg-surface-800"
          style={{ minHeight: scanning ? 'auto' : '300px' }}
        />

        <div className="flex justify-center gap-3 mt-4">
          {!scanning ? (
            <button
              onClick={startScanner}
              className="btn-primary"
              id="start-scanner-btn"
            >
              <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
              </svg>
              Start Camera
            </button>
          ) : (
            <button
              onClick={stopScanner}
              className="btn-ghost"
              id="stop-scanner-btn"
            >
              Stop Camera
            </button>
          )}
        </div>

        {processing && (
          <div className="flex items-center justify-center gap-2 mt-4 text-primary-400">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary-500 border-t-transparent" />
            <span className="text-sm">Processing scan...</span>
          </div>
        )}
      </div>

      {/* Scan Result */}
      {scanResult && (
        <div className="mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {scanResult.type === 'success' && (
            <div className="card border-2 border-emerald-500/30 bg-emerald-500/5" id="checkin-success">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                  <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-emerald-300">Checked In!</h3>
                  <p className="text-sm text-emerald-400/70">at {scanResult.data.checkedInAt}</p>
                </div>
              </div>
              <div className="bg-surface-800/50 rounded-lg p-3">
                <p className="text-surface-200 font-medium">{scanResult.data.email}</p>
                {scanResult.data.event && (
                  <p className="text-xs text-surface-400 mt-1">
                    {scanResult.data.event.name} — {scanResult.data.event.checked_in_count}/{scanResult.data.event.capacity} checked in
                  </p>
                )}
              </div>
            </div>
          )}

          {scanResult.type === 'duplicate' && (
            <div className="card border-2 border-red-500/30 bg-red-500/5" id="checkin-duplicate">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-red-300">Already Checked In</h3>
                  <p className="text-sm text-red-400/70">
                    This attendee was already checked in at {scanResult.data.checkedInAt}
                  </p>
                </div>
              </div>
            </div>
          )}

          {scanResult.type === 'invalid' && (
            <div className="card border-2 border-amber-500/30 bg-amber-500/5" id="checkin-invalid">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                  <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-amber-300">Invalid QR Code</h3>
                  <p className="text-sm text-amber-400/70">
                    This QR code is not recognized by the system
                  </p>
                </div>
              </div>
            </div>
          )}

          {scanResult.type === 'error' && (
            <div className="card border-2 border-red-500/30 bg-red-500/5" id="checkin-error">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-red-300">Error</h3>
                  <p className="text-sm text-red-400/70">{scanResult.data.message}</p>
                </div>
              </div>
            </div>
          )}

          <button
            onClick={resetScan}
            className="btn-ghost w-full mt-4"
            id="scan-again-btn"
          >
            Scan Next Attendee
          </button>
        </div>
      )}
    </div>
  );
}
