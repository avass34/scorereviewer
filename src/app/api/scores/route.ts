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
    const { scoreId, status, rejectionReason, scoreUrl, reviewedAt } = body

    const patch = client.patch(scoreId).set({
      status,
      reviewedAt: reviewedAt || new Date().toISOString(),
      ...(rejectionReason && { rejectionReason }),
      ...(scoreUrl && { scoreUrl })
    })

    const updatedScore = await patch.commit()
    return NextResponse.json(updatedScore)
  } catch (error) {
    console.error('Error updating score:', error)
    return NextResponse.json({ error: 'Failed to update score' }, { status: 500 })
  }
} 