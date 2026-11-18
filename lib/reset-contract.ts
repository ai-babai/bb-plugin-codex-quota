import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const resetContract = defineRpcContract({
  availableResets: {
    input: z.object({
      accountKey: z.string(),
      includeExpiries: z.boolean().optional(),
    }).strict(),
    output: z.object({
      count: z.int().nonnegative().nullable(),
      expiries: z.array(z.int().nonnegative().nullable()).optional(),
    }).strict(),
    experimental_retryable: true,
  },
});
