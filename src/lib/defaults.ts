export const DEFAULT_CATEGORIES: { name: string; kind: 'fixed' | 'grocery' | 'variable' | 'pet' | 'savings' }[] = [
  { name: 'Продукты', kind: 'grocery' },
  { name: 'Жильё', kind: 'fixed' },
  { name: 'Коммунальные услуги', kind: 'fixed' },
  { name: 'Связь и интернет', kind: 'fixed' },
  { name: 'Подписки', kind: 'fixed' },
  { name: 'Транспорт', kind: 'variable' },
  { name: 'Кафе и рестораны', kind: 'variable' },
  { name: 'Здоровье', kind: 'variable' },
  { name: 'Одежда', kind: 'variable' },
  { name: 'Дом и быт', kind: 'variable' },
  { name: 'Развлечения', kind: 'variable' },
  { name: 'Питомцы', kind: 'pet' },
  { name: 'Накопления', kind: 'savings' },
  { name: 'Прочее', kind: 'variable' }
];

export type MealType = 'breakfast' | 'main' | 'snack';
export interface MealSlot {
  type: MealType;
  share: number; // проценты
}

/** Раскладка приёмов пищи и доли калорий по умолчанию (1–6 приёмов). */
export const DEFAULT_MEAL_LAYOUTS: Record<string, MealSlot[]> = {
  '1': [{ type: 'main', share: 100 }],
  '2': [{ type: 'main', share: 50 }, { type: 'main', share: 50 }],
  '3': [{ type: 'breakfast', share: 30 }, { type: 'main', share: 40 }, { type: 'main', share: 30 }],
  '4': [{ type: 'breakfast', share: 25 }, { type: 'main', share: 35 }, { type: 'snack', share: 10 }, { type: 'main', share: 30 }],
  '5': [
    { type: 'breakfast', share: 25 }, { type: 'snack', share: 10 }, { type: 'main', share: 30 },
    { type: 'snack', share: 10 }, { type: 'main', share: 25 }
  ],
  '6': [
    { type: 'breakfast', share: 20 }, { type: 'snack', share: 10 }, { type: 'main', share: 25 },
    { type: 'snack', share: 10 }, { type: 'main', share: 25 }, { type: 'snack', share: 10 }
  ]
};

export function mealLabel(count: number, idx: number, type: MealType): string {
  if (count === 3) return ['Завтрак', 'Обед', 'Ужин'][idx];
  if (type === 'snack') return 'Перекус';
  return `Приём ${idx + 1}`;
}

export interface StarterProduct {
  name: string;
  unit: 'g' | 'ml' | 'pcs';
  grams_per_piece?: number;
  kcal_100: number;
  protein_100: number;
  fat_100: number;
  carbs_100: number;
  min_g_day?: number;
  max_g_day: number;
  quality: 1 | 2 | 3;
  slots: MealType[];
}

/** Базовый набор продуктов (КБЖУ на 100 г, крупы — в сухом виде). Цены вводит пользователь. */
export const STARTER_PRODUCTS: StarterProduct[] = [
  { name: 'Овсяные хлопья', unit: 'g', kcal_100: 352, protein_100: 12.3, fat_100: 6.1, carbs_100: 59.5, max_g_day: 120, quality: 2, slots: ['breakfast'] },
  { name: 'Гречка', unit: 'g', kcal_100: 313, protein_100: 12.6, fat_100: 3.3, carbs_100: 62.1, max_g_day: 150, quality: 2, slots: ['main'] },
  { name: 'Рис белый', unit: 'g', kcal_100: 344, protein_100: 6.7, fat_100: 0.7, carbs_100: 78.9, max_g_day: 150, quality: 1, slots: ['main'] },
  { name: 'Макароны', unit: 'g', kcal_100: 344, protein_100: 10.4, fat_100: 1.1, carbs_100: 71.5, max_g_day: 150, quality: 1, slots: ['main'] },
  { name: 'Чечевица', unit: 'g', kcal_100: 295, protein_100: 24, fat_100: 1.5, carbs_100: 46.3, max_g_day: 120, quality: 2, slots: ['main'] },
  { name: 'Картофель', unit: 'g', kcal_100: 77, protein_100: 2, fat_100: 0.4, carbs_100: 16.3, max_g_day: 400, quality: 1, slots: ['main'] },
  { name: 'Куриная грудка', unit: 'g', kcal_100: 113, protein_100: 23.6, fat_100: 1.9, carbs_100: 0.4, max_g_day: 350, quality: 2, slots: ['main'] },
  { name: 'Говядина', unit: 'g', kcal_100: 187, protein_100: 18.9, fat_100: 12.4, carbs_100: 0, max_g_day: 250, quality: 3, slots: ['main'] },
  { name: 'Минтай', unit: 'g', kcal_100: 72, protein_100: 15.9, fat_100: 0.9, carbs_100: 0, max_g_day: 300, quality: 2, slots: ['main'] },
  { name: 'Тунец консервированный', unit: 'g', kcal_100: 96, protein_100: 21, fat_100: 1, carbs_100: 0, max_g_day: 185, quality: 3, slots: ['main'] },
  { name: 'Яйца куриные', unit: 'pcs', grams_per_piece: 55, kcal_100: 157, protein_100: 12.7, fat_100: 11.5, carbs_100: 0.7, max_g_day: 220, quality: 2, slots: ['breakfast', 'main'] },
  { name: 'Творог 5%', unit: 'g', kcal_100: 121, protein_100: 17.2, fat_100: 5, carbs_100: 1.8, max_g_day: 300, quality: 2, slots: ['breakfast', 'snack'] },
  { name: 'Йогурт натуральный', unit: 'g', kcal_100: 60, protein_100: 4.3, fat_100: 2, carbs_100: 6.2, max_g_day: 300, quality: 3, slots: ['breakfast', 'snack'] },
  { name: 'Молоко 2,5%', unit: 'ml', kcal_100: 52, protein_100: 2.8, fat_100: 2.5, carbs_100: 4.7, max_g_day: 500, quality: 2, slots: ['breakfast', 'snack'] },
  { name: 'Кефир 1%', unit: 'ml', kcal_100: 40, protein_100: 3, fat_100: 1, carbs_100: 4, max_g_day: 500, quality: 2, slots: ['snack'] },
  { name: 'Сыр твёрдый', unit: 'g', kcal_100: 356, protein_100: 24, fat_100: 29.5, carbs_100: 0, max_g_day: 50, quality: 3, slots: ['breakfast', 'snack'] },
  { name: 'Хлеб цельнозерновой', unit: 'g', kcal_100: 247, protein_100: 13, fat_100: 3.4, carbs_100: 41, max_g_day: 150, quality: 2, slots: ['breakfast', 'main', 'snack'] },
  { name: 'Бананы', unit: 'g', kcal_100: 96, protein_100: 1.5, fat_100: 0.5, carbs_100: 21, max_g_day: 250, quality: 2, slots: ['breakfast', 'snack'] },
  { name: 'Яблоки', unit: 'g', kcal_100: 47, protein_100: 0.4, fat_100: 0.4, carbs_100: 9.8, max_g_day: 300, quality: 2, slots: ['snack', 'breakfast'] },
  { name: 'Овощная смесь замороженная', unit: 'g', kcal_100: 40, protein_100: 2, fat_100: 0.3, carbs_100: 7, max_g_day: 400, quality: 2, slots: ['main'] },
  { name: 'Капуста белокочанная', unit: 'g', kcal_100: 27, protein_100: 1.8, fat_100: 0.1, carbs_100: 4.7, max_g_day: 300, quality: 1, slots: ['main'] },
  { name: 'Морковь', unit: 'g', kcal_100: 35, protein_100: 1.3, fat_100: 0.1, carbs_100: 6.9, max_g_day: 200, quality: 1, slots: ['main', 'snack'] },
  { name: 'Масло подсолнечное', unit: 'g', kcal_100: 899, protein_100: 0, fat_100: 99.9, carbs_100: 0, max_g_day: 40, quality: 1, slots: ['main'] },
  { name: 'Арахис', unit: 'g', kcal_100: 551, protein_100: 26.3, fat_100: 45.2, carbs_100: 9.9, max_g_day: 50, quality: 2, slots: ['snack'] }
];
