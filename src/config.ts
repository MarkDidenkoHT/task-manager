function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

// Обязательны только SUPABASE_URL, SUPABASE_SECRET_KEY и BOT_TOKEN.
// Напоминания и кнопки бота работают в Supabase Edge Functions (supabase/functions).
export const config = {
  port: Number(env('PORT', '3000')),
  supabaseUrl: env('SUPABASE_URL'),
  supabaseKey: env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY'),
  /** Нужен для проверки подписи initData — это и есть вход пользователя. */
  botToken: env('BOT_TOKEN'),
  /** Узнаётся у Telegram (getMe) при запуске; нужен для ссылок-приглашений. */
  botUsername: '',
  /** Необязательно: короткое имя Mini App из @BotFather — ссылки вида t.me/<бот>/<имя>. */
  webappShortName: env('WEBAPP_SHORT_NAME'),
  /** Только для локальной разработки: вход без Telegram (?dev=<id>). */
  devAuth: env('DEV_AUTH') === '1' && env('NODE_ENV') !== 'production',
  initDataMaxAgeSec: 24 * 60 * 60
};

export function checkConfig(): string[] {
  const missing: string[] = [];
  if (!config.supabaseUrl) missing.push('SUPABASE_URL');
  if (!config.supabaseKey) missing.push('SUPABASE_SECRET_KEY');
  if (!config.botToken && !config.devAuth) missing.push('BOT_TOKEN');
  if (config.supabaseKey.startsWith('sb_publishable_')) {
    missing.push('SUPABASE_SECRET_KEY (указан публикуемый ключ, нужен секретный sb_secret_… или service_role)');
  }
  return missing;
}
