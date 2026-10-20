import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/current";
import { getAuthContext } from "@/lib/auth/organization";
import { isDemoMode } from "@/lib/ai/config";
import { createScoutStore } from "@/lib/store";
import { createServerSupabase } from "@/lib/supabase/server";
import { AppRail } from "@/components/app-rail";
import { AppIdentifyWrapper } from "@/components/app-identify-wrapper";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { ActiveIdentityProvider } from "@/components/workspace/active-identity-provider";
import { ACTIVE_IDENTITY_COOKIE, isIdentityId, type WorkspaceIdentity } from "@/lib/workspace/active-identity";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  if (!user) {
    try {
      const supabase = await createServerSupabase();
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        redirect("/login?error=no_workspace");
      }
    } catch {
      // Fall through to regular login redirect.
    }
    redirect("/login");
  }
  if (!user.profile) redirect("/onboarding");

  const store = await createScoutStore();
  const queue = await store.getQueue();

  let revenueIdentities: WorkspaceIdentity[] = [];

  try {
    const authCtx = await getAuthContext();
    const identities = authCtx?.isOwner || authCtx?.isAdmin
      ? await store.listRevenueIdentitiesAdmin()
      : await store.listMyAssignedIdentities();
    revenueIdentities = identities
      .filter((identity) => identity.status === "active")
      .map((identity) => ({
        id: identity.id,
        identityName: identity.identityName,
        title: identity.title,
        channel: identity.channel,
        profileId: identity.profileId,
      }));
  } catch {
    revenueIdentities = [];
  }

  const cookieStore = await cookies();
  const savedIdentityId = cookieStore.get(ACTIVE_IDENTITY_COOKIE)?.value ?? null;
  const initialActiveId = isIdentityId(savedIdentityId) && revenueIdentities.some((identity) => identity.id === savedIdentityId)
    ? savedIdentityId
    : revenueIdentities[0]?.id ?? null;

  return (
    <>
      <AnalyticsProvider />
      <AppIdentifyWrapper
        userId={user.rep.id}
        orgId={user.organization.id}
        role={user.rep.role}
        plan={user.organization.plan}
      >
        <ActiveIdentityProvider identities={revenueIdentities} initialActiveId={initialActiveId}>
          <div className="min-h-dvh bg-bone lg:grid lg:grid-cols-[14rem_1fr]">
            <AppRail
              repName={user.rep.name}
              organizationName={user.organization.name}
              role={user.rep.role}
              calibrated={Boolean(user.profile)}
              demo={isDemoMode()}
              todaySends={queue.todaySends}
              dailyLimit={queue.dailyLimit}
            />
            <main className="mx-auto w-full max-w-6xl px-5 pt-6 pb-24 lg:px-8 lg:pt-8 lg:pb-8">
              {children}
            </main>
          </div>
        </ActiveIdentityProvider>
      </AppIdentifyWrapper>
    </>
  );
}
