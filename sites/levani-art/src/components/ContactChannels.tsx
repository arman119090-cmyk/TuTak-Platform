import { enquiry } from '@/content/site';
import type { Dictionary } from '@/i18n/dictionaries';
import { fill } from '@/i18n/plural';

/**
 * The owner's messengers — one number on WhatsApp, Viber and Telegram.
 * Drawn as quiet bronze line glyphs rather than brand-coloured logos, so they
 * sit inside the gallery's palette. WhatsApp opens with a prepared message
 * (the work's title, in the visitor's language); Viber and Telegram links
 * cannot carry text, hence the "mention the title" note where it matters.
 */
export function ContactChannels({
  dict,
  prefill,
  showNumber = true,
  size = 'md',
}: {
  dict: Dictionary;
  /** Pre-filled WhatsApp message. */
  prefill: string;
  showNumber?: boolean;
  size?: 'md' | 'sm';
}) {
  const m = enquiry.messengers;
  const channels = [
    { name: 'WhatsApp', href: m.whatsapp(prefill), Icon: WhatsAppGlyph, newTab: true },
    { name: 'Viber', href: m.viber, Icon: ViberGlyph, newTab: false },
    { name: 'Telegram', href: m.telegram, Icon: TelegramGlyph, newTab: true },
  ];
  return (
    <div className={`channels channels--${size}`}>
      <ul className="channels__list">
        {channels.map(({ name, href, Icon, newTab }) => (
          <li key={name}>
            <a
              className="channel"
              href={href}
              aria-label={fill(dict.contact.writeOn, { channel: name })}
              {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            >
              <Icon />
              <span className="channel__name">{name}</span>
            </a>
          </li>
        ))}
      </ul>
      {showNumber ? (
        <p className="channels__number" translate="no">
          {m.display}
        </p>
      ) : null}
    </div>
  );
}

const glyph = {
  width: 22,
  height: 22,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.15,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
  focusable: 'false' as const,
  className: 'channel__glyph',
};

function WhatsAppGlyph() {
  return (
    <svg {...glyph}>
      <path d="M12 3.4a8.6 8.6 0 0 0-7.4 13l-1.2 4.2 4.3-1.1A8.6 8.6 0 1 0 12 3.4Z" />
      <path d="M9.1 8.2c.3-.5.6-.6.9-.6h.6c.2 0 .4.1.5.4l.7 1.7c.1.2 0 .4-.1.6l-.5.6c-.1.2-.1.3 0 .5a6 6 0 0 0 2.6 2.4c.2.1.3.1.5-.1l.6-.7c.2-.2.4-.2.6-.1l1.7.8c.2.1.3.3.3.5 0 .6-.3 1.3-.9 1.6-.6.3-1.4.4-2.4 0a9 9 0 0 1-4.6-4.2c-.6-1.1-.8-2.4-.5-3.4Z" />
    </svg>
  );
}

function ViberGlyph() {
  return (
    <svg {...glyph}>
      <path d="M12 3C7.4 3 4.5 4.4 4.5 10v2.3c0 3.8 1.6 5.6 4.3 6.4V21l2.4-2.1h.8c4.6 0 7.5-1.4 7.5-7V10c0-5.6-2.9-7-7.5-7Z" />
      <path d="M9.4 8.1c.2-.3.4-.4.7-.4h.4c.2 0 .3.1.4.3l.5 1.2c.1.2 0 .3-.1.5l-.3.4v.4a4.4 4.4 0 0 0 1.9 1.8h.4l.4-.5c.1-.1.3-.2.5-.1l1.2.6c.2.1.2.2.2.4 0 .4-.2.9-.6 1.1-.5.3-1 .3-1.8 0a6.6 6.6 0 0 1-3.4-3.1c-.5-.8-.6-1.8-.4-2.6Z" />
      <path d="M12.6 6.6a3.8 3.8 0 0 1 3.4 3.4M12.6 8.3a2 2 0 0 1 1.7 1.7" />
    </svg>
  );
}

function TelegramGlyph() {
  return (
    <svg {...glyph}>
      <path d="M20.6 4.3 3.9 10.7c-.8.3-.7 1.4.1 1.6l4 1.2 1.6 4.9c.2.6 1 .8 1.5.3l2.3-2.2 4.2 3.1c.6.4 1.4.1 1.5-.6l2.7-13.4c.2-.9-.6-1.6-1.2-1.3Z" />
      <path d="m8 13.5 9.4-6.3-7.2 7.8" />
    </svg>
  );
}
