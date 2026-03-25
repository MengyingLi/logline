import { loadConventions, getConventionsDir } from './loader';
import { matchConventionsToCodebase } from './matcher';
import { computeConventionCoverage } from './coverage';
import type { LoadedConventions } from './loader';
import type { ConventionDomain } from './matcher';

export type { Convention, ConventionEvent, ConventionAttribute, ConventionLifecycle } from './types';
export type { LoadedConventions } from './loader';
export type { ConventionDomain } from './matcher';
export type { ConventionCoverage, ConventionMatchedEvent, ConventionMissingEvent } from './coverage';

export { loadConventions, getConventionsDir };
export { matchConventionsToCodebase };
export { computeConventionCoverage };
