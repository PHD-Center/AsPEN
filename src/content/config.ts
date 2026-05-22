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
    /** Optional cover image (path under /images/, e.g. "spotlight/foo.jpg"). Falls back to AsPEN logo. */
    image: z.string().optional(),
    /** Optional 1–2 sentence teaser used on the listing page. If omitted, derived from first paragraph. */
    excerpt: z.string().optional(),
  }),
});

export const collections = { activities, spotlight };
