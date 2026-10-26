/** Brand metadata shared by the manifest and document metadata. */
export const BRAND = {
  name: "Mallowtick",
  tagline: "Small charts. Big dreams.",
  description: "แอปวิเคราะห์หุ้นสหรัฐฯ ที่ใช้ง่าย ด้วยข้อมูลตลาดจริง กราฟ และแนวรับ-แนวต้าน",
  // Must match --color-cream in src/styles/globals.css (metadata can't read CSS variables).
  themeColor: "#fff9f0",
} as const;
