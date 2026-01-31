/**
 * Style Learner: Integrates with analyzer to learn and store style preferences
 * 
 * Note: FrameworkDetector is used at runtime, but not needed at compile time
 * to avoid circular dependencies. The StyleLearner can be instantiated separately.
 */

import { SemanticMemoryStore } from './semantic';
import { LoggingPattern, StylePreferences } from '@logline/types';

export class StyleLearner {
  constructor(
    private semanticMemory: SemanticMemoryStore,
    private frameworkDetector?: any // FrameworkDetector - injected to avoid circular deps
  ) {}

  /**
   * Learn style preferences from codebase analysis
   */
  async learnFromCodebase(repoId: string, codebasePath: string): Promise<void> {
    if (!this.frameworkDetector) {
      throw new Error('FrameworkDetector must be provided');
    }
    // Detect frameworks
    const patterns = await this.frameworkDetector.analyzeCodebase(codebasePath);
    
    // Learn each pattern
    for (const pattern of patterns) {
      this.semanticMemory.learnLoggingPattern(repoId, pattern);
    }

    // Detect style preferences (would analyze code files)
    // For now, using default detection from sample code
    // In production, would analyze multiple files to build consensus
  }

  /**
   * Learn style from a single file
   */
  learnFromFile(repoId: string, code: string, filePath: string): void {
    if (!this.frameworkDetector) {
      throw new Error('FrameworkDetector must be provided');
    }
    // Detect framework
    const detections = this.frameworkDetector.detectFramework(code, filePath);
    for (const detection of detections) {
      this.semanticMemory.learnLoggingPattern(repoId, detection.pattern);
    }

    // Detect style preferences
    const preferences = this.frameworkDetector.detectStylePreferences(code);
    this.semanticMemory.learnStylePreferences(repoId, preferences);
  }

  /**
   * Get learned style for a repository
   */
  getLearnedStyle(repoId: string): {
    pattern: LoggingPattern | null;
    preferences: StylePreferences;
  } {
    const pattern = this.semanticMemory.getPrimaryLoggingPattern(repoId);
    const preferences = this.semanticMemory.getStylePreferences(repoId);
    
    return { pattern, preferences };
  }
}
