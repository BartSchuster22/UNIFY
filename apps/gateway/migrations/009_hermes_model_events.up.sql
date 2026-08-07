ALTER TABLE hermes_adapter_events
  DROP CONSTRAINT hermes_adapter_events_family_check;

ALTER TABLE hermes_adapter_events
  ADD CONSTRAINT hermes_adapter_events_family_check
    CHECK (family IN ('profiles','providers','models','work','conversations'));
