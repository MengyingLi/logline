import type { FileContent, ProductProfile } from '../types';
import { BusinessReasoner } from '../analyzers/business-reasoner';
import { fetchWebsiteContent } from '../utils/website-fetcher';
import { getLLMApiKey } from '../utils/llm';

export async function analyzeProduct(args: {
  apiKey: string | undefined;
  files: FileContent[];
  existingEventNames: string[];
  entities: string[];
  websiteUrl?: string;
  description?: string;
  verbose?: boolean;
}): Promise<ProductProfile> {
  const llm = getLLMApiKey();
  const apiKey = args.apiKey ?? llm?.key;

  if (!apiKey) {
    return {
      mission: 'Not analyzed (no LLM API key set)',
      valueProposition: 'Not analyzed (no LLM API key set)',
      businessGoals: [],
      userPersonas: [],
      keyMetrics: [],
      confidence: 0,
    };
  }

  const reasoner = new BusinessReasoner({ apiKey });
  const codebaseSummary = reasoner.generateCodebaseSummary(
    args.files,
    args.entities.map((e) => ({ name: e }))
  );

  // Fetch website content if a URL was provided — best-effort, never blocks scan
  let websiteContent: string | undefined;
  if (args.websiteUrl) {
    try {
      websiteContent = await fetchWebsiteContent(args.websiteUrl);
    } catch {
      // silently skip — a failed fetch should never break a scan
    }
  }

  return await reasoner.analyzeProduct({
    codebaseSummary,
    websiteContent,
    missionStatement: args.description,
    existingEvents: args.existingEventNames,
    entities: args.entities,
    verbose: Boolean(args.verbose),
  });
}
