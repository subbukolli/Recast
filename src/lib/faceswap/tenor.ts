export type TenorHit = {
  id: string;
  title: string;
  previewUrl: string;
  gifUrl: string;
};

const FIGURE = /<figure class="UniversalGifListItem[\s\S]*?<\/figure>/g;
const IMG = /<img\s+src="(https:\/\/media\.tenor\.com\/([^"/]+)\/[^"]+)"[^>]*alt="([^"]*)"/;

export function tenorSearchUrl(query: string) {
  const slug = query
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!slug) return "https://tenor.com/";
  return `https://tenor.com/search/${slug}-gifs`;
}

function decodeText(value: string) {
  return value
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/&#39;|'/g, "'")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTenorHtml(html: string, limit = 12): TenorHit[] {
  const hits: TenorHit[] = [];
  const seen = new Set<string>();
  for (const block of html.matchAll(FIGURE)) {
    const img = IMG.exec(block[0]);
    IMG.lastIndex = 0;
    if (!img) continue;
    const previewUrl = img[1]!;
    const token = img[2]!;
    if (!previewUrl.toLowerCase().includes(".gif")) continue;
    const id = token.replace(/AAA[A-Za-z0-9]+$/, "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const gifUrl = previewUrl.includes("AAAAM/")
      ? previewUrl.replace("AAAAM/", "AAAAC/")
      : previewUrl;
    hits.push({
      id,
      title: decodeText(img[3] || "GIF") || "GIF",
      previewUrl,
      gifUrl,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}
