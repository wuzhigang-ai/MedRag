import { Routes, Route } from 'react-router';
import { Suspense, lazy } from 'react';

// Lazy load pages for code splitting
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const Welcome = lazy(() => import('./pages/Welcome'));
const AdminLayout = lazy(() => import('./pages/AdminLayout'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ParsingPage = lazy(() => import('./pages/ParsingPage'));
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const GraphPage = lazy(() => import('./pages/GraphPage'));
const ChatPage = lazy(() => import('./pages/AdminChatPage'));
const UserChatPage = lazy(() => import('./pages/UserChatPage'));
const NotFound = lazy(() => import('./pages/NotFound'));

function LoadingFallback() {
  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-base)',
      color: 'var(--tx-700)',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 40,
          height: 40,
          border: '3px solid var(--bd-200)',
          borderTopColor: 'var(--m-primary)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          margin: '0 auto 16px',
        }} />
        <p style={{ fontSize: 14, color: 'var(--tx-300)' }}>Loading...</p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/" element={<Welcome />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="parsing" element={<ParsingPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="graph" element={<GraphPage />} />
          <Route path="chat" element={<ChatPage />} />
        </Route>
        <Route path="/chat" element={<UserChatPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
