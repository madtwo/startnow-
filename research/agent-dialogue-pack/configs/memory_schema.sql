-- StartNow 数据表草案。注意：WHERE owner_agent_id = ? 并不足以建立安全边界；生产环境须服务端鉴权/RLS。
CREATE TABLE shared_policies (
  version TEXT PRIMARY KEY, body TEXT NOT NULL, published_at TEXT NOT NULL, read_only INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE agents (
  agent_id TEXT PRIMARY KEY, persona_version TEXT NOT NULL
);
CREATE TABLE forum_events (
  event_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, thread_id TEXT NOT NULL,
  reply_to_id TEXT, visibility TEXT NOT NULL CHECK(visibility IN ('public','private')),
  recipient_id TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE exposures (
  observer_agent_id TEXT NOT NULL, event_id TEXT NOT NULL,
  reason TEXT NOT NULL, observed_at TEXT NOT NULL,
  PRIMARY KEY (observer_agent_id,event_id),
  FOREIGN KEY (event_id) REFERENCES forum_events(event_id)
);
CREATE TABLE agent_memories (
  owner_agent_id TEXT NOT NULL, memory_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('observation','belief','preference','private_note')),
  content TEXT NOT NULL, source_event_id TEXT, confidence REAL, created_at TEXT NOT NULL,
  PRIMARY KEY(owner_agent_id,memory_id)
);
CREATE TABLE agent_relationships (
  owner_agent_id TEXT NOT NULL, subject_id TEXT NOT NULL,
  familiarity TEXT NOT NULL, impression TEXT, last_source_event_id TEXT,
  PRIMARY KEY(owner_agent_id,subject_id)
);
CREATE INDEX ix_agent_memories_owner ON agent_memories(owner_agent_id);
CREATE INDEX ix_exposures_observer ON exposures(observer_agent_id);
-- SQL 表结构可实现，不等于已实施服务层权限、加密、日志保留及删除治理。
