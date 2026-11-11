// Vote « j'aime / je n'aime pas » du composant `FeedbackVote` : POST
// `{ vote: 'like' | 'dislike' }`, une ligne de plus dans `user_feedback` par vote,
// sans rien d'autre sur le votant.
import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { feedbackRateLimit, getClientIp } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  const { success } = await feedbackRateLimit.limit(getClientIp(request));
  if (!success) return NextResponse.json({ error: 'rate_limit' }, { status: 429 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const vote = (body as Record<string, unknown>)?.vote;
  if (vote !== 'like' && vote !== 'dislike') {
    return NextResponse.json({ error: 'invalid_vote' }, { status: 400 });
  }

  try {
    await sql`insert into user_feedback ${sql({ vote })}`;
  } catch (error) {
    console.error('[feedback]', (error as Error).message);
    return NextResponse.json({ error: 'db_error' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
