import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as en from '@zxcvbn-ts/language-en';
import { LIMITS } from './enums';

let factory: ZxcvbnFactory | null = null;
function getFactory(): ZxcvbnFactory {
  factory ??= new ZxcvbnFactory({
    dictionary: { ...common.dictionary, ...en.dictionary },
    graphs: common.adjacencyGraphs,
    translations: en.translations,
  });
  return factory;
}

export const MIN_PASSWORD_SCORE = 3;

export type PasswordProblem = 'too_short' | 'too_long' | 'too_weak';

export interface PasswordCheck {
  ok: boolean;
  /** 0 (very weak) – 4 (very strong) */
  score: 0 | 1 | 2 | 3 | 4;
  problem: PasswordProblem | null;
}

/**
 * Shared password policy used by the sign-up form (strength meter) and enforced by the API.
 * `userInputs` (name, email, phone) are penalised if they appear in the password.
 */
export async function checkPassword(
  password: string,
  userInputs: string[] = [],
): Promise<PasswordCheck> {
  if (password.length < LIMITS.passwordMin) return { ok: false, score: 0, problem: 'too_short' };
  if (password.length > LIMITS.passwordMax) return { ok: false, score: 0, problem: 'too_long' };
  const result = await getFactory().checkAsync(password, userInputs.filter(Boolean));
  const ok = result.score >= MIN_PASSWORD_SCORE;
  return { ok, score: result.score, problem: ok ? null : 'too_weak' };
}
