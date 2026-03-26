import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { authService } from '../services/authService';
import { useAuth } from '../context/AuthContext';
import OTPInput from '../components/auth/OTPInput';

const emailSchema = z.object({
  email: z.string().email('Enter a valid email address'),
  displayName: z.string().min(2, 'Name must be at least 2 characters').max(100),
});

// Steps: 'details' → 'otp' → success (redirect)
export default function RegisterPage() {
  const [step, setStep]     = useState('details');
  const [otp, setOtp]       = useState('');
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState(null);

  const { login } = useAuth();
  const navigate  = useNavigate();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(emailSchema) });

  // Step 1 – collect email + name, send OTP
  const onSendOtp = async (data) => {
    setLoading(true);
    try {
      await authService.requestOtp(data.email);
      setFormData(data);
      setStep('otp');
      toast.success('OTP sent! Check your email.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  // Step 2 – verify OTP → create account
  const onVerifyOtp = async () => {
    if (otp.length < 6) return toast.error('Enter the full 6-digit code');
    setLoading(true);
    try {
      const { data } = await authService.verifyOtp(formData.email, otp, formData.displayName);
      login(data.user);
      toast.success(data.isNewUser ? 'Account created! Welcome 🎉' : 'Welcome back!');
      navigate('/dashboard', { replace: true });
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
        <h1 className="mb-1 text-center text-2xl font-bold text-gray-900">Create an account</h1>
        <p className="mb-6 text-center text-sm text-gray-500">
          {step === 'details' ? 'Enter your details to get started' : `Code sent to ${formData?.email}`}
        </p>

        {step === 'details' ? (
          <form onSubmit={handleSubmit(onSendOtp)} noValidate className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Full name</label>
              <input
                type="text"
                autoComplete="name"
                {...register('displayName')}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary-600 focus:outline-none"
                placeholder="Jane Smith"
              />
              {errors.displayName && (
                <p className="mt-1 text-xs text-red-600">{errors.displayName.message}</p>
              )}
            </div>
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
              {loading ? 'Sending OTP…' : 'Continue'}
            </button>
          </form>
        ) : (
          <div className="space-y-5">
            <OTPInput value={otp} onChange={setOtp} disabled={loading} />
            <button
              onClick={onVerifyOtp}
              disabled={loading}
              className="w-full rounded-lg bg-primary-600 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {loading ? 'Creating account…' : 'Verify & create account'}
            </button>
            <button
              onClick={() => { setStep('details'); setOtp(''); }}
              className="w-full text-sm text-gray-500 underline"
            >
              Back
            </button>
          </div>
        )}

        <p className="mt-6 text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
