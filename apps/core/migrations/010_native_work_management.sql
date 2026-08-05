CREATE TABLE core.work_projects (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'prj')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 500),
  goal text CHECK (goal IS NULL OR length(goal) <= 10000),
  state text NOT NULL DEFAULT 'saved' CHECK (state IN ('saved','scheduled','active','paused','finished','reflected','archived')),
  project_manager_profile_id text REFERENCES core.profiles(id) ON DELETE SET NULL,
  workspace_reference text CHECK (workspace_reference IS NULL OR length(workspace_reference) <= 2048),
  scheduled_activation_at timestamptz,
  source_version bigint NOT NULL DEFAULT 1 CHECK (source_version > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  archived_at timestamptz
);
CREATE INDEX work_projects_state ON core.work_projects(state, updated_at DESC);
CREATE TRIGGER work_projects_bump_version BEFORE UPDATE ON core.work_projects
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.work_project_profiles (
  project_id text NOT NULL REFERENCES core.work_projects(id) ON DELETE CASCADE,
  profile_id text NOT NULL REFERENCES core.profiles(id) ON DELETE RESTRICT,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('manager','member')),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(project_id, profile_id)
);
CREATE TRIGGER work_project_profiles_bump_version BEFORE UPDATE ON core.work_project_profiles
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE OR REPLACE FUNCTION core.validate_work_project_membership()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_project_id text; manager_profile_id text; project_state text; project_goal text;
BEGIN
  IF TG_TABLE_NAME='work_projects' THEN
    target_project_id := COALESCE(NEW.id, OLD.id);
  ELSE
    target_project_id := COALESCE(NEW.project_id, OLD.project_id);
  END IF;
  SELECT project_manager_profile_id,state,goal INTO manager_profile_id,project_state,project_goal FROM core.work_projects WHERE id=target_project_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF project_state='active' AND (project_goal IS NULL OR btrim(project_goal)='' OR NOT EXISTS (SELECT 1 FROM core.work_project_profiles WHERE project_id=target_project_id)) THEN
    RAISE EXCEPTION 'active project requires a goal and profiles' USING ERRCODE='23514';
  END IF;
  IF manager_profile_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM core.work_project_profiles WHERE project_id=target_project_id AND profile_id=manager_profile_id AND role='manager') THEN
    RAISE EXCEPTION 'project manager must be a manager member' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM core.work_task_assignments assignment JOIN core.work_tasks task ON task.id=assignment.task_id
    WHERE task.project_id=target_project_id AND NOT EXISTS (
      SELECT 1 FROM core.work_project_profiles member WHERE member.project_id=target_project_id AND member.profile_id=assignment.profile_id
    )
  ) THEN RAISE EXCEPTION 'task assignment requires project membership' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER work_projects_validate_membership AFTER INSERT OR UPDATE ON core.work_projects
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.validate_work_project_membership();
CREATE CONSTRAINT TRIGGER work_project_profiles_validate_membership AFTER INSERT OR UPDATE OR DELETE ON core.work_project_profiles
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION core.validate_work_project_membership();

CREATE OR REPLACE FUNCTION core.valid_work_lanes(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(value)='array'
    AND jsonb_array_length(value) BETWEEN 1 AND 50
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(value) lane
      WHERE jsonb_typeof(lane) <> 'object'
        OR coalesce(lane->>'key','') !~ '^[a-z0-9][a-z0-9-]{0,99}$'
        OR length(coalesce(lane->>'label','')) NOT BETWEEN 1 AND 500
        OR CASE WHEN jsonb_typeof(lane->'position')='number'
          THEN (lane->>'position')::numeric < 0
            OR trunc((lane->>'position')::numeric) <> (lane->>'position')::numeric
          ELSE true END
    )
    AND (SELECT count(*) FROM (SELECT DISTINCT item->>'key' FROM jsonb_array_elements(value) item) distinct_keys) = jsonb_array_length(value)
    AND (SELECT count(*) FROM (SELECT DISTINCT item->>'position' FROM jsonb_array_elements(value) item) distinct_positions) = jsonb_array_length(value)
$$;

CREATE TABLE core.work_boards (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'brd')),
  project_id text NOT NULL REFERENCES core.work_projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 500),
  lanes jsonb NOT NULL DEFAULT '[{"key":"backlog","label":"Backlog","position":0},{"key":"ready","label":"Ready","position":1},{"key":"in-progress","label":"In progress","position":2},{"key":"blocked","label":"Blocked","position":3},{"key":"done","label":"Done","position":4}]'::jsonb
    CHECK (core.valid_work_lanes(lanes)),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','archived')),
  source_version bigint NOT NULL DEFAULT 1 CHECK (source_version > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(project_id, name),
  UNIQUE(id, project_id)
);
CREATE TRIGGER work_boards_bump_version BEFORE UPDATE ON core.work_boards
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.work_tasks (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'tsk')),
  project_id text NOT NULL REFERENCES core.work_projects(id) ON DELETE CASCADE,
  board_id text NOT NULL,
  lane text NOT NULL CHECK (lane ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  description text CHECK (description IS NULL OR length(description) <= 10000),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','running','blocked','completed','archived')),
  block_reason text CHECK (block_reason IS NULL OR length(block_reason) <= 2000),
  last_heartbeat_at timestamptz,
  source_version bigint NOT NULL DEFAULT 1 CHECK (source_version > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  archived_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT work_task_times CHECK (completed_at IS NULL OR started_at IS NOT NULL),
  CONSTRAINT work_task_board_project FOREIGN KEY(board_id,project_id) REFERENCES core.work_boards(id,project_id) ON DELETE RESTRICT
);
CREATE INDEX work_tasks_board_lane ON core.work_tasks(board_id, lane, updated_at DESC);
CREATE INDEX work_tasks_project_state ON core.work_tasks(project_id, state, updated_at DESC);
CREATE TRIGGER work_tasks_bump_version BEFORE UPDATE ON core.work_tasks
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.work_task_assignments (
  task_id text NOT NULL REFERENCES core.work_tasks(id) ON DELETE CASCADE,
  profile_id text NOT NULL REFERENCES core.profiles(id) ON DELETE RESTRICT,
  assignment_kind text NOT NULL DEFAULT 'assignee' CHECK (assignment_kind IN ('assignee','reviewer')),
  assigned_by_kind text NOT NULL CHECK (assigned_by_kind IN ('user','service')),
  assigned_by_id text NOT NULL,
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(task_id, profile_id, assignment_kind),
  CONSTRAINT work_task_assignment_actor CHECK (core.is_principal_id(assigned_by_kind, assigned_by_id)),
  UNIQUE(task_id, assignment_kind)
);
CREATE OR REPLACE FUNCTION core.validate_work_assignment_actor()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT core.principal_exists(NEW.assigned_by_kind, NEW.assigned_by_id) THEN
    RAISE EXCEPTION 'assignment actor does not exist' USING ERRCODE='23503';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER work_task_assignments_validate_actor BEFORE INSERT OR UPDATE ON core.work_task_assignments
FOR EACH ROW EXECUTE FUNCTION core.validate_work_assignment_actor();
CREATE OR REPLACE FUNCTION core.validate_work_assignment_membership()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM core.work_tasks task
    JOIN core.work_project_profiles member ON member.project_id=task.project_id AND member.profile_id=NEW.profile_id
    WHERE task.id=NEW.task_id
  ) THEN RAISE EXCEPTION 'assignee is not a project member' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER work_task_assignments_validate_membership BEFORE INSERT OR UPDATE ON core.work_task_assignments
FOR EACH ROW EXECUTE FUNCTION core.validate_work_assignment_membership();
CREATE TRIGGER work_task_assignments_bump_version BEFORE UPDATE ON core.work_task_assignments
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.work_task_comments (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'cmt')),
  task_id text NOT NULL REFERENCES core.work_tasks(id) ON DELETE CASCADE,
  operation_id text NOT NULL REFERENCES core.operations(id) ON DELETE RESTRICT,
  author_kind text NOT NULL CHECK (author_kind IN ('user','service')),
  author_id text NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 100000),
  evidence_references jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence_references)='array'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT work_task_comment_author CHECK (core.is_principal_id(author_kind, author_id))
);
CREATE TRIGGER work_task_comments_immutable BEFORE UPDATE OR DELETE ON core.work_task_comments
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

CREATE TABLE core.work_schedules (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'sch')),
  project_id text REFERENCES core.work_projects(id) ON DELETE CASCADE,
  task_id text REFERENCES core.work_tasks(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('at','every','cron')),
  expression text NOT NULL CHECK (length(expression) BETWEEN 1 AND 200),
  timezone text NOT NULL CHECK (length(timezone) BETWEEN 1 AND 100),
  enabled boolean NOT NULL DEFAULT true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  deleted_at timestamptz,
  source_version bigint NOT NULL DEFAULT 1 CHECK (source_version > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT work_schedule_target CHECK ((project_id IS NOT NULL)::int + (task_id IS NOT NULL)::int = 1)
);
CREATE INDEX work_schedules_due ON core.work_schedules(next_run_at, id) WHERE enabled;
CREATE TRIGGER work_schedules_bump_version BEFORE UPDATE ON core.work_schedules
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.work_runs (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'run')),
  schedule_id text NOT NULL REFERENCES core.work_schedules(id) ON DELETE RESTRICT,
  operation_id text REFERENCES core.operations(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','succeeded','failed','cancelled')),
  scheduled_for timestamptz NOT NULL,
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result)='object'),
  safe_error jsonb CHECK (safe_error IS NULL OR jsonb_typeof(safe_error)='object'),
  source_version bigint NOT NULL DEFAULT 1 CHECK (source_version > 0),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(schedule_id, scheduled_for)
);
CREATE INDEX work_runs_queue ON core.work_runs(scheduled_for, id) WHERE state='queued';
CREATE TRIGGER work_runs_bump_version BEFORE UPDATE ON core.work_runs
FOR EACH ROW EXECUTE FUNCTION core.bump_resource_version();

CREATE TABLE core.work_evidence (
  id text PRIMARY KEY CHECK (core.is_canonical_id(id, 'evd')),
  operation_id text NOT NULL REFERENCES core.operations(id) ON DELETE RESTRICT,
  resource_kind text NOT NULL CHECK (resource_kind IN ('project','board','task','assignment','schedule','run')),
  resource_id text NOT NULL CHECK (core.is_any_canonical_id(resource_id)),
  action text NOT NULL CHECK (action ~ '^[a-z][a-z0-9._-]{2,127}$'),
  before_version bigint,
  after_version bigint,
  source_version bigint,
  evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='object'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX work_evidence_resource ON core.work_evidence(resource_kind, resource_id, recorded_at DESC);
CREATE TRIGGER work_evidence_immutable BEFORE UPDATE OR DELETE ON core.work_evidence
FOR EACH ROW EXECUTE FUNCTION core.reject_mutation();

INSERT INTO core.authorization_permissions(permission_key, description) VALUES
  ('work.read', 'Read native projects, boards, tasks, assignments, schedules and runs.'),
  ('work.manage', 'Manage native projects, boards, tasks, assignments, schedules and runs.')
ON CONFLICT DO NOTHING;
INSERT INTO core.authorization_role_permissions(role_key, permission_key)
SELECT 'core.admin', permission_key FROM core.authorization_permissions
WHERE permission_key IN ('work.read','work.manage')
ON CONFLICT DO NOTHING;
INSERT INTO core.authorization_role_permissions(role_key, permission_key) VALUES
  ('core.operator','work.read'), ('core.operator','work.manage'), ('core.viewer','work.read')
ON CONFLICT DO NOTHING;
