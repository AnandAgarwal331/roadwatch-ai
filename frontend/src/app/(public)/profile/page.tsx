import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ProfileForms } from "@/features/auth/profile-forms";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Profile",
  description: "Update your name, phone number and password.",
};

export default async function ProfilePage() {
  // The proxy already keeps signed-out visitors away; this is the real
  // check, and it also gives the form its initial values.
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=%2Fprofile");

  return (
    <div className="container max-w-2xl py-8 md:py-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Profile</h1>
        <p className="mt-2 text-muted-foreground">
          Your contact details and password. Your email address is how you sign in and cannot be
          changed here.
        </p>
      </header>

      <ProfileForms user={user} />
    </div>
  );
}
