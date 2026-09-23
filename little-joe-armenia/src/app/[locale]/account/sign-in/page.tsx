import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getMessages } from "@/i18n/messages";
import { resolveLocale } from "@/i18n/server";
import { paths } from "@/lib/paths";
import { currentCustomer } from "@/lib/security/session";
import { channelAvailable } from "@/lib/domain/customer-auth";
import { SignInForm } from "@/components/account/sign-in-form";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const m = getMessages(await resolveLocale(params));
  return { title: m.account.signIn, robots: { index: false } };
}

export default async function SignInPage({ params }: Props) {
  const locale = await resolveLocale(params);
  const m = getMessages(locale);
  if (await currentCustomer()) redirect(paths.account(locale));
  return (
    <div className="container-lj max-w-md py-14">
      <h1 className="text-h1 font-extrabold">{m.account.signIn}</h1>
      <p className="mt-3 mb-8 text-ink-2">{m.account.signInIntro}</p>
      <SignInForm phoneAvailable={channelAvailable("PHONE")} />
      <p className="mt-8 text-sm text-muted">{m.account.guestNote}</p>
    </div>
  );
}
