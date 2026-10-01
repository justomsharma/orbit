/** The getting-started checklist on Home, in the order it's shown. */
export const STEPS = ["continue", "find", "details", "setup", "limits"] as const;
export type Step = (typeof STEPS)[number];

export interface Onboarding {
  done: Step[];
  dismissed: boolean;
}

export const isStep = (v: unknown): v is Step => STEPS.includes(v as Step);
