-- OPTIONAL - NOT APPLIED. Deliberately kept out of supabase/migrations/ so that
-- `supabase db push` never runs it by accident: it creates recurring jobs on the
-- database, which should be a decision, not a side effect.
--
-- To turn it on:  npx supabase db query --linked -f supabase/optional/keep_api_warm.sql
-- To turn it off: select cron.unschedule('keep-api-warm-mumbai');
--                 select cron.unschedule('keep-api-warm-tokyo');
--                 select cron.unschedule('purge-cron-history');
--
-- Keep the Edge Function warm, so nobody pays for its cold start.
--
-- An Edge Function that has not been called for a little while is shut down,
-- and the next request has to wait for it to start again: measured on this
-- project, 2 to 3 seconds instead of the usual half second. That lands on
-- whichever real visitor happens to arrive first, which is exactly the "I
-- clicked and nothing happened" feeling.
--
-- This asks the (database-free) /api/health route for an answer every minute,
-- so an instance is always running. Functions are started per region, close to
-- whoever is calling, so the ping goes to both places real traffic comes from:
--   ap-south-1      Mumbai - where people in India are routed
--   ap-northeast-1  Tokyo  - this project's database region, where a server
--                            hosted next to the database (e.g. Vercel hnd1)
--                            is routed
-- Add or drop regions to match where your visitors and your app server are.
--
-- The URL and key below are this project's own. The key is the *publishable*
-- key, which is designed to be public (it is also in frontend/.env.example);
-- /api/health does no work and returns nothing sensitive. Pointing this at a
-- different Supabase project means editing the two values.
--
-- A minute is about 43,000 calls a month per region - well inside Supabase's
-- free allowance of 500,000 function invocations - and pg_net drops its own
-- response log after a few hours, so nothing here grows without bound. The
-- second job trims the scheduler's own history for the same reason.

create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule(
  'keep-api-warm-mumbai',
  '* * * * *',
  $$select net.http_get(
      url := 'https://yogtvvbktmodvbarpvhm.supabase.co/functions/v1/api/health',
      headers := jsonb_build_object(
        'apikey', 'sb_publishable_fEw3BdVYfCg_eSX1BYx_Zw_wfDzmfMb',
        'x-region', 'ap-south-1'),
      timeout_milliseconds := 8000
    )$$
);

select cron.schedule(
  'keep-api-warm-tokyo',
  '* * * * *',
  $$select net.http_get(
      url := 'https://yogtvvbktmodvbarpvhm.supabase.co/functions/v1/api/health',
      headers := jsonb_build_object(
        'apikey', 'sb_publishable_fEw3BdVYfCg_eSX1BYx_Zw_wfDzmfMb',
        'x-region', 'ap-northeast-1'),
      timeout_milliseconds := 8000
    )$$
);

select cron.schedule(
  'purge-cron-history',
  '17 * * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '1 day'$$
);
