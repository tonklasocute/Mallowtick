"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";

import { IconButton } from "@/components/ui/button";

/** The round back button of secondary screens; opens `fallback` when there is no history. */
export function BackButton({ fallback = "/" }: { fallback?: string }) {
  const router = useRouter();
  return (
    <IconButton
      label="ย้อนกลับ"
      className="size-11 border border-line bg-surface"
      onClick={() => (window.history.length > 1 ? router.back() : router.push(fallback))}
    >
      <ChevronLeft aria-hidden className="size-5" strokeWidth={2.4} />
    </IconButton>
  );
}
