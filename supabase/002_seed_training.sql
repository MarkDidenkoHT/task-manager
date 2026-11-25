-- Встроенные упражнения и стартовые программы (шаблоны).
-- Выполните после 001_schema.sql. Файл можно запускать повторно: шаблоны пересоздаются.
-- Расширенная библиотека из Free Exercise DB загружается отдельно: npm run seed:exercises

insert into exercises (space_id, name, name_en, source, external_id, kind, level, equipment, primary_muscles, secondary_muscles, instructions) values
 (null,'Приседания','Bodyweight Squat','builtin','squat','reps','beginner','{body only}','{quadriceps}','{glutes,hamstrings}','Стопы на ширине плеч, спина прямая. Опуститесь до параллели бёдер с полом, колени смотрят по линии носков, поднимитесь.'),
 (null,'Отжимания','Push-up','builtin','pushup','reps','beginner','{body only}','{chest}','{triceps,shoulders}','Ладони чуть шире плеч, тело — прямая линия. Опуститесь грудью почти до пола и выжмите себя вверх.'),
 (null,'Отжимания от опоры','Incline Push-up','builtin','incline_pushup','reps','beginner','{body only}','{chest}','{triceps,shoulders}','Руки на скамье или столе. Чем выше опора, тем легче. Тело прямое, опускайтесь грудью к опоре.'),
 (null,'Отжимания «пайк»','Pike Push-up','builtin','pike_pushup','reps','intermediate','{body only}','{shoulders}','{triceps}','Таз высоко, тело буквой Λ. Сгибайте руки, опуская макушку к полу между ладонями.'),
 (null,'Скручивания','Crunch','builtin','crunch','reps','beginner','{body only}','{abdominals}','{}','Лёжа на спине, колени согнуты. Поднимайте плечи от пола за счёт пресса, поясница прижата.'),
 (null,'Подъёмы корпуса','Sit-up','builtin','situp','reps','beginner','{body only}','{abdominals}','{}','Лёжа на спине, стопы зафиксированы. Поднимите корпус до вертикали и медленно опуститесь.'),
 (null,'Велосипед','Bicycle Crunch','builtin','bicycle_crunch','reps','beginner','{body only}','{abdominals}','{obliques}','Лёжа на спине, попеременно тяните локоть к противоположному колену. Счёт — каждое касание.'),
 (null,'Русские скручивания','Russian Twist','builtin','russian_twist','reps','beginner','{body only}','{obliques}','{abdominals}','Сидя, корпус отклонён назад, ноги приподняты. Поворачивайте корпус из стороны в сторону.'),
 (null,'Подъёмы ног лёжа','Lying Leg Raise','builtin','leg_raise','reps','beginner','{body only}','{abdominals}','{hip flexors}','Лёжа на спине, поднимайте прямые ноги до вертикали и медленно опускайте, не касаясь пола.'),
 (null,'Планка','Plank','builtin','plank','timed','beginner','{body only}','{abdominals}','{shoulders}','Упор на предплечья, тело прямое, пресс и ягодицы напряжены. Держите заданное время (секунды).'),
 (null,'Боковая планка','Side Plank','builtin','side_plank','timed','beginner','{body only}','{obliques}','{abdominals}','Упор на предплечье боком, тело в линию. Время указано на каждую сторону (секунды).'),
 (null,'Супермен','Superman','builtin','superman','reps','beginner','{body only}','{lower back}','{glutes}','Лёжа на животе, одновременно поднимите руки и ноги, задержитесь на секунду, опуститесь.'),
 (null,'Ягодичный мостик','Glute Bridge','builtin','glute_bridge','reps','beginner','{body only}','{glutes}','{hamstrings}','Лёжа на спине, стопы у таза. Поднимите таз до прямой линии от колен до плеч, сожмите ягодицы.'),
 (null,'Ягодичный мостик на одной ноге','Single-Leg Glute Bridge','builtin','single_leg_bridge','reps','intermediate','{body only}','{glutes}','{hamstrings}','Как обычный мостик, вторая нога выпрямлена. Повторы на каждую ногу.'),
 (null,'Обратные выпады','Reverse Lunge','builtin','reverse_lunge','reps','beginner','{body only}','{quadriceps}','{glutes}','Шаг назад и опускание до прямого угла в обоих коленях. Повторы на каждую ногу.'),
 (null,'Выпады','Lunge','builtin','lunges','reps','beginner','{body only,dumbbell}','{quadriceps}','{glutes,hamstrings}','Шаг вперёд, опуститесь до прямого угла в коленях, оттолкнитесь назад. Повторы на каждую ногу.'),
 (null,'Боковые выпады','Side Lunge','builtin','side_lunge','reps','beginner','{body only}','{adductors}','{glutes,quadriceps}','Широкий шаг в сторону, сядьте на опорную ногу, вторая прямая. Повторы на каждую сторону.'),
 (null,'Сплит-приседания','Split Squat','builtin','split_squat','reps','beginner','{body only,dumbbell}','{quadriceps}','{glutes}','Ноги в длинном шаге, опускайтесь вертикально вниз. Повторы на каждую ногу.'),
 (null,'Приседания сумо','Sumo Squat','builtin','sumo_squat','reps','beginner','{body only,dumbbell}','{adductors}','{glutes,quadriceps}','Широкая стойка, носки развёрнуты. Приседайте, колени по линии носков.'),
 (null,'Махи ногой назад','Donkey Kick','builtin','donkey_kick','reps','beginner','{body only,bands}','{glutes}','{}','На четвереньках поднимайте согнутую ногу стопой к потолку. Повторы на каждую ногу.'),
 (null,'Подъёмы на носки','Calf Raise','builtin','calf_raise','reps','beginner','{body only,dumbbell}','{calves}','{}','Поднимитесь на носки как можно выше, задержитесь и медленно опуститесь.'),
 (null,'Гоблет-приседания','Goblet Squat','builtin','goblet_squat','reps','beginner','{dumbbell}','{quadriceps}','{glutes}','Гантель вертикально у груди. Приседайте глубоко, спина прямая.'),
 (null,'Румынская тяга с гантелями','Dumbbell Romanian Deadlift','builtin','rdl','reps','beginner','{dumbbell}','{hamstrings}','{glutes,lower back}','Ноги слегка согнуты, отводите таз назад, опуская гантели вдоль ног до середины голени. Спина прямая.'),
 (null,'Молотковые сгибания','Hammer Curl','builtin','hammer_curl','reps','beginner','{dumbbell}','{biceps}','{forearms}','Ладони смотрят друг на друга. Сгибайте руки, локти прижаты к корпусу.'),
 (null,'Сгибания рук с гантелями','Dumbbell Biceps Curl','builtin','biceps_curl','reps','beginner','{dumbbell}','{biceps}','{}','Ладони вперёд, сгибайте руки без раскачки корпуса.'),
 (null,'Тяга гантели в наклоне','One-Arm Dumbbell Row','builtin','db_row','reps','beginner','{dumbbell}','{lats}','{biceps,middle back}','Опора рукой и коленом на скамью, тяните гантель к поясу. Повторы на каждую руку.'),
 (null,'Тяга гантелей в наклоне','Bent-Over Dumbbell Row','builtin','bent_row','reps','beginner','{dumbbell}','{middle back}','{lats,biceps}','Наклон корпуса около 45°, спина прямая, тяните обе гантели к поясу.'),
 (null,'Разведения в наклоне','Reverse Fly','builtin','reverse_fly','reps','beginner','{dumbbell}','{shoulders}','{middle back}','В наклоне разводите руки с лёгкими гантелями в стороны, сводя лопатки.'),
 (null,'Жим гантелей над головой','Dumbbell Shoulder Press','builtin','db_ohp','reps','beginner','{dumbbell}','{shoulders}','{triceps}','Гантели у плеч, выжмите вверх до выпрямления рук, не прогибая поясницу.'),
 (null,'Разгибание руки из-за головы','Overhead Triceps Extension','builtin','triceps_ext','reps','beginner','{dumbbell}','{triceps}','{}','Гантель за головой двумя руками, разгибайте руки вверх, локти неподвижны.'),
 (null,'Обратные отжимания от стула','Chair Dip','builtin','chair_dips','reps','beginner','{body only}','{triceps}','{chest,shoulders}','Руки на краю стула за спиной, опускайтесь сгибая локти до прямого угла.')
on conflict (source, external_id) do update set
  name = excluded.name, name_en = excluded.name_en, kind = excluded.kind, level = excluded.level,
  equipment = excluded.equipment, primary_muscles = excluded.primary_muscles,
  secondary_muscles = excluded.secondary_muscles, instructions = excluded.instructions;

-- ---------- Стартовые программы ----------

create or replace function pg_temp.ex(code text) returns uuid language sql as
$$ select id from exercises where source = 'builtin' and external_id = code $$;

create or replace function pg_temp.day(prog uuid, idx int, prt text, lbl text) returns uuid language sql as
$$ insert into program_days (program_id, day_idx, part, label) values (prog, idx, prt, lbl) returning id $$;

-- d: день, pos: порядок, code: упражнение, s: подходы, r: повторы (или секунды), kg: вес, step: шаг веса
create or replace function pg_temp.pe(d uuid, pos int, code text, s int, r int, kg numeric default 0, step numeric default 0)
returns void language sql as $$
  insert into program_exercises (program_day_id, exercise_id, position, sets, target_reps, load_kg, rep_ceiling, load_step_kg, rep_step)
  values (d, pg_temp.ex(code), pos, s, r, kg,
          case when (select kind from exercises where id = pg_temp.ex(code)) = 'timed' then r + 30 else r + 5 end,
          step,
          case when (select kind from exercises where id = pg_temp.ex(code)) = 'timed' then 5 else 1 end)
$$;

delete from programs where is_template and space_id is null;

do $$
declare p uuid; d uuid;
begin
  -- 1. Микро-15
  insert into programs (id, space_id, name, description, minutes_per_session, sessions_per_week, is_template, audience, goal, equipment)
  values ('00000000-0000-4000-a000-000000000001', null, 'Микро-15', 'Короткая ежедневная сессия на всё тело без инвентаря.', 15, 7, true, 'any', 'Общая форма', '{}')
  returning id into p;
  d := pg_temp.day(p, 1, 'single', 'Каждый день');
  perform pg_temp.pe(d, 1, 'squat', 1, 20);
  perform pg_temp.pe(d, 2, 'pushup', 2, 10);
  perform pg_temp.pe(d, 3, 'crunch', 1, 20);
  perform pg_temp.pe(d, 4, 'glute_bridge', 1, 20);
  perform pg_temp.pe(d, 5, 'plank', 2, 30);

  -- 2. Утро и вечер 2×15
  insert into programs (id, space_id, name, description, minutes_per_session, sessions_per_week, is_template, audience, goal, equipment)
  values ('00000000-0000-4000-a000-000000000002', null, 'Утро и вечер 2×15', 'Две короткие сессии в день: утром тело и пресс, вечером руки и спина. Гантели по желанию.', 15, 7, true, 'any', 'Общая форма', '{dumbbell}')
  returning id into p;
  d := pg_temp.day(p, 1, 'morning', 'Утро');
  perform pg_temp.pe(d, 1, 'squat', 1, 20);
  perform pg_temp.pe(d, 2, 'crunch', 1, 30);
  perform pg_temp.pe(d, 3, 'pushup', 1, 20);
  d := pg_temp.day(p, 1, 'evening', 'Вечер');
  perform pg_temp.pe(d, 1, 'hammer_curl', 3, 15, 5, 1);
  perform pg_temp.pe(d, 2, 'db_row', 2, 12, 5, 1);
  perform pg_temp.pe(d, 3, 'plank', 2, 30);

  -- 3. Всё тело, дом
  insert into programs (id, space_id, name, description, minutes_per_session, sessions_per_week, is_template, audience, goal, equipment)
  values ('00000000-0000-4000-a000-000000000003', null, 'Всё тело, дом', 'Две чередующиеся тренировки: А, Б, А на одной неделе и Б, А, Б на следующей.', 30, 3, true, 'any', 'Сила и выносливость', '{}')
  returning id into p;
  d := pg_temp.day(p, 1, 'single', 'Тренировка А');
  perform pg_temp.pe(d, 1, 'squat', 3, 12);
  perform pg_temp.pe(d, 2, 'pushup', 3, 8);
  perform pg_temp.pe(d, 3, 'glute_bridge', 3, 15);
  perform pg_temp.pe(d, 4, 'plank', 3, 30);
  d := pg_temp.day(p, 2, 'single', 'Тренировка Б');
  perform pg_temp.pe(d, 1, 'reverse_lunge', 3, 10);
  perform pg_temp.pe(d, 2, 'pike_pushup', 3, 6);
  perform pg_temp.pe(d, 3, 'superman', 3, 12);
  perform pg_temp.pe(d, 4, 'side_plank', 2, 20);
  perform pg_temp.pe(d, 5, 'bicycle_crunch', 3, 15);

  -- 4. Верх и ноги, гантели
  insert into programs (id, space_id, name, description, minutes_per_session, sessions_per_week, is_template, audience, goal, equipment)
  values ('00000000-0000-4000-a000-000000000004', null, 'Верх и ноги, гантели', 'Четыре дня: жимы, тяги, ноги, пресс. Акцент на верх тела и руки.', 40, 4, true, 'men', 'Мышечная масса', '{dumbbell}')
  returning id into p;
  d := pg_temp.day(p, 1, 'single', 'День 1 — жимы');
  perform pg_temp.pe(d, 1, 'pushup', 4, 12);
  perform pg_temp.pe(d, 2, 'db_ohp', 3, 10, 8, 1);
  perform pg_temp.pe(d, 3, 'triceps_ext', 3, 12, 8, 1);
  perform pg_temp.pe(d, 4, 'chair_dips', 3, 10);
  d := pg_temp.day(p, 2, 'single', 'День 2 — тяги');
  perform pg_temp.pe(d, 1, 'bent_row', 4, 10, 10, 1);
  perform pg_temp.pe(d, 2, 'hammer_curl', 3, 12, 8, 1);
  perform pg_temp.pe(d, 3, 'biceps_curl', 3, 12, 8, 1);
  perform pg_temp.pe(d, 4, 'reverse_fly', 3, 12, 4, 1);
  d := pg_temp.day(p, 3, 'single', 'День 3 — ноги');
  perform pg_temp.pe(d, 1, 'goblet_squat', 4, 12, 12, 2);
  perform pg_temp.pe(d, 2, 'rdl', 3, 12, 12, 2);
  perform pg_temp.pe(d, 3, 'lunges', 3, 10);
  perform pg_temp.pe(d, 4, 'calf_raise', 3, 20);
  d := pg_temp.day(p, 4, 'single', 'День 4 — пресс');
  perform pg_temp.pe(d, 1, 'plank', 3, 45);
  perform pg_temp.pe(d, 2, 'leg_raise', 3, 12);
  perform pg_temp.pe(d, 3, 'russian_twist', 3, 20);

  -- 5. Ягодицы, ноги, корпус
  insert into programs (id, space_id, name, description, minutes_per_session, sessions_per_week, is_template, audience, goal, equipment)
  values ('00000000-0000-4000-a000-000000000005', null, 'Ягодицы, ноги, корпус', 'Три дня (четвёртый по желанию — повтор первого). Акцент на ягодицы, ноги и корпус.', 35, 3, true, 'women', 'Тонус и сила', '{bands,dumbbell}')
  returning id into p;
  d := pg_temp.day(p, 1, 'single', 'День 1 — ягодицы');
  perform pg_temp.pe(d, 1, 'glute_bridge', 4, 15);
  perform pg_temp.pe(d, 2, 'split_squat', 3, 10);
  perform pg_temp.pe(d, 3, 'sumo_squat', 3, 15);
  perform pg_temp.pe(d, 4, 'donkey_kick', 3, 15);
  d := pg_temp.day(p, 2, 'single', 'День 2 — верх');
  perform pg_temp.pe(d, 1, 'incline_pushup', 3, 10);
  perform pg_temp.pe(d, 2, 'db_row', 3, 12, 4, 1);
  perform pg_temp.pe(d, 3, 'db_ohp', 3, 12, 3, 1);
  perform pg_temp.pe(d, 4, 'plank', 3, 30);
  d := pg_temp.day(p, 3, 'single', 'День 3 — ноги и корпус');
  perform pg_temp.pe(d, 1, 'rdl', 4, 12, 6, 1);
  perform pg_temp.pe(d, 2, 'side_lunge', 3, 10);
  perform pg_temp.pe(d, 3, 'single_leg_bridge', 3, 10);
  perform pg_temp.pe(d, 4, 'side_plank', 3, 20);
end $$;
