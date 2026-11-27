// Demo world for the weekly import rhythm. Every company, person, number and address here is made up.
// Two suppliers in Costa Rica and one in Guatemala, hockeysticks, canes and cuttings, sixty customers,
// and fourteen months of finished weeks. The current week stands where Jan's week stands: ordered on Tuesday,
// confirmed on Thursday, shipping papers in on Friday, and Monday still to do. The papers "arrive" at their own time,
// so on Friday afternoon they come in one by one.
import crypto from 'node:crypto';
import { pool } from '../db.js';
import { addDays, isoDow, isoWeek, today, r2, r4, vatFor } from './util.js';
import { allocate } from './model.js';
import { supplierPdf } from './docs.js';

export const WEEK_DEMO_VERSION = 6;
const WEEKS = 60;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// the Monday whose shipping papers came in last: from Friday to Monday the coming one, Tuesday to Thursday the one just past
export function demoAnchor(t = today()) {
  const lastFriday = addDays(t, -((isoDow(t) + 2) % 7));
  return addDays(lastFriday, 3);
}

const REGIOS = [
  { code: 'CR', naam: 'Costa Rica', land: 'CR', valuta: 'USD', vervoer: 'Vliegtuig: vrijdag uit San José, maandag in Nootdorp' },
  { code: 'GT', naam: 'Guatemala', land: 'GT', valuta: 'USD', vervoer: 'Vliegtuig: om de week, vrijdag uit Guatemala-Stad, maandag in Nootdorp' },
];
const LEVERANCIERS = [
  // how often the boxes come later than Monday morning, and how often the papers come late
  { code: 'rio-claro', naam: 'Finca Río Claro S.A.', regio: 'CR', plaats: 'Sarapiquí', contact: 'Mariela Solís', email: 'ventas@fincarioclaro.example', telefoon: '+506 2766 0101', whatsapp: '+50687000101', exact_code: '70010', pre: 'FRC', route: ['SJO', 'AMS'], laat: 0.03, papLaat: 0.02 },
  { code: 'volcan-azul', naam: 'Viveros Volcán Azul S.A.', regio: 'CR', plaats: 'Guápiles', contact: 'Andrés Mora', email: 'export@volcanazul.example', telefoon: '+506 2710 0102', whatsapp: '+50687000102', exact_code: '70011', pre: 'VVA', route: ['SJO', 'AMS'], laat: 0.09, papLaat: 0.1 },
  { code: 'las-flores', naam: 'Agroexportadora Las Flores', regio: 'GT', plaats: 'Escuintla', contact: 'Lucía Herrera', email: 'pedidos@lasflores-gt.example', telefoon: '+502 7888 0103', whatsapp: '+50255000103', exact_code: '70020', pre: 'ALF', route: ['GUA', 'MIA', 'AMS'], laat: 0.2, papLaat: 0.05 },
];
// code, name, species (A on the plant passport), size, per box, sales $, purchase $, usual supplier, how the supplier writes it
const PRODUCTEN = [
  ['HS-030', 'Hockeystick', 'Dracaena fragrans', '30 cm', 150, 0.32, 0.21, 'rio-claro', "Dracaena fragrans 'hockey stick' 30 cm"],
  ['HS-045', 'Hockeystick', 'Dracaena fragrans', '45 cm', 120, 0.43, 0.29, 'rio-claro', "Dracaena fragrans 'hockey stick' 45 cm"],
  ['HS-060', 'Hockeystick', 'Dracaena fragrans', '60 cm', 90, 0.56, 0.38, 'rio-claro', "Dracaena fragrans 'hockey stick' 60 cm"],
  ['HS-090', 'Hockeystick', 'Dracaena fragrans', '90 cm', 60, 0.89, 0.61, 'rio-claro', "Dracaena fragrans 'hockey stick' 90 cm"],
  ['DF-090', 'Dracaena stam', 'Dracaena fragrans', '90 cm', 60, 0.82, 0.55, 'rio-claro', 'Dracaena fragrans caña 90 cm'],
  ['DF-120', 'Dracaena stam', 'Dracaena fragrans', '120 cm', 40, 1.22, 0.84, 'rio-claro', 'Dracaena fragrans caña 120 cm'],
  ['DF-150', 'Dracaena stam', 'Dracaena fragrans', '150 cm', 30, 1.62, 1.12, 'rio-claro', 'Dracaena fragrans caña 150 cm'],
  ['YU-060', 'Yucca stam', 'Yucca elephantipes', '60 cm', 80, 0.62, 0.42, 'volcan-azul', 'Yucca elephantipes caña 60 cm'],
  ['YU-090', 'Yucca stam', 'Yucca elephantipes', '90 cm', 50, 0.98, 0.68, 'volcan-azul', 'Yucca elephantipes caña 90 cm'],
  ['YU-120', 'Yucca stam', 'Yucca elephantipes', '120 cm', 35, 1.36, 0.95, 'volcan-azul', 'Yucca elephantipes caña 120 cm'],
  ['DM-025', 'Marginata kopstek', 'Dracaena marginata', '25 cm', 250, 0.17, 0.11, 'volcan-azul', 'Dracaena marginata esqueje 25 cm'],
  ['CF-020', 'Cordyline kopstek', 'Cordyline fruticosa', '20 cm', 300, 0.14, 0.09, 'volcan-azul', 'Cordyline fruticosa esqueje 20 cm'],
  ['DM-060', 'Marginata stam', 'Dracaena marginata', '60 cm', 100, 0.48, 0.32, 'las-flores', 'Dracaena marginata caña 60 cm'],
];
// name, kind, town, postcode, street, country, language, contact, size (3 big, 2 middle, 1 small)
const KLANTEN = [
  ['Kwekerij De Hoge Akker', 'kwekerij', 'Bleiswijk', '2665 KX', 'Hoge Bergweg', 'NL', 'nl', 'Peter van Dijk', 3],
  ['Van der Lans Potplanten', 'kwekerij', 'Honselersdijk', '2675 BH', 'Kruisweg', 'NL', 'nl', 'Ruud van der Lans', 3],
  ['Kwekerij Moerkapelle Groen', 'kwekerij', 'Moerkapelle', '2751 GB', 'Bredeweg', 'NL', 'nl', 'Sandra Bos', 2],
  ['Tropenkas Westland', 'kwekerij', "'s-Gravenzande", '2691 KL', 'Naaldwijkseweg', 'NL', 'nl', 'Martijn de Groot', 3],
  ['Kwekerij Vreeburg', 'kwekerij', 'Naaldwijk', '2671 DM', 'Opveld', 'NL', 'nl', 'Ellen Vreeburg', 2],
  ['Plantenbedrijf Kooij & Zn', 'kwekerij', 'Rijsenhout', '1435 EK', 'Aalsmeerderdijk', 'NL', 'nl', 'Henk Kooij', 2],
  ['Kwekerij Zonnehoek', 'kwekerij', 'Aalsmeer', '1431 GN', 'Uiterweg', 'NL', 'nl', 'Anouk Meijer', 1],
  ['Van Veen Stekbedrijf', 'kwekerij', 'De Lier', '2678 LB', 'Lierweg', 'NL', 'nl', 'Bas van Veen', 3],
  ['Kwekerij Het Groene Hart', 'kwekerij', 'Bodegraven', '2411 NV', 'Oud Bodegraafseweg', 'NL', 'nl', 'Marloes Jansen', 1],
  ['Bakker Tropical Plants', 'kwekerij', 'Pijnacker', '2641 RT', 'Oostlaan', 'NL', 'nl', 'Erik Bakker', 2],
  ['Kwekerij Duinzicht', 'kwekerij', 'Monster', '2681 TC', 'Molenweg', 'NL', 'nl', 'Jeroen Vis', 1],
  ['Potplantenkwekerij De Lier', 'kwekerij', 'De Lier', '2678 AC', 'Hoofdstraat', 'NL', 'nl', 'Kim Zwinkels', 2],
  ['Kwekerij Oostland', 'kwekerij', 'Berkel en Rodenrijs', '2651 RA', 'Oostweg', 'NL', 'nl', 'Frank Hoogendoorn', 2],
  ['Groen & Co Interieurbeplanting', 'interieur', 'Utrecht', '3542 DB', 'Nijverheidsweg', 'NL', 'nl', 'Lotte Verhoef', 1],
  ['Kwekerij Laakzicht', 'kwekerij', 'Wateringen', '2291 PA', 'Laakweg', 'NL', 'nl', 'Dennis Kuiper', 2],
  ['Plantenhandel Rijnmond', 'groothandel', 'Rotterdam', '3087 BK', 'Waalhaven Zuidzijde', 'NL', 'nl', 'Mustafa Yilmaz', 3],
  ['Kwekerij De Zuidpolder', 'kwekerij', 'Hoofddorp', '2131 MN', 'Hoofdweg', 'NL', 'nl', 'Ingrid Visser', 1],
  ['Van Leeuwen Kamerplanten', 'kwekerij', 'Zevenhuizen', '2761 EH', 'Noordelijke Dwarsweg', 'NL', 'nl', 'Pim van Leeuwen', 2],
  ['Kwekerij Bloemendaal Stek', 'kwekerij', 'Rijnsburg', '2231 KS', 'Vliet Noordzijde', 'NL', 'nl', 'Esther Bloemendaal', 1],
  ['Tuincentrum De Wilgenhof', 'tuincentrum', 'Leiden', '2321 AA', 'Haagweg', 'NL', 'nl', 'Wim de Wit', 1],
  ['Kwekerij Middelbroek', 'kwekerij', 'Kwintsheul', '2295 RE', 'Middelbroekweg', 'NL', 'nl', 'Gerard Valk', 2],
  ['GroenGoed Interieur', 'interieur', 'Amsterdam', '1014 BA', 'Kabelweg', 'NL', 'nl', 'Nina Hendriks', 1],
  ['Kwekerij Schipluiden', 'kwekerij', 'Schipluiden', '2636 AK', 'Keenenburgweg', 'NL', 'nl', 'Arjan Batenburg', 1],
  ['Plantenkwekerij Hoek', 'kwekerij', 'Poeldijk', '2685 PN', 'Monsterseweg', 'NL', 'nl', 'Joost Hoek', 2],
  ['Kwekerij Vandenberghe', 'kwekerij', 'Destelbergen', '9070', 'Dendermondsesteenweg', 'BE', 'nl', 'Pieter Vandenberghe', 2],
  ['Pépinières du Condroz', 'kwekerij', 'Ciney', '5590', 'Rue de Dinant', 'BE', 'fr', 'Céline Dubois', 1],
  ['Groothandel Groenwijk', 'groothandel', 'Antwerpen', '2030', 'Noorderlaan', 'BE', 'nl', 'Koen Peeters', 2],
  ['Serres de la Lys', 'kwekerij', 'Comines', '7780', 'Chaussée de Warneton', 'BE', 'fr', 'Marc Lefebvre', 1],
  ['Kwekerij Lochristi Groen', 'kwekerij', 'Lochristi', '9080', 'Antwerpsesteenweg', 'BE', 'nl', 'Sofie De Smet', 2],
  ['Gärtnerei Hofmann', 'kwekerij', 'Straelen', '47638', 'Venloer Straße', 'DE', 'de', 'Thomas Hofmann', 3],
  ['Pflanzen Becker GmbH', 'groothandel', 'Kevelaer', '47623', 'Industriestraße', 'DE', 'de', 'Sabine Becker', 3],
  ['Gartenbau Schröder', 'kwekerij', 'Hamburg', '21037', 'Kirchwerder Landweg', 'DE', 'de', 'Jan Schröder', 2],
  ['Grünwerk Pflanzenhandel', 'groothandel', 'Köln', '50829', 'Mathias-Brüggen-Straße', 'DE', 'de', 'Lukas Wolf', 2],
  ['Gärtnerei Lindenhof', 'kwekerij', 'Dresden', '01259', 'Pillnitzer Landstraße', 'DE', 'de', 'Katrin Lange', 1],
  ['Zierpflanzen Krämer', 'kwekerij', 'Geldern', '47608', 'Issumer Straße', 'DE', 'de', 'Markus Krämer', 2],
  ['Pflanzenhof Neumann', 'tuincentrum', 'Hannover', '30659', 'Podbielskistraße', 'DE', 'de', 'Petra Neumann', 1],
  ['Gärtnerei am Rhein', 'kwekerij', 'Mainz', '55120', 'Rheinallee', 'DE', 'de', 'Stefan Braun', 1],
  ['Tropica Pflanzen', 'interieur', 'München', '81829', 'Truderinger Straße', 'DE', 'de', 'Anna Huber', 1],
  ['Baumschule Wagner', 'kwekerij', 'Pinneberg', '25421', 'Elmshorner Straße', 'DE', 'de', 'Klaus Wagner', 1],
  ['Gärtnerei Pichler', 'kwekerij', 'Graz', '8041', 'Liebenauer Hauptstraße', 'AT', 'de', 'Maria Pichler', 1],
  ['Pépinières Moreau', 'kwekerij', 'Angers', '49000', 'Route de Bouchemaine', 'FR', 'fr', 'Julien Moreau', 2],
  ['Jardins du Midi', 'tuincentrum', 'Hyères', '83400', 'Avenue de la Mer', 'FR', 'fr', 'Sophie Garnier', 1],
  ['Serres Lefèvre', 'kwekerij', 'Nantes', '44300', 'Route de Carquefou', 'FR', 'fr', 'Antoine Lefèvre', 2],
  ['Végétal Concept', 'interieur', 'Lyon', '69007', 'Rue de Gerland', 'FR', 'fr', 'Camille Roux', 1],
  ['Hansen Planteskole', 'kwekerij', 'Odense', '5260', 'Rugårdsvej', 'DK', 'da', 'Mette Hansen', 2],
  ['Nordgrøn ApS', 'groothandel', 'Aarhus', '8200', 'Randersvej', 'DK', 'da', 'Søren Nielsen', 2],
  ['Fynsk Potteplanter', 'kwekerij', 'Svendborg', '5700', 'Vestergade', 'DK', 'da', 'Lars Jensen', 1],
  ['Växthuset Lund', 'kwekerij', 'Lund', '223 70', 'Malmövägen', 'SE', 'sv', 'Erik Lindqvist', 1],
  ['Grönt & Gott AB', 'groothandel', 'Göteborg', '417 05', 'Hisingsgatan', 'SE', 'sv', 'Karin Svensson', 2],
  ['Ogrodnictwo Nowak', 'kwekerij', 'Poznań', '60-101', 'ul. Ogrodowa', 'PL', 'pl', 'Tomasz Nowak', 2],
  ['Szklarnie Kowalski', 'kwekerij', 'Kraków', '30-198', 'ul. Zielona', 'PL', 'pl', 'Anna Kowalska', 1],
  ['Zielony Dom', 'groothandel', 'Warszawa', '02-495', 'ul. Kwiatowa', 'PL', 'pl', 'Piotr Wiśniewski', 2],
  ['Vivai Rossi', 'kwekerij', 'Pistoia', '51100', 'Via Fiorentina', 'IT', 'it', 'Marco Rossi', 2],
  ['Serre Bianchi', 'kwekerij', 'Sanremo', '18038', 'Via Aurelia', 'IT', 'it', 'Giulia Bianchi', 1],
  ['Viveros Martín', 'kwekerij', 'Valencia', '46013', 'Camino de Moncada', 'ES', 'es', 'Carlos Martín', 1],
  ['Plantas del Sur', 'groothandel', 'Almería', '04009', 'Carretera de Níjar', 'ES', 'es', 'Lucía Fernández', 1],
  ['Greenleaf Nurseries Ltd', 'kwekerij', 'Spalding', 'PE11 3AB', 'Pinchbeck Road', 'GB', 'en', 'James Wilson', 2],
  ['Leaf & Loft Ltd', 'interieur', 'London', 'E3 2NQ', 'Dace Road', 'GB', 'en', 'Olivia Brown', 1],
  ['Zahradnictví Novák', 'kwekerij', 'Brno', '619 00', 'Vídeňská', 'CZ', 'en', 'Petr Novák', 1],
  ['Gärtnerei Keller AG', 'kwekerij', 'Zürich', '8046', 'Wehntalerstrasse', 'CH', 'de', 'Daniel Keller', 1],
];
const MAIL = { nl: ['inkoop', 'facturen'], de: ['einkauf', 'rechnung'], fr: ['achats', 'factures'], en: ['purchasing', 'accounts'], da: ['indkob', 'faktura'], sv: ['inkop', 'faktura'], pl: ['zakupy', 'faktury'], it: ['acquisti', 'fatture'], es: ['compras', 'facturas'] };
const PHONE = { NL: ['+31 6', 8], BE: ['+32 47', 7], DE: ['+49 151', 8], AT: ['+43 664', 7], FR: ['+33 6', 8], DK: ['+45 2', 7], SE: ['+46 70', 7], PL: ['+48 60', 7], IT: ['+39 33', 8], ES: ['+34 6', 8], GB: ['+44 77', 8], CZ: ['+420 60', 7], CH: ['+41 79', 7] };
// how much hockeysticks, canes and cuttings sell, by month
const SEASON = [0.85, 1.05, 1.25, 1.25, 1.1, 0.9, 0.75, 0.8, 1.0, 1.05, 0.95, 0.75];

const slug = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ø/g, 'o').replace(/&/g, 'en').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function insertMany(c, table, cols, list, chunk = 400) {
  for (let i = 0; i < list.length; i += chunk) {
    const part = list.slice(i, i + chunk), vals = [];
    const sql = part.map((row, j) => `(${cols.map((_, k) => `$${j * cols.length + k + 1}`).join(',')})`).join(',');
    for (const row of part) for (const k of cols) vals.push(row[k] === undefined ? null : row[k]);
    await c.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES ${sql}`, vals);
  }
}
const at = (d, h, m = 0) => { const x = new Date(`${d}T00:00:00`); x.setHours(h, m, 0, 0); return x; };

export async function seedWeekDemo({ anchor = demoAnchor(), seed = 20261127 } = {}) {
  const r = rng(seed);
  const R = (a, b) => a + (b - a) * r();
  const RI = (a, b) => Math.floor(R(a, b + 1));
  const pick = arr => arr[Math.floor(r() * arr.length)];
  const digits = n => Array.from({ length: n }, () => RI(0, 9)).join('');
  const c = await pool.connect();
  try {
    await c.query('SET search_path TO campo, public');
    await c.query('BEGIN');
    const maxId = async t => Number((await c.query(`SELECT coalesce(max(id), 0) AS n FROM ${t}`)).rows[0].n);
    // ---------- regions, suppliers, products
    for (const g of REGIOS) await c.query(`INSERT INTO regios (code, naam, land, valuta, vervoer, bron) VALUES ($1,$2,$3,$4,$5,'demo') ON CONFLICT (code) DO NOTHING`, [g.code, g.naam, g.land, g.valuta, g.vervoer]);
    let lb = await maxId('leveranciers');
    const L = {};
    for (const l of LEVERANCIERS) {
      L[l.code] = { ...l, id: ++lb };
      await c.query(`INSERT INTO leveranciers (id, code, naam, regio, plaats, contact, email, telefoon, whatsapp, taal, exact_code, route, bron) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'es',$10,$11,'demo')`,
        [lb, l.code, l.naam, l.regio, l.plaats, l.contact, l.email, l.telefoon, l.whatsapp, l.exact_code, l.route]);
    }
    let pb = await maxId('producten');
    const P = [];
    PRODUCTEN.forEach(([code, naam, soort, maat, per, usd, ink, lev, es], i) => P.push({ id: ++pb, code, naam, soort, maat, per_doos: per, prijs_usd: usd, inkoop_usd: ink, lev, es, volgorde: (i + 1) * 10 }));
    await insertMany(c, 'producten', ['id', 'code', 'naam', 'soort', 'maat', 'per_doos', 'prijs_usd', 'inkoop_usd', 'leverancier_id', 'exact_code', 'volgorde', 'bron'],
      P.map(p => ({ ...p, leverancier_id: L[p.lev].id, exact_code: p.code, bron: 'demo' })));
    const PC = Object.fromEntries(P.map(p => [p.code, p]));

    // ---------- sixty customers with a buying habit each
    let kb = await maxId('klanten');
    const K = KLANTEN.map(([naam, soort, plaats, postcode, straat, land, taal, contact, size], i) => {
      const dom = `${slug(naam).replace(/-(bv|gmbh|ltd|aps|ab|ag)$/, '')}.example`;
      const [m1, m2] = MAIL[taal] || MAIL.en;
      const [pre, n] = PHONE[land];
      const nr = digits(n);
      const btw = { NL: `NL${digits(9)}B01`, BE: `BE0${digits(9)}`, DE: `DE${digits(9)}`, AT: `ATU${digits(8)}`, FR: `FR${digits(11)}`, DK: `DK${digits(8)}`, SE: `SE${digits(10)}01`, PL: `PL${digits(10)}`,
        IT: `IT${digits(11)}`, ES: `ESB${digits(8)}`, GB: `GB${digits(9)}`, CZ: `CZ${digits(8)}`, CH: `CHE-${digits(3)}.${digits(3)}.${digits(3)} MWST` }[land];
      // what they buy: growers pot canes and cuttings, interior firms take the big canes, wholesalers a bit of everything
      const pool_ = soort === 'interieur' ? ['DF-120', 'DF-150', 'YU-120', 'YU-090', 'HS-090']
        : soort === 'groothandel' ? ['HS-030', 'HS-045', 'HS-060', 'HS-090', 'DF-090', 'YU-060', 'YU-090', 'DM-025', 'CF-020', 'DM-060']
          : soort === 'tuincentrum' ? ['HS-060', 'YU-060', 'YU-090', 'DF-090', 'HS-045'] : ['HS-030', 'HS-045', 'HS-060', 'HS-090', 'DF-090', 'DF-120', 'YU-060', 'YU-090', 'DM-025', 'CF-020', 'DM-060'];
      const mix = [];
      const want = Math.min(pool_.length, size === 3 ? RI(4, 6) : size === 2 ? RI(3, 4) : RI(2, 3));
      while (mix.length < want) { const x = pick(pool_); if (!mix.includes(x)) mix.push(x); }
      return {
        id: ++kb, code: slug(naam).slice(0, 40), naam, soort, plaats, postcode, adres: `${straat} ${RI(2, 240)}`, land, taal, contact,
        email: `${m1}@${dom}`, factuur_email: `${m2}@${dom}`, telefoon: `${pre} ${nr.slice(0, 4)} ${nr.slice(4)}`.trim(), kanaal: 'telefoon',
        btw_nummer: btw, exact_code: String(10001 + i), betaaltermijn: land === 'NL' ? 14 : pick([21, 30, 30]), klant_sinds: RI(1998, 2023),
        betaal: r() < 0.1 ? 'laat' : r() < 0.25 ? 'soms' : 'netjes',
        size, mix, kans: size === 3 ? R(0.82, 0.95) : size === 2 ? R(0.5, 0.68) : R(0.22, 0.38), basis: size === 3 ? R(7, 13) : size === 2 ? R(3.5, 7) : R(1.5, 3.5),
      };
    });
    await insertMany(c, 'klanten', ['id', 'code', 'naam', 'soort', 'contact', 'email', 'factuur_email', 'telefoon', 'adres', 'postcode', 'plaats', 'land', 'taal', 'kanaal', 'betaaltermijn', 'btw_nummer', 'exact_code', 'klant_sinds', 'bron'],
      K.map(k => ({ ...k, bron: 'demo' })));
    // agreed prices for the big customers
    const deals = [];
    for (const k of K.filter(x => x.size === 3)) for (const code of k.mix.slice(0, 2)) deals.push({ klant_id: k.id, product_id: PC[code].id, prijs_usd: Math.round(PC[code].prijs_usd * R(0.93, 0.97) * 1000) / 1000 });
    await insertMany(c, 'prijsafspraken', ['klant_id', 'product_id', 'prijs_usd'], deals);
    const dealOf = new Map(deals.map(d => [`${d.klant_id}:${d.product_id}`, d.prijs_usd]));
    const priceFor = (k, p) => dealOf.get(`${k.id}:${p.id}`) ?? p.prijs_usd;

    // ---------- the weeks
    const first = addDays(anchor, -7 * WEEKS);
    const RAISE = addDays(anchor, -7 * 34);
    const weken = [], orders = [], partijen = [], regels = [], verdeling = [], pakbonnen = [], pakRegels = [], docs = [], files = [];
    let pid = await maxId('partijen'), rid = await maxId('partij_regels'), sid = await maxId('pakbonnen'), srid = await maxId('pakbon_regels');
    const batchNo = {}, slipNo = {}, invNo = { 'rio-claro': 410, 'volcan-azul': 1180, 'las-flores': 233 };
    const nowMs = Date.now();
    for (let i = 0; i <= WEEKS + 1; i++) {
      const m = addDays(first, i * 7);
      const current = m === anchor, next = m === addDays(anchor, 7);
      const wk = isoWeek(m), month = Number(m.slice(5, 7)) - 1;
      const gtWeek = (WEEKS - i) % 2 === 0;   // every other week, and always in the week that is on its way
      const quiet = wk.week >= 52 || wk.week === 1;   // the Christmas weeks: hardly anything flies
      const season = SEASON[month] * (quiet ? 0.35 : 1);
      const koers = r4(1.078 + 0.088 * (i / WEEKS) + 0.011 * Math.sin(i / 4.3) + R(-0.004, 0.004));
      weken.push({ maandag: m, koers: current || next ? null : koers, koers_op: current || next ? null : at(m, 8, RI(0, 40)), koers_door: current || next ? null : 'Jan',
        geteld_op: current || next ? null : at(m, 9, RI(0, 50)), geteld_door: current || next ? null : 'Jan', besteld_op: next ? null : at(addDays(m, -6), 10, RI(5, 50)) });
      // phone orders
      const wo = [];
      for (const k of K) {
        if (r() > k.kans * Math.min(1.15, season)) continue;
        const n = Math.max(1, Math.min(k.mix.length, Math.round(R(0.6, 1) * k.mix.length)));
        const chosen = [...k.mix].sort(() => r() - 0.5).slice(0, n).filter(code => gtWeek || code !== 'DM-060');
        for (const code of chosen) {
          const dz = Math.max(1, Math.round(k.basis * R(0.55, 1.35) * season * (PC[code].per_doos >= 200 ? 0.6 : 1)));
          const when = next ? at(addDays(anchor, RI(-3, 1)), RI(8, 17), RI(0, 59)) : at(addDays(m, -RI(7, 12)), RI(8, 17), RI(0, 59));
          wo.push({ maandag: m, klant_id: k.id, product_id: PC[code].id, dozen: dz, via: 'telefoon', door: 'Jan', aangemaakt: when, k, p: PC[code] });
        }
      }
      orders.push(...wo);
      if (next) continue;
      // what goes to which supplier: Guatemala flies every other week and takes a part of the 60 and 90 cm hockeysticks
      const demand = new Map();
      for (const o of wo) demand.set(o.p.code, (demand.get(o.p.code) || 0) + o.dozen);
      const plan = new Map();
      const add = (lev, code, dz) => { if (dz <= 0) return; if (!plan.has(lev)) plan.set(lev, new Map()); plan.get(lev).set(code, (plan.get(lev).get(code) || 0) + dz); };
      for (const [code, dz] of demand) {
        if (gtWeek && (code === 'HS-060' || code === 'HS-090')) { const gt = Math.round(dz * 0.35); add('las-flores', code, gt); add(PC[code].lev, code, dz - gt); } else add(PC[code].lev, code, dz);
      }
      const yy = m.slice(2, 4), mine = [];
      for (const lev of ['rio-claro', 'volcan-azul', 'las-flores']) {
        if (!plan.has(lev)) continue;
        const l = L[lev];
        batchNo[`${l.regio}${yy}`] = (batchNo[`${l.regio}${yy}`] || 0) + 1;
        const nummer = `${l.regio}${yy}-${String(batchNo[`${l.regio}${yy}`]).padStart(3, '0')}`;
        const gt = l.regio === 'GT', second = lev === 'volcan-azul';
        const p = {
          id: ++pid, nummer, regio: l.regio, leverancier_id: l.id, maandag: m, bron: 'demo', lev: l,
          besteld_op: at(addDays(m, -6), 10, RI(10, 55)), bevestigd_op: gt ? at(addDays(m, -3), 9, RI(5, 40)) : at(addDays(m, -4), second ? 17 : 15, RI(0, 50)),
          // this week the ash over Guatemala City moves the Saturday flight to Sunday morning (see the example notice below)
          verzonden_op: gt ? (current ? at(addDays(m, -1), 9, RI(5, 30)) : r() < l.papLaat ? at(addDays(m, -2), 16, RI(0, 50)) : at(addDays(m, -2), 10, RI(5, 30)))
            : r() < l.papLaat ? at(addDays(m, -2), 15, RI(0, 50)) : at(addDays(m, -3), second ? 16 : 14, RI(0, 45)),
          binnen_op: current ? null : r() < l.laat ? at(m, RI(13, 16), RI(0, 59)) : at(m, 7, RI(10, 40)),
          awb: `${gt ? '045' : '074'}-${digits(4)} ${digits(4)}`, vlucht: l.route.join(' → '), route: l.route, fyto: `${l.regio}-FITO-${yy}-${digits(6)}`,
          exact: current ? 'open' : 'in_exact', exact_op: current ? null : at(addDays(m, -3), 18, RI(0, 50)), exact_door: current ? null : 'Jan', exact_nummer: current ? null : `IO${yy}${String(1000 + pid).slice(-4)}`,
          factuur: `${l.pre}-${yy}-${String(++invNo[lev]).padStart(4, '0')}`,
        };
        for (const [code, dz] of plan.get(lev)) {
          const pr = PC[code];
          const besteld = Math.ceil(dz * R(1, 1.06));
          let bev = besteld; const x = r();
          if (x < 0.12) bev = Math.round(besteld * R(0.86, 0.94)); else if (x < 0.2) bev = Math.round(besteld * R(1.05, 1.1)); else if (x < 0.22) bev = Math.round(besteld * 0.8);
          let verz = bev; if (r() < 0.06) verz = Math.max(0, bev - RI(1, 2));
          let get = verz; if (!current && r() < 0.04) get = Math.max(0, verz - 1);
          const uit = !current && get >= 2 && r() < 0.03 ? 1 : 0;
          // purchase prices creep up over the year (about 6%), with their own swing per product
          const prijs = Math.round(pr.inkoop_usd * (0.955 + 0.06 * i / WEEKS) * (1 + 0.035 * Math.sin(i / 9 + pr.volgorde) + R(-0.01, 0.01)) * (gt ? 0.97 : 1) * 1000) / 1000;
          regels.push({ id: ++rid, partij_id: p.id, product_id: pr.id, besteld, bevestigd: bev, verzonden: verz, geteld: current ? null : get, uitval: uit, per_doos: pr.per_doos, prijs_usd: prijs,
            zekerheid: current ? RI(96, 99) : null, twijfel: null, gelezen: current ? JSON.stringify({ bron: 'Factura comercial y packing list', zekerheid: RI(96, 99) }) : null, p: pr, partij: p, cap: Math.max(0, get - uit) });
        }
        partijen.push(p); mine.push(p);
      }
      if (current) {
        // the papers of this week, each arriving at its own moment
        for (const p of mine) {
          const pr = regels.filter(x => x.partij_id === p.id);
          const lev = p.lev, wkn = isoWeek(m).week;
          const dagNl = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${m}T12:00:00`));
          docs.push({ partij_id: p.id, soort: 'bestelling', titel: `Pedido semana ${wkn}`, ontvangen: p.besteld_op, gelezen_door: 'jan',
            tekst: `Hola ${lev.contact.split(' ')[0]},\n\nPara la semana ${wkn} (llegada ${dagNl}) quisiera pedir:\n\n${pr.map(x => `${String(x.besteld).padStart(4)} cajas  ${x.p.es}`).join('\n')}\n\nPor favor confirmen cantidades y vuelo.\n\nSaludos,\nJan\nCampo International` });
          const diff = pr.filter(x => x.bevestigd !== x.besteld);
          const salida = lev.regio === 'GT'
            ? `Sale el sábado con el vuelo ${p.vlucht.replace(/ → /g, ' - ')}. Ojo: el aeropuerto La Aurora está cerrado desde esta mañana por la ceniza del Volcán de Fuego. Si abre a tiempo sale el sábado; si no, el domingo temprano. Les avisamos.`
            : `Sale el viernes con el vuelo ${p.vlucht.replace(/ → /g, ' - ')}.`;
          docs.push({ partij_id: p.id, soort: 'bevestiging', titel: `Confirmación pedido semana ${wkn}`, ontvangen: p.bevestigd_op, gelezen_door: 'ai',
            tekst: `Hola Jan,\n\nConfirmamos el pedido para la semana ${wkn}. ${salida}\n\n${pr.map(x => `${String(x.bevestigd).padStart(4)} cajas  ${x.p.es}${x.bevestigd < x.besteld ? `  (${x.besteld - x.bevestigd} menos: no hay suficiente material)` : x.bevestigd > x.besteld ? `  (${x.bevestigd - x.besteld} más, como hablamos)` : ''}`).join('\n')}\n\n${diff.length ? 'Las diferencias están marcadas.' : 'Todo según su pedido.'}\n\nSaludos,\n${lev.contact}\n${lev.naam}` });
          // one doubt in the second Costa Rica shipment: invoiced more boxes than are on the packing list
          let nota = null;
          if (p.lev.code === 'volcan-azul') {
            const x = pr.find(y => y.p.code === 'YU-090') || pr[0];
            x.twijfel = `Op de factuur staan ${x.verzonden + 2} dozen, maar onderaan staat dat er 2 met de volgende vlucht komen. De desk nam ${x.verzonden}: wat er nu in het vliegtuig zit.`;
            x.zekerheid = 64;
            x.gelezen = JSON.stringify({ bron: 'Factura comercial, met de notitie onderaan', zekerheid: 64, factuur: x.verzonden + 2 });
            nota = `Nota: ${x.p.es}: 2 cajas facturadas salen con el próximo vuelo.`;
            x.factuurDozen = x.verzonden + 2;
          }
          const pdf = await supplierPdf({
            leverancier: { naam: lev.naam, plaats: lev.plaats, land: lev.regio, landnaam: lev.regio === 'GT' ? 'Guatemala' : 'Costa Rica', email: lev.email },
            factuur: p.factuur, datum: addDays(m, lev.regio === 'GT' ? -1 : -3).split('-').reverse().join('/'), awb: p.awb, vlucht: p.vlucht, fyto: p.fyto, scan: lev.code === 'volcan-azul', nota,
            regels: pr.map(x => ({ omschrijving: x.p.es, cajas: x.factuurDozen || x.verzonden, por_caja: x.per_doos, precio: x.prijs_usd })),
          });
          const sha = crypto.createHash('sha256').update(pdf).digest('hex');
          files.push({ partij_id: p.id, naam: `Factura ${p.factuur}.pdf`, data: pdf, sha, ontvangen: p.verzonden_op, titel: `Factura comercial y packing list ${p.factuur}` });
        }
        continue;
      }
      // ---------- Monday of a finished week: handed out to the last box, one packing slip per customer
      const give = new Map(); // klant -> rows
      for (const [code, lines] of Object.entries(Object.groupBy(regels.filter(x => x.partij.maandag === m), x => x.p.code))) {
        const dem = wo.filter(o => o.p.code === code).map(o => ({ klant_id: o.klant_id, dozen: o.dozen }));
        const res = allocate(dem, lines.map(l => ({ id: l.id, cap: l.cap })));
        const rowsOut = res.rows;
        // what is left goes to the biggest buyers of this product this week, unless Jan kept one back now and then
        let over = res.over;
        const left = lines.map(l => ({ id: l.id, left: l.cap - rowsOut.filter(x => x.regel_id === l.id).reduce((s, x) => s + x.dozen, 0) }));
        const top = [...dem].sort((a, b) => b.dozen - a.dozen).slice(0, 3);
        const keep = over > 0 && r() < 0.012 ? 1 : 0;
        over -= keep;
        let j = 0;
        while (over > 0 && top.length) {
          const t = top[j % top.length], l = left.find(x => x.left > 0);
          if (!l) break;
          const ex = rowsOut.find(x => x.regel_id === l.id && x.klant_id === t.klant_id);
          if (ex) ex.dozen++; else rowsOut.push({ regel_id: l.id, klant_id: t.klant_id, dozen: 1 });
          l.left--; over--; j++;
        }
        for (const x of rowsOut) { verdeling.push({ ...x, door: 'demo' }); if (!give.has(x.klant_id)) give.set(x.klant_id, []); give.get(x.klant_id).push(x); }
      }
      for (const k of K) {
        const mineRows = give.get(k.id);
        if (!mineRows || !mineRows.length) continue;
        const datum = m, yyS = datum.slice(2, 4);
        slipNo[yyS] = (slipNo[yyS] || 0) + 1;
        const s = { id: ++sid, nummer: `${yyS}-${String(slipNo[yyS]).padStart(4, '0')}`, maandag: m, klant_id: k.id, datum, vervaldatum: addDays(datum, k.betaaltermijn), koers, btw_pct: vatFor(k.land).pct,
          exact: 'in_exact', exact_op: at(m, RI(10, 15), RI(0, 59)), exact_door: 'Jan', gedrukt_op: at(m, RI(10, 13), RI(0, 59)), door: 'Jan', bron: 'demo', status: 'akkoord', aangemaakt: at(m, RI(9, 12), RI(0, 59)) };
        // paid: most on time, some now and then late, a few always late (in real life this comes from Exact)
        const pay = k.betaal === 'netjes' ? addDays(s.vervaldatum, -RI(0, Math.max(0, Math.min(8, k.betaaltermijn - 3))))
          : k.betaal === 'soms' ? (r() < 0.7 ? addDays(s.vervaldatum, -RI(0, 4)) : addDays(s.vervaldatum, RI(3, 15))) : addDays(s.vervaldatum, RI(6, 32));
        s.betaald_op = pay <= today() ? pay : null;
        let n = 0, tot = 0;
        for (const x of mineRows.sort((a, b) => a.regel_id - b.regel_id)) {
          const rg = regels.find(y => y.id === x.regel_id);
          // Jan raised his prices by about 4% in the spring
          const stuks = x.dozen * rg.per_doos, pu = m < RAISE ? Math.round(priceFor(k, rg.p) * 0.96 * 1000) / 1000 : priceFor(k, rg.p), pe = r4(pu / koers), bedrag = r2(stuks * pe);
          tot += bedrag;
          pakRegels.push({ id: ++srid, pakbon_id: s.id, regelnr: ++n, regel_id: rg.id, product_id: rg.p.id, partij: rg.partij.nummer, dozen: x.dozen, stuks, prijs_usd: pu, prijs_eur: pe, bedrag });
        }
        s.totaal = r2(tot);
        pakbonnen.push(s);
      }
    }
    // ---------- write it all
    await insertMany(c, 'weken', ['maandag', 'koers', 'koers_op', 'koers_door', 'geteld_op', 'geteld_door', 'besteld_op'], weken);
    await insertMany(c, 'weekorders', ['maandag', 'klant_id', 'product_id', 'dozen', 'via', 'door', 'aangemaakt'], orders);
    await insertMany(c, 'partijen', ['id', 'nummer', 'regio', 'leverancier_id', 'maandag', 'besteld_op', 'bevestigd_op', 'verzonden_op', 'binnen_op', 'awb', 'vlucht', 'route', 'fyto', 'exact', 'exact_op', 'exact_door', 'exact_nummer', 'bron'], partijen);
    await insertMany(c, 'partij_regels', ['id', 'partij_id', 'product_id', 'besteld', 'bevestigd', 'verzonden', 'geteld', 'uitval', 'per_doos', 'prijs_usd', 'zekerheid', 'twijfel', 'gelezen'], regels);
    await insertMany(c, 'verdeling', ['regel_id', 'klant_id', 'dozen', 'door'], verdeling);
    await insertMany(c, 'pakbonnen', ['id', 'nummer', 'maandag', 'klant_id', 'datum', 'vervaldatum', 'koers', 'btw_pct', 'totaal', 'status', 'exact', 'exact_op', 'exact_door', 'gedrukt_op', 'door', 'bron', 'aangemaakt', 'betaald_op'], pakbonnen);
    await insertMany(c, 'pakbon_regels', ['id', 'pakbon_id', 'regelnr', 'regel_id', 'product_id', 'partij', 'dozen', 'stuks', 'prijs_usd', 'prijs_eur', 'bedrag'], pakRegels);
    await insertMany(c, 'partij_documenten', ['partij_id', 'soort', 'titel', 'tekst', 'ontvangen', 'gelezen_door'], docs);
    for (const f of files) {
      const b = (await c.query(`INSERT INTO bestanden (naam, mime, grootte, sha256, data) VALUES ($1, 'application/pdf', $2, $3, $4) RETURNING id`, [f.naam, f.data.length, f.sha, f.data])).rows[0];
      await c.query(`INSERT INTO partij_documenten (partij_id, soort, titel, bestand_id, ontvangen, gelezen_door) VALUES ($1, 'verzendbewijs', $2, $3, $4, 'ai')`, [f.partij_id, f.titel, b.id, f.ontvangen]);
    }
    // ---------- the world this week, as an example: ash over Guatemala City closes the airport until Sunday morning
    const gtNow = partijen.find(p => p.maandag === anchor && p.regio === 'GT');
    await c.query(`INSERT INTO risico_meldingen (soort, ernst, titel, tekst, plek, vertraging_uren, van, tot, bron, door, aangemaakt) VALUES ('vulkaan', 'probleem', $1, $2, 'GUA', 8, $3, $4, 'demo', 'demo', $5)`,
      ['As van Volcán de Fuego: luchthaven La Aurora (GUA) dicht',
        `Voorbeeldmelding, niet echt gebeurd. Las Flores meldt dat de luchthaven van Guatemala-Stad dicht is door as. De vlucht van zaterdag schuift naar zondagochtend; via Miami haalt het maandag, maar later dan normaal: reken op maandagmiddag.${gtNow ? ` Het gaat om ${gtNow.nummer}.` : ''}`,
        at(addDays(anchor, -3), 5, 30), at(addDays(anchor, -1), 8, 0), at(addDays(anchor, -3), 9, 40)]);
    // ---------- offers for the coming week: extra boxes at a better price (Jan sees them on Tuesday at Bestellen)
    const nextM = addDays(anchor, 7);
    const offer = (lev, code, dozen, prijs, notitie, d, h, mi) => c.query(`INSERT INTO leverancier_aanbod (leverancier_id, product_id, maandag, dozen, prijs_usd, notitie, ontvangen, geldig_tot, bron) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'demo')`,
      [L[lev].id, PC[code].id, nextM, dozen, prijs, notitie, at(addDays(anchor, d), h, mi), at(addDays(nextM, -6), 12, 0)]);
    await offer('rio-claro', 'HS-090', 30, 0.55, 'Nos sobran 30 cajas de hockey stick 90 cm de esta cosecha. Precio especial US$ 0,55 si confirman antes del martes al mediodía.', -3, 11, 20);
    await offer('volcan-azul', 'YU-090', 40, 0.62, 'Tenemos 40 cajas extra de Yucca 90 cm, buena calidad. US$ 0,62 la unidad para la semana que viene.', -3, 17, 40);
    await offer('rio-claro', 'DF-150', 14, 1.05, 'También 14 cajas de caña 150 cm a US$ 1,05.', -3, 11, 22);
    // ---------- people Jan could work with: made up for the demo
    const lead = (soort, naam, plaats, land, segment, contact, email, wat, waarom, status, notitie = null) => c.query(`INSERT INTO kansen (soort, naam, plaats, land, segment, contact, email, wat, waarom, status, notitie, bron) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'demo')`,
      [soort, naam, plaats, land, segment, contact, email, wat, waarom, status, notitie]);
    await lead('klant', 'Plantwerk Interieur', 'Den Haag', 'NL', 'interieur', 'Sanne de Wit', 'inkoop@plantwerk.example', 'Dracaena- en yuccastammen van 120 en 150 cm voor kantoren', 'Interieurbedrijven geven de hoogste marge, en dit bedrijf zit een kwartier van de loods.', 'nieuw');
    await lead('klant', 'Grüne Halle GmbH', 'Düsseldorf', 'DE', 'groothandel', 'Jonas Richter', 'einkauf@gruene-halle.example', 'Hockeysticks van 45 tot 90 cm, elke week', 'Groothandels nemen per klant het meest. De Duitse factuur en de verlegde btw staan al klaar.', 'benaderd', 'Gebeld, wil prijzen voor de eerste week van december.');
    await lead('klant', 'Växtkraft AB', 'Malmö', 'SE', 'groothandel', 'Elin Berg', 'inkop@vaxtkraft.example', 'Yucca- en dracaenastammen', 'Zweden en Denemarken groeien; Växthuset Lund zit om de hoek.', 'nieuw');
    await lead('klant', "Pépinières de l'Estuaire", 'Saint-Nazaire', 'FR', 'kwekerij', 'Hugo Martin', 'achats@estuaire.example', 'Kopstekken marginata en cordyline', 'Weinig klanten in Frankrijk, terwijl de Franse factuur al klaarstaat.', 'nieuw');
    await lead('leverancier', 'Viveros Los Guayabos S.A.', 'Pococí', 'CR', 'Yucca elephantipes', 'Rodrigo Vargas', 'ventas@losguayabos.example', 'Yucca caña 60, 90 en 120 cm', 'Yucca komt nu alleen van Volcán Azul. Een tweede kweker in dezelfde streek vliegt met dezelfde vlucht.', 'nieuw');
    await lead('leverancier', 'Agrícola Tierra Fértil S.A.', 'San Carlos', 'CR', 'Dracaena fragrans', 'Paola Jiménez', 'export@tierrafertil.example', 'Dracaena caña 120 en 150 cm', 'Bood zich aan via WhatsApp en kan elke week leveren.', 'in_gesprek', 'Monsters gevraagd voor de week voor kerst.');

    for (const t of ['leveranciers', 'producten', 'klanten', 'partijen', 'partij_regels', 'pakbonnen', 'pakbon_regels']) {
      await c.query(`SELECT setval(pg_get_serial_sequence('campo.${t}', 'id'), greatest((SELECT coalesce(max(id), 0) FROM campo.${t}), 1))`);
    }
    await c.query(`INSERT INTO instellingen (sleutel, waarde) VALUES ('demo', $1) ON CONFLICT (sleutel) DO UPDATE SET waarde = EXCLUDED.waarde, bijgewerkt = now()`,
      [JSON.stringify({ versie: WEEK_DEMO_VERSION, anker: anchor, wereld: 'week', gemaakt: new Date(nowMs).toISOString() })]);
    await c.query('COMMIT');
    return { klanten: K.length, weken: weken.length, partijen: partijen.length, pakbonnen: pakbonnen.length, regels: pakRegels.length, anker: anchor };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

// ---------------------------------------------------------------- the demo's life: made once, made again when the week turns
const ALL = `concepten, aanbod_klanten, aanbod_regels, aanbiedingen, berichten_uit, verkoopfacturen, afwijkingen, gebeurtenissen, toewijzingen, leveringen, zendingen,
  factuur_regels, facturen, bestanden, berichten_in, klant_order_regels, klant_orders, plant_namen, klanten, planten, kwekers, logboek,
  aanbod_verkoop, leverancier_aanbod, risico_meldingen,
  pakbon_regels, pakbonnen, verdeling, partij_documenten, partij_regels, partijen, weekorders, weken, prijsafspraken, producten, leveranciers, regios`;

async function onlyDemo(c = pool) {
  const r = await c.query(`SELECT (SELECT count(*) FROM campo.kwekers WHERE bron <> 'demo') + (SELECT count(*) FROM campo.klanten WHERE bron <> 'demo')
    + (SELECT count(*) FROM campo.leveranciers WHERE bron <> 'demo') + (SELECT count(*) FROM campo.producten WHERE bron <> 'demo')
    + (SELECT count(*) FROM campo.berichten_in WHERE kanaal <> 'demo' AND coalesce(extern_id, '') NOT LIKE 'demo-%') AS n`);
  return Number(r.rows[0].n) === 0;
}

export async function resetAll() {
  const c = await pool.connect();
  try {
    await c.query('SET search_path TO campo, public');
    await c.query('BEGIN');
    await c.query(`TRUNCATE ${ALL} RESTART IDENTITY CASCADE`);
    await c.query(`DELETE FROM kansen WHERE bron <> 'jan'`);
    await c.query(`SELECT setval('bestelnummer_seq', 1, false), setval('offertenummer_seq', 1, false)`);
    await c.query(`DELETE FROM instellingen WHERE sleutel IN ('demo', 'imap')`);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

// on start: an empty database, or an older all-demo one, gets the weekly world
export async function ensureWeekDemo() {
  const s = (await pool.query(`SELECT waarde FROM campo.instellingen WHERE sleutel = 'demo'`)).rows[0];
  const has = Number((await pool.query('SELECT count(*) AS n FROM campo.partijen')).rows[0].n);
  const empty = Number((await pool.query('SELECT (SELECT count(*) FROM campo.klanten) + (SELECT count(*) FROM campo.kwekers) AS n')).rows[0].n) === 0;
  if (empty) { const out = await seedWeekDemo(); return { gemaakt: true, ...out }; }
  const old = !s || Number(s.waarde.versie ?? 1) < WEEK_DEMO_VERSION || s.waarde.wereld !== 'week' || !has;
  if ((old || process.env.DEMO_OPNIEUW === 'ja') && await onlyDemo()) {
    await resetAll();
    const out = await seedWeekDemo();
    return { opnieuw: true, ...out };
  }
  return null;
}

// the demo follows the calendar: when a new Friday brings new shipping papers, the week is made again
export async function keepWeekDemoCurrent() {
  const s = (await pool.query(`SELECT waarde FROM campo.instellingen WHERE sleutel = 'demo'`)).rows[0];
  if (!s || s.waarde.wereld !== 'week') return null;
  const anchor = demoAnchor();
  if (s.waarde.anker === anchor) return null;
  if (!await onlyDemo()) return null;
  await resetAll();
  return seedWeekDemo({ anchor });
}

export async function removeWeekDemo() {
  const c = await pool.connect();
  try {
    await c.query('SET search_path TO campo, public');
    await c.query('BEGIN');
    await c.query(`DELETE FROM risico_meldingen WHERE bron = 'demo'`);
    await c.query(`DELETE FROM leverancier_aanbod WHERE bron = 'demo'`);
    await c.query(`DELETE FROM kansen WHERE bron = 'demo'`);
    await c.query(`DELETE FROM partijen WHERE bron = 'demo'`);
    await c.query(`DELETE FROM pakbonnen WHERE bron = 'demo'`);
    await c.query(`DELETE FROM weekorders w USING klanten k WHERE k.id = w.klant_id AND k.bron = 'demo'`);
    await c.query(`DELETE FROM klanten WHERE bron = 'demo'`);
    await c.query(`DELETE FROM producten p WHERE bron = 'demo' AND NOT EXISTS (SELECT 1 FROM partij_regels r WHERE r.product_id = p.id) AND NOT EXISTS (SELECT 1 FROM pakbon_regels r WHERE r.product_id = p.id)`);
    await c.query(`DELETE FROM leveranciers l WHERE bron = 'demo' AND NOT EXISTS (SELECT 1 FROM partijen p WHERE p.leverancier_id = l.id)`);
    await c.query(`DELETE FROM regios g WHERE bron = 'demo' AND NOT EXISTS (SELECT 1 FROM leveranciers l WHERE l.regio = g.code)`);
    await c.query(`DELETE FROM weken w WHERE NOT EXISTS (SELECT 1 FROM partijen p WHERE p.maandag = w.maandag) AND NOT EXISTS (SELECT 1 FROM weekorders o WHERE o.maandag = w.maandag) AND NOT EXISTS (SELECT 1 FROM pakbonnen s WHERE s.maandag = w.maandag)`);
    await c.query(`DELETE FROM berichten_in WHERE extern_id LIKE 'demo-%' OR kanaal = 'demo'`);
    await c.query(`DELETE FROM kwekers WHERE bron = 'demo'`);
    await c.query(`DELETE FROM bestanden b WHERE bericht_id IS NULL AND NOT EXISTS (SELECT 1 FROM partij_documenten d WHERE d.bestand_id = b.id)`);
    await c.query(`DELETE FROM instellingen WHERE sleutel = 'demo'`);
    await c.query('COMMIT');
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
