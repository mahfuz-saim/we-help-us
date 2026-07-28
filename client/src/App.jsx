import { Routes, Route } from 'react-router-dom';

import MainLayout from './layouts/MainLayout.jsx';
import HomePage from './pages/HomePage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import HealthPage from './pages/HealthPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import ResourceRegisterPage from './pages/owner/ResourceRegisterPage.jsx';
import OwnerDashboardPage from './pages/owner/OwnerDashboardPage.jsx';
import SearchPage from './pages/SearchPage.jsx';
import ResourceDetailsPage from './pages/ResourceDetailsPage.jsx';
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
          {/* Resource search (Module 4.1) — any logged-in role. */}
          <Route path="resources" element={<SearchPage />} />
          {/* Resource details (Module 4.2) — any logged-in role. */}
          <Route path="resources/:id" element={<ResourceDetailsPage />} />
        </Route>

        {/* Owner-only — dashboard (3.5) + registration form (3.4) */}
        <Route element={<ProtectedRoute roles={['OWNER']} />}>
          <Route
            path="owner/resources"
            element={<OwnerDashboardPage />}
          />
          <Route
            path="owner/resources/new"
            element={<ResourceRegisterPage />}
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