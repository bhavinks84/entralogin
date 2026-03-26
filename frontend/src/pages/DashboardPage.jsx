import AppLayout from '../components/layout/AppLayout';
import { useAuth } from '../context/AuthContext';

export default function DashboardPage() {
  const { user } = useAuth();

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Welcome, {user?.displayName || user?.email} 👋
          </h1>
          <p className="mt-1 text-sm text-gray-500">Here's what's happening with your account.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Account status', value: user?.emailVerified ? 'Verified ✓' : 'Unverified', color: user?.emailVerified ? 'text-green-600' : 'text-yellow-600' },
            { label: 'Role', value: user?.role, color: 'text-purple-600' },
            { label: 'Member since', value: user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '–', color: 'text-gray-700' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{stat.label}</p>
              <p className={`mt-1 text-lg font-semibold ${stat.color}`}>{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-2 text-base font-semibold text-gray-900">Quick links</h2>
          <ul className="list-inside list-disc space-y-1 text-sm text-primary-600">
            <li><a href="/profile" className="hover:underline">Update your profile</a></li>
            <li><a href="/settings" className="hover:underline">Account settings</a></li>
            {user?.role === 'admin' && <li><a href="/admin/users" className="hover:underline">Manage users</a></li>}
          </ul>
        </div>
      </div>
    </AppLayout>
  );
}
