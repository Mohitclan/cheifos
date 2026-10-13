import { redirect } from 'next/navigation';
import { currentUser, homeFor } from '@/lib/auth/guard';
import { isSeeded } from '@/lib/db/queries';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata = { title: 'Sign in - ChiefOS' };

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(homeFor(user));

  return (
    <main className="flex min-h-screen items-center justify-center bg-navy-950 px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7">
          <p className="text-lg font-semibold tracking-tight text-white">ChiefOS</p>
          <p className="mt-0.5 text-sm text-navy-300">AI Chief of Staff</p>
        </div>

        <LoginForm seeded={isSeeded()} />

        <p className="mt-6 text-[11px] leading-relaxed text-navy-400">
          Demo workspace. All people, projects and updates are fictional. Sessions are signed and
          role is enforced on the server - an employee account cannot reach the CEO surfaces.
        </p>
      </div>
    </main>
  );
}
