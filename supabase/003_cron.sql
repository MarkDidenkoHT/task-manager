-- Ежеминутный тик напоминаний через pg_cron + pg_net.
-- 1. Включите расширения pg_cron и pg_net в Supabase → Database → Extensions.
-- 2. Замените APP_URL и TICK_SECRET на свои значения (TICK_SECRET = переменная окружения на Render).
-- 3. Выполните файл.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('life-planner-tick')
where exists (select 1 from cron.job where jobname = 'life-planner-tick');

select cron.schedule(
  'life-planner-tick',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://APP_URL/internal/tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Tick-Secret', 'TICK_SECRET'),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
