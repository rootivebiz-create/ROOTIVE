/**
 * アラートの種類（code）ごとのアイコンと、重さごとの見た目
 * アイコン名は lib/alerts/helpers.ts の ALERT_CODE_INFO が正。ここでは名前 → 部品の対応だけを持つ。
 */
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Coins,
  FileCheck2,
  FileClock,
  FileWarning,
  Landmark,
  Receipt,
  ScrollText,
  ShieldAlert,
  Stamp,
  Tags,
  Target,
  Timer,
  TrendingDown,
  UserMinus,
  UserX,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { alertCodeInfo } from "@/lib/alerts/helpers";
import type { AlertSeverity } from "@/lib/db/types";
import type { BadgeProps } from "@/components/ui/badge";

const ICONS: Record<string, LucideIcon> = {
  AlertTriangle,
  Banknote,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Coins,
  FileCheck2,
  FileClock,
  FileWarning,
  Landmark,
  Receipt,
  ScrollText,
  ShieldAlert,
  Stamp,
  Tags,
  Target,
  Timer,
  TrendingDown,
  UserMinus,
  UserX,
  Wallet,
};

/** 種類に対応するアイコン（未知の種類は警告アイコン） */
export function alertIcon(code: string | null | undefined): LucideIcon {
  return ICONS[alertCodeInfo(code).icon] ?? AlertTriangle;
}

/** 重さのバッジ（重要 = 赤、注意 = 黄、参考 = グレー） */
export const SEVERITY_BADGE: Record<AlertSeverity, NonNullable<BadgeProps["variant"]>> = {
  high: "destructive",
  medium: "warning",
  low: "secondary",
};

/** 重さの文字色（件数の見出しなど） */
export const SEVERITY_TEXT: Record<AlertSeverity, string> = {
  high: "text-destructive",
  medium: "text-warning",
  low: "text-muted-foreground",
};
