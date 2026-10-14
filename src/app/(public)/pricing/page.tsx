import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { canonicalUrl, siteConfig } from "@/lib/site-config";

export const metadata: Metadata = {
  title: `Pricing | ${siteConfig.name}`,
  description:
    "Simple, honest pricing. Start free with 10 prospect checks, 15 daily sends, and 3 Studio generations per day. Upgrade when you're ready.",
  alternates: { canonical: canonicalUrl("/pricing") },
  openGraph: {
    title: `Pricing | ${siteConfig.name}`,
    description:
      "Start free. 10 prospect checks, 15 daily sends, 3 Studio generations. No credit card.",
    url: canonicalUrl("/pricing"),
    images: [
      {
        url: canonicalUrl("/og?title=Pricing&subtitle=Start free, upgrade when ready"),
        width: siteConfig.ogImage.width,
        height: siteConfig.ogImage.height,
        alt: `${siteConfig.name} Pricing`,
      },
    ],
  },
  twitter: {
    title: `Pricing | ${siteConfig.name}`,
    description: "Start free. No credit card required.",
    images: [canonicalUrl("/og?title=Pricing&subtitle=Start free, upgrade when ready")],
  },
};

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    desc: "For trying Relay and reaching first value.",
    cta: "Start free",
    href: "/signup",
    featured: false,
    features: [
      "10 prospect checks",
      "15 daily sends",
      "3 Studio generations today",
      "Voice-calibrated drafts",
      "Outcome tracking",
      "Single user",
    ],
  },
  {
    name: "Pro",
    price: "—",
    period: "",
    desc: "For professionals using Relay consistently.",
    cta: "Coming soon",
    href: null,
    featured: true,
    features: [
      "Unlimited prospect checks",
      "Unlimited sends",
      "Unlimited Studio generations",
      "Priority processing",
      "Advanced analytics",
      "Priority support",
    ],
  },
  {
    name: "Team",
    price: "—",
    period: "",
    desc: "For teams building repeatable growth systems.",
    cta: "Coming soon",
    href: null,
    featured: false,
    features: [
      "Everything in Pro",
      "Multiple reps",
      "Shared voice profiles",
      "Admin controls",
      "Team analytics",
      "Billing management",
    ],
  },
];

const FAQ = [
  {
    q: "What counts as a send?",
    a: "A send is any message Relay drafts for you — connection notes, DMs, follow-ups, replies, and Upwork proposals.",
  },
  {
    q: "Can I change plans later?",
    a: "Yes. Start free and upgrade to Pro when you need more capacity. No lock-in.",
  },
  {
    q: "Is there a credit card required for free?",
    a: "No. The free plan is genuinely free. No card, no catch.",
  },
  {
    q: "Do you offer refunds?",
    a: "If Relay isn't working for you, contact us within 14 days of upgrading for a full refund.",
  },
];

export default function PricingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-6xl section-padding py-20 lg:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <span className="text-label text-orange">PRICING</span>
            <h1 className="mt-4 text-display text-4xl text-ink sm:text-5xl">
              Simple, honest pricing.
            </h1>
            <p className="mt-6 text-[16px] leading-relaxed text-graphite">
              Start free. No card required. Upgrade only when Relay is earning its
              place in your workflow.
            </p>
          </div>
        </div>
      </section>

      {/* Plans */}
      <section className="border-b border-line bg-bone-raised">
        <div className="mx-auto max-w-6xl section-padding py-16 lg:py-20">
          <div className="grid gap-6 lg:grid-cols-3">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={
                  plan.featured
                    ? "relative srf-console srf-console-edge p-8"
                    : "srf-dossier p-8"
                }
              >
                {plan.featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-orange px-3 py-1 text-mono-medium text-[10px] font-medium text-on-accent">
                    Recommended
                  </span>
                )}

                <p className="text-label text-stone">{plan.name}</p>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-display text-4xl text-ink">{plan.price}</span>
                  {plan.period && (
                    <span className="text-[13px] text-stone">/{plan.period}</span>
                  )}
                </div>
                <p className="mt-3 text-[14px] text-graphite">{plan.desc}</p>

                <div className="mt-6 border-t border-line pt-6">
                  <ul className="space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5">
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-status-success" />
                        <span className="text-[14px] text-ink">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-8">
                  {plan.href ? (
                    <Link
                      href={plan.href}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-orange text-[14px] font-medium text-on-accent transition-all hover:bg-orange-dark"
                    >
                      {plan.cta}
                      <ArrowRight className="size-4" />
                    </Link>
                  ) : (
                    <div className="flex h-11 w-full items-center justify-center rounded border border-line/60 text-[14px] font-medium text-stone">
                      {plan.cta}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Usage explanation */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-6xl section-padding py-16">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-heading text-2xl text-ink">
              What &ldquo;today&rdquo; means
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-graphite">
              Studio generations and daily sends reset every 24 hours. Prospect
              checks are a lifetime allowance for free accounts. Pro accounts get
              unlimited checks.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-b border-line bg-bone-raised">
        <div className="mx-auto max-w-6xl section-padding py-16 lg:py-20">
          <h2 className="text-center text-heading text-2xl text-ink">
            Common questions
          </h2>
          <div className="mx-auto mt-12 max-w-2xl divide-y divide-line">
            {FAQ.map((item) => (
              <div key={item.q} className="py-6 first:pt-0">
                <p className="text-[15px] font-medium text-ink">{item.q}</p>
                <p className="mt-2 text-[14px] leading-relaxed text-graphite">
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section>
        <div className="mx-auto max-w-6xl section-padding py-20 lg:py-28">
          <div className="mx-auto max-w-xl text-center">
            <h2 className="text-display text-3xl text-ink">
              Ready to find your next move?
            </h2>
            <div className="mt-6">
              <Link
                href="/signup"
                className="group inline-flex h-12 items-center gap-2 rounded-lg bg-orange px-6 text-[15px] font-medium text-on-accent transition-all hover:bg-orange-dark"
              >
                Start free
                <ArrowRight className="size-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>
            <p className="mt-3 text-mono-regular text-[12px] text-stone">
              No card required
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
