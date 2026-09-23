/**
 * 明細の 2 つの版の違いを、ドライバーにも読める短い文にする（純関数。DB に触らない）。
 * 比べるのはドライバーに見せる形（DriverStatementView）どうしだけ（会社の売上などは入らない）。
 * - 委託料の行は案件（projectId）、控除はルール（ruleId）で突き合わせる
 * - 調整は並び順が変わることがあるので、名前と金額で突き合わせる
 */
import { en } from "@/lib/engine/types";
import { jpDateWithWeekday, qtyText, unitPriceText, type DriverStatementView } from "~/server/features/statements/view";

function signed(v: number): string {
  return v > 0 ? `＋${en(v)}` : en(v);
}

export function describeChanges(before: DriverStatementView, after: DriverStatementView): string[] {
  const out: string[] = [];

  // 委託料の行
  const oldLines = new Map(before.lines.map((l) => [l.key, l]));
  const newKeys = new Set(after.lines.map((l) => l.key));
  for (const l of after.lines) {
    const p = oldLines.get(l.key);
    if (!p) {
      out.push(`${l.project}：${qtyText(l.qty)}${l.unit} × ${unitPriceText(l.rate)} ＝ ${en(l.amount)} が加わりました`);
      continue;
    }
    if (p.qty === l.qty && p.rate === l.rate && p.amount === l.amount) continue;
    const parts: string[] = [];
    if (p.qty !== l.qty) parts.push(`数量 ${qtyText(p.qty)} → ${qtyText(l.qty)}${l.unit}`);
    if (p.rate !== l.rate) parts.push(`単価 ${unitPriceText(p.rate)} → ${unitPriceText(l.rate)}`);
    parts.push(`金額 ${en(p.amount)} → ${en(l.amount)}`);
    out.push(`${l.project}：${parts.join("、")}`);
  }
  for (const p of before.lines) if (!newKeys.has(p.key)) out.push(`${p.project}（${en(p.amount)}）がなくなりました`);

  // 引かれているもの（控除）
  const oldDeds = new Map(before.deductions.map((d) => [d.key, d]));
  const newDedKeys = new Set(after.deductions.map((d) => d.key));
  for (const d of after.deductions) {
    const p = oldDeds.get(d.key);
    if (!p) out.push(`引かれているもの「${d.name}」${en(d.amount)} が加わりました`);
    else if (p.amount !== d.amount) out.push(`引かれているもの「${d.name}」：${en(p.amount)} → ${en(d.amount)}`);
  }
  for (const p of before.deductions) if (!newDedKeys.has(p.key)) out.push(`引かれているもの「${p.name}」（${en(p.amount)}）がなくなりました`);

  // 調整（名前と金額が同じものは、同じものとみなす）
  const pool = new Map<string, number>();
  const keyOf = (a: { label: string; amount: number }) => `${a.label}\u0000${a.amount}`;
  for (const a of before.adjustments) pool.set(keyOf(a), (pool.get(keyOf(a)) ?? 0) + 1);
  const added: { label: string; amount: number }[] = [];
  for (const a of after.adjustments) {
    const n = pool.get(keyOf(a)) ?? 0;
    if (n > 0) pool.set(keyOf(a), n - 1);
    else added.push(a);
  }
  for (const a of added) out.push(`調整「${a.label}」${signed(a.amount)} が加わりました`);
  for (const a of before.adjustments) {
    const n = pool.get(keyOf(a)) ?? 0;
    if (n > 0) {
      pool.set(keyOf(a), n - 1);
      out.push(`調整「${a.label}」（${signed(a.amount)}）がなくなりました`);
    }
  }

  // 税・源泉・振込予定日・記載事項
  if (before.tax !== after.tax) {
    const label = after.taxLabel ?? before.taxLabel ?? "消費税";
    out.push(`${label}：${en(before.tax)} → ${after.taxLabel ? en(after.tax) : "なし"}`);
  }
  const wb = before.withholding?.amount ?? 0;
  const wa = after.withholding?.amount ?? 0;
  if (wb !== wa) out.push(`源泉徴収：${en(wb)} → ${en(wa)}`);
  if (before.payDate !== after.payDate) out.push(`振込予定日：${jpDateWithWeekday(before.payDate)} → ${jpDateWithWeekday(after.payDate)}`);
  if (before.driver.registrationNo !== after.driver.registrationNo) {
    out.push(`登録番号：${before.driver.registrationNo ?? "なし"} → ${after.driver.registrationNo ?? "なし"}`);
  }
  if (before.title !== after.title) out.push(`明細の名前：${before.title} → ${after.title}`);

  if (before.total !== after.total) out.push(`お振込額：${en(before.total)} → ${en(after.total)}（${signed(after.total - before.total)}）`);
  if (out.length === 0) out.push("金額は変わっていません（名前や注記など、記載の内容が変わりました）");
  return out;
}
