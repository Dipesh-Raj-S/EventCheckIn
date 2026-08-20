import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Navbar from './components/Navbar';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

import EventDashboardPage from "./pages/EventDashboardPage";
import EventsPage from './pages/EventsPage';
import EventDetailPage from './pages/EventDetailPage';

import MyRegistrationsPage from './pages/MyRegistrationsPage';
import ScannerPage from './pages/ScannerPage';


export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <div className="min-h-screen bg-surface-950">
          <Navbar />
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            {/* Protected routes — any authenticated user */}
            <Route
              path="/events"
              element={
                <ProtectedRoute>
                  <EventsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/events/:id"
              element={
                <ProtectedRoute>
                  <EventDetailPage />
                </ProtectedRoute>
              }
            />

            {/* Attendee-only route (server also enforces) */}
            <Route
              path="/my-registrations"
              element={
                <ProtectedRoute requiredRole="attendee">
                  <MyRegistrationsPage />
                </ProtectedRoute>
              }
            />

            {/* Organizer-only route (server also enforces via @role_required) */}
            <Route
              path="/scanner"
              element={
                <ProtectedRoute requiredRole="organizer">
                  <ScannerPage />
                </ProtectedRoute>
              }
            />

            <Route
              path="/events/:id/dashboard"
              element={
                <ProtectedRoute requiredRole="organizer">
                  <EventDashboardPage />
                </ProtectedRoute>
              }
            />

            {/* Default redirect */}
            <Route path="/" element={<Navigate to="/events" replace />} />
            <Route path="*" element={<Navigate to="/events" replace />} />
          </Routes>
        </div>
      </AuthProvider>
    </BrowserRouter>
  );
}
