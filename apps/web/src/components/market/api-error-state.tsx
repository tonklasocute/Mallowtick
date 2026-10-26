"use client";

import { RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StateMessage } from "@/components/ui/state-message";
import { isApiError } from "@/services/api/client";

const COPY: Record<string, { title: string; description: string }> = {
  provider_not_configured: {
    title: "ยังไม่ได้ตั้งค่าผู้ให้บริการข้อมูล",
    description:
      "ตั้งค่า TWELVEDATA_API_KEY ที่เซิร์ฟเวอร์ API ของ Mallowtick เพื่อโหลดข้อมูลตลาดจริง ระหว่างนี้จะไม่แสดงราคาตัวอย่างใด ๆ",
  },
  rate_limited: {
    title: "ขอพักหายใจแป๊บนึง",
    description: "เรียกข้อมูลเกินโควตาของแพ็กเกจข้อมูลตลาดแล้ว ลองใหม่อีกครั้งในอีกประมาณ 1 นาที",
  },
  not_found: {
    title: "ไม่พบข้อมูลของหุ้นตัวนี้",
    description: "ตรวจสอบชื่อย่อหุ้น หรือลองค้นหาด้วยชื่อบริษัท",
  },
  provider_not_entitled: {
    title: "ข้อมูลนี้ไม่อยู่ในแพ็กเกจ",
    description: "แพ็กเกจข้อมูลตลาดที่ตั้งค่าไว้ไม่ครอบคลุมข้อมูลนี้",
  },
  provider_auth_failed: {
    title: "ผู้ให้บริการข้อมูลปฏิเสธ API key",
    description: "ตรวจสอบ TWELVEDATA_API_KEY ที่เซิร์ฟเวอร์ API",
  },
  network_error: {
    title: "ดูเหมือนคุณจะออฟไลน์อยู่",
    description: "ตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง",
  },
  api_unreachable: {
    title: "เชื่อมต่อ API ของ Mallowtick ไม่ได้",
    description: "เซิร์ฟเวอร์ API ไม่ตอบสนองในขณะนี้",
  },
};

const FALLBACK = {
  title: "โหลดข้อมูลตลาดไม่ได้",
  description: "เกิดข้อผิดพลาดระหว่างโหลดข้อมูลตลาด",
};

export function errorCopy(error: unknown) {
  const code = isApiError(error) ? error.code : "";
  const copy = COPY[code] ?? FALLBACK;
  return { ...copy, code };
}

export function ApiErrorState({
  error,
  onRetry,
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  compact?: boolean;
}) {
  const { title, description, code } = errorCopy(error);
  return (
    <StateMessage
      tone="error"
      compact={compact}
      title={title}
      description={description}
      action={
        onRetry && code !== "provider_not_configured" ? (
          <Button onClick={onRetry}>
            <RotateCw aria-hidden className="size-4" /> ลองใหม่
          </Button>
        ) : undefined
      }
    />
  );
}
