// Вебхук бота: кнопки «Готово / Через 15 мин / Пропустить» и команда /start.
// Telegram не умеет передавать JWT, поэтому проверка JWT отключена (supabase/config.toml),
// а подлинность запроса проверяется секретом вебхука.
//
// Однократная настройка после деплоя — откройте в браузере адрес функции с ?setup:
//   https://<проект>.supabase.co/functions/v1/telegram-bot?setup
// Функция зарегистрирует себя как вебхук и поставит кнопку меню с APP_URL.
import { APP_URL, BOT_TOKEN, db, reminderText, tg, webhookSecret, type Reminder } from '../_shared/telegram.ts';

const STATUS: Record<string, { status: string; text: string }> = {
  done: { status: 'done', text: '✅ Выполнено' },
  snooze: { status: 'snoozed', text: '⏰ Напомню через 15 минут' },
  skip: { status: 'skipped', text: '⏭ Пропущено' }
};

async function setup(req: Request) {
  const url = new URL(req.url);
  const self = `https://${url.host}${url.pathname}`;
  await tg('setWebhook', { url: self, secret_token: await webhookSecret(), allowed_updates: ['message', 'callback_query'] });
  if (APP_URL) {
    await tg('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Планировщик', web_app: { url: APP_URL + '/' } } });
  }
  await tg('setMyCommands', { commands: [{ command: 'start', description: 'Открыть планировщик' }] });
  await tg('setMyDescription', { description: 'Бюджет семьи, план питания с ценами по магазинам, тренировки и напоминания — в одном приложении.' });
  await tg('setMyShortDescription', { short_description: 'Бюджет, питание, тренировки и напоминания' });
  const me = await tg<{ username: string }>('getMe', {});
  return new Response(`Готово: вебхук @${me.username} → ${self}${APP_URL ? '' : '\nAPP_URL не задан — кнопка меню не установлена'}`);
}

async function onCallback(cq: any) {
  const m = /^r:([0-9a-f-]{36}):(done|snooze|skip)$/.exec(cq.data ?? '');
  if (!m) return tg('answerCallbackQuery', { callback_query_id: cq.id });
  const [, eventId, action] = m;

  const { data: ev } = await db.from('reminder_events').select('id,reminder_id').eq('id', eventId).maybeSingle();
  const { data: r } = ev ? await db.from('reminders').select('*').eq('id', ev.reminder_id).maybeSingle() : { data: null };
  if (!r) return tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Напоминание не найдено' });

  // Нажимать может только участник пространства с правом записи.
  const { data: member } = await db.from('members').select('role').eq('space_id', r.space_id).eq('tg_id', cq.from.id).maybeSingle();
  if (!member || member.role === 'viewer') {
    return tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Нет доступа', show_alert: true });
  }

  const s = STATUS[action];
  await db
    .from('reminder_events')
    .update({ status: s.status, snooze_until: action === 'snooze' ? new Date(Date.now() + 15 * 60_000).toISOString() : null })
    .eq('id', eventId);

  if (cq.message) {
    const keyboard =
      action === 'done' && r.kind === 'workout' && APP_URL
        ? [[{ text: '📝 Открыть и записать подходы', web_app: { url: `${APP_URL}/#/growth${r.program_id ? '/program/' + r.program_id : ''}` } }]]
        : [];
    await tg('editMessageText', {
      chat_id: cq.message.chat.id,
      message_id: cq.message.message_id,
      text: `${await reminderText(r as Reminder)}\n\n<i>${s.text}</i>`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: keyboard }
    }).catch(() => undefined);
  }
  return tg('answerCallbackQuery', { callback_query_id: cq.id, text: s.text });
}

async function onMessage(msg: any) {
  const text: string = msg.text ?? '';
  if (msg.chat?.type !== 'private' || !(text.startsWith('/start') || text.startsWith('/help'))) return;
  const name = msg.from?.first_name ? `, ${String(msg.from.first_name).replace(/[<>&]/g, '')}` : '';
  await tg('sendMessage', {
    chat_id: msg.chat.id,
    parse_mode: 'HTML',
    text:
      `Привет${name}! 👋\n\nЯ — планировщик жизни: бюджет, питание с ценами по магазинам, тренировки и напоминания в одном месте.\n\n` +
      'Откройте приложение кнопкой ниже. Напоминания будут приходить сюда, в этот чат.',
    reply_markup: APP_URL ? { inline_keyboard: [[{ text: 'Открыть планировщик', web_app: { url: APP_URL + '/' } }]] } : undefined
  });
}

Deno.serve(async (req) => {
  if (!BOT_TOKEN) return new Response('BOT_TOKEN не задан в секретах функций', { status: 500 });
  if (req.method === 'GET' && new URL(req.url).searchParams.has('setup')) return setup(req);
  if (req.method !== 'POST') return new Response('ok');
  if (req.headers.get('x-telegram-bot-api-secret-token') !== (await webhookSecret())) {
    return new Response('unauthorized', { status: 401 });
  }
  try {
    const update = await req.json();
    if (update.callback_query) await onCallback(update.callback_query);
    else if (update.message) await onMessage(update.message);
  } catch (e) {
    console.error(e);
  }
  return new Response('ok'); // 200, чтобы Telegram не повторял обновление
});
