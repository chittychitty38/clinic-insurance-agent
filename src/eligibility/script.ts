import { clinic } from '../clinic.js';
import { spokenDate, spokenDollars, spokenPercent } from '../normalize.js';
import type { Payer } from '../payers.js';
import type { CopayBasis, CoverageFacts, EligibilityFacts, PayerErrorFacts, VisitType } from './interpret.js';

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
  | 'COVERAGE_UNCONFIRMED'
  | 'DENTAL_PLAN'
  | 'VISION_PLAN'
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
  if (facts.datesConflict) {
    return {
      ...escalate(`${ctx.payer.displayName} says your plan is active, but the coverage dates they sent don't match today, and I don't want to guess.`, coverageFacts(facts, ctx.payer)),
      outcome: 'COVERAGE_UNCONFIRMED',
    };
  }
  if (!facts.active) return inactiveAnswer(facts, ctx.payer);
  if (!ctx.payer.inNetwork) return outOfNetworkAnswer(facts, ctx.payer, 'clinic');
  // We contract with the payer, but this member's specific plan uses a network we're not in.
  if (facts.payerSaysOutOfNetwork) return outOfNetworkAnswer(facts, ctx.payer, 'plan');
  return acceptedAnswer(facts, ctx);
}

const COPAY_SENTENCE: Record<CopayBasis, (amount: string) => string> = {
  specialist: (a) => `For a specialist visit with our eye doctor, your copay should be ${a}.`,
  office: (a) => `For an office visit with our eye doctor, your copay should be ${a}.`,
  plan: (a) => `Your plan lists a copay of ${a} for office visits.`,
  vision: (a) => `For a routine eye exam, your plan's vision benefit shows a copay of ${a}.`,
};

function acceptedAnswer(f: CoverageFacts, ctx: { payer: Payer; firstName: string; visitType: VisitType }): AgentAnswer {
  const { payer, firstName, visitType } = ctx;
  const parts: string[] = [];
  let outcome: Outcome = 'ACCEPTED';
  let next = 'Ask if there is anything else you can help with.';

  if (f.isMedicare) {
    parts.push(`Good news, ${firstName}. We accept Medicare, and your Part B coverage for office visits is active.`);
    if (f.isQmb) {
      parts.push(
        `Your record also shows you're in the Qualified Medicare Beneficiary program, so Medicaid covers your Medicare cost-sharing. You shouldn't owe a copay or coinsurance for a covered visit.`,
      );
    } else {
      // Part B's 20% coinsurance is set by statute; we use the payer's figure when it sends one.
      const coins = f.visitCoinsurance ?? 0.2;
      parts.push(
        `Medicare doesn't have a set copay for an office visit. Once your yearly Part B deductible is met, you'd pay ${spokenPercent(coins)} of the Medicare-approved amount.`,
      );
      if (f.deductible.remaining !== undefined) {
        parts.push(f.deductible.remaining === 0
          ? `Your Part B deductible is already met for this year.`
          : `You have ${spokenDollars(f.deductible.remaining)} left on your Part B deductible this year.`);
      }
      parts.push(`If you have a Medicare supplement plan, it may cover some or all of that.`);
    }
  } else {
    parts.push(`Good news, ${firstName}. We're in network with ${payer.displayName}, and your coverage is active.`);
    const copay = f.visitCopay;
    if (copay.status === 'single') {
      parts.push(copay.amount === 0
        ? `Your plan shows no copay for an office visit with our eye doctor.`
        : COPAY_SENTENCE[copay.basis](spokenDollars(copay.amount)));
    } else if (copay.status === 'multiple') {
      outcome = 'ACCEPTED_COPAY_UNCONFIRMED';
      const amounts = copay.options.map((o) => spokenDollars(o.amount));
      parts.push(
        `Your plan lists more than one office-visit copay, ${joinOr(amounts)}, depending on how the visit is billed, and I don't want to guess which one applies.`,
      );
      next = `Tell them our billing team can confirm the exact copay. ${OFFER_CALLBACK}`;
    } else if (f.visitCoinsurance !== undefined && f.visitCoinsurance > 0) {
      parts.push(
        `Your plan doesn't use a flat copay for office visits. Instead, you'd pay ${spokenPercent(f.visitCoinsurance)} of the visit cost after your deductible.`,
      );
      if (f.deductible.remaining !== undefined) {
        parts.push(f.deductible.remaining === 0
          ? `Your deductible is already met for this year.`
          : `You have ${spokenDollars(f.deductible.remaining)} left on your deductible this year.`);
      }
    } else if (f.visitCoinsurance === 0) {
      parts.push(`Your plan shows no copay and no coinsurance for an office visit with our eye doctor.`);
      if (f.deductible.remaining) {
        parts.push(`Your plan does have a deductible, with ${spokenDollars(f.deductible.remaining)} left this year, which can apply depending on the services you receive.`);
      }
    } else {
      outcome = 'ACCEPTED_COPAY_UNCONFIRMED';
      parts.push(`Your insurance didn't report a copay amount for specialist visits, and I don't want to guess.`);
      next = `Tell them our billing team can confirm the exact copay. ${OFFER_CALLBACK}`;
    }
  }

  if (f.referralRequired) {
    parts.push(`Your plan requires a referral from your primary care doctor before seeing a specialist, so please ask them to send one to us before your visit.`);
  } else if (f.isHmo) {
    parts.push(`Since your plan is an HMO, you may need a referral from your primary care doctor before the visit.`);
  }
  if (f.priorAuthRequired) {
    parts.push(`Your plan also notes that office visits need prior authorization, which our team will handle before your appointment.`);
  }
  if (visitType === 'routine') {
    parts.push(f.isMedicare
      ? `One heads-up: Medicare doesn't cover routine exams for glasses, including the refraction, which is a separate ${spokenDollars(clinic.refractionFee)} fee.`
      : `One heads-up: medical insurance usually doesn't cover the refraction, which is the glasses-prescription part of a routine exam. That's a separate ${spokenDollars(clinic.refractionFee)} fee.`);
  }

  return { outcome, say: parts.join(' '), next_step: next, facts: coverageFacts(f, payer) };
}

function outOfNetworkAnswer(f: CoverageFacts, payer: Payer, why: 'clinic' | 'plan'): AgentAnswer {
  const parts = [
    why === 'clinic'
      ? `I checked, and your ${payer.displayName} coverage is active, but unfortunately we're not in network with ${payer.displayName}.`
      : `I checked, and your ${payer.displayName} coverage is active, but ${payer.displayName} says your specific plan lists our office as out of network.`,
  ];
  if (why === 'clinic' && payer.outOfNetworkNote) parts.push(payer.outOfNetworkNote);
  else if (f.outOfNetwork.coinsurance !== undefined && f.outOfNetwork.coinsurance > 0) {
    parts.push(
      `Your plan does show some out-of-network benefits. You'd typically pay ${spokenPercent(f.outOfNetwork.coinsurance)} of the cost${f.outOfNetwork.deductible ? ` after a ${spokenDollars(f.outOfNetwork.deductible)} out-of-network deductible` : ''}.`,
    );
  }
  parts.push(
    `You're still welcome to see us as a self-pay patient. A comprehensive eye exam is ${spokenDollars(clinic.selfPay.comprehensiveExam)}. Or you can call the member services number on your card to find an in-network eye doctor.`,
  );
  return {
    outcome: 'NOT_IN_NETWORK',
    say: parts.join(' '),
    next_step: `Ask whether they'd like to book as self-pay or have the front desk call them back to talk through options${why === 'plan' ? ' and double-check the plan\'s network' : ''}. ${OFFER_CALLBACK}`,
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

/**
 * Eye care runs on two kinds of insurance. A vision plan (VSP, EyeMed) covers the routine exam
 * for glasses or contacts; anything medical (infection, glaucoma, cataracts) goes to medical insurance.
 */
export function visionPlanAnswer(payer: Payer, visitType: VisitType): AgentAnswer {
  const facts = { payer: payer.displayName, plan_type: 'vision', clinic_in_network: payer.inNetwork };
  if (visitType === 'medical') {
    return {
      outcome: 'VISION_PLAN',
      say: `${payer.displayName} is a vision plan, which covers routine exams for glasses and contacts. For a medical eye concern like yours, we bill your medical insurance instead. Do you have your medical insurance card handy?`,
      next_step: 'If they have a medical card, collect the insurance company and member ID and call check_insurance again with visit_type "medical".',
      facts,
    };
  }
  if (!payer.inNetwork) {
    return {
      outcome: 'NOT_IN_NETWORK',
      say: `We're not in network with ${payer.displayName} for routine exams, unfortunately. You're welcome to see us as a self-pay patient: a comprehensive eye exam is ${spokenDollars(clinic.selfPay.comprehensiveExam)}, and many vision plans will reimburse part of it if you send them the receipt.`,
      next_step: `Ask whether they'd like to book as self-pay. ${OFFER_CALLBACK}`,
      facts,
    };
  }
  return {
    outcome: 'ACCEPTED_COPAY_UNCONFIRMED',
    say: `Good news: we're in network with ${payer.displayName} for routine eye exams. ${payer.displayName} benefits aren't available through the system I use, so I can't read you your exact exam copay, and I don't want to guess. Our front desk can look it up in ${payer.displayName}'s portal and call you back with it.`,
    next_step: OFFER_CALLBACK,
    facts,
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
