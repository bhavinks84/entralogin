import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { authService } from '../services/authService';
import { useAuth } from '../context/AuthContext';
import AppLayout from '../components/layout/AppLayout';
import { useNavigate } from 'react-router-dom';

const resetSchema = z.object({
  email: z.string().email(),
});

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [resetSent, setResetSent] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(resetSchema),
    defaultValues: { email: user?.email || '' },
  });

  const onRequestReset = async ({ email }) => {
    try {
      await authService.requestPasswordReset(email);
      setResetSent(true);
      toast.success('Reset email sent if the account exists.');
    } catch {
      toast.error('Failed to send reset email.');
    }
  };

  const handleLogoutAll = async () => {
    await logout();
    toast.success('Logged out');
    navigate('/login');
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-lg space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Account settings</h1>

        {/* Password reset */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-base font-semibold text-gray-900">Password reset</h2>
          <p className="mb-4 text-sm text-gray-500">
            Receive a link to set or reset your account password.
          </p>
          {resetSent ? (
            <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">
              Check your inbox for a reset link.
            </p>
          ) : (
            <form onSubmit={handleSubmit(onRequestReset)} noValidate className="space-y-3">
              <input
                type="email"
                {...register('email')}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
              />
              {errors.email && <p className="text-xs text-red-600">{errors.email.message}</p>}
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-60"
              >
                {isSubmitting ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}
        </section>

        {/* Danger zone */}
        <section className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-base font-semibold text-red-700">Danger zone</h2>
          <p className="mb-4 text-sm text-gray-500">Log out of all devices immediately.</p>
          <button
            onClick={handleLogoutAll}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            Log out everywhere
          </button>
        </section>
      </div>
    </AppLayout>
  );
}
