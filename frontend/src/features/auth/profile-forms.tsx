"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import type { User } from "@/types";

const ROLE_LABELS: Record<User["role"], string> = {
  CITIZEN: "Citizen",
  ADMIN: "Administrator",
  REPAIR_TEAM: "Repair crew",
};

export function ProfileForms({ user }: { user: User }) {
  return (
    <div className="space-y-6">
      <DetailsCard user={user} />
      <PasswordCard />
      <AccountCard user={user} />
    </div>
  );
}

function DetailsCard({ user }: { user: User }) {
  const router = useRouter();
  const { success } = useToast();

  const [fullName, setFullName] = React.useState(user.full_name);
  const [phone, setPhone] = React.useState(user.phone ?? "");
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.patch<User>("/auth/me", { full_name: fullName.trim(), phone: phone.trim() || null }),
    onSuccess: () => {
      setFieldErrors({});
      setFormError(null);
      success("Profile updated");
      // The header greets the user by name, and it is rendered on the server.
      router.refresh();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors);
        setFormError(Object.keys(error.fieldErrors).length ? null : error.message);
        return;
      }
      setFormError(errorMessage(error));
    },
  });

  const dirty = fullName.trim() !== user.full_name || phone.trim() !== (user.phone ?? "");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your details</CardTitle>
        <CardDescription>
          The name shown on your reports, and a phone number the works department can use if they
          need to reach you about one.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field id="full_name" label="Full name" required error={fieldErrors.full_name}>
            <Input
              id="full_name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              autoComplete="name"
              required
              aria-describedby={fieldErrors.full_name ? "full_name-error" : undefined}
            />
          </Field>

          <Field
            id="phone"
            label="Phone number"
            hint="Optional. Digits, spaces and + ( ) - only."
            error={fieldErrors.phone}
          >
            <Input
              id="phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              autoComplete="tel"
              inputMode="tel"
              aria-describedby={fieldErrors.phone ? "phone-error" : "phone-hint"}
            />
          </Field>

          {formError ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {formError}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={!dirty || mutation.isPending}>
              {mutation.isPending ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordCard() {
  const { success } = useToast();

  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ message: string }>("/auth/change-password", {
        current_password: current,
        new_password: next,
      }),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setConfirm("");
      setFieldErrors({});
      setFormError(null);
      success("Password changed", "Use your new password the next time you sign in.");
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors);
        setFormError(Object.keys(error.fieldErrors).length ? null : error.message);
        return;
      }
      setFormError(errorMessage(error));
    },
  });

  // Checked here as well as on the server so the mismatch is caught before a
  // round-trip; the server remains the authority on strength.
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && next.length >= 8 && !mismatch && confirm.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          At least 8 characters, including a letter and a number.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field id="current_password" label="Current password" required error={fieldErrors.current_password}>
            <Input
              id="current_password"
              type="password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>

          <Field id="new_password" label="New password" required error={fieldErrors.new_password}>
            <Input
              id="new_password"
              type="password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>

          <Field
            id="confirm_password"
            label="Confirm new password"
            required
            error={mismatch ? "The two passwords do not match." : undefined}
          >
            <Input
              id="confirm_password"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
              required
            />
          </Field>

          {formError ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {formError}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending ? "Changing..." : "Change password"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function AccountCard({ user }: { user: User }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Email</dt>
            <dd className="mt-0.5 truncate text-sm font-medium">{user.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Role</dt>
            <dd className="mt-0.5 text-sm font-medium">{ROLE_LABELS[user.role]}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Member since</dt>
            <dd className="mt-0.5 text-sm font-medium">{formatDate(user.created_at)}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
