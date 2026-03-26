import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { authService } from '../services/authService';
import { useAuth } from '../context/AuthContext';
import OTPInput from '../components/auth/OTPInput';

// ── Schemas ──────────────────────────────
const emailSchema = z.object({
  email: z.string().email('Enter a valid email address'),
});

// ── LoginPage ─────────────────────────────
export default function LoginPage() {
  const [tab, setTab]           = useState('otp'); // 'otp' | 'entra'
  const [step, setStep]         = useState('email'); // 'email' | 'otp'
  const [pendingEmail, setPendingEmail] = useState('');
  const [otp, setOtp]           = useState('');
  const [loading, setLoading]   = useState(false);

  const { login } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const from      = location.state?.from?.pathname || '/dashboard';

  // Search params – check for errors from Entra callback
  const searchParams = new URLSearchParams(location.search);
  const urlError     = searchParams.get('error');

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm({ resolver: zodResolver(emailSchema) });

  // Step 1 – request OTP
  const onRequestOtp = async ({ email }) => {
    setLoading(true);
    try {
      await authService.requestOtp(email);
      setPendingEmail(email);
      setStep('otp');
      toast.success('Check your inbox for the OTP code.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  // Step 2 – verify OTP
  const onVerifyOtp = async () => {
    if (otp.length < 6) return toast.error('Enter the full 6-digit code');
    setLoading(true);
    try {
      const { data } = await authService.verifyOtp(pendingEmail, otp);
      login(data.user);
      toast.success('Welcome back!');
      navigate(from, { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Invalid OTP');
      setOtp('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="mb-1 text-center text-2xl font-bold text-gray-900">Welcome back</h1>
        <p className="mb-6 text-center text-sm text-gray-500">Sign in to continue</p>

        {urlError && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            Sign-in error: {decodeURIComponent(urlError)}
          </div>
        )}

        {/* Tabs */}
        <div className="mb-6 flex rounded-lg bg-gray-100 p-1 text-sm font-medium">
          {['otp', 'entra'].map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setStep('email'); setOtp(''); }}
              className={`flex-1 rounded-md py-2 transition ${
                tab === t ? 'bg-white shadow text-primary-600' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t === 'otp' ? 'Email OTP' : 'Microsoft / Work account'}
            </button>
          ))}
        </div>

        {/* ─── OTP Tab ─── */}
        {tab === 'otp' && (
          <>
            {step === 'email' ? (
              <form onSubmit={handleSubmit(onRequestOtp)} noValidate className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Email address</label>
                  <input
                    type="email"
                    autoComplete="email"
                    {...register('email')}
                    className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
                    placeholder="you@example.com"
                  />
                  {errors.email && (
                    <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
                >
                  {loading ? 'Sending…' : 'Send OTP'}
                </button>
              </form>
            ) : (
              <div className="space-y-5">
                <p className="text-center text-sm text-gray-600">
                  We sent a 6-digit code to <strong>{pendingEmail}</strong>
                </p>
                <OTPInput value={otp} onChange={setOtp} disabled={loading} />
                <button
                  onClick={onVerifyOtp}
                  disabled={loading}
                  className="w-full rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
                >
                  {loading ? 'Verifying…' : 'Sign in'}
                </button>
                <button
                  onClick={() => { setStep('email'); setOtp(''); }}
                  className="w-full text-sm text-gray-500 underline"
                >
                  Use a different email
                </button>
              </div>
            )}
          </>
        )}

        {/* ─── Entra Tab ─── */}
        {tab === 'entra' && (
          <div className="space-y-4">
            <p className="text-center text-sm text-gray-600">
              Sign in with your Microsoft work or school account.
            </p>
            <button
              onClick={() => authService.loginWithEntra()}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              {/* Microsoft "M" logo */}
              <svg width="20" height="20" viewBox="0 0 21 21" fill="none">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              Sign in with Microsoft
            </button>
          </div>
        )}

        <p className="mt-6 text-center text-sm text-gray-500">
          Don't have an account?{' '}
          <Link to="/register" className="font-medium text-primary-600 hover:underline">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
