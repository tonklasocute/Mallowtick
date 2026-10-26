const LABELS: Record<string, string> = {
  not_found: "ไม่พบหุ้นนี้",
  rate_limited: "เกินโควตาการเรียกข้อมูล",
  provider_not_entitled: "ไม่อยู่ในแพ็กเกจข้อมูล",
  provider_auth_failed: "ผู้ให้บริการปฏิเสธ key",
  provider_not_configured: "ยังไม่ได้ตั้งค่าผู้ให้บริการ",
  provider_unavailable: "ผู้ให้บริการไม่พร้อมใช้งาน",
  timeout: "ผู้ให้บริการตอบช้าเกินไป",
};

/** Short, user-facing explanation for an API reason code. */
export function unavailableReasonLabel(code: string): string {
  return LABELS[code] ?? "ไม่มีข้อมูล";
}
