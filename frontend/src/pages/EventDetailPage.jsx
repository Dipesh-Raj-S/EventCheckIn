import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api';
import QRCodeDisplay from '../components/QRCodeDisplay';

export default function EventDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isOrganizer, isAttendee, user } = useAuth();

  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Organizer: registrations list
  const [registrations, setRegistrations] = useState([]);
  const [loadingRegs, setLoadingRegs] = useState(false);

  // Attendee: registration status
  const [myRegistration, setMyRegistration] = useState(null);
  const [registering, setRegistering] = useState(false);
  const [registerError, setRegisterError] = useState('');

  // Edit mode
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', date: '', capacity: '' });
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);

  // Delete
  const [deleting, setDeleting] = useState(false);

  const isOwner = isOrganizer && event && event.organizer_id === user?.id;

  const fetchEvent = useCallback(async () => {
    try {
      const res = await api.get(`/events/${id}`);
      setEvent(res.data.event);
      setEditForm({
        name: res.data.event.name,
        date: res.data.event.date.slice(0, 16), // Format for datetime-local input
        capacity: res.data.event.capacity.toString(),
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load event');
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchRegistrations = useCallback(async () => {
    if (!isOrganizer) return;
    setLoadingRegs(true);
    try {
      const res = await api.get(`/events/${id}/registrations`);
      setRegistrations(res.data.registrations);
    } catch {
      // Will get 403 if not owner — that's fine, just don't show
    } finally {
      setLoadingRegs(false);
    }
  }, [id, isOrganizer]);

  const fetchMyRegistration = useCallback(async () => {
    if (!isAttendee) return;
    try {
      const res = await api.get('/registrations/me');
      const mine = res.data.registrations.find(
        (r) => r.event_id === parseInt(id, 10)
      );
      setMyRegistration(mine || null);
    } catch {
      // Ignore
    }
  }, [id, isAttendee]);

  useEffect(() => {
    fetchEvent();
  }, [fetchEvent]);

  useEffect(() => {
    if (event) {
      fetchRegistrations();
      fetchMyRegistration();
    }
  }, [event, fetchRegistrations, fetchMyRegistration]);

  const handleRegister = async () => {
    setRegisterError('');
    setRegistering(true);
    try {
      const res = await api.post(`/events/${id}/register`);
      setMyRegistration(res.data.registration);
      // Use the updated event from the response (includes new registered_count)
      if (res.data.event) {
        setEvent(res.data.event);
      } else {
        fetchEvent();
      }
    } catch (err) {
      const msg = err.response?.data?.error || 'Registration failed';
      setRegisterError(msg);
      // If event is full, update local state so UI disables the button immediately
      if (err.response?.status === 409 && msg.toLowerCase().includes('capacity')) {
        setEvent((prev) => prev ? { ...prev, registered_count: prev.capacity } : prev);
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    setEditError('');
    setSaving(true);
    try {
      await api.patch(`/events/${id}`, {
        name: editForm.name,
        date: editForm.date,
        capacity: parseInt(editForm.capacity, 10),
      });
      setEditing(false);
      fetchEvent();
    } catch (err) {
      setEditError(err.response?.data?.error || 'Failed to update event');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this event? This will also delete all registrations.')) {
      return;
    }
    setDeleting(true);
    try {
      await api.delete(`/events/${id}`);
      navigate('/events');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete event');
    } finally {
      setDeleting(false);
    }
  };

  const formatDate = (iso) => {
    return new Date(iso).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
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

  if (error && !event) {
    return (
      <div className="page-container">
        <div className="error-message">{error}</div>
      </div>
    );
  }

  if (!event) return null;

  const capacityPercent = Math.min(100, (event.registered_count / event.capacity) * 100);
  const isFull = event.registered_count >= event.capacity;

  return (
    <div className="page-container">
      {/* Back link */}
      <button
        onClick={() => navigate('/events')}
        className="flex items-center gap-1.5 text-sm text-surface-400 hover:text-surface-200 transition-colors mb-6"
        id="back-to-events"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back to Events
      </button>

      {error && <div className="error-message mb-6">{error}</div>}

      {/* Event header card */}
      <div className="card mb-6">
        {editing ? (
          /* Edit form */
          <form onSubmit={handleEdit} className="space-y-4">
            <h2 className="text-lg font-semibold text-white mb-2">Edit Event</h2>
            {editError && <div className="error-message">{editError}</div>}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="edit-name" className="label">Name</label>
                <input
                  id="edit-name"
                  type="text"
                  className="input"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <label htmlFor="edit-date" className="label">Date & Time</label>
                <input
                  id="edit-date"
                  type="datetime-local"
                  className="input"
                  value={editForm.date}
                  onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                  required
                />
              </div>
              <div>
                <label htmlFor="edit-capacity" className="label">Capacity</label>
                <input
                  id="edit-capacity"
                  type="number"
                  className="input"
                  min="1"
                  value={editForm.capacity}
                  onChange={(e) => setEditForm({ ...editForm, capacity: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" className="btn-primary" disabled={saving} id="save-edit-btn">
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          /* Event display */
          <div>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-white">{event.name}</h1>
                <p className="text-surface-400 mt-2 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                  </svg>
                  {formatDate(event.date)}
                </p>
              </div>

              {isOwner && (
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => setEditing(true)} className="btn-ghost text-sm" id="edit-event-btn">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                    </svg>
                    Edit
                  </button>
                  <button onClick={handleDelete} className="btn-danger text-sm" disabled={deleting} id="delete-event-btn">
                    {deleting ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              )}
            </div>

            {/* Capacity bar */}
            <div className="mt-6 p-4 bg-surface-700/30 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-surface-300">Capacity</span>
                <span className="text-sm font-medium text-surface-200">
                  {event.registered_count} / {event.capacity}
                </span>
              </div>
              <div className="w-full h-3 bg-surface-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    capacityPercent >= 90
                      ? 'bg-gradient-to-r from-red-500 to-red-400'
                      : capacityPercent >= 70
                      ? 'bg-gradient-to-r from-amber-500 to-amber-400'
                      : 'bg-gradient-to-r from-primary-500 to-primary-400'
                  }`}
                  style={{ width: `${capacityPercent}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Attendee: registration section */}
      {isAttendee && (
        <div className="card">
          {myRegistration ? (
            <div className="text-center py-4">
              <div className="inline-flex items-center gap-2 mb-4">
                <span className="badge-active">Registered</span>
                <span className={myRegistration.token_status === 'active' ? 'badge-active' : 'badge-used'}>
                  {myRegistration.token_status}
                </span>
              </div>
              <h2 className="text-lg font-semibold text-white mb-4">Your QR Code</h2>
              <QRCodeDisplay value={myRegistration.qr_token} />
              <p className="text-sm text-surface-400 mt-4">
                Present this QR code at the event for check-in
              </p>
            </div>
          ) : (
            <div className="text-center py-4">
              <h2 className="text-lg font-semibold text-white mb-2">
                {isFull ? 'Event is full' : 'Register for this event'}
              </h2>
              <p className="text-surface-400 text-sm mb-4">
                {isFull
                  ? 'All spots have been taken'
                  : `Spots available: ${event.capacity - event.registered_count}`}
              </p>
              {registerError && <div className="error-message mb-4">{registerError}</div>}
              <button
                onClick={handleRegister}
                className={isFull ? 'btn-ghost cursor-not-allowed opacity-60' : 'btn-primary'}
                disabled={registering || isFull}
                id="register-for-event-btn"
              >
                {registering ? 'Registering...' : isFull ? 'Event Full' : 'Register Now'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Organizer: registrations list */}
      {isOwner && (
        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-4">
            Registrations
            <span className="text-surface-400 font-normal text-sm ml-2">
              ({registrations.length})
            </span>
          </h2>

          {loadingRegs ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary-500 border-t-transparent" />
            </div>
          ) : registrations.length === 0 ? (
            <p className="text-surface-400 text-center py-8">No registrations yet</p>
          ) : (
            <div className="divide-y divide-surface-700/50">
              {registrations.map((reg) => (
                <div key={reg.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <div>
                    <p className="text-surface-200 font-medium">{reg.user_email}</p>
                    <p className="text-xs text-surface-500 font-mono">{reg.qr_token}</p>
                  </div>
                  <span className={reg.token_status === 'active' ? 'badge-active' : 'badge-used'}>
                    {reg.token_status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
