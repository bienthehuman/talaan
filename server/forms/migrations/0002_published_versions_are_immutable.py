from django.db import migrations

# A published form version can never change or disappear: submissions pin to it (ADR 0008).
# Publishing is the one allowed UPDATE of a draft version (published_at goes from NULL to a time);
# after that every UPDATE and DELETE is refused, whatever role runs it.
FORWARD = """
CREATE FUNCTION forms_formversion_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.published_at IS NOT NULL THEN
        RAISE EXCEPTION 'form version % is published and immutable; publish a new version instead', OLD.id
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER forms_formversion_guard
    BEFORE UPDATE OR DELETE ON forms_formversion
    FOR EACH ROW EXECUTE FUNCTION forms_formversion_guard();
"""

REVERSE = """
DROP TRIGGER forms_formversion_guard ON forms_formversion;
DROP FUNCTION forms_formversion_guard();
"""


class Migration(migrations.Migration):
    dependencies = [("forms", "0001_initial")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
