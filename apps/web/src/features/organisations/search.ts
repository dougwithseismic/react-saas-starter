import { z } from "zod";
export const organisationSearch = z.object({
  organisationId: z.string().max(200).optional(),
});
