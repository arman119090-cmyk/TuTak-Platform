import { notFoundStrings } from '../not-found-strings';
import { plural } from '../plural';
import type { Dictionary } from './en';

export const it: Dictionary = {
  meta: {
    siteDescription:
      'LEVANI ART — una collezione curata di dipinti, sculture e oggetti decorativi per collezioni private e interni d’eccezione.',
    collection: 'Collezione',
    collectionDescription:
      'Dipinti, sculture, fontane e oggetti decorativi della collezione LEVANI ART.',
    artists: 'Artisti',
    artistsDescription: 'Gli artisti presenti nella collezione LEVANI ART.',
    about: 'Chi siamo',
    aboutDescription:
      'LEVANI ART — una collezione curata di dipinti, sculture e oggetti decorativi.',
    privateClients: 'Clienti privati',
    privateClientsDescription:
      'Per collezionisti privati, interior designer, architetti, hotel e residenze.',
    enquire: 'Richiesta privata',
    enquireDescription: 'Informazioni su un’opera o una visione privata.',
    privacy: 'Privacy',
    terms: 'Condizioni',
    notFound: 'Pagina non trovata',
  },
  nav: {
    home: 'LEVANI ART — home',
    collection: 'Collezione',
    paintings: 'Dipinti',
    sculpture: 'Scultura',
    decorativeArts: 'Arti decorative',
    privateClients: 'Clienti privati',
    artists: 'Artisti',
    about: 'Chi siamo',
    contact: 'Contatti',
    enquire: 'Richiesta',
    search: 'Cerca',
    menu: 'Menu',
    close: 'Chiudi',
    skipToContent: 'Vai al contenuto',
    primary: 'Navigazione principale',
  },
  language: {
    label: 'Lingua',
    current: 'Lingua: {name}. Cambia lingua',
  },
  categories: {
    paintings: 'Dipinti',
    sculpture: 'Scultura',
    'fountains-garden': 'Fontane e giardino',
    'decorative-arts': 'Arti decorative',
    collectibles: 'Oggetti da collezione',
  },
  categoryIntro: {
    paintings: 'Paesaggio, figura e città — tele scelte per dare carattere a una stanza.',
    sculpture: 'Figure e animali a tutto tondo, dal camino al salone.',
    'fountains-garden': 'Fontane e sculture da giardino per corti, terrazze e acqua.',
    'decorative-arts': 'Orologi, colonne e oggetti che completano un interno.',
    collectibles: 'Oggetti più piccoli per il gabinetto del collezionista.',
  },
  home: {
    heroLine: 'Arte, scultura e oggetti senza tempo, scelti per interni d’eccezione.',
    exploreCta: 'Scopri la collezione',
    privateCta: 'Richiesta privata',
    featuredEyebrow: 'Dalla collezione',
    featuredTitle: 'Opere con cui vivere',
    featuredText:
      'Ogni pezzo è presentato come in una casa privata — con spazio intorno e il tempo per guardare.',
    momentEyebrow: 'Scultura e fontane',
    momentTitle: 'Pensato per spazi architettonici',
    momentText:
      'Sculture e fontane di grande formato per corti, giardini e interni di rappresentanza, dove un oggetto deve misurarsi con la pietra e la luce.',
    categoriesEyebrow: 'La collezione',
    philosophyEyebrow: 'Sul collezionare',
    philosophyTitle: 'Gli oggetti sopravvivono alle stanze.',
    philosophyText:
      'Gli interni cambiano. Un dipinto guardato davvero, una scultura che coglie la luce della sera — restano. Raccogliamo opere per il lungo periodo.',
    privateEyebrow: 'Clienti privati',
    privateTitle: 'Per i collezionisti e per chi costruisce gli spazi',
    privateText:
      'Collezionisti privati, interior designer, architetti, hotel e ristoranti, sviluppatori di residenze — ogni richiesta è seguita personalmente e con discrezione.',
    advisorCta: 'Parla con un consulente d’arte',
    viewAll: 'Tutta la collezione',
    pieces: plural({ one: 'opera', other: 'opere' }),
  },
  collection: {
    eyebrow: 'Collezione',
    title: 'La Collezione',
    intro:
      'Dipinti, sculture, fontane e oggetti decorativi. Prezzi e disponibilità su richiesta.',
    filterLabel: 'Filtra la collezione',
    all: 'Tutto',
    viewArtwork: 'Vedi l’opera',
    emptyTitle: 'Ancora nulla',
    emptyText:
      'Nuovi pezzi sono in fase di catalogazione. Torni a trovarci presto o ci scriva direttamente.',
    count: plural({ one: 'opera', other: 'opere' }),
  },
  artwork: {
    enquireInstagram: 'Richiedi via Instagram',
    instagramNote: 'Indichi nel messaggio il titolo dell’opera.',
    priceOnRequest: 'Prezzo su richiesta',
    enquire: 'Informazioni su quest’opera',
    privateViewing: 'Richiedi una visione privata',
    viewInInterior: 'Vedi in un interno',
    back: 'Torna alla collezione',
    related: 'Anche nella collezione',
    by: 'di {artist}',
    fields: {
      artist: 'Artista',
      dimensions: 'Dimensioni',
      category: 'Categoria',
      material: 'Materiale',
      year: 'Anno',
      origin: 'Origine',
      provenance: 'Provenienza',
      condition: 'Stato di conservazione',
      status: 'Disponibilità',
      placement: 'Collocazione',
      description: 'Descrizione',
      delivery: 'Consegna',
      installation: 'Installazione',
    },
    status: {
      available: 'Disponibile',
      'on-request': 'Su richiesta',
      reserved: 'Riservato',
      sold: 'Venduto',
    },
    placement: {
      indoor: 'Interno',
      outdoor: 'Esterno',
      'indoor-outdoor': 'Interno o esterno',
    },
    detailsNote: 'Ulteriori dettagli su richiesta.',
    architecturalEyebrow: 'Scala e luogo',
    architecturalTitle: 'Pensato per spazi architettonici',
    architecturalText:
      'Per gli oggetti di grandi dimensioni valutiamo collocazione, accesso e installazione prima di ogni accordo. Ci racconti lo spazio che ha in mente.',
    interiorTitle: 'Vedi in un interno',
    interiorPlaceholder:
      'Le anteprime in interno di quest’opera sono in preparazione. Presentiamo i dipinti solo in ambienti reali e fedeli — mai con un’immagine alterata.',
    interiorCta: 'Richiedi un’anteprima in interno',
    close: 'Chiudi',
    imageAlt: '{title} — {category}',
  },
  artists: {
    eyebrow: 'Artisti',
    title: 'Gli artisti della collezione',
    intro:
      'Gli artisti le cui opere fanno parte della collezione. Le note biografiche vengono pubblicate solo quando sono documentate.',
    works: 'Opere nella collezione',
    unattributedTitle: 'Opere senza attribuzione confermata',
    unattributedText:
      'Molti pezzi sono presentati senza nome dell’artista perché l’attribuzione non è documentata. Preferiamo dire meno che dire qualcosa di incerto.',
  },
  about: {
    eyebrow: 'Chi siamo',
    title: 'Una collezione oltre la decorazione',
    lead:
      'LEVANI ART è una collezione curata di dipinti, sculture e oggetti decorativi per collezioni private e interni d’eccezione.',
    body: [
      'Cerchiamo opere con presenza: tele che cambiano la temperatura di una stanza, sculture che reggono il confronto con l’architettura, oggetti fatti per essere tramandati.',
      'Ogni pezzo è presentato solo con le informazioni che possiamo garantire. Dove i dettagli sono ancora in fase di documentazione, lo diciamo e li condividiamo su richiesta.',
    ],
    pillars: [
      { title: 'Dipinti', text: 'Paesaggio, figura e città su tela.' },
      { title: 'Scultura', text: 'Figure e animali, dal tavolo al giardino.' },
      { title: 'Oggetti decorativi', text: 'Orologi, colonne e fontane.' },
    ],
    cta: 'Scopri la collezione',
  },
  privateClients: {
    eyebrow: 'Clienti privati',
    title: 'Clienti privati',
    intro:
      'Accogliamo le richieste di chi colleziona e di chi costruisce: ogni conversazione è personale e riservata.',
    audiences: {
      collectors: {
        title: 'Collezionisti privati',
        text: 'Per chi arricchisce la propria collezione con un dipinto, una scultura o un oggetto di carattere.',
      },
      designers: {
        title: 'Interior designer',
        text: 'Per chi cerca il pezzo che definisce una residenza o una singola stanza.',
      },
      architects: {
        title: 'Architetti',
        text: 'Per progetti in cui scultura e acqua fanno parte dell’architettura fin dall’inizio.',
      },
      hospitality: {
        title: 'Hotel e ristoranti',
        text: 'Per hall, sale e terrazze che chiedono opere di presenza.',
      },
      developers: {
        title: 'Sviluppatori e residenze',
        text: 'Per residenze, corti e giardini pensati come un insieme.',
      },
    },
    advisoryEyebrow: 'Consulenza artistica',
    advisoryTitle: 'Consulenza',
    advisory: {
      sourcing: { title: 'Ricerca di opere', text: 'Trovare un’opera precisa o un tipo di pezzo.' },
      placement: { title: 'Collocazione negli interni', text: 'Dove e come esporre un’opera.' },
      acquisition: { title: 'Acquisizione privata', text: 'Acquisizione riservata per suo conto.' },
      largeScale: { title: 'Scultura monumentale', text: 'Opere di grande scala per l’architettura.' },
      exterior: { title: 'Giardino ed esterni', text: 'Fontane e sculture per spazi aperti.' },
      delivery: { title: 'Coordinamento consegne', text: 'Movimentazione, trasporto e installazione.' },
      international: { title: 'Richieste internazionali', text: 'Richieste dall’estero.' },
    },
    cta: 'Parla con un consulente d’arte',
  },
  enquiry: {
    instagramTitle: 'Ci scriva su Instagram',
    instagramText: 'Per ora le richieste sono gestite tramite il nostro account Instagram. Ci invii un messaggio diretto: rispondiamo personalmente.',
    instagramCta: 'Scrivi a @{handle}',
    instagramMention: 'Indichi: {title}',
    eyebrow: 'Richiesta privata',
    title: 'Richiesta privata',
    intro: 'Ci dica che cosa sta cercando. Rispondiamo personalmente.',
    artwork: 'Opera',
    generalEnquiry: 'Richiesta generale',
    name: 'Nome',
    email: 'E-mail',
    phone: 'Telefono o WhatsApp',
    country: 'Paese',
    message: 'Messaggio',
    reason: 'Motivo della richiesta',
    reasons: {
      purchase: 'Acquisto',
      viewing: 'Visione privata',
      delivery: 'Consegna',
      trade: 'Professionista del settore',
    },
    optional: 'facoltativo',
    consentBefore:
      'Acconsento all’uso dei miei dati per rispondere a questa richiesta, come descritto nell’',
    consentLink: 'informativa sulla privacy',
    consentAfter: '.',
    submit: 'Invia la richiesta',
    sending: 'Invio…',
    successTitle: 'Grazie',
    successText: 'Abbiamo ricevuto la sua richiesta. Le risponderemo personalmente.',
    another: 'Invia un’altra richiesta',
    errors: {
      required: 'Compili questo campo.',
      email: 'Inserisca un indirizzo e-mail valido.',
      consent: 'Confermi per continuare.',
      tooLong: 'Il testo è troppo lungo.',
      generic: 'Si è verificato un problema. Riprovi tra un momento.',
      rateLimited: 'Troppi tentativi. Attenda qualche minuto.',
      notConfigured:
        'Le richieste online non sono ancora collegate. Riprovi più tardi — il modulo sarà attivato a breve.',
    },
  },
  search: {
    open: 'Cerca nella collezione',
    title: 'Cerca nell’archivio',
    label: 'Cerca per titolo, artista o categoria',
    placeholder: 'Titolo, artista, categoria…',
    hint: 'Provi «Bronze», «Tatev» o «Fountain».',
    noResults: 'Nessuna opera corrisponde a «{query}».',
    results: plural({ one: 'risultato', other: 'risultati' }),
    close: 'Chiudi la ricerca',
  },
  footer: {
    statement:
      'Dipinti, sculture e oggetti decorativi per collezioni private e interni d’eccezione.',
    explore: 'Esplora',
    house: 'La casa',
    contact: 'Contatti',
    contactPending:
      'I recapiti saranno pubblicati a breve. Nel frattempo, utilizzi il modulo di richiesta.',
    follow: 'Seguici',
    socialPending: 'Canali social in arrivo.',
    legal: 'Note legali',
    privacy: 'Informativa sulla privacy',
    terms: 'Condizioni d’uso',
    language: 'Lingua',
    rights: 'Tutti i diritti riservati.',
  },
  // LEGAL REVIEW REQUIRED — draft privacy/terms copy, not legally reviewed.
  legal: {
    placeholder:
      'Questa pagina è provvisoria. Il testo definitivo sarà pubblicato dopo essere stato redatto e approvato dal titolare.',
    privacyTitle: 'Informativa sulla privacy',
    privacyBody:
      'Le informazioni inviate tramite il modulo — nome, recapiti, paese e messaggio — sono usate solo per rispondere alla sua richiesta.',
    termsTitle: 'Condizioni d’uso',
    termsBody:
      'Immagini e testi di questo sito appartengono ai rispettivi titolari e non possono essere riprodotti senza autorizzazione.',
  },
  notFound: notFoundStrings.it,
  a11y: {
    openMenu: 'Apri il menu',
    closeMenu: 'Chiudi il menu',
    externalLink: 'si apre in una nuova scheda',
  },
};
