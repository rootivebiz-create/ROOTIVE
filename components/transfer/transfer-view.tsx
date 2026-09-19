"use client";

import { useState } from "react";
import { AlertTriangle, Download, Landmark } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Money } from "@/components/ui/money";
import { MonthLink } from "@/components/layout/month-link";
import { sumMoney } from "@/lib/calc";
import { exportUrls } from "@/lib/exports/urls";
import { formatDateJa } from "@/lib/month";
import { cn } from "@/lib/utils";
import type { TransferTarget } from "@/lib/exports/zengin";
import { TransferTable } from "./transfer-table";

export interface TransferViewProps {
  month: string;
  /** その月の税込支払額が 1 円以上のドライバー */
  targets: TransferTarget[];
  /** 取組日の初期値（?d= か、一番多い振込予定日） */
  transferDate: string;
  /** ドライバーごとの振込予定日（候補） */
  dateOptions: string[];
  /** 会社の振込元（fb_*）で足りない項目。空なら出力できる */
  companyMissing: string[];
  /** 振込元口座の表示 */
  companyAccountLabel: string;
  /** 委託者名（カナ）と委託者コードの表示 */
  consignorLabel: string;
  /** 会社設定を開ける（オーナーのみ） */
  canEditCompany: boolean;
}

/** 全銀フォーマットの振込データ：対象一覧・取組日の選択・ダウンロード */
export function TransferView({ month, targets, transferDate, dateOptions, companyMissing, companyAccountLabel, consignorLabel, canEditCompany }: TransferViewProps) {
  const [date, setDate] = useState(transferDate);

  const ready = targets.filter((t) => t.ready);
  const missing = targets.filter((t) => !t.ready);
  const total = sumMoney(ready.map((t) => t.amount));
  const companyReady = companyMissing.length === 0;
  const canDownload = companyReady && ready.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date);
  const otherDate = ready.filter((t) => t.payoutDate !== date).length;

  const downloadClass = cn(buttonVariants({ variant: "default" }), "w-full sm:w-auto");
  const csvClass = cn(buttonVariants({ variant: "outline" }), "w-full sm:w-auto");

  return (
    <div className="space-y-4">
      {/* 振込元（会社設定） */}
      {companyReady ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Landmark className="h-4 w-4" />
              振込元
            </CardTitle>
            <CardDescription>{consignorLabel}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-muted-foreground">{companyAccountLabel}</CardContent>
        </Card>
      ) : (
        <Alert variant="destructive">
          <AlertTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            振込元の情報が足りません
          </AlertTitle>
          <AlertDescription>
            <p>足りない項目：{companyMissing.join("・")}</p>
            <p className="mt-1">
              {canEditCompany ? (
                <MonthLink href="/settings/company" className="underline underline-offset-4">
                  会社設定で振込元口座を登録する
                </MonthLink>
              ) : (
                "会社設定（オーナーのみ）で振込元口座を登録してください。"
              )}
            </p>
          </AlertDescription>
        </Alert>
      )}

      {targets.length === 0 ? (
        <Empty
          title="この月に振込対象のドライバーはいません"
          description="稼働や調整を登録して税込支払額が 1 円以上になると、ここに振込データを作成できます。"
        />
      ) : (
        <>
          {/* 取組日・合計・ダウンロード */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="transfer-date">取組日（振込指定日）</Label>
                  <Input id="transfer-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" />
                  <p className="mt-1 text-xs text-muted-foreground">
                    ドライバーの振込予定日：{dateOptions.length > 0 ? dateOptions.map((d) => formatDateJa(d)).join("・") : "—"}
                  </p>
                </div>
                <div className="sm:text-right">
                  <p className="text-sm text-muted-foreground">全銀データに載る合計</p>
                  <p className="mt-1 text-2xl font-bold">
                    <Money value={total} />
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {ready.length} 件{missing.length > 0 && `（口座情報が足りない ${missing.length} 件は除外）`}
                  </p>
                </div>
              </div>

              {otherDate > 0 && (
                <Alert variant="warning">
                  振込予定日が取組日と違うドライバーが {otherDate} 名います。全銀データは 1 ファイルにつき取組日が 1 つなので、日付ごとに分けて振り込む場合は取組日を変えて 2 回ダウンロードしてください。
                </Alert>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                {canDownload ? (
                  <a href={`${exportUrls.transferTxt(month)}&d=${encodeURIComponent(date)}`} download className={downloadClass}>
                    <Download className="h-4 w-4" />
                    全銀データをダウンロード
                  </a>
                ) : (
                  <span aria-disabled="true" className={cn(downloadClass, "pointer-events-none opacity-50")}>
                    <Download className="h-4 w-4" />
                    全銀データをダウンロード
                  </span>
                )}
                <a href={exportUrls.transferCsv(month)} download className={csvClass}>
                  <Download className="h-4 w-4" />
                  一覧 CSV
                </a>
              </div>
              <p className="text-xs text-muted-foreground">
                全銀フォーマット（総合振込）・1 レコード 120 バイト・Shift_JIS。金額は税込の支払額です。ネットバンキングにアップロードする前に一覧 CSV で内容を確認してください。
              </p>
            </CardContent>
          </Card>

          {/* 口座情報が足りないドライバー */}
          {missing.length > 0 && (
            <Alert variant="warning">
              <AlertTitle className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                口座情報が足りないドライバー（{missing.length} 名）
              </AlertTitle>
              <AlertDescription>
                <p>この {missing.length} 名は全銀データに入りません。ドライバー設定で口座を登録してください。</p>
                <ul className="mt-2 space-y-1">
                  {missing.map((t) => (
                    <li key={t.driverId}>
                      <MonthLink href={`/settings/drivers/${t.driverId}`} className="underline underline-offset-4">
                        {t.driverName}
                      </MonthLink>
                      <span className="text-muted-foreground">：{t.missing.join("・")}</span>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <TransferTable targets={targets} transferDate={date} />
        </>
      )}
    </div>
  );
}
