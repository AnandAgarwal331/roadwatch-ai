import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthForm } from "@/features/auth/auth-form";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create a citizen account to report road problems in your area.",
};

export default function RegisterPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create your account</CardTitle>
        <CardDescription>
          Report problems in your area and follow them through to repair.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <Suspense fallback={<Skeleton className="h-80 w-full" />}>
          <AuthForm mode="register" />
        </Suspense>

        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>

        <p className="text-center text-xs text-muted-foreground">
          By creating an account you agree to the{" "}
          <Link href="/terms" className="underline hover:text-foreground">
            terms of use
          </Link>{" "}
          and the{" "}
          <Link href="/privacy" className="underline hover:text-foreground">
            privacy notice
          </Link>
          .
        </p>

        <p className="text-center text-xs text-muted-foreground">
          Accounts created here are citizen accounts. Municipal staff and repair crews are
          provisioned by an administrator.
        </p>
      </CardContent>
    </Card>
  );
}
