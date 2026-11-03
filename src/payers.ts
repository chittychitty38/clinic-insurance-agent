import { normalizeText } from './normalize.js';

/**
 * The clinic's payer contracts. "Is my insurance accepted?" is answered here, not by
 * Stedi: a 271 response tells you whether the patient's coverage is active, but it
 * can't reliably tell you whether *this* practice is in the payer's network.
 */
export type PayerKind = 'medical' | 'medicare' | 'dental';

export interface Payer {
  key: string;
  /** Stedi payer ID. Null for dental-only carriers, which we never send to Stedi. */
  stediPayerId: string | null;
  displayName: string;
  /** Lowercase phrases a caller (or the speech-to-text) might use. */
  aliases: string[];
  kind: PayerKind;
  inNetwork: boolean;
  /** Extra context the agent says when we're out of network. */
  outOfNetworkNote?: string;
  /**
   * Some payers run several networks and price visits per network (Anthem: "SPECIALIST, EPO
   * NETWORK" $30 vs "SPECIALIST, PAR NETWORK" $45). These are the ones the clinic is in.
   */
  clinicNetworks?: string[];
}

export const PAYERS: Payer[] = [
  {
    key: 'aetna',
    stediPayerId: '60054',
    displayName: 'Aetna',
    aliases: ['aetna', 'etna', 'aetna student health', 'aetna cvs'],
    kind: 'medical',
    inNetwork: true,
  },
  {
    key: 'cigna',
    stediPayerId: '62308',
    displayName: 'Cigna',
    aliases: ['cigna', 'signa', 'cigna healthcare', 'evernorth'],
    kind: 'medical',
    inNetwork: true,
  },
  {
    key: 'uhc',
    stediPayerId: '87726',
    displayName: 'UnitedHealthcare',
    aliases: ['unitedhealthcare', 'united healthcare', 'united health care', 'united health', 'united', 'uhc', 'u h c', 'student resources', 'uhc student resources'],
    kind: 'medical',
    inNetwork: true,
  },
  {
    key: 'anthem-ca',
    stediPayerId: '040',
    displayName: 'Anthem Blue Cross',
    clinicNetworks: ['PAR'],
    aliases: ['anthem', 'anthem blue cross', 'anthem bcbs', 'blue cross of california', 'anthem blue cross california', 'blue cross', 'blue cross blue shield', 'bcbs'],
    kind: 'medical',
    inNetwork: true,
  },
  {
    key: 'bcbs-tx',
    stediPayerId: 'G84980',
    displayName: 'Blue Cross Blue Shield of Texas',
    aliases: ['blue cross blue shield of texas', 'bcbs texas', 'bcbstx', 'blue cross texas', 'texas blue cross', 'blue cross', 'blue cross blue shield', 'bcbs'],
    kind: 'medical',
    inNetwork: true,
  },
  {
    key: 'humana',
    stediPayerId: '61101',
    displayName: 'Humana',
    aliases: ['humana', 'humana gold'],
    kind: 'medical',
    inNetwork: true,
  },
  {
    key: 'oscar',
    stediPayerId: 'OSCAR',
    displayName: 'Oscar Health',
    aliases: ['oscar', 'oscar health'],
    kind: 'medical',
    inNetwork: true,
  },
  {
    key: 'medicare',
    stediPayerId: 'CMS',
    displayName: 'Medicare',
    aliases: ['medicare', 'original medicare', 'medicare part b', 'part b', 'cms', 'red white and blue card'],
    kind: 'medicare',
    inNetwork: true,
  },
  {
    key: 'kaiser',
    stediPayerId: 'KSRCN',
    displayName: 'Kaiser Permanente',
    aliases: ['kaiser', 'kaiser permanente', 'kp'],
    kind: 'medical',
    inNetwork: false,
    outOfNetworkNote: 'Kaiser plans generally only cover care from Kaiser doctors, so a visit with us likely would not be covered.',
  },
  {
    key: 'ambetter',
    stediPayerId: '68069',
    displayName: 'Ambetter',
    aliases: ['ambetter', 'am better', 'ambetter health', 'ambetter from centene'],
    kind: 'medical',
    inNetwork: false,
  },
  // Dental-only carriers: patients sometimes read us the wrong card.
  { key: 'ameritas', stediPayerId: 'AMTAS00425', displayName: 'Ameritas', aliases: ['ameritas'], kind: 'dental', inNetwork: false },
  { key: 'metlife', stediPayerId: '10134', displayName: 'MetLife Dental', aliases: ['metlife', 'met life', 'metlife dental'], kind: 'dental', inNetwork: false },
  { key: 'delta', stediPayerId: null, displayName: 'Delta Dental', aliases: ['delta dental', 'delta'], kind: 'dental', inNetwork: false },
  { key: 'uhc-dental', stediPayerId: '52133', displayName: 'UnitedHealthcare Dental', aliases: ['united healthcare dental', 'uhc dental', 'united dental'], kind: 'dental', inNetwork: false },
  { key: 'bcbsca-dental', stediPayerId: '84103', displayName: 'Blue Shield of California Dental', aliases: ['blue shield dental', 'blue shield of california dental'], kind: 'dental', inNetwork: false },
];

export function payerByKey(key: string): Payer | undefined {
  return PAYERS.find((p) => p.key === key);
}

export type PayerResolution =
  | { status: 'resolved'; payer: Payer }
  | { status: 'ambiguous'; options: Payer[] }
  | { status: 'unknown' };

/**
 * Map what the caller said ("I've got United", "Blue Cross") to a payer.
 * The longest matching alias wins; ties between different payers are ambiguous unless
 * the patient's insurance on file breaks the tie.
 */
export function resolvePayer(spoken: string, preferKey?: string): PayerResolution {
  const said = ` ${normalizeText(spoken)} `;
  let best = 0;
  let matches: Payer[] = [];
  for (const payer of PAYERS) {
    for (const alias of payer.aliases) {
      if (!said.includes(` ${alias} `)) continue;
      if (alias.length > best) {
        best = alias.length;
        matches = [payer];
      } else if (alias.length === best && !matches.includes(payer)) {
        matches.push(payer);
      }
    }
  }
  if (matches.length === 1) return { status: 'resolved', payer: matches[0]! };
  if (matches.length > 1) {
    const preferred = matches.find((p) => p.key === preferKey);
    if (preferred) return { status: 'resolved', payer: preferred };
    return { status: 'ambiguous', options: matches };
  }
  return { status: 'unknown' };
}
