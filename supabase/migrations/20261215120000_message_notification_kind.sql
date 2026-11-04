-- The notification kind direct messages push under.
--
-- On its own because a new enum value can't be used in the transaction that adds it,
-- and 20261215120100_direct_messages.sql uses it straight away.

alter type public.notification_kind add value if not exists 'message';
