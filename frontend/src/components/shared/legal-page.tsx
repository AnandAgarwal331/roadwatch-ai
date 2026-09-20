import * as React from "react";

import { CONTACT_EMAIL } from "@/lib/site-url";

export const LEGAL_UPDATED = "21 September 2026";

export function LegalPage({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <div className="container max-w-3xl py-10 md:py-14">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">Last updated {LEGAL_UPDATED}</p>
      <p className="mt-6 text-base leading-relaxed text-muted-foreground">{intro}</p>
      <div className="mt-8 space-y-8">{children}</div>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold">{heading}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground [&_li]:ml-5 [&_li]:list-disc [&_strong]:font-medium [&_strong]:text-foreground">
        {children}
      </div>
    </section>
  );
}

export function ContactLine() {
  return CONTACT_EMAIL ? (
    <p>
      Questions, or a request to correct or remove your information:{" "}
      <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-primary hover:underline">
        {CONTACT_EMAIL}
      </a>
      .
    </p>
  ) : (
    <p>
      For questions, or a request to correct or remove your information, contact the authority that
      operates this service.
    </p>
  );
}
