import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api';

export default function EventsPage() {
  const { isOrganizer } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Create event form state
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ name: '', date: '', capacity: '' });
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchEvents = async () => {
    try {
      const res = await api.get('/events');
      setEvents(res.data.events);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load events');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreateError('');
    setCreating(true);

    try {
      await api.post('/events', {
        name: createForm.name,
        date: createForm.date,
        capacity: parseInt(createForm.capacity, 10),
      });
      setCreateForm({ name: '', date: '', capacity: '' });
      setShowCreate(false);
      fetchEvents();
    } catch (err) {
      setCreateError(err.response?.data?.error || 'Failed to create event');
    } finally {
      setCreating(false);
    }
  };

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
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Events</h1>
          <p className="text-surface-400 mt-1">
            {events.length} event{events.length !== 1 ? 's' : ''} available
          </p>
        </div>

        {/* Create button visible only for organizers — but server enforces the actual restriction */}
        {isOrganizer && (
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="btn-primary"
            id="create-event-btn"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Create Event
          </button>
        )}
      </div>

      {error && <div className="error-message mb-6">{error}</div>}

      {/* Create event form */}
      {showCreate && (
        <div className="card mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">New Event</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            {createError && <div className="error-message">{createError}</div>}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="event-name" className="label">Event Name</label>
                <input
                  id="event-name"
                  type="text"
                  className="input"
                  placeholder="My Awesome Event"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label htmlFor="event-date" className="label">Date & Time</label>
                <input
                  id="event-date"
                  type="datetime-local"
                  className="input"
                  value={createForm.date}
                  onChange={(e) => setCreateForm({ ...createForm, date: e.target.value })}
                  required
                />
              </div>
              <div>
                <label htmlFor="event-capacity" className="label">Capacity</label>
                <input
                  id="event-capacity"
                  type="number"
                  className="input"
                  placeholder="100"
                  min="1"
                  value={createForm.capacity}
                  onChange={(e) => setCreateForm({ ...createForm, capacity: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button type="submit" className="btn-primary" disabled={creating} id="submit-create-event">
                {creating ? 'Creating...' : 'Create Event'}
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => { setShowCreate(false); setCreateError(''); }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Events list */}
      {events.length === 0 ? (
        <div className="card text-center py-12">
          <svg className="w-12 h-12 mx-auto text-surface-500 mb-4" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          <p className="text-surface-400">No events yet.</p>
          {isOrganizer && (
            <p className="text-surface-500 text-sm mt-1">Create your first event above!</p>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {events.map((event) => (
            <Link
              key={event.id}
              to={`/events/${event.id}`}
              className="card group flex items-center justify-between hover:translate-x-1"
              id={`event-card-${event.id}`}
            >
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-semibold text-white group-hover:text-primary-300 transition-colors truncate">
                  {event.name}
                </h3>
                <p className="text-sm text-surface-400 mt-1">
                  {formatDate(event.date)}
                </p>
              </div>

              <div className="flex items-center gap-4 ml-4">
                {/* Capacity indicator */}
                <div className="text-right">
                  <p className="text-sm font-medium text-surface-200">
                    {event.registered_count} / {event.capacity}
                  </p>
                  <p className="text-xs text-surface-500">registered</p>
                </div>

                {/* Capacity bar */}
                <div className="w-20 h-2 bg-surface-700 rounded-full overflow-hidden hidden sm:block">
                  <div
                    className="h-full bg-gradient-to-r from-primary-500 to-primary-400 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, (event.registered_count / event.capacity) * 100)}%` }}
                  />
                </div>

                {/* Arrow */}
                <svg className="w-5 h-5 text-surface-500 group-hover:text-primary-400 transition-colors" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
