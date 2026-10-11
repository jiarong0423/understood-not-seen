// One language at a time for place names. Qloo stores a single name per place, sometimes mixed ("Mars Fitness 瑪爾斯全方位運動空間").
// 1. kb/place_names.json (hand-written) wins.  2. A mixed name is split: the Latin part for English, the Chinese part for Chinese;
// a Chinese hint in brackets after a Latin name ("Impromptu by Paul Lee (麗晶精品…)") is a location hint and is dropped.
// 3. Otherwise the name stays as Qloo stores it (a proper noun we have no other-language form for).
export async function loadPlaceNames() { return (await (await fetch("kb/place_names.json")).json()).names; }

const CJK = /[一-鿿]/;
const LATIN_FIRST = /^([A-Za-z][A-Za-z0-9&'.\-+ ]*?)\s*(?:[（(]\s*([一-鿿][^）)]*)[）)]|\s([一-鿿][^]*))$/;
const CJK_FIRST = /^([一-鿿][一-鿿0-9]*)\s+([A-Za-z][A-Za-z0-9&'.\-+ ]*)$/;

export function splitName(raw) {
  let m = LATIN_FIRST.exec(raw);
  if (m) return m[2] ? { en: m[1].trim(), zh: null } : { en: m[1].trim(), zh: m[3].trim() }; // bracketed Chinese is a hint, not a name
  m = CJK_FIRST.exec(raw);
  if (m) return { zh: m[1], en: m[2].trim() };
  return null;
}

// Returns the name to show in `lang`. `table` is the loaded kb/place_names.json "names" object.
export function placeName(raw, lang, table = {}) {
  const t = table[raw];
  if (t && t[lang]) return t[lang];
  const s = splitName(raw);
  if (s) return s[lang] || s.en || s.zh; // a name with no form in this language keeps its other form, without any bracketed hint
  return raw;
}

// Names that have no form in `lang` yet: used by tools/unmapped_names.py's twin in the tests
export const hasForm = (raw, lang, table = {}) => {
  const shown = placeName(raw, lang, table);
  return lang === "zh" ? CJK.test(shown) : !CJK.test(shown);
};
