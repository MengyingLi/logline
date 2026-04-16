import axios from 'axios';
import pino from 'pino';

const logger = pino();

// Error boundary: try/catch around a critical operation
export async function processWorkflow(workflowId: string) {
  try {
    const result = await executeWorkflowSteps(workflowId);
    return result;
  } catch (error) {
    logger.error({ workflowId, error }, 'workflow processing failed');
    throw error;
  }
}

// API call: outbound HTTP
export async function syncWorkflowToExternalService(workflowId: string) {
  const response = await axios.post('https://api.external-service.com/workflows', {
    id: workflowId,
  });
  return response.data;
}

// Also test fetch
export async function fetchUserProfile(userId: string) {
  const data = await fetch(`https://api.example.com/users/${userId}`);
  return data.json();
}

// Retry logic
export async function executeWithRetry(fn: () => Promise<any>, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt >= maxRetries) throw error;
      await withRetry(fn, { retries: maxRetries - attempt });
    }
  }
}

async function executeWorkflowSteps(workflowId: string) {
  return { workflowId, status: 'completed' };
}

async function withRetry(fn: () => Promise<any>, opts: { retries: number }) {
  return fn();
}
