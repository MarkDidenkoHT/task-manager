import { api, sp } from './api.js';
import { onRoute, route, start } from './router.js';
import { clearFab, renderTabbar } from './shell.js';
import { get, set } from './store.js';
import { cloudGet, cloudSet, initTelegram, inTelegram } from './tg.js';
import { html, render, toast, formFields, readFields, toastError } from './ui.js';
import { icon } from './icons.js';

initTelegram();

const v = new URL(import.meta.url).search; // версия для сброса кэша

/** Ленивая загрузка экрана: import() по маршруту. */
const lazy = (file, fn) => async (root, params, q) => {
  const mod = await import(`./views/${file}.js${v}`);
  return mod[fn](root, params, q);
};

route('/', lazy('home', 'home'));
route('/food', lazy('food', 'food'));
route('/food/stores', lazy('settings', 'stores'));
route('/food/product/:id', lazy('product', 'product'));
route('/food/product/:id/edit', lazy('product', 'productEdit'));
route('/food/batch/:batchId', lazy('plan', 'planBatch'));
route('/food/plan/:id', lazy('plan', 'planView'));
route('/food/plan/:id/list', lazy('grocery', 'groceryScreen'));
route('/food/plan/:id/check', lazy('plan', 'planCheck'));
route('/budget', lazy('budget', 'budget'));
route('/budget/income', lazy('budget', 'income'));
route('/budget/fixed', lazy('budget', 'fixedCosts'));
route('/budget/purchases', lazy('budget', 'purchases'));
route('/growth', lazy('growth', 'growth'));
route('/growth/templates', lazy('growth', 'templates'));
route('/growth/program/:id', lazy('growth', 'program'));
route('/growth/session/:pid/:dayId', lazy('workout', 'session'));
route('/growth/library', lazy('growth', 'library'));
route('/growth/exercise/:id', lazy('growth', 'exercise'));
route('/growth/reminders', lazy('reminders', 'reminders'));
route('/more', lazy('more', 'more'));
route('/more/people', lazy('people', 'people'));
route('/more/person/:id', lazy('people', 'person'));
route('/more/sharing', lazy('settings', 'sharing'));
route('/more/settings', lazy('settings', 'settings'));
route('/more/stores', lazy('settings', 'stores'));
route('/more/categories', lazy('settings', 'categories'));
route('/more/taxes', lazy('settings', 'taxes'));
route('/more/meals', lazy('settings', 'mealLayouts'));

onRoute((path) => {
  clearFab();
  renderTabbar(path);
});

const root = document.getElementById('view');

async function boot() {
  render(root, html`<div class="card"><div class="skeleton sk-hero"></div><div class="skeleton sk-line"></div><div class="skeleton sk-line" style="width:70%"></div></div>`);
  if (!inTelegram && !location.search.includes('dev=')) {
    console.info('Вне Telegram: используется режим разработки (?dev=<tg_id>, сервер с DEV_AUTH=1).');
  }
  let me;
  try {
    me = await api('/me');
  } catch (e) {
    render(
      root,
      html`<div class="card empty">
        <div class="icon-chip">${icon('user')}</div>
        <p>${e.status === 401 ? 'Откройте приложение из Telegram-бота.' : e.message}</p>
        <button class="btn secondary" onclick="location.reload()">Повторить</button>
      </div>`
    );
    return;
  }

  const currency = (await cloudGet('currency')) === 'USD' ? 'USD' : 'RUB';
  set({ me: me.user, spaces: me.spaces, currency });

  if (me.invite) {
    const msg = {
      ok: 'Вы присоединились к пространству',
      already_member: null,
      not_found: 'Приглашение не найдено',
      expired: 'Срок действия приглашения истёк',
      used_up: 'Приглашение уже использовано'
    }[me.invite.status];
    if (msg) toast(msg, me.invite.status === 'ok' ? 'success' : 'error');
  }

  if (!me.spaces.length) return onboarding(me.user);

  const saved = await cloudGet('space');
  const pick =
    (me.invite?.status === 'ok' && me.invite.space_id) ||
    (me.spaces.some((s) => s.id === saved) ? saved : null) ||
    me.spaces[0].id;
  const meta = me.spaces.find((s) => s.id === pick);
  set({ spaceId: pick, role: meta.role, space: { name: meta.name, usd_rate: meta.usd_rate, timezone: meta.timezone } });
  cloudSet('space', pick);
  try {
    const space = await api(sp(''));
    set({ space, role: space.role });
  } catch (e) {
    toastError(e);
  }
  start();
}

function onboarding(user) {
  document.getElementById('tabbar').classList.add('hidden');
  const fields = [{ name: 'name', label: 'Название', placeholder: 'Например, Семья Ивановых', required: true }];
  render(
    root,
    html`<h1 class="screen-title">Добро пожаловать${user.first_name ? ', ' + user.first_name : ''}!</h1>
      <p class="screen-sub">Создайте общее пространство: бюджет, продукты, планы питания, тренировки и напоминания будут храниться в нём. Позже можно пригласить семью.</p>
      ${formFields(fields, { name: user.first_name ? `Семья ${user.first_name}` : '' })}
      <div class="btn-row"><button class="btn block" id="create">Создать пространство</button></div>
      <p class="caption" style="margin-top:16px">Если вас пригласили — откройте ссылку-приглашение ещё раз.</p>`
  );
  root.querySelector('#create').addEventListener('click', async (e) => {
    try {
      const vals = readFields(root, fields);
      e.target.disabled = true;
      const created = await api('/spaces', { method: 'POST', body: vals });
      cloudSet('space', created.id);
      location.reload();
    } catch (err) {
      e.target.disabled = false;
      toastError(err);
    }
  });
}

boot();

// Для отладки в консоли
window.__state = get;
