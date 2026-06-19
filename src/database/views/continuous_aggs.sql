-- Continuous aggregate materialized views for high-fidelity analytics
-- These auto-refresh on a schedule, eliminating raw query performance bottlenecks

-- Drop existing views to allow schema updates
DROP MATERIALIZED VIEW IF EXISTS hourly_device_usage CASCADE;
DROP MATERIALIZED VIEW IF EXISTS daily_billing_summary CASCADE;
DROP MATERIALIZED VIEW IF EXISTS fifteen_minute_device_usage CASCADE;
DROP MATERIALIZED VIEW IF EXISTS daily_device_usage CASCADE;
DROP MATERIALIZED VIEW IF EXISTS weekly_device_usage CASCADE;
DROP MATERIALIZED VIEW IF EXISTS monthly_device_usage CASCADE;

-- 15-minute usage aggregation per device
CREATE MATERIALIZED VIEW fifteen_minute_device_usage
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('15 minutes', time) AS bucket,
    device_id,
    COUNT(*) AS sample_count,
    SUM(metric_value) AS total_value,
    AVG(metric_value) AS avg_value,
    MIN(metric_value) AS min_value,
    MAX(metric_value) AS max_value,
    MAX(time) AS _aggregate_watermark
FROM telemetry
GROUP BY bucket, device_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('fifteen_minute_device_usage',
    start_offset => INTERVAL '6 hours',
    end_offset => INTERVAL '15 minutes',
    schedule_interval => INTERVAL '15 minutes',
    if_not_exists => TRUE
);

-- Hourly usage aggregation per device
CREATE MATERIALIZED VIEW hourly_device_usage
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    device_id,
    COUNT(*) AS sample_count,
    SUM(metric_value) AS total_value,
    AVG(metric_value) AS avg_value,
    MIN(metric_value) AS min_value,
    MAX(metric_value) AS max_value,
    MAX(time) AS _aggregate_watermark
FROM telemetry
GROUP BY bucket, device_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('hourly_device_usage',
    start_offset => INTERVAL '3 days',
    end_offset => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists => TRUE
);

-- Daily usage aggregation per device
CREATE MATERIALIZED VIEW daily_device_usage
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS bucket,
    device_id,
    COUNT(*) AS sample_count,
    SUM(metric_value) AS total_value,
    AVG(metric_value) AS avg_value,
    MIN(metric_value) AS min_value,
    MAX(metric_value) AS max_value,
    MAX(time) AS _aggregate_watermark
FROM telemetry
GROUP BY bucket, device_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('daily_device_usage',
    start_offset => INTERVAL '14 days',
    end_offset => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Weekly usage aggregation per device
CREATE MATERIALIZED VIEW weekly_device_usage
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 week', time) AS bucket,
    device_id,
    COUNT(*) AS sample_count,
    SUM(metric_value) AS total_value,
    AVG(metric_value) AS avg_value,
    MIN(metric_value) AS min_value,
    MAX(metric_value) AS max_value,
    MAX(time) AS _aggregate_watermark
FROM telemetry
GROUP BY bucket, device_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('weekly_device_usage',
    start_offset => INTERVAL '60 days',
    end_offset => INTERVAL '1 week',
    schedule_interval => INTERVAL '1 week',
    if_not_exists => TRUE
);

-- Monthly usage aggregation per device
CREATE MATERIALIZED VIEW monthly_device_usage
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 month', time) AS bucket,
    device_id,
    COUNT(*) AS sample_count,
    SUM(metric_value) AS total_value,
    AVG(metric_value) AS avg_value,
    MIN(metric_value) AS min_value,
    MAX(metric_value) AS max_value,
    MAX(time) AS _aggregate_watermark
FROM telemetry
GROUP BY bucket, device_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('monthly_device_usage',
    start_offset => INTERVAL '180 days',
    end_offset => INTERVAL '1 month',
    schedule_interval => INTERVAL '1 month',
    if_not_exists => TRUE
);

-- Daily billing summary per account
CREATE MATERIALIZED VIEW daily_billing_summary
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', time) AS bucket,
    account_id,
    device_id,
    SUM(usage_amount) AS total_usage,
    COUNT(*) AS transaction_count,
    COUNT(*) FILTER (WHERE status = 'settled') AS settled_count,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
    MAX(time) AS _aggregate_watermark
FROM billing_records
GROUP BY bucket, account_id, device_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('daily_billing_summary',
    start_offset => INTERVAL '7 days',
    end_offset => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists => TRUE
);

-- Notification trigger configuration for adaptive refresh
CREATE SEQUENCE IF NOT EXISTS telemetry_insert_counter_seq;

CREATE OR REPLACE FUNCTION telemetry_insert_trigger_fnc()
RETURNS TRIGGER AS $$
DECLARE
    current_count BIGINT;
BEGIN
    SELECT nextval('telemetry_insert_counter_seq') INTO current_count;
    IF current_count % 10000 = 0 THEN
        PERFORM pg_notify('telemetry_inserts', current_count::text);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS telemetry_insert_trigger ON telemetry;
CREATE TRIGGER telemetry_insert_trigger
AFTER INSERT ON telemetry
FOR EACH ROW
EXECUTE FUNCTION telemetry_insert_trigger_fnc();
