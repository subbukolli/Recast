import { createServerFn } from "@tanstack/react-start";
import { parseTenorHtml, tenorSearchUrl, type TenorHit } from "@/lib/faceswap/tenor";

export type { TenorHit };

export const searchTenor = createServerFn({ method: "GET" })
  .validator((input: { q?: string } | undefined) => {
    const q = (input?.q ?? "").trim().slice(0, 48);
    return { q };
  })
  .handler(async ({ data }): Promise<TenorHit[]> => {
    const url = tenorSearchUrl(data.q);
    let html: string;
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          accept: "text/html",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(String(res.status));
      html = await res.text();
    } catch {
      throw new Error("Tenor search didn't respond. Try again.");
    }
    const hits = parseTenorHtml(html);
    if (!hits.length) {
      throw new Error(data.q ? "No GIFs for that. Try another word." : "Tenor didn't return any GIFs.");
    }
    return hits;
  });
