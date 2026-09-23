import { z } from "zod";
import { emailSchema, roleSchema, uuidSchema } from "./common";
import type { Role } from "@/lib/db/types";
import { ACCESS_KEYS, type AccessChoice, type AccessKey } from "@/lib/auth/access";

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

/** ユーザーの基本（表示名・最初に開く画面）。代表が相手の分を直す */
export const updateUserBasicsSchema = z.object({
  userId: uuidSchema,
  displayName: displayNameSchema,
  startPage: z.enum(["dashboard", "office"], { message: "最初に開く画面を選んでください" }),
});

const accessChoiceSchema = z.enum(["role", "allow", "deny"], { message: "見せる範囲の選び方が正しくありません" });

/** 見せる範囲（0029）。項目ごとに ロールのとおり／見せる／見せない */
export const setUserAccessSchema = z.object({
  userId: uuidSchema,
  choices: z
    .record(z.string(), accessChoiceSchema)
    .refine((v) => Object.keys(v).every((k) => (ACCESS_KEYS as readonly string[]).includes(k)), { message: "見せる範囲の項目が正しくありません" })
    .transform((v) => v as Partial<Record<AccessKey, AccessChoice>>),
});

export type SetUserAccessInput = z.input<typeof setUserAccessSchema>;

/** 代表を譲る（0029）。譲ったあとの自分のロールと、確認のチェック */
export const transferOwnershipSchema = z.object({
  userId: uuidSchema,
  myRole: z.enum(["admin", "clerk", "viewer"], { message: "譲ったあとのあなたのロールを選んでください" }),
  acknowledged: z.literal(true, { message: "確認のチェックを入れてください" }),
});

export type TransferOwnershipInput = z.input<typeof transferOwnershipSchema>;
