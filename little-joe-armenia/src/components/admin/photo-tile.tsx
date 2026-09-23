"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setMainPhoto } from "@/app/admin/photos/actions";

type Props = {
  productId: string;
  name: string;
  collection: string;
  accent: string;
  photo: { url: string; count: number } | null;
  editHref: string;
};

/** One product in the photo manager: current main photo + upload/replace. */
export function PhotoTile({ productId, name, collection, accent, photo, editHref }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const upload = (file: File) =>
    start(async () => {
      setMsg(null);
      if (file.size > 15 * 1024 * 1024) return setMsg({ ok: false, text: "Файл больше 15 МБ" });
      setPreview(URL.createObjectURL(file));
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd, credentials: "same-origin" });
      if (!res.ok) {
        setPreview(null);
        const reason =
          res.status === 401 ? "сессия истекла — войдите снова" : res.status === 415 ? "нужен JPEG, PNG, WebP или AVIF" : res.status === 413 ? "файл больше 15 МБ" : res.status === 429 ? "слишком много загрузок, подождите" : `ошибка ${res.status}`;
        return setMsg({ ok: false, text: `Не загружено: ${reason}` });
      }
      const up = (await res.json()) as { url: string; storageKey: string; width: number; height: number };
      const r = await setMainPhoto({ productId, ...up });
      setMsg({ ok: Boolean(r?.ok), text: r?.message ?? "Готово" });
      if (r?.ok) router.refresh();
    });

  const shown = preview ?? photo?.url ?? null;

  return (
    <li className="group overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgb(20_50_100/0.06),0_10px_28px_-14px_rgb(20_50_100/0.25)] ring-1 ring-black/[0.04]">
      <div
        className="relative aspect-square"
        style={{ background: `radial-gradient(110% 85% at 50% 100%, color-mix(in oklab, ${accent} 30%, white), #eef5fd 60%, #fff)` }}
      >
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- admin preview (blob: URLs included)
          <img src={shown} alt={name} className="absolute inset-[8%] h-[84%] w-[84%] object-contain" />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-sm font-medium text-slate-500">Нет фото</div>
        )}
        {pending ? <div className="absolute inset-0 grid place-items-center bg-white/70 text-sm font-semibold">Загрузка…</div> : null}
        {photo && photo.count > 1 ? (
          <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[0.7rem] font-semibold text-slate-600">{photo.count} фото</span>
        ) : null}
      </div>
      <div className="p-3">
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-slate-500">{collection}</p>
        <p className="truncate font-semibold">{name}</p>
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif"
          className="sr-only"
          aria-label={`Фото для ${name}`}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
            e.target.value = "";
          }}
        />
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => input.current?.click()}
            className="min-h-10 flex-1 whitespace-nowrap rounded-xl bg-[#1463e6] px-2 text-[0.8rem] font-semibold text-white shadow-[0_6px_16px_-8px_rgb(20_99_230/0.7)] hover:bg-[#0f55cc] disabled:opacity-50"
          >
            {photo ? "Заменить фото" : "Загрузить фото"}
          </button>
          <a href={editHref} className="grid min-h-10 place-items-center whitespace-nowrap rounded-xl px-2.5 text-[0.8rem] font-semibold text-[#1463e6] ring-1 ring-[#1463e6]/30 hover:ring-[#1463e6]">
            Все фото
          </a>
        </div>
        {msg ? (
          <p role="status" className={`mt-2 text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>
            {msg.text}
          </p>
        ) : null}
      </div>
    </li>
  );
}
