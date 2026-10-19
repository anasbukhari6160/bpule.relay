-- Performance Config table — stores per-org performance tracking configuration
-- Referenced by: src/app/api/admin/performance/config/route.ts

CREATE TABLE IF NOT EXISTS public.performance_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tracking_enabled boolean DEFAULT true,
  workdays text[] DEFAULT ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  timezone text DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_performance_config_org_id ON public.performance_config(organization_id);

ALTER TABLE public.performance_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Performance config readable by org admins" ON public.performance_config;
CREATE POLICY "Performance config readable by org admins" ON public.performance_config
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.reps
      WHERE auth_user_id = auth.uid() AND (role = 'admin' OR role = 'owner')
    )
  );

DROP POLICY IF EXISTS "Performance config writable by org admins" ON public.performance_config;
CREATE POLICY "Performance config writable by org admins" ON public.performance_config
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM public.reps
      WHERE auth_user_id = auth.uid() AND (role = 'admin' OR role = 'owner')
    )
  );
