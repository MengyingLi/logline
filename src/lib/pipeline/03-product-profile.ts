import type { FileContent, ProductProfile } from '../types';
import { BusinessReasoner } from '../analyzers/business-reasoner';

export async function analyzeProduct(args: {
  apiKey: string | undefined;
  files: FileContent[];
  existingEventNames: string[];
  entities: string[];
  verbose?: boolean;
}): Promise<ProductProfile> {
  if (!args.apiKey) {
    return {
      mission: 'Not analyzed (OPENAI_API_KEY not set)',
      valueProposition: 'Not analyzed (OPENAI_API_KEY not set)',
      businessGoals: [],
      userPersonas: [],
      keyMetrics: [],
      confidence: 0,
    };
  }

  const reasoner = new BusinessReasoner({ apiKey: args.apiKey });
  const codebaseSummary = reasoner.generateCodebaseSummary(
    args.files,
    args.entities.map((e) => ({ name: e }))
  );

  return await reasoner.analyzeProduct({
    codebaseSummary,
    existingEvents: args.existingEventNames,
    entities: args.entities,
    verbose: Boolean(args.verbose),
  });
}
