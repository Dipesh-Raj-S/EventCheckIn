import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('attendee');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.toLowerCase().endsWith('@vitstudent.ac.in')) {
      setError('Please use your VIT student email (@vitstudent.ac.in)');
      return;
    }

    setLoading(true);

    try {
      await login(email, password);
      navigate('/events');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary-600/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-primary-500/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-md relative">
        {/* Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-700 shadow-lg shadow-primary-900/40 mb-4">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Welcome back</h1>
          <p className="text-surface-400 mt-1">Sign in to your EventCheck account</p>
        </div>

        {/* Form card */}
        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && <div className="error-message" id="login-error">{error}</div>}

            <div>
              <div className="flex bg-surface-800 p-1 rounded-xl mb-6">
                <button
                  type="button"
                  onClick={() => setRole('attendee')}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                    role === 'attendee'
                      ? 'bg-primary-500 text-white shadow-sm'
                      : 'text-surface-400 hover:text-surface-200'
                  }`}
                >
                  Attendee
                </button>
                <button
                  type="button"
                  onClick={() => setRole('organizer')}
                  className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
                    role === 'organizer'
                      ? 'bg-primary-500 text-white shadow-sm'
                      : 'text-surface-400 hover:text-surface-200'
                  }`}
                >
                  Organizer
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="login-email" className="label">Email</label>
              <input
                id="login-email"
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
              <label htmlFor="login-password" className="label">Password</label>
              <input
                id="login-password"
                type="password"
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              className="btn-primary w-full"
              disabled={loading}
              id="login-submit"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          <p className="text-center text-sm text-surface-400 mt-6">
            Don&apos;t have an account?{' '}
            <Link to="/register" className="text-primary-400 hover:text-primary-300 font-medium transition-colors">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
