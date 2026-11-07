-- 参考持久化结构（仅用于本侧自证与样例生成，不构成 T3 选型结论）
-- 所有完整性约束尽量下沉至数据库层；业务级判定仍在服务层执行。

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS configs (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at  TEXT NOT NULL,
  updated_by  TEXT
);

CREATE TABLE IF NOT EXISTS orgs (
  org_id      TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sections (
  section_id        TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  responsible_org   TEXT NOT NULL REFERENCES orgs(org_id),
  center_lat        REAL NOT NULL CHECK (center_lat BETWEEN -90 AND 90),
  center_lng        REAL NOT NULL CHECK (center_lng BETWEEN -180 AND 180),
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS waste_categories (
  code        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scale_levels (
  code        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS accounts (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id            TEXT NOT NULL UNIQUE,
  credential_hash       TEXT NOT NULL,
  credential_salt       TEXT NOT NULL,
  credential_iterations INTEGER NOT NULL CHECK (credential_iterations > 0),
  account_status        TEXT NOT NULL CHECK (account_status IN ('ACTIVE', 'DISABLED')),
  default_role          TEXT NOT NULL CHECK (default_role = 'R1'),
  agreement_accepted    INTEGER NOT NULL CHECK (agreement_accepted IN (0, 1)),
  created_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_roles (
  account_pk  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role_code   TEXT NOT NULL CHECK (role_code IN ('R1','R2','R3','R4','R5','R6','R7','R8')),
  granted_by  TEXT,
  granted_at  TEXT NOT NULL,
  PRIMARY KEY (account_pk, role_code)
);

CREATE TABLE IF NOT EXISTS account_orgs (
  account_pk  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  org_id      TEXT NOT NULL REFERENCES orgs(org_id),
  PRIMARY KEY (account_pk, org_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_handle_hash TEXT NOT NULL UNIQUE,
  account_pk          INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_tag          TEXT NOT NULL,
  session_status      TEXT NOT NULL CHECK (session_status IN ('ACTIVE', 'REVOKED')),
  issued_at           TEXT NOT NULL,
  expires_at          TEXT NOT NULL,
  revoked_at          TEXT,
  CHECK (expires_at > issued_at),
  CHECK (
    (session_status = 'REVOKED' AND revoked_at IS NOT NULL) OR
    (session_status = 'ACTIVE' AND revoked_at IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_pk);

CREATE TABLE IF NOT EXISTS login_attempts (
  account_id_input TEXT PRIMARY KEY,
  failed_count     INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  last_failed_at   TEXT,
  locked_until     TEXT
);

CREATE TABLE IF NOT EXISTS media_assets (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  media_ref          TEXT NOT NULL UNIQUE,
  upload_ticket_hash TEXT NOT NULL UNIQUE,
  owner_account_pk   INTEGER NOT NULL REFERENCES accounts(id),
  media_type         TEXT NOT NULL CHECK (media_type IN ('IMAGE_JPEG','IMAGE_PNG','VIDEO_MP4')),
  size_bytes         INTEGER NOT NULL CHECK (size_bytes > 0),
  checksum           TEXT NOT NULL,
  media_status       TEXT NOT NULL CHECK (media_status IN ('RESERVED','UPLOADED','REJECTED')),
  ticket_expires_at  TEXT NOT NULL,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media_assets(owner_account_pk);

CREATE TABLE IF NOT EXISTS reports (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id           TEXT NOT NULL UNIQUE,
  owner_account_pk    INTEGER NOT NULL REFERENCES accounts(id),
  raw_lat             REAL NOT NULL CHECK (raw_lat BETWEEN -90 AND 90),
  raw_lng             REAL NOT NULL CHECK (raw_lng BETWEEN -180 AND 180),
  waste_category      TEXT NOT NULL REFERENCES waste_categories(code),
  scale_level         TEXT NOT NULL REFERENCES scale_levels(code),
  matched_section_id  TEXT REFERENCES sections(section_id),
  report_status       TEXT NOT NULL CHECK (report_status IN ('SUBMITTED','UNDER_REVIEW','APPROVED','REJECTED','RETURNED')),
  review_status       TEXT NOT NULL CHECK (review_status IN ('PENDING','IN_PROGRESS','APPROVED','REJECTED','RETURNED')),
  current_review_level TEXT CHECK (current_review_level IS NULL OR current_review_level IN ('LEVEL_1','LEVEL_2','LEVEL_3')),
  ai_status           TEXT NOT NULL CHECK (ai_status IN ('UNAVAILABLE','SUCCEEDED')),
  ai_category         TEXT,
  ai_scale_level      TEXT,
  ai_confidence       REAL,
  submitted_at        TEXT NOT NULL,
  approved_at         TEXT,
  decided_at          TEXT,
  CHECK (
    (report_status = 'SUBMITTED'    AND review_status = 'PENDING'     AND current_review_level = 'LEVEL_1') OR
    (report_status = 'UNDER_REVIEW' AND review_status = 'IN_PROGRESS' AND current_review_level IN ('LEVEL_1','LEVEL_2','LEVEL_3')) OR
    (report_status = 'APPROVED'     AND review_status = 'APPROVED'    AND current_review_level IS NULL) OR
    (report_status = 'REJECTED'     AND review_status = 'REJECTED'    AND current_review_level IS NULL) OR
    (report_status = 'RETURNED'     AND review_status = 'RETURNED'    AND current_review_level IS NULL)
  ),
  CHECK (report_status <> 'APPROVED' OR approved_at IS NOT NULL),
  CHECK (report_status = 'APPROVED' OR approved_at IS NULL),
  CHECK (report_status IN ('APPROVED','REJECTED','RETURNED') OR decided_at IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_reports_owner ON reports(owner_account_pk);
CREATE INDEX IF NOT EXISTS idx_reports_section_status ON reports(matched_section_id, report_status);

CREATE TABLE IF NOT EXISTS report_media (
  report_id  TEXT NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
  media_ref  TEXT NOT NULL REFERENCES media_assets(media_ref),
  position   INTEGER NOT NULL CHECK (position >= 1),
  PRIMARY KEY (report_id, media_ref),
  UNIQUE (report_id, position)
);

CREATE TABLE IF NOT EXISTS work_orders (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id      TEXT NOT NULL UNIQUE,
  report_id          TEXT NOT NULL UNIQUE REFERENCES reports(report_id),
  section_id         TEXT REFERENCES sections(section_id),
  assigned_org_id    TEXT REFERENCES orgs(org_id),
  work_order_status  TEXT NOT NULL CHECK (work_order_status IN ('PENDING_DISPATCH','DISPATCHED','CLOSED','CANCELLED')),
  cleanup_weight_kg  REAL CHECK (cleanup_weight_kg IS NULL OR cleanup_weight_kg > 0),
  created_at         TEXT NOT NULL,
  dispatched_at      TEXT,
  closed_at          TEXT,
  CHECK (work_order_status <> 'PENDING_DISPATCH' OR dispatched_at IS NULL),
  CHECK (work_order_status NOT IN ('DISPATCHED','CLOSED') OR (assigned_org_id IS NOT NULL AND dispatched_at IS NOT NULL)),
  CHECK (work_order_status <> 'CLOSED' OR (cleanup_weight_kg IS NOT NULL AND cleanup_weight_kg > 0 AND closed_at IS NOT NULL)),
  CHECK (work_order_status = 'CLOSED' OR cleanup_weight_kg IS NULL),
  CHECK (work_order_status = 'CLOSED' OR closed_at IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_wo_status ON work_orders(work_order_status);
CREATE INDEX IF NOT EXISTS idx_wo_section ON work_orders(section_id);

CREATE TABLE IF NOT EXISTS cleanup_records (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  cleanup_record_id      TEXT NOT NULL UNIQUE,
  work_order_id          TEXT NOT NULL UNIQUE REFERENCES work_orders(work_order_id),
  cleanup_weight_kg      REAL NOT NULL CHECK (cleanup_weight_kg > 0),
  recorded_by_account_pk INTEGER NOT NULL REFERENCES accounts(id),
  recorded_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cleanup_media (
  cleanup_record_id TEXT NOT NULL REFERENCES cleanup_records(cleanup_record_id) ON DELETE CASCADE,
  media_ref         TEXT NOT NULL REFERENCES media_assets(media_ref),
  position          INTEGER NOT NULL CHECK (position >= 1),
  PRIMARY KEY (cleanup_record_id, media_ref),
  UNIQUE (cleanup_record_id, position)
);

CREATE TABLE IF NOT EXISTS review_records (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  review_record_id     TEXT NOT NULL UNIQUE,
  target_type          TEXT NOT NULL CHECK (target_type IN ('REPORT')),
  target_id            TEXT NOT NULL,
  review_level         TEXT NOT NULL CHECK (review_level IN ('LEVEL_1','LEVEL_2','LEVEL_3')),
  review_result        TEXT NOT NULL CHECK (review_result IN ('APPROVED','REJECTED','RETURNED')),
  reviewer_account_pk  INTEGER NOT NULL REFERENCES accounts(id),
  reviewer_role        TEXT NOT NULL CHECK (reviewer_role IN ('R3','R4','R5')),
  comment              TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  CHECK (
    (review_level = 'LEVEL_1' AND reviewer_role = 'R3') OR
    (review_level = 'LEVEL_2' AND reviewer_role = 'R4') OR
    (review_level = 'LEVEL_3' AND reviewer_role = 'R5')
  )
);
CREATE INDEX IF NOT EXISTS idx_review_target ON review_records(target_type, target_id, id);

CREATE TABLE IF NOT EXISTS feedbacks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  feedback_id   TEXT NOT NULL UNIQUE,
  work_order_id TEXT NOT NULL REFERENCES work_orders(work_order_id),
  account_pk    INTEGER NOT NULL REFERENCES accounts(id),
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  content       TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  UNIQUE (work_order_id, account_pk)
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  scope_key          TEXT NOT NULL,
  api                TEXT NOT NULL,
  idem_key           TEXT NOT NULL,
  request_hash       TEXT NOT NULL,
  response_code      TEXT NOT NULL,
  response_message   TEXT NOT NULL,
  response_data_json TEXT NOT NULL CHECK (json_valid(response_data_json)),
  created_at         TEXT NOT NULL,
  PRIMARY KEY (scope_key, api, idem_key)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  trace_id          TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  actor_account_id  TEXT,
  actor_roles       TEXT,
  target_type       TEXT,
  target_id         TEXT,
  outcome           TEXT NOT NULL CHECK (outcome IN ('SUCCESS','DENIED','FAILURE','INFO')),
  detail_json       TEXT NOT NULL CHECK (json_valid(detail_json)),
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_trace ON audit_logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_logs(event_type, created_at);

CREATE TABLE IF NOT EXISTS rate_limit_windows (
  bucket_key   TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL CHECK (count >= 0),
  PRIMARY KEY (bucket_key, window_start)
);

-- ============ 完整性与职责分离的数据库级兜底 ============

-- 系统管理员（R7）不得兼终审（R5）
CREATE TRIGGER IF NOT EXISTS trg_role_sod_no_r7_r5
BEFORE INSERT ON account_roles
WHEN NEW.role_code IN ('R5','R7')
 AND EXISTS (
   SELECT 1 FROM account_roles
   WHERE account_pk = NEW.account_pk
     AND role_code IN ('R5','R7')
     AND role_code <> NEW.role_code
 )
BEGIN
  SELECT RAISE(ABORT, 'role separation: R7 and R5 must not coexist');
END;

-- 上报媒体必须属于上报人且处于可用状态
CREATE TRIGGER IF NOT EXISTS trg_report_media_owner
BEFORE INSERT ON report_media
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN (SELECT owner_account_pk FROM media_assets WHERE media_ref = NEW.media_ref)
       <> (SELECT owner_account_pk FROM reports WHERE report_id = NEW.report_id)
    THEN RAISE(ABORT, 'report media owner mismatch')
  END;
  SELECT CASE
    WHEN (SELECT media_status FROM media_assets WHERE media_ref = NEW.media_ref) NOT IN ('RESERVED','UPLOADED')
    THEN RAISE(ABORT, 'report media not usable')
  END;
END;

-- 办结证据必须属于录入人且处于可用状态
CREATE TRIGGER IF NOT EXISTS trg_cleanup_media_owner
BEFORE INSERT ON cleanup_media
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN (SELECT owner_account_pk FROM media_assets WHERE media_ref = NEW.media_ref)
       <> (SELECT recorded_by_account_pk FROM cleanup_records WHERE cleanup_record_id = NEW.cleanup_record_id)
    THEN RAISE(ABORT, 'cleanup media owner mismatch')
  END;
  SELECT CASE
    WHEN (SELECT media_status FROM media_assets WHERE media_ref = NEW.media_ref) NOT IN ('RESERVED','UPLOADED')
    THEN RAISE(ABORT, 'cleanup media not usable')
  END;
END;

-- 审核目标必须存在
CREATE TRIGGER IF NOT EXISTS trg_review_target_exists
BEFORE INSERT ON review_records
WHEN NEW.target_type = 'REPORT'
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM reports WHERE report_id = NEW.target_id)
    THEN RAISE(ABORT, 'review target not found')
  END;
END;

-- 审计、审核、清理、评价记录不可篡改
CREATE TRIGGER IF NOT EXISTS trg_audit_no_update
BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete
BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_review_no_update
BEFORE UPDATE ON review_records
BEGIN SELECT RAISE(ABORT, 'review_records is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_review_no_delete
BEFORE DELETE ON review_records
BEGIN SELECT RAISE(ABORT, 'review_records is immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_cleanup_no_update
BEFORE UPDATE ON cleanup_records
BEGIN SELECT RAISE(ABORT, 'cleanup_records is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_cleanup_no_delete
BEFORE DELETE ON cleanup_records
BEGIN SELECT RAISE(ABORT, 'cleanup_records is immutable'); END;

CREATE TRIGGER IF NOT EXISTS trg_feedback_no_update
BEFORE UPDATE ON feedbacks
BEGIN SELECT RAISE(ABORT, 'feedbacks is immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_feedback_no_delete
BEFORE DELETE ON feedbacks
BEGIN SELECT RAISE(ABORT, 'feedbacks is immutable'); END;
