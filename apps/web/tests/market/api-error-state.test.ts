import { describe, expect, it } from "vitest";

import { errorCopy } from "@/components/market/api-error-state";
import { ApiError } from "@/services/api/client";

describe("errorCopy", () => {
  it("tells a client sending too many requests to slow down", () => {
    const copy = errorCopy(new ApiError("too_many_requests", "Too many requests.", 429, 30));
    expect(copy).toEqual({
      code: "too_many_requests",
      title: "เรียกข้อมูลถี่เกินไป",
      description: "รอสักครู่แล้วลองใหม่อีกครั้ง",
    });
  });

  it("explains a used-up quota without promising a minute", () => {
    const copy = errorCopy(new ApiError("rate_limited", "Rate limited.", 429, 60));
    expect(copy.title).toBe("ขอพักหายใจแป๊บนึง");
    expect(copy.description).toBe("ใช้โควตาข้อมูลตลาดครบแล้วในตอนนี้ ลองใหม่อีกครั้งในอีกสักครู่");
  });
});
