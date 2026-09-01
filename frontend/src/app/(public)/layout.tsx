import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { getCurrentUser } from "@/lib/session";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  // Resolved server-side so the header renders signed-in on first paint,
  // with no flash of the signed-out state.
  const user = await getCurrentUser();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader user={user} />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
