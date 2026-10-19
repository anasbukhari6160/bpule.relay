-- Organization settings: daily send ceilings and other per-org config.
-- Allows admins to customize daily limits without env var changes.

alter table organizations
  add column if not exists settings jsonb not null default '{}'::jsonb;

-- Add comment
comment on column organizations.settings is 'Per-org configuration: dailyConnectionLimit, dailySendLimit, feature flags, etc.';

-- Function to get org-specific daily connection limit
create or replace function get_org_connection_limit(org_id uuid)
returns integer as $$
  declare
    org_limit integer;
    default_limit integer;
  begin
    default_limit := greatest(1, least(200, coalesce(current_setting('scout.daily_connection_limit', true)::integer, 20)));

    select (settings->>'dailyConnectionLimit')::integer
    into org_limit
    from organizations
    where id = org_id;

    return coalesce(org_limit, default_limit);
  end;
$$ language plpgsql stable;

-- Function to get org-specific daily send limit (dm/followup/reply)
create or replace function get_org_send_limit(org_id uuid)
returns integer as $$
  declare
    org_limit integer;
    default_limit integer;
  begin
    default_limit := greatest(1, least(200, coalesce(current_setting('scout.daily_send_limit', true)::integer, 15)));

    select (settings->>'dailySendLimit')::integer
    into org_limit
    from organizations
    where id = org_id;

    return coalesce(org_limit, default_limit);
  end;
$$ language plpgsql stable;
