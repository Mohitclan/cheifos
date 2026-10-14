-- ChiefOS demo schema. All data is fictional.
-- Repeatable: every table is dropped and recreated by initSchema().

PRAGMA journal_mode = DELETE;
PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS blocker_comments;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS reminders;
DROP TABLE IF EXISTS schedule_items;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS decisions;
DROP TABLE IF EXISTS blockers;
DROP TABLE IF EXISTS updates;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS departments;

CREATE TABLE departments (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- password_hash is scrypt (see lib/auth/password.ts). Never store a plaintext
-- password here, not even for a demo account.
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('ceo', 'employee')),
  title         TEXT,
  department_id INTEGER REFERENCES departments(id),
  username      TEXT UNIQUE,
  password_hash TEXT,
  last_login_at TEXT,
  is_demo       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE projects (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  owner_id      INTEGER NOT NULL REFERENCES users(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  status        TEXT NOT NULL CHECK (status IN ('on_track', 'at_risk', 'blocked', 'done')),
  progress      INTEGER NOT NULL DEFAULT 0,
  target_date   TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE tasks (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  title      TEXT NOT NULL,
  owner_id   INTEGER NOT NULL REFERENCES users(id),
  status     TEXT NOT NULL CHECK (status IN ('todo', 'in_progress', 'blocked', 'done')),
  due_date   TEXT
);

-- original_text is immutable once written. extracted_json holds the
-- user-confirmed extraction, which may differ from what the extractor proposed.
CREATE TABLE updates (
  id            INTEGER PRIMARY KEY,
  employee_id   INTEGER NOT NULL REFERENCES users(id),
  project_id    INTEGER NOT NULL REFERENCES projects(id),
  task_id       INTEGER REFERENCES tasks(id),
  original_text TEXT NOT NULL,
  transcript    TEXT,
  extracted_json TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'typed' CHECK (source IN ('typed', 'voice', 'sample', 'imported')),
  -- Identity of this update in the system it was imported from. UNIQUE so a
  -- repeated sync cannot create the same update twice.
  external_id   TEXT UNIQUE,
  status        TEXT NOT NULL DEFAULT 'submitted',
  created_at    TEXT NOT NULL
);

-- priority_reason is rendered verbatim in the UI. Never store an unexplained score.
CREATE TABLE blockers (
  id              INTEGER PRIMARY KEY,
  update_id       INTEGER REFERENCES updates(id),
  project_id      INTEGER NOT NULL REFERENCES projects(id),
  title           TEXT NOT NULL,
  description     TEXT,
  raised_by_id    INTEGER REFERENCES users(id),
  owner_id        INTEGER REFERENCES users(id),
  dependency_department_id INTEGER REFERENCES departments(id),
  priority        TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),
  priority_reason TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('open', 'awaiting_decision', 'decision_sent', 'resolved')),
  created_at      TEXT NOT NULL,
  resolved_at     TEXT
);

CREATE TABLE decisions (
  id                INTEGER PRIMARY KEY,
  blocker_id        INTEGER REFERENCES blockers(id),
  created_by        INTEGER NOT NULL REFERENCES users(id),
  proposed_response TEXT NOT NULL,
  approved_response TEXT,
  status            TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'sent', 'clarification_requested')),
  created_at        TEXT NOT NULL,
  approved_at       TEXT
);

CREATE TABLE messages (
  id              INTEGER PRIMARY KEY,
  sender_id       INTEGER NOT NULL REFERENCES users(id),
  recipient_id    INTEGER NOT NULL REFERENCES users(id),
  decision_id     INTEGER REFERENCES decisions(id),
  body            TEXT NOT NULL,
  sent_at         TEXT,
  acknowledged_at TEXT,
  ack_note        TEXT
);

-- is_assumed_* drive the "assumed" markers in the UI. Never hide an inference.
CREATE TABLE schedule_items (
  id                  INTEGER PRIMARY KEY,
  owner_id            INTEGER NOT NULL REFERENCES users(id),
  title               TEXT NOT NULL,
  start_at            TEXT NOT NULL,
  end_at              TEXT NOT NULL,
  priority            TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('high', 'medium', 'low')),
  source_text         TEXT,
  is_assumed_duration INTEGER NOT NULL DEFAULT 0,
  is_assumed_time     INTEGER NOT NULL DEFAULT 0,
  -- A block someone else is expecting you at, versus time you set aside for
  -- yourself. Only the first kind is worth interrupting the CEO about.
  kind                TEXT NOT NULL DEFAULT 'focus' CHECK (kind IN ('meeting', 'focus')),
  -- Set once the lead-time alert for this block has been emailed, so a cron
  -- that runs every ten minutes does not send the same reminder six times.
  alert_sent_at       TEXT,
  with_whom           TEXT,
  topic               TEXT,
  plan_date           TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'discarded')),
  created_at          TEXT NOT NULL
);

-- Retained for v2. Not populated or surfaced in this demo.
CREATE TABLE reminders (
  id               INTEGER PRIMARY KEY,
  schedule_item_id INTEGER NOT NULL REFERENCES schedule_items(id),
  remind_at        TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',
  delivered_at     TEXT
);

-- Discussion on a specific blocker, separate from the decision flow.
-- A comment is talk; a decision is an instruction that gets sent and
-- acknowledged. Keeping them in different tables keeps that line visible.
CREATE TABLE blocker_comments (
  id         INTEGER PRIMARY KEY,
  blocker_id INTEGER NOT NULL REFERENCES blockers(id),
  author_id  INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_logs (
  id            INTEGER PRIMARY KEY,
  actor_id      INTEGER REFERENCES users(id),
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     INTEGER,
  summary       TEXT NOT NULL,
  metadata_json TEXT,
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_updates_employee  ON updates(employee_id, created_at DESC);
CREATE INDEX idx_updates_project   ON updates(project_id, created_at DESC);
CREATE INDEX idx_blockers_status   ON blockers(status, priority);
CREATE INDEX idx_blockers_project  ON blockers(project_id);
CREATE INDEX idx_decisions_status  ON decisions(status);
CREATE INDEX idx_messages_recip    ON messages(recipient_id, sent_at DESC);
CREATE INDEX idx_schedule_owner    ON schedule_items(owner_id, plan_date, start_at);
CREATE INDEX idx_audit_created     ON audit_logs(created_at DESC);
CREATE INDEX idx_comments_blocker  ON blocker_comments(blocker_id, created_at);
