import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../api';

export default function EventDashboardPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [event, setEvent] = useState(null);
  const [checkins, setCheckins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [socketStatus, setSocketStatus] = useState('Connecting');

  const fetchDashboardData = useCallback(async () => {
    try {
      const res = await api.get(`/events/${id}/dashboard`);
      setEvent(res.data.event);
      setCheckins(res.data.checkins);
      setError('');
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Setup Socket.IO
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    // Remove /api from base URL for socket connection if it exists
    const baseURL = api.defaults.baseURL || 'http://localhost:5000/api';
    const socketURL = baseURL.replace(/\/api\/?$/, '');

    const socket = io(socketURL, {
      transports: ['websocket', 'polling'], // Allow fallback to polling
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 20000,
    });

    socket.on('connect', () => {
      setSocketStatus('Authenticating...');
      // Emit auth join
      socket.emit('join_event_dashboard', { event_id: parseInt(id), token });
    });

    socket.on('joined', (data) => {
      setSocketStatus('Live');
    });

    socket.on('error', (data) => {
      console.error('Socket error:', data);
      setSocketStatus(`Error: ${data.message}`);
    });

    // Timeout if not connected after 10 seconds
    const connectTimeout = setTimeout(() => {
      setSocketStatus(current => {
        if (current === 'Connecting' || current === 'Authenticating...') {
          return 'Error: Connection Timeout';
        }
        return current;
      });
    }, 10000);

    socket.on('disconnect', () => {
      setSocketStatus('Disconnected');
    });

    socket.on('reconnect', () => {
      setSocketStatus('Reconnecting...');
      // Re-fetch full list to catch missed events while disconnected
      fetchDashboardData();
      socket.emit('join_event_dashboard', { event_id: parseInt(id), token });
    });

    socket.on('checkin_update', (data) => {
      if (data.event_id === parseInt(id)) {
        // Update check-in count
        setEvent(prev => prev ? { ...prev, checked_in_count: data.checked_in_count } : prev);
        
        // Prepend new check-in to list
        setCheckins(prev => {
          // Avoid duplicates if same event arrives twice
          if (prev.some(c => c.registration_id === data.checkin.registration_id)) {
            return prev;
          }
          return [data.checkin, ...prev];
        });
      }
    });

    return () => {
      clearTimeout(connectTimeout);
      socket.disconnect();
    };
  }, [id, fetchDashboardData]);

  if (loading) {
    return (
      <div className="page-container flex justify-center items-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="card text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button onClick={() => navigate('/events')} className="btn-primary">
            Back to Events
          </button>
        </div>
      </div>
    );
  }

  const fillPercentage = Math.min(
    100,
    ((event.checked_in_count || 0) / (event.capacity || 1)) * 100
  );

  return (
    <div className="page-container max-w-4xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white mb-1">{event.name}</h1>
          <p className="text-surface-400">Live Dashboard</p>
        </div>
        
        {/* Connection Status Badge */}
        <div className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-2 border ${
          socketStatus === 'Live' 
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
            : socketStatus === 'Disconnected' || socketStatus.startsWith('Error')
              ? 'bg-red-500/10 text-red-400 border-red-500/20'
              : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
        }`}>
          <span className={`w-2 h-2 rounded-full ${
            socketStatus === 'Live' ? 'bg-emerald-500 animate-pulse' : 
            socketStatus === 'Disconnected' || socketStatus.startsWith('Error') ? 'bg-red-500' : 'bg-amber-500 animate-pulse'
          }`}></span>
          {socketStatus}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="card md:col-span-1 border-t-4 border-t-primary-500">
          <h3 className="text-surface-400 text-sm font-medium mb-1">Check-in Progress</h3>
          <div className="text-3xl font-bold text-white mb-3">
            {event.checked_in_count} <span className="text-xl text-surface-500 font-normal">/ {event.capacity}</span>
          </div>
          
          <div className="w-full bg-surface-800 rounded-full h-3 overflow-hidden">
            <div 
              className="bg-primary-500 h-3 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${fillPercentage}%` }}
            />
          </div>
          <p className="text-xs text-right text-surface-400 mt-2">{Math.round(fillPercentage)}% Full</p>
        </div>
        
        <div className="card md:col-span-2">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-white">Live Check-ins</h3>
            <span className="text-xs bg-surface-800 text-surface-300 px-2 py-1 rounded">
              Total: {checkins.length}
            </span>
          </div>
          
          <div className="overflow-y-auto max-h-[400px] pr-2 custom-scrollbar">
            {checkins.length === 0 ? (
              <div className="text-center py-10 text-surface-500">
                <svg className="w-12 h-12 mx-auto mb-3 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <p>No one has checked in yet.</p>
                <p className="text-sm mt-1">Waiting for live scans...</p>
              </div>
            ) : (
              <div className="space-y-3">
                {checkins.map((ci) => {
                  const checkInTime = new Date(ci.checked_in_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                  
                  return (
                    <div 
                      key={ci.registration_id} 
                      className="bg-surface-800/50 hover:bg-surface-800 rounded-lg p-3 transition-colors flex justify-between items-center group animate-in slide-in-from-top-2 fade-in duration-300"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-white font-bold text-sm shadow-inner">
                          {ci.attendee.email.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-white font-medium">{ci.attendee.email}</p>
                          <p className="text-xs text-surface-400">Station: <span className="font-mono text-surface-300">{ci.station_id}</span></p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-emerald-400 text-xs font-semibold px-2 py-1 bg-emerald-400/10 rounded-full">
                          {checkInTime}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
