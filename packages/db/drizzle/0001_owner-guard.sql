-- Serialize ownership transitions against the organisation row. Organisation
-- deletion cascades are allowed after its parent row has been deleted.
CREATE FUNCTION protect_last_organisation_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org_id text; owner_count integer;
BEGIN
  org_id := OLD.organization_id;
  IF NOT ('owner' = ANY(string_to_array(OLD.role, ','))) THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.organization_id = OLD.organization_id AND 'owner' = ANY(string_to_array(NEW.role, ',')) THEN RETURN NEW; END IF;
  PERFORM id FROM organization WHERE id = org_id FOR UPDATE;
  IF NOT FOUND THEN IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  SELECT count(*) INTO owner_count FROM member WHERE organization_id = org_id AND id <> OLD.id AND 'owner' = ANY(string_to_array(role, ','));
  IF owner_count = 0 THEN RAISE EXCEPTION 'Transfer ownership or delete the organisation before removing its final owner' USING ERRCODE = '23514'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER member_last_owner BEFORE DELETE OR UPDATE OF role, organization_id ON member FOR EACH ROW EXECUTE FUNCTION protect_last_organisation_owner();
