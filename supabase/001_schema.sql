-- Планировщик жизни: схема базы данных (Supabase Postgres)
-- Выполните этот файл целиком в Supabase → SQL Editor.
-- Все суммы хранятся в копейках (bigint). Количество продуктов — граммы, миллилитры или штуки.

create extension if not exists pgcrypto;

-- ---------- Пространства и участники ----------

create table if not exists spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_tg_id bigint not null,
  base_currency text not null default 'RUB',
  usd_rate numeric(12,4) not null default 90,
  timezone text not null default 'Europe/Moscow',
  meal_layouts jsonb,                         -- переопределение долей калорий по приёмам пищи (null = по умолчанию)
  top_cost_factor numeric(4,2) not null default 2.2,
  created_at timestamptz not null default now()
);

create table if not exists members (
  space_id uuid not null references spaces(id) on delete cascade,
  tg_id bigint not null,
  role text not null check (role in ('owner','editor','viewer')),
  display_name text,
  timezone text,
  joined_at timestamptz not null default now(),
  primary key (space_id, tg_id)
);
create index if not exists members_tg_idx on members (tg_id);

create table if not exists invites (
  code text primary key,
  space_id uuid not null references spaces(id) on delete cascade,
  role text not null check (role in ('editor','viewer')),
  expires_at timestamptz not null,
  max_uses int not null default 1,
  uses int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- Люди, дети, питомцы ----------

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  kind text not null check (kind in ('adult','child','pet')),
  name text not null,
  tg_id bigint,
  sex text check (sex in ('m','f')),
  birth_date date,
  height_cm numeric(5,1),
  weight_kg numeric(5,2),
  activity numeric(3,2) default 1.375,
  goal_offset_kcal int not null default 0,
  kcal_override int,
  meals_per_day int not null default 3 check (meals_per_day between 1 and 6),
  protein_g_per_kg numeric(3,2) default 1.8,
  fat_g_per_kg numeric(3,2) default 0.9,
  species text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists profiles_space_idx on profiles (space_id);

create table if not exists weight_log (
  profile_id uuid not null references profiles(id) on delete cascade,
  logged_on date not null,
  weight_kg numeric(5,2) not null,
  primary key (profile_id, logged_on)
);

-- ---------- Бюджет ----------

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('fixed','grocery','variable','pet','savings')),
  unique (space_id, name)
);

create table if not exists income_sources (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  owner_tg_id bigint not null,
  name text not null,
  gross_monthly_minor bigint not null,
  tax_mode text not null check (tax_mode in ('ndfl_progressive','flat','npd','none')),
  flat_rate numeric(5,2),
  active boolean not null default true
);

create table if not exists tax_brackets (
  space_id uuid not null references spaces(id) on delete cascade,
  from_annual_minor bigint not null,
  rate numeric(5,2) not null,
  primary key (space_id, from_annual_minor)
);

create table if not exists fixed_costs (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  pet_id uuid references profiles(id) on delete set null,
  name text not null,
  amount_minor bigint not null,
  period text not null default 'month' check (period in ('month','quarter','year')),
  due_day int check (due_day between 1 and 31),
  active boolean not null default true
);

create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  name text not null,
  unique (space_id, name)
);

-- ---------- Продукты и цены ----------

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  name text not null,
  unit text not null default 'g' check (unit in ('g','ml','pcs')),
  grams_per_piece numeric(8,2),
  kcal_100 numeric(7,2) not null,
  protein_100 numeric(6,2) not null,
  carbs_100 numeric(6,2) not null,
  fat_100 numeric(6,2) not null,
  min_g_day numeric(7,1) not null default 0,
  max_g_day numeric(7,1) not null default 1000,
  quality smallint not null default 2 check (quality between 1 and 3),
  slots text[] not null default '{breakfast,main,snack}',
  active boolean not null default true,
  unique (space_id, name)
);

create table if not exists product_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  store_id uuid references stores(id) on delete cascade,
  pack_qty numeric(9,2) not null check (pack_qty > 0),
  price_minor bigint not null check (price_minor >= 0),
  observed_on date not null default current_date,
  created_at timestamptz not null default now(),
  created_by bigint not null
);
create index if not exists product_prices_lookup_idx on product_prices (product_id, store_id, observed_on desc);

-- Две последние цены по каждой паре (продукт, магазин); store_id null = общая цена.
drop view if exists latest_prices;
drop view if exists recent_prices;
create view recent_prices as
select * from (
  select p.space_id, pp.id, pp.product_id, pp.store_id, pp.pack_qty, pp.price_minor,
         pp.price_minor::numeric / pp.pack_qty as price_per_unit,
         pp.observed_on,
         row_number() over (partition by pp.product_id, pp.store_id order by pp.observed_on desc, pp.created_at desc) as rn
  from product_prices pp
  join products p on p.id = pp.product_id
) t
where rn <= 2;

-- Последняя цена: используется движком питания и списком покупок.
create view latest_prices as
select space_id, product_id, store_id, pack_qty, price_minor, price_per_unit, observed_on
from recent_prices where rn = 1;

-- ---------- Покупки ----------

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  store_id uuid references stores(id) on delete set null,
  category_id uuid references categories(id) on delete set null,
  pet_id uuid references profiles(id) on delete set null,
  purchased_on date not null default current_date,
  total_minor bigint not null,
  note text,
  created_by bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists purchases_space_date_idx on purchases (space_id, purchased_on);

create table if not exists purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  label text,
  qty numeric(9,2),
  price_minor bigint not null
);

-- ---------- Планы питания ----------

create table if not exists meal_plans (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  batch_id uuid,                               -- три варианта одной генерации
  tier text not null check (tier in ('cheap','middle','top')),
  store_id uuid references stores(id) on delete set null,
  start_on date not null,
  days int not null,
  meals_per_day int not null default 3 check (meals_per_day between 1 and 6),
  total_minor bigint not null,
  targets jsonb not null,
  status text not null default 'draft' check (status in ('draft','active','done')),
  created_at timestamptz not null default now()
);
create index if not exists meal_plans_space_idx on meal_plans (space_id, status);

create table if not exists meal_plan_items (
  plan_id uuid not null references meal_plans(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  meal_no int not null check (meal_no between 1 and 6),
  grams numeric(7,1) not null,
  primary key (plan_id, profile_id, product_id, meal_no)
);

-- Отметки в списке покупок (общие для всех участников)
create table if not exists grocery_checks (
  plan_id uuid not null references meal_plans(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  checked boolean not null default true,
  checked_by bigint,
  checked_at timestamptz not null default now(),
  purchase_id uuid references purchases(id) on delete set null,   -- уже записано в покупки
  primary key (plan_id, product_id)
);

-- ---------- Тренировки ----------

create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  space_id uuid references spaces(id) on delete cascade,
  name text not null,
  name_en text,
  source text not null default 'custom' check (source in ('custom','builtin','free-exercise-db')),
  external_id text,
  kind text not null default 'reps' check (kind in ('reps','timed')),
  level text check (level in ('beginner','intermediate','expert')),
  equipment text[] not null default '{}',
  primary_muscles text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  instructions text,
  image_paths text[] not null default '{}',
  unique (source, external_id)
);

create table if not exists programs (
  id uuid primary key default gen_random_uuid(),
  space_id uuid references spaces(id) on delete cascade,
  owner_tg_id bigint,
  name text not null,
  description text,
  minutes_per_session int not null,
  sessions_per_week int not null,
  is_template boolean not null default false,
  audience text not null default 'any' check (audience in ('any','men','women')),
  goal text,
  equipment text[] not null default '{}',
  template_id uuid references programs(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists program_days (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references programs(id) on delete cascade,
  day_idx int not null,
  part text not null default 'single' check (part in ('single','morning','evening')),
  label text not null
);

create table if not exists program_exercises (
  id uuid primary key default gen_random_uuid(),
  program_day_id uuid not null references program_days(id) on delete cascade,
  exercise_id uuid not null references exercises(id),
  position int not null,
  sets int not null,
  target_reps int not null,
  load_kg numeric(6,2) not null default 0,
  rep_ceiling int not null,
  load_step_kg numeric(5,2) not null default 0,
  rep_step int not null default 1
);

create table if not exists workout_logs (
  id uuid primary key default gen_random_uuid(),
  program_exercise_id uuid not null references program_exercises(id) on delete cascade,
  tg_id bigint not null,
  performed_on date not null,
  set_no int not null,
  reps int not null,
  load_kg numeric(6,2) not null default 0,
  unique (program_exercise_id, tg_id, performed_on, set_no)
);

-- ---------- Напоминания ----------

create table if not exists reminders (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  owner_tg_id bigint not null,
  kind text not null check (kind in ('workout','reading','custom','pet','payment')),
  title text not null,
  local_time time not null,
  weekdays int[] not null default '{1,2,3,4,5,6,7}',
  timezone text not null,
  program_id uuid references programs(id) on delete set null,
  program_day_id uuid references program_days(id) on delete set null,
  pet_id uuid references profiles(id) on delete set null,
  fixed_cost_id uuid references fixed_costs(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists reminder_events (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null references reminders(id) on delete cascade,
  due_on date not null,
  sent_at timestamptz,
  snooze_until timestamptz,
  message_id bigint,
  status text not null default 'pending' check (status in ('pending','sent','done','snoozed','skipped')),
  unique (reminder_id, due_on)
);

-- ---------- Безопасность ----------
-- Браузер никогда не обращается к Supabase напрямую. RLS включён без политик:
-- anon и authenticated не видят ничего, бэкенд работает с секретным ключом (service role).

do $$
declare t text;
begin
  foreach t in array array[
    'spaces','members','invites','profiles','weight_log','categories','income_sources',
    'tax_brackets','fixed_costs','stores','products','product_prices','purchases',
    'purchase_items','meal_plans','meal_plan_items','grocery_checks','exercises','programs',
    'program_days','program_exercises','workout_logs','reminders','reminder_events'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

revoke all on latest_prices from anon, authenticated;
revoke all on recent_prices from anon, authenticated;

-- Атомарное погашение приглашения
create or replace function redeem_invite(p_code text, p_tg_id bigint, p_name text)
returns table (space_id uuid, role text, status text)
language plpgsql
security definer
set search_path = public
as $$
declare inv invites%rowtype;
begin
  select * into inv from invites where code = p_code for update;
  if not found then
    return query select null::uuid, null::text, 'not_found'::text; return;
  end if;
  if exists (select 1 from members m where m.space_id = inv.space_id and m.tg_id = p_tg_id) then
    return query select inv.space_id, (select m.role from members m where m.space_id = inv.space_id and m.tg_id = p_tg_id), 'already_member'::text; return;
  end if;
  if inv.expires_at < now() then
    return query select null::uuid, null::text, 'expired'::text; return;
  end if;
  if inv.uses >= inv.max_uses then
    return query select null::uuid, null::text, 'used_up'::text; return;
  end if;
  update invites set uses = uses + 1 where code = p_code;
  insert into members (space_id, tg_id, role, display_name) values (inv.space_id, p_tg_id, inv.role, p_name);
  return query select inv.space_id, inv.role, 'ok'::text;
end $$;

revoke execute on function redeem_invite(text, bigint, text) from public, anon, authenticated;
