import { PrismaClient, type Prisma, type Locale, type OrderStatus } from '@prisma/client';
import { brand } from '../src/config/brand';
import { TAXONOMY, type CategoryNode } from '../src/data/taxonomy';
import { hashPassword } from '../src/lib/auth/password';
import { createRng } from '../src/lib/utils';
import { BRANDS, COLLECTIONS, generateProducts } from './seed/catalog';
import { BANNERS, DOOR_OPTIONS, PROMO_CODES } from './seed/content';
import { REVIEW_AUTHORS, REVIEW_TEXTS, REVIEW_TITLES } from './seed/text';

const prisma = new PrismaClient();
const LOCALES: Locale[] = ['hy', 'ru', 'en'];

const log = (message: string): void => console.log(`  ${message}`);

/** Wipes the demo data so the seed is idempotent and re-runnable. */
const reset = async (): Promise<void> => {
  await prisma.$transaction([
    prisma.orderEvent.deleteMany(),
    prisma.orderItem.deleteMany(),
    prisma.order.deleteMany(),
    prisma.request.deleteMany(),
    prisma.review.deleteMany(),
    prisma.favorite.deleteMany(),
    prisma.recentlyViewed.deleteMany(),
    prisma.productOption.deleteMany(),
    prisma.productImage.deleteMany(),
    prisma.productTranslation.deleteMany(),
    prisma.product.deleteMany(),
    prisma.collectionTranslation.deleteMany(),
    prisma.collection.deleteMany(),
    prisma.brandTranslation.deleteMany(),
    prisma.brand.deleteMany(),
    prisma.categoryTranslation.deleteMany(),
    prisma.address.deleteMany(),
    prisma.newsletterSubscriber.deleteMany(),
    prisma.bannerTranslation.deleteMany(),
    prisma.banner.deleteMany(),
    prisma.doorConfigOption.deleteMany(),
    prisma.promoCode.deleteMany(),
    prisma.setting.deleteMany(),
  ]);
  // Categories are self-referencing, so children go before parents.
  await prisma.category.deleteMany({ where: { parentId: { not: null } } });
  await prisma.category.deleteMany();
  await prisma.user.deleteMany();
};

const seedCategories = async (): Promise<Map<string, string>> => {
  const ids = new Map<string, string>();

  const createNode = async (
    node: CategoryNode,
    parentId: string | null,
    sort: number,
  ): Promise<void> => {
    const category = await prisma.category.create({
      data: {
        slug: node.slug,
        parentId,
        artKey: node.artKey,
        filterKeys: node.filterKeys ?? [],
        sort,
        translations: {
          create: LOCALES.map((locale) => ({
            locale,
            name: node.names[locale],
            description: node.intro?.[locale] ?? null,
            metaTitle: `${node.names[locale]} — ${brand.name}`,
            metaDescription: node.intro?.[locale] ?? node.names[locale],
          })),
        },
      },
    });
    ids.set(node.slug, category.id);
    let childSort = 0;
    for (const child of node.children ?? []) {
      await createNode(child, category.id, childSort);
      childSort += 1;
    }
  };

  let rootSort = 0;
  for (const root of TAXONOMY) {
    await createNode(root, null, rootSort);
    rootSort += 1;
  }
  return ids;
};

const seedBrandsAndCollections = async (): Promise<{
  brands: Map<string, string>;
  collections: Map<string, string>;
}> => {
  const brands = new Map<string, string>();
  for (const brand of BRANDS) {
    const created = await prisma.brand.create({
      data: {
        slug: brand.slug,
        name: brand.name,
        country: brand.country,
        foundedYear: brand.foundedYear,
        isPremium: brand.isPremium,
        translations: {
          create: LOCALES.map((locale) => ({
            locale,
            tagline: brand.tagline[locale],
            description: brand.description[locale],
          })),
        },
      },
    });
    brands.set(brand.slug, created.id);
  }

  const collections = new Map<string, string>();
  for (const collection of COLLECTIONS) {
    const created = await prisma.collection.create({
      data: {
        slug: collection.slug,
        name: collection.name,
        brandId: brands.get(collection.brandSlug) ?? null,
        translations: {
          create: LOCALES.map((locale) => ({ locale, name: collection.name })),
        },
      },
    });
    collections.set(collection.slug, created.id);
  }
  return { brands, collections };
};

const seedProducts = async (
  categories: Map<string, string>,
  brands: Map<string, string>,
  collections: Map<string, string>,
): Promise<{
  count: number;
  ids: { id: string; sku: string; categorySlug: string; priceMinor: number; rootSlug: string }[];
}> => {
  const generated = generateProducts();
  const ids: {
    id: string;
    sku: string;
    categorySlug: string;
    priceMinor: number;
    rootSlug: string;
  }[] = [];

  for (const product of generated) {
    const categoryId = categories.get(product.categorySlug);
    const brandId = brands.get(product.brandSlug);
    if (!categoryId || !brandId) throw new Error(`Missing category/brand for ${product.sku}`);

    const created = await prisma.product.create({
      data: {
        sku: product.sku,
        slug: product.slug,
        categoryId,
        brandId,
        collectionId: product.collectionSlug
          ? (collections.get(product.collectionSlug) ?? null)
          : null,
        priceMinor: product.priceMinor,
        oldPriceMinor: product.oldPriceMinor,
        discountPct: product.discountPct,
        stockStatus: product.stockStatus,
        stockQty: product.stockQty,
        productionDays: product.productionDays,
        widthMm: product.widthMm,
        heightMm: product.heightMm,
        depthMm: product.depthMm,
        weightGram: product.weightGram,
        country: product.country,
        warrantyMonths: product.warrantyMonths,
        styleKey: product.styleKey,
        purposeKey: product.purposeKey,
        roomKey: product.roomKey,
        colorKeys: product.colorKeys,
        materialKeys: product.materialKeys,
        specs: product.specs as Prisma.InputJsonValue,
        ratingAvg: product.ratingAvg,
        reviewCount: product.reviewCount,
        salesCount: product.salesCount,
        isNew: product.isNew,
        isHit: product.isHit,
        isPremium: product.isPremium,
        isFeatured: product.isFeatured,
        smallSpace: product.smallSpace,
        searchText: product.searchText,
        translations: { create: product.translations },
        images: {
          create: product.images.map((image) => ({
            url: image.url,
            sort: image.sort,
            isPrimary: image.isPrimary,
            alt:
              product.translations.find((translation) => translation.locale === 'ru')?.name ??
              product.sku,
          })),
        },
        options: { create: product.options },
      },
      select: { id: true, sku: true },
    });
    ids.push({
      id: created.id,
      sku: created.sku,
      categorySlug: product.categorySlug,
      priceMinor: product.priceMinor,
      rootSlug: product.rootSlug,
    });
  }

  return { count: generated.length, ids };
};

const seedReviews = async (
  products: { id: string; sku: string }[],
  customerId: string,
): Promise<number> => {
  const rows: Prisma.ReviewCreateManyInput[] = [];
  products.forEach((product, index) => {
    const rng = createRng(index * 97 + 13);
    const count = Math.floor(rng() * 5);
    for (let i = 0; i < count; i += 1) {
      // Rating mix of a real furniture shop: mostly 5s, a solid tail of 4s and
      // the occasional 3 — flat 5.00 everywhere reads as fake.
      const roll = rng();
      const band = REVIEW_TEXTS[roll > 0.48 ? 0 : roll > 0.12 ? 1 : 2]!;
      const text = band.texts[Math.floor(rng() * band.texts.length)]!;
      const title = REVIEW_TITLES[Math.floor(rng() * REVIEW_TITLES.length)]!;
      const daysAgo = Math.floor(rng() * 260) + 1;
      rows.push({
        productId: product.id,
        userId: i === 0 && index % 17 === 0 ? customerId : null,
        authorName: REVIEW_AUTHORS[Math.floor(rng() * REVIEW_AUTHORS.length)]!,
        rating: band.rating,
        title: title.ru,
        body: text.ru,
        locale: 'ru',
        createdAt: new Date(Date.now() - daysAgo * 86_400_000),
      });
    }
  });
  await prisma.review.createMany({ data: rows });

  // Keep the denormalised rating in sync with the reviews that were created.
  const grouped = await prisma.review.groupBy({
    by: ['productId'],
    _avg: { rating: true },
    _count: { _all: true },
  });
  for (const group of grouped) {
    await prisma.product.update({
      where: { id: group.productId },
      data: {
        ratingAvg: Number((group._avg.rating ?? 0).toFixed(2)),
        reviewCount: group._count._all,
      },
    });
  }
  await prisma.product.updateMany({
    where: { reviewCount: { gt: 0 }, ratingAvg: 0 },
    data: { ratingAvg: 4.5 },
  });
  return rows.length;
};

const ORDER_PLAN: { status: OrderStatus; daysAgo: number; paid: boolean; items: number }[] = [
  { status: 'DELIVERED', daysAgo: 96, paid: true, items: 2 },
  { status: 'DELIVERED', daysAgo: 71, paid: true, items: 1 },
  { status: 'SHIPPED', daysAgo: 12, paid: true, items: 3 },
  { status: 'IN_PRODUCTION', daysAgo: 9, paid: true, items: 2 },
  { status: 'PAID', daysAgo: 6, paid: true, items: 1 },
  { status: 'CONFIRMED', daysAgo: 4, paid: false, items: 2 },
  { status: 'NEW', daysAgo: 1, paid: false, items: 1 },
  { status: 'CANCELLED', daysAgo: 40, paid: false, items: 1 },
  { status: 'READY', daysAgo: 15, paid: true, items: 2 },
  { status: 'DELIVERED', daysAgo: 130, paid: true, items: 4 },
  { status: 'NEW', daysAgo: 0, paid: false, items: 2 },
  { status: 'IN_PRODUCTION', daysAgo: 21, paid: true, items: 1 },
];

/** Status history a real order would have accumulated by now. */
const historyFor = (status: OrderStatus): OrderStatus[] => {
  const flow: OrderStatus[] = [
    'NEW',
    'CONFIRMED',
    'PAID',
    'IN_PRODUCTION',
    'READY',
    'SHIPPED',
    'DELIVERED',
  ];
  if (status === 'CANCELLED') return ['NEW', 'CANCELLED'];
  const index = flow.indexOf(status);
  return flow.slice(0, index + 1);
};

const seedOrders = async (
  products: { id: string; sku: string; priceMinor: number }[],
  users: { id: string; name: string; email: string; phone: string }[],
): Promise<number> => {
  const regions = ['yerevan', 'yerevan', 'yerevan', 'kotayk', 'shirak', 'lori'];
  const cities = ['Кентрон', 'Арабкир', 'Давташен', 'Абовян', 'Гюмри', 'Ванадзор'];
  let counter = 0;

  for (const [index, plan] of ORDER_PLAN.entries()) {
    const rng = createRng(index * 7919 + 101);
    const user = users[index % users.length]!;
    const createdAt = new Date(Date.now() - plan.daysAgo * 86_400_000);
    counter += 1;

    const chosen = Array.from(
      { length: plan.items },
      () => products[Math.floor(rng() * products.length)]!,
    );
    const items = chosen.map((product) => {
      const quantity = rng() > 0.8 ? 2 : 1;
      return {
        productId: product.id,
        sku: product.sku,
        nameSnapshot: product.sku,
        unitPriceMinor: product.priceMinor,
        quantity,
        lineTotalMinor: product.priceMinor * quantity,
        optionsSnapshot: {} as Prisma.InputJsonValue,
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.lineTotalMinor, 0);
    const deliveryMinor = subtotal >= 400_000 ? 0 : 5_000;
    const servicesMinor = rng() > 0.6 ? 12_000 : 0;
    const promoDiscount = index % 4 === 0 ? Math.round(subtotal * 0.1) : 0;
    const total = subtotal - promoDiscount + deliveryMinor + servicesMinor;
    const regionKey = regions[index % regions.length]!;

    const order = await prisma.order.create({
      data: {
        number: `ORD-${new Date(createdAt).getFullYear()}-${String(1000 + counter)}`,
        userId: user.id,
        status: plan.status,
        locale: 'ru',
        customerName: user.name,
        customerPhone: user.phone,
        customerEmail: user.email,
        deliveryMethod: index % 6 === 5 ? 'PICKUP' : 'DELIVERY',
        region: regionKey,
        city: cities[index % cities.length]!,
        street: 'ул. Демонстрационная',
        building: String(10 + index),
        apartment: String(12 + index),
        floor: 1 + (index % 9),
        hasLift: index % 3 !== 0,
        assemblyService: servicesMinor > 0,
        subtotalMinor: subtotal,
        promoDiscountMinor: promoDiscount,
        promoCodeText: promoDiscount > 0 ? 'WELCOME10' : null,
        deliveryMinor,
        servicesMinor,
        totalMinor: total,
        paymentMethod: index % 3 === 0 ? 'CARD' : index % 3 === 1 ? 'CASH_ON_DELIVERY' : 'CASH',
        paymentStatus: plan.paid ? 'PAID' : plan.status === 'CANCELLED' ? 'FAILED' : 'PENDING',
        paidAt: plan.paid ? createdAt : null,
        paymentRef: plan.paid ? `demo-${index}-${Date.now()}` : null,
        createdAt,
        items: { create: items },
      },
      select: { id: true },
    });

    const statuses = historyFor(plan.status);
    await prisma.orderEvent.createMany({
      data: statuses.map((status, stepIndex) => ({
        orderId: order.id,
        status,
        comment: stepIndex === 0 ? 'Заказ создан на сайте' : null,
        createdAt: new Date(createdAt.getTime() + stepIndex * 36_000_000),
      })),
    });
  }

  // Order item names are snapshots: fill them from the current catalogue.
  const orderItems = await prisma.orderItem.findMany({
    include: {
      product: {
        include: {
          translations: { where: { locale: 'ru' } },
          images: { take: 1, orderBy: { sort: 'asc' } },
        },
      },
    },
  });
  for (const item of orderItems) {
    await prisma.orderItem.update({
      where: { id: item.id },
      data: {
        nameSnapshot: item.product?.translations[0]?.name ?? item.sku,
        imageUrl: item.product?.images[0]?.url ?? '',
        slugSnapshot: item.product?.slug ?? '',
      },
    });
  }
  return ORDER_PLAN.length;
};

const seedRequests = async (products: { id: string; rootSlug: string }[]): Promise<number> => {
  const doorProduct = products.find((product) => product.rootSlug === 'doors');
  const rows: Prisma.RequestCreateManyInput[] = [
    {
      type: 'KITCHEN',
      status: 'NEW',
      name: 'Ани Мкртчян',
      phone: '+37493112233',
      email: 'ani.demo@example.am',
      locale: 'ru',
      comment: 'Нужна кухня в новостройке, есть проект от дизайнера.',
      payload: {
        length: 4.2,
        shape: 'lShaped',
        style: 'modern',
        color: 'white',
        facade: 'matteLacquer',
        budget: '1 500 000 — 2 500 000 ֏',
        estimateMinor: 1_890_000,
      },
    },
    {
      type: 'KITCHEN',
      status: 'IN_PROGRESS',
      name: 'Давид Саргсян',
      phone: '+37477445566',
      locale: 'ru',
      comment: 'Хочу остров и встроенную технику.',
      payload: {
        length: 5.6,
        shape: 'island',
        style: 'loft',
        color: 'graphite',
        facade: 'plasticHpl',
        budget: 'от 2 500 000 ֏',
        estimateMinor: 2_640_000,
      },
    },
    {
      type: 'MEASUREMENT',
      status: 'NEW',
      name: 'Лусине Геворгян',
      phone: '+37455778899',
      locale: 'ru',
      comment: 'Замер шкафа-купе в спальне, ниша 2,8 м.',
      payload: { address: 'Ереван, Арабкир, ул. Комитаса 14', preferredTime: 'после 18:00' },
    },
    {
      type: 'DOOR',
      status: 'NEW',
      name: 'Арам Петросян',
      phone: '+37491223344',
      locale: 'ru',
      productId: doorProduct?.id ?? null,
      comment: 'Нужны 4 двери с установкой.',
      payload: {
        size: '800x2000',
        coating: 'ecoVeneer',
        color: 'oak',
        frame: 'telescopic',
        casing: 'bothSides',
        handle: 'design',
        lock: 'magnetic',
        opening: 'right',
        installation: 'withDemolition',
        quantity: 4,
      },
    },
    {
      type: 'CALLBACK',
      status: 'DONE',
      name: 'Нарине Карапетян',
      phone: '+37498334455',
      locale: 'ru',
      comment: 'Перезвоните по поводу доставки в Гюмри.',
      payload: { preferredTime: '10:00 — 14:00' },
      handledAt: new Date(Date.now() - 2 * 86_400_000),
      adminNote: 'Перезвонили, доставка согласована на четверг.',
    },
    {
      type: 'CUSTOM_SIZE',
      status: 'NEW',
      name: 'Гор Авагян',
      phone: '+37493667788',
      locale: 'ru',
      comment: 'Нужен стеллаж под скос мансарды, 2,1 м в высшей точке.',
      payload: { width: '1800 мм', height: '2100 мм', depth: '400 мм' },
    },
    {
      type: 'PRICE_REQUEST',
      status: 'NEW',
      name: 'Мариам Оганесян',
      phone: '+37477889900',
      locale: 'ru',
      comment: 'Интересует цена при заказе 12 стульев для кафе.',
      payload: { quantity: 12 },
    },
    {
      type: 'CONSULTATION',
      status: 'IN_PROGRESS',
      name: 'Тигран Варданян',
      phone: '+37441556677',
      locale: 'hy',
      comment: 'Պետք է խորհրդատվություն հյուրասենյակի կահավորման համար։',
      payload: { topic: 'living-room' },
    },
  ];
  await prisma.request.createMany({ data: rows });
  return rows.length;
};

const main = async (): Promise<void> => {
  const started = Date.now();
  console.log(`\n${brand.name} demo seed\n`);

  log('clearing previous demo data…');
  await reset();

  log('categories…');
  const categories = await seedCategories();
  log(`  ${categories.size} categories`);

  log('brands and collections…');
  const { brands, collections } = await seedBrandsAndCollections();
  log(`  ${brands.size} brands, ${collections.size} collections`);

  log('products (this is the slow part)…');
  const { count, ids } = await seedProducts(categories, brands, collections);
  log(`  ${count} products`);

  log('demo users…');
  const customerPassword = process.env.DEMO_CUSTOMER_PASSWORD ?? 'demo1234';
  const adminPassword = process.env.DEMO_ADMIN_PASSWORD ?? 'admin1234';
  const [customerHash, adminHash] = await Promise.all([
    hashPassword(customerPassword),
    hashPassword(adminPassword),
  ]);

  const customer = await prisma.user.create({
    data: {
      email: 'demo@furniture.local',
      phone: '+37411111111',
      passwordHash: customerHash,
      role: 'CUSTOMER',
      firstName: 'Ани',
      lastName: 'Демо',
      locale: 'ru',
      addresses: {
        create: [
          {
            label: 'Дом',
            region: 'yerevan',
            city: 'Кентрон',
            street: 'пр. Маштоца',
            building: '42',
            apartment: '15',
            floor: 4,
            hasLift: true,
            isDefault: true,
          },
          {
            label: 'Работа',
            region: 'yerevan',
            city: 'Давташен',
            street: 'ул. Тиграна Петросяна',
            building: '11',
            apartment: '3',
            floor: 2,
            hasLift: false,
          },
        ],
      },
    },
  });
  const admin = await prisma.user.create({
    data: {
      email: 'admin@furniture.local',
      phone: '+37422222222',
      passwordHash: adminHash,
      role: 'ADMIN',
      firstName: 'Администратор',
      lastName: brand.name,
      locale: 'ru',
    },
  });
  const secondCustomer = await prisma.user.create({
    data: {
      email: 'gor@furniture.local',
      phone: '+37433333333',
      passwordHash: customerHash,
      role: 'CUSTOMER',
      firstName: 'Гор',
      lastName: 'Демо',
      locale: 'hy',
    },
  });

  log('favorites and recently viewed…');
  await prisma.favorite.createMany({
    data: ids.slice(0, 6).map((product) => ({ userId: customer.id, productId: product.id })),
  });
  await prisma.recentlyViewed.createMany({
    data: ids.slice(6, 14).map((product, index) => ({
      userId: customer.id,
      productId: product.id,
      viewedAt: new Date(Date.now() - index * 3_600_000),
    })),
  });

  log('reviews…');
  const reviewCount = await seedReviews(ids, customer.id);
  log(`  ${reviewCount} reviews`);

  log('promo codes, banners, door configurator…');
  for (const promo of PROMO_CODES) {
    await prisma.promoCode.create({
      data: {
        code: promo.code,
        discountType: promo.discountType,
        value: promo.value,
        minSubtotalMinor: promo.minSubtotalMinor,
        maxDiscountMinor: promo.maxDiscountMinor,
        freeDelivery: promo.freeDelivery,
        usageLimit: promo.usageLimit,
        description: promo.description,
        isActive: true,
        startsAt: new Date(Date.now() - 30 * 86_400_000),
        endsAt:
          'expired' in promo && promo.expired
            ? new Date(Date.now() - 86_400_000)
            : new Date(Date.now() + 365 * 86_400_000),
      },
    });
  }
  for (const banner of BANNERS) {
    await prisma.banner.create({
      data: {
        key: banner.key,
        position: banner.position,
        artKey: banner.artKey,
        href: banner.href,
        sort: banner.sort,
        translations: {
          create: LOCALES.map((locale) => ({
            locale,
            title: banner.translations[locale].title,
            subtitle: banner.translations[locale].subtitle,
            ctaLabel: banner.translations[locale].ctaLabel,
            eyebrow: banner.translations[locale].eyebrow,
          })),
        },
      },
    });
  }
  await prisma.doorConfigOption.createMany({
    data: DOOR_OPTIONS.map((option) => ({
      groupKey: option.groupKey,
      optionKey: option.optionKey,
      priceMinor: option.priceMinor,
      sort: option.sort,
      labels: option.labels as Prisma.InputJsonValue,
    })),
  });

  log('orders…');
  const orderCount = await seedOrders(ids, [
    {
      id: customer.id,
      name: 'Ани Демо',
      email: customer.email,
      phone: customer.phone ?? '+37411111111',
    },
    {
      id: secondCustomer.id,
      name: 'Гор Демо',
      email: secondCustomer.email,
      phone: secondCustomer.phone ?? '+37433333333',
    },
  ]);
  log(`  ${orderCount} orders`);

  log('requests…');
  const requestCount = await seedRequests(ids);
  log(`  ${requestCount} requests`);

  await prisma.newsletterSubscriber.createMany({
    data: [
      { email: 'subscriber1@example.am', locale: 'ru' },
      { email: 'subscriber2@example.am', locale: 'hy' },
    ],
  });

  await prisma.setting.createMany({
    data: [
      { key: 'store.seededAt', value: new Date().toISOString() },
      { key: 'store.demo', value: true },
      { key: 'store.adminEmail', value: admin.email },
    ],
  });

  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(
    `Products: ${count} · Categories: ${categories.size} · Orders: ${orderCount} · Reviews: ${reviewCount}`,
  );
  console.log(`Customer: demo@furniture.local / ${customerPassword}`);
  console.log(`Admin:    admin@furniture.local / ${adminPassword}\n`);
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
