from django.db import migrations

# The database side of "one write path". Whatever code or person touches submission rows, the
# database refuses anything that skips the rules the sync service follows:
#
#   * a new submission starts at version 1 and pins the same form version as its assignment;
#   * id, assignment and form version never change;
#   * every UPDATE raises version by exactly 1 and takes a strictly larger server_seq (so a direct
#     .save() that skips the version bump or the sequence fails);
#   * rows are never deleted (deletes are tombstones).
#
# submission_event is append-only: no UPDATE or DELETE for the application role (REVOKE) and none for
# any role (trigger). server_seq comes from a sequence the sync service reads under the advisory lock.
FORWARD = """
CREATE SEQUENCE submission_server_seq AS bigint;

CREATE FUNCTION submissions_submission_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'submissions are never deleted; set deleted_at instead' USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.version <> 1 THEN
            RAISE EXCEPTION 'a new submission must start at version 1' USING ERRCODE = '23514';
        END IF;
        IF NEW.form_version_id IS DISTINCT FROM
           (SELECT form_version_id FROM assignments_assignment WHERE id = NEW.assignment_id) THEN
            RAISE EXCEPTION 'a submission must use its assignment''s form version' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.id <> OLD.id OR NEW.assignment_id <> OLD.assignment_id
       OR NEW.form_version_id <> OLD.form_version_id THEN
        RAISE EXCEPTION 'id, assignment and form version of a submission never change'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'every change must raise version by exactly 1 (was %, got %)', OLD.version, NEW.version
            USING ERRCODE = '23514';
    END IF;
    IF NEW.server_seq <= OLD.server_seq THEN
        RAISE EXCEPTION 'every change must take a larger server_seq (was %, got %)', OLD.server_seq, NEW.server_seq
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER submissions_submission_guard
    BEFORE INSERT OR UPDATE OR DELETE ON submissions_submission
    FOR EACH ROW EXECUTE FUNCTION submissions_submission_guard();

CREATE FUNCTION submissions_submissionevent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'submission_event is append-only' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER submissions_submissionevent_guard
    BEFORE UPDATE OR DELETE ON submissions_submissionevent
    FOR EACH ROW EXECUTE FUNCTION submissions_submissionevent_guard();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talaan_app') THEN
        REVOKE UPDATE, DELETE ON submissions_submissionevent FROM talaan_app;
    END IF;
END
$$;
"""

REVERSE = """
DROP TRIGGER submissions_submissionevent_guard ON submissions_submissionevent;
DROP FUNCTION submissions_submissionevent_guard();
DROP TRIGGER submissions_submission_guard ON submissions_submission;
DROP FUNCTION submissions_submission_guard();
DROP SEQUENCE submission_server_seq;
"""


class Migration(migrations.Migration):
    dependencies = [
        ("submissions", "0001_initial"),
        ("assignments", "0001_initial"),
    ]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
