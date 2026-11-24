/**
 * Thai names for Finnhub's industry classification (`finnhubIndustry` in
 * `/stock/profile2`), keyed by the vendor's English text.
 *
 * The first group was seen in real profiles (checked 2026-10-27 and 2026-11-07). The
 * second follows the rest of Finnhub's list but hasn't been seen yet, so its spelling
 * is unconfirmed; a mismatch only means the English text shows.
 */
const THAI_NAMES: Record<string, string> = {
  // Seen in real profiles.
  "Aerospace & Defense": "อากาศยานและกลาโหม",
  Automobiles: "ยานยนต์",
  Banking: "ธนาคาร",
  Beverages: "เครื่องดื่ม",
  "Commercial Services & Supplies": "บริการและอุปกรณ์ธุรกิจ",
  "Consumer products": "สินค้าอุปโภคบริโภค",
  Energy: "พลังงาน",
  "Financial Services": "บริการทางการเงิน",
  "Health Care": "การแพทย์",
  "Hotels, Restaurants & Leisure": "ร้านอาหารและท่องเที่ยว",
  Insurance: "ประกันภัย",
  "Life Sciences Tools & Services": "เครื่องมือวิทยาศาสตร์ชีวภาพ",
  "Logistics & Transportation": "ขนส่งและโลจิสติกส์",
  Media: "สื่อ",
  "Real Estate": "อสังหาริมทรัพย์",
  Retail: "ค้าปลีก",
  Semiconductors: "เซมิคอนดักเตอร์",
  Technology: "เทคโนโลยี",
  Telecommunication: "โทรคมนาคม",
  "Textiles, Apparel & Luxury Goods": "เครื่องแต่งกายและสินค้าหรู",

  // Not seen yet.
  Airlines: "สายการบิน",
  "Auto Components": "ชิ้นส่วนยานยนต์",
  Biotechnology: "เทคโนโลยีชีวภาพ",
  Building: "วัสดุก่อสร้าง",
  Chemicals: "เคมีภัณฑ์",
  Communications: "อุปกรณ์สื่อสาร",
  Construction: "ก่อสร้าง",
  "Diversified Consumer Services": "บริการผู้บริโภค",
  Distributors: "จัดจำหน่าย",
  "Electrical Equipment": "อุปกรณ์ไฟฟ้า",
  "Food Products": "อาหาร",
  "Industrial Conglomerates": "กลุ่มบริษัทอุตสาหกรรม",
  "Leisure Products": "สินค้าสันทนาการ",
  Machinery: "เครื่องจักร",
  Marine: "ขนส่งทางเรือ",
  "Metals & Mining": "โลหะและเหมืองแร่",
  Packaging: "บรรจุภัณฑ์",
  "Paper & Forest": "กระดาษและป่าไม้",
  Pharmaceuticals: "ยาและเวชภัณฑ์",
  "Professional Services": "บริการวิชาชีพ",
  "Road & Rail": "ขนส่งทางถนนและราง",
  Tobacco: "ยาสูบ",
  "Trading Companies & Distributors": "ค้าส่งและจัดจำหน่าย",
  "Transportation Infrastructure": "โครงสร้างพื้นฐานขนส่ง",
  Utilities: "สาธารณูปโภค",
};

/** Case and spacing differ between sources ("Consumer products"), so they don't count. */
const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

const BY_KEY = new Map(Object.entries(THAI_NAMES).map(([en, th]) => [key(en), th]));

/**
 * Thai name of a Finnhub industry ("Semiconductors" → "เซมิคอนดักเตอร์"). Industries
 * not in the list keep the vendor's English text, so a new one still shows.
 */
export function industryName(industry: string): string {
  return BY_KEY.get(key(industry)) ?? industry;
}
