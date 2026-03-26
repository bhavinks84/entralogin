import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LogOut, LayoutDashboard, User, Settings, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const handleLogout = async () => {
    await logout();
    toast.success('Logged out');
    navigate('/login');
  };

  return (
    <nav className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link to="/dashboard" className="text-xl font-bold text-primary-600">
          EntraLogin
        </Link>

        <div className="flex items-center gap-4 text-sm text-gray-700">
          <Link to="/dashboard" className="flex items-center gap-1 hover:text-primary-600">
            <LayoutDashboard size={16} /> Dashboard
          </Link>
          <Link to="/profile" className="flex items-center gap-1 hover:text-primary-600">
            <User size={16} /> Profile
          </Link>
          <Link to="/settings" className="flex items-center gap-1 hover:text-primary-600">
            <Settings size={16} /> Settings
          </Link>

          {user.role === 'admin' && (
            <Link to="/admin/users" className="flex items-center gap-1 text-purple-600 hover:text-purple-800">
              <ShieldCheck size={16} /> Admin
            </Link>
          )}

          <span className="text-gray-400">|</span>
          <span className="font-medium">{user.displayName || user.email}</span>

          <button
            onClick={handleLogout}
            className="flex items-center gap-1 text-red-500 hover:text-red-700"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </div>
    </nav>
  );
}
