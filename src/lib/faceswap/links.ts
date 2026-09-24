export function linkBlock(raw: string): string | null {
  let host = "";
  try {
    host = new URL(raw.trim()).hostname.replace(/^www\./, "");
  } catch {
    return "Paste a full link, including https://";
  }
  if (host === "youtu.be" || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
    return "YouTube won't hand the video file to a browser. Download the short, or screen-record it, then drop the file here.";
  }
  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    return "Instagram won't hand the reel file to a browser. Save the reel to your device, then drop the file here.";
  }
  return null;
}
