import type { Metadata } from "next";

import { ContactLine, LegalPage, LegalSection } from "@/components/shared/legal-page";

export const metadata: Metadata = {
  title: "Privacy notice",
  description: "What RoadWatch AI collects, who can see it, and which services process it.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy notice"
      intro="This explains, in plain language, what information RoadWatch AI handles when you report a road problem, and who can see it. This is currently a demonstration deployment: the reports and records shown are sample data, not government records."
    >
      <LegalSection heading="What we collect">
        <ul>
          <li>
            <strong>Your account:</strong> your name, your email address and, only if you give one,
            a phone number. Your password is handled by our sign-in provider and stored in a form we
            cannot read.
          </li>
          <li>
            <strong>Your reports:</strong> the photo, the location (from your device if you allow
            it, or a point you pick on the map), your description, the road name and damage type if
            you enter them, and the time you submitted it.
          </li>
          <li>
            <strong>Activity on your reports:</strong> status changes, and actions taken by
            administrators and repair crews, are recorded in an audit trail.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="What other people can see">
        <ul>
          <li>
            <strong>Anyone</strong> can see a report&rsquo;s photo, location, description, damage
            type, status, priority and progress. Reports that were rejected or merged as duplicates
            are hidden from the public.
          </li>
          <li>
            <strong>Your name and email are not shown publicly.</strong> They are visible to you,
            to administrators, and to signed-in repair crew members.
          </li>
          <li>
            We remove hidden metadata (such as embedded GPS or camera details) from photos before
            storing them, but we do not blur what is in the picture. Please avoid faces, vehicle
            number plates and anything private in your photos.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="How it is used">
        <p>
          To identify the damage, score how urgent it is, let the works department assign and
          verify repairs, and tell you when your report changes status. It is not used for
          advertising and is not sold.
        </p>
      </LegalSection>

      <LegalSection heading="Other services that process it">
        <ul>
          <li>
            <strong>Supabase</strong> hosts the database, sign-in and stored photos.
          </li>
          <li>
            <strong>Vercel</strong> hosts the website.
          </li>
          <li>
            <strong>A places service (Geoapify)</strong> receives a report&rsquo;s coordinates, when
            enabled, to find nearby hospitals, schools and similar places.
          </li>
          <li>
            <strong>An AI vision service</strong> (currently a Qwen model through Groq) receives the
            report photo, when enabled, to detect the damage.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Cookies and browser storage">
        <p>
          Two essential cookies keep you signed in and route you to the right screen for your role.
          Your light or dark theme choice is saved in your browser. There are no advertising or
          analytics trackers.
        </p>
      </LegalSection>

      <LegalSection heading="Deleting things">
        <p>
          You can delete a report you submitted from <strong>My reports</strong> until it has been
          assigned, closed or otherwise acted on. It then disappears from view for everyone except
          administrators, who keep a record for audit.
        </p>
        <ContactLine />
      </LegalSection>
    </LegalPage>
  );
}
