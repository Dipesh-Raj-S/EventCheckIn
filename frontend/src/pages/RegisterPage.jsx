import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api';

export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('attendee');
  const [organizerCode, setOrganizerCode] = useState('');
  const [club, setClub] = useState('');
  const [clubsList, setClubsList] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { register, login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchClubs = async () => {
      try {
        const res = await api.get('/auth/clubs');
        setClubsList(res.data.clubs || []);
      } catch (err) {
        console.error('Failed to fetch clubs', err);
      }
    };
    fetchClubs();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    if (!email.toLowerCase().endsWith('@vitstudent.ac.in')) {
      setError('Please use your VIT student email (@vitstudent.ac.in)');
      return;
    }
    
    if (role === 'organizer' && !club) {
      setError('Please select a club affiliation');
      return;
    }

    setLoading(true);

    try {
      await register(email, password, role, organizerCode, club);
      // Auto-login after registration
      await login(email, password);
      navigate('/events');
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -left-40 w-80 h-80 bg-primary-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -right-40 w-80 h-80 bg-primary-500/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 shadow-lg shadow-primary-900/40 mb-4">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Create your account</h1>
          <p className="text-surface-400 mt-1">Join EventCheck to manage or attend events</p>
        </div>

        {/* Form card */}
        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && <div className="error-message" id="register-error">{error}</div>}

            <div>
              <label htmlFor="register-email" className="label">Email</label>
              <input
                id="register-email"
                type="email"
                className="input"
                placeholder="yourname@vitstudent.ac.in"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label htmlFor="register-password" className="label">Password</label>
              <input
                id="register-password"
                type="password"
                className="input"
                placeholder="Minimum 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>

            <div>
              <label className="label">I want to...</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => { setRole('attendee'); setOrganizerCode(''); }}
                  className={`p-4 rounded-xl border-2 text-center transition-all ${
                    role === 'attendee'
                      ? 'border-primary-500 bg-primary-500/10 text-primary-300'
                      : 'border-surface-600 bg-surface-800 text-surface-300 hover:border-surface-500'
                  }`}
                  id="role-attendee"
                >
                  <svg className="w-6 h-6 mx-auto mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                  </svg>
                  <span className="text-sm font-semibold">Attend an Event</span>
                  <span className="block text-xs mt-1 opacity-60">Browse & register for events</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRole('organizer')}
                  className={`p-4 rounded-xl border-2 text-center transition-all ${
                    role === 'organizer'
                      ? 'border-primary-500 bg-primary-500/10 text-primary-300'
                      : 'border-surface-600 bg-surface-800 text-surface-300 hover:border-surface-500'
                  }`}
                  id="role-organizer"
                >
                  <svg className="w-6 h-6 mx-auto mb-2" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
                  </svg>
                  <span className="text-sm font-semibold">Organize an Event</span>
                  <span className="block text-xs mt-1 opacity-60">Create & manage events</span>
                </button>
              </div>
            </div>

            {/* Organizer code and club fields — only shown when "Organize an Event" is selected */}
            {role === 'organizer' && (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                <div>
                  <label htmlFor="organizer-club" className="label">
                    Club Affiliation
                    <span className="text-surface-500 font-normal ml-1">(required)</span>
                  </label>
                  <select
                    id="organizer-club"
                    className="input bg-surface-800"
                    value={club}
                    onChange={(e) => setClub(e.target.value)}
                    required
                  >
                    <option value="" disabled>Select your club...</option>
                    {clubsList.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="organizer-code" className="label">
                    Organizer Code -1309-
                    <span className="text-surface-500 font-normal ml-1">(required)</span>
                  </label>
                  <input
                    id="organizer-code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    maxLength={4}
                    className="input font-mono text-center tracking-[0.5em] text-lg"
                    placeholder="• • • •"
                    value={organizerCode}
                    onChange={(e) => {
                      // Allow only digits, max 4
                      const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                      setOrganizerCode(val);
                    }}
                    required
                    autoComplete="off"
                  />
                  <p className="text-xs text-surface-500 mt-1.5">
                    Enter the 4-digit code provided by your organization
                  </p>
                </div>
              </div>
            )}

            <button
              type="submit"
              className="btn-primary w-full"
              disabled={loading}
              id="register-submit"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          <p className="text-center text-sm text-surface-400 mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-primary-400 hover:text-primary-300 font-medium transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
