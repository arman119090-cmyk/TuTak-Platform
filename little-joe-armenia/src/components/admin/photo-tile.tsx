"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deletePhoto, makeMainPhoto, movePhoto, setMainPhoto } from "@/app/admin/photos/actions";

type Photo = { id: string; url: string };
type Props = {
  productId: string;
  name: string;
  collection: string;
  accent: string;
  photos: Photo[];
  editHref: string;
};

const MAX_BYTES = 15 * 1024 * 1024;

function uploadError(status: number) {
  if (status === 401) return "сессия истекла — войдите снова";
  if (status === 413) return "файл больше 15 МБ";
  if (status === 415) return "нужен JPEG, PNG, WebP или AVIF";
  if (status === 429) return "слишком много загрузок, подождите";
  return `ошибка ${status}`;
}

/**
 * One product in the photo manager: big preview of the selected photo,
 * thumbnails of all photos, and plain actions — add, make main, move,
 * delete. Built for a phone first (big tap targets, no hidden hover UI).
 */
export function PhotoTile({ productId, name, collection, accent, photos, editHref }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // null = "the main photo", whichever it is after the next refresh; a
  // deleted selection also falls back to the main photo.
  const index = Math.max(0, photos.findIndex((p) => p.id === selectedId));
  const selected = photos[index] ?? null;
  const working = pending || busy !== null;

  const run = (label: string, fn: () => Promise<{ ok: boolean; message?: string } | null | undefined>) =>
    start(async () => {
      setMsg(null);
      setBusy(label);
      try {
        const r = await fn();
        setMsg({ ok: Boolean(r?.ok), text: r?.message ?? (r?.ok ? "Готово" : "Не получилось") });
        if (r?.ok) router.refresh();
      } finally {
        setBusy(null);
      }
    });

  const upload = (files: File[]) =>
    run("upload", async () => {
      const images = files.filter((f) => f.size > 0);
      if (!images.length) return { ok: false, message: "Выберите фото" };
      const tooBig = images.find((f) => f.size > MAX_BYTES);
      if (tooBig) return { ok: false, message: `«${tooBig.name}» больше 15 МБ` };
      // Each added photo goes to the front, so add in reverse: the first chosen ends up main.
      let done = 0;
      for (const file of [...images].reverse()) {
        setBusy(images.length > 1 ? `Загрузка ${done + 1} из ${images.length}…` : "Загрузка…");
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/admin/upload", { method: "POST", body: fd, credentials: "same-origin" });
        if (!res.ok) return { ok: done > 0, message: `${done ? `Загружено ${done}, затем ` : ""}не загружено «${file.name}»: ${uploadError(res.status)}` };
        const up = (await res.json()) as { url: string; storageKey: string; width: number; height: number };
        const r = await setMainPhoto({ productId, ...up });
        if (!r?.ok) return { ok: done > 0, message: r?.message ?? "Не удалось сохранить фото" };
        done++;
      }
      setSelectedId(null);
      return { ok: true, message: done > 1 ? `Добавлено фото: ${done}. Первое стало главным` : "Фото добавлено и стало главным" };
    });

  const remove = () => {
    if (!selected) return;
    const last = photos.length === 1;
    const question = last ? `Удалить единственное фото «${name}»? На сайте товар останется без фото.` : `Удалить это фото у «${name}»?`;
    if (!window.confirm(question)) return;
    run("delete", () => deletePhoto(selected.id));
  };

  return (
    <li
      className={`overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgb(20_50_100/0.06),0_10px_28px_-14px_rgb(20_50_100/0.25)] ring-1 ${dragOver ? "ring-2 ring-[#1463e6]" : "ring-black/[0.04]"}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (!working) upload([...e.dataTransfer.files].filter((f) => f.type.startsWith("image/")));
      }}
    >
      <div className="flex items-baseline justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-slate-500">{collection}</p>
          <h2 className="font-semibold leading-snug">{name}</h2>
        </div>
        <span className="shrink-0 text-xs font-medium text-slate-500">{photos.length ? `${photos.length} фото` : "нет фото"}</span>
      </div>

      {/* Big preview of the selected photo */}
      <div
        className="relative mx-4 mt-3 aspect-[4/3] overflow-hidden rounded-xl"
        style={{ background: `radial-gradient(110% 85% at 50% 100%, color-mix(in oklab, ${accent} 30%, white), #eef5fd 60%, #fff)` }}
      >
        {selected ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin preview
          <img src={selected.url} alt={name} className="absolute inset-[6%] h-[88%] w-[88%] object-contain" />
        ) : (
          <button
            type="button"
            disabled={working}
            onClick={() => input.current?.click()}
            className="absolute inset-0 grid place-items-center border-2 border-dashed border-[#1463e6]/35 text-sm font-semibold text-[#1463e6]"
          >
            <span className="grid place-items-center gap-1">
              <span className="text-3xl leading-none">＋</span>
              Добавить фото
            </span>
          </button>
        )}
        {selected ? (
          <span className={`absolute left-2 top-2 rounded-full px-2.5 py-1 text-[0.7rem] font-bold ${index === 0 ? "bg-[#1463e6] text-white" : "bg-white/90 text-slate-700"}`}>
            {index === 0 ? "★ Главное фото" : `Фото ${index + 1} из ${photos.length}`}
          </span>
        ) : null}
        {working ? <div className="absolute inset-0 grid place-items-center bg-white/75 text-sm font-semibold">{busy && busy.startsWith("Загрузка") ? busy : "Сохраняю…"}</div> : null}
      </div>

      {/* Thumbnails: tap to select */}
      {photos.length > 1 ? (
        <ul className="flex gap-2 overflow-x-auto px-4 pb-1 pt-3" aria-label={`Все фото «${name}»`}>
          {photos.map((p, i) => (
            <li key={p.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setSelectedId(p.id)}
                aria-label={i === 0 ? "Главное фото" : `Фото ${i + 1}`}
                aria-pressed={p.id === selected?.id}
                className={`relative block h-16 w-16 overflow-hidden rounded-lg bg-[#eef5fd] ring-2 ${p.id === selected?.id ? "ring-[#1463e6]" : "ring-transparent"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- admin thumbnail */}
                <img src={p.url} alt="" className="h-full w-full object-contain p-1" />
                {i === 0 ? <span className="absolute bottom-0 left-0 right-0 bg-[#1463e6] text-center text-[0.6rem] font-bold text-white">главное</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="p-4 pt-3">
        <input
          ref={input}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="sr-only"
          aria-label={`Добавить фото для «${name}»`}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) upload(files);
          }}
        />
        <button
          type="button"
          disabled={working}
          onClick={() => input.current?.click()}
          className="min-h-12 w-full rounded-xl bg-[#1463e6] px-3 text-[0.95rem] font-semibold text-white shadow-[0_6px_16px_-8px_rgb(20_99_230/0.7)] hover:bg-[#0f55cc] disabled:opacity-50"
        >
          ＋ Добавить фото
        </button>

        {selected ? (
          <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-2">
            <button
              type="button"
              disabled={working || index === 0}
              onClick={() => run("main", () => makeMainPhoto(selected.id))}
              className="min-h-11 rounded-xl px-2 text-[0.85rem] font-semibold text-[#1463e6] ring-1 ring-[#1463e6]/35 hover:ring-[#1463e6] disabled:text-slate-400 disabled:ring-slate-200"
            >
              {index === 0 ? "★ Главное" : "★ Сделать главным"}
            </button>
            <div className="flex">
              <button
                type="button"
                disabled={working || index === 0}
                onClick={() => run("move", () => movePhoto(selected.id, "left"))}
                aria-label="Сдвинуть влево"
                className="min-h-11 w-11 rounded-l-xl text-lg ring-1 ring-slate-300 disabled:text-slate-300"
              >
                ←
              </button>
              <button
                type="button"
                disabled={working || index === photos.length - 1}
                onClick={() => run("move", () => movePhoto(selected.id, "right"))}
                aria-label="Сдвинуть вправо"
                className="-ml-px min-h-11 w-11 rounded-r-xl text-lg ring-1 ring-slate-300 disabled:text-slate-300"
              >
                →
              </button>
            </div>
            <button
              type="button"
              disabled={working}
              onClick={remove}
              className="min-h-11 rounded-xl px-3 text-[0.85rem] font-semibold text-red-700 ring-1 ring-red-300 hover:bg-red-50 disabled:opacity-50"
            >
              Удалить
            </button>
          </div>
        ) : null}

        {msg ? (
          <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-sm font-medium ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>
            {msg.text}
          </p>
        ) : null}
        <a href={editHref} className="mt-3 inline-block text-xs font-medium text-slate-500 underline underline-offset-2">
          Подписи и права фото — в карточке товара
        </a>
      </div>
    </li>
  );
}
