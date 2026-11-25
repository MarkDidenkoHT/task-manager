import { api, invalidate, sp } from './api.js';
import { icon } from './icons.js';
import { go, reload } from './router.js';
import { canWrite, get, set } from './store.js';
import { cloudSet, haptic, selectionHaptic } from './tg.js';
import { formSheet, html, listRow, openSheet, render, toast, toastError } from './ui.js';

// Общие части экрана: шапка с переключателем пространств, вкладки, плавающая кнопка «+».







export const TABS = [
  { path: '/', label: 'Главная', icon: 'home' },
  { path: '/food', label: 'Еда', icon: 'food' },
  { path: '/budget', label: 'Бюджет', icon: 'wallet' },
  { path: '/growth', label: 'Развитие', icon: 'growth' },
  { path: '/more', label: 'Ещё', icon: 'more' }
];

export function renderTabbar(path) {
  const nav = document.getElementById('tabbar');
  nav.classList.remove('hidden');
  const first = '/' + (path.split('/')[1] || '');
  render(
    nav,
    html`${TABS.map(
      (t) => html`<a href="#${t.path}" class="${t.path === first ? 'on' : ''}" data-tab="${t.path}">${icon(t.icon)}<span>${t.label}</span></a>`
    )}`
  );
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-tab]')) selectionHaptic();
});

export const ROLE_LABEL = { owner: 'владелец', editor: 'редактор', viewer: 'наблюдатель' };

export function header() {
  const space = get('space');
  const cur = get('currency') === 'USD' ? '$' : '₽';
  return html`<div class="header">
    <button class="space-switch" data-action="switch-space"><span class="ellipsis">${space?.name || 'Пространство'}</span>${icon('down')}</button>
    <div class="header-right">
      ${!canWrite() ? html`<span class="badge ro-badge">Только просмотр</span>` : ''}
      <button class="chip square" data-action="toggle-currency" aria-label="Валюта">${cur}</button>
    </div>
  </div>`;
}

/** Обработчики шапки — подключаются к корню экрана. */
export const headerHandlers = {
  'toggle-currency': () => {
    set({ currency: get('currency') === 'USD' ? 'RUB' : 'USD' });
    cloudSet('currency', get('currency'));
    selectionHaptic();
    reload();
  },
  'switch-space': () => openSpaceSwitcher()
};

function openSpaceSwitcher() {
  const spaces = get('spaces');
  const s = openSheet({
    title: 'Пространства',
    body: html`<div class="list">
        ${spaces.map((sp2) =>
          listRow({
            title: sp2.name,
            subtitle: ROLE_LABEL[sp2.role],
            iconName: 'people',
            iconCls: 'c-money',
            action: 'pick',
            data: { id: sp2.id },
            trail: sp2.id === get('spaceId') ? icon('check') : '',
            chevron: false
          })
        )}
      </div>
      <div class="sheet-actions"><button class="btn block secondary" data-action="new">${icon('plus')} Новое пространство</button></div>`
  });
  s.el.addEventListener('click', async (e) => {
    const pick = e.target.closest('[data-action="pick"]');
    if (pick) {
      s.close();
      await switchSpace(pick.dataset.id);
      return;
    }
    if (e.target.closest('[data-action="new"]')) {
      s.close();
      createSpaceSheet();
    }
  });
}

export function createSpaceSheet() {
  formSheet({
    title: 'Новое пространство',
    fields: [{ name: 'name', label: 'Название', placeholder: 'Например, Семья Ивановых', required: true }],
    submitText: 'Создать',
    onSubmit: async (v) => {
      const sp2 = await api('/spaces', { method: 'POST', body: { name: v.name } });
      const me = await api('/me');
      set({ spaces: me.spaces });
      await switchSpace(sp2.id);
      toast('Пространство создано', 'success');
    }
  });
}

export async function switchSpace(id) {
  const meta = get('spaces').find((s) => s.id === id);
  set({ spaceId: id, role: meta?.role || 'viewer' });
  cloudSet('space', id);
  invalidate();
  try {
    const space = await api(sp(''));
    set({ space, role: space.role });
  } catch (e) {
    toastError(e);
  }
  haptic('medium');
  go('/');
  reload();
}

// ---------- Плавающая кнопка ----------
export function setFab(actions) {
  const slot = document.getElementById('fab-slot');
  slot.innerHTML = '';
  if (!actions || !canWrite()) return;
  const btn = document.createElement('button');
  btn.className = 'fab';
  btn.setAttribute('aria-label', 'Добавить');
  btn.innerHTML = icon('plus').value;
  btn.addEventListener('click', () => {
    haptic('medium');
    const s = openSheet({
      title: 'Добавить',
      body: html`<div class="list">${actions.map((a, i) =>
        listRow({ title: a.label, subtitle: a.hint, iconName: a.icon, iconCls: a.cls, action: 'fab-act', data: { i } })
      )}</div>`
    });
    s.el.addEventListener('click', (e) => {
      const row = e.target.closest('[data-action="fab-act"]');
      if (!row) return;
      s.close();
      actions[Number(row.dataset.i)].run();
    });
  });
  slot.appendChild(btn);
}

export const clearFab = () => {
  document.getElementById('fab-slot').innerHTML = '';
};

