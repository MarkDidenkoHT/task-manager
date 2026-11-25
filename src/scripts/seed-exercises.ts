/**
 * Загрузка библиотеки упражнений из Free Exercise DB (github.com/yuhonas/free-exercise-db, Unlicense).
 * Берём только уровни beginner/intermediate и инвентарь: своё тело, гантели, резинки, гири.
 *
 *   npm run seed:exercises              — картинки по ссылкам GitHub
 *   npm run seed:exercises -- --images  — скопировать картинки в Supabase Storage (бакет exercises)
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db.js';

const SRC = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main';
const ALLOWED_EQUIPMENT = new Set(['body only', 'dumbbell', 'bands', 'kettlebells']);
const ALLOWED_LEVEL = new Set(['beginner', 'intermediate']);
const BUCKET = 'exercises';

interface FedExercise {
  id: string;
  name: string;
  level: string | null;
  equipment: string | null;
  category: string | null;
  primaryMuscles: string[] | null;
  secondaryMuscles: string[] | null;
  instructions: string[] | null;
  images: string[] | null;
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const namesFile = join(root, 'seed', 'exercise-names-ru.json');
const ruNames: Record<string, string> = existsSync(namesFile) ? JSON.parse(readFileSync(namesFile, 'utf8')) : {};
const copyImages = process.argv.includes('--images');

async function main() {
  console.log('Загружаю', `${SRC}/dist/exercises.json`);
  const res = await fetch(`${SRC}/dist/exercises.json`);
  if (!res.ok) throw new Error('Не удалось скачать набор: HTTP ' + res.status);
  const all = (await res.json()) as FedExercise[];
  const picked = all.filter((e) => e.level && ALLOWED_LEVEL.has(e.level) && e.equipment && ALLOWED_EQUIPMENT.has(e.equipment));
  console.log(`Всего ${all.length}, подходит ${picked.length}`);

  if (copyImages) {
    const { error } = await db().storage.createBucket(BUCKET, { public: true });
    if (error && !/already exists/i.test(error.message)) throw error;
  }

  let done = 0;
  for (let i = 0; i < picked.length; i += 50) {
    const chunk = picked.slice(i, i + 50);
    const rows = [];
    for (const e of chunk) {
      let images = (e.images ?? []).map((p) => `${SRC}/exercises/${p}`);
      if (copyImages) {
        const stored: string[] = [];
        for (const p of e.images ?? []) {
          const img = await fetch(`${SRC}/exercises/${p}`);
          if (!img.ok) continue;
          const buf = Buffer.from(await img.arrayBuffer());
          const { error } = await db().storage.from(BUCKET).upload(p, buf, { contentType: 'image/jpeg', upsert: true });
          if (!error) stored.push(`${BUCKET}/${p}`);
        }
        images = stored;
      }
      const timed = /plank|hold|wall sit/i.test(e.name) || e.category === 'stretching';
      rows.push({
        space_id: null,
        name: ruNames[e.id] ?? e.name,
        name_en: e.name,
        source: 'free-exercise-db',
        external_id: e.id,
        kind: timed ? 'timed' : 'reps',
        level: e.level,
        equipment: e.equipment ? [e.equipment] : [],
        primary_muscles: e.primaryMuscles ?? [],
        secondary_muscles: e.secondaryMuscles ?? [],
        instructions: (e.instructions ?? []).join('\n'),
        image_paths: images
      });
    }
    const { error } = await db().from('exercises').upsert(rows, { onConflict: 'source,external_id' });
    if (error) throw new Error(error.message);
    done += rows.length;
    console.log(`Загружено ${done}/${picked.length}`);
  }
  console.log('Готово. Русских названий в словаре:', Object.keys(ruNames).length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
