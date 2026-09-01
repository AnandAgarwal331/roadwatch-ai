import {
  ArrowRight,
  BarChart3,
  Camera,
  CheckCircle2,
  Info,
  MapPin,
  Route,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Timer,
} from "lucide-react";
import Link from "next/link";

import { HeroMap } from "@/components/landing/hero-map";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PRIORITY_DISCLAIMER } from "@/lib/constants";
import { serverFetch } from "@/lib/session";

interface PublicStats {
  total_reports: number;
  resolved: number;
  unresolved: number;
  resolution_rate: number;
  reports_last_7_days: number;
  average_resolution_hours: number | null;
}

export const dynamic = "force-dynamic";

const STEPS = [
  {
    icon: Camera,
    title: "Snap and submit",
    body: "A citizen photographs the problem. Location is captured from GPS or picked on the map. The whole flow takes under a minute on a phone.",
  },
  {
    icon: ScanLine,
    title: "AI reads the photo",
    body: "Computer vision identifies the damage type, how confident it is, and how much of the frame the damage covers - producing a visual severity estimate.",
  },
  {
    icon: Route,
    title: "Context is gathered",
    body: "The system checks traffic on that stretch, nearby hospitals, schools and bus stops, and whether the same spot has been reported before.",
  },
  {
    icon: BarChart3,
    title: "Priority is explained",
    body: "Every factor and the points it contributed are shown alongside the score, so staff can see exactly why something ranked where it did.",
  },
];

const FEATURES = [
  {
    icon: Sparkles,
    title: "Detection you can interrogate",
    body: "Damage type, confidence and bounding boxes are stored with every report. When the model is unsure, it says so and the report goes for manual review rather than guessing.",
  },
  {
    icon: MapPin,
    title: "Context-aware scoring",
    body: "A pothole outside an emergency entrance is not the same problem as one on a quiet lane. Proximity to critical facilities is measured in metres and weighted accordingly.",
  },
  {
    icon: Timer,
    title: "Repeat offenders surface",
    body: "Reports clustered at the same spot raise the score. A location that keeps being reported and never fixed is exactly what a queue should push to the top.",
  },
  {
    icon: ShieldCheck,
    title: "Accountable by design",
    body: "Every status change, assignment and priority override is recorded with the actor, the timestamp and the old and new values.",
  },
];

export default async function LandingPage() {
  // Live aggregate figures from the public stats endpoint. The page renders
  // fine without them, so a backend outage degrades rather than breaks.
  const stats = await serverFetch<PublicStats>("/api/stats/public");

  return (
    <>
      {/* -- Hero ------------------------------------------------------- */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="pointer-events-none absolute inset-0 grid-backdrop" aria-hidden="true" />

        <div className="container relative py-16 md:py-24">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
            <div className="animate-fade-up">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />
                AI-assisted civic infrastructure reporting
              </span>

              <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-[3.4rem] lg:leading-[1.06]">
                Make Every Road Safer.
              </h1>

              <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground text-pretty">
                Report road damage. Let AI identify the problem. Help cities fix what matters most.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg">
                  <Link href="/report">
                    Report a Road Problem
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/reports">Explore Road Issues</Link>
                </Button>
              </div>

              {stats ? (
                <dl className="mt-10 grid max-w-md grid-cols-3 gap-6 border-t border-border pt-6">
                  {[
                    { label: "Reports handled", value: stats.total_reports },
                    { label: "Resolved", value: stats.resolved },
                    { label: "Open now", value: stats.unresolved },
                  ].map((stat) => (
                    <div key={stat.label}>
                      <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                      <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">
                        {stat.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </div>

            <div className="animate-fade-up [animation-delay:120ms]">
              <HeroMap />
            </div>
          </div>
        </div>
      </section>

      {/* -- How it works ---------------------------------------------- */}
      <section id="how-it-works" className="border-b border-border py-16 md:py-24">
        <div className="container">
          <SectionHeading
            eyebrow="How it works"
            title="From a photo to a prioritised work order"
            description="Four stages, each of which records what it decided and why."
          />

          <ol className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <Card className="h-full p-6">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <step.icon className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                      Step {index + 1}
                    </span>
                  </div>
                  <h3 className="mt-4 text-base font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                </Card>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* -- Explainable priority -------------------------------------- */}
      <section className="border-b border-border bg-muted/30 py-16 md:py-24">
        <div className="container">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div>
              <SectionHeading
                eyebrow="Smart prioritisation"
                title="Every score shows its working"
                description="A number a municipal officer cannot interrogate is a number they cannot act on. So the breakdown is the interface, not a tooltip."
                align="left"
              />

              <ul className="mt-8 space-y-3">
                {[
                  "Four weighted factors, each normalised to a 0-10 scale",
                  "Points contributed shown against each factor's maximum",
                  "A written explanation naming the factors that drove the result",
                  "Weights and thresholds configurable per city, not hard-coded",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm">
                    <CheckCircle2
                      className="mt-0.5 h-[18px] w-[18px] shrink-0 text-success"
                      aria-hidden="true"
                    />
                    <span className="text-muted-foreground">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <Card className="p-6">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Priority score
                  </p>
                  <p className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-4xl font-semibold tabular-nums tracking-tight">86.5</span>
                    <span className="text-lg text-muted-foreground">/ 100</span>
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-priority-critical/30 bg-priority-critical/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-priority-critical">
                  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
                  Critical
                </span>
              </div>

              <ul className="mt-6 space-y-4">
                {[
                  { label: "Visual severity", value: "9.0", points: "+36.0", max: "40", width: "90%", tone: "bg-priority-critical" },
                  { label: "Traffic", value: "8.0", points: "+20.0", max: "25", width: "80%", tone: "bg-priority-high" },
                  { label: "Location risk", value: "10.0", points: "+20.0", max: "20", width: "100%", tone: "bg-priority-medium" },
                  { label: "Complaint history", value: "7.0", points: "+10.5", max: "15", width: "70%", tone: "bg-priority-low" },
                ].map((factor) => (
                  <li key={factor.label}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium">{factor.label}</span>
                      <span className="tabular-nums text-muted-foreground">
                        <span className="font-medium text-foreground">{factor.value}</span>/10
                        <span className="mx-1.5 text-border">|</span>
                        <span className="font-medium text-foreground">{factor.points}</span> of{" "}
                        {factor.max} pts
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full rounded-full ${factor.tone}`} style={{ width: factor.width }} />
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-5 flex items-baseline justify-between border-t border-border pt-3 text-sm font-medium">
                <span>Total</span>
                <span className="tabular-nums">86.5 / 100</span>
              </div>

              <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{PRIORITY_DISCLAIMER}</span>
              </p>
            </Card>
          </div>
        </div>
      </section>

      {/* -- Feature grid ---------------------------------------------- */}
      <section className="border-b border-border py-16 md:py-24">
        <div className="container">
          <SectionHeading
            eyebrow="Built for the people who fix roads"
            title="Detection, context and accountability"
          />

          <div className="mt-12 grid gap-6 md:grid-cols-2">
            {FEATURES.map((feature) => (
              <Card key={feature.title} className="p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <feature.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-base font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.body}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* -- Map + tracking -------------------------------------------- */}
      <section className="border-b border-border bg-muted/30 py-16 md:py-24">
        <div className="container grid gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeading
              eyebrow="Real-time city map"
              title="See the whole city at once"
              description="Every open report on one map, coloured by priority and filterable by damage type, status, area and date. Click a marker for the full assessment."
              align="left"
            />
            <Button asChild variant="outline" className="mt-6">
              <Link href="/map">
                Open the city map
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>

          <div>
            <SectionHeading
              eyebrow="Transparent resolution tracking"
              title="Citizens see what happened next"
              description="Reported, analysed, prioritised, assigned, started, resolved - each step is timestamped, and the person who filed the report is notified as it moves."
              align="left"
            />
            <Button asChild variant="outline" className="mt-6">
              <Link href="/reports">
                Browse recent reports
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* -- CTA -------------------------------------------------------- */}
      <section className="py-16 md:py-24">
        <div className="container">
          <Card className="overflow-hidden bg-primary text-primary-foreground">
            <div className="relative px-6 py-14 text-center sm:px-12">
              <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                Spotted a problem on your street?
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-primary-foreground/85 text-pretty">
                It takes under a minute. Your report is analysed, scored and put in front of the
                people who can fix it.
              </p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <Button asChild size="lg" variant="secondary">
                  <Link href="/report">
                    Report a Road Problem
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="border-primary-foreground/30 bg-transparent text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
                >
                  <Link href="/register">Create an account</Link>
                </Button>
              </div>
            </div>
          </Card>
        </div>
      </section>
    </>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
}: {
  eyebrow: string;
  title: string;
  description?: string;
  align?: "center" | "left";
}) {
  return (
    <div className={align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-xl"}>
      <p className="text-xs font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {description ? (
        <p className="mt-4 leading-relaxed text-muted-foreground text-pretty">{description}</p>
      ) : null}
    </div>
  );
}
