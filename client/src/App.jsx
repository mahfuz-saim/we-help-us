import { Routes, Route } from 'react-router-dom';

import MainLayout from './layouts/MainLayout.jsx';
import HomePage from './pages/HomePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import HealthPage from './pages/HealthPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

/**
 * App router.
 *
 * Phase 0 wires up placeholder routes so the SPA shell is reachable.
 * Feature routes (search, registration, dashboards) are added by later
 * modules. Placeholders deliberately link to future module paths so the
 * router layout is stable and imports don't need to be moved later.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route index element={<HomePage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />

        {/* Authenticated — Module 1.3 + 1.4 */}
        <Route element={<ProtectedRoute />}>
          <Route path="profile" element={<ProfilePage />} />
        </Route>

        {/* Owner-only — added in Phase 3.5 */}
        <Route element={<ProtectedRoute roles={['OWNER']} />}>
          <Route
            path="owner/resources"
            element={<HomePage placeholder="My Resources (3.5)" />}
          />
        </Route>

        {/* Volunteer-only — added in Phase 5.3 */}
        <Route element={<ProtectedRoute roles={['VOLUNTEER']} />}>
          <Route
            path="volunteer/requests"
            element={<HomePage placeholder="My Requests (5.3)" />}
          />
        </Route>

        {/* Moderator-only — added in Phase 5.5 */}
        <Route element={<ProtectedRoute roles={['MODERATOR', 'ADMIN']} />}>
          <Route
            path="moderator"
            element={<HomePage placeholder="Moderator Dashboard (5.5)" />}
          />
        </Route>

        {/* Public utility */}
        <Route path="health" element={<HealthPage />} />

        {/* 404 */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}