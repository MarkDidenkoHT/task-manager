import { api, sp } from '../api.js';
import { icon } from '../icons.js';
import { moneyHtml, m1 } from '../money.js';
import { go } from '../router.js';
import { header, headerHandlers, setFab } from '../shell.js';
import { canWrite } from '../store.js';
import { notify } from '../tg.js';
import { delegate, fmt, html, load, plural, progressBar, render, ring, sectionTitle, tierBadge, toastError } from '../ui.js';
import { openPurchaseSheet } from './purchase.js';

export async function home(root) {
  const off = delegate(root, {
    ...headerHandlers,
    'go': (el) => go(el.dataset.to),
    'mark-reminder': async (el) => {
      try {
        await api(sp(`/reminders/${el.dataset.id}/mark`), { method: 'POST', body: { status: 'done' } });
        notify('success');
        draw();
      } catch (e) {
        toastError(e);
      }
    }
  });

  setFab([
    { label: 'Покупка', hint: 'Записать расход', icon: 'receipt', cls: 'c-money', run: () => openPurchaseSheet({ onSaved: draw }) },
    { label: 'Новый план питания', hint: 'Три варианта с ценами', icon: 'food', cls: 'c-food', run: () => go('/food?new=1') },
    { label: 'Напоминание', icon: 'bell', cls: 'c-growth', run: () => go('/growth/reminders?new=1') }
  ]);

  async function draw() {
    await load(root, () => api(sp('/home')), (d) => render(root, view(d)), { skeletonRows: 6 });
  }
  await draw();
  return { destroy: off };
}

function view(d) {
  const b = d.budget;
  const spentPct = b.free > 0 ? Math.round((b.spent.total / b.free) * 100) : 0;
  const barColor = spentPct > 100 ? 'var(--bad)' : spentPct > 85 ? 'var(--warn)' : 'var(--c-money)';
  return html`${header()}
    ${sectionTitle('Деньги в этом месяце')}
    <div class="card tap" data-action="go" data-to="/budget">
      <div class="stat">
        <div class="label">Осталось</div>
        <div class="hero ${b.remaining < 0 ? 'bad' : ''}">${moneyHtml(b.remaining)}</div>
      </div>
      <div style="margin-top:12px">${progressBar(spentPct, barColor)}</div>
      <div class="row between caption" style="margin-top:6px">
        <span>Потрачено ${m1(b.spent.total)} из ${m1(b.free)}</span><span>${spentPct}% бюджета</span>
      </div>
    </div>

    ${sectionTitle('Сегодня')}
    ${todayCard(d.me)}

    ${d.reminders.length
      ? html`<div class="grid2" style="margin-top:12px">${d.reminders.map(reminderCard)}</div>`
      : html`<div class="card tap" data-action="go" data-to="/growth/reminders" style="margin-top:12px">
          <div class="row"><div class="icon-chip c-growth">${icon('bell')}</div><div class="grow">Добавьте напоминание о тренировке или чтении</div>${icon('chevron', 'chev')}</div>
        </div>`}

    ${sectionTitle('План питания')}
    ${planCard(d.plan)}`;
}

function todayCard(me) {
  if (!me || !me.targets) {
    return html`<div class="card tap" data-action="go" data-to="${me ? '/more/person/' + me.id : '/more/people'}">
      <div class="row"><div class="icon-chip c-food">${icon('target')}</div>
      <div class="grow"><div>Заполните профиль</div><div class="caption">Пол, возраст, рост и вес — чтобы рассчитать калории и БЖУ</div></div>${icon('chevron', 'chev')}</div>
    </div>`;
  }
  const t = me.targets;
  const p = me.planned;
  return html`<div class="card today-card tap" data-action="go" data-to="/more/person/${me.id}">
    <div class="lines">
      <div class="row between"><span class="muted">Калории</span><span class="num">${p ? fmt(p.kcal) + ' / ' : ''}${fmt(t.kcal)}</span></div>
      <div class="row between"><span class="muted">Белок</span><span class="num">${p ? fmt(p.protein) + ' / ' : ''}${fmt(t.protein)} г</span></div>
      <div class="row between"><span class="muted">Жиры · Углеводы</span><span class="num">${fmt(t.fat)} · ${fmt(t.carbs)} г</span></div>
      <div class="caption" style="margin-top:4px">${p ? 'По плану питания / цель' : 'Цель на день'}</div>
    </div>
    ${ring(p ? p.kcal : 0, t.kcal)}
  </div>`;
}

function reminderCard(r) {
  const done = r.today_status === 'done';
  return html`<div class="card reminder-card ${done ? 'done' : ''}">
    <div class="row between"><span class="time num">${r.local_time}</span>
      ${canWrite() && !done ? html`<button class="icon-btn" style="width:32px;height:32px" data-action="mark-reminder" data-id="${r.id}" aria-label="Отметить выполненным">${icon('check')}</button>` : done ? html`<span class="ok">${icon('check')}</span>` : ''}
    </div>
    <div class="ellipsis">${r.title}</div>
    <div class="streak">${r.streak ? html`${icon('flame')} серия ${r.streak} ${plural(r.streak, 'день', 'дня', 'дней')}` : html`<span class="muted">серия не начата</span>`}</div>
  </div>`;
}

function planCard(plan) {
  if (!plan) {
    return html`<div class="card tap" data-action="go" data-to="/food?new=1">
      <div class="row"><div class="icon-chip c-food">${icon('food')}</div>
      <div class="grow"><div>Составить план питания</div><div class="caption">Три варианта: дёшево, средний, премиум — с ценами по магазинам</div></div>${icon('chevron', 'chev')}</div>
    </div>`;
  }
  const c = plan.check;
  return html`<div class="card tap" data-action="go" data-to="/food/plan/${plan.id}/check">
    <div class="row between">
      <div class="row">${tierBadge(plan.tier)}<span>${plan.days} ${plural(plan.days, 'день', 'дня', 'дней')}</span></div>
      <span class="num" style="font-weight:600">${m1(plan.total_minor)}</span>
    </div>
    <div class="row between" style="margin-top:10px">
      <span class="muted">Куплено ${c.done_count} из ${c.total_count} ${plural(c.total_count, 'позиции', 'позиций', 'позиций')}</span>${icon('chevron', 'chev')}
    </div>
    <div style="margin-top:8px">${progressBar(c.pct, 'var(--c-food)')}</div>
  </div>`;
}
