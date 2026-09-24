import { notFoundStrings } from '../not-found-strings';
import { plural } from '../plural';
import type { Dictionary } from './en';

export const de: Dictionary = {
  meta: {
    siteDescription:
      'LEVANI ART — eine kuratierte Sammlung von Gemälden, Skulpturen und dekorativen Objekten für Privatsammlungen und außergewöhnliche Interieurs.',
    collection: 'Sammlung',
    collectionDescription:
      'Gemälde, Skulpturen, Brunnen und dekorative Objekte aus der Sammlung LEVANI ART.',
    artists: 'Künstler',
    artistsDescription: 'Künstler, die in der Sammlung LEVANI ART vertreten sind.',
    about: 'Über uns',
    aboutDescription:
      'LEVANI ART — eine kuratierte Sammlung von Gemälden, Skulpturen und dekorativen Objekten.',
    privateClients: 'Privatkunden',
    privateClientsDescription:
      'Für Privatsammler, Innenarchitekten, Architekten, Hotels und Residenzen.',
    enquire: 'Private Anfrage',
    enquireDescription: 'Anfrage zu einem Werk oder einer privaten Besichtigung.',
    privacy: 'Datenschutz',
    terms: 'Nutzungsbedingungen',
    notFound: 'Seite nicht gefunden',
  },
  nav: {
    home: 'LEVANI ART — Startseite',
    collection: 'Sammlung',
    paintings: 'Gemälde',
    sculpture: 'Skulptur',
    decorativeArts: 'Kunsthandwerk',
    privateClients: 'Privatkunden',
    artists: 'Künstler',
    about: 'Über uns',
    contact: 'Kontakt',
    enquire: 'Anfrage',
    search: 'Suche',
    menu: 'Menü',
    close: 'Schließen',
    skipToContent: 'Zum Inhalt springen',
    primary: 'Hauptnavigation',
  },
  language: {
    label: 'Sprache',
    current: 'Sprache: {name}. Sprache wechseln',
  },
  categories: {
    paintings: 'Gemälde',
    sculpture: 'Skulptur',
    'fountains-garden': 'Brunnen & Garten',
    'decorative-arts': 'Kunsthandwerk',
    collectibles: 'Sammlerobjekte',
  },
  categoryIntro: {
    paintings: 'Landschaft, Figur und Stadt — Werke auf Leinwand, die einen Raum tragen.',
    sculpture: 'Figuren und Tiere in gegossener Form, vom Kaminsims bis zur Halle.',
    'fountains-garden': 'Brunnen und Gartenskulpturen für Höfe, Terrassen und Wasser.',
    'decorative-arts': 'Uhren, Säulen und Objekte, die ein Interieur vollenden.',
    collectibles: 'Kleinere Objekte für das Sammlerkabinett.',
  },
  home: {
    heroLine: 'Kuratierte Kunst, Skulptur und zeitlose Objekte für außergewöhnliche Interieurs.',
    exploreCta: 'Sammlung entdecken',
    privateCta: 'Private Anfrage',
    featuredEyebrow: 'Aus der Sammlung',
    featuredTitle: 'Werke, mit denen man lebt',
    featuredText:
      'Jedes Stück wird gezeigt wie in einem Privathaus — mit Raum ringsum und Zeit zum Betrachten.',
    momentEyebrow: 'Skulptur & Brunnen',
    momentTitle: 'Geschaffen für architektonische Räume',
    momentText:
      'Großformatige Skulpturen und Brunnen für Höfe, Gärten und repräsentative Interieurs — dort, wo ein Objekt vor Stein und Licht bestehen muss.',
    categoriesEyebrow: 'Die Sammlung',
    philosophyEyebrow: 'Über das Sammeln',
    philosophyTitle: 'Objekte überdauern Räume.',
    philosophyText:
      'Interieurs wandeln sich. Ein Gemälde, das wirklich betrachtet wird, eine Skulptur im Abendlicht — sie bleiben. Wir sammeln für die lange Sicht.',
    privateEyebrow: 'Privatkunden',
    privateTitle: 'Für Sammler und für jene, die Räume gestalten',
    privateText:
      'Privatsammler, Innenarchitekten, Architekten, Hotels und Restaurants, Entwickler von Residenzen — jede Anfrage wird persönlich und diskret betreut.',
    advisorCta: 'Mit einem Kunstberater sprechen',
    viewAll: 'Die gesamte Sammlung',
    pieces: plural({ one: 'Werk', other: 'Werke' }),
  },
  collection: {
    eyebrow: 'Sammlung',
    title: 'Die Sammlung',
    intro:
      'Gemälde, Skulpturen, Brunnen und dekorative Objekte. Preise und Verfügbarkeit auf Anfrage.',
    filterLabel: 'Sammlung filtern',
    all: 'Alle',
    viewArtwork: 'Werk ansehen',
    emptyTitle: 'Noch keine Werke',
    emptyText:
      'Neue Stücke werden gerade katalogisiert. Schauen Sie bald wieder vorbei oder fragen Sie uns direkt.',
    count: plural({ one: 'Werk', other: 'Werke' }),
  },
  artwork: {
    priceOnRequest: 'Preis auf Anfrage',
    enquire: 'Anfrage zu diesem Werk',
    privateViewing: 'Private Besichtigung anfragen',
    viewInInterior: 'Im Interieur ansehen',
    back: 'Zurück zur Sammlung',
    related: 'Ebenfalls in der Sammlung',
    by: 'von {artist}',
    fields: {
      artist: 'Künstler',
      dimensions: 'Maße',
      category: 'Kategorie',
      material: 'Material',
      year: 'Jahr',
      origin: 'Herkunft',
      provenance: 'Provenienz',
      condition: 'Zustand',
      status: 'Verfügbarkeit',
      placement: 'Aufstellung',
      description: 'Beschreibung',
      delivery: 'Lieferung',
      installation: 'Installation',
    },
    status: {
      available: 'Verfügbar',
      'on-request': 'Auf Anfrage',
      reserved: 'Reserviert',
      sold: 'Verkauft',
    },
    placement: {
      indoor: 'Innenbereich',
      outdoor: 'Außenbereich',
      'indoor-outdoor': 'Innen- oder Außenbereich',
    },
    detailsNote: 'Weitere Angaben auf Anfrage.',
    architecturalEyebrow: 'Maßstab & Ort',
    architecturalTitle: 'Geschaffen für architektonische Räume',
    architecturalText:
      'Bei großen Objekten besprechen wir Standort, Zugang und Installation, bevor etwas vereinbart wird. Erzählen Sie uns von dem Ort, den Sie im Sinn haben.',
    interiorTitle: 'Im Interieur ansehen',
    interiorPlaceholder:
      'Interieur-Ansichten für dieses Werk sind in Vorbereitung. Wir zeigen Gemälde nur in echten, getreuen Umgebungen — niemals mit verändertem Bild.',
    interiorCta: 'Interieur-Ansicht anfragen',
    close: 'Schließen',
    imageAlt: '{title} — {category}',
  },
  artists: {
    eyebrow: 'Künstler',
    title: 'Künstler der Sammlung',
    intro:
      'Künstler, deren Werke in der Sammlung vertreten sind. Biografische Angaben werden erst veröffentlicht, wenn sie belegt sind.',
    works: 'Werke in der Sammlung',
    unattributedTitle: 'Werke ohne bestätigte Zuschreibung',
    unattributedText:
      'Viele Stücke erscheinen ohne Künstlernamen, weil die Urheberschaft nicht dokumentiert ist. Wir sagen lieber weniger als etwas Unsicheres.',
  },
  about: {
    eyebrow: 'Über uns',
    title: 'Eine Sammlung jenseits der Dekoration',
    lead:
      'LEVANI ART ist eine kuratierte Sammlung von Gemälden, Skulpturen und dekorativen Objekten für Privatsammlungen und außergewöhnliche Interieurs.',
    body: [
      'Wir suchen Werke mit Präsenz: Leinwände, die die Temperatur eines Raumes verändern, Skulpturen, die vor der Architektur bestehen, Objekte, die weitergegeben werden wollen.',
      'Jedes Stück wird nur mit den Angaben gezeigt, für die wir einstehen können. Wo Details noch dokumentiert werden, sagen wir es offen und teilen sie auf Anfrage.',
    ],
    pillars: [
      { title: 'Gemälde', text: 'Landschaft, Figur und Stadt auf Leinwand.' },
      { title: 'Skulptur', text: 'Figuren und Tiere, vom Tisch bis in den Garten.' },
      { title: 'Dekorative Objekte', text: 'Uhren, Säulen und Brunnen.' },
    ],
    cta: 'Sammlung entdecken',
  },
  privateClients: {
    eyebrow: 'Privatkunden',
    title: 'Privatkunden',
    intro:
      'Wir freuen uns über Anfragen von jenen, die sammeln, und jenen, die bauen. Jedes Gespräch ist persönlich und vertraulich.',
    audiences: {
      collectors: {
        title: 'Privatsammler',
        text: 'Für Sammler, die ihre Sammlung um ein Gemälde, eine Skulptur oder ein Objekt mit Charakter erweitern.',
      },
      designers: {
        title: 'Innenarchitekten',
        text: 'Für Gestalter, die das prägende Stück für eine Residenz oder einen einzelnen Raum suchen.',
      },
      architects: {
        title: 'Architekten',
        text: 'Für Projekte, in denen Skulptur und Wasser von Anfang an Teil der Architektur sind.',
      },
      hospitality: {
        title: 'Hotels & Restaurants',
        text: 'Für Lobbys, Speisesäle und Terrassen, die Werke mit Präsenz brauchen.',
      },
      developers: {
        title: 'Bauträger & Residenzen',
        text: 'Für Residenzen, Höfe und Gärten, die als Ganzes geplant werden.',
      },
    },
    advisoryEyebrow: 'Kunstberatung',
    advisoryTitle: 'Beratung',
    advisory: {
      sourcing: { title: 'Werksuche', text: 'Die Suche nach einem bestimmten Werk oder Objekttyp.' },
      placement: { title: 'Platzierung im Interieur', text: 'Wo und wie ein Werk hängt oder steht.' },
      acquisition: { title: 'Privater Erwerb', text: 'Diskreter Erwerb in Ihrem Auftrag.' },
      largeScale: { title: 'Großskulptur', text: 'Monumentale Werke für architektonische Räume.' },
      exterior: { title: 'Garten- & Außenkunst', text: 'Brunnen und Skulpturen für Außenräume.' },
      delivery: { title: 'Lieferkoordination', text: 'Handling, Transport und Planung der Installation.' },
      international: { title: 'Internationale Anfragen', text: 'Anfragen aus dem Ausland.' },
    },
    cta: 'Mit einem Kunstberater sprechen',
  },
  enquiry: {
    eyebrow: 'Private Anfrage',
    title: 'Private Anfrage',
    intro: 'Sagen Sie uns, wonach Sie suchen. Wir antworten persönlich.',
    artwork: 'Werk',
    generalEnquiry: 'Allgemeine Anfrage',
    name: 'Name',
    email: 'E-Mail',
    phone: 'Telefon oder WhatsApp',
    country: 'Land',
    message: 'Nachricht',
    reason: 'Anlass der Anfrage',
    reasons: {
      purchase: 'Kauf',
      viewing: 'Private Besichtigung',
      delivery: 'Lieferung',
      trade: 'Fachkunde',
    },
    optional: 'optional',
    consentBefore:
      'Ich bin einverstanden, dass meine Angaben zur Beantwortung dieser Anfrage verwendet werden, wie in der ',
    consentLink: 'Datenschutzerklärung',
    consentAfter: ' beschrieben.',
    submit: 'Anfrage senden',
    sending: 'Wird gesendet…',
    successTitle: 'Vielen Dank',
    successText: 'Ihre Anfrage ist eingegangen. Wir antworten persönlich.',
    another: 'Weitere Anfrage senden',
    errors: {
      required: 'Bitte füllen Sie dieses Feld aus.',
      email: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.',
      consent: 'Bitte bestätigen Sie, um fortzufahren.',
      tooLong: 'Dieser Text ist zu lang.',
      generic: 'Etwas ist schiefgelaufen. Bitte versuchen Sie es gleich noch einmal.',
      rateLimited: 'Zu viele Versuche. Bitte warten Sie einige Minuten.',
      notConfigured:
        'Online-Anfragen sind noch nicht angebunden. Bitte versuchen Sie es später erneut — das Formular wird in Kürze freigeschaltet.',
    },
  },
  search: {
    open: 'Sammlung durchsuchen',
    title: 'Das Archiv durchsuchen',
    label: 'Suche nach Titel, Künstler oder Kategorie',
    placeholder: 'Titel, Künstler, Kategorie…',
    hint: 'Zum Beispiel „Bronze“, „Tatev“ oder „Fountain“.',
    noResults: 'Keine Werke zu „{query}“.',
    results: plural({ one: 'Ergebnis', other: 'Ergebnisse' }),
    close: 'Suche schließen',
  },
  footer: {
    statement:
      'Gemälde, Skulpturen und dekorative Objekte für Privatsammlungen und außergewöhnliche Interieurs.',
    explore: 'Entdecken',
    house: 'Das Haus',
    contact: 'Kontakt',
    contactPending:
      'Kontaktdaten werden in Kürze veröffentlicht. Bis dahin nutzen Sie bitte das Anfrageformular.',
    follow: 'Folgen',
    socialPending: 'Soziale Kanäle folgen.',
    legal: 'Rechtliches',
    privacy: 'Datenschutzerklärung',
    terms: 'Nutzungsbedingungen',
    language: 'Sprache',
    rights: 'Alle Rechte vorbehalten.',
  },
  legal: {
    placeholder:
      'Dies ist eine vorläufige Seite. Der endgültige Text wird veröffentlicht, sobald er vom Inhaber erstellt und geprüft wurde.',
    privacyTitle: 'Datenschutzerklärung',
    privacyBody:
      'Angaben, die Sie über das Anfrageformular senden — Name, Kontaktdaten, Land und Nachricht — werden ausschließlich zur Beantwortung Ihrer Anfrage verwendet.',
    termsTitle: 'Nutzungsbedingungen',
    termsBody:
      'Bilder und Texte dieser Website gehören ihren jeweiligen Rechteinhabern und dürfen ohne Erlaubnis nicht vervielfältigt werden.',
  },
  notFound: notFoundStrings.de,
  a11y: {
    openMenu: 'Menü öffnen',
    closeMenu: 'Menü schließen',
    externalLink: 'öffnet in einem neuen Tab',
  },
};
