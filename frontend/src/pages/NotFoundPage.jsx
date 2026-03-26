import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 text-center">
      <h1 className="text-7xl font-black text-gray-200">404</h1>
      <p className="text-xl font-semibold text-gray-700">Page not found</p>
      <Link to="/dashboard" className="text-primary-600 hover:underline">
        Go back home
      </Link>
    </div>
  );
}
