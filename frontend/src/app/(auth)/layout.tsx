import Link from "next/link";

import { Logo } from "@/components/layout/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="container flex h-16 items-center">
          <Logo />
        </div>
      </header>

      <main id="main" className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">{children}</div>
      </main>

      <footer className="border-t border-border py-6">
        <div className="container flex flex-col items-center gap-2 text-center">
          <p className="text-xs text-muted-foreground">
            Priority scores are AI-assisted recommendations reviewed by authorised personnel.
          </p>
          <Link href="/" className="text-xs text-primary hover:underline">
            Back to home
          </Link>
        </div>
      </footer>
    </div>
  );
}
