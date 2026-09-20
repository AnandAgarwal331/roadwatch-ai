import type { Metadata } from "next";

import { ContactLine, LegalPage, LegalSection } from "@/components/shared/legal-page";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The rules for using RoadWatch AI and what to expect from it.",
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      intro="By creating an account or submitting a report you agree to these terms. This is currently a demonstration deployment, and what is shown is sample data rather than government records."
    >
      <LegalSection heading="This is not an emergency service">
        <p>
          <strong>
            If someone is in danger or a hazard needs an immediate response, call 112 (or your local
            emergency number).
          </strong>{" "}
          Reports here are reviewed by the works department and are not monitored around the clock.
        </p>
      </LegalSection>

      <LegalSection heading="Your reports">
        <ul>
          <li>Report real road problems, accurately, using your own photos.</li>
          <li>Do not upload other people&rsquo;s personal information, or anything offensive or unlawful.</li>
          <li>
            False, repeated or abusive reports may be removed, and the account behind them
            suspended.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="What to expect from the service">
        <ul>
          <li>
            Damage type, severity and priority are <strong>AI-assisted estimates</strong> made from
            a photograph. They can be wrong and are not an engineering inspection.
          </li>
          <li>
            Priority scores are recommendations for authorised staff. Submitting a report does not
            guarantee a repair or a repair date.
          </li>
          <li>
            Administrators may change a report&rsquo;s status or priority, merge it with a
            duplicate, or reject it.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Accounts">
        <p>
          Keep your password to yourself. Citizen accounts are created here; administrator and repair
          crew accounts are set up by an administrator. Accounts that misuse the service may be
          deactivated.
        </p>
      </LegalSection>

      <LegalSection heading="Availability and changes">
        <p>
          The service is provided as it is, without a promise that it will always be available or
          error-free, and it may change or stop. We may update these terms; the date above shows the
          latest version. How your information is handled is described in the{" "}
          <a href="/privacy" className="font-medium text-primary hover:underline">
            privacy notice
          </a>
          .
        </p>
        <ContactLine />
      </LegalSection>
    </LegalPage>
  );
}
