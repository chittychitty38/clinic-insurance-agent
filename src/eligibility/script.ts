import { clinic } from '../clinic.js';
import { spokenDate, spokenDollars, spokenPercent } from '../normalize.js';
import type { Payer } from '../payers.js';
import type { CoverageFacts, EligibilityFacts, PayerErrorFacts, VisitType } from './interpret.js';

/**
 * Turns interpreted facts into the words the caller hears. The voice model is told to
 * say `say` faithfully and to follow `next_step`. It is never asked to work out a
 * number itself.
 */

export type Outcome =
  | 'ACCEPTED'
  | 'ACCEPTED_COPAY_UNCONFIRMED'
  | 'NOT_IN_NETWORK'
  | 'COVERAGE_INACTIVE'
  | 'DENTAL_PLAN'
  | 'PLEASE_VERIFY_DETAILS'
  | 'PAYER_UNAVAILABLE'
  | 'CLINIC_SETUP_ISSUE';

export interface AgentAnswer {
  outcome: Outcome;
  say: string;
  next_step: string;
  /** Plain facts the agent may use to answer follow-up questions. Nothing outside this. */
  facts: Record<string, string | number | boolean | null>;
}

const OFFER_CALLBACK = `Offer a callback from the front desk. If they want one, confirm the best phone number and call request_callback.`;

export function buildAnswer(
  facts: EligibilityFacts,
  ctx: { payer: Payer; firstName: string; visitType: VisitType; priorFailures: number },
): AgentAnswer {
  if (facts.kind === 'payer_error') return errorAnswer(facts, ctx);
  if (facts.dentalOnly) return dentalAnswer(ctx.payer);
  if (!facts.active) return inactiveAnswer(facts, ctx.payer);
  if (!ctx.payer.inNetwork) return outOfNetworkAnswer(facts, ctx.payer);
  return acceptedAnswer(facts, ctx);
}

function acceptedAnswer(f: CoverageFacts, ctx: { payer: Payer; firstName: string; visitType: VisitType }): AgentAnswer {
  const { payer, firstName, visitType } = ctx;
  const parts: string[] = [];
  let outcome: Outcome = 'ACCEPTED';
  let next = 'Ask if there is anything else you can help with.';

  if (f.isMedicare) {
    parts.push(`Good news, ${firstName}. We accept Medicare, and your coverage is active.`);
    const coins = f.visitCoinsurance ?? 0.2;
    parts.push(
      `Medicare doesn't have a set copay for an office visit. Instead, once your yearly Part B deductible is met, you'd pay ${spokenPercent(coins)} of the Medicare-approved amount for the visit.`,
    );
    if (f.deductible.remaining !== undefined) {
      parts.push(f.deductible.remaining === 0
        ? `Your Part B deductible is already met for this year.`
        : `You have ${spokenDollars(f.deductible.remaining)} left on your Part B deductible this year.`);
    }
    parts.push(`If you have a Medicare supplement plan, it may cover some or all of that.`);
  } else {
    parts.push(`Good news, ${firstName}. We're in network with ${payer.displayName}, and your coverage is active.`);
    const copay = f.visitCopay;
    if (copay.status === 'single') {
      parts.push(copay.amount === 0
        ? `Your plan shows no copay for a visit with our eye doctor.`
        : `For a visit with our eye doctor, your copay should be ${spokenDollars(copay.amount)}.`);
    } else if (copay.status === 'multiple') {
      outcome = 'ACCEPTED_COPAY_UNCONFIRMED';
      const amounts = copay.options.map((o) => spokenDollars(o.amount));
      parts.push(
        `Your plan lists more than one office-visit copay, ${joinOr(amounts)}, depending on how the visit is billed, and I don't want to guess which one applies.`,
      );
      next = `Tell them our billing team can confirm the exact copay. ${OFFER_CALLBACK}`;
    } else if (f.visitCoinsurance !== undefined && f.visitCoinsurance > 0) {
      parts.push(
        `Your plan doesn't use a flat copay for specialist visits. Instead, you'd pay ${spokenPercent(f.visitCoinsurance)} of the visit cost after your deductible.`,
      );
      if (f.deductible.remaining !== undefined) {
        parts.push(f.deductible.remaining === 0
          ? `Your deductible is already met for this year.`
          : `You have ${spokenDollars(f.deductible.remaining)} left on your deductible this year.`);
      }
    } else if (f.visitCoinsurance === 0) {
      parts.push(`Your plan shows no copay and no coinsurance for a visit with our eye doctor.`);
    } else {
      outcome = 'ACCEPTED_COPAY_UNCONFIRMED';
      parts.push(`Your insurance didn't report a copay amount for specialist visits, and I don't want to guess.`);
      next = `Tell them our billing team can confirm the exact copay. ${OFFER_CALLBACK}`;
    }
  }

  if (f.isHmo) {
    parts.push(`Since your plan is an HMO, you may need a referral from your primary care doctor before the visit.`);
  }
  if (f.priorAuthRequired) {
    parts.push(`Your plan also notes that office visits need prior authorization, which our team will handle before your appointment.`);
  }
  if (visitType === 'routine' && !f.isMedicare) {
    parts.push(
      `One heads-up: medical insurance usually doesn't cover the refraction, which is the glasses-prescription part of a routine exam. That's a separate ${spokenDollars(clinic.refractionFee)} fee.`,
    );
  } else if (visitType === 'routine' && f.isMedicare) {
    parts.push(
      `One heads-up: Medicare doesn't cover routine exams for glasses, including the refraction, which is a separate ${spokenDollars(clinic.refractionFee)} fee.`,
    );
  }

  return { outcome, say: parts.join(' '), next_step: next, facts: coverageFacts(f, payer) };
}

function outOfNetworkAnswer(f: CoverageFacts, payer: Payer): AgentAnswer {
  const parts = [
    `I checked, and your ${payer.displayName} coverage is active, but unfortunately we're not in network with ${payer.displayName}.`,
  ];
  if (payer.outOfNetworkNote) parts.push(payer.outOfNetworkNote);
  else if (f.outOfNetwork.coinsurance !== undefined) {
    parts.push(
      `Your plan does show some out-of-network benefits. You'd typically pay ${spokenPercent(f.outOfNetwork.coinsurance)} of the cost${f.outOfNetwork.deductible !== undefined ? ` after a ${spokenDollars(f.outOfNetwork.deductible)} out-of-network deductible` : ''}.`,
    );
  }
  parts.push(
    `You're still welcome to see us as a self-pay patient. A comprehensive eye exam is ${spokenDollars(clinic.selfPay.comprehensiveExam)}. Or you can call the member services number on your card to find an in-network eye doctor.`,
  );
  return {
    outcome: 'NOT_IN_NETWORK',
    say: parts.join(' '),
    next_step: `Ask whether they'd like to book as self-pay or have the front desk call them back to talk through options. ${OFFER_CALLBACK}`,
    facts: coverageFacts(f, payer),
  };
}

function inactiveAnswer(f: CoverageFacts, payer: Payer): AgentAnswer {
  const when = f.coverageEnd ? ` as of ${spokenDate(f.coverageEnd)}` : '';
  return {
    outcome: 'COVERAGE_INACTIVE',
    say: `I checked with ${payer.displayName}, and unfortunately the plan under that member ID shows as inactive${when}. That sometimes happens when coverage recently changed. Do you have a newer insurance card I could check?`,
    next_step: `If they have a different card, collect the insurance company and member ID and call check_insurance again. If not, mention the self-pay rate of ${spokenDollars(clinic.selfPay.comprehensiveExam)} for a comprehensive exam and suggest calling the number on their card. ${OFFER_CALLBACK}`,
    facts: coverageFacts(f, payer),
  };
}

export function dentalAnswer(payer: Payer): AgentAnswer {
  return {
    outcome: 'DENTAL_PLAN',
    say: `It looks like that ${payer.displayName} card is a dental plan. Since we're an eye clinic, we bill your medical insurance instead. Do you have a medical insurance card handy?`,
    next_step: 'If they have a medical card, collect the insurance company and member ID and call check_insurance again.',
    facts: { payer: payer.displayName, plan_type: 'dental' },
  };
}

function errorAnswer(e: PayerErrorFacts, ctx: { payer: Payer; priorFailures: number }): AgentAnswer {
  const name = ctx.payer.displayName;
  const facts = { payer: name, payer_error_code: e.code, payer_error: e.description };
  const gaveUp = ctx.priorFailures >= 1;

  switch (e.category) {
    case 'member_id_rejected':
      return gaveUp
        ? escalate(`${name} still isn't accepting that member ID, and I don't want to give you a wrong answer.`, facts)
        : {
            outcome: 'PLEASE_VERIFY_DETAILS',
            say: `${name} didn't recognize that member ID. Could you read it to me one more time, exactly as it's printed on your card?`,
            next_step: 'Read the new member ID back character by character to confirm, then call check_insurance again.',
            facts,
          };
    case 'name_rejected':
    case 'birthdate_rejected':
      return gaveUp
        ? escalate(`${name} still can't match those details, and I don't want to give you a wrong answer.`, facts)
        : {
            outcome: 'PLEASE_VERIFY_DETAILS',
            say: `${name} says the ${e.category === 'name_rejected' ? 'name' : 'date of birth'} doesn't match what they have on file. Is the insurance in your name, or is it under someone else's, like a parent or spouse?`,
            next_step: 'If the plan is under someone else, collect the policyholder\'s full name and date of birth and call check_insurance again with policyholder_name and policyholder_date_of_birth. Otherwise confirm the spelling of their name and date of birth and try once more.',
            facts,
          };
    case 'member_not_found':
      return gaveUp
        ? escalate(`${name} still can't find a member with those details, and I don't want to give you a wrong answer.`, facts)
        : {
            outcome: 'PLEASE_VERIFY_DETAILS',
            say: `${name} couldn't find a member with those details. Is the insurance under someone else's name, like a parent or spouse? Or could you double-check the member ID on the card?`,
            next_step: 'If the plan is under someone else, collect the policyholder\'s full name and date of birth and call check_insurance again with policyholder_name and policyholder_date_of_birth. Otherwise re-confirm the member ID and try once more.',
            facts,
          };
    case 'payer_unavailable':
      return escalate(
        `I'm sorry, ${name}'s system isn't responding right now, so I can't get a reliable answer, and I don't want to guess.`,
        facts,
        'PAYER_UNAVAILABLE',
      );
    case 'clinic_setup':
      return escalate(
        `I'm sorry, ${name} rejected the request because of a setup issue on our end, not anything you did. I've flagged it for our billing team.`,
        facts,
        'CLINIC_SETUP_ISSUE',
      );
    default:
      return escalate(`I'm sorry, ${name} returned an error I can't resolve over the phone, and I don't want to give you a wrong answer.`, facts, 'PAYER_UNAVAILABLE');
  }
}

function escalate(lead: string, facts: AgentAnswer['facts'], outcome: Outcome = 'PLEASE_VERIFY_DETAILS'): AgentAnswer {
  return {
    outcome,
    say: `${lead} Someone from our front desk can verify it and call you back ${clinic.callbackPromise}.`,
    next_step: `Confirm the best phone number to reach them, then call request_callback with a short reason that includes the insurance company.`,
    facts,
  };
}

function coverageFacts(f: CoverageFacts, payer: Payer): AgentAnswer['facts'] {
  return {
    payer: payer.displayName,
    clinic_in_network: payer.inNetwork,
    coverage_active: f.active,
    plan_name: f.planName ?? null,
    plan_type: f.insuranceType ?? null,
    coverage_end_date: f.coverageEnd ?? null,
    office_visit_copay: f.visitCopay.status === 'single' ? f.visitCopay.amount : null,
    office_visit_coinsurance_percent: f.visitCoinsurance !== undefined ? Math.round(f.visitCoinsurance * 1000) / 10 : null,
    deductible_total: f.deductible.total ?? null,
    deductible_remaining: f.deductible.remaining ?? null,
    out_of_pocket_max: f.outOfPocket.total ?? null,
    out_of_pocket_remaining: f.outOfPocket.remaining ?? null,
    self_pay_comprehensive_exam: clinic.selfPay.comprehensiveExam,
  };
}

function joinOr(items: string[]): string {
  if (items.length <= 2) return items.join(' or ');
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}
