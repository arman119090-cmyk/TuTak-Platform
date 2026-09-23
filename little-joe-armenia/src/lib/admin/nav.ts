import type { AdminRole } from "@/generated/prisma/client";
import { canAccess, type Area } from "@/lib/admin/auth";

const ITEMS: { href: string; label: string; area: Area }[] = [
  { href: "/admin", label: "Обзор", area: "dashboard" },
  { href: "/admin/orders", label: "Заказы", area: "orders" },
  { href: "/admin/customers", label: "Покупатели", area: "customers" },
  { href: "/admin/products", label: "Товары", area: "products" },
  { href: "/admin/photos", label: "Фото товаров", area: "products" },
  { href: "/admin/prices", label: "Цены и остатки", area: "products" },
  { href: "/admin/collections", label: "Коллекции", area: "collections" },
  { href: "/admin/scent", label: "Семейства и теги", area: "scent" },
  { href: "/admin/promotions", label: "Промокоды", area: "promotions" },
  { href: "/admin/reviews", label: "Отзывы", area: "reviews" },
  { href: "/admin/home", label: "Главная страница", area: "cms" },
  { href: "/admin/pages", label: "Страницы", area: "cms" },
  { href: "/admin/claims", label: "Заявления о бренде", area: "cms" },
  { href: "/admin/imports", label: "Проверка импорта", area: "imports" },
  { href: "/admin/translations", label: "Переводы", area: "translations" },
  { href: "/admin/settings", label: "Настройки", area: "settings" },
  { href: "/admin/users", label: "Администраторы", area: "users" },
  { href: "/admin/audit", label: "Журнал действий", area: "audit" },
];

export function navFor(role: AdminRole) {
  return ITEMS.filter((i) => canAccess(role, i.area)).map(({ href, label }) => ({ href, label }));
}
