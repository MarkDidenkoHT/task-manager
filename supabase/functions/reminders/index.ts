// Отправка напоминаний. Запускается Supabase Cron раз в минуту (Integrations → Cron).
// Защищена проверкой JWT Supabase: вызвать могут только запросы с ключом проекта.
import { db, localParts, reminderKeyboard, reminderText, tg, toMinutes, type Reminder } from '../_shared/telegram.ts';

/** Сколько минут после назначенного времени напоминание ещё отправляется (например, после сбоя). */
const CATCH_UP_MINUTES = 180;

async function send(r: Reminder, eventId: string) {
  await tg('sendMessage', {
    chat_id: r.owner_tg_id,
    text: await reminderText(r),
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: reminderKeyboard(eventId) }
  });
  await db.from('reminder_events').update({ status: 'sent', sent_at: new Date().toISOString(), snooze_until: null }).eq('id', eventId);
}

Deno.serve(async () => {
  const now = new Date();
  const { data: reminders, error } = await db.from('reminders').select('*').eq('active', true);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let sent = 0;
  const failed: string[] = [];

  for (const r of (reminders ?? []) as Reminder[]) {
    const lp = localParts(r.timezone, now);
    const at = toMinutes(r.local_time);
    if (!r.weekdays.includes(lp.weekday) || at > lp.minutes || lp.minutes - at > CATCH_UP_MINUTES) continue;
    if (lp.date < localParts(r.timezone, new Date(r.created_at)).date) continue;
    // Уникальный ключ (reminder_id, due_on): повторный запуск не отправит дважды.
    const { data: ins } = await db
      .from('reminder_events')
      .upsert({ reminder_id: r.id, due_on: lp.date, status: 'pending' }, { onConflict: 'reminder_id,due_on', ignoreDuplicates: true })
      .select('id');
    if (!ins?.length) continue;
    try {
      await send(r, ins[0].id);
      sent++;
    } catch (e) {
      // Событие остаётся pending — повторим ниже на следующем запуске.
      failed.push(`${r.id}: ${e}`);
    }
  }

  // Повтор: отложенные «на 15 минут» и не доставленные сегодня.
  const { data: due } = await db
    .from('reminder_events')
    .select('id,reminder_id,status,due_on')
    .or(`and(status.eq.snoozed,snooze_until.lte.${now.toISOString()}),and(status.eq.pending,sent_at.is.null)`)
    .limit(200);
  const byId = new Map(((reminders ?? []) as Reminder[]).map((r) => [r.id, r]));
  for (const ev of due ?? []) {
    const r = byId.get(ev.reminder_id);
    if (!r) continue;
    if (ev.status === 'pending') {
      const lp = localParts(r.timezone, now);
      if (ev.due_on !== lp.date || lp.minutes - toMinutes(r.local_time) > CATCH_UP_MINUTES) continue;
    }
    try {
      await send(r, ev.id);
      sent++;
    } catch (e) {
      failed.push(`${ev.id}: ${e}`);
    }
  }

  if (failed.length) console.error('Не отправлено:', failed);
  return Response.json({ sent, failed: failed.length });
});
