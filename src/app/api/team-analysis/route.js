import { NextResponse } from 'next/server';
import { getTeamAnalysis } from '../../../backend/teamval-service';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const region = searchParams.get('region') || '';
    const map = searchParams.get('map') || '';
    const team = searchParams.get('team') || '';

    const payload = await getTeamAnalysis({ region, map, team });
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[teamval] team-analysis route error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to load team analysis.' },
      { status: 500 }
    );
  }
}
