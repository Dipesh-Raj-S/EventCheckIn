import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, isOrganizer, isAttendee, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (!isAuthenticated) return null;

  return (
    <nav className="sticky top-0 z-50 bg-surface-900/80 backdrop-blur-lg border-b border-surface-700/50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo / Brand */}
          <Link to="/events" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-md shadow-primary-900/40 group-hover:shadow-lg group-hover:shadow-primary-900/50 transition-shadow">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span className="text-lg font-semibold text-surface-100 group-hover:text-white transition-colors">
              EventCheck
            </span>
          </Link>

          {/* Nav Links */}
          <div className="flex items-center gap-1">
            <Link
              to="/events"
              className="px-3 py-2 rounded-lg text-sm font-medium text-surface-300 hover:text-white hover:bg-surface-700/50 transition-all"
            >
              Events
            </Link>

            {isAttendee && (
              <Link
                to="/my-registrations"
                className="px-3 py-2 rounded-lg text-sm font-medium text-surface-300 hover:text-white hover:bg-surface-700/50 transition-all"
              >
                My Registrations
              </Link>
            )}

            {isOrganizer && (
              <Link
                to="/scanner"
                className="px-3 py-2 rounded-lg text-sm font-medium text-surface-300 hover:text-white hover:bg-surface-700/50 transition-all flex items-center gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                </svg>
                Scan
              </Link>
            )}

            {/* User info + logout */}
            <div className="flex items-center gap-3 ml-4 pl-4 border-l border-surface-700/50">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-surface-200">{user?.email}</p>
                <p className="text-xs text-surface-400 capitalize">
                  {isOrganizer && user?.club ? `${user.club} Organizer` : user?.role}
                </p>
              </div>
              <span className={isOrganizer ? 'badge-organizer' : 'badge-attendee'}>
                {user?.role}
              </span>
              <button
                onClick={handleLogout}
                className="p-2 rounded-lg text-surface-400 hover:text-red-400 hover:bg-red-500/10 transition-all"
                title="Logout"
                id="logout-btn"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
