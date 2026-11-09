export const tokens = {
  color: {
    brand: '#16a34a',
    brandForeground: '#ffffff',
    protein: '#2563eb',
    carbs: '#f59e0b',
    fat: '#e11d48',
    calories: '#16a34a',
  },
  radius: { sm: 6, md: 10, lg: 16 },
  space: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
} as const;

export type Tokens = typeof tokens;
