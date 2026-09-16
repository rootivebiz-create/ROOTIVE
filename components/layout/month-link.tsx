"use client";

import Link from "next/link";
import { useMonth } from "@/lib/hooks/use-month";
import type { ComponentProps } from "react";

/** 現在の稼動月（?m=）を引き継ぐリンク */
export function MonthLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const { href: withMonth } = useMonth();
  return <Link href={withMonth(href)} {...props} />;
}
