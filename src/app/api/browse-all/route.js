import { NextResponse } from 'next/server';
import { getBrowseOverview } from '../../../backend/teamval-service';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const region = searchParams.get('region') || '';
    const map = searchParams.get('map') || '';

    const payload = await getBrowseOverview({ region, map });
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[teamval] browse-all route error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to load region overview.' },
      { status: error.status || 500 }
    );
  }
}
