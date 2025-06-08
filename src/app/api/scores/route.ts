import { createClient } from '@sanity/client'
import { NextRequest, NextResponse } from 'next/server'

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  useCdn: false,
  token: process.env.SANITY_API_TOKEN,
  apiVersion: '2024-02-20',
})

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { scoreId, status, rejectionReason, scoreUrl, reviewedAt, summary } = body

    console.log('Updating score:', {
      scoreId,
      status,
      hasRejectionReason: !!rejectionReason,
      hasScoreUrl: !!scoreUrl,
      hasReviewedAt: !!reviewedAt,
      hasSummary: !!summary
    })

    const patch = client.patch(scoreId).set({
      ...(status && { status }),
      ...(reviewedAt && { reviewedAt }),
      ...(rejectionReason && { rejectionReason }),
      ...(scoreUrl && { scoreUrl }),
      ...(summary && { summary })
    })

    const updatedScore = await patch.commit()
    console.log('Score updated successfully:', {
      id: updatedScore._id,
      status: updatedScore.status,
      summary: updatedScore.summary?.substring(0, 50) + '...'
    })
    
    return NextResponse.json(updatedScore)
  } catch (error) {
    console.error('Error updating score:', error)
    return NextResponse.json({ error: 'Failed to update score' }, { status: 500 })
  }
} 