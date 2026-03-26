import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';
import AppLayout from '../../components/layout/AppLayout';
import { Users, ShieldCheck, CheckCircle, Activity } from 'lucide-react';

export default function AdminAnalyticsPage() {
  const [stats, setStats]   = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminService
      .getAnalytics()
      .then(({ data }) => setStats(data))
      .catch(() => toast.error('Failed to load analytics'))
      .finally(() => setLoading(false));
  }, []);

  const cards = stats
    ? [
        { label: 'Total users',           value: stats.totalUsers,    icon: Users,        color: 'text-blue-600'  },
        { label: 'Admins',                value: stats.adminCount,    icon: ShieldCheck,  color: 'text-purple-600'},
        { label: 'Verified emails',        value: stats.verifiedCount, icon: CheckCircle,  color: 'text-green-600' },
        { label: 'Logins (last 7 days)',   value: stats.recentLogins,  icon: Activity,     color: 'text-orange-600'},
      ]
    : [];

  return (
    <AppLayout>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Analytics</h1>

      {loading ? (
        <p className="text-gray-400">Loading…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <Icon className={`mb-2 ${color}`} size={24} />
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
              <p className={`mt-1 text-3xl font-bold ${color}`}>{value}</p>
            </div>
          ))}
        </div>
      )}
    </AppLayout>
  );
}
