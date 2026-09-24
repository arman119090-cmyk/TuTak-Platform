import Link from 'next/link';
import { localeMeta, locales, type Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { site } from '@/content/site';
import { LogoPlate } from './Brand';
import { Emblem } from './Emblem';

export function Footer({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const f = dict.footer;
  const n = dict.nav;
  const base = `/${locale}`;
  const contacts = [site.contact.email, site.contact.phone, site.contact.address].filter(Boolean);
  const socials = Object.entries(site.social).filter(([, url]) => url) as [string, string][];

  return (
    <footer className="site-footer">
      <div className="site-footer__grid">
        <div className="site-footer__brand">
          <LogoPlate width={96} />
          <p>{f.statement}</p>
        </div>

        <nav aria-label={f.explore}>
          <h2 className="eyebrow">{f.explore}</h2>
          <ul>
            <li><Link href={`${base}/collection`}>{n.collection}</Link></li>
            <li><Link href={`${base}/collection/paintings`}>{n.paintings}</Link></li>
            <li><Link href={`${base}/collection/sculpture`}>{n.sculpture}</Link></li>
            <li><Link href={`${base}/collection/decorative-arts`}>{n.decorativeArts}</Link></li>
            <li><Link href={`${base}/artists`}>{n.artists}</Link></li>
          </ul>
        </nav>

        <nav aria-label={f.house}>
          <h2 className="eyebrow">{f.house}</h2>
          <ul>
            <li><Link href={`${base}/about`}>{n.about}</Link></li>
            <li><Link href={`${base}/private-clients`}>{n.privateClients}</Link></li>
            <li><Link href={`${base}/enquire`}>{n.enquire}</Link></li>
          </ul>
        </nav>

        <div>
          <h2 className="eyebrow">{f.contact}</h2>
          {contacts.length ? (
            <ul>{contacts.map((c) => <li key={c}>{c}</li>)}</ul>
          ) : (
            <p className="site-footer__muted">{f.contactPending}</p>
          )}
          <h2 className="eyebrow site-footer__sub">{f.follow}</h2>
          {socials.length ? (
            <ul>
              {socials.map(([name, url]) => (
                <li key={name}>
                  <a href={url} rel="noopener noreferrer" target="_blank">{name}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="site-footer__muted">{f.socialPending}</p>
          )}
        </div>
      </div>

      <div className="site-footer__langs">
        <h2 className="visually-hidden">{f.language}</h2>
        <ul>
          {locales.map((l) => (
            <li key={l}>
              <Link
                href={`/${l}`}
                lang={localeMeta[l].htmlLang}
                hrefLang={localeMeta[l].htmlLang}
                aria-current={l === locale ? 'true' : undefined}
              >
                <span className="emblem-box emblem-box--footer">
                  <Emblem id={localeMeta[l].emblem} size={20} />
                </span>
                {localeMeta[l].nativeName}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div className="site-footer__base">
        <p>
          © {new Date().getFullYear()} {site.brandName}. {f.rights}
        </p>
        <ul>
          <li><Link href={`${base}/privacy`}>{f.privacy}</Link></li>
          <li><Link href={`${base}/terms`}>{f.terms}</Link></li>
        </ul>
      </div>
    </footer>
  );
}
