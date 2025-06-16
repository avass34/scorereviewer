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
    const { editionId, status, rejectionReason, reviewedAt } = body

    console.log('Updating edition:', {
      editionId,
      status,
      hasRejectionReason: !!rejectionReason,
      hasReviewedAt: !!reviewedAt,
    })

    const patch = client.patch(editionId).set({
      status,
      ...(rejectionReason && { rejectionReason }),
      ...(reviewedAt && { reviewedAt }),
    })

    const updatedEdition = await patch.commit()
    console.log('Edition updated successfully:', {
      id: updatedEdition._id,
      status: updatedEdition.status,
    })
    
    return NextResponse.json(updatedEdition)
  } catch (error) {
    console.error('Error updating edition:', error)
    return NextResponse.json({ error: 'Failed to update edition' }, { status: 500 })
  }
} 