-- Signal Events table — stores verified signal changes for queryable history
-- Referenced by: src/app/api/leads/signal-watch/route.ts, src/lib/relay/signal-events-store.ts

CREATE TABLE IF NOT EXISTS public.signal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  signal_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'notable', 'urgent')),
  previous_value text,
  new_value text,
  evidence text,
  confidence double precision DEFAULT 0.5,
  source text DEFAULT 'v3_intelligence',
  verified boolean DEFAULT true,
  actor text,
  organization text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_signal_events_lead_id ON public.signal_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_signal_events_org_id ON public.signal_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_signal_events_detected_at ON public.signal_events(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_events_type ON public.signal_events(signal_type);

ALTER TABLE public.signal_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signal events readable by org members" ON public.signal_events;
CREATE POLICY "Signal events readable by org members" ON public.signal_events
  FOR SELECT USING (
    organization_id IN (
      SELECT organization_id FROM public.reps WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Signal events insertable by service role" ON public.signal_events;
CREATE POLICY "Signal events insertable by service role" ON public.signal_events
  FOR INSERT WITH CHECK (true);
