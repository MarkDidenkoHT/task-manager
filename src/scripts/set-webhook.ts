/**
 * Настройка бота: вебхук, кнопка меню, команды и описание.
 *   npm run set-webhook
 */
import { tg } from '../bot.js';
import { config } from '../config.js';

async function main() {
  if (!config.botToken || !config.publicUrl) throw new Error('Нужны BOT_TOKEN и PUBLIC_URL');
  await tg('setWebhook', {
    url: `${config.publicUrl}/bot`,
    secret_token: config.webhookSecret || undefined,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true
  });
  console.log('Вебхук:', `${config.publicUrl}/bot`);

  await tg('setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Планировщик', web_app: { url: config.publicUrl + '/' } }
  });
  await tg('setMyCommands', { commands: [{ command: 'start', description: 'Открыть планировщик' }] });
  await tg('setMyDescription', {
    description: 'Бюджет семьи, план питания с ценами по магазинам, тренировки и напоминания — в одном приложении.'
  });
  await tg('setMyShortDescription', { short_description: 'Бюджет, питание, тренировки и напоминания' });
  console.log('Кнопка меню, команды и описание обновлены');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
