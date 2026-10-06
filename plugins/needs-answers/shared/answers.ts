import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const AnswerRowSchema = z.object({
  /** Position in the combined `log.1` + `log` stream; higher is newer. */
  order: z.number(),
  time: z.string(),
  label: z.string(),
  text: z.string(),
});

export type AnswerRow = z.infer<typeof AnswerRowSchema>;

export const AnswersForCwdSchema = z.object({
  /** The cwd as requested, or the canonical key when listing every key. */
  cwd: z.string(),
  key: z.string(),
  unread: z.array(AnswerRowSchema),
  recent: z.array(AnswerRowSchema),
});

export type AnswersForCwd = z.infer<typeof AnswersForCwdSchema>;

export const answersListRpc = defineRpc({
  name: "answers.list",
  input: z.object({ cwds: z.array(z.string()).optional() }),
  output: z.object({ cwds: z.array(AnswersForCwdSchema) }),
});

export const answersMarkReadRpc = defineRpc({
  name: "answers.mark_read",
  input: z.object({ cwd: z.string().min(1) }),
  output: z.object({}),
});
