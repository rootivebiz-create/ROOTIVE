"use client";

import { useState } from "react";
import { Mail, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useRun } from "@/components/office/use-run";
import { sendInvoiceMailAction } from "@/lib/actions/invoice-mail";
import { formatDateTimeJa } from "@/lib/format";
import { emailListError, normalizeEmailList } from "@/lib/mail/address";
import { invoiceMailSubject } from "@/lib/mail/invoice";
import type { InvoiceData } from "@/lib/invoice";

export interface InvoiceSendRow {
  id: string;
  toEmail: string;
  status: "sent" | "failed";
  error: string;
  sentAt: string;
  sentByName: string;
}

/**
 * 請求書をメールで送る（0028）。宛先は取引先の送り先が入った状態で開く。
 * 下書きは発行してから送る（送ったあとで金額が変わらないように）。
 */
export function InvoiceMailCard({
  invoice,
  companyName,
  sends,
  editable,
  mailEnabled,
}: {
  invoice: InvoiceData;
  companyName: string;
  sends: InvoiceSendRow[];
  editable: boolean;
  mailEnabled: boolean;
}) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(invoice.client.email);
  const [message, setMessage] = useState("");
  const [remember, setRemember] = useState(!invoice.client.email);
  const isDraft = invoice.status === "draft";
  const lastSent = sends.find((s) => s.status === "sent");
  const err = to.trim() ? emailListError(to) : "宛先のメールアドレスを入力してください";
  const changed = normalizeEmailList(to) !== normalizeEmailList(invoice.client.email);

  if (!mailEnabled && sends.length === 0) return null;

  return (
    <Card id="mail">
      <CardHeader className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            メールで送る
          </CardTitle>
          {lastSent ? (
            <Badge variant="success" data-testid="invoice-mail-status">
              送信済み（{formatDateTimeJa(lastSent.sentAt)}）
            </Badge>
          ) : (
            <Badge variant="secondary" data-testid="invoice-mail-status">
              まだ送っていません
            </Badge>
          )}
        </div>
        <CardDescription>
          請求書の PDF を添付して、取引先へメールで送ります。{isDraft ? "下書きのままなので、送るときに発行します（発行すると作り直せません）。" : ""}
          {invoice.client.email ? `送り先：${invoice.client.email}` : "取引先の送り先メールがまだ登録されていません。"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {editable && mailEnabled && (
          <Button
            onClick={() => {
              setTo(invoice.client.email);
              setMessage("");
              setRemember(!invoice.client.email);
              setOpen(true);
            }}
            disabled={pending || invoice.items.length === 0}
          >
            <Send />
            {isDraft ? "発行してメールで送る…" : lastSent ? "もう一度送る…" : "メールで送る…"}
          </Button>
        )}
        {!mailEnabled && <p className="text-xs text-muted-foreground">メールの送信が設定されていないため、いまは送れません（RESEND_API_KEY と MAIL_FROM）。</p>}
        {sends.length > 0 && (
          <ul className="-mx-2 divide-y text-sm" aria-label="送信の記録">
            {sends.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1.5" data-send-status={s.status}>
                <Badge variant={s.status === "sent" ? "success" : "destructive"}>{s.status === "sent" ? "送信" : "失敗"}</Badge>
                <span className="num text-xs text-muted-foreground">{formatDateTimeJa(s.sentAt)}</span>
                <span className="min-w-0 flex-1 break-all">{s.toEmail}</span>
                <span className="text-xs text-muted-foreground">{s.sentByName}</span>
                {s.status === "failed" && s.error && <span className="w-full text-xs text-destructive">{s.error}</span>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>請求書をメールで送る</DialogTitle>
            <DialogDescription>
              {invoice.client.name} {invoice.client.honorific} へ、{invoice.monthLabel}分の請求書（PDF）を送ります。
              {isDraft ? " 送る前に発行します。" : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="invoice-mail-to">宛先</Label>
              <Input id="invoice-mail-to" type="email" inputMode="email" multiple value={to} onChange={(e) => setTo(e.target.value)} disabled={pending} placeholder="keiri@example.co.jp" />
              {err && to.trim() && <p className="text-xs text-destructive">{err}</p>}
              {changed && !err && (
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} aria-label="この宛先を取引先の送り先として覚える" />
                  この宛先を取引先の送り先として覚える
                </label>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">件名</p>
              <p className="rounded-md bg-muted px-3 py-2 text-sm">{invoiceMailSubject({ companyName, monthLabel: invoice.monthLabel, invoiceNo: invoice.invoiceNo })}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invoice-mail-message">ひとこと（任意。本文の金額の下に入ります）</Label>
              <Textarea id="invoice-mail-message" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={1000} disabled={pending} placeholder="例：今月から単価が変わっております。" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              やめる
            </Button>
            <Button
              onClick={() => run(() => sendInvoiceMailAction({ id: invoice.id, to, message, remember: changed && remember }), "送りました", () => setOpen(false))}
              disabled={pending || Boolean(err)}
              aria-busy={pending}
            >
              <Send />
              {isDraft ? "発行して送る" : "送る"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
