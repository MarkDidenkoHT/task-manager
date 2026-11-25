-- Цены центрального рынка Тирасполя (экспресс-обзор «Новости Приднестровья»)
-- на 30 октября и 13 ноября 2026 г. + КБЖУ на 100 г (100 мл для молока).
--
-- • Диапазон «от–до» записан как среднее: 100–150 → 125.
-- • Обе даты попадают в историю цен, поэтому видна динамика за две недели.
-- • Цены привязаны к магазину «Центральный рынок»; продукты, которые уже есть
--   в пространстве (базовый набор: Говядина, Гречка, Картофель…), не дублируются —
--   к ним просто добавляются цены. КБЖУ существующих продуктов не перезаписывается.
-- • Соль, сахар и пшеничная мука добавлены выключенными (active = false):
--   цены отслеживаются, но в планы питания они не попадают.
-- • Рыба и курица — целиком (с костями); КБЖУ — на съедобную часть.
--
-- Пространство: то, где пользователь 312756470 — владелец (иначе редактор).
-- Повторный запуск безопасен: цены на ту же дату второй раз не добавляются.

do $$
declare
  v_tg    constant bigint := 312756470;
  v_space uuid;
  v_store uuid;
  v_cat   uuid;
  n_prod  int;
  n_price int;
begin
  select m.space_id into v_space
  from members m join spaces s on s.id = m.space_id
  where m.tg_id = v_tg and m.role in ('owner', 'editor')
  order by (m.role = 'owner') desc, s.created_at
  limit 1;
  if v_space is null then
    raise exception 'Пространство для tg_id % не найдено — сначала откройте приложение и создайте его', v_tg;
  end if;

  insert into stores (space_id, name) values (v_space, 'Центральный рынок')
  on conflict (space_id, name) do nothing;
  select id into v_store from stores where space_id = v_space and name = 'Центральный рынок';

  select id into v_cat from categories
  where space_id = v_space and kind = 'grocery'
  order by (name = 'Продукты') desc limit 1;

  create temp table _market (
    name text, unit text, gpp numeric, pack numeric,
    kcal numeric, p numeric, f numeric, c numeric,
    max_g numeric, quality smallint, slots text[], active boolean,
    price_oct numeric, price_nov numeric          -- рубли, среднее диапазона
  ) on commit drop;

  insert into _market values
  -- Мясо и птица
  ('Говядина',                    'g',  null, 1000, 187, 18.9, 12.4, 0,    250, 3, '{main}',                true, 125,   125),
  ('Свинина',                     'g',  null, 1000, 259, 16.0, 21.6, 0,    250, 2, '{main}',                true, 110,   110),
  ('Куриная голень',              'g',  null, 1000, 161, 18.2,  9.8, 0,    300, 2, '{main}',                true,  49,    49),
  ('Куриные крылья',              'g',  null, 1000, 186, 19.2, 12.2, 0,    300, 1, '{main}',                true,  48,    48),
  ('Куриные окорочка',            'g',  null, 1000, 158, 16.8, 10.2, 0,    300, 2, '{main}',                true,  70.5,  70.5),
  -- Молочное и яйца
  ('Молоко 2,5%',                 'ml', null, 1000,  52,  2.8,  2.5, 4.7,  500, 2, '{breakfast,snack}',     true,  20,    20),
  ('Творог 9%',                   'g',  null, 1000, 159, 16.7,  9.0, 2.0,  250, 2, '{breakfast,snack}',     true,  72.5,  77.5),
  ('Сметана 20%',                 'g',  null, 1000, 206,  2.8, 20.0, 3.2,   50, 2, '{breakfast,main}',      true,  72.5,  77.5),
  ('Масло сливочное 82,5%',       'g',  null,  200, 748,  0.5, 82.5, 0.8,   20, 2, '{breakfast}',           true,  52,    52),
  ('Яйца куриные',                'pcs', 55,    10, 157, 12.7, 11.5, 0.7,  220, 2, '{breakfast,main}',      true,  30.5,  26),
  ('Брынза овечья',               'g',  null, 1000, 298, 16.0, 25.5, 0.5,   60, 3, '{breakfast,snack}',     true, 140,   175),
  ('Брынза коровья',              'g',  null, 1000, 260, 17.9, 20.1, 0.5,   60, 2, '{breakfast,snack}',     true,  87.5, 102.5),
  ('Брынза козья',                'g',  null, 1000, 290, 18.0, 24.0, 0.5,   60, 3, '{breakfast,snack}',     true,  97.5, 130),
  -- Рыба
  ('Сельдь слабосолёная',         'g',  null, 1000, 217, 19.1, 15.4, 0,    100, 2, '{main,snack}',          true,  66,    66),
  ('Скумбрия слабосолёная',       'g',  null, 1000, 199, 18.0, 14.0, 0,    120, 3, '{main}',                true, 268,   268),
  ('Карп',                        'g',  null, 1000, 112, 16.0,  5.3, 0,    300, 2, '{main}',                true,  85,    85),
  ('Толстолобик',                 'g',  null, 1000,  86, 19.5,  0.9, 0,    300, 2, '{main}',                true,  55,    45),
  ('Карась',                      'g',  null, 1000,  87, 17.7,  1.8, 0,    300, 2, '{main}',                true,  85,    75),
  ('Сом',                         'g',  null, 1000, 125, 16.8,  6.5, 0,    300, 2, '{main}',                true,  85,    85),
  -- Овощи и грибы
  ('Огурцы',                      'g',  null, 1000,  15,  0.8,  0.1, 2.8,  300, 2, '{main,snack}',          true,  37.5,  62.5),
  ('Капуста белокочанная',        'g',  null, 1000,  27,  1.8,  0.1, 4.7,  300, 1, '{main}',                true,   4.5,   5),
  ('Кабачки',                     'g',  null, 1000,  24,  0.6,  0.3, 4.6,  300, 2, '{main}',                true,  25,    40),
  ('Баклажаны',                   'g',  null, 1000,  24,  1.2,  0.1, 4.5,  300, 2, '{main}',                true,  19,    16.5),
  ('Картофель',                   'g',  null, 1000,  77,  2.0,  0.4, 16.3, 400, 1, '{main}',                true,   9,     9.25),
  ('Помидоры',                    'g',  null, 1000,  20,  1.1,  0.2, 3.7,  300, 2, '{main,snack}',          true,  28,    32.5),
  ('Лук репчатый',                'g',  null, 1000,  41,  1.4,  0.2, 8.2,  100, 1, '{main}',                true,   7,     6.5),
  ('Морковь',                     'g',  null, 1000,  35,  1.3,  0.1, 6.9,  200, 1, '{main,snack}',          true,   7.25,  7.5),
  ('Свёкла',                      'g',  null, 1000,  42,  1.5,  0.1, 8.8,  200, 1, '{main}',                true,   6.5,   8),
  ('Перец болгарский',            'g',  null, 1000,  26,  1.3,  0.1, 5.3,  250, 2, '{main,snack}',          true,  22.5,  22.5),
  ('Вешенки',                     'g',  null, 1000,  33,  3.3,  0.4, 3.8,  200, 2, '{main}',                true,  60,    62.5),
  ('Шампиньоны',                  'g',  null, 1000,  27,  4.3,  1.0, 0.1,  200, 2, '{main}',                true,  62.5,  62.5),
  ('Редис',                       'g',  null, 1000,  20,  1.2,  0.1, 3.4,  150, 2, '{main,snack}',          true,  12.5,  13.5),
  -- Бакалея (крупы и мука — в сухом виде)
  ('Сахар',                       'g',  null, 1000, 399,  0,    0,   99.7,  20, 1, '{breakfast,snack}',     false, 20,    20),
  ('Соль',                        'g',  null, 1000,   0,  0,    0,   0,      0, 1, '{main}',                false, 12,    12),
  ('Пшеничная крупа',             'g',  null, 1000, 329, 11.5,  1.3, 68.5, 120, 1, '{breakfast,main}',      true,  11,    11),
  ('Гречка',                      'g',  null, 1000, 313, 12.6,  3.3, 62.1, 150, 2, '{main}',                true,  24.5,  24.5),
  ('Рис белый',                   'g',  null, 1000, 344,  6.7,  0.7, 78.9, 150, 1, '{main}',                true,  31.5,  31.5),
  ('Манная крупа',                'g',  null, 1000, 333, 10.3,  1.0, 70.6, 100, 1, '{breakfast}',           true,  20.5,  20.5),
  ('Перловка',                    'g',  null, 1000, 315,  9.3,  1.1, 66.9, 120, 1, '{main}',                true,  14.5,  14.5),
  ('Горох колотый',               'g',  null, 1000, 298, 20.5,  2.0, 49.5, 100, 2, '{main}',                true,  14,    14),
  ('Мука кукурузная',             'g',  null, 1000, 331,  7.2,  1.5, 70.2, 150, 1, '{breakfast,main}',      true,  20,    20),
  ('Мука пшеничная',              'g',  null, 1000, 334, 10.3,  1.1, 69.9,   0, 1, '{main}',                false, 16,    16),
  ('Масло подсолнечное',          'g',  null,  920, 899,  0,   99.9, 0,     40, 1, '{main}',                true,  41,    41),  -- 1 л ≈ 920 г
  -- Фрукты
  ('Яблоки',                      'g',  null, 1000,  47,  0.4,  0.4, 9.8,  300, 2, '{snack,breakfast}',     true,   9.5,  11.5),
  ('Груши',                       'g',  null, 1000,  47,  0.4,  0.3, 10.3, 300, 2, '{snack}',               true,  12.5,  15),
  ('Гранат',                      'g',  null, 1000,  72,  0.7,  0.6, 14.5, 250, 3, '{snack}',               true,  62.5,  57.5),
  ('Сливы',                       'g',  null, 1000,  49,  0.8,  0.3, 9.6,  300, 2, '{snack}',               true,  15,    11),
  ('Виноград',                    'g',  null, 1000,  72,  0.6,  0.6, 15.4, 250, 2, '{snack}',               true,  20,    20),
  ('Апельсины',                   'g',  null, 1000,  43,  0.9,  0.2, 8.1,  300, 2, '{snack,breakfast}',     true,  45,    37.5),
  ('Мандарины',                   'g',  null, 1000,  38,  0.8,  0.2, 7.5,  300, 2, '{snack}',               true,  30,    26),
  ('Киви',                        'g',  null, 1000,  47,  0.8,  0.4, 8.1,  200, 3, '{snack}',               true,  60,    55),
  ('Лимоны',                      'g',  null, 1000,  16,  0.9,  0.1, 3.0,   50, 2, '{snack}',               true,  45,    37.5),
  ('Хурма',                       'g',  null, 1000,  67,  0.5,  0.4, 15.3, 250, 2, '{snack}',               true,  75,    37.5),
  ('Бананы',                      'g',  null, 1000,  96,  1.5,  0.5, 21.0, 250, 2, '{breakfast,snack}',     true,  35,    30);

  insert into products (space_id, category_id, name, unit, grams_per_piece,
                        kcal_100, protein_100, fat_100, carbs_100, max_g_day, quality, slots, active)
  select v_space, v_cat, m.name, m.unit, m.gpp, m.kcal, m.p, m.f, m.c, m.max_g, m.quality, m.slots, m.active
  from _market m
  on conflict (space_id, name) do nothing;
  get diagnostics n_prod = row_count;

  insert into product_prices (product_id, store_id, pack_qty, price_minor, observed_on, created_by)
  select pr.id, v_store, m.pack, round(x.rub * 100)::bigint, x.d, v_tg
  from _market m
  join products pr on pr.space_id = v_space and pr.name = m.name
  cross join lateral (values (date '2026-10-30', m.price_oct), (date '2026-11-13', m.price_nov)) as x(d, rub)
  where not exists (
    select 1 from product_prices q
    where q.product_id = pr.id and q.store_id = v_store and q.observed_on = x.d
  );
  get diagnostics n_price = row_count;

  raise notice 'Пространство %: новых продуктов %, новых цен %', v_space, n_prod, n_price;
end $$;
