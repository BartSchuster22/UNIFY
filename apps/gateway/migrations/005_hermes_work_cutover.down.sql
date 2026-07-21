DELETE FROM role_permissions
WHERE permission_id = (SELECT id FROM permissions WHERE name='work.manage');
DELETE FROM permissions WHERE name='work.manage';
