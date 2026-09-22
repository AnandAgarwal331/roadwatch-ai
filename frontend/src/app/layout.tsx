import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";

import { Providers } from "@/app/providers";
import { siteUrl } from "@/lib/site-url";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// Headlines and the handful of numbers meant to carry weight (a priority
// score, a stat) - see tailwind.config.ts's `font-display` for where this is
// actually used; body copy stays on Inter.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  openGraph: {
    type: "website",
    siteName: "RoadWatch AI",
    title: "RoadWatch AI - Make every road safer",
    description:
      "Report road damage, let AI identify the problem, and help cities fix what matters most.",
  },
  twitter: { card: "summary_large_image" },
  title: {
    default: "RoadWatch AI - Make every road safer",
    template: "%s | RoadWatch AI",
  },
  description:
    "Report road damage, let AI identify the problem, and help cities fix what matters most. AI-assisted prioritisation for municipal road maintenance.",
  applicationName: "RoadWatch AI",
  keywords: ["road damage", "pothole reporting", "civic technology", "municipal maintenance"],
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafbfe" },
    { media: "(prefers-color-scheme: dark)", color: "#080b17" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`} suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans">
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
