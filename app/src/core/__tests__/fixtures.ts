import { hashCode } from '../crypto/codes';
import { deriveProgramKeys, generateProgram, type ProgramKeys } from '../crypto/keys';
import { createEvent, type KitEvent, type VisitLogged } from '../domain/events';

export const DEVICE_A = '11111111-1111-4111-8111-111111111111';
export const DEVICE_B = '22222222-2222-4222-8222-222222222222';

export function testKeys(): ProgramKeys {
  const { programId, secret } = generateProgram();
  return deriveProgramKeys(programId, secret);
}

export interface VisitInput {
  code?: string | null;
  out?: Record<string, number>;
  syringesIn?: number;
  reversals?: number;
  referrals?: string[];
  secondary?: number;
  device?: string;
}

export function visit(keys: ProgramKeys, at: string, v: VisitInput = {}): VisitLogged {
  return createEvent(
    v.device ?? DEVICE_A,
    {
      type: 'visit.logged',
      participant: v.code ? hashCode(keys.codeKey, v.code) : null,
      out: v.out ?? {},
      syringesIn: v.syringesIn ?? 0,
      reversals: v.reversals ?? 0,
      referrals: v.referrals ?? [],
      secondary: v.secondary ?? 0,
    },
    new Date(at),
  );
}

export function received(supply: string, qty: number, at: string, device = DEVICE_A): KitEvent {
  return createEvent(device, { type: 'stock.received', supply, qty }, new Date(at));
}
