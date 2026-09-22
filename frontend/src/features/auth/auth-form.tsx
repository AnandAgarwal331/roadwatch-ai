"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ApiErrorBody, User } from "@/types";

const loginSchema = z.object({
  email: z.string().min(1, "Enter your email address").email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

const registerSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your name").max(120, "That name is too long"),
  email: z.string().min(1, "Enter your email address").email("Enter a valid email address"),
  phone: z
    .string()
    .trim()
    .max(32, "That phone number is too long")
    .regex(/^$|^[+0-9 ()-]{6,32}$/, "Enter a valid phone number")
    .optional(),
  password: z
    .string()
    .min(8, "Use at least 8 characters")
    .max(72, "Use at most 72 characters")
    .regex(/[A-Za-z]/, "Include at least one letter")
    .regex(/\d/, "Include at least one number"),
});

type LoginValues = z.infer<typeof loginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;

function homeFor(role: User["role"]): string {
  if (role === "ADMIN") return "/admin";
  if (role === "REPAIR_TEAM") return "/team";
  return "/my-reports";
}

/** Safe redirect target: same-origin paths only, never an absolute URL. */
function safeNext(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  // Set when registration succeeded but the account still has to be confirmed
  // by email, which replaces the form with instructions.
  const [confirmationSent, setConfirmationSent] = React.useState<string | null>(null);

  const isLogin = mode === "login";

  const form = useForm<LoginValues & Partial<RegisterValues>>({
    resolver: zodResolver(isLogin ? loginSchema : registerSchema) as never,
    defaultValues: { email: "", password: "", full_name: "", phone: "" },
  });

  async function onSubmit(values: LoginValues & Partial<RegisterValues>) {
    setFormError(null);
    setSubmitting(true);

    const payload = isLogin
      ? { email: values.email, password: values.password }
      : {
          email: values.email,
          password: values.password,
          full_name: values.full_name,
          ...(values.phone?.trim() ? { phone: values.phone.trim() } : {}),
        };

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        const error = (body as ApiErrorBody | null)?.error;

        // Surface field-level messages on the fields themselves.
        const fields = error?.details?.fields;
        if (Array.isArray(fields)) {
          for (const item of fields as { field: string; message: string }[]) {
            const name = item.field.split(".").pop();
            if (name && name in values) {
              form.setError(name as keyof LoginValues, { message: item.message });
            }
          }
        }

        setFormError(error?.message ?? "Something went wrong. Please try again.");
        setSubmitting(false);
        return;
      }

      if ((body as { needs_confirmation?: boolean } | null)?.needs_confirmation) {
        setConfirmationSent((body as { message: string }).message);
        setSubmitting(false);
        return;
      }

      const user = (body as { user: User }).user;
      queryClient.clear();

      const next = safeNext(params.get("next"));
      router.replace(next ?? homeFor(user.role));
      // Re-render server components so the header shows the signed-in state.
      router.refresh();
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  // The confirmation link lands here with the new session's tokens in the URL
  // fragment. We do not use them (the user signs in normally), so do not leave
  // them sitting in the address bar and browser history.
  React.useEffect(() => {
    if (window.location.hash.includes("access_token")) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  if (confirmationSent) {
    return (
      <Alert variant="success" title="Check your email">
        <p>{confirmationSent}</p>
      </Alert>
    );
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {isLogin && !formError && params.get("reason") === "idle" ? (
        <Alert variant="warning" title="You were signed out">
          <p>For your security, we sign you out after a period of inactivity. Please sign in again.</p>
        </Alert>
      ) : null}

      {isLogin && !formError && params.get("reason") === "expired" ? (
        <Alert variant="warning" title="Your session has ended">
          <p>Please sign in again to continue.</p>
        </Alert>
      ) : null}

      {isLogin && !formError && params.get("confirmed") === "1" ? (
        <Alert variant="success" title="Email confirmed">
          <p>Thanks - your address is confirmed. Sign in to get started.</p>
        </Alert>
      ) : null}

      {formError ? (
        <Alert variant="destructive" title={isLogin ? "Could not sign you in" : "Could not create your account"}>
          <p>{formError}</p>
        </Alert>
      ) : null}

      {!isLogin ? (
        <Field id="full_name" label="Full name" required error={form.formState.errors.full_name?.message}>
          <Input
            id="full_name"
            autoComplete="name"
            aria-invalid={form.formState.errors.full_name ? true : undefined}
            aria-describedby={form.formState.errors.full_name ? "full_name-error" : undefined}
            {...form.register("full_name")}
          />
        </Field>
      ) : null}

      <Field id="email" label="Email address" required error={form.formState.errors.email?.message}>
        <Input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          aria-invalid={form.formState.errors.email ? true : undefined}
          aria-describedby={form.formState.errors.email ? "email-error" : undefined}
          {...form.register("email")}
        />
      </Field>

      {!isLogin ? (
        <Field
          id="phone"
          label="Phone number"
          hint="Optional. Used only to contact you about your reports."
          error={form.formState.errors.phone?.message}
        >
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            aria-invalid={form.formState.errors.phone ? true : undefined}
            aria-describedby={form.formState.errors.phone ? "phone-error" : "phone-hint"}
            {...form.register("phone")}
          />
        </Field>
      ) : null}

      <Field
        id="password"
        label="Password"
        required
        hint={isLogin ? undefined : "At least 8 characters, including a letter and a number."}
        error={form.formState.errors.password?.message}
      >
        <Input
          id="password"
          type="password"
          autoComplete={isLogin ? "current-password" : "new-password"}
          aria-invalid={form.formState.errors.password ? true : undefined}
          aria-describedby={
            form.formState.errors.password ? "password-error" : isLogin ? undefined : "password-hint"
          }
          {...form.register("password")}
        />
      </Field>

      <Button type="submit" className="w-full" size="lg" loading={submitting}>
        {isLogin ? "Sign in" : "Create account"}
      </Button>
    </form>
  );
}
