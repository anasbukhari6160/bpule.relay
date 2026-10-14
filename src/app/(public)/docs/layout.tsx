import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { siteConfig } from "@/lib/site-config";

const DOC_SECTIONS = [
  { href: "/docs", label: "What is Relay?" },
  { href: "/docs/getting-started", label: "Getting Started" },
  { href: "/docs/founder-setup", label: "Founder/Admin Setup" },
  { href: "/docs/identities", label: "Revenue Identities" },
  { href: "/docs/team", label: "Inviting & Assigning BDs" },
  { href: "/docs/bd-workflow", label: "BD Daily Workflow" },
  { href: "/docs/prospect-check", label: "Prospect Check" },
  { href: "/docs/leads", label: "Leads" },
  { href: "/docs/outreach", label: "Outreach" },
  { href: "/docs/follow-ups", label: "Follow-ups & Replies" },
  { href: "/docs/jobs", label: "Jobs & Proposals" },
  { href: "/docs/studio", label: "Studio" },
  { href: "/docs/oversight", label: "Team Oversight" },
  { href: "/docs/analytics", label: "Analytics" },
  { href: "/docs/usage", label: "Usage & Limits" },
  { href: "/docs/account", label: "Account & Security" },
  { href: "/docs/faq", label: "FAQ" },
];

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl section-padding py-12 lg:py-16">
      <div className="lg:grid lg:grid-cols-[14rem_1fr] lg:gap-12">
        {/* Sidebar */}
        <aside className="hidden lg:block">
          <nav className="sticky top-20 space-y-1">
            <Link
              href="/"
              className="mb-6 flex items-center gap-2 text-[13px] text-graphite transition-colors hover:text-ink"
            >
              <ArrowLeft className="size-3.5" />
              Back to {siteConfig.name}
            </Link>
            {DOC_SECTIONS.map((section) => (
              <Link
                key={section.href}
                href={section.href}
                className="block rounded-md px-3 py-1.5 text-[13px] text-graphite transition-colors hover:bg-bone-raised hover:text-ink"
              >
                {section.label}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Mobile nav */}
        <div className="mb-8 lg:hidden">
          <Link
            href="/"
            className="mb-4 inline-flex items-center gap-2 text-[13px] text-graphite transition-colors hover:text-ink"
          >
            <ArrowLeft className="size-3.5" />
            Back to {siteConfig.name}
          </Link>
          <details className="group srf-dossier">
            <summary className="cursor-pointer px-4 py-3 text-[14px] font-medium text-ink">
              Documentation
            </summary>
            <nav className="border-t border-line px-2 py-2">
              {DOC_SECTIONS.map((section) => (
                <Link
                  key={section.href}
                  href={section.href}
                  className="block rounded-md px-3 py-2 text-[13px] text-graphite transition-colors hover:bg-bone-raised hover:text-ink"
                >
                  {section.label}
                </Link>
              ))}
            </nav>
          </details>
        </div>

        {/* Content */}
        <article className="min-w-0 max-w-3xl">
          {children}
        </article>
      </div>
    </div>
  );
}
