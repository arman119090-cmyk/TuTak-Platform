import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Проекты. Один проект = один файл src/content/projects/<slug>.md.
 * Инструкция — README → «Как добавить проект».
 */
const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: ({ image }) =>
    z.object({
      title: z.object({ hy: z.string(), ru: z.string(), en: z.string() }),
      category: z.enum(['residential', 'commercial', 'renovation', 'infrastructure']),
      district: z.object({ hy: z.string(), ru: z.string(), en: z.string() }),
      year: z.union([z.number().int().min(2025).max(2100), z.string()]),
      area_m2: z.union([z.number().positive(), z.string()]),
      cover: image(),
      cover_alt: z.object({ hy: z.string(), ru: z.string(), en: z.string() }),
      gallery: z.array(image()).default([]),
      featured: z.boolean().default(false),
      // Порядок на главной: меньше — раньше. Первый featured — большая карточка.
      order: z.number().default(100),
      // true — демонстрационная заглушка. Удалить файл, когда появятся реальные проекты.
      placeholder: z.boolean().default(false),
    }),
});

export const collections = { projects };
