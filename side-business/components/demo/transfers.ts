/** 支払明細から振込データの行を作る（純関数）。口座がない方・振込額が 0 円以下の方は外して理由を付ける */
import type { Statement } from "@/lib/payroll/calc";
import type { Transfer, ZenginIssue } from "@/lib/payroll/zengin";

export type TransferRow =
  /** index は transfers の位置（validateTransfers の index と同じ） */
  | { kind: "transfer"; statement: Statement; transfer: Transfer; index: number }
  | { kind: "no-bank"; statement: Statement }
  | { kind: "no-amount"; statement: Statement };

export function transferRows(statements: Statement[]): { rows: TransferRow[]; transfers: Transfer[] } {
  const transfers: Transfer[] = [];
  const rows = statements.map((statement): TransferRow => {
    if (!(statement.total > 0)) return { kind: "no-amount", statement };
    const b = statement.driver.bank;
    if (!b) return { kind: "no-bank", statement };
    const transfer: Transfer = {
      bankCode: b.bankCode,
      bankNameKana: b.bankNameKana,
      branchCode: b.branchCode,
      branchNameKana: b.branchNameKana,
      accountType: b.accountType,
      accountNumber: b.accountNumber,
      holderKana: b.holderKana,
      amount: statement.total,
    };
    transfers.push(transfer);
    return { kind: "transfer", statement, transfer, index: transfers.length - 1 };
  });
  return { rows, transfers };
}

/** validateTransfers の結果を「依頼人」と「振込先の位置ごと」に分ける */
export function groupIssues(issues: ZenginIssue[]): { requester: string[]; byIndex: Map<number, string[]> } {
  const requester: string[] = [];
  const byIndex = new Map<number, string[]>();
  for (const issue of issues) {
    if (issue.index < 0) requester.push(issue.message);
    else byIndex.set(issue.index, [...(byIndex.get(issue.index) ?? []), issue.message]);
  }
  return { requester, byIndex };
}
