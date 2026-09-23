"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { readCompare, writeCompare } from "@/components/product/product-actions";

/**
 * Keeps the local compare list and the URL in sync: an empty /compare URL
 * loads the saved list; a shared URL replaces the saved list.
 */
export function CompareSync({ ids }: { ids: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    if (ids.length > 0) {
      writeCompare(ids);
      return;
    }
    const saved = readCompare();
    if (saved.length > 0) router.replace(`${pathname}?ids=${saved.join(",")}`);
  }, [ids, pathname, router]);
  return null;
}
