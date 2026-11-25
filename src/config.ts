function env(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(env('PORT', '3000')),
  supabaseUrl: env('SUPABASE_URL'),
  supabaseKey: env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY'),
  botToken: env('BOT_TOKEN'),
  botUsername: env('BOT_USERNAME'),
  webappShortName: env('WEBAPP_SHORT_NAME'),
  publicUrl: env('PUBLIC_URL').replace(/\/$/, ''),
  tickSecret: env('TICK_SECRET'),
  webhookSecret: env('WEBHOOK_SECRET'),
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
