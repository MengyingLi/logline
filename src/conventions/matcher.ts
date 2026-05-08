import type { FileContent } from '../lib/types';

// ─── Signal definitions ───────────────────────────────────────────────────────

interface DomainSignals {
  paths: string[];
  components: string[];
  patterns: RegExp[];
}

const SIGNALS: Record<string, DomainSignals> = {

  onboarding: {
    paths: ['signup', 'register', 'registration', 'onboarding', 'welcome', 'getting-started', 'verify', 'verification', 'confirm-email', 'auth/signup'],
    components: ['SignupForm', 'SignupPage', 'RegistrationPage', 'RegistrationForm', 'OnboardingWizard', 'OnboardingStep', 'OnboardingFlow', 'WelcomePage', 'VerifyEmail', 'ConfirmEmail'],
    patterns: [
      /signUp|sign_up|createUser|create_user/i,
      /verifyEmail|verify_email|confirmEmail|confirm_email/i,
      /verification[-_]?token|emailVerification/i,
      /supabase\.auth\.signUp|firebase\.auth\(\)\.createUser/i,
      /Auth0|Clerk|getAuth|useAuth/i,
      /currentStep|nextStep|stepIndex|step_index|onboardingStep/i,
      /stepper|wizard|multiStep|multi_step/i,
    ],
  },

  billing: {
    paths: ['billing', 'subscription', 'checkout', 'payment', 'pricing', 'plan', 'upgrade', 'invoice', 'stripe'],
    components: ['BillingPage', 'SubscriptionCard', 'PricingTable', 'CheckoutForm', 'UpgradeModal', 'PlanSelector', 'PaymentForm', 'BillingSettings', 'SubscriptionPage'],
    patterns: [
      /stripe|paddle|lemon.?squeezy|braintree|recurly|chargebee/i,
      /createCheckoutSession|createSubscription|billing.?portal|customer\.portal/i,
      /trial.*start|trial.*end|subscription.*created|plan.*upgrade/i,
      /payment_intent|paymentIntent|invoice\.paid|subscription\.updated/i,
      /dunning|mrr|arr|churn|ltv|lifetime.?value/i,
    ],
  },

  search: {
    paths: ['search', 'results', 'query', 'filter', 'find', 'discover'],
    components: ['SearchBar', 'SearchResults', 'SearchInput', 'SearchPage', 'FilterPanel', 'ResultsList', 'SearchModal', 'CommandPalette', 'SearchDropdown'],
    patterns: [
      /useSearch|searchQuery|searchResults|searchTerm|search_term/i,
      /algolia|elasticsearch|elastic_search|typesense|meilisearch|solr|opensearch/i,
      /onSearch|handleSearch|performSearch|search\.perform/i,
      /\bq=|\bquery=|search_query|filter.*apply|facet/i,
      /zero.*result|no.*result|empty.*result|result_count\s*===?\s*0/i,
    ],
  },

  collaboration: {
    paths: ['team', 'members', 'invite', 'workspace', 'organization', 'org', 'permission', 'role', 'access'],
    components: ['TeamSettings', 'InviteModal', 'MemberList', 'RoleSelector', 'WorkspaceSettings', 'OrgSettings', 'InviteForm', 'MemberCard', 'PermissionGate'],
    patterns: [
      /inviteUser|sendInvite|invite.*email|invitation|inviteTeamMember/i,
      /workspace|team.*member|organization.*member|org.*member/i,
      /role.*change|permission.*update|access.*level|changeRole|updateRole/i,
      /addMember|removeMember|kick.*member|transfer.*ownership/i,
      /seat.*limit|seat.*count|members\.create|members\.delete/i,
    ],
  },

};

export type ConventionDomain = keyof typeof SIGNALS | string;

/**
 * Detect which convention domains are relevant to this codebase by scanning
 * file paths and content for known signals.
 *
 * Requires at least 2 distinct signal types (path, component, pattern) before
 * including a domain — prevents single-string matches from triggering
 * conventions in unrelated codebases.
 */
export function matchConventionsToCodebase(files: FileContent[]): ConventionDomain[] {
  const hits = new Map<ConventionDomain, Set<string>>();

  function addHit(domain: ConventionDomain, signalType: 'path' | 'component' | 'pattern') {
    let set = hits.get(domain);
    if (!set) { set = new Set(); hits.set(domain, set); }
    set.add(signalType);
  }

  const normPath = (p: string) => p.toLowerCase().replace(/\\/g, '/');

  for (const file of files) {
    const pathStr = normPath(file.path);
    const content = file.content;

    for (const [domain, signals] of Object.entries(SIGNALS)) {
      // Path signals
      for (const signal of signals.paths) {
        if (pathStr.includes(signal)) { addHit(domain, 'path'); break; }
      }
      // Component name signals
      for (const comp of signals.components) {
        if (content.includes(comp)) { addHit(domain, 'component'); break; }
      }
      // Code pattern signals
      for (const pattern of signals.patterns) {
        if (pattern.test(content)) { addHit(domain, 'pattern'); break; }
      }
    }
  }

  // Only include a domain if at least 2 distinct signal types matched
  const matched: ConventionDomain[] = [];
  for (const [domain, signalTypes] of hits) {
    if (signalTypes.size >= 2) matched.push(domain);
  }
  return matched;
}
