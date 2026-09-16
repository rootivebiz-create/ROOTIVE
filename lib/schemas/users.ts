import { z } from "zod";
import { emailSchema, roleSchema, uuidSchema } from "./common";
import type { Role } from "@/lib/db/types";

/** 「＋ ユーザーを招待」フォームの入力 */
export interface InviteUserInput {
  email: string;
  role: Role;
  /** role が driver のときの対応ドライバー */
  driverId?: string | null;
  displayName?: string;
  /** Supabase の招待メールも送るか（招待リンクは常に発行される） */
  sendEmail: boolean;
}

const optionalUuid = z.preprocess((v) => (v === "" || v == null ? null : v), uuidSchema.nullable());

const displayNameSchema = z.preprocess((v) => (v == null ? "" : v), z.string().trim().max(50, "表示名は 50 文字以内で入力してください"));

/** driver ロールには対応ドライバーが必須。それ以外のロールではドライバーを持たない */
function normalizeDriverForRole<T extends { role: Role; driverId: string | null }>(v: T): T {
  return v.role === "driver" ? v : { ...v, driverId: null };
}

const driverRequired = (v: { role: Role; driverId: string | null }) => v.role !== "driver" || v.driverId != null;

export const inviteUserSchema = z
  .object({
    email: emailSchema,
    role: roleSchema,
    driverId: optionalUuid,
    displayName: displayNameSchema,
    sendEmail: z.boolean().default(true),
  })
  .refine(driverRequired, { message: "ドライバーロールには対応するドライバーを選択してください", path: ["driverId"] })
  .transform(normalizeDriverForRole);

export type InviteUserParsed = z.output<typeof inviteUserSchema>;

export const resendInvitationSchema = z.object({
  invitationId: uuidSchema,
  sendEmail: z.boolean().default(false),
});

export const cancelInvitationSchema = z.object({ invitationId: uuidSchema });

export const updateUserRoleSchema = z
  .object({
    userId: uuidSchema,
    role: roleSchema,
    driverId: optionalUuid,
  })
  .refine(driverRequired, { message: "ドライバーロールには対応するドライバーを選択してください", path: ["driverId"] })
  .transform(normalizeDriverForRole);

export type UpdateUserRoleParsed = z.output<typeof updateUserRoleSchema>;

export const setUserActiveSchema = z.object({
  userId: uuidSchema,
  isActive: z.boolean(),
});
