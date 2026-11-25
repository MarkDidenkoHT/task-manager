import { api, sp } from '../api.js';
import { go } from '../router.js';
import { header, headerHandlers, ROLE_LABEL } from '../shell.js';
import { get } from '../store.js';
import { notify } from '../tg.js';
import { delegate, html, listRow, render, sectionTitle, toast, toastError } from '../ui.js';

export async function more(root) {
  const off = delegate(root, {
    ...headerHandlers,
    go: (el) => go(el.dataset.to),
    export: async (el) => {
      el.style.pointerEvents = 'none';
      try {
        const r = await api(sp('/export/send'), { method: 'POST' });
        notify('success');
        toast(r.sent ? 'Файл отправлен вам в чат с ботом' : 'Готово', 'success');
      } catch (e) {
        toastError(e);
      } finally {
        el.style.pointerEvents = '';
      }
    }
  });
  const space = get('space');
  render(
    root,
    html`${header()}
      ${sectionTitle('Семья')}
      <div class="list">
        ${listRow({ title: 'Люди и питомцы', subtitle: 'Профили, цели КБЖУ, приёмы пищи', iconName: 'people', iconCls: 'c-food', action: 'go', data: { to: '/more/people' } })}
        ${listRow({ title: 'Совместный доступ', subtitle: `Вы — ${ROLE_LABEL[get('role')]}`, iconName: 'share', iconCls: 'c-money', action: 'go', data: { to: '/more/sharing' } })}
      </div>
      ${sectionTitle('Справочники')}
      <div class="list">
        ${listRow({ title: 'Магазины', iconName: 'store', iconCls: 'c-food', action: 'go', data: { to: '/more/stores' } })}
        ${listRow({ title: 'Категории расходов', iconName: 'tag', iconCls: 'c-money', action: 'go', data: { to: '/more/categories' } })}
        ${listRow({ title: 'Налоги', subtitle: 'Шкала НДФЛ', iconName: 'coins', iconCls: 'c-money', action: 'go', data: { to: '/more/taxes' } })}
        ${listRow({ title: 'Приёмы пищи', subtitle: 'Доли калорий по приёмам', iconName: 'food', iconCls: 'c-food', action: 'go', data: { to: '/more/meals' } })}
      </div>
      ${sectionTitle('Пространство')}
      <div class="list">
        ${listRow({ title: 'Настройки', subtitle: `Курс $: ${space?.usd_rate} ₽ · ${space?.timezone || ''}`, iconName: 'settings', iconCls: 'c-gray', action: 'go', data: { to: '/more/settings' } })}
        ${listRow({ title: 'Экспорт данных', subtitle: 'JSON-файл придёт в чат с ботом', iconName: 'download', iconCls: 'c-gray', action: 'export', chevron: false })}
      </div>
      <p class="caption" style="margin:24px 16px;text-align:center">Планировщик · v0.1 · язык интерфейса: русский</p>`
  );
  return { destroy: off };
}
