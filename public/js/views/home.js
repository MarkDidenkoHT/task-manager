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

  const WD = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];
  const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const now = new Date();
  render(root, html`${header(`${now.getDate()} ${MON[now.getMonth()]}`, WD[now.getDay()])}<div id="home-body"></div>`);
  const body = root.querySelector('#home-body');

  async function draw() {
    await load(body, () => api(sp('/home')), (d) => render(body, view(d)), { skeletonRows: 4 });
  }
  await draw();
  return { destroy: off };
}

function view(d) {
  const b = d.budget;
  const spentPct = b.free > 0 ? Math.round((b.spent.total / b.free) * 100) : 0;
  const barColor = spentPct > 100 ? 'var(--bad)' : spentPct > 85 ? 'var(--warn)' : 'var(--c-money)';
  return html`<div class="card tap money-card" data-action="go" data-to="/budget">
      <div class="stat">
        <div class="label">Осталось в этом месяце</div>
        <div class="hero ${b.remaining < 0 ? 'bad' : ''}">${moneyHtml(b.remaining)}</div>
      </div>
      ${progressBar(spentPct, barColor)}
      <div class="meta"><span>Потрачено ${m1(b.spent.total)} из ${m1(b.free)}</span><span class="num">${spentPct}%</span></div>
    </div>

    ${sectionTitle('Питание сегодня')}
    ${todayCard(d.me)}

    ${sectionTitle('Привычки', html`<button class="action" data-action="go" data-to="/growth/reminders">Все</button>`)}
    ${d.reminders.length
      ? html`<div class="grid2">${d.reminders.map(reminderCard)}</div>`
      : html`<div class="list">${linkRow('bell', 'c-growth', 'Добавить напоминание', 'Тренировка, чтение или своя цель', '/growth/reminders')}</div>`}

    ${sectionTitle('План питания')}
    ${planCard(d.plan)}`;
}

function linkRow(ic, cls, title, sub, to) {
  return html`<div class="list-row" data-action="go" data-to="${to}" role="button" tabindex="0">
    <div class="icon-chip ${cls}">${icon(ic)}</div>
    <div class="body"><div class="title">${title}</div><div class="subtitle">${sub}</div></div>
    <div class="trail">${icon('chevron', 'chev')}</div>
  </div>`;
}

function todayCard(me) {
  if (!me || !me.targets) {
    return html`<div class="list">${linkRow('target', 'c-food', 'Заполните профиль', 'Пол, возраст, рост и вес — для расчёта калорий и БЖУ', me ? '/more/person/' + me.id : '/more/people')}</div>`;
  }
  const t = me.targets;
  const p = me.planned;
  const cell = (l, plan, target) => html`<div><div class="l">${l}</div><div class="v num">${plan != null ? fmt(plan) + ' / ' : ''}${fmt(target)} г</div></div>`;
  return html`<div class="card tap" data-action="go" data-to="/more/person/${me.id}">
    <div class="today-card">
      <div class="lines stat">
        <div class="label">${p ? 'По плану / цель' : 'Цель на день'}</div>
        <div class="hero md num">${p ? fmt(p.kcal) + ' / ' : ''}${fmt(t.kcal)} <span class="muted" style="font-size:16px;font-weight:500;letter-spacing:0">ккал</span></div>
      </div>
      ${ring(p ? p.kcal : 0, t.kcal, { size: 76, stroke: 8 })}
    </div>
    <div class="macro-row">
      ${cell('Белки', p ? p.protein : null, t.protein)}
      ${cell('Жиры', p ? p.fat : null, t.fat)}
      ${cell('Углеводы', p ? p.carbs : null, t.carbs)}
    </div>
  </div>`;
}

function reminderCard(r) {
  const done = r.today_status === 'done';
  return html`<div class="card reminder-card ${done ? 'done' : ''}">
    <div class="row between"><span class="time num">${r.local_time}</span>
      ${canWrite() && !done
        ? html`<button class="mark" data-action="mark-reminder" data-id="${r.id}" aria-label="Отметить выполненным">${icon('check')}</button>`
        : html`<span class="mark" aria-hidden="true">${icon('check')}</span>`}
    </div>
    <div class="title ellipsis">${r.title}</div>
    <div class="streak">${r.streak ? html`${icon('flame')} ${r.streak} ${plural(r.streak, 'день', 'дня', 'дней')} подряд` : html`<span class="muted">серия не начата</span>`}</div>
  </div>`;
}

function planCard(plan) {
  if (!plan) {
    return html`<div class="list">${linkRow('food', 'c-food', 'Составить план питания', 'Дёшево, средний, премиум — с ценами по магазинам', '/food?new=1')}</div>`;
  }
  const c = plan.check;
  return html`<div class="card tap" data-action="go" data-to="/food/plan/${plan.id}/check">
    <div class="row between">
      <div class="row">${tierBadge(plan.tier)}<span class="muted small">${plan.days} ${plural(plan.days, 'день', 'дня', 'дней')}</span></div>
      <span class="num" style="font-weight:650">${m1(plan.total_minor)}</span>
    </div>
    <div class="row between" style="margin-top:14px">
      <span class="small">Куплено ${c.done_count} из ${c.total_count}</span><span class="caption num">${Math.round(c.pct)}%</span>
    </div>
    <div style="margin-top:8px">${progressBar(c.pct, 'var(--c-food)')}</div>
  </div>`;
}
