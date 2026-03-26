import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { authService } from '../services/authService';
import { useAuth } from '../context/AuthContext';
import AppLayout from '../components/layout/AppLayout';

const schema = z.object({
  displayName: z.string().min(1).max(100),
  givenName:   z.string().max(100).optional(),
  surname:     z.string().max(100).optional(),
});

export default function ProfilePage() {
  const { user, updateUser } = useAuth();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      displayName: user?.displayName || '',
      givenName:   user?.givenName   || '',
      surname:     user?.surname     || '',
    },
  });

  const onSubmit = async (data) => {
    try {
      const res = await authService.updateProfile(data);
      updateUser(res.data.user);
      toast.success('Profile updated!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Update failed');
    }
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-lg">
        <h1 className="mb-6 text-2xl font-bold text-gray-900">Your profile</h1>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          {/* Avatar placeholder */}
          <div className="mb-6 flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-600 text-2xl font-bold text-white">
              {(user?.displayName || user?.email || '?')[0].toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-gray-900">{user?.displayName}</p>
              <p className="text-sm text-gray-500">{user?.email}</p>
              <span className="mt-1 inline-block rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                {user?.role}
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
            {[
              { name: 'displayName', label: 'Display name' },
              { name: 'givenName',   label: 'First name' },
              { name: 'surname',     label: 'Last name' },
            ].map(({ name, label }) => (
              <div key={name}>
                <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
                <input
                  type="text"
                  {...register(name)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
                />
                {errors[name] && (
                  <p className="mt-1 text-xs text-red-600">{errors[name].message}</p>
                )}
              </div>
            ))}

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
              <input
                type="email"
                value={user?.email || ''}
                disabled
                className="w-full cursor-not-allowed rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-500"
              />
              <p className="mt-1 text-xs text-gray-400">Email changes are not supported yet.</p>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {isSubmitting ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        </div>
      </div>
    </AppLayout>
  );
}
