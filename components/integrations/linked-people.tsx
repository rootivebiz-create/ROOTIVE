"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Unlink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTimeJa } from "@/lib/format";
import { unlinkLineAction } from "@/lib/actions/integrations";
import type { LinkedPerson } from "@/lib/integrations/types";

/** LINE と連携している人の一覧（ドライバー・スタッフ）と解除 */
export function LinkedPeople({ people }: { people: LinkedPerson[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<LinkedPerson | null>(null);

  const unlink = (person: LinkedPerson) => {
    startTransition(async () => {
      const res = await unlinkLineAction(person.kind === "driver" ? person.id : null);
      setTarget(null);
      if (res.ok) {
        toast.success(res.message ?? "連携を解除しました。");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  };

  if (people.length === 0) {
    return <p className="text-xs text-muted-foreground">まだ誰も連携していません。ドライバーには「アカウント」画面から合言葉を出してもらってください。</p>;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名前</TableHead>
            <TableHead>区分</TableHead>
            <TableHead>連携日</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {people.map((person) => (
            <TableRow key={`${person.kind}-${person.id}`}>
              <TableCell className="font-medium">{person.name}</TableCell>
              <TableCell>
                <Badge variant="secondary">{person.kind === "driver" ? "ドライバー" : "スタッフ"}</Badge>
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTimeJa(person.linkedAt)}</TableCell>
              <TableCell className="text-right">
                {person.canUnlink && (
                  <Button variant="outline" size="sm" onClick={() => setTarget(person)} disabled={pending}>
                    <Unlink /> 解除
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={target != null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>LINE の連携を解除しますか？</DialogTitle>
            <DialogDescription>
              {target?.name} さんへの LINE のお知らせが届かなくなります。もう一度つなぐには、新しい合言葉を出して送ってもらってください。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={pending}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={() => target && unlink(target)} disabled={pending}>
              {pending ? "解除中…" : "解除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
