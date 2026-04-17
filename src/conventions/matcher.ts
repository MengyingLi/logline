import type { FileContent } from '../lib/types';

/** Signals that indicate onboarding-related code (signup, verification, onboarding flow) */
const ONBOARDING_SIGNALS = {
  paths: [
    'signup',
    'register',
    'registration',
    'onboarding',
    'welcome',
    'getting-started',
    'verify',
    'verification',
    'confirm-email',
    'auth/signup',
  ],
  components: [
    'SignupForm',
    'SignupPage',
    'RegistrationPage',
    'RegistrationForm',
    'OnboardingWizard',
    'OnboardingStep',
    'OnboardingFlow',
    'WelcomePage',
    'VerifyEmail',
    'ConfirmEmail',
  ],
  patterns: [
    /signUp|sign_up|createUser|create_user/i,
    /verifyEmail|verify_email|confirmEmail|confirm_email/i,
    /verification[-_]?token|emailVerification/i,
    /supabase\.auth\.signUp|firebase\.auth\(\)\.createUser/i,
    /Auth0|Clerk|getAuth|useAuth/i,
    /currentStep|nextStep|stepIndex|step_index|onboardingStep/i,
    /stepper|wizard|multiStep|multi_step/i,
  ],
};

export type ConventionDomain = 'onboarding' | string;

/**
 * Detect which convention domains are relevant to this codebase
 * by scanning file paths and content for known signals.
 *
 * Requires at least 2 distinct signal types (path, component, pattern) before
 * including a domain — prevents single-string matches like "verify" in a file
 * path from triggering onboarding conventions in unrelated codebases.
 */
export function matchConventionsToCodebase(files: FileContent[]): ConventionDomain[] {
  // Track which signal types have fired per domain
  const hits = new Map<ConventionDomain, Set<string>>();

  function addHit(domain: ConventionDomain, signalType: 'path' | 'component' | 'pattern') {
    let set = hits.get(domain);
    if (!set) { set = new Set(); hits.set(domain, set); }
    set.add(signalType);
  }

  const pathLower = (p: string) => p.toLowerCase().replace(/\\/g, '/');

  for (const file of files) {
    const pathStr = pathLower(file.path);

    // Onboarding: path signals
    for (const signal of ONBOARDING_SIGNALS.paths) {
      if (pathStr.includes(signal)) { addHit('onboarding', 'path'); break; }
    }

    const content = file.content;
    // Onboarding: component names
    for (const comp of ONBOARDING_SIGNALS.components) {
      if (content.includes(comp)) { addHit('onboarding', 'component'); break; }
    }
    // Onboarding: code patterns
    for (const pattern of ONBOARDING_SIGNALS.patterns) {
      if (pattern.test(content)) { addHit('onboarding', 'pattern'); break; }
    }
  }

  // Only include a domain if at least 2 distinct signal types matched
  const matched: ConventionDomain[] = [];
  for (const [domain, signalTypes] of hits) {
    if (signalTypes.size >= 2) matched.push(domain);
  }
  return matched;
}
