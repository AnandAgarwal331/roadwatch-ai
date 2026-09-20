-- Fixes a gap from the initial schema port: Complaint.priority_level in the
-- SQLAlchemy model has default=PriorityLevel.LOW, but that is an ORM-side
-- default, not a DB-level one - and it was dropped when the column list was
-- ported to plain DDL. severity_score/priority_score/report_count all kept
-- their DB defaults; priority_level should too, for the same reason:
-- create_complaint() inserts a fresh PENDING complaint before the
-- assessment pipeline has scored it, and NOT NULL with no default rejects
-- that insert outright (caught by a live smoke test of the create flow).
alter table public.complaints alter column priority_level set default 'LOW';
