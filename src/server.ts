import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { authenticate } from './auth.js';
import { resolveBotUsername } from './bot.js';
import { checkConfig, config } from './config.js';
import { errorHandler } from './http.js';
import { budgetRoutes } from './routes/budget.js';
import { foodRoutes } from './routes/food.js';
import { peopleRoutes } from './routes/people.js';
import { reminderRoutes } from './routes/reminders.js';
import { spaceRoutes } from './routes/spaces.js';
import { trainingRoutes } from './routes/training.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = join(root, 'public');
const version = (process.env.RENDER_GIT_COMMIT ?? String(Date.now())).slice(0, 10);

export async function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: true });
  app.setErrorHandler(errorHandler);

  app.get('/healthz', async () => ({ ok: true }));

  await app.register(
    async (api) => {
      api.decorateRequest('auth', null as never);
      api.addHook('onRequest', async (req) => {
        req.auth = authenticate(req);
      });
      spaceRoutes(api);
      peopleRoutes(api);
      budgetRoutes(api);
      foodRoutes(api);
      trainingRoutes(api);
      reminderRoutes(api);
      api.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'Маршрут не найден' }));
    },
    { prefix: '/api' }
  );

  // Статический фронтенд без сборки. Файлы всегда перепроверяются (ETag), поэтому
  // обновления приходят сразу; index.html получает номер версии для скрипта приложения.
  const indexHtml = readFileSync(join(publicDir, 'index.html'), 'utf8').replaceAll('__VERSION__', version);
  await app.register(fastifyStatic, {
    root: publicDir,
    index: false,
    setHeaders: (res) => res.header('Cache-Control', 'no-cache')
  });
  const sendIndex = (_req: unknown, reply: import('fastify').FastifyReply) =>
    reply.header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send(indexHtml);
  app.get('/', sendIndex);
  app.get('/index.html', sendIndex);

  return app;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const missing = checkConfig();
  if (missing.length) console.warn('⚠ Не заданы переменные окружения: ' + missing.join(', '));
  const app = await buildServer();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  await resolveBotUsername(app.log);
}
