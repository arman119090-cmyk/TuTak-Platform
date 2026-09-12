from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'anchor not found in {path}: {old[:100]!r}')
    p.write_text(text.replace(old, new, 1))

replace_once(
    'apps/api/prisma/schema.prisma',
    '  status          PurchaseIntentStatus @default(AWAITING_CONFIRMATION)\n\n  grossAmount',
    '  status          PurchaseIntentStatus @default(AWAITING_CONFIRMATION)\n  /// Four-digit till code shown to the customer and branch staff. It is a\n  /// disambiguator, not an authorization secret. Active uniqueness is\n  /// enforced by partial PostgreSQL indexes in the migration.\n  confirmationCode String? @db.Char(4)\n\n  grossAmount',
)

migration = Path('apps/api/prisma/migrations/20260912190500_purchase_intent_confirmation_code')
migration.mkdir(parents=True, exist_ok=True)
(migration / 'migration.sql').write_text('''-- Four-digit till code for the bonus-only PurchaseIntent pilot.\nALTER TABLE "purchase_intents" ADD COLUMN "confirmationCode" CHAR(4);\n\nCREATE UNIQUE INDEX "purchase_intents_active_branch_confirmation_code_key"\nON "purchase_intents" ("partnerBranchId", "confirmationCode")\nWHERE "status" = 'AWAITING_CONFIRMATION' AND "partnerBranchId" IS NOT NULL AND "confirmationCode" IS NOT NULL;\n\nCREATE UNIQUE INDEX "purchase_intents_active_partner_confirmation_code_key"\nON "purchase_intents" ("partnerId", "confirmationCode")\nWHERE "status" = 'AWAITING_CONFIRMATION' AND "partnerBranchId" IS NULL AND "confirmationCode" IS NOT NULL;\n''')

replace_once(
    'apps/api/src/modules/purchase-intents/purchase-intents.service.ts',
    "import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';",
    "import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';\nimport { randomInt } from 'node:crypto';",
)

replace_once(
    'apps/api/src/modules/purchase-intents/purchase-intents.service.ts',
    '''      const intent = await this.prisma.purchaseIntent.create({\n        data: {\n          customerId,\n          partnerId: partner.id,''',
    '''      const baseIntentData: Prisma.PurchaseIntentUncheckedCreateInput = {\n          customerId,\n          partnerId: partner.id,''',
)
replace_once(
    'apps/api/src/modules/purchase-intents/purchase-intents.service.ts',
    '''          sourceTransactionId: transaction.id,\n          expiresAt,\n        },\n      });\n\n      await this.auditService.record({''',
    '''          sourceTransactionId: transaction.id,\n          expiresAt,\n        };\n\n      const intent = await this.createIntentWithConfirmationCode(baseIntentData);\n\n      await this.auditService.record({''',
)

anchor = '''  /**\n   * Spec §7 steps 9-11, and §12-16 for the pool distribution this triggers.'''
helper = '''  /** Allocate a four-digit code under the database partial unique index. */\n  private async createIntentWithConfirmationCode(\n    data: Prisma.PurchaseIntentUncheckedCreateInput,\n  ) {\n    for (let attempt = 0; attempt < 12; attempt += 1) {\n      const confirmationCode = String(randomInt(0, 10_000)).padStart(4, '0');\n      try {\n        return await this.prisma.purchaseIntent.create({\n          data: { ...data, confirmationCode },\n        });\n      } catch (error) {\n        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {\n          throw error;\n        }\n        const target = String(error.meta?.target ?? '');\n        if (!target.includes('confirmationCode')) throw error;\n      }\n    }\n    throw new BadRequestException('Could not allocate a purchase confirmation code; please retry');\n  }\n\n'''
replace_once('apps/api/src/modules/purchase-intents/purchase-intents.service.ts', anchor, helper + anchor)

replace_once(
    'packages/shared-types/src/dto/purchase-intent.ts',
    '  status: PurchaseIntentStatus;\n  grossAmount: string;',
    '  status: PurchaseIntentStatus;\n  /** Four digits shown at the till; historical intents may not have one. */\n  confirmationCode: string | null;\n  grossAmount: string;',
)

test_path = Path('apps/api/test/purchase-intents.int-spec.ts')
test_text = test_path.read_text()
insert_after = '''      expect(intent.status).toBe(PurchaseIntentStatus.AWAITING_CONFIRMATION);\n      expect(intent.ordinaryPaymentRemainder.toFixed(4)).toBe('10000.0000');\n      expect(intent.negotiatedRateBps).toBe(500);\n      expect(await prisma.ledgerTransaction.count()).toBe(0);\n    });\n'''
addition = insert_after + '''\n    it('issues four-digit active codes unique inside one branch', async () => {\n      const partner = await createPartner(prisma);\n      const branch = await prisma.partnerBranch.create({\n        data: { partnerId: partner.id, name: 'Pilot branch', address: '1 Test St', city: 'Yerevan', latitude: 40.18, longitude: 44.51 },\n      });\n      const intents = await Promise.all(\n        Array.from({ length: 40 }, async (_, index) => {\n          const { user } = await createCustomer(prisma);\n          return purchaseIntents.create(\n            { partnerId: partner.id, partnerBranchId: branch.id, grossAmount: String(1000 + index) },\n            user.id,\n          );\n        }),\n      );\n      expect(intents.every((intent) => /^\\d{4}$/.test(intent.confirmationCode ?? ''))).toBe(true);\n      expect(new Set(intents.map((intent) => intent.confirmationCode)).size).toBe(intents.length);\n    });\n\n    it('database rejects a same-code active race and releases the code after terminal state', async () => {\n      const partner = await createPartner(prisma);\n      const branch = await prisma.partnerBranch.create({\n        data: { partnerId: partner.id, name: 'Race branch', address: '2 Test St', city: 'Yerevan', latitude: 40.18, longitude: 44.51 },\n      });\n      const c1 = await createCustomer(prisma);\n      const c2 = await createCustomer(prisma);\n      const i1 = await purchaseIntents.create({ partnerId: partner.id, partnerBranchId: branch.id, grossAmount: '1000' }, c1.user.id);\n      const i2 = await purchaseIntents.create({ partnerId: partner.id, partnerBranchId: branch.id, grossAmount: '1001' }, c2.user.id);\n      const results = await Promise.allSettled([\n        prisma.purchaseIntent.update({ where: { id: i1.id }, data: { confirmationCode: '4242' } }),\n        prisma.purchaseIntent.update({ where: { id: i2.id }, data: { confirmationCode: '4242' } }),\n      ]);\n      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);\n      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);\n      const winner = await prisma.purchaseIntent.findFirstOrThrow({ where: { partnerBranchId: branch.id, confirmationCode: '4242' } });\n      await prisma.purchaseIntent.update({ where: { id: winner.id }, data: { status: PurchaseIntentStatus.REJECTED } });\n      const loserId = winner.id === i1.id ? i2.id : i1.id;\n      await expect(prisma.purchaseIntent.update({ where: { id: loserId }, data: { confirmationCode: '4242' } })).resolves.toMatchObject({ confirmationCode: '4242' });\n    });\n'''
if insert_after not in test_text:
    raise SystemExit('test insertion anchor not found')
test_path.write_text(test_text.replace(insert_after, addition, 1))

Path('scripts/pilot-pr2-apply.py').unlink(missing_ok=True)
Path('.github/workflows/pilot-pr2-apply.yml').unlink(missing_ok=True)
