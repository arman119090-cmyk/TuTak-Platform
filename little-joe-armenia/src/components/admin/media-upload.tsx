"use client";

import { useRef, useState, useTransition } from "react";
import type { ActionState } from "@/lib/admin/forms";

type AddMedia = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const KINDS: Record<string, string> = {
  PRODUCT: "Товар",
  PACKAGING: "Упаковка",
  INSTALLED: "В машине",
  DETAIL: "Деталь",
  LIFESTYLE: "Лайфстайл",
  HERO: "Hero",
};
const RIGHTS: Record<string, string> = {
  UNCONFIRMED: "Права не подтверждены",
  AUTHORIZED: "Права подтверждены",
  PLACEHOLDER: "Заглушка",
};

async function naturalSize(file: File): Promise<{ width: number; height: number }> {
  if ("createImageBitmap" in window) {
    try {
      const bmp = await createImageBitmap(file);
      const size = { width: bmp.width, height: bmp.height };
      bmp.close();
      return size;
    } catch {
      // AVIF etc. may be unsupported by createImageBitmap; fall back to <img>.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Upload an image file: POST /api/admin/upload (same-origin, admin cookie),
 * read its natural size in the browser, then create the MediaAsset through
 * the regular addMedia Server Action (which validates and audits).
 */
export function MediaUpload({ productId, addMedia }: { productId: string; addMedia: AddMedia }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<ActionState>(null);
  const [pending, startTransition] = useTransition();

  async function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) return setState({ ok: false, message: "Выберите файл" });
    if (file.size > 15 * 1024 * 1024) return setState({ ok: false, message: "Файл больше 15 МБ" });
    let size: { width: number; height: number };
    try {
      size = await naturalSize(file);
    } catch {
      return setState({ ok: false, message: "Не удалось прочитать изображение (JPEG, PNG, WebP или AVIF)" });
    }
    const up = new FormData();
    up.append("file", file);
    const res = await fetch("/api/admin/upload", { method: "POST", body: up, credentials: "same-origin" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      const reason =
        res.status === 401 ? "сессия истекла, войдите снова" : res.status === 413 ? "файл больше 15 МБ" : res.status === 415 ? "только JPEG, PNG, WebP или AVIF" : res.status === 429 ? "слишком много загрузок, подождите" : (body?.error ?? `ошибка ${res.status}`);
      return setState({ ok: false, message: `Загрузка не удалась: ${reason}` });
    }
    const { url, storageKey, width, height } = (await res.json()) as { url: string; storageKey: string; width: number; height: number };
    // The server rotates/resizes the photo; use its final dimensions.
    size = { width, height };
    const fd = new FormData();
    fd.set("productId", productId);
    fd.set("url", url);
    fd.set("storageKey", storageKey);
    fd.set("width", String(size.width));
    fd.set("height", String(size.height));
    for (const k of ["kind", "rights", "rightsNote", "altHy", "altRu", "altIt", "altEn"]) fd.set(k, String(data.get(k) ?? ""));
    const result = await addMedia(null, fd);
    setState(result?.ok ? { ok: true, message: `Загружено (${size.width}×${size.height})` } : result);
    if (result?.ok) form.reset();
  }

  return (
    <form
      ref={formRef}
      className="adm-form"
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        startTransition(() => submit(form));
      }}
    >
      <div>
        <label htmlFor="media-file" className="label">
          Файл (JPEG, PNG, WebP, AVIF; до 15 МБ — сервер сам уменьшит и сожмёт) *
        </label>
        <input id="media-file" name="file" type="file" required accept="image/jpeg,image/png,image/webp,image/avif" className="field" />
      </div>
      <div className="adm-grid">
        <div>
          <label htmlFor="media-kind" className="label">
            Тип
          </label>
          <select id="media-kind" name="kind" defaultValue="PRODUCT" className="field">
            {Object.entries(KINDS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="media-rights" className="label">
            Права
          </label>
          <select id="media-rights" name="rights" defaultValue="UNCONFIRMED" className="field">
            {Object.entries(RIGHTS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="media-rn" className="label">
            Заметка о правах
          </label>
          <input id="media-rn" name="rightsNote" maxLength={300} className="field" />
        </div>
        {(["Hy", "Ru", "It", "En"] as const).map((l) => (
          <div key={l}>
            <label htmlFor={`media-alt-${l}`} className="label">
              Alt {l.toUpperCase()}
            </label>
            <input id={`media-alt-${l}`} name={`alt${l}`} maxLength={200} className="field" />
          </div>
        ))}
      </div>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>
          {pending ? "Загрузка…" : "Загрузить"}
        </button>
      </div>
      {state ? (
        <p role={state.ok ? "status" : "alert"} className={state.ok ? "adm-msg adm-msg-ok" : "adm-msg adm-msg-bad"}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
