from django.db import migrations

# The idempotency ledger (ADR 0004). A row is inserted with an empty result, and the result is set
# exactly once. Rows are never deleted, and nothing else about a row changes. The trigger applies to
# every role; the REVOKE additionally takes DELETE away from the application role.
FORWARD = """
CREATE FUNCTION sync_appliedmutation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'applied_mutation rows are never deleted' USING ERRCODE = '23514';
    END IF;
    IF OLD.result <> '{}'::jsonb THEN
        RAISE EXCEPTION 'the result of mutation % is already recorded', OLD.mutation_id
            USING ERRCODE = '23514';
    END IF;
    IF NEW.mutation_id <> OLD.mutation_id OR NEW.device_id <> OLD.device_id
       OR NEW.user_id <> OLD.user_id OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'only the result of a ledger row can be set' USING ERRCODE = '23514';
    END IF;
    IF NEW.result = '{}'::jsonb THEN
        RAISE EXCEPTION 'a recorded result must not be empty' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER sync_appliedmutation_guard
    BEFORE UPDATE OR DELETE ON sync_appliedmutation
    FOR EACH ROW EXECUTE FUNCTION sync_appliedmutation_guard();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'talaan_app') THEN
        REVOKE DELETE ON sync_appliedmutation FROM talaan_app;
    END IF;
END
$$;
"""

REVERSE = """
DROP TRIGGER sync_appliedmutation_guard ON sync_appliedmutation;
DROP FUNCTION sync_appliedmutation_guard();
"""


class Migration(migrations.Migration):
    dependencies = [("sync", "0001_initial")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
