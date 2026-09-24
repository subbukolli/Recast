import { useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  Download,
  FlipHorizontal2,
  ImagePlus,
  Link2,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { linkBlock } from "@/lib/faceswap/links";
import { clipSpan, MAX_SECONDS, type Quality } from "@/lib/faceswap/geometry";
import { fileToCanvas, recastClip, renderStill } from "@/lib/faceswap/pipeline";

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
  const fileRef = useRef<File | null>(null);
  const photoRef = useRef<HTMLCanvasElement | null>(null);
  const clipUrl = useRef<string | null>(null);
  const previewAbort = useRef<AbortController | null>(null);
  const recastAbort = useRef<AbortController | null>(null);

  const [clipName, setClipName] = useState<string | null>(null);
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
  const [busy, setBusy] = useState<string | null>(null);
  const [hasPreview, setHasPreview] = useState(false);
  const [holding, setHolding] = useState(false);
  const [run, setRun] = useState<{ done: number; total: number; label: string } | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultName, setResultName] = useState("recast.mp4");

  const running = run !== null;
  const span = clipSpan(duration, start);

  useEffect(() => {
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
  }, [clipName, duration, flip, follow, lighting, mediaTick, photoToken, quality, start]);

  useEffect(() => {
    return () => {
      if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
    };
  }, []);

  async function useClip(file: File) {
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

  async function usePhoto(file: File) {
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
      await useClip(new File([blob], "clip.mp4", { type }));
    } catch {
      setHint("The browser couldn't read that link. Download the file and drop it instead.");
    } finally {
      setBusy(null);
    }
  }

  async function onRecast() {
    const file = fileRef.current;
    const video = sourceRef.current;
    const photo = photoRef.current;
    if (!file || !video || !photo || running) return;
    previewAbort.current?.abort();
    const ac = new AbortController();
    recastAbort.current = ac;
    setNote(null);
    setRun({ done: 0, total: 1, label: "Starting" });
    try {
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

  const showSource = holding || (!resultUrl && !hasPreview && Boolean(clipName));
  const showCanvas = hasPreview && !resultUrl && !holding;
  const showResult = Boolean(resultUrl) && !holding;
  const ready = Boolean(clipName && photoName && duration && !running);

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
            Drop a reel or short and a straight-on photo. Your real face is mapped onto the
            largest face in the clip — the pixels stay yours.
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
              {clipName ? (
                <canvas
                  ref={stageRef}
                  className={`absolute inset-0 h-full w-full object-contain ${showCanvas ? "opacity-100" : "opacity-0"}`}
                />
              ) : null}
              {resultUrl ? (
                <video
                  ref={resultRef}
                  className={`absolute inset-0 h-full w-full object-contain ${showResult ? "opacity-100" : "opacity-0"}`}
                  src={resultUrl}
                  controls
                  playsInline
                  loop
                />
              ) : null}
              {!clipName ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
                  <Clapperboard className="size-8 text-muted" aria-hidden="true" />
                  <p className="font-display text-xl text-fg">The recast lands here</p>
                  <p className="text-sm text-muted">A short with a clear face works best.</p>
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
          <DropZone
            title="Reel or short"
            detail="mp4, webm, or mov"
            fileName={clipName}
            accept="video/mp4,video/webm,video/quicktime,video/*"
            icon={<Clapperboard className="size-5" aria-hidden="true" />}
            inputId="clip-file"
            disabled={running}
            onFile={(file) => void useClip(file)}
          />
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

          <DropZone
            title="Your photo"
            detail="Front-facing, eyes open"
            fileName={photoName}
            accept="image/jpeg,image/png,image/webp,image/*"
            icon={<ImagePlus className="size-5" aria-hidden="true" />}
            inputId="photo-file"
            disabled={running}
            onFile={(file) => void usePhoto(file)}
          />

          <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4">
            <label className="flex flex-col gap-1">
              <span className="flex items-center justify-between text-sm">
                <span>Start</span>
                <span className="tabular-nums text-muted">{duration ? clock(start) : "—"}</span>
              </span>
              <input
                type="range"
                min={0}
                max={Math.max(0, duration - 0.2)}
                step={0.1}
                value={Math.min(start, Math.max(0, duration))}
                disabled={!duration || running}
                onChange={(event) => setStart(Number(event.target.value))}
              />
            </label>
            <p className="text-sm text-muted">
              {duration
                ? `Recasts ${span.toFixed(1)}s from here. Cap is ${MAX_SECONDS}s.`
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
                <span>Clip motion</span>
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
              Make recast
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
              Only your photo, and only clips you have the rights to remix. If several people are
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
