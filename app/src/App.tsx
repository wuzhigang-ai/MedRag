import { Routes, Route } from 'react-router';
// Direct imports — more reliable than React.lazy() with Vite HMR
import Login from './pages/Login';
import Register from './pages/Register';
import Welcome from './pages/Welcome';
import AdminLayout from './pages/AdminLayout';
import Dashboard from './pages/Dashboard';
import ParsingPage from './pages/ParsingPage';
import LibraryPage from './pages/LibraryPage';
import GraphPage from './pages/GraphPage';
import AdminChatPage from './pages/AdminChatPage';
import UserChatPage from './pages/UserChatPage';
import NotFound from './pages/NotFound';

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
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<Welcome />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="parsing" element={<ParsingPage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="graph" element={<GraphPage />} />
        <Route path="chat" element={<AdminChatPage />} />
      </Route>
      <Route path="/chat" element={<UserChatPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
