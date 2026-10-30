import { describe, expect, it } from 'vitest';
import { portalQuoteStatus } from './portal';

describe('portalQuoteStatus', () => {
  it('已邀请在截止前是待报价，截止后是未报价；其他状态不变', () => {
    expect(portalQuoteStatus('INVITED', 'WAITING_QUOTES')).toBe('INVITED');
    expect(portalQuoteStatus('INVITED', 'QUOTES_CLOSED')).toBe('NO_RESPONSE');
    expect(portalQuoteStatus('INVITED', 'CANCELLED')).toBe('NO_RESPONSE');
    expect(portalQuoteStatus('SUBMITTED', 'QUOTES_CLOSED')).toBe('SUBMITTED');
    expect(portalQuoteStatus('VOID', 'CANCELLED')).toBe('VOID');
  });
});
