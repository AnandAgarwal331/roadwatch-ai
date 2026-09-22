import Link from "next/link";

import { Logo } from "@/components/layout/logo";
import { PRIORITY_DISCLAIMER } from "@/lib/constants";

const COLUMNS = [
  {
    heading: "Product",
    links: [
      { href: "/reports", label: "Explore issues" },
      { href: "/map", label: "City map" },
      { href: "/report", label: "Report a problem" },
    ],
  },
  {
    heading: "For authorities",
    links: [
      { href: "/admin", label: "Admin dashboard" },
      { href: "/team", label: "Repair team" },
      { href: "/login", label: "Staff sign in" },
    ],
  },
  {
    heading: "About",
    links: [
      { href: "/privacy", label: "Privacy notice" },
      { href: "/terms", label: "Terms of use" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-muted/30">
      <div className="container py-12">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted-foreground">
              An AI-assisted road damage reporting and prioritisation platform for citizens and
              municipal authorities.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2 className="font-display text-sm font-semibold">{column.heading}</h2>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-10 space-y-3 border-t border-border pt-6">
          {/* Stated plainly, in the footer of every page. */}
          <p className="text-xs leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground">Important:</strong>{" "}
            {PRIORITY_DISCLAIMER} Visual severity is estimated from photographs and is not an
            engineering inspection.
          </p>
          <p className="text-xs text-muted-foreground">
            Demonstration deployment. All reports, locations and resolution records shown are
            synthetic sample data and are not government records.
          </p>
        </div>
      </div>
    </footer>
  );
}
