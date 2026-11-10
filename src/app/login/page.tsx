import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Trading Journal" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <LoginForm next={next} />
    </main>
  );
}
