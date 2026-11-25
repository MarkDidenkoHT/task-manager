import { api, invalidate, sp } from '../api.js';
import { icon } from '../icons.js';
import { m1 } from '../money.js';
import { back, go, query } from '../router.js';
import { canWrite, get } from '../store.js';
import { confirmDialog, notify, setMainButton } from '../tg.js';
import {
  delegate, fmt, fmtDate, formFields, formSheet, html, listRow, load, readFields, render, sectionTitle, sparkline,
  toast, toastError, todayStr
} from '../ui.js';

const KIND = { adult: 'Взрослый', child: 'Ребёнок', pet: 'Питомец' };
const ACTIVITY = [
  { value: 1.2, label: 'Сидячий образ жизни' },
  { value: 1.375, label: 'Лёгкая активность (1–3 тренировки)' },
  { value: 1.55, label: 'Умеренная (3–5 тренировок)' },
  { value: 1.725, label: 'Высокая (6–7 тренировок)' },
  { value: 1.9, label: 'Очень высокая (физический труд)' }
];
const GOALS = [
  { value: -400, label: 'Похудение (−400)' },
  { value: 0, label: 'Поддержание' },
  { value: 300, label: 'Набор (+300)' }
];

/** Полных лет по дате рождения. */
function ageFrom(birth) {
  if (!birth) return null;
  const [y, m, d] = String(birth).slice(0, 10).split('-').map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now < new Date(now.getFullYear(), m - 1, d)) age--;
  return age;
}

/** Дата рождения из возраста: сегодня минус N лет — возраст будет расти сам. */
function birthFromAge(age) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function checkAge(age, kind) {
  if (age == null) return;
  const max = kind === 'child' ? 17 : 120;
  const min = kind === 'child' ? 0 : 14;
  if (!Number.isInteger(age) || age < min || age > max) throw new Error(`Возраст: целое число от ${min} до ${max}`);
}

/** Расчёт целей на клиенте — та же формула, что на сервере (для живого предпросмотра). */
function previewTargets(v, kind) {
  if (kind === 'child') {
    if (!v.kcal_override) return null;
    const k = v.kcal_override;
    return { kcal: k, protein: (k * 0.15) / 4, fat: (k * 0.3) / 9, carbs: (k * 0.55) / 4 };
  }
  const kg = v.weight_kg;
  let kcal = v.kcal_override;
  if (!kcal) {
    const age = v.age;
    if (!(kg && v.height_cm && age && v.sex)) return null;
    const bmr = 10 * kg + 6.25 * v.height_cm - 5 * age + (v.sex === 'm' ? 5 : -161);
    kcal = bmr * (v.activity || 1.375) + (v.goal_offset_kcal || 0);
  }
  const protein = kg ? (v.protein_g_per_kg ?? 1.8) * kg : (kcal * 0.25) / 4;
  const fat = kg ? (v.fat_g_per_kg ?? 0.9) * kg : (kcal * 0.3) / 9;
  return { kcal, protein, fat, carbs: Math.max(0, (kcal - 4 * protein - 9 * fat) / 4) };
}

export async function people(root) {
  const off = delegate(root, {
    go: (el) => go(el.dataset.to),
    add: (el) => go(`/more/person/new?kind=${el.dataset.kind}`)
  });
  await load(root, () => Promise.all([api(sp('/profiles')), api(sp('/summary'))]), ([rows, summary]) => {
    const group = (k) => rows.filter((r) => r.kind === k);
    const section = (k, title, ic, cls) => html`${sectionTitle(title, canWrite() ? html`<button class="action" data-action="add" data-kind="${k}">${icon('plus')} Добавить</button>` : '')}
      ${group(k).length
        ? html`<div class="list">${group(k).map((p) => {
            const pet = summary.pets.find((x) => x.id === p.id);
            return listRow({
              title: html`${p.name}${p.active ? '' : html` <span class="badge">выкл.</span>`}${Number(p.tg_id) === Number(get('me')?.id) ? html` <span class="badge accent">это вы</span>` : ''}`,
              subtitle:
                k === 'pet'
                  ? `${p.species || 'Питомец'} · ${m1((pet?.spent_month || 0) + (pet?.fixed_month || 0))} в этом месяце`
                  : p.targets
                    ? `${fmt(p.targets.kcal)} ккал · Б ${fmt(p.targets.protein)} · Ж ${fmt(p.targets.fat)} · У ${fmt(p.targets.carbs)} · ${p.meals_per_day} приёма`
                    : k === 'child' ? 'Укажите калорийность' : 'Заполните данные для расчёта',
              iconName: ic,
              iconCls: cls,
              action: 'go',
              data: { to: `/more/person/${p.id}` }
            });
          })}</div>`
        : html`<div class="card"><p class="muted small">Пока никого</p></div>`}`;
    render(
      root,
      html`<h1 class="screen-title">Люди и питомцы</h1>
        ${section('adult', 'Взрослые', 'user', 'c-food')}
        ${section('child', 'Дети', 'child', 'c-food')}
        ${section('pet', 'Питомцы', 'pet', 'c-pet')}`
    );
  });
  return { destroy: off };
}

export async function person(root, { id }) {
  const isNew = id === 'new';
  const kindQ = query().get('kind') || 'adult';
  await load(root, async () => {
    const rows = await api(sp('/profiles'));
    const p = isNew ? null : rows.find((r) => r.id === id);
    if (!isNew && !p) throw new Error('Профиль не найден');
    const weights = !isNew && p.kind === 'adult' ? await api(sp(`/profiles/${id}/weight`)) : [];
    return { p, weights };
  }, ({ p, weights }) => {
    const kind = p?.kind || kindQ;
    const v = p || { kind, meals_per_day: 3, activity: 1.375, goal_offset_kcal: 0, protein_g_per_kg: 1.8, fat_g_per_kg: 0.9, active: true };
    const fields =
      kind === 'pet'
        ? [
            { name: 'name', label: 'Кличка', required: true },
            { name: 'species', label: 'Вид', placeholder: 'Кошка, собака…' },
            { name: 'active', label: 'Активен', type: 'toggle' }
          ]
        : kind === 'child'
          ? [
              { name: 'name', label: 'Имя', required: true },
              { name: 'age', label: 'Возраст, лет', type: 'number', inputmode: 'numeric', placeholder: 'Например, 6' },
              { name: 'kcal_override', label: 'Калорий в день', type: 'number', inputmode: 'numeric', required: true, hint: 'Укажите по рекомендации врача или официальным нормам для возраста' },
              { name: 'meals_per_day', label: 'Приёмов пищи в день', type: 'stepper', min: 1, max: 6 },
              { name: 'active', label: 'Участвует в планах', type: 'toggle' }
            ]
          : [
              { name: 'name', label: 'Имя', required: true },
              { name: 'sex', label: 'Пол', type: 'chips', small: true, options: [{ value: 'm', label: 'Мужской' }, { value: 'f', label: 'Женский' }] },
              { name: 'age', label: 'Возраст, лет', type: 'number', inputmode: 'numeric', placeholder: '30' },
              { name: 'height_cm', label: 'Рост, см', type: 'number', inputmode: 'numeric', placeholder: '175' },
              { name: 'weight_kg', label: 'Вес, кг', type: 'number', placeholder: '70' },
              { name: 'activity', label: 'Активность', type: 'select', numeric: true, options: ACTIVITY },
              { name: 'meals_per_day', label: 'Приёмов пищи в день', type: 'stepper', min: 1, max: 6 },
              { name: 'is_me', label: 'Это мой профиль', type: 'toggle' },
              { name: 'active', label: 'Участвует в планах', type: 'toggle' }
            ];
    const wasMe = !!p && Number(p.tg_id) === Number(get('me')?.id);
    v.is_me = wasMe;
    v.age = ageFrom(v.birth_date);
    const goalFields = kind === 'adult'
      ? [
          { name: 'goal_offset_kcal', label: 'Поправка к калориям, ккал', type: 'number', inputmode: 'numeric', hint: 'Отрицательная — похудение, положительная — набор' },
          { name: 'kcal_override', label: 'Калории вручную (вместо формулы)', type: 'number', inputmode: 'numeric' },
          { name: 'protein_g_per_kg', label: 'Белок, г на кг веса', type: 'number' },
          { name: 'fat_g_per_kg', label: 'Жиры, г на кг веса', type: 'number' }
        ]
      : [];
    const all = [...fields, ...goalFields];

    render(
      root,
      html`<h1 class="screen-title">${isNew ? `Новый профиль: ${KIND[kind].toLowerCase()}` : v.name}</h1>
        ${kind !== 'pet' ? html`<div class="card target-preview" id="preview"></div>` : ''}
        <div style="margin-top:12px">${formFields(fields, v)}</div>
        ${kind === 'adult'
          ? html`${sectionTitle('Цель')}
            <div class="chips wrap" style="margin-bottom:12px">${GOALS.map((g) => html`<button class="chip small ${Number(v.goal_offset_kcal) === g.value ? 'on' : ''}" data-goal="${g.value}">${g.label}</button>`)}</div>
            ${formFields(goalFields, v)}`
          : ''}
        ${kind === 'child' ? html`<div class="notice" style="margin-top:12px">Формулы для взрослых не подходят детям. Калорийность задаёт родитель по совету педиатра или официальным нормам; БЖУ распределяются 15/30/55%. Это не медицинская рекомендация.</div>` : ''}
        ${kind === 'adult' && !isNew
          ? html`${sectionTitle('Вес', canWrite() ? html`<button class="action" id="add-w">${icon('plus')} Записать</button>` : '')}
            <div class="card">${weights.length > 1 ? sparkline(weights.map((w) => Number(w.weight_kg)), { color: 'var(--c-food)' }) : ''}
              ${weights.length ? html`<div class="caption">${weights.slice(-5).reverse().map((w) => `${fmtDate(w.logged_on)}: ${fmt(w.weight_kg, 1)} кг`).join(' · ')}</div>` : html`<p class="muted small">Записей пока нет. Вес в журнале не меняет цели автоматически.</p>`}
            </div>`
          : ''}
        ${!isNew && canWrite() ? html`<div class="btn-row"><button class="btn danger" id="del">${icon('trash')} Удалить профиль</button></div>` : ''}`
    );

    const drawPreview = () => {
      const box = root.querySelector('#preview');
      if (!box) return;
      let vals;
      try {
        vals = readFields(root, all.map((f) => ({ ...f, required: false })));
      } catch {
        return;
      }
      const t = previewTargets(vals, kind);
      render(
        box,
        t
          ? html`<div class="stat"><div class="label">Цель в день</div><div class="hero md num">${fmt(t.kcal)} <span class="muted" style="font-size:16px;font-weight:500;letter-spacing:0">ккал</span></div></div>
            <div class="macro-row"><div><div class="l">Белки</div><div class="v num">${fmt(t.protein)} г</div></div><div><div class="l">Жиры</div><div class="v num">${fmt(t.fat)} г</div></div><div><div class="l">Углеводы</div><div class="v num">${fmt(t.carbs)} г</div></div></div>`
          : html`<div class="empty-hint"><div class="icon-chip c-food">${icon('target')}</div><span>${kind === 'child' ? 'Укажите калорийность — покажем БЖУ.' : 'Пол, возраст, рост и вес — и цель рассчитается по формуле Миффлина — Сан-Жеора.'}</span></div>`
      );
    };
    drawPreview();
    root.addEventListener('input', drawPreview);
    root.addEventListener('change', drawPreview);
    root.addEventListener('click', async (e) => {
      const g = e.target.closest('[data-goal]');
      if (g) {
        root.querySelectorAll('[data-goal]').forEach((b) => b.classList.toggle('on', b === g));
        root.querySelector('[name="goal_offset_kcal"]').value = g.dataset.goal;
        drawPreview();
      }
      if (e.target.closest('#add-w')) {
        formSheet({
          title: 'Вес',
          fields: [
            { name: 'weight_kg', label: 'Вес, кг', type: 'number', required: true },
            { name: 'logged_on', label: 'Дата', type: 'date' }
          ],
          values: { weight_kg: v.weight_kg, logged_on: todayStr() },
          onSubmit: async (w) => {
            await api(sp(`/profiles/${id}/weight`), { method: 'POST', body: { weight_kg: w.weight_kg, logged_on: w.logged_on || undefined } });
            notify('success');
            invalidate(sp('/profiles'));
            go(`/more/person/${id}`, { replace: true });
          }
        });
      }
      if (e.target.closest('#del')) {
        if (!(await confirmDialog(`Удалить профиль «${v.name}»? Он пропадёт из планов питания.`))) return;
        try {
          await api(sp(`/profiles/${id}`), { method: 'DELETE' });
          invalidate(sp('/profiles'));
          toast('Профиль удалён');
          back('/more/people');
        } catch (err) {
          toastError(err);
        }
      }
    });

    if (canWrite()) {
      setMainButton('Сохранить', async () => {
        try {
          const vals = readFields(root, all);
          const { is_me: isMe, age, ...rest } = vals;
          const body = { ...rest, kind };
          if (kind !== 'pet') {
            checkAge(age, kind);
            // Возраст не меняли — дату рождения не трогаем (иначе сдвинется день рождения).
            if (age == null) body.birth_date = null;
            else if (age !== ageFrom(v.birth_date)) body.birth_date = birthFromAge(age);
          }
          if (kind === 'adult' && isMe !== wasMe) body.tg_id = isMe ? get('me')?.id : null;
          if (kind === 'adult') {
            body.goal_offset_kcal = Math.round(vals.goal_offset_kcal || 0);
            body.kcal_override = vals.kcal_override ? Math.round(vals.kcal_override) : null;
          }
          if (kind === 'child') body.kcal_override = Math.round(vals.kcal_override);
          await api(isNew ? sp('/profiles') : sp(`/profiles/${id}`), { method: isNew ? 'POST' : 'PATCH', body });
          invalidate(sp('/profiles'));
          notify('success');
          toast('Сохранено', 'success');
          back('/more/people');
        } catch (e) {
          toastError(e);
        }
      });
    }
  });
}

