import { api, invalidate, sp } from '../api.js';
import { icon } from '../icons.js';
import { ROLE_LABEL } from '../shell.js';
import { canWrite, get, isOwner, set } from '../store.js';
import { confirmDialog, copyText, notify, openTgLink, setMainButton } from '../tg.js';
import {
  chips, delegate, empty, fmt, formFields, formSheet, html, listRow, load, openSheet, readFields, render,
  sectionTitle, stepper, toast, toastError
} from '../ui.js';

const TIMEZONES = [
  'Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk',
  'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka',
  'Europe/Minsk', 'Europe/Kiev', 'Europe/Chisinau', 'Asia/Almaty', 'Asia/Tashkent', 'Asia/Tbilisi', 'Asia/Yerevan',
  'Europe/Berlin', 'Europe/London', 'UTC'
];
const tzLabel = (tz) => tz.split('/').pop().replace('_', ' ');

// ---------- Совместный доступ ----------
export async function sharing(root) {
  const off = delegate(root, {
    invite: () => inviteSheet(draw),
    member: (el) => memberSheet(Number(el.dataset.id), draw),
    'copy-invite': async (el) => {
      if (await copyText(el.dataset.link)) toast('Ссылка скопирована', 'success');
    },
    'del-invite': async (el) => {
      try {
        await api(sp(`/invites/${el.dataset.code}`), { method: 'DELETE' });
        draw();
      } catch (e) {
        toastError(e);
      }
    },
    leave: async () => {
      if (!(await confirmDialog('Покинуть пространство? Вернуться можно только по новому приглашению.'))) return;
      try {
        await api(sp(`/members/${get('me').id}`), { method: 'DELETE' });
        location.reload();
      } catch (e) {
        toastError(e);
      }
    }
  });
  let members = [];
  const draw = () =>
    load(root, async () => {
      members = await api(sp('/members'));
      const invites = isOwner() ? await api(sp('/invites')) : [];
      return { members, invites };
    }, ({ invites }) => {
      render(
        root,
        html`<h1 class="screen-title">Совместный доступ</h1>
          <div class="list">${members.map((m) =>
            listRow({
              title: html`${m.display_name || m.tg_id}${Number(m.tg_id) === Number(get('me').id) ? html` <span class="muted small">(вы)</span>` : ''}`,
              iconName: 'user',
              iconCls: 'c-money',
              trail: html`<span class="badge ${m.role === 'owner' ? 'accent' : m.role === 'editor' ? 'ok' : ''}">${ROLE_LABEL[m.role]}</span>`,
              action: isOwner() && m.role !== 'owner' ? 'member' : null,
              data: { id: m.tg_id },
              chevron: isOwner() && m.role !== 'owner'
            })
          )}</div>
          ${isOwner()
            ? html`${invites.length
                ? html`${sectionTitle('Активные приглашения')}<div class="list">${invites.map((i) =>
                    listRow({
                      title: ROLE_LABEL[i.role],
                      subtitle: `до ${new Date(i.expires_at).toLocaleDateString('ru-RU')} · использовано ${i.uses} из ${i.max_uses}`,
                      iconName: 'share',
                      iconCls: 'c-gray',
                      trail: html`<button class="icon-btn" data-action="copy-invite" data-link="${i.link}" aria-label="Копировать">${icon('copy')}</button><button class="icon-btn" data-action="del-invite" data-code="${i.code}" aria-label="Отозвать">${icon('trash')}</button>`,
                      chevron: false
                    })
                  )}</div>`
                : ''}
              <div class="notice" style="margin-top:16px"><b>Редактор</b> может всё, кроме управления участниками. <b>Наблюдатель</b> видит все данные, но ничего не меняет.</div>`
            : html`<div class="btn-row"><button class="btn danger block" data-action="leave">${icon('logout')} Покинуть пространство</button></div>`}`
      );
    });
  if (isOwner()) setMainButton('Пригласить', () => inviteSheet(draw));
  await draw();
  return { destroy: off };

  function memberSheet(tgId, onDone) {
    const m = members.find((x) => Number(x.tg_id) === tgId);
    formSheet({
      title: m.display_name || String(m.tg_id),
      fields: [{ name: 'role', label: 'Роль', type: 'chips', options: [{ value: 'editor', label: 'Редактор' }, { value: 'viewer', label: 'Наблюдатель' }] }],
      values: m,
      onSubmit: async (v) => {
        await api(sp(`/members/${tgId}`), { method: 'PATCH', body: { role: v.role } });
        onDone();
      },
      deleteText: 'Удалить из пространства',
      onDelete: async () => {
        if (!(await confirmDialog(`Удалить ${m.display_name || 'участника'} из пространства?`))) return false;
        await api(sp(`/members/${tgId}`), { method: 'DELETE' });
        onDone();
      }
    });
  }
}

function inviteSheet(onDone) {
  formSheet({
    title: 'Приглашение',
    fields: [
      { name: 'role', label: 'Роль', type: 'chips', options: [{ value: 'editor', label: 'Редактор' }, { value: 'viewer', label: 'Наблюдатель' }] },
      { name: 'expires_in_days', label: 'Действует, дней', type: 'stepper', min: 1, max: 30 },
      { name: 'max_uses', label: 'Сколько человек', type: 'stepper', min: 1, max: 20 }
    ],
    values: { role: 'editor', expires_in_days: 7, max_uses: 1 },
    submitText: 'Создать ссылку',
    onSubmit: async (v) => {
      const inv = await api(sp('/invites'), { method: 'POST', body: v });
      onDone?.();
      const s = openSheet({
        title: 'Ссылка готова',
        body: html`<div class="card" style="background:var(--fill);word-break:break-all" class="small">${inv.link}</div>
          <p class="caption" style="margin-top:8px">${inv.link.startsWith('http') ? 'Отправьте ссылку близким — по ней откроется приложение и они попадут в ваше пространство.' : 'Имя бота не настроено (BOT_USERNAME) — это код приглашения.'}</p>
          <div class="sheet-actions">
            <button class="btn block" data-share>${icon('share')} Поделиться в Telegram</button>
            <button class="btn block secondary" data-copy>${icon('copy')} Скопировать</button>
          </div>`
      });
      s.el.querySelector('[data-copy]').addEventListener('click', async () => {
        if (await copyText(inv.link)) toast('Скопировано', 'success');
      });
      s.el.querySelector('[data-share]').addEventListener('click', () => {
        openTgLink(`https://t.me/share/url?url=${encodeURIComponent(inv.link)}&text=${encodeURIComponent('Присоединяйся к нашему планировщику')}`);
      });
    }
  });
}

// ---------- Настройки ----------
export async function settings(root) {
  await load(root, async () => {
    const [space, members] = await Promise.all([api(sp('')), api(sp('/members'))]);
    return { space, me: members.find((m) => Number(m.tg_id) === Number(get('me').id)) };
  }, ({ space, me }) => {
    const tzOptions = [...new Set([space.timezone, ...TIMEZONES])].map((t) => ({ value: t, label: tzLabel(t) }));
    const spaceFields = [
      { name: 'name', label: 'Название пространства', required: true },
      { name: 'usd_rate', label: 'Курс доллара, ₽ за 1 $', type: 'number', required: true, hint: 'Используется для отображения сумм в долларах' },
      { name: 'timezone', label: 'Часовой пояс пространства', type: 'select', options: tzOptions },
      { name: 'top_cost_factor', label: 'Премиум-план дороже дешёвого не более чем в', type: 'number', hint: 'По умолчанию 2,2 раза' }
    ];
    const myTz = [...new Set([me?.timezone || '', ...TIMEZONES])].map((t) => ({ value: t, label: t ? tzLabel(t) : 'Как у пространства' }));
    const meFields = [
      { name: 'display_name', label: 'Моё имя в пространстве' },
      { name: 'timezone', label: 'Мой часовой пояс (для напоминаний)', type: 'select', options: myTz }
    ];
    render(
      root,
      html`<h1 class="screen-title">Настройки</h1>
        ${sectionTitle('Пространство')}
        ${formFields(spaceFields, space)}
        ${sectionTitle('Я')}
        ${formFields(meFields, me || {})}
        ${sectionTitle('Язык')}
        <div class="card"><div class="row between"><span>Язык интерфейса</span><span class="muted">Русский</span></div></div>
        ${isOwner() ? html`<div class="btn-row" style="margin-top:32px"><button class="btn danger block" id="del-space">${icon('trash')} Удалить пространство</button></div>` : ''}`
    );
    root.querySelector('#del-space')?.addEventListener('click', async () => {
      if (!(await confirmDialog(`Удалить «${space.name}» со всеми данными? Это действие нельзя отменить.`))) return;
      if (!(await confirmDialog('Точно удалить? Все участники потеряют доступ.'))) return;
      try {
        await api(sp(''), { method: 'DELETE' });
        location.reload();
      } catch (e) {
        toastError(e);
      }
    });
    setMainButton('Сохранить', async () => {
      try {
        const sv = readFields(root, spaceFields);
        const mv = readFields(root, meFields);
        if (canWrite()) {
          const updated = await api(sp(''), { method: 'PATCH', body: { name: sv.name, usd_rate: sv.usd_rate, timezone: sv.timezone, top_cost_factor: sv.top_cost_factor ?? 2.2 } });
          set({ space: { ...get('space'), ...updated, usd_rate: Number(updated.usd_rate) } });
          set({ spaces: get('spaces').map((s) => (s.id === updated.id ? { ...s, name: updated.name } : s)) });
        }
        await api(sp('/me'), { method: 'PATCH', body: { display_name: mv.display_name || undefined, timezone: mv.timezone || null } });
        notify('success');
        toast('Сохранено', 'success');
      } catch (e) {
        toastError(e);
      }
    });
  });
}

// ---------- Магазины ----------
export async function stores(root) {
  const draw = () =>
    load(root, () => api(sp('/stores')), (rows) => {
      render(
        root,
        html`<h1 class="screen-title">Магазины</h1>
          ${rows.length
            ? html`<div class="list">${rows.map((r) => listRow({ title: r.name, iconName: 'store', iconCls: 'c-food', action: canWrite() ? 'edit' : null, data: { id: r.id } }))}</div>`
            : html`<div class="card">${empty({ iconName: 'store', cls: 'c-food', text: 'Добавьте магазины, где покупаете продукты, — чтобы сравнивать цены.' })}</div>`}
          <p class="caption" style="margin:12px 16px">Цену без магазина можно ввести как «общую» — она используется, когда цены в конкретном магазине нет.</p>`
      );
      root.onclick = (e) => {
        const row = e.target.closest('[data-action="edit"]');
        if (!row) return;
        const s0 = rows.find((r) => r.id === row.dataset.id);
        formSheet({
          title: 'Магазин',
          fields: [{ name: 'name', label: 'Название', required: true }],
          values: s0,
          onSubmit: async (v) => {
            await api(sp(`/stores/${s0.id}`), { method: 'PATCH', body: v });
            invalidate(sp('/stores'));
            draw();
          },
          onDelete: async () => {
            if (!(await confirmDialog(`Удалить «${s0.name}»? Цены этого магазина тоже удалятся.`))) return false;
            await api(sp(`/stores/${s0.id}`), { method: 'DELETE' });
            invalidate(sp('/stores'));
            draw();
          }
        });
      };
    });
  if (canWrite()) {
    setMainButton('Добавить магазин', () =>
      formSheet({
        title: 'Новый магазин',
        fields: [{ name: 'name', label: 'Название', required: true, placeholder: 'Пятёрочка' }],
        onSubmit: async (v) => {
          await api(sp('/stores'), { method: 'POST', body: v });
          invalidate(sp('/stores'));
          draw();
        }
      })
    );
  }
  await draw();
}

// ---------- Категории ----------
const CAT_KIND = [
  { value: 'grocery', label: 'Продукты' },
  { value: 'fixed', label: 'Обязательные' },
  { value: 'variable', label: 'Переменные' },
  { value: 'pet', label: 'Питомцы' },
  { value: 'savings', label: 'Накопления' }
];

export async function categories(root) {
  const sheet = (row, draw) =>
    formSheet({
      title: row ? 'Категория' : 'Новая категория',
      fields: [
        { name: 'name', label: 'Название', required: true },
        { name: 'kind', label: 'Тип', type: 'chips', small: true, options: CAT_KIND }
      ],
      values: row || { kind: 'variable' },
      onSubmit: async (v) => {
        await api(row ? sp(`/categories/${row.id}`) : sp('/categories'), { method: row ? 'PATCH' : 'POST', body: v });
        invalidate(sp('/categories'));
        draw();
      },
      onDelete: row
        ? async () => {
            if (!(await confirmDialog(`Удалить «${row.name}»? Покупки останутся без категории.`))) return false;
            await api(sp(`/categories/${row.id}`), { method: 'DELETE' });
            invalidate(sp('/categories'));
            draw();
          }
        : null
    });
  const draw = () =>
    load(root, () => api(sp('/categories')), (rows) => {
      render(
        root,
        html`<h1 class="screen-title">Категории расходов</h1>
          ${CAT_KIND.map((k) => {
            const list = rows.filter((r) => r.kind === k.value);
            return list.length
              ? html`${sectionTitle(k.label)}<div class="list">${list.map((r) => listRow({ title: r.name, action: canWrite() ? 'edit' : null, data: { id: r.id } }))}</div>`
              : '';
          })}`
      );
      root.onclick = (e) => {
        const row = e.target.closest('[data-action="edit"]');
        if (row) sheet(rows.find((r) => r.id === row.dataset.id), draw);
      };
    });
  if (canWrite()) setMainButton('Добавить категорию', () => sheet(null, draw));
  await draw();
}

// ---------- Налоги ----------
export async function taxes(root) {
  let rows = [];
  const draw = () => {
    render(
      root,
      html`<h1 class="screen-title">Шкала НДФЛ</h1>
        <p class="screen-sub">Ставка применяется к части годового дохода от порога до следующего порога.</p>
        <div class="list plain">${rows.map(
          (r, i) => html`<div class="list-row no-icon" style="gap:8px">
            <div class="body"><span class="lbl caption">от, ₽ в год</span><input class="num" data-i="${i}" data-k="from" inputmode="numeric" value="${fmt(r.from_annual_minor / 100)}" ${i === 0 ? 'disabled' : ''} style="border:0;background:transparent;width:100%;font-size:16px" /></div>
            <div style="width:90px"><span class="lbl caption">ставка, %</span><input class="num" data-i="${i}" data-k="rate" inputmode="decimal" value="${String(r.rate).replace('.', ',')}" style="border:0;background:transparent;width:100%;font-size:16px" /></div>
            ${i > 0 && canWrite() ? html`<button class="icon-btn" data-del="${i}" aria-label="Удалить">${icon('trash')}</button>` : html`<span style="width:44px"></span>`}
          </div>`
        )}</div>
        ${canWrite() ? html`<div class="btn-row"><button class="btn secondary" id="add">${icon('plus')} Порог</button><button class="btn secondary" id="reset">По умолчанию</button></div>` : ''}
        <div class="notice" style="margin-top:16px">По умолчанию — шкала для резидентов РФ: 13% до 2,4 млн ₽ в год, 15% до 5 млн, 18% до 20 млн, 20% до 50 млн, 22% свыше. Проверьте актуальность по действующему законодательству.</div>`
    );
  };
  const readInputs = () => {
    root.querySelectorAll('input[data-i]').forEach((inp) => {
      const r = rows[Number(inp.dataset.i)];
      const n = Number(inp.value.replace(/\s| /g, '').replace(',', '.'));
      if (inp.dataset.k === 'from') r.from_annual_minor = Math.round(n * 100);
      else r.rate = n;
    });
  };
  root.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      readInputs();
      rows.splice(Number(del.dataset.del), 1);
      draw();
    }
    if (e.target.closest('#add')) {
      readInputs();
      const last = rows[rows.length - 1];
      rows.push({ from_annual_minor: (last?.from_annual_minor || 0) + 1_000_000_00, rate: (Number(last?.rate) || 13) + 2 });
      draw();
    }
    if (e.target.closest('#reset')) {
      rows = [
        { from_annual_minor: 0, rate: 13 },
        { from_annual_minor: 2_400_000_00, rate: 15 },
        { from_annual_minor: 5_000_000_00, rate: 18 },
        { from_annual_minor: 20_000_000_00, rate: 20 },
        { from_annual_minor: 50_000_000_00, rate: 22 }
      ];
      draw();
    }
  });
  await load(root, () => api(sp('/tax-brackets')), (data) => {
    rows = data.map((r) => ({ from_annual_minor: Number(r.from_annual_minor), rate: Number(r.rate) }));
    if (!rows.length) rows = [{ from_annual_minor: 0, rate: 13 }];
    draw();
  });
  if (canWrite()) {
    setMainButton('Сохранить', async () => {
      try {
        readInputs();
        if (rows.some((r) => !Number.isFinite(r.from_annual_minor) || !Number.isFinite(r.rate))) throw new Error('Проверьте числа');
        await api(sp('/tax-brackets'), { method: 'PUT', body: rows });
        notify('success');
        toast('Шкала сохранена', 'success');
      } catch (e) {
        toastError(e);
      }
    });
  }
}

// ---------- Раскладка приёмов пищи ----------
const MEAL_TYPES = [
  { value: 'breakfast', label: 'Завтрак' },
  { value: 'main', label: 'Основной' },
  { value: 'snack', label: 'Перекус' }
];

export async function mealLayouts(root) {
  let space;
  let count = 3;
  let layouts;
  const draw = () => {
    const l = layouts[String(count)];
    const sum = l.reduce((a, x) => a + Number(x.share), 0);
    render(
      root,
      html`<h1 class="screen-title">Приёмы пищи</h1>
        <p class="screen-sub">Тип приёма определяет, какие продукты в него подходят, а доля — сколько калорий дня на него приходится.</p>
        ${chips('count', [1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) })), count, { small: true })}
        <div class="list plain" style="margin-top:12px">${l.map(
          (x, i) => html`<div class="list-row no-icon" style="flex-wrap:wrap">
            <div class="body" style="min-width:100%"><b>${count === 3 ? ['Завтрак', 'Обед', 'Ужин'][i] : `Приём ${i + 1}`}</b></div>
            ${chips('type_' + i, MEAL_TYPES, x.type, { small: true })}
            <div class="trail" style="margin-left:auto">${stepper('share_' + i, x.share, { min: 5, max: 100, step: 5 })}<span class="muted">%</span></div>
          </div>`
        )}</div>
        <p class="caption" style="margin:8px 16px">Сумма долей: <b class="${sum === 100 ? 'ok' : 'warn'}">${sum}%</b>${sum === 100 ? '' : ' — будет нормирована до 100%'}</p>
        ${canWrite() ? html`<div class="btn-row"><button class="btn secondary" id="reset">Сбросить к умолчанию</button></div>` : ''}`
    );
  };
  root.addEventListener('change', (e) => {
    const n = e.detail?.name || '';
    if (n === 'count') {
      count = Number(e.detail.value);
      draw();
    } else if (n.startsWith('type_')) layouts[String(count)][Number(n.slice(5))].type = e.detail.value;
    else if (n.startsWith('share_')) {
      layouts[String(count)][Number(n.slice(6))].share = Number(e.detail.value);
      draw();
    }
  });
  root.addEventListener('click', (e) => {
    if (e.target.closest('#reset')) {
      layouts[String(count)] = structuredClone(space.default_meal_layouts[String(count)]);
      draw();
    }
  });
  await load(root, () => api(sp('')), (s) => {
    space = s;
    layouts = structuredClone(s.meal_layouts);
    draw();
  });
  if (canWrite()) {
    setMainButton('Сохранить', async () => {
      try {
        await api(sp(''), { method: 'PATCH', body: { meal_layouts: layouts } });
        notify('success');
        toast('Сохранено', 'success');
      } catch (e) {
        toastError(e);
      }
    });
  }
}

