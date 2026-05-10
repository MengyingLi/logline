export interface AcceptedEvent {
  eventName: string;
  file: string;
  prNumber: number;
  timestamp: string;
}

export interface RejectedEvent {
  eventName: string;
  file: string;
  prNumber: number;
  reason?: string;
  timestamp: string;
}

export interface RepoFeedback {
  repoFullName: string;
  accepted: AcceptedEvent[];
  rejected: RejectedEvent[];
}
