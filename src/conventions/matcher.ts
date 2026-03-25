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
 */
export function matchConventionsToCodebase(files: FileContent[]): ConventionDomain[] {
  const matched = new Set<ConventionDomain>();
  const pathLower = (p: string) => p.toLowerCase().replace(/\\/g, '/');

  for (const file of files) {
    const pathStr = pathLower(file.path);

    // Onboarding: path signals
    for (const signal of ONBOARDING_SIGNALS.paths) {
      if (pathStr.includes(signal)) {
        matched.add('onboarding');
        break;
      }
    }

    // Onboarding: component names and code patterns
    if (!matched.has('onboarding')) {
      const content = file.content;
      for (const comp of ONBOARDING_SIGNALS.components) {
        if (content.includes(comp)) {
          matched.add('onboarding');
          break;
        }
      }
      if (!matched.has('onboarding')) {
        for (const pattern of ONBOARDING_SIGNALS.patterns) {
          if (pattern.test(content)) {
            matched.add('onboarding');
            break;
          }
        }
      }
    }
  }

  return Array.from(matched);
}
