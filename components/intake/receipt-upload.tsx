"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, Loader2, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NumberInput } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AI_SETUP_HINT } from "@/lib/ai/config";
import { createExpenseFromReceiptAction, deleteReceiptAction, readReceiptAction } from "@/lib/actions/intake";
import { taxExcludedAmount } from "@/lib/intake/helpers";
import { parseNumberInput } from "@/lib/calc/parse";
import type { TaxMode } from "@/lib/calc/types";
import type { ExpenseCategory } from "@/lib/db/types";
import { yen } from "@/lib/format";
import { formatMonthJa } from "@/lib/month";
import { MAX_RECEIPT_BYTES, RECEIPT_ACCEPT, RECEIPT_SUPPORT_TEXT, type ReceiptOcr } from "@/lib/schemas/intake";
import { EXPENSE_TAX_MODE_LABELS } from "@/lib/schemas/expenses";
import { confidenceLabel, formatBytes } from "./helpers";

export interface ReceiptUploadProps {
  /** 経費カテゴリ（停止中も含めてよい。選択肢は有効なものだけ出す） */
  categories: ExpenseCategory[];
  /** 登録する稼動月 "YYYY-MM" */
  month: string;
  /** 編集できるか（admin 以上かつ未締め）。false なら案内だけ出す */
  canEdit: boolean;
  /** AI が使えるか（ANTHROPIC_API_KEY の有無）。省略時は使える扱い */
  aiEnabled?: boolean;
}

interface FormState {
  amount: string;
  taxIncluded: boolean;
  incurredOn: string;
  vendor: string;
  categoryId: string;
  label: string;
  memo: string;
  taxMode: TaxMode;
}

interface ReadState {
  receiptPath: string;
  taxRate: number;
  ocr: ReceiptOcr | null;
  note: string;
}

const EMPTY_FORM: FormState = { amount: "", taxIncluded: true, incurredOn: "", vendor: "", categoryId: "", label: "", memo: "", taxMode: "taxable" };

/**
 * レシートを撮って経費を登録する部品（props だけで動く）。
 * 「読み取る」で画像を保存 ＋ AI が内容を読み取り、確認フォームで直してから登録する。
 */
export function ReceiptUpload({ categories, month, canEdit, aiEnabled = true }: ReceiptUploadProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reading, setReading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [read, setRead] = useState<ReadState | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeCategories = categories.filter((c) => c.is_active || c.id === form.categoryId);

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const reset = () => {
    setFile(null);
    setRead(null);
    setForm(EMPTY_FORM);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    if (selected && selected.size > MAX_RECEIPT_BYTES) {
      toast.error(`画像は ${MAX_RECEIPT_BYTES / 1024 / 1024}MB 以下にしてください（${formatBytes(selected.size)}）。`);
      reset();
      return;
    }
    // 読み取り済みの画像を残さない（別の画像を選び直したとき）
    const previous = read?.receiptPath;
    if (previous) void deleteReceiptAction(previous);
    setRead(null);
    setForm(EMPTY_FORM);
    setFile(selected);
  };

  const runRead = () => {
    if (!file) return;
    setReading(true);
    startTransition(async () => {
      const data = new FormData();
      data.append("file", file);
      const res = await readReceiptAction(data);
      setReading(false);
      if (!res.ok) {
        toast.error(res.error, { duration: 8000 });
        return;
      }
      const { receiptPath, taxRate, draft, note, read: ok } = res.data;
      setRead({ receiptPath, taxRate, ocr: ok ? draft : null, note });
      setForm({
        amount: draft.amount == null ? "" : String(draft.amount),
        taxIncluded: draft.tax_included !== false,
        incurredOn: draft.incurred_on ?? "",
        vendor: draft.vendor,
        categoryId: draft.category_id ?? "",
        label: draft.label || draft.vendor || "レシート",
        memo: "",
        taxMode: "taxable",
      });
      if (note) toast.warning(note, { duration: 8000 });
      else toast.success("レシートを読み取りました。内容を確認してください。");
    });
  };

  const save = () => {
    if (!read) return;
    startTransition(async () => {
      const res = await createExpenseFromReceiptAction({
        month,
        category_id: form.categoryId,
        label: form.label,
        amount: form.amount,
        tax_included: form.taxIncluded,
        tax_mode: form.taxMode,
        incurred_on: form.incurredOn,
        vendor: form.vendor,
        memo: form.memo,
        receipt_path: read.receiptPath,
        ocr: read.ocr,
      });
      if (!res.ok) {
        toast.error(res.error, { duration: 8000 });
        return;
      }
      toast.success(res.message ?? "登録しました。");
      reset();
      router.refresh();
    });
  };

  const discard = () => {
    const path = read?.receiptPath;
    if (!path) {
      reset();
      return;
    }
    startTransition(async () => {
      const res = await deleteReceiptAction(path);
      if (!res.ok) toast.error(res.error);
      reset();
    });
  };

  const amountValue = parseNumberInput(form.amount) ?? 0;
  const excluded = form.taxIncluded ? taxExcludedAmount(amountValue, read?.taxRate ?? 0) : amountValue;
  const monthMismatch = form.incurredOn !== "" && form.incurredOn.slice(0, 7) !== month;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera className="h-4 w-4" /> レシートから経費を登録
        </CardTitle>
        <CardDescription>
          レシートを撮る（または画像を選ぶ）と AI が金額・日付・支払先を読み取ります。内容を確認してから {formatMonthJa(month)} の経費として登録します。
          {RECEIPT_SUPPORT_TEXT}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canEdit && <Alert variant="warning">この月は登録できません（閲覧のみ、または締め済みの月です）。</Alert>}
        {canEdit && !aiEnabled && (
          <Alert variant="warning">
            {AI_SETUP_HINT}。設定が終わるまでレシートの自動読み取りは使えません（経費は経費画面から手で登録できます）。
          </Alert>
        )}

        {canEdit && (
          <div className="space-y-2">
            <Label htmlFor="receipt-file">レシートの画像</Label>
            <input
              ref={inputRef}
              id="receipt-file"
              type="file"
              accept={RECEIPT_ACCEPT}
              capture="environment"
              onChange={onFileChange}
              disabled={!aiEnabled || pending}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-muted"
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name}（{formatBytes(file.size)}）
              </p>
            )}
          </div>
        )}

        {previewUrl && (
          <div className="overflow-hidden rounded-md border">
            {/* ローカルで選んだ画像のプレビュー（next/image は使わない） */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="レシートのプレビュー" className="max-h-64 w-full object-contain" />
          </div>
        )}

        {canEdit && !read && (
          <Button onClick={runRead} disabled={!file || !aiEnabled || pending}>
            {reading ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {reading ? "レシートを読んでいます…" : "レシートを読み取る"}
          </Button>
        )}

        {read && (
          <div className="space-y-4 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">読み取った内容を確認してください</p>
              {read.ocr && <p className="text-xs text-muted-foreground">{confidenceLabel(read.ocr.confidence)}</p>}
            </div>
            {read.note && <Alert variant="warning">{read.note}</Alert>}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="receipt-amount">金額</Label>
                <NumberInput
                  id="receipt-amount"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0"
                  disabled={pending}
                />
                <p className="text-xs text-muted-foreground">
                  {form.taxIncluded ? `税抜 ${yen(excluded)} で登録します（経費は税抜で保存します）` : `税抜 ${yen(excluded)} として登録します`}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="receipt-tax">入力した金額</Label>
                <Select
                  id="receipt-tax"
                  value={form.taxIncluded ? "incl" : "excl"}
                  onChange={(e) => setForm({ ...form, taxIncluded: e.target.value === "incl" })}
                  disabled={pending}
                >
                  <option value="incl">税込</option>
                  <option value="excl">税抜</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="receipt-date">日付</Label>
                <Input id="receipt-date" type="date" value={form.incurredOn} onChange={(e) => setForm({ ...form, incurredOn: e.target.value })} disabled={pending} />
                {monthMismatch && <p className="text-xs text-warning">日付が {formatMonthJa(month)} 以外です。{formatMonthJa(month)} の経費として登録されます。</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="receipt-vendor">支払先</Label>
                <Input id="receipt-vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="店名" disabled={pending} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="receipt-category">カテゴリ</Label>
                <Select id="receipt-category" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} disabled={pending}>
                  <option value="">選択してください</option>
                  {activeCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="receipt-label">内容</Label>
                <Input id="receipt-label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="ガソリン代 など" disabled={pending} />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="receipt-tax-mode">課税区分</Label>
                <Select
                  id="receipt-tax-mode"
                  value={form.taxMode}
                  onChange={(e) => setForm({ ...form, taxMode: e.target.value as TaxMode })}
                  disabled={pending}
                >
                  {(Object.keys(EXPENSE_TAX_MODE_LABELS) as TaxMode[]).map((m) => (
                    <option key={m} value={m}>
                      {EXPENSE_TAX_MODE_LABELS[m]}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="receipt-memo">メモ</Label>
                <Textarea id="receipt-memo" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} rows={2} disabled={pending} />
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={save} disabled={pending || !form.categoryId || form.label.trim() === "" || form.amount.trim() === ""}>
                <Check /> {pending ? "登録中…" : "この内容で登録"}
              </Button>
              <Button variant="outline" onClick={runRead} disabled={pending || !file}>
                <RefreshCw /> もう一度読み取る
              </Button>
              <Button variant="ghost" className="text-destructive" onClick={discard} disabled={pending}>
                <Trash2 /> 取りやめる（画像を削除）
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
