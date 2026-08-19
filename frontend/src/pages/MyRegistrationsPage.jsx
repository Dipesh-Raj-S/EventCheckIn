import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';
import QRCodeDisplay from '../components/QRCodeDisplay';

export default function MyRegistrationsPage() {
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchRegistrations = async () => {
      try {
        const res = await api.get('/registrations/me');
        setRegistrations(res.data.registrations);
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load registrations');
      } finally {
        setLoading(false);
      }
    };
    fetchRegistrations();
  }, []);

  const formatDate = (iso) => {
    return new Date(iso).toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">My Registrations</h1>
        <p className="text-surface-400 mt-1">
          {registrations.length} registration{registrations.length !== 1 ? 's' : ''}
        </p>
      </div>

      {error && <div className="error-message mb-6">{error}</div>}

      {registrations.length === 0 ? (
        <div className="card text-center py-12">
          <svg className="w-12 h-12 mx-auto text-surface-500 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-5.25h5.25M7.5 15h3M3.375 5.25c-.621 0-1.125.504-1.125 1.125v3.026a2.999 2.999 0 010 5.198v3.026c0 .621.504 1.125 1.125 1.125h17.25c.621 0 1.125-.504 1.125-1.125v-3.026a2.999 2.999 0 010-5.198V6.375c0-.621-.504-1.125-1.125-1.125H3.375z" />
          </svg>
          <p className="text-surface-400 mb-2">No registrations yet</p>
          <Link to="/events" className="text-primary-400 hover:text-primary-300 text-sm font-medium transition-colors">
            Browse events →
          </Link>
        </div>
      ) : (
        <div className="grid gap-6">
          {registrations.map((reg) => (
            <div key={reg.id} className="card">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
                {/* QR Code */}
                <div className="shrink-0">
                  <QRCodeDisplay value={reg.qr_token} size={140} />
                </div>

                {/* Event info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={reg.token_status === 'active' ? 'badge-active' : 'badge-used'}>
                      {reg.token_status}
                    </span>
                  </div>
                  <Link
                    to={`/events/${reg.event_id}`}
                    className="text-lg font-semibold text-white hover:text-primary-300 transition-colors"
                  >
                    {reg.event?.name || `Event #${reg.event_id}`}
                  </Link>
                  {reg.event && (
                    <p className="text-sm text-surface-400 mt-1 flex items-center gap-1.5">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                      </svg>
                      {formatDate(reg.event.date)}
                    </p>
                  )}
                  <p className="text-xs text-surface-500 mt-2">
                    Registered {formatDate(reg.created_at)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
