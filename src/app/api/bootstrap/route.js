import { NextResponse } from 'next/server';
import { getBootstrapPayload } from '../../../backend/teamval-service';

export async function GET() {
  try {
    const payload = await getBootstrapPayload();
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[teamval] bootstrap route error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to load bootstrap data.' },
      { status: 500 }
    );
  }
}
