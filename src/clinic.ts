/**
 * Everything the front desk would know without looking anything up: who we are,
 * what we charge self-pay patients, and when we're open. Kept in one place so the
 * practice manager can change it without touching the agent logic.
 */
export const clinic = {
  name: 'Campus Eye Center',
  agentName: 'Riley',
  specialty: 'ophthalmology',
  hours: 'Monday through Friday, 8 AM to 5 PM',
  callbackPromise: 'within one business day',
  selfPay: {
    comprehensiveExam: 175,
    followUpVisit: 110,
  },
  // Medical plans usually exclude refraction (CPT 92015): the "which is better, one or two" part
  // of a routine exam that produces a glasses prescription. Patients pay it out of pocket.
  refractionFee: 45,
} as const;
