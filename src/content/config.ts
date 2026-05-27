import { defineCollection, z } from "astro:content";

const spotlight = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    /** Optional cover image (path under /images/, e.g. "spotlight/foo.jpg"). Falls back to AsPEN logo. */
    image: z.string().optional(),
    /** Optional 1–2 sentence teaser used on the listing page. If omitted, derived from first paragraph. */
    excerpt: z.string().optional(),
    /** PMIDs of referenced papers. Each is looked up in publications.json
        and rendered as a PublicationCard at the foot of the spotlight,
        so reference formatting always matches /publications/. */
    references: z.array(z.string()).optional(),
  }),
});

export const collections = { spotlight };
