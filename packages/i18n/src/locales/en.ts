import type { DeepStringRecord } from '../types';
import type { es } from './es';

export const en: DeepStringRecord<typeof es> = {
  app: {
    name: 'Personal Trainer',
    tagline: 'AI-powered nutrition and training',
  },
  nav: {
    dashboard: 'Dashboard',
    nutrition: 'Nutrition',
    training: 'Training',
    ranking: 'Ranking',
  },
};
