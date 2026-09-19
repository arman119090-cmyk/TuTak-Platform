# Off-Railway encrypted dump (подготовлено, НЕ включено)

**Зачем.** PITR и снимки тома живут внутри проекта Railway: потеря
проекта/аккаунта или инцидент на стороне провайдера уносит и базу, и все её
копии. Этот сервис — единственная копия вне Railway.

**Как устроено.** Отдельный Railway-сервис из `infra/offsite-backup`
(Dockerfile), cron-расписание в настройках сервиса (например `17 3 * * *`),
приватная сеть до Postgres (наружу Postgres не открывается), `pg_dump` →
шифрование `age` публичным ключом → S3-совместимый bucket **не у Railway**.
Ключ расшифровки хранится у владельца офлайн; Railway расшифровать дампы не
может.

**Включение (после пилота или когда будет bucket):**
1. `age-keygen -o tutak-backup.key` на ноутбуке владельца; публичную часть
   (`age1…`) — в переменную `BACKUP_AGE_RECIPIENT`; файл ключа — в
   password manager, не в репо.
2. Bucket у стороннего провайдера, ключ доступа **только на запись**
   (put + head), versioning on, lifecycle 35 дней.
3. Railway → New → GitHub repo → root `infra/offsite-backup`, builder
   Dockerfile → Settings → Cron Schedule → переменные из `backup.sh`.
4. Первый запуск вручную → в bucket появился объект → скачать, `age -d`,
   `pg_restore --list` — это и есть доказательство.

**Restore.** `age -d -i tutak-backup.key file.dump.age > file.dump`, затем
`scripts/restore.sh --into tutak_recovered file.dump` на любом Postgres 18 и
`scripts/verify-restored-db.sh`.

До включения: **residual risk = provider-level failure / account loss
остаётся открытым.**
