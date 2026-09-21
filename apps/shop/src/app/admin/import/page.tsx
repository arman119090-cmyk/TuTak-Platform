import { AdminHeading, Panel } from '@/components/admin/ui';
import { ImportForm } from '@/components/admin/import-form';

const AdminImport = () => (
  <>
    <AdminHeading
      title="Импорт товаров"
      subtitle="CSV или JSON. Категория и бренд сопоставляются по slug и должны существовать."
    />
    <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <ImportForm />
      <Panel title="Формат файла">
        <div className="space-y-3 p-4 text-[13px] text-muted">
          <p>Обязательные колонки:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><code>sku</code> — уникальный артикул</li>
            <li><code>categorySlug</code>, <code>brandSlug</code> — существующие slug</li>
            <li><code>priceMinor</code> — цена в драмах (целое число)</li>
            <li><code>nameRu</code> — название</li>
          </ul>
          <p>Необязательные: <code>oldPriceMinor</code>, <code>stockQty</code>, <code>nameHy</code>,{' '}
            <code>nameEn</code>, <code>descriptionRu</code>, <code>colorKeys</code>,{' '}
            <code>materialKeys</code>, <code>styleKey</code>, <code>widthMm</code>,{' '}
            <code>depthMm</code>, <code>heightMm</code>.</p>
          <p>
            Товар с существующим <code>sku</code> будет обновлён, а не продублирован. Изображения
            генерируются автоматически.
          </p>
        </div>
      </Panel>
    </div>
  </>
);

export default AdminImport;
