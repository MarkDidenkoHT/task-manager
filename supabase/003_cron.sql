-- Каждую минуту вызывать Edge Function «reminders».
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'reminders',
  '* * * * *',
  $$ select net.http_post(url := 'https://muzkjlwstmeodcoxtqlx.supabase.co/functions/v1/reminders', body := '{}'::jsonb) $$
);
