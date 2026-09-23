import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/admin/auth";
import { dt, ROLE_LABEL } from "@/lib/admin/format";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Badge, Card, Field, Hidden, PageHeader, Select } from "@/components/admin/ui";
import { createAdminUser, setAdminActive } from "./actions";

export const metadata: Metadata = { title: "Администраторы" };

export default async function UsersPage() {
  const me = await requireAdmin("users");
  const users = await db.adminUser.findMany({ orderBy: [{ isActive: "desc" }, { createdAt: "asc" }] });
  return (
    <>
      <PageHeader
        title="Администраторы"
        subtitle="Владелец — всё; менеджер — заказы, покупатели, товары, склад, промокоды, отзывы; контент — тексты товаров, коллекции, страницы, отзывы."
      />
      <div className="grid gap-5">
        <div className="adm-card adm-table-wrap p-0">
          <table className="adm-table">
            <thead>
              <tr>
                <th scope="col">Имя</th>
                <th scope="col">Email</th>
                <th scope="col">Роль</th>
                <th scope="col">Последний вход</th>
                <th scope="col">Статус</th>
                <th scope="col">Действие</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="text-xs">{u.email}</td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td className="whitespace-nowrap">{dt(u.lastLoginAt)}</td>
                  <td>{u.isActive ? <Badge tone="ok">активен</Badge> : <Badge tone="bad">отключён</Badge>}</td>
                  <td>
                    {u.id === me.id ? (
                      <span className="text-xs text-muted">это вы</span>
                    ) : (
                      <ActionForm action={setAdminActive} inline>
                        <Hidden name="userId" value={u.id} />
                        {u.isActive ? (
                          <SubmitButton variant="danger" name="active" value="0" confirm={`Отключить доступ ${u.email}?`}>
                            Отключить
                          </SubmitButton>
                        ) : (
                          <SubmitButton variant="ghost" name="active" value="1">
                            Включить
                          </SubmitButton>
                        )}
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Card title="Новый администратор">
          <ActionForm action={createAdminUser} resetOnSuccess>
            <div className="adm-grid">
              <Field label="Email" name="email" type="email" required autoComplete="off" />
              <Field label="Имя" name="name" required maxLength={120} />
              <Select label="Роль" name="role" defaultValue="MANAGER" options={ROLE_LABEL} />
              <Field label="Пароль (минимум 12 символов)" name="password" type="password" required autoComplete="new-password" />
            </div>
            <div>
              <SubmitButton>Создать</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
