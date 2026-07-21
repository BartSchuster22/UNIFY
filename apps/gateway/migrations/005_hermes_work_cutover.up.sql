INSERT INTO permissions(name, description)
VALUES ('work.manage','Execute governed Hermes project, Kanban, and cron commands')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.name='Administrator' AND p.name='work.manage'
ON CONFLICT DO NOTHING;
