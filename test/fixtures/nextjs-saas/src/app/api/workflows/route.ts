import { supabase } from '@/lib/supabase';

declare const analytics: { track: (name: string, props?: Record<string, unknown>) => void };

export async function POST(request: Request): Promise<Response> {
  const body = await request.json();
  // Existing tracking should be detected by inventory
  analytics.track('workflow_created', { workflow_id: body?.workflowId });

  await supabase.from('workflows').insert(body);
  return new Response(JSON.stringify({ ok: true }), { status: 201 });
}

