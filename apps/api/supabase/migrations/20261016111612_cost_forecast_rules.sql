-- Reviewed cost schedules and individual cash payments excluded from training.
-- All access is through the authenticated API, scoped by connection_id.
CREATE TABLE public.cost_forecast_rules (
  connection_id uuid NOT NULL REFERENCES public.xero_connections(id) ON DELETE CASCADE,
  rule_key text NOT NULL CHECK (length(rule_key) BETWEEN 1 AND 320),
  rule jsonb NOT NULL CHECK (jsonb_typeof(rule) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, rule_key)
);
ALTER TABLE public.cost_forecast_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cost_forecast_rules FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_forecast_rules TO service_role;

-- Serialize each connection's ownership check and save. Two browser tabs must
-- not both claim the same imported stream for different schedules.
CREATE FUNCTION public.save_cost_forecast_rule(p_connection_id uuid, p_rule_key text, p_rule jsonb)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM 1 FROM public.xero_connections WHERE id = p_connection_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown connection'; END IF;

  IF p_rule->>'type' = 'recurring' AND EXISTS (
    SELECT 1 FROM public.cost_forecast_rules existing
    WHERE existing.connection_id = p_connection_id
      AND existing.rule_key <> p_rule_key
      AND existing.rule->>'type' = 'recurring'
      AND existing.rule->'rule'->>'accountCode' = p_rule->'rule'->>'accountCode'
      AND (jsonb_build_array(existing.rule->'rule'->>'streamKey')
        || COALESCE(existing.rule->'rule'->'matchStreamKeys', '[]'::jsonb))
        ?| ARRAY(SELECT jsonb_array_elements_text(
          jsonb_build_array(p_rule->'rule'->>'streamKey')
          || COALESCE(p_rule->'rule'->'matchStreamKeys', '[]'::jsonb)))
  ) THEN RETURN false; END IF;

  INSERT INTO public.cost_forecast_rules (connection_id, rule_key, rule, updated_at)
    VALUES (p_connection_id, p_rule_key, p_rule, now())
    ON CONFLICT (connection_id, rule_key) DO UPDATE
    SET rule = EXCLUDED.rule, updated_at = EXCLUDED.updated_at;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.save_cost_forecast_rule(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_cost_forecast_rule(uuid, text, jsonb) TO service_role;
