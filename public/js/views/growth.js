import { api, invalidate, sp } from '../api.js';
import { icon } from '../icons.js';
import { go } from '../router.js';
import { header, headerHandlers, setFab } from '../shell.js';
import { canWrite } from '../store.js';
import { confirmDialog, notify, setMainButton } from '../tg.js';
import {
  chips, delegate, empty, fmt, formSheet, html, listRow, load, openSheet, plural, render, sectionTitle, toast,
  toastError, WEEKDAYS
} from '../ui.js';
import { reminderSheet } from './reminders.js';

export const MUSCLES = {
  abdominals: 'Пресс', obliques: 'Косые мышцы', abductors: 'Отводящие бедра', adductors: 'Приводящие бедра',
  biceps: 'Бицепс', calves: 'Икры', chest: 'Грудь', forearms: 'Предплечья', glutes: 'Ягодицы',
  hamstrings: 'Задняя поверхность бедра', lats: 'Широчайшие', 'lower back': 'Поясница', 'middle back': 'Середина спины',
  neck: 'Шея', quadriceps: 'Квадрицепс', shoulders: 'Плечи', traps: 'Трапеции', triceps: 'Трицепс', 'hip flexors': 'Сгибатели бедра'
};
export const EQUIPMENT = {
  'body only': 'Своё тело', dumbbell: 'Гантели', bands: 'Резинки', kettlebells: 'Гири', barbell: 'Штанга',
  cable: 'Тросовый тренажёр', machine: 'Тренажёр', 'e-z curl bar': 'EZ-гриф', 'exercise ball': 'Фитбол',
  'medicine ball': 'Медбол', 'foam roll': 'Ролик', other: 'Другое'
};
const LEVEL = { beginner: 'Начальный', intermediate: 'Средний', expert: 'Продвинутый' };
const AUDIENCE = { any: 'Для всех', men: 'Акцент: верх тела', women: 'Акцент: ягодицы и ноги' };
const PART = { single: '', morning: 'Утро', evening: 'Вечер' };

export const tr = (dict, v) => dict[v] || v;
export const setsText = (pe) =>
  `${pe.sets}×${pe.target_reps}${pe.exercises?.kind === 'timed' ? ' с' : ''}${Number(pe.load_kg) > 0 ? ` · ${fmt(pe.load_kg, 2)} кг` : ''}`;

/** Подсказка по сплиту: сколько упражнений и подходов уложится в заданное время. */
export function splitHint(minutes) {
  const ex = Math.max(2, Math.min(8, Math.round(minutes / 4.5)));
  const sets = minutes <= 15 ? '2–3' : minutes <= 30 ? '3' : '3–4';
  return `${minutes} мин ≈ ${ex} ${plural(ex, 'упражнение', 'упражнения', 'упражнений')} по ${sets} подхода`;
}

// ---------- Главный экран раздела ----------
export async function growth(root) {
  const off = delegate(root, {
    ...headerHandlers,
    go: (el) => go(el.dataset.to),
    'new-program': () => newProgramSheet(),
    'add-reminder': (el) => reminderSheet(null, { kind: el.dataset.kind }, draw),
    mark: async (el) => {
      try {
        await api(sp(`/reminders/${el.dataset.id}/mark`), { method: 'POST', body: { status: 'done' } });
        notify('success');
        draw();
      } catch (e) {
        toastError(e);
      }
    }
  });
  setFab(null);
  render(root, html`${header('Развитие')}<div id="growth-body"></div>`);
  const body = root.querySelector('#growth-body');

  const draw = () =>
    load(body, () => Promise.all([api(sp('/programs')), api(sp('/reminders?mine=1'))]), ([programs, reminders]) => {
      const group = (kinds) => reminders.filter((r) => kinds.includes(r.kind));
      const best = (list) => Math.max(0, ...list.map((r) => r.streak));
      const next = (list) => list.filter((r) => r.active).map((r) => r.local_time).sort()[0];
      const sport = group(['workout']);
      const reading = group(['reading']);
      const custom = group(['custom']);
      const card = (title, ic, list, to) => html`<div class="card tap" data-action="go" data-to="${to}">
        <div class="icon-chip c-growth">${icon(ic)}</div>
        <div class="card-title">${title}</div>
        <div class="caption">${next(list) ? `в ${next(list)}` : 'нет напоминаний'}</div>
        <div class="streak">${best(list) ? html`${icon('flame')} ${best(list)} ${plural(best(list), 'день', 'дня', 'дней')}` : ''}</div>
      </div>`;
      const reminderRows = (list, kind) =>
        html`<div class="list">${list.map((r) =>
          listRow({
            title: r.title,
            subtitle: `${r.local_time} · ${r.weekdays.length === 7 ? 'каждый день' : r.weekdays.map((d) => WEEKDAYS[d - 1]).join(' ')}${r.streak ? ` · серия ${r.streak}` : ''}`,
            iconName: kind === 'reading' ? 'book' : 'target',
            iconCls: 'c-growth',
            trail: r.today_status === 'done'
              ? html`<span class="ok">${icon('check')}</span>`
              : canWrite() && r.weekdays.length ? html`<button class="btn small secondary" data-action="mark" data-id="${r.id}">Готово</button>` : '',
            chevron: false
          })
        )}${canWrite() ? listRow({ title: html`<span style="color:var(--link)">Добавить</span>`, iconName: 'plus', iconCls: 'c-gray', action: 'add-reminder', data: { kind }, chevron: false }) : ''}</div>`;

      render(
        body,
        html`<div class="growth-tiles">
            ${card('Спорт', 'dumbbell', sport, '/growth/reminders')}
            ${card('Чтение', 'book', reading, '/growth/reminders')}
            ${card('Свои цели', 'target', custom, '/growth/reminders')}
          </div>

          ${sectionTitle('Мои программы', canWrite() ? html`<button class="action" data-action="new-program">${icon('plus')} Новая</button>` : '')}
          ${programs.length
            ? html`<div class="list">${programs.map((p) =>
                listRow({
                  title: p.name,
                  subtitle: `${p.minutes_per_session} мин · ${p.sessions_per_week}× в неделю · ${p.program_days.length} ${plural(p.program_days.length, 'день', 'дня', 'дней')}`,
                  iconName: 'dumbbell',
                  iconCls: 'c-growth',
                  action: 'go',
                  data: { to: `/growth/program/${p.id}` }
                })
              )}</div>`
            : html`<div class="card">${empty({ iconName: 'dumbbell', cls: 'c-growth', text: 'Выберите готовую программу или соберите свою' })}</div>`}
          <div class="list" style="margin-top:12px">
            ${listRow({ title: 'Шаблоны программ', subtitle: 'Дома, без инвентаря и с гантелями', iconName: 'sparkle', iconCls: 'c-growth', action: 'go', data: { to: '/growth/templates' } })}
            ${listRow({ title: 'Библиотека упражнений', iconName: 'search', iconCls: 'c-growth', action: 'go', data: { to: '/growth/library' } })}
          </div>

          ${sectionTitle('Чтение')}
          ${reminderRows(reading, 'reading')}
          ${sectionTitle('Свои цели')}
          ${reminderRows(custom, 'custom')}

          <div class="list" style="margin-top:24px">${listRow({ title: 'Все напоминания', iconName: 'bell', iconCls: 'c-growth', action: 'go', data: { to: '/growth/reminders' } })}</div>`
      );
    }, { skeletonRows: 6 });
  await draw();
  return { destroy: off };
}

function newProgramSheet() {
  const fields = [
    { name: 'name', label: 'Название', required: true, placeholder: 'Утро 15' },
    { name: 'minutes_per_session', label: 'Минут на тренировку', type: 'stepper', min: 5, max: 120, step: 5 },
    { name: 'sessions_per_week', label: 'Тренировок в неделю', type: 'stepper', min: 1, max: 14 },
    { name: 'days_count', label: 'Разных дней в программе', type: 'stepper', min: 1, max: 7 },
    { name: 'twice', label: 'Две части в день (утро и вечер)', type: 'toggle' }
  ];
  formSheet({
    title: 'Новая программа',
    fields,
    values: { minutes_per_session: 15, sessions_per_week: 3, days_count: 1 },
    submitText: 'Создать',
    extra: html`<div class="notice" id="split" style="margin-bottom:12px">${splitHint(15)}</div>`,
    onMount: (s) =>
      s.el.addEventListener('change', (e) => {
        if (e.detail?.name === 'minutes_per_session') s.el.querySelector('#split').textContent = splitHint(e.detail.value);
      }),
    onSubmit: async (v) => {
      const days = [];
      for (let i = 1; i <= v.days_count; i++) {
        const base = v.days_count > 1 ? `День ${i}` : 'Тренировка';
        if (v.twice) {
          days.push({ label: `${base} — утро`, part: 'morning', day_idx: i }, { label: `${base} — вечер`, part: 'evening', day_idx: i });
        } else days.push({ label: base, part: 'single', day_idx: i });
      }
      const p = await api(sp('/programs'), {
        method: 'POST',
        body: { name: v.name, minutes_per_session: v.minutes_per_session, sessions_per_week: v.sessions_per_week, days }
      });
      notify('success');
      go(`/growth/program/${p.id}`);
    }
  });
}

// ---------- Шаблоны ----------
export async function templates(root) {
  const f = { audience: 'all', equipment: '', minutes: '' };
  const filters = html`<div class="stack" style="margin-bottom:12px">
      ${chips('audience', [{ value: 'all', label: 'Все' }, { value: 'men', label: 'Мужчины' }, { value: 'women', label: 'Женщины' }], f.audience, { small: true })}
      ${chips('equipment', [{ value: '', label: 'Любой инвентарь' }, { value: 'none', label: 'Без инвентаря' }, { value: 'dumbbell', label: 'Гантели' }, { value: 'bands', label: 'Резинки' }], f.equipment, { small: true })}
      ${chips('minutes', [{ value: '', label: 'Любое время' }, { value: '15', label: 'до 15 мин' }, { value: '30', label: 'до 30 мин' }, { value: '45', label: 'до 45 мин' }], f.minutes, { small: true })}
    </div>`;
  render(
    root,
    html`<h1 class="screen-title">Шаблоны программ</h1>${filters}<div id="tpl"></div>
      <div class="notice" style="margin-top:16px">Это общие программы для поддержания формы, а не медицинская рекомендация. При травмах, беременности или хронических заболеваниях посоветуйтесь с врачом. Акцент «для мужчин» и «для женщин» — только про выбор упражнений; программы подходят всем.</div>`
  );
  const box = root.querySelector('#tpl');
  const draw = () =>
    load(box, () => api(`/program-templates?audience=${f.audience}&equipment=${f.equipment}&minutes=${f.minutes}`), (rows) => {
      render(
        box,
        rows.length
          ? html`${rows.map(
              (t) => html`<div class="card">
                <div class="row between"><div class="card-title">${t.name}</div><span class="badge accent">${AUDIENCE[t.audience]}</span></div>
                <div class="caption" style="margin:4px 0 8px">${t.minutes_per_session} мин · ${t.sessions_per_week}× в неделю · ${t.equipment.length ? t.equipment.map((e) => tr(EQUIPMENT, e)).join(', ') : 'без инвентаря'}</div>
                <p class="small muted">${t.description || ''}</p>
                ${t.program_days.map(
                  (d) => html`<div style="margin-top:10px"><div class="small" style="font-weight:600">${d.label}</div>
                    <div class="small muted">${d.program_exercises.map((pe) => `${pe.exercises?.name} ${setsText(pe)}`).join(' · ')}</div></div>`
                )}
                ${canWrite() ? html`<div class="btn-row"><button class="btn block" data-use="${t.id}">Использовать</button></div>` : ''}
              </div>`
            )}`
          : html`<div class="card"><p class="muted">Нет шаблонов под выбранные фильтры</p></div>`
      );
    });
  root.addEventListener('change', (e) => {
    if (!e.detail || !(e.detail.name in f)) return;
    f[e.detail.name] = e.detail.value;
    draw();
  });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-use]');
    if (!b) return;
    b.disabled = true;
    try {
      const p = await api(sp(`/program-templates/${b.dataset.use}/use`), { method: 'POST' });
      notify('success');
      toast('Программа добавлена в «Мои программы»', 'success');
      go(`/growth/program/${p.id}`);
    } catch (err) {
      b.disabled = false;
      toastError(err);
    }
  });
  await draw();
}

// ---------- Программа ----------
export async function program(root, { id }) {
  let prog;
  const off = delegate(root, {
    start: (el) => go(`/growth/session/${id}/${el.dataset.day}`),
    'edit-pe': (el) => {
      if (!canWrite()) return;
      const pe = prog.program_days.flatMap((d) => d.program_exercises).find((x) => x.id === el.dataset.id);
      peSheet(pe, draw);
    },
    'add-ex': (el) => go(`/growth/library?pick=${el.dataset.day}&program=${id}`),
    'edit-day': (el) => {
      const d = prog.program_days.find((x) => x.id === el.dataset.day);
      formSheet({
        title: 'День программы',
        fields: [
          { name: 'label', label: 'Название', required: true },
          { name: 'part', label: 'Часть дня', type: 'chips', small: true, options: [{ value: 'single', label: 'Весь день' }, { value: 'morning', label: 'Утро' }, { value: 'evening', label: 'Вечер' }] }
        ],
        values: d,
        onSubmit: async (v) => {
          await api(sp(`/programs/${id}/days/${d.id}`), { method: 'PATCH', body: v });
          draw();
        },
        onDelete: async () => {
          if (!(await confirmDialog(`Удалить «${d.label}» со всеми упражнениями?`))) return false;
          await api(sp(`/programs/${id}/days/${d.id}`), { method: 'DELETE' });
          draw();
        }
      });
    },
    'add-day': () =>
      formSheet({
        title: 'Новый день',
        fields: [
          { name: 'label', label: 'Название', required: true, placeholder: `День ${prog.program_days.length + 1}` },
          { name: 'part', label: 'Часть дня', type: 'chips', small: true, options: [{ value: 'single', label: 'Весь день' }, { value: 'morning', label: 'Утро' }, { value: 'evening', label: 'Вечер' }] }
        ],
        values: { part: 'single' },
        onSubmit: async (v) => {
          await api(sp(`/programs/${id}/days`), { method: 'POST', body: v });
          draw();
        }
      }),
    'edit-program': () =>
      formSheet({
        title: 'Программа',
        fields: [
          { name: 'name', label: 'Название', required: true },
          { name: 'description', label: 'Описание', type: 'textarea' },
          { name: 'minutes_per_session', label: 'Минут на тренировку', type: 'stepper', min: 5, max: 120, step: 5 },
          { name: 'sessions_per_week', label: 'Тренировок в неделю', type: 'stepper', min: 1, max: 14 }
        ],
        values: prog,
        onSubmit: async (v) => {
          await api(sp(`/programs/${id}`), { method: 'PATCH', body: v });
          draw();
        },
        onDelete: async () => {
          if (!(await confirmDialog(`Удалить программу «${prog.name}» и весь журнал?`))) return false;
          await api(sp(`/programs/${id}`), { method: 'DELETE' });
          invalidate();
          go('/growth', { replace: true });
        },
        deleteText: 'Удалить программу'
      }),
    remind: () => reminderSheet(null, { kind: 'workout', program_id: id, title: prog.name }, () => toast('Напоминание добавлено', 'success')),
    history: () => historySheet(id)
  });

  const draw = () =>
    load(root, () => api(sp(`/programs/${id}`)), (p) => {
      prog = p;
      render(
        root,
        html`<div class="row between"><h1 class="screen-title" style="margin-bottom:4px">${p.name}</h1>
            ${canWrite() ? html`<button class="icon-btn" data-action="edit-program" aria-label="Изменить">${icon('edit')}</button>` : ''}</div>
          <p class="screen-sub" style="margin-top:0">${p.minutes_per_session} мин · ${p.sessions_per_week}× в неделю${p.template_id ? ' · из шаблона' : ''}</p>
          ${p.description ? html`<p class="small muted" style="margin-bottom:12px">${p.description}</p>` : ''}
          ${p.program_days.map(
            (d) => html`${sectionTitle(
              html`${d.label}${d.part !== 'single' && !d.label.toLowerCase().includes(PART[d.part].toLowerCase()) ? ` · ${PART[d.part]}` : ''}`,
              canWrite() ? html`<button class="action" data-action="edit-day" data-day="${d.id}">${icon('edit')}</button>` : ''
            )}
              <div class="list">
                ${d.program_exercises.map((pe) =>
                  listRow({
                    title: pe.exercises?.name || 'Упражнение',
                    subtitle: html`${setsText(pe)}${pe.suggestion && pe.suggestion.action !== 'keep' ? html` · <span style="color:var(--c-growth)">${pe.suggestion.text}</span>` : ''}`,
                    iconName: 'dumbbell',
                    iconCls: 'c-growth',
                    action: 'edit-pe',
                    data: { id: pe.id },
                    chevron: canWrite()
                  })
                )}
                ${canWrite() ? listRow({ title: html`<span style="color:var(--link)">Добавить упражнение</span>`, iconName: 'plus', iconCls: 'c-gray', action: 'add-ex', data: { day: d.id }, chevron: false }) : ''}
              </div>
              ${d.program_exercises.length ? html`<div class="btn-row" style="margin-top:8px"><button class="btn block" data-action="start" data-day="${d.id}">${icon('play')} Начать тренировку</button></div>` : ''}`
          )}
          <div class="list" style="margin-top:24px">
            ${canWrite() ? listRow({ title: 'Добавить день', iconName: 'plus', iconCls: 'c-growth', action: 'add-day', chevron: false }) : ''}
            ${canWrite() ? listRow({ title: 'Напоминание о тренировке', iconName: 'bell', iconCls: 'c-growth', action: 'remind' }) : ''}
            ${listRow({ title: 'История тренировок', iconName: 'calendar', iconCls: 'c-growth', action: 'history' })}
          </div>`
      );
    }, { skeletonRows: 6 });
  await draw();
  return { destroy: off };
}

export function peSheet(pe, onSaved) {
  const timed = pe.exercises?.kind === 'timed';
  const unit = timed ? 'секунды' : 'повторы';
  formSheet({
    title: pe.exercises?.name || 'Упражнение',
    fields: [
      { name: 'sets', label: 'Подходы', type: 'stepper', min: 1, max: 20 },
      { name: 'target_reps', label: `Цель: ${unit}`, type: 'stepper', min: 1, max: 1000, step: timed ? 5 : 1 },
      { name: 'rep_ceiling', label: `Потолок: ${unit}`, type: 'stepper', min: 1, max: 1000, step: timed ? 5 : 1 },
      { name: 'load_kg', label: 'Вес, кг', type: 'number' },
      { name: 'load_step_kg', label: 'Шаг веса, кг', type: 'number', hint: '0 — упражнение с весом тела: растут только повторы' },
      { name: 'rep_step', label: `Шаг: ${unit}`, type: 'stepper', min: 1, max: 50 }
    ],
    values: pe,
    extra: html`<div class="notice" style="margin-bottom:12px">Двойная прогрессия: когда во всех подходах достигнут потолок — вес растёт на шаг, а повторы возвращаются к цели. Когда достигнута цель — цель растёт на шаг повторов.</div>`,
    onSubmit: async (v) => {
      if (v.rep_ceiling < v.target_reps) throw new Error('Потолок не может быть меньше цели');
      await api(sp(`/program-exercises/${pe.id}`), { method: 'PATCH', body: { ...v, load_kg: v.load_kg ?? 0, load_step_kg: v.load_step_kg ?? 0 } });
      onSaved?.();
    },
    onDelete: async () => {
      if (!(await confirmDialog('Убрать упражнение из программы? Журнал по нему тоже удалится.'))) return false;
      await api(sp(`/program-exercises/${pe.id}`), { method: 'DELETE' });
      onSaved?.();
    },
    deleteText: 'Убрать из программы'
  });
}

async function historySheet(id) {
  const s = openSheet({ title: 'История', body: html`<div class="skeleton sk-line"></div>` });
  try {
    const [hist, prog] = await Promise.all([api(sp(`/programs/${id}/history`)), api(sp(`/programs/${id}`))]);
    const name = new Map(prog.program_days.flatMap((d) => d.program_exercises).map((pe) => [pe.id, pe.exercises?.name]));
    s.setBody(
      hist.length
        ? html`${hist.map((h) => {
            const by = new Map();
            for (const l of h.sets) by.set(l.program_exercise_id, [...(by.get(l.program_exercise_id) || []), l]);
            return html`<div class="section-title" style="margin-left:0">${new Date(h.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' })}</div>
              <div class="card" style="background:var(--fill)">${[...by.entries()].map(
                ([pe, sets]) => html`<div class="kv"><span class="k">${name.get(pe) || '—'}</span><span class="num">${sets.sort((a, b) => a.set_no - b.set_no).map((x) => x.reps + (Number(x.load_kg) > 0 ? '×' + fmt(x.load_kg, 1) : '')).join(', ')}</span></div>`
              )}</div>`;
          })}`
        : empty({ iconName: 'calendar', text: 'Тренировок пока нет' })
    );
  } catch (e) {
    s.setBody(html`<p>${e.message}</p>`);
  }
}

// ---------- Библиотека ----------
export async function library(root, _p, q) {
  const pickDay = q.get('pick');
  const programId = q.get('program');
  const f = { q: '', muscle: '', equipment: '' };
  render(
    root,
    html`<h1 class="screen-title">${pickDay ? 'Выберите упражнение' : 'Библиотека упражнений'}</h1>
      <div class="form" style="margin-bottom:12px"><label class="field" style="display:flex;align-items:center;gap:8px">${icon('search')}<input id="q" placeholder="Поиск: приседания, squat…" autocomplete="off" /></label></div>
      <div class="stack" style="margin-bottom:12px">
        ${chips('muscle', [{ value: '', label: 'Все мышцы' }, ...['quadriceps', 'glutes', 'hamstrings', 'chest', 'lats', 'middle back', 'shoulders', 'biceps', 'triceps', 'abdominals', 'calves'].map((m) => ({ value: m, label: MUSCLES[m] }))], '', { small: true })}
        ${chips('equipment', [{ value: '', label: 'Любой инвентарь' }, ...['body only', 'dumbbell', 'bands', 'kettlebells'].map((m) => ({ value: m, label: EQUIPMENT[m] }))], '', { small: true })}
      </div>
      <div id="lib"></div>
      ${canWrite() ? html`<div class="btn-row"><button class="btn secondary block" id="custom">${icon('plus')} Своё упражнение</button></div>` : ''}`
  );
  const box = root.querySelector('#lib');
  let timer;
  let rows = [];
  const draw = () =>
    load(box, () => api(sp(`/exercises?q=${encodeURIComponent(f.q)}&muscle=${encodeURIComponent(f.muscle)}&equipment=${encodeURIComponent(f.equipment)}`)), (data) => {
      rows = data;
      render(
        box,
        rows.length
          ? html`<div class="list">${rows.map((e) =>
              listRow({
                title: e.name,
                subtitle: [e.name_en && e.name_en !== e.name ? e.name_en : '', e.primary_muscles.map((m) => tr(MUSCLES, m)).join(', '), e.equipment.map((x) => tr(EQUIPMENT, x)).join(', ')].filter(Boolean).join(' · '),
                iconName: 'dumbbell',
                iconCls: 'c-growth',
                action: 'open',
                data: { id: e.id }
              })
            )}</div>`
          : html`<div class="card"><p class="muted">Ничего не найдено</p></div>`
      );
    });
  root.querySelector('#q').addEventListener('input', (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      f.q = e.target.value.trim();
      draw();
    }, 300);
  });
  root.addEventListener('change', (e) => {
    if (!e.detail || !(e.detail.name in f)) return;
    f[e.detail.name] = e.detail.value;
    draw();
  });
  root.addEventListener('click', (e) => {
    const row = e.target.closest('[data-action="open"]');
    if (row) {
      const ex = rows.find((r) => r.id === row.dataset.id);
      if (pickDay) addToDaySheet(ex, programId, pickDay, () => go(`/growth/program/${programId}`, { replace: true }));
      else go(`/growth/exercise/${row.dataset.id}`);
    }
    if (e.target.closest('#custom')) customExerciseSheet((ex) => (pickDay ? addToDaySheet(ex, programId, pickDay, () => go(`/growth/program/${programId}`, { replace: true })) : draw()));
  });
  await draw();
  return { destroy: () => clearTimeout(timer) };
}

function customExerciseSheet(onSaved) {
  formSheet({
    title: 'Своё упражнение',
    fields: [
      { name: 'name', label: 'Название', required: true },
      { name: 'kind', label: 'Тип', type: 'chips', small: true, options: [{ value: 'reps', label: 'Повторы' }, { value: 'timed', label: 'На время' }] },
      { name: 'equipment', label: 'Инвентарь', type: 'multichips', small: true, options: ['body only', 'dumbbell', 'bands', 'kettlebells'].map((v) => ({ value: v, label: EQUIPMENT[v] })) },
      { name: 'primary_muscles', label: 'Мышцы', type: 'multichips', small: true, options: Object.entries(MUSCLES).map(([value, label]) => ({ value, label })) },
      { name: 'instructions', label: 'Как выполнять', type: 'textarea' }
    ],
    values: { kind: 'reps' },
    onSubmit: async (v) => {
      const ex = await api(sp('/exercises'), { method: 'POST', body: v });
      onSaved?.(ex);
    }
  });
}

export function addToDaySheet(ex, programId, dayId, onDone) {
  const timed = ex.kind === 'timed';
  formSheet({
    title: ex.name,
    fields: [
      { name: 'sets', label: 'Подходы', type: 'stepper', min: 1, max: 20 },
      { name: 'target_reps', label: timed ? 'Секунды' : 'Повторы', type: 'stepper', min: 1, max: 1000, step: timed ? 5 : 1 },
      { name: 'load_kg', label: 'Вес, кг (0 — без веса)', type: 'number' }
    ],
    values: { sets: 3, target_reps: timed ? 30 : 12, load_kg: 0 },
    submitText: 'Добавить',
    onSubmit: async (v) => {
      await api(sp(`/programs/${programId}/days/${dayId}/exercises`), { method: 'POST', body: { exercise_id: ex.id, ...v, load_kg: v.load_kg ?? 0 } });
      notify('success');
      onDone?.();
    }
  });
}

export async function exercise(root, { id }) {
  await load(root, () => api(sp(`/exercises/${id}`)), (e) => {
    render(
      root,
      html`<h1 class="screen-title" style="margin-bottom:4px">${e.name}</h1>
        ${e.name_en && e.name_en !== e.name ? html`<p class="screen-sub" style="margin-top:0">${e.name_en}</p>` : ''}
        ${e.images.length ? html`<div class="ex-imgs" style="margin-bottom:12px">${e.images.slice(0, 2).map((src) => html`<img class="ex-img" src="${src}" alt="${e.name}" loading="lazy" />`)}</div>` : ''}
        <div class="card">
          <div class="kv"><span class="k">Мышцы</span><span>${e.primary_muscles.map((m) => tr(MUSCLES, m)).join(', ') || '—'}</span></div>
          ${e.secondary_muscles.length ? html`<div class="kv"><span class="k">Также</span><span>${e.secondary_muscles.map((m) => tr(MUSCLES, m)).join(', ')}</span></div>` : ''}
          <div class="kv"><span class="k">Инвентарь</span><span>${e.equipment.map((x) => tr(EQUIPMENT, x)).join(', ') || '—'}</span></div>
          ${e.level ? html`<div class="kv"><span class="k">Уровень</span><span>${LEVEL[e.level]}</span></div>` : ''}
          <div class="kv"><span class="k">Тип</span><span>${e.kind === 'timed' ? 'На время' : 'Повторы'}</span></div>
        </div>
        ${e.instructions ? html`${sectionTitle('Как выполнять')}<div class="card small" style="white-space:pre-line">${e.instructions}</div>` : ''}
        ${e.source === 'free-exercise-db' ? html`<p class="caption" style="margin:12px 16px">Источник: Free Exercise DB (общественное достояние).</p>` : ''}`
    );
    if (canWrite()) setMainButton('Добавить в программу', () => pickProgramDay(e));
  });
}

async function pickProgramDay(ex) {
  let programs;
  try {
    programs = await api(sp('/programs'));
  } catch (e) {
    toastError(e);
    return;
  }
  if (!programs.length) {
    toast('Сначала создайте программу', 'error');
    return;
  }
  const s = openSheet({
    title: 'Куда добавить',
    body: html`${programs.map(
      (p) => html`<div class="section-title" style="margin-left:0">${p.name}</div><div class="list plain" style="background:var(--fill)">${p.program_days.map((d) =>
        listRow({ title: d.label, action: 'day', data: { p: p.id, d: d.id }, chevron: true })
      )}</div>`
    )}`
  });
  s.el.addEventListener('click', (e) => {
    const r = e.target.closest('[data-action="day"]');
    if (!r) return;
    s.close();
    addToDaySheet(ex, r.dataset.p, r.dataset.d, () => go(`/growth/program/${r.dataset.p}`));
  });
}

