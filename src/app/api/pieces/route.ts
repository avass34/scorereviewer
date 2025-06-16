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
    const { pieceId, status } = body

    console.log('Updating piece:', {
      pieceId,
      status,
    })

    const patch = client.patch(pieceId).set({
      status,
    })

    const updatedPiece = await patch.commit()
    console.log('Piece updated successfully:', {
      id: updatedPiece._id,
      status: updatedPiece.status,
    })
    
    return NextResponse.json(updatedPiece)
  } catch (error) {
    console.error('Error updating piece:', error)
    return NextResponse.json({ error: 'Failed to update piece' }, { status: 500 })
  }
} 