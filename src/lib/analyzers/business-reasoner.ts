/**
 * Business Reasoner: Analyzes product mission, website, and business goals.
 * Adapted from logline_old/packages/agent-core/src/reasoning/business-reasoner.ts
 */

import type { FileContent, ProductProfile } from '../types';
import { llmCall } from '../utils/llm';

export interface ICodeIndexer {
  search(
    query: string,
    limit: number
  ): Promise<Array<{ score: number; chunk: { type: 'file'; file: string; code: string } }>>;
}

const LIMITS = {
  MAX_SEMANTIC_SEARCH_RESULTS_BUSINESS: 8,
  MAX_FILES_SUMMARY: 6,
};

export interface BusinessReasonerConfig {
  apiKey: string;
  model?: string;
}

export class BusinessReasoner {
  private apiKey: string;
  private model: string;

  constructor(config: BusinessReasonerConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4o-mini';
  }

  async analyzeProduct(context: {
    codebaseSummary?: string;
    missionStatement?: string;
    websiteContent?: string;
    existingEvents?: string[];
    entities?: string[];
    codeIndexer?: ICodeIndexer;
    verbose?: boolean;
  }): Promise<ProductProfile> {
    try {
      if (context.codeIndexer && !context.codebaseSummary) {
        try {
          context.codebaseSummary = await this.generateCodebaseSummaryFromIndex(context.codeIndexer);
        } catch (error) {
          // Fall through to prompt without semantic summary
        }
      }

      const prompt = this.buildAnalysisPrompt(context);
      const parsed = await llmCall<Partial<ProductProfile>>({
        apiKey: this.apiKey,
        system:
          "You are an expert product analyst. Analyze the provided information to understand the product's mission, business goals, and key metrics. Return only valid JSON.",
        prompt,
        model: this.model,
        temperature: 0.3,
        verbose: Boolean(context.verbose),
        fallback: {},
      });
      return {
        mission: parsed.mission || 'Not specified',
        valueProposition: parsed.valueProposition || 'Not specified',
        businessGoals: parsed.businessGoals || [],
        userPersonas: parsed.userPersonas || [],
        keyMetrics: parsed.keyMetrics || [],
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      };
    } catch (error) {
      return {
        mission: 'Not analyzed',
        valueProposition: 'Not analyzed',
        businessGoals: [],
        userPersonas: [],
        keyMetrics: [],
        confidence: 0,
      };
    }
  }

  generateCodebaseSummary(files: FileContent[], entities?: Array<{ name: string }>): string {
    const summary: string[] = [];

    const readme = files.find((f) => f.path.toLowerCase().includes('readme'));
    if (readme) {
      summary.push(
        `README:\n${readme.content.substring(0, 2000)}${readme.content.length > 2000 ? '...' : ''}`
      );
    }

    const packageJson = files.find((f) => f.path === 'package.json');
    if (packageJson) {
      try {
        const pkg = JSON.parse(packageJson.content) as { name?: string; description?: string };
        if (pkg.name) summary.push(`\nProject name: ${pkg.name}`);
        if (pkg.description) summary.push(`Description: ${pkg.description}`);
      } catch {
        // ignore
      }
    }

    if (entities && entities.length > 0) {
      summary.push(`\nDetected entities: ${entities.map((e) => e.name).join(', ')}`);
    }

    const apiRoutes = files
      .filter((f) => f.path.includes('/api/') || f.path.includes('/routes/'))
      .map((f) => f.path)
      .slice(0, 20);
    if (apiRoutes.length > 0) {
      summary.push(`\nAPI routes/endpoints: ${apiRoutes.join(', ')}`);
    }

    const keyFiles = files
      .filter(
        (f) =>
          !f.path.includes('node_modules') &&
          !f.path.includes('.git') &&
          (f.path.includes('/types/') ||
            f.path.includes('/models/') ||
            f.path.includes('/components/') ||
            f.path.includes('/pages/'))
      )
      .map((f) => f.path)
      .slice(0, 30);
    if (keyFiles.length > 0) {
      summary.push(`\nKey files: ${keyFiles.join(', ')}`);
    }

    return summary.join('\n');
  }

  private async generateCodebaseSummaryFromIndex(codeIndexer: ICodeIndexer): Promise<string> {
    const searchQueries = [
      'README project description mission purpose',
      'package.json project name description',
      'main entry point core functionality',
      'API routes endpoints business logic',
      'data models entities domain',
    ];

    const relevantChunks: Array<{ file: string; code: string; score: number }> = [];
    const allResults = await Promise.all(
      searchQueries.map(async (query) => {
        try {
          const results = await codeIndexer.search(query, LIMITS.MAX_SEMANTIC_SEARCH_RESULTS_BUSINESS);
          return results
            .filter((r) => r.chunk.type === 'file')
            .map((r) => ({ file: r.chunk.file, code: r.chunk.code, score: r.score }));
        } catch {
          return [];
        }
      })
    );

    for (const results of allResults) relevantChunks.push(...results);
    relevantChunks.sort((a, b) => b.score - a.score);

    const uniqueFiles = new Map<string, string>();
    for (const chunk of relevantChunks) {
      if (!uniqueFiles.has(chunk.file)) uniqueFiles.set(chunk.file, chunk.code);
    }

    const summary: string[] = [];
    let count = 0;
    for (const [file, code] of uniqueFiles.entries()) {
      if (count >= LIMITS.MAX_FILES_SUMMARY) break;
      summary.push(`\n${file}:\n${code.substring(0, 1000)}${code.length > 1000 ? '...' : ''}`);
      count++;
    }

    return summary.join('\n\n');
  }

  private buildAnalysisPrompt(context: {
    codebaseSummary?: string;
    missionStatement?: string;
    websiteContent?: string;
    existingEvents?: string[];
    entities?: string[];
  }): string {
    let prompt = `Analyze the following product information to generate a comprehensive product profile.\n\n`;

    if (context.missionStatement) {
      prompt += `Mission Statement:\n${context.missionStatement}\n\n`;
    }
    if (context.websiteContent) {
      const w = context.websiteContent;
      prompt += `Website Content:\n${w.substring(0, 3000)}${w.length > 3000 ? '...' : ''}\n\n`;
    }
    if (context.codebaseSummary) {
      prompt += `Codebase Summary:\n${context.codebaseSummary}\n\n`;
    }
    if (context.existingEvents && context.existingEvents.length > 0) {
      const shown = context.existingEvents.slice(0, 20);
      prompt += `Existing Analytics Events:\n${shown.join(', ')}${
        context.existingEvents.length > 20 ? `... and ${context.existingEvents.length - 20} more` : ''
      }\n\n`;
    }
    if (context.entities && context.entities.length > 0) {
      prompt += `Detected Domain Entities:\n${context.entities.join(', ')}\n\n`;
    }

    prompt += `Based on the information above, provide a comprehensive product profile.\n\nIMPORTANT: Avoid generic descriptions. Be specific about what this product actually does based on the codebase, entities, and API routes you see.\n\nFormat your response as JSON:\n{\n  \"mission\": \"Core mission statement\",\n  \"valueProposition\": \"Primary value proposition\",\n  \"businessGoals\": [\"goal1\", \"goal2\"],\n  \"userPersonas\": [\"persona1\", \"persona2\"],\n  \"keyMetrics\": [\"metric1\", \"metric2\"],\n  \"confidence\": 0.0\n}`;

    return prompt;
  }
}

