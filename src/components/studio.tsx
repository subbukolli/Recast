import { useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  Download,
  FlipHorizontal2,
  ImagePlus,
  Link2,
  Loader2,
  Search,
  ShieldCheck,
} from "lucide-react";
import { linkBlock } from "@/lib/faceswap/links";
import { clipSpan, MAX_SECONDS, type Quality } from "@/lib/faceswap/geometry";
import { frameIndexAt, sliceGif, MAX_GIF_SECONDS, decodeGif, type GifClip } from "@/lib/faceswap/gif";
import { fileToCanvas, recastClip, recastGif, renderGifStill, renderStill } from "@/lib/faceswap/pipeline";
import { searchTenor, type TenorHit } from "@/lib/faceswap/tenor-search";

function clock(seconds: number) {
  const safe = Math.max(0, seconds);
  const mins = Math.floor(safe / 60);
  const rem = safe - mins * 60;
  return `${mins}:${rem.toFixed(1).padStart(4, "0")}`;
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

function messageOf(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong. Try a different frame.";
}

export function Studio() {
  const sourceRef = useRef<HTMLVideoElement>(null);
  const resultRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLCanvasElement>(null);
  const gifViewRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<File | null>(null);
  const gifRef = useRef<GifClip | null>(null);
  const photoRef = useRef<HTMLCanvasElement | null>(null);
  const clipUrl = useRef<string | null>(null);
  const previewAbort = useRef<AbortController | null>(null);
  const recastAbort = useRef<AbortController | null>(null);
  const tenorOnce = useRef(false);

  const [clipName, setClipName] = useState<string | null>(null);
  const [gifName, setGifName] = useState<string | null>(null);
  const [gifDelays, setGifDelays] = useState<number[]>([]);
  const [mode, setMode] = useState<"reel" | "gif">("reel");
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [photoToken, setPhotoToken] = useState("0");
  const [mediaTick, setMediaTick] = useState(0);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [follow, setFollow] = useState(74);
  const [lighting, setLighting] = useState(true);
  const [flip, setFlip] = useState(false);
  const [quality, setQuality] = useState<Quality>("fast");
  const [note, setNote] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [link, setLink] = useState("");
  const [tenorQ, setTenorQ] = useState("");
  const [tenorHits, setTenorHits] = useState<TenorHit[]>([]);
  const [tenorBusy, setTenorBusy] = useState(false);
  const [tenorPick, setTenorPick] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [hasPreview, setHasPreview] = useState(false);
  const [holding, setHolding] = useState(false);
  const [run, setRun] = useState<{ done: number; total: number; label: string } | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultName, setResultName] = useState("recast.mp4");
  const [resultKind, setResultKind] = useState<"video" | "gif">("video");

  const running = run !== null;

  useEffect(() => {
    if (mode !== "reel") return;
    const photo = photoRef.current;
    const video = sourceRef.current;
    const output = stageRef.current;
    if (!photo || !video || !output || !clipName || !duration) return;
    const ac = new AbortController();
    previewAbort.current = ac;
    let alive = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        setBusy("Fitting your face…");
        try {
          const found = await renderStill({
            video,
            photo,
            photoToken,
            flip,
            follow: follow / 100,
            lighting,
            quality,
            start,
            output,
            signal: ac.signal,
          });
          if (!alive || ac.signal.aborted) return;
          setHasPreview(true);
          setResultUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
          setNote(found === "face" ? null : "No face in this frame. Nudge the start time.");
        } catch (error) {
          if (!alive || ac.signal.aborted || isAbort(error)) return;
          setHasPreview(false);
          setNote(messageOf(error));
        } finally {
          if (alive && !ac.signal.aborted) setBusy(null);
        }
      })();
    }, 220);
    return () => {
      alive = false;
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [clipName, duration, flip, follow, lighting, mediaTick, mode, photoToken, quality, start]);

  useEffect(() => {
    if (mode !== "gif") return;
    const photo = photoRef.current;
    const gif = gifRef.current;
    const output = stageRef.current;
    if (!photo || !gif || !output || !gifName || !gif.frames.length) return;
    const ac = new AbortController();
    previewAbort.current = ac;
    let alive = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        setBusy("Fitting your face…");
        try {
          const frame = gif.frames[frameIndexAt(gif.delays, start * 1000)];
          if (!frame) return;
          const found = await renderGifStill({
            frame,
            photo,
            photoToken,
            flip,
            follow: follow / 100,
            lighting,
            quality,
            output,
            signal: ac.signal,
          });
          if (!alive || ac.signal.aborted) return;
          setHasPreview(true);
          setResultUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
          setNote(found === "face" ? null : "No face in this frame. Nudge the start time.");
        } catch (error) {
          if (!alive || ac.signal.aborted || isAbort(error)) return;
          setHasPreview(false);
          setNote(messageOf(error));
        } finally {
          if (alive && !ac.signal.aborted) setBusy(null);
        }
      })();
    }, 220);
    return () => {
      alive = false;
      ac.abort();
      window.clearTimeout(timer);
    };
  }, [flip, follow, gifName, lighting, mediaTick, mode, photoToken, quality, start]);

  useEffect(() => {
    if (mode !== "gif" || !gifName) return;
    const gif = gifRef.current;
    const view = gifViewRef.current;
    if (!gif || !view) return;
    const frame = gif.frames[frameIndexAt(gif.delays, start * 1000)];
    if (!frame) return;
    view.width = frame.width;
    view.height = frame.height;
    view.getContext("2d")?.drawImage(frame, 0, 0);
  }, [gifName, mediaTick, mode, start]);

  useEffect(() => {
    if (mode !== "gif" || tenorOnce.current) return;
    tenorOnce.current = true;
    let alive = true;
    setTenorBusy(true);
    void searchTenor({ data: { q: "" } })
      .then((hits) => {
        if (alive) setTenorHits(hits);
      })
      .catch((error: unknown) => {
        if (alive) setNote(messageOf(error));
      })
      .finally(() => {
        if (alive) setTenorBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [mode]);

  useEffect(() => {
    return () => {
      if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
    };
  }, []);

  async function loadClip(file: File) {
    const el = sourceRef.current;
    if (!el) return;
    if (!file.type.startsWith("video/") && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) {
      setNote("Drop a video file — mp4, webm, or mov.");
      return;
    }
    if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
    const url = URL.createObjectURL(file);
    clipUrl.current = url;
    fileRef.current = file;
    setBusy("Reading the clip…");
    setNote(null);
    try {
      el.pause();
      el.src = url;
      await new Promise<void>((resolve, reject) => {
        const ok = () => {
          cleanup();
          resolve();
        };
        const bad = () => {
          cleanup();
          reject(new Error("Couldn't read that video."));
        };
        const cleanup = () => {
          el.removeEventListener("loadedmetadata", ok);
          el.removeEventListener("error", bad);
        };
        el.addEventListener("loadedmetadata", ok);
        el.addEventListener("error", bad);
        el.load();
      });
      if (!Number.isFinite(el.duration) || el.duration <= 0) {
        throw new Error("That clip has no duration.");
      }
      setDuration(el.duration);
      setStart(0);
      setClipName(file.name);
      setHasPreview(false);
      setMediaTick((n) => n + 1);
      setHint(null);
    } catch (error) {
      setNote(messageOf(error));
    } finally {
      setBusy(null);
    }
  }

  async function loadGif(file: File) {
    if (file.type !== "image/gif" && !/\.gif$/i.test(file.name)) {
      setNote("Drop a GIF file.");
      return;
    }
    setBusy("Reading the GIF…");
    setNote(null);
    try {
      const clip = await decodeGif(file);
      gifRef.current = clip;
      setGifName(file.name);
      setGifDelays(clip.delays);
      setMode("gif");
      setStart(0);
      setHasPreview(false);
      setMediaTick((n) => n + 1);
      setResultUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setNote(clip.truncated ? `Using the first ${clip.duration.toFixed(1)}s of that GIF.` : null);
    } catch (error) {
      setNote(messageOf(error));
    } finally {
      setBusy(null);
    }
  }

  function onSourceFile(file: File) {
    if (file.type === "image/gif" || /\.gif$/i.test(file.name)) {
      void loadGif(file);
      return;
    }
    setMode("reel");
    void loadClip(file);
  }

  async function findGifs(query: string) {
    setTenorBusy(true);
    setNote(null);
    try {
      setTenorHits(await searchTenor({ data: { q: query } }));
    } catch (error) {
      setTenorHits([]);
      setNote(messageOf(error));
    } finally {
      setTenorBusy(false);
    }
  }

  async function pickTenor(hit: TenorHit) {
    if (running || busy) return;
    setTenorPick(hit.id);
    setBusy("Fetching that GIF…");
    setNote(null);
    try {
      let res = await fetch(hit.gifUrl);
      if (!res.ok) res = await fetch(hit.previewUrl);
      if (!res.ok) throw new Error("status");
      const blob = await res.blob();
      const safe = hit.title.replace(/[^\w\s-]+/g, "").trim().slice(0, 42) || "tenor";
      await loadGif(new File([blob], `${safe}.gif`, { type: "image/gif" }));
    } catch (error) {
      setNote(messageOf(error));
      setBusy(null);
    }
  }

  async function loadPhoto(file: File) {
    if (file.type === "image/gif" || /\.gif$/i.test(file.name)) {
      setNote("That's the GIF. Drop it above, then add a still photo of your face.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setNote("Drop a photo — jpeg, png, or webp.");
      return;
    }
    setBusy("Reading the photo…");
    setNote(null);
    try {
      photoRef.current = await fileToCanvas(file);
      setPhotoName(file.name);
      setPhotoToken(`${file.name}:${file.size}:${file.lastModified}`);
      setHasPreview(false);
    } catch (error) {
      setNote(messageOf(error));
    } finally {
      setBusy(null);
    }
  }

  async function onLinkSubmit(event: React.FormEvent) {
    event.preventDefault();
    const blocked = linkBlock(link);
    if (blocked) {
      setHint(blocked);
      return;
    }
    setHint(null);
    setBusy("Fetching that link…");
    try {
      const res = await fetch(link.trim());
      if (!res.ok) throw new Error("status");
      const blob = await res.blob();
      const type = blob.type || "video/mp4";
      if (!type.startsWith("video/") && !/\.(mp4|webm|mov)(\?|$)/i.test(link)) {
        throw new Error("type");
      }
      await loadClip(new File([blob], "clip.mp4", { type }));
    } catch {
      setHint("The browser couldn't read that link. Download the file and drop it instead.");
    } finally {
      setBusy(null);
    }
  }

  async function onRecast() {
    const photo = photoRef.current;
    if (!photo || running) return;
    previewAbort.current?.abort();
    const ac = new AbortController();
    recastAbort.current = ac;
    setNote(null);
    setRun({ done: 0, total: 1, label: "Starting" });
    try {
      if (mode === "gif") {
        const gif = gifRef.current;
        if (!gif) return;
        const blob = await recastGif({
          gif,
          photo,
          photoToken,
          flip,
          follow: follow / 100,
          lighting,
          quality,
          start,
          signal: ac.signal,
          onProgress: (info) => setRun(info),
        });
        const url = URL.createObjectURL(blob);
        setResultUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setResultName("recast.gif");
        setResultKind("gif");
      } else {
        const file = fileRef.current;
        const video = sourceRef.current;
        if (!file || !video) return;
        const result = await recastClip({
          file,
          video,
          photo,
          photoToken,
          flip,
          follow: follow / 100,
          lighting,
          quality,
          start,
          signal: ac.signal,
          onProgress: (info) => setRun(info),
        });
        const url = URL.createObjectURL(result.blob);
        setResultUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return url;
        });
        setResultName(result.ext === "mp4" ? "recast.mp4" : "recast.webm");
        setResultKind("video");
      }
      setHasPreview(true);
    } catch (error) {
      if (!isAbort(error)) setNote(messageOf(error));
    } finally {
      setRun(null);
    }
  }

  function holdStart() {
    const source = sourceRef.current;
    const result = resultRef.current;
    if (source && result && resultUrl) {
      const next = Math.min(source.duration || start, start + result.currentTime);
      source.pause();
      source.currentTime = next;
    }
    setHolding(true);
  }

  const showSource = mode === "reel" && (holding || (!resultUrl && !hasPreview && Boolean(clipName)));
  const showGif = mode === "gif" && (holding || (!resultUrl && !hasPreview && Boolean(gifName)));
  const sourceReady = mode === "gif" ? Boolean(gifName) : Boolean(clipName);
  const showCanvas = hasPreview && !resultUrl && !holding && sourceReady;
  const showResult = Boolean(resultUrl) && !holding;
  const gifDuration = gifDelays.reduce((sum, delay) => sum + delay, 0) / 1000;
  const activeDuration = mode === "gif" ? gifDuration : duration;
  const gifSlice = mode === "gif" ? sliceGif(gifDelays, start) : null;
  const span = mode === "gif" ? (gifSlice?.span ?? 0) : clipSpan(duration, start);
  const ready =
    mode === "gif"
      ? Boolean(gifName && photoName && gifDelays.length && !running)
      : Boolean(clipName && photoName && duration && !running);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-lg bg-primary text-primary-fg">
            <Clapperboard className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="font-display text-2xl leading-none text-fg">Recast</h1>
            <p className="mt-1 text-sm text-muted">Your face, their cut.</p>
          </div>
        </div>
        <p className="hidden max-w-xs text-right text-sm text-muted sm:block">
          On this device. Nothing is uploaded.
        </p>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 pb-16 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="order-2 flex flex-col gap-4 lg:order-1">
          <p className="max-w-xl text-base text-muted">
            Drop a reel, short, or GIF and a straight-on photo. Your real face is mapped onto the
            largest face — the pixels stay yours.
          </p>
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <div className="stage-frame relative mx-auto w-full max-w-md bg-bg">
              <video
                ref={sourceRef}
                className={`absolute inset-0 h-full w-full object-contain ${showSource ? "opacity-100" : "opacity-0"}`}
                playsInline
                muted
                preload="auto"
                aria-hidden={!showSource}
              />
              {sourceReady && mode === "gif" ? (
                <canvas
                  ref={gifViewRef}
                  className={`absolute inset-0 h-full w-full object-contain ${showGif ? "opacity-100" : "opacity-0"}`}
                />
              ) : null}
              {sourceReady ? (
                <canvas
                  ref={stageRef}
                  className={`absolute inset-0 h-full w-full object-contain ${showCanvas ? "opacity-100" : "opacity-0"}`}
                />
              ) : null}
              {resultUrl && resultKind === "gif" ? (
                <img
                  className={`absolute inset-0 h-full w-full object-contain ${showResult ? "opacity-100" : "opacity-0"}`}
                  src={resultUrl}
                  alt="Recast GIF"
                />
              ) : null}
              {resultUrl && resultKind === "video" ? (
                <video
                  ref={resultRef}
                  className={`absolute inset-0 h-full w-full object-contain ${showResult ? "opacity-100" : "opacity-0"}`}
                  src={resultUrl}
                  controls
                  playsInline
                  loop
                />
              ) : null}
              {!sourceReady ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
                  <Clapperboard className="size-8 text-muted" aria-hidden="true" />
                  <p className="font-display text-xl text-fg">The recast lands here</p>
                  <p className="text-sm text-muted">
                    {mode === "gif" ? "A GIF with a clear face works best." : "A short with a clear face works best."}
                  </p>
                </div>
              ) : null}
              {busy || running ? (
                <p className="absolute bottom-3 left-3 right-3 flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm text-fg">
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  <span>{running ? run.label : busy}</span>
                </p>
              ) : null}
            </div>
          </div>
          {hasPreview || resultUrl ? (
            <button
              type="button"
              className="h-11 self-start rounded-lg border border-border bg-surface px-4 text-sm text-fg transition-colors duration-200 motion-reduce:transition-none"
              onPointerDown={holdStart}
              onPointerUp={() => setHolding(false)}
              onPointerLeave={() => setHolding(false)}
              onPointerCancel={() => setHolding(false)}
            >
              Hold for original
            </button>
          ) : null}
        </section>

        <aside className="order-1 flex flex-col gap-4 lg:order-2">
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface p-1">
            {(
              [
                ["reel", "Reel"],
                ["gif", "GIF"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={mode === id}
                disabled={running}
                onClick={() => {
                  if (id === mode) return;
                  setMode(id);
                  setStart(0);
                  setHasPreview(false);
                  setNote(null);
                  setResultUrl((prev) => {
                    if (prev) URL.revokeObjectURL(prev);
                    return null;
                  });
                  setMediaTick((n) => n + 1);
                }}
                className={`h-11 rounded-md text-sm ${mode === id ? "bg-surface-2 text-fg" : "text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
          {mode === "reel" ? (
            <DropZone
              title="Reel or short"
              detail="mp4, webm, mov, or gif"
              fileName={clipName}
              accept="video/mp4,video/webm,video/quicktime,video/*,image/gif,.gif"
              icon={<Clapperboard className="size-5" aria-hidden="true" />}
              inputId="clip-file"
              disabled={running}
              onFile={onSourceFile}
            />
          ) : (
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void findGifs(tenorQ);
              }}
            >
              <label className="text-sm text-muted" htmlFor="tenor-q">
                1. Search Tenor
              </label>
              <div className="flex gap-2">
                <input
                  id="tenor-q"
                  type="search"
                  value={tenorQ}
                  disabled={running || Boolean(busy)}
                  placeholder="wave, dance, hello"
                  onChange={(event) => setTenorQ(event.target.value)}
                  className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 text-sm text-fg placeholder:text-muted"
                />
                <button
                  type="submit"
                  disabled={running || Boolean(busy) || tenorBusy}
                  className="grid size-11 place-items-center rounded-lg border border-border bg-surface text-fg disabled:opacity-40"
                >
                  {tenorBusy ? (
                    <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  ) : (
                    <Search className="size-4" aria-hidden="true" />
                  )}
                  <span className="sr-only">Search Tenor</span>
                </button>
              </div>
              {tenorHits.length ? (
                <ul className="grid max-h-52 grid-cols-3 gap-2 overflow-y-auto">
                  {tenorHits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        type="button"
                        disabled={running || Boolean(busy)}
                        onClick={() => void pickTenor(hit)}
                        className={`block w-full overflow-hidden rounded-lg border ${
                          tenorPick === hit.id ? "border-primary" : "border-border"
                        }`}
                      >
                        <img src={hit.previewUrl} alt={hit.title} className="h-20 w-full object-cover" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="text-xs text-muted">GIFs from Tenor. Pick one with a clear face.</p>
            </form>
          )}
          {mode === "gif" ? (
            <DropZone
              title="Or drop a GIF"
              detail="Your own file"
              fileName={gifName}
              accept="image/gif,.gif"
              icon={<Clapperboard className="size-5" aria-hidden="true" />}
              inputId="clip-file"
              disabled={running}
              onFile={onSourceFile}
            />
          ) : null}
          {mode === "reel" ? (
          <form className="flex flex-col gap-2" onSubmit={(event) => void onLinkSubmit(event)}>
            <label className="text-sm text-muted" htmlFor="clip-link">
              Or paste a direct video link
            </label>
            <div className="flex gap-2">
              <input
                id="clip-link"
                type="url"
                inputMode="url"
                value={link}
                disabled={running}
                placeholder="https://"
                onChange={(event) => setLink(event.target.value)}
                className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 text-sm text-fg placeholder:text-muted"
              />
              <button
                type="submit"
                disabled={running || link.trim().length < 8}
                className="grid size-11 place-items-center rounded-lg border border-border bg-surface text-fg disabled:opacity-40"
              >
                <Link2 className="size-4" aria-hidden="true" />
                <span className="sr-only">Fetch link</span>
              </button>
            </div>
            {hint ? <p className="text-sm text-muted">{hint}</p> : null}
          </form>
          ) : null}

          <DropZone
            title={mode === "gif" ? "2. Your photo" : "Your photo"}
            detail="Front-facing, eyes open"
            fileName={photoName}
            accept="image/jpeg,image/png,image/webp,image/*"
            icon={<ImagePlus className="size-5" aria-hidden="true" />}
            inputId="photo-file"
            disabled={running}
            onFile={(file) => void loadPhoto(file)}
          />

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
            <label className="flex flex-col gap-1">
              <span className="flex items-center justify-between text-sm">
                <span>Start</span>
                <span className="tabular-nums text-muted">{activeDuration ? clock(start) : "—"}</span>
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(0, activeDuration - (mode === "gif" ? 0 : 0.2))}
                step={0.1}
                value={Math.min(start, Math.max(0, activeDuration))}
                disabled={!activeDuration || running}
                onChange={(event) => setStart(Number(event.target.value))}
              />
            </label>
            <p className="text-sm text-muted">
              {activeDuration
                ? mode === "gif"
                  ? `Recasts ${gifSlice?.delays.length ?? 0} frames (${span.toFixed(1)}s). Cap is ${MAX_GIF_SECONDS}s.`
                  : `Recasts ${span.toFixed(1)}s from here. Cap is ${MAX_SECONDS}s.`
                : mode === "gif"
                  ? "The first 8 seconds from the start point."
                  : "The first 12 seconds from the start point."}
            </p>
            <label className="flex flex-col gap-1">
              <span className="flex items-center justify-between text-sm">
                <span>Motion match</span>
                <span className="tabular-nums text-muted">{follow}</span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={follow}
                disabled={running}
                onChange={(event) => setFollow(Number(event.target.value))}
              />
              <span className="flex justify-between text-xs text-muted">
                <span>Your shape</span>
                <span>Their motion</span>
              </span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Toggle pressed={lighting} disabled={running} onClick={() => setLighting((v) => !v)}>
                Match lighting
              </Toggle>
              <Toggle pressed={flip} disabled={running} onClick={() => setFlip((v) => !v)}>
                <FlipHorizontal2 className="size-4" aria-hidden="true" />
                Flip photo
              </Toggle>
            </div>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-bg p-1">
              {(
                [
                  ["fast", "Faster"],
                  ["sharp", "Sharper"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={quality === id}
                  disabled={running}
                  onClick={() => setQuality(id)}
                  className={`h-11 rounded-md text-sm ${quality === id ? "bg-surface-2 text-fg" : "text-muted"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {note ? <p className="text-sm text-primary">{note}</p> : null}

          {running ? (
            <div className="flex flex-col gap-2">
              <div className="h-2 overflow-hidden rounded-full bg-bg">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${Math.round((run.done / run.total) * 100)}%` }}
                />
              </div>
              <p className="tabular-nums text-sm text-muted">
                {run.done} / {run.total}
              </p>
              <button
                type="button"
                className="h-12 rounded-lg border border-border bg-surface text-sm text-fg"
                onClick={() => recastAbort.current?.abort()}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={!ready}
              onClick={() => void onRecast()}
              className="h-12 rounded-lg bg-primary text-sm font-medium text-primary-fg disabled:opacity-40"
            >
              {mode === "gif" ? "Make GIF" : "Make recast"}
            </button>
          )}

          {resultUrl ? (
            <a
              href={resultUrl}
              download={resultName}
              className="flex h-12 items-center justify-center gap-2 rounded-lg border border-border bg-surface text-sm text-fg"
            >
              <Download className="size-4" aria-hidden="true" />
              Download {resultName}
            </a>
          ) : null}

          <p className="flex gap-2 text-sm text-muted">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              Only your photo, and only clips or GIFs you have the rights to remix. If several people are
              in frame, the largest face is recast.
            </span>
          </p>
        </aside>
      </main>
    </div>
  );
}

function Toggle(props: {
  pressed: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={props.pressed}
      disabled={props.disabled}
      onClick={props.onClick}
      className={`flex h-11 items-center justify-center gap-2 rounded-lg border px-2 text-sm ${
        props.pressed
          ? "border-primary bg-primary text-primary-fg"
          : "border-border bg-bg text-fg"
      } disabled:opacity-40`}
    >
      {props.children}
    </button>
  );
}

function DropZone(props: {
  title: string;
  detail: string;
  fileName: string | null;
  accept: string;
  inputId: string;
  icon: React.ReactNode;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <label
      className={`flex min-h-20 cursor-pointer items-center gap-3 rounded-xl border bg-surface px-4 py-3 ${
        over ? "border-primary" : "border-border"
      } ${props.disabled ? "pointer-events-none opacity-50" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const file = event.dataTransfer.files[0];
        if (file) props.onFile(file);
      }}
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-bg text-fg">{props.icon}</span>
      <span className="min-w-0">
        <span className="block text-sm text-fg">{props.title}</span>
        <span className="block truncate text-sm text-muted">{props.fileName ?? props.detail}</span>
      </span>
      <input
        id={props.inputId}
        className="sr-only"
        type="file"
        accept={props.accept}
        disabled={props.disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) props.onFile(file);
        }}
      />
    </label>
  );
}
