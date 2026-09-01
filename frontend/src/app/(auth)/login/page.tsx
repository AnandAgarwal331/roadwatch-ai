import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthForm } from "@/features/auth/auth-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to report road problems and track their progress.",
};

export default function LoginPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Sign in to report problems and track their progress.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* useSearchParams needs a Suspense boundary during prerender. */}
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <AuthForm mode="login" />
        </Suspense>

        <p className="text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Create an account
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
