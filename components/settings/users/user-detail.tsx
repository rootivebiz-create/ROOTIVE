"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Crown, Eye, KeyRound, Link2, Save, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  inviteUserAction,
  setUserAccessAction,
  setUserActiveAction,
  transferOwnershipAction,
  updateUserBasicsAction,
  updateUserRoleAction,
  type InvitationResult,
} from "@/lib/actions/users";
import {
  ACCESS_CHOICE_LABELS,
  ACCESS_DESCRIPTIONS,
  ACCESS_KEYS,
  ACCESS_LABELS,
  ROLE_SUMMARIES,
  canCustomizeAccess,
  effectiveAccess,
  isAccessMoot,
  roleAccess,
  type AccessChoice,
  type AccessKey,
  type AccessOverrides,
} from "@/lib/auth/access";
import { LOGIN_EVENT_LABELS, ROLE_LABELS, type ConfidentialScope, type LoginEventKind, type Role } from "@/lib/db/types";
import { formatDateTimeJa } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "./confirm-dialog";
import { InviteResultDialog } from "./invite-link";
import type { DriverOption } from "./invite-dialog";

export interface UserDetailData {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  driverId: string | null;
  driverName: string | null;
  isActive: boolean;
  startPage: "dashboard" | "office";
  lastSignInAt: string | null;
  createdAt: string;
  overrides: AccessOverrides;
}

export interface UserLoginRow {
  id: string;
  at: string;
  kind: LoginEventKind;
  device: string;
  ip: string;
}

const ROLES: Role[] = ["owner", "admin", "clerk", "viewer", "driver"];
const CHOICES: AccessChoice[] = ["role", "allow", "deny"];
const AFTER_ROLES = ["admin", "clerk", "viewer"] as const;
type AfterRole = (typeof AFTER_ROLES)[number];

function choicesFrom(overrides: AccessOverrides): Record<AccessKey, AccessChoice> {
  return Object.fromEntries(ACCESS_KEYS.map((k) => [k, overrides[k] ?? "role"])) as Record<AccessKey, AccessChoice>;
}

function onOff(v: boolean): string {
  return v ? "見える" : "見えない";
}

/** ロールのとおり／見せる／見せない を横に並べた切り替え（スマホでも 1 行に収まる） */
function ChoiceGroup({
  name,
  value,
  onChange,
  roleDefault,
  disabled,
}: {
  name: string;
  value: AccessChoice;
  onChange: (v: AccessChoice) => void;
  roleDefault: boolean;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="grid grid-cols-3 gap-1 rounded-md border bg-muted/40 p-1">
      {CHOICES.map((c) => {
        const checked = value === c;
        const label = c === "role" ? `${ACCESS_CHOICE_LABELS.role}（${onOff(roleDefault)}）` : ACCESS_CHOICE_LABELS[c];
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(c)}
            className={cn(
              "min-h-9 rounded px-1.5 py-1 text-xs leading-tight transition-colors disabled:opacity-50",
              checked ? (c === "deny" ? "bg-destructive text-destructive-foreground" : c === "allow" ? "bg-primary text-primary-foreground" : "bg-card shadow-sm") : "text-muted-foreground hover:bg-card",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function UserDetail({
  user,
  self,
  drivers,
  scope,
  lastSignInAvailable,
  logins,
  loginsAvailable,
}: {
  user: UserDetailData;
  self: boolean;
  drivers: DriverOption[];
  scope: ConfidentialScope;
  lastSignInAvailable: boolean;
  logins: UserLoginRow[];
  loginsAvailable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const name = user.displayName || user.email;

  // ---- 基本 ----
  const [displayName, setDisplayName] = useState(user.displayName);
  const [startPage, setStartPage] = useState<"dashboard" | "office">(user.startPage);
  const canOffice = user.role === "owner" || user.role === "admin" || user.role === "clerk";

  // ---- ロール ----
  const [role, setRole] = useState<Role>(user.role);
  const [driverId, setDriverId] = useState(user.driverId ?? "");

  // ---- 見せる範囲 ----
  const [choices, setChoices] = useState<Record<AccessKey, AccessChoice>>(choicesFrom(user.overrides));
  const base = useMemo(() => roleAccess(user.role, scope), [user.role, scope]);
  const preview = useMemo(() => {
    const ov: AccessOverrides = {};
    for (const k of ACCESS_KEYS) if (choices[k] !== "role") ov[k] = choices[k] as "allow" | "deny";
    return effectiveAccess(user.role, ov, scope);
  }, [choices, user.role, scope]);
  const accessDirty = ACCESS_KEYS.some((k) => choices[k] !== (user.overrides[k] ?? "role"));

  // ---- 状態・招待リンク ----
  const [confirmInactive, setConfirmInactive] = useState(false);
  const [linkResult, setLinkResult] = useState<InvitationResult | null>(null);

  // ---- 代表を譲る ----
  const [transferOpen, setTransferOpen] = useState(false);
  const [afterRole, setAfterRole] = useState<AfterRole>("admin");
  const [acknowledged, setAcknowledged] = useState(false);
  const canTransfer = !self && user.isActive && user.role !== "driver" && user.role !== "owner";

  const done = (res: { ok: boolean; message?: string; error?: string }, fallback: string) => {
    if (res.ok) {
      toast.success(res.message ?? fallback);
      router.refresh();
      return true;
    }
    toast.error(res.error ?? "保存できませんでした。");
    return false;
  };

  const saveBasics = () =>
    startTransition(async () => {
      done(await updateUserBasicsAction({ userId: user.id, displayName, startPage }), "保存しました。");
    });

  const saveRole = () =>
    startTransition(async () => {
      done(await updateUserRoleAction(user.id, role, role === "driver" ? driverId : null), "ロールを変更しました。");
    });

  const saveAccess = () =>
    startTransition(async () => {
      done(await setUserAccessAction({ userId: user.id, choices }), "見せる範囲を保存しました。");
    });

  const toggleActive = () =>
    startTransition(async () => {
      if (done(await setUserActiveAction(user.id, !user.isActive), "更新しました。")) setConfirmInactive(false);
    });

  const reissueLink = () =>
    startTransition(async () => {
      const res = await inviteUserAction({ email: user.email, role: user.role, driverId: user.driverId, displayName: user.displayName, sendEmail: false });
      if (res.ok) {
        setLinkResult(res.data);
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });

  const transfer = () =>
    startTransition(async () => {
      const res = await transferOwnershipAction({ userId: user.id, myRole: afterRole, acknowledged: acknowledged as true });
      if (res.ok) {
        toast.success(res.message ?? "代表を譲りました。");
        setTransferOpen(false);
        // もう代表ではないので、入れる画面から開き直す（ナビ・権限を読み直す）
        window.location.assign("/");
      } else {
        toast.error(res.error);
      }
    });

  const selectableDrivers = drivers.filter((d) => d.isActive || d.id === user.driverId);

  return (
    <div className="space-y-4">
      {/* ---------- 基本 ---------- */}
      <Card id="basics">
        <CardHeader>
          <CardTitle>基本</CardTitle>
          <CardDescription>表示名はチャット・承認の記録・明細の送付に出る名前です。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="user-display-name">表示名</Label>
            <Input id="user-display-name" value={displayName} maxLength={50} onChange={(e) => setDisplayName(e.target.value)} disabled={pending} />
          </div>
          <div className="space-y-1.5">
            <Label>メール</Label>
            <p className="break-all text-sm">{user.email}</p>
            <p className="text-xs text-muted-foreground">ログインに使うメールは変えられません。変えるときは新しいメールで招待し、こちらを無効にします。</p>
          </div>
          {user.role !== "driver" && (
            <div className="space-y-1.5">
              <Label htmlFor="user-start-page">最初に開く画面</Label>
              <Select id="user-start-page" value={startPage} onChange={(e) => setStartPage(e.target.value as "dashboard" | "office")} disabled={pending || user.role === "clerk"}>
                <option value="dashboard">ホーム</option>
                {canOffice && <option value="office">事務</option>}
              </Select>
              {user.role === "clerk" && <p className="text-xs text-muted-foreground">事務員はいつも事務の画面から始まります。</p>}
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={saveBasics} disabled={pending || (displayName === user.displayName && startPage === user.startPage)}>
              <Save /> 保存する
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---------- ロール ---------- */}
      <Card id="role">
        <CardHeader>
          <CardTitle>ロール</CardTitle>
          <CardDescription>ロールで、できること（登録・編集・月締め・設定）と、見える範囲の基本が決まります。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {self ? (
            <Alert>
              <AlertDescription>自分のロールは変えられません。ほかの人を代表にするときは、その人の画面の「代表を譲る」から行います。</AlertDescription>
            </Alert>
          ) : null}
          <div role="radiogroup" aria-label="ロール" className="space-y-2">
            {ROLES.map((r) => (
              <label
                key={r}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm",
                  role === r ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                  (pending || self) && "cursor-not-allowed opacity-60",
                )}
              >
                <input type="radio" name="user-role" value={r} checked={role === r} onChange={() => setRole(r)} disabled={pending || self} className="mt-1 h-4 w-4 accent-primary" />
                <span className="min-w-0">
                  <span className="font-medium">{ROLE_LABELS[r]}</span>
                  <span className="block text-xs text-muted-foreground">{ROLE_SUMMARIES[r]}</span>
                </span>
              </label>
            ))}
          </div>
          {role === "driver" && (
            <div className="space-y-1.5">
              <Label htmlFor="user-driver">対応ドライバー</Label>
              <Select id="user-driver" value={driverId} onChange={(e) => setDriverId(e.target.value)} disabled={pending || self}>
                <option value="">選択してください</option>
                {selectableDrivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                    {!d.isActive ? "（停止中）" : ""}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {role === "owner" && role !== user.role && (
            <p className="text-xs text-muted-foreground">代表が 2 人になります。自分が代表を外れるときは、下の「代表を譲る」を使います。</p>
          )}
          <div className="flex justify-end">
            <Button onClick={saveRole} disabled={pending || self || (role === user.role && (role !== "driver" || driverId === (user.driverId ?? ""))) || (role === "driver" && !driverId)}>
              <Save /> ロールを変える
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---------- 見せる範囲 ---------- */}
      <Card id="access">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" aria-hidden="true" />
            見せる範囲
          </CardTitle>
          <CardDescription>
            ロールの基本に加えて、この人だけ見せる・見せないを決められます。画面だけでなくデータの読み取り（出力は出力の口）でも止まります。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {user.role === "owner" ? (
            <Alert>
              <AlertDescription>代表はいつもすべて見られます（個別の設定はありません）。</AlertDescription>
            </Alert>
          ) : user.role === "driver" ? (
            <Alert>
              <AlertDescription>ドライバーは自分の報告・予定・明細だけを見ます。会社の数字は見せられません。</AlertDescription>
            </Alert>
          ) : self ? (
            <Alert>
              <AlertDescription>自分の見せる範囲は変えられません。</AlertDescription>
            </Alert>
          ) : null}
          <ul className="space-y-3">
            {ACCESS_KEYS.map((key) => {
              const editable = canCustomizeAccess(user.role) && !self;
              const on = preview[key];
              return (
                <li key={key} className="space-y-1.5 rounded-md border p-3" data-access-row={key}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{ACCESS_LABELS[key]}</p>
                      <p className="text-xs text-muted-foreground">{ACCESS_DESCRIPTIONS[key]}</p>
                    </div>
                    <Badge variant={on ? "success" : "secondary"} className="shrink-0" data-result={on ? "on" : "off"}>
                      {onOff(on)}
                    </Badge>
                  </div>
                  {editable && <ChoiceGroup name={ACCESS_LABELS[key]} value={choices[key]} roleDefault={base[key]} onChange={(v) => setChoices((c) => ({ ...c, [key]: v }))} disabled={pending} />}
                  {on && isAccessMoot(key, preview) && <p className="text-xs text-muted-foreground">経営の数字が見えないため、見る画面がありません（財務・資金繰りの中にあります）。</p>}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            借入・現金・振込口座を「ロールごとに」どこまで見せるかは、会社全体の設定（
            <Link href="/executive/security" className="text-primary underline-offset-2 hover:underline">
              代表 → 守り → 機密の見せ方
            </Link>
            ）で決めます。ここはその上にこの人だけの例外を重ねます。
          </p>
          {canCustomizeAccess(user.role) && !self && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => setChoices(choicesFrom({}))} disabled={pending || ACCESS_KEYS.every((k) => choices[k] === "role")}>
                すべてロールのとおりに戻す
              </Button>
              <Button onClick={saveAccess} disabled={pending || !accessDirty}>
                <Save /> 見せる範囲を保存
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------- 状態 ---------- */}
      <Card id="status">
        <CardHeader>
          <CardTitle>状態</CardTitle>
          <CardDescription>無効にすると、ログインしてもデータに入れなくなります。記録（稼働・承認・チャット）は残ります。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">状態</dt>
            <dd className="text-right">{user.isActive ? <Badge variant="success">有効</Badge> : <Badge variant="destructive">無効</Badge>}</dd>
            <dt className="text-muted-foreground">最終ログイン</dt>
            <dd className="text-right">{!lastSignInAvailable ? "—" : user.lastSignInAt ? <span className="num">{formatDateTimeJa(user.lastSignInAt)}</span> : <Badge variant="warning">未ログイン</Badge>}</dd>
            <dt className="text-muted-foreground">登録</dt>
            <dd className="num text-right">{formatDateTimeJa(user.createdAt)}</dd>
          </dl>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={reissueLink} disabled={pending} title="招待リンクを再発行して直接送れます（まだログインしていない人向け）">
              <Link2 /> 招待リンクを再発行
            </Button>
            {user.isActive ? (
              <Button variant="outline" onClick={() => setConfirmInactive(true)} disabled={pending || self}>
                <UserMinus /> 無効にする
              </Button>
            ) : (
              <Button variant="outline" onClick={toggleActive} disabled={pending || self}>
                <UserPlus /> 有効に戻す
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ---------- 代表を譲る ---------- */}
      {!self && user.role !== "driver" && (
        <Card id="transfer" className="border-amber-300/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5" aria-hidden="true" />
              代表を譲る
            </CardTitle>
            <CardDescription>
              {name}さんを代表にし、あなたは選んだロールになります。代表の画面（決裁・意思決定・会社の台帳・中期計画・守り）とユーザー管理は{name}さんだけが使えるようになります。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {user.role === "owner" ? (
              <p className="text-sm text-muted-foreground">{name}さんはすでに代表です。</p>
            ) : !user.isActive ? (
              <p className="text-sm text-muted-foreground">無効にしている人には譲れません。先に有効に戻してください。</p>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">
                  一時的に決裁を任せるだけなら、譲らずに「代表 → 守り → 決裁の委任」を使います（期間と上限金額を決めて任せられます）。
                </p>
                <div className="flex justify-end">
                  <Button variant="outline" onClick={() => setTransferOpen(true)} disabled={pending || !canTransfer}>
                    <KeyRound /> 代表を譲る…
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------- 最近のログイン ---------- */}
      <Card id="logins">
        <CardHeader>
          <CardTitle>最近のログイン</CardTitle>
          <CardDescription>直近 10 件です。見覚えのない端末があれば、無効にしてから本人に確かめてください。</CardDescription>
        </CardHeader>
        <CardContent>
          {!loginsAvailable ? (
            <p className="text-sm text-muted-foreground">ログインの記録を読めませんでした。</p>
          ) : logins.length === 0 ? (
            <p className="text-sm text-muted-foreground">記録はまだありません。</p>
          ) : (
            <ul className="divide-y text-sm">
              {logins.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2">
                  <span className="num">{formatDateTimeJa(l.at)}</span>
                  <span className="text-muted-foreground">
                    {LOGIN_EVENT_LABELS[l.kind]}・{l.device || "不明な端末"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmInactive}
        onOpenChange={setConfirmInactive}
        title="ユーザーを無効にしますか？"
        description={`${name}（${user.email}）はログインしてもデータにアクセスできなくなります。あとから有効に戻せます。`}
        confirmLabel="無効にする"
        destructive
        pending={pending}
        onConfirm={toggleActive}
      />

      <InviteResultDialog result={linkResult} onClose={() => setLinkResult(null)} title="招待リンクを再発行しました" />

      <Dialog open={transferOpen} onOpenChange={(o) => !pending && setTransferOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{name}さんに代表を譲りますか？</DialogTitle>
            <DialogDescription>譲ると、あなたはすぐに代表ではなくなります。元に戻すには、新しい代表にもう一度譲ってもらう必要があります。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="after-role">譲ったあとのあなたのロール</Label>
              <Select id="after-role" value={afterRole} onChange={(e) => setAfterRole(e.target.value as AfterRole)} disabled={pending}>
                {AFTER_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">{ROLE_SUMMARIES[afterRole]}</p>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} disabled={pending} aria-label="代表の画面とユーザー管理が使えなくなることを確認しました" className="mt-0.5" />
              <span>代表の画面（決裁・意思決定・会社の台帳・中期計画・守り）とユーザー管理が使えなくなることを確認しました。</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTransferOpen(false)} disabled={pending}>
              やめる
            </Button>
            <Button variant="destructive" onClick={transfer} disabled={pending || !acknowledged}>
              {pending ? "譲っています…" : `${name}さんに代表を譲る`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
