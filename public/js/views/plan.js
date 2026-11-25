import { api, invalidate, sp } from '../api.js';
import { icon } from '../icons.js';
import { m1, moneyHtml } from '../money.js';
import { go } from '../router.js';
import { canWrite } from '../store.js';
import { confirmDialog, notify, setMainButton } from '../tg.js';
import {
  chips, delegate, empty, fmt, fmtDate, html, load, plural, progressBar, qty, render, sectionTitle, segmented,
  tierBadge, TIER_LABEL, toast, toastError
} from '../ui.js';

const TIER_HINT = {
  cheap: 'Минимальная стоимость при выполнении КБЖУ',
  middle: 'Больше разнообразия: не меньше 8 продуктов, без перекоса в один',
  top: 'Максимум качественных продуктов, бюджет до ×2,2 от дешёвого'
};

function roundQty(it) {
  if (it.unit === 'pcs') return qty(Math.max(0.5, Math.round(it.qty * 2) / 2), 'pcs');
  return qty(Math.max(5, Math.round(it.grams / 5) * 5), it.unit);
}

function macroLine(day, t) {
  const cls = (v, target, tol) => (Math.abs(v - target) <= target * tol ? '' : 'warn');
  return html`<span class="${cls(day.kcal, t.kcal, 0.03)}">Ккал ${fmt(day.kcal)}</span> · <span class="${day.protein >= t.protein * 0.95 ? '' : 'warn'}">Б ${fmt(day.protein)}</span> · <span class="${cls(day.fat, t.fat, 0.15)}">Ж ${fmt(day.fat)}</span> · <span class="${cls(day.carbs, t.carbs, 0.15)}">У ${fmt(day.carbs)}</span>`;
}

/** Карточка одного варианта плана. */
function planBody(plan, personIdx) {
  const persons = plan.targets.persons;
  const person = persons[Math.min(personIdx, persons.length - 1)];
  const sumDay = persons.reduce(
    (a, p) => ({ kcal: a.kcal + p.day.kcal, protein: a.protein + p.day.protein, fat: a.fat + p.day.fat, carbs: a.carbs + p.day.carbs }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 }
  );
  const sumT = persons.reduce(
    (a, p) => ({ kcal: a.kcal + p.targets.kcal, protein: a.protein + p.targets.protein, fat: a.fat + p.targets.fat, carbs: a.carbs + p.targets.carbs }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 }
  );
  const comp = plan.targets.store_comparison || [];
  const warnings = [...(plan.targets.warnings || []), ...persons.flatMap((p) => p.warnings.map((w) => (persons.length > 1 ? `${p.name}: ${w}` : w)))];
  const errors = persons.filter((p) => !p.ok);
  const items = plan.items.filter((i) => i.profile_id === person.profile_id);

  return html`<div class="card">
      <div class="row between" style="align-items:flex-start">
        <div class="stat"><div class="hero">${moneyHtml(plan.total_minor)}</div>
          <div class="sub">${m1(plan.total_minor / plan.days)} в день · ${plan.days} ${plural(plan.days, 'день', 'дня', 'дней')}</div></div>
        ${tierBadge(plan.tier)}
      </div>
      <div class="small" style="margin-top:10px">${macroLine(sumDay, sumT)}</div>
      <div class="caption">Цель: ${fmt(sumT.kcal)} ккал · Б ${fmt(sumT.protein)} · Ж ${fmt(sumT.fat)} · У ${fmt(sumT.carbs)}${persons.length > 1 ? ' (на всех)' : ''}</div>
      ${comp.length
        ? html`<div class="store-compare">${comp.map((c, i) => html`<span class="${i === 0 ? 'best' : ''}">${c.name}: ${m1(c.total_minor)}</span>`)}</div>`
        : ''}
      <p class="caption" style="margin-top:8px">${TIER_HINT[plan.tier]}</p>
    </div>
    ${errors.map((p) => html`<div class="notice bad" style="margin-top:12px"><b>${p.name}:</b> ${p.error}</div>`)}
    ${warnings.map((w) => html`<div class="notice warn" style="margin-top:12px">${w}</div>`)}
    ${persons.length > 1
      ? html`<div style="margin-top:16px">${chips('person', persons.map((p, i) => ({ value: i, label: p.name })), String(personIdx), { small: true })}</div>`
      : ''}
    ${person.ok
      ? html`<div class="card" style="margin-top:12px">
          ${person.meals.map((m) => {
            const mi = items.filter((i) => i.meal_no === m.meal_no);
            return html`<div class="meal">
              <div class="meal-head"><span class="meal-no">${m.meal_no}</span><span class="meal-name">${m.label}</span><span class="meal-kcal num">${fmt(m.kcal)} / ${fmt(m.target_kcal)} ккал</span></div>
              <div class="meal-items">${mi.length ? mi.map((i, k) => html`${k ? ' · ' : ''}${i.name} ${roundQty(i)}`) : html`<span class="muted">—</span>`}</div>
              <div class="caption" style="padding-left:30px">Б ${fmt(m.protein)} · Ж ${fmt(m.fat)} · У ${fmt(m.carbs)}</div>
            </div>`;
          })}
          <div class="caption" style="margin-top:8px">${persons.length > 1 ? person.name + ': ' : ''}${fmt(person.day.kcal)} из ${fmt(person.targets.kcal)} ккал · ${m1(person.daily_cost_minor)} в день</div>
        </div>`
      : ''}`;
}

export async function planBatch(root, { batchId }) {
  let tier = 'cheap';
  let personIdx = 0;
  let plans = [];

  const draw = () => {
    const plan = plans.find((p) => p.tier === tier) || plans[0];
    render(
      root,
      html`<div class="row between" style="margin-bottom:12px"><h1 class="screen-title" style="margin:0">Результат</h1><span class="muted">${plan.days} ${plural(plan.days, 'день', 'дня', 'дней')}</span></div>
        ${segmented('tier', plans.map((p) => ({ value: p.tier, label: TIER_LABEL[p.tier] })), tier)}
        <div class="row" style="gap:6px;margin:-4px 0 12px;justify-content:space-around">${plans.map((p) => html`<span class="caption num">${m1(p.total_minor)}</span>`)}</div>
        ${planBody(plan, personIdx)}`
    );
    if (canWrite() && plan.targets.persons.some((p) => p.ok)) {
      setMainButton('Сделать активным', async () => {
        try {
          await api(sp(`/meal-plans/${plan.id}/activate`), { method: 'POST', body: {} });
          invalidate();
          notify('success');
          toast('План активирован', 'success');
          go(`/food/plan/${plan.id}`, { replace: true });
        } catch (e) {
          toastError(e);
        }
      });
    }
  };
  root.addEventListener('segchange', (e) => {
    if (e.detail.name === 'tier') {
      tier = e.detail.value;
      draw();
    }
  });
  root.addEventListener('change', (e) => {
    if (e.detail?.name === 'person') {
      personIdx = Number(e.detail.value);
      draw();
    }
  });
  await load(root, () => api(sp(`/meal-plans/batch/${batchId}`)), (data) => {
    plans = data;
    draw();
  }, { skeletonRows: 8 });
}

export async function planView(root, { id }) {
  let personIdx = 0;
  let plan;
  const off = delegate(root, {
    go: (el) => go(el.dataset.to),
    activate: async () => {
      try {
        await api(sp(`/meal-plans/${id}/activate`), { method: 'POST', body: {} });
        notify('success');
        reloadPlan();
      } catch (e) {
        toastError(e);
      }
    },
    del: async () => {
      if (!(await confirmDialog('Удалить план? Отметки списка покупок тоже удалятся.'))) return;
      try {
        await api(sp(`/meal-plans/${id}`), { method: 'DELETE' });
        go('/food', { replace: true });
      } catch (e) {
        toastError(e);
      }
    }
  });
  const draw = () => {
    const STATUS = { active: 'Активный', draft: 'Черновик', done: 'Завершён' };
    render(
      root,
      html`<h1 class="screen-title" style="margin-bottom:4px">План питания</h1>
        <p class="screen-sub" style="margin-top:0">${STATUS[plan.status]} · с ${fmtDate(plan.start_on).toLowerCase()}</p>
        ${planBody(plan, personIdx)}
        <div class="list" style="margin-top:12px">
          <div class="list-row" data-action="go" data-to="/food/plan/${id}/list"><div class="icon-chip c-food">${icon('cart')}</div><div class="body"><div class="title">Список покупок</div></div>${icon('chevron', 'chev')}</div>
          <div class="list-row" data-action="go" data-to="/food/plan/${id}/check"><div class="icon-chip c-money">${icon('chart')}</div><div class="body"><div class="title">План против факта</div></div>${icon('chevron', 'chev')}</div>
        </div>
        ${canWrite()
          ? html`<div class="btn-row">${plan.status !== 'active' ? html`<button class="btn secondary" data-action="activate">Сделать активным</button>` : ''}<button class="btn danger" data-action="del">${icon('trash')} Удалить</button></div>`
          : ''}`
    );
  };
  root.addEventListener('change', (e) => {
    if (e.detail?.name === 'person') {
      personIdx = Number(e.detail.value);
      draw();
    }
  });
  const reloadPlan = () => load(root, () => api(sp(`/meal-plans/${id}`)), (p) => {
    plan = p;
    draw();
  }, { skeletonRows: 8 });
  await reloadPlan();
  return { destroy: off };
}

export async function planCheck(root, { id }) {
  await load(root, () => api(sp(`/meal-plans/${id}/check`)), (c) => {
    const moneyPct = c.money.planned > 0 ? Math.round((c.money.grocery_spent / c.money.planned) * 100) : 0;
    render(
      root,
      html`<h1 class="screen-title" style="margin-bottom:4px">План против факта</h1>
        <p class="screen-sub" style="margin-top:0">${fmtDate(c.start_on)} — ${fmtDate(c.end_on)}</p>
        <div class="card">
          <div class="stat"><div class="label">Куплено</div><div class="hero">${c.pct}% плана</div>
          <div class="sub">${c.done_count} из ${c.total_count} ${plural(c.total_count, 'позиции', 'позиций', 'позиций')} куплены полностью</div></div>
          <div style="margin-top:10px">${progressBar(c.pct, 'var(--c-food)')}</div>
        </div>
        ${sectionTitle('Деньги')}
        <div class="card">
          <div class="kv"><span class="k">По плану</span><span class="num">${m1(c.money.planned)}</span></div>
          <div class="kv"><span class="k">Потрачено на продукты</span><span class="num ${moneyPct > 110 ? 'bad' : ''}">${m1(c.money.grocery_spent)} (${moneyPct}%)</span></div>
          ${c.money.unlinked ? html`<div class="kv"><span class="k">Без позиций</span><span class="num">${m1(c.money.unlinked)}</span></div>` : ''}
          <p class="caption" style="margin-top:6px">Покупки без привязки к продуктам учитываются только в деньгах.</p>
        </div>
        ${c.items.length
          ? html`${sectionTitle('По продуктам')}
            <div class="card">${c.items.map(
              (it) => html`<div style="padding:8px 0">
                <div class="row between small"><span class="ellipsis">${it.name}</span><span class="num muted">${qty(it.bought, it.unit)} / ${qty(it.planned, it.unit)}</span></div>
                <div style="margin-top:4px">${progressBar(it.pct, it.pct >= 90 ? 'var(--ok)' : it.pct > 0 ? 'var(--warn)' : 'var(--fill)')}</div>
              </div>`
            )}</div>`
          : html`<div class="card">${empty({ iconName: 'chart', text: 'В плане нет продуктов' })}</div>`}
        ${c.unplanned.length
          ? html`${sectionTitle('Не по плану')}
            <div class="list plain">${c.unplanned.map(
              (u) => html`<div class="list-row no-icon"><div class="body"><div class="title">${u.name}</div><div class="subtitle">${qty(u.qty, u.unit)}</div></div><div class="trail num">${m1(u.money)}</div></div>`
            )}</div>`
          : ''}`
    );
  }, { skeletonRows: 8 });
}
