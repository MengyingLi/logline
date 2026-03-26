import type { FileContent, TrackingPlanContext } from '../types';
import { extractTrackingPlanContext } from '../context/actor-object-extractor';

export function extractContext(files: FileContent[]): TrackingPlanContext {
  return extractTrackingPlanContext(files);
}

