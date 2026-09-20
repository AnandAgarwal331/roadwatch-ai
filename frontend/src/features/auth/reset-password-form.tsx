"use client";

import Link from "next/link";
import * as React from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { passwordProblem } from "@/lib/password-rules";
import { parseRecoveryLink } from "@/lib/recovery-link";

const subscribeToHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

export function ResetPasswordForm() {
  // The link's token is in the URL fragment, which only the browser can read.
  // useSyncExternalStore gives "" on the server and during hydration, then the
  // real fragment - no hydration mismatch and no setState-in-effect.
  const hash = React.useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    () => "",
  );
  const link = React.useMemo(() => parseRecoveryLink(hash), [hash]);

  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);

  if (done) {
    return (
      <Alert variant="success" title="Password updated">
        <p>
          Your password has been changed.{" "}
          <Link href="/login" className="font-medium underline">
            Sign in
          </Link>{" "}
          with the new one.
        </p>
      </Alert>
    );
  }

  if (link.status !== "token") {
    return (
      <Alert
        variant={link.status === "error" ? "destructive" : "info"}
        title={link.status === "error" ? "Link not valid" : "Use the link from your email"}
      >
        <p>
          {link.status === "error"
            ? link.message
            : "This page opens from the reset link we email you."}{" "}
          <Link href="/forgot-password" className="font-medium underline">
            Request a new link
          </Link>
          .
        </p>
      </Alert>
    );
  }

  const accessToken = link.accessToken;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError("The two passwords do not match.");

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: accessToken, password }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Could not update your password.");
      }
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error ? (
        <Alert variant="destructive" title="Could not update your password">
          <p>{error}</p>
        </Alert>
      ) : null}

      <Field
        id="new-password"
        label="New password"
        required
        hint="At least 8 characters, including a letter and a number."
      >
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Field>

      <Field id="confirm-password" label="Confirm new password" required>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
        />
      </Field>

      <Button type="submit" className="w-full" size="lg" loading={submitting}>
        Set new password
      </Button>
    </form>
  );
}
