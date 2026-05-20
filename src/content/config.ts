import { defineCollection, z } from "astro:content";

const activities = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    year: z.number().optional(),
    order: z.number().optional(),
  }),
});

const spotlight = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
  }),
});

export const collections = { activities, spotlight };
