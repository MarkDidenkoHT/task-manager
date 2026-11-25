// Сервер обращается к Telegram только за именем бота и для отправки экспорта.
// Напоминания и кнопки — в Supabase Edge Functions (supabase/functions).
import { config } from './config.js';

export async function tg<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description}`);
  return json.result;
}

/** Имя бота для ссылок-приглашений — берём у Telegram, настраивать не нужно. */
export async function resolveBotUsername(log: { info: (m: string) => void; warn: (m: string) => void }) {
  if (!config.botToken) return;
  try {
    const me = await tg<{ username: string }>('getMe', {});
    config.botUsername = me.username;
    log.info(`Бот: @${me.username}`);
  } catch (e) {
    log.warn('Не удалось получить имя бота (проверьте BOT_TOKEN): ' + String(e));
  }
}
