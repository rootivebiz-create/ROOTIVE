import { cn } from "@/lib/utils";

export function Empty({ title, description, className, children }: { title: string; description?: string; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center", className)}>
      <p className="font-medium">{title}</p>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
      {children}
    </div>
  );
}
