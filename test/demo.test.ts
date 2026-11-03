import { describe, expect, it } from 'vitest';
import { allowedOrigin, takeDemoSlot } from '../src/demo.js';

describe('public live demo guardrails', () => {
  it('only answers the project site, its deploy previews and local development', () => {
    expect(allowedOrigin('https://clinic-insurance-agent.netlify.app')).toBe(true);
    expect(allowedOrigin('https://6ae98008a571683777668fa8--clinic-insurance-agent.netlify.app')).toBe(true);
    expect(allowedOrigin('http://localhost:4817')).toBe(true);
    expect(allowedOrigin('https://clinic-insurance-agent.netlify.app.evil.com')).toBe(false);
    expect(allowedOrigin('https://evil-clinic-insurance-agent.netlify.app')).toBe(false);
    expect(allowedOrigin(undefined)).toBe(false);
  });

  it('allows 60 live checks a minute across all visitors, then makes them wait', () => {
    const log: number[] = [];
    const t0 = 1_000_000;
    for (let i = 0; i < 60; i++) expect(takeDemoSlot(t0 + i, log)).toBe(true);
    expect(takeDemoSlot(t0 + 100, log)).toBe(false);
    expect(takeDemoSlot(t0 + 60_001, log)).toBe(true);
  });
});
