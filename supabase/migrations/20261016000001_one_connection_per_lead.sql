-- A lead has one logged connection request. A second "Sent Connection"
-- while the first is still pending is the same event.
delete from messages newer
using messages earlier
where newer.type = 'connection'
  and earlier.type = 'connection'
  and newer.lead_id = earlier.lead_id
  and newer.id <> earlier.id
  and (
    newer.sent_at > earlier.sent_at
    or (newer.sent_at is not distinct from earlier.sent_at and newer.created_at > earlier.created_at)
    or (newer.sent_at is null and earlier.sent_at is not null)
  );

create unique index if not exists messages_one_connection_per_lead
  on messages (lead_id)
  where type = 'connection';
