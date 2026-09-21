'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Upload } from 'lucide-react';
import { Alert, Button, Select, Textarea } from '@/components/ui';
import { Panel, Table } from './ui';

type ImportResult = {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  dryRun: boolean;
  results: { sku: string; status: string; reason?: string }[];
};

const SAMPLE_CSV = `sku,categorySlug,brandSlug,priceMinor,oldPriceMinor,stockQty,nameRu,nameHy,nameEn,colorKeys,materialKeys,styleKey,widthMm,depthMm,heightMm
IMP-0001,straight-sofas,sevan-home,349900,419900,4,"Диван прямой IMPORT, рогожка, серый","Ուղիղ բազմոց IMPORT","Straight sofa IMPORT",grey;beige,rogozhka,modern,2100,900,850
IMP-0002,dining-tables,tavush-oak,189900,,2,"Стол обеденный IMPORT, дуб","Ճաշի սեղան IMPORT","Dining table IMPORT",oak,oakSolid,scandi,1600,900,750`;

/** CSV/JSON bulk import with a dry run that reports before anything is written. */
export const ImportForm = () => {
  const router = useRouter();
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [payload, setPayload] = useState(SAMPLE_CSV);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    const response = await fetch('/api/admin/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ format, payload, dryRun }),
    });
    setBusy(false);
    if (response.ok) {
      setResult((await response.json()) as ImportResult);
      if (!dryRun) router.refresh();
      return;
    }
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    setError(
      data.error === 'invalid_json'
        ? 'Некорректный JSON'
        : data.error === 'too_many_rows'
          ? 'Слишком много строк (максимум 500)'
          : 'Не удалось выполнить импорт',
    );
  };

  const onFile = async (file: File) => {
    const text = await file.text();
    setPayload(text);
    setFormat(file.name.endsWith('.json') ? 'json' : 'csv');
  };

  return (
    <div className="space-y-4">
      <Panel>
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select value={format} onChange={(event) => setFormat(event.target.value as 'csv' | 'json')} className="w-40">
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </Select>
            <label className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border border-line px-4 text-[13px] hover:border-ink">
              <Upload width={16} height={16} />
              Загрузить файл
              <input
                type="file"
                accept=".csv,.json,text/csv,application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void onFile(file);
                }}
              />
            </label>
          </div>

          <Textarea
            value={payload}
            onChange={(event) => setPayload(event.target.value)}
            className="min-h-64 font-mono text-[12px]"
          />

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => run(true)} disabled={busy}>
              {busy ? <Loader2 width={16} height={16} className="animate-spin" /> : null}
              Проверить (dry run)
            </Button>
            <Button onClick={() => run(false)} disabled={busy}>
              Импортировать
            </Button>
          </div>

          {error ? <Alert tone="error">{error}</Alert> : null}
        </div>
      </Panel>

      {result ? (
        <Panel title={result.dryRun ? 'Результат проверки' : 'Результат импорта'}>
          <div className="flex flex-wrap gap-6 border-b border-line px-4 py-3 text-[13px]">
            <span>Строк: <b className="tabular-nums">{result.total}</b></span>
            <span className="text-success">Создано: <b className="tabular-nums">{result.created}</b></span>
            <span className="text-info">Обновлено: <b className="tabular-nums">{result.updated}</b></span>
            <span className="text-sale">Пропущено: <b className="tabular-nums">{result.skipped}</b></span>
          </div>
          <Table head={['SKU', 'Статус', 'Причина']}>
            {result.results.map((row, index) => (
              <tr key={`${row.sku}-${index}`}>
                <td className="px-4 py-2">{row.sku}</td>
                <td className="px-4 py-2">{row.status}</td>
                <td className="px-4 py-2 text-muted">{row.reason ?? ''}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      ) : null}
    </div>
  );
};
