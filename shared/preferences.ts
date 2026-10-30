import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const preferences = defineSettings({
  id: "preferences",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Once a chat continues in a project, archive the chat so it isn't in two places. */
    archiveAfterConnect: z.boolean().default(true),
    /** Tell agents started in Quick chats that there's no project, so they don't go looking for code. */
    noProjectNote: z.boolean().default(true),
  }),
});

export type Preferences = z.output<typeof preferences.schema>;
