import { api, cached, sp } from '../api.js';
import { query } from '../router.js';
import { canWrite, get } from '../store.js';
import { confirmDialog, notify, setMainButton } from '../tg.js';
import {
  chips, empty, formFields, html, listRow, load, openSheet, plural, readFields, render, toastError, toggle, WEEKDAYS
} from '../ui.js';

export const KINDS = [
  { value: 'workout', label: 'Тренировка', icon: 'dumbbell' },
  { value: 'reading', label: 'Чтение', icon: 'book' },
  { value: 'custom', label: 'Своя цель', icon: 'target' },
  { value: 'pet', label: 'Питомец', icon: 'pet' },
  { value: 'payment', label: 'Платёж', icon: 'calendar' }
];

/** Шторка создания/изменения напоминания. preset — значения по умолчанию для нового. */
export async function reminderSheet(row, preset = {}, onSaved) {
  let programs = [], profiles = [], fixed = [];
  try {
    [programs, profiles, fixed] = await Promise.all([api(sp('/programs')), cached(sp('/profiles')), api(sp('/fixed-costs'))]);
  } catch (e) {
    toastError(e);
    return;
  }
  const v = row || { kind: 'custom', local_time: '20:00', weekdays: [1, 2, 3, 4, 5, 6, 7], ...preset };
  const pets = profiles.filter((p) => p.kind === 'pet');
  const base = [
    { name: 'kind', label: 'Тип', type: 'chips', small: true, options: KINDS },
    { name: 'title', label: 'Текст напоминания', required: true, placeholder: 'Например, 20 страниц книги' },
    { name: 'local_time', label: 'Время', type: 'time', required: true },
    { name: 'weekdays', label: 'Дни недели', type: 'multichips', numeric: true, small: true, options: WEEKDAYS.map((d, i) => ({ value: i + 1, label: d })) }
  ];
  const extra = {
    workout: [
      {
        name: 'program_day',
        label: 'Программа',
        type: 'select',
        options: [
          { value: '', label: '— Без программы —' },
          ...programs.flatMap((p) => [
            { value: `${p.id}|`, label: `${p.name} (по очереди)` },
            ...(p.program_days.length > 1 ? p.program_days.map((d) => ({ value: `${p.id}|${d.id}`, label: `${p.name}: ${d.label}` })) : [])
          ])
        ],
        hint: '«По очереди» — каждый раз следующий день программы'
      }
    ],
    pet: pets.length ? [{ name: 'pet_id', label: 'Питомец', type: 'select', options: [{ value: '', label: '—' }, ...pets.map((p) => ({ value: p.id, label: p.name }))] }] : [],
    payment: [{ name: 'fixed_cost_id', label: 'Платёж', type: 'select', options: [{ value: '', label: '—' }, ...fixed.map((f) => ({ value: f.id, label: f.name }))] }]
  };
  const values = { ...v, program_day: v.program_id ? `${v.program_id}|${v.program_day_id || ''}` : '' };

  const s = openSheet({
    title: row ? 'Напоминание' : 'Новое напоминание',
    body: html`${formFields(base, values)}<div id="extra" style="margin-top:12px"></div>
      <div class="sheet-actions"><button class="btn block" data-save>Сохранить</button>${row ? html`<button class="btn block danger" data-del>Удалить</button>` : ''}</div>
      <p class="caption" style="margin-top:8px">Сообщение придёт от бота с кнопками «Готово», «Через 15 мин» и «Пропустить».</p>`
  });
  const kindNow = () => s.el.querySelector('[data-name="kind"]').dataset.value;
  const drawExtra = () => {
    const f = extra[kindNow()] || [];
    render(s.el.querySelector('#extra'), f.length ? formFields(f, values) : '');
  };
  drawExtra();
  s.el.addEventListener('change', (e) => {
    if (e.detail?.name === 'kind') {
      drawExtra();
      const t = s.el.querySelector('[name="title"]');
      const k = e.detail.value;
      if (!t.value) t.value = { workout: 'Тренировка', reading: 'Чтение', pet: 'Покормить питомца', payment: 'Оплатить' }[k] || '';
    }
  });
  s.el.querySelector('[data-save]').addEventListener('click', async (e) => {
    try {
      const vals = readFields(s.el, base);
      const kind = vals.kind || 'custom';
      const ex = readFields(s.el, extra[kind] || []);
      if (!vals.weekdays.length) throw new Error('Выберите хотя бы один день');
      const [programId, dayId] = (ex.program_day || '|').split('|');
      const body = {
        kind,
        title: vals.title,
        local_time: vals.local_time,
        weekdays: vals.weekdays.sort(),
        program_id: kind === 'workout' ? programId || null : null,
        program_day_id: kind === 'workout' ? dayId || null : null,
        pet_id: kind === 'pet' ? ex.pet_id || null : null,
        fixed_cost_id: kind === 'payment' ? ex.fixed_cost_id || null : null
      };
      e.target.disabled = true;
      await api(row ? sp(`/reminders/${row.id}`) : sp('/reminders'), { method: row ? 'PATCH' : 'POST', body });
      notify('success');
      s.close();
      onSaved?.();
    } catch (err) {
      e.target.disabled = false;
      toastError(err);
    }
  });
  s.el.querySelector('[data-del]')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Удалить напоминание? Серия тоже пропадёт.'))) return;
    try {
      await api(sp(`/reminders/${row.id}`), { method: 'DELETE' });
      s.close();
      onSaved?.();
    } catch (err) {
      toastError(err);
    }
  });
}

export async function reminders(root) {
  let rows = [];
  let mineOnly = true;
  const me = get('me')?.id;
  const draw = () =>
    load(root, () => api(sp('/reminders')), (data) => {
      rows = data;
      const list = mineOnly ? rows.filter((r) => Number(r.owner_tg_id) === Number(me)) : rows;
      render(
        root,
        html`<h1 class="screen-title">Напоминания</h1>
          ${chips('who', [{ value: 'mine', label: 'Мои' }, { value: 'all', label: 'Все в пространстве' }], mineOnly ? 'mine' : 'all', { small: true })}
          ${list.length
            ? html`<div class="list" style="margin-top:12px">${list.map((r) => {
                const k = KINDS.find((x) => x.value === r.kind);
                return listRow({
                  title: html`<span class="num" style="font-weight:600">${r.local_time}</span> ${r.title}`,
                  subtitle: html`${r.weekdays.length === 7 ? 'каждый день' : r.weekdays.map((d) => WEEKDAYS[d - 1]).join(' ')}${r.streak ? html` · <span style="color:var(--c-growth)">🔥 ${r.streak} ${plural(r.streak, 'день', 'дня', 'дней')}</span>` : ''}`,
                  iconName: k?.icon || 'bell',
                  iconCls: r.kind === 'pet' ? 'c-pet' : r.kind === 'payment' ? 'c-money' : 'c-growth',
                  trail: canWrite() && Number(r.owner_tg_id) === Number(me) ? toggle('active', r.active, `data-toggle="${r.id}"`) : '',
                  action: canWrite() ? 'edit' : null,
                  data: { id: r.id },
                  chevron: false
                });
              })}</div>`
            : html`<div class="card" style="margin-top:12px">${empty({ iconName: 'bell', cls: 'c-growth', text: 'Напоминания приходят от бота в Telegram. Добавьте первое — например, тренировку в 20:00.' })}</div>`}
          <p class="caption" style="margin:12px 16px">Время — по вашему часовому поясу. Сообщение приходит в течение минуты после назначенного времени.</p>`
      );
    });

  root.addEventListener('change', async (e) => {
    if (e.detail?.name === 'who') {
      mineOnly = e.detail.value === 'mine';
      draw();
      return;
    }
    const t = e.target.closest?.('[data-toggle]');
    if (t) {
      const r = rows.find((x) => x.id === t.dataset.toggle);
      const prev = r.active;
      r.active = t.checked; // оптимистично
      try {
        await api(sp(`/reminders/${r.id}`), { method: 'PATCH', body: { active: t.checked } });
      } catch (err) {
        r.active = prev;
        t.checked = prev;
        toastError(err);
      }
    }
  });
  root.addEventListener('click', (e) => {
    if (e.target.closest('.toggle')) return;
    const row = e.target.closest('[data-action="edit"]');
    if (row) reminderSheet(rows.find((r) => r.id === row.dataset.id), {}, draw);
  });
  if (canWrite()) setMainButton('Добавить напоминание', () => reminderSheet(null, {}, draw));
  await draw();
  if (query().get('new') === '1' && canWrite()) reminderSheet(null, {}, draw);
}

