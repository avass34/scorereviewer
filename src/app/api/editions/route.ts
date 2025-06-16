import { createClient } from '@sanity/client'
import { NextRequest, NextResponse } from 'next/server'
import { groq } from 'next-sanity'

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

    // Handle sheets integration based on status
    if (status === 'approved') {
      try {
        // Get the full edition data
        const editionQuery = `*[_type == "edition" && _id == $editionId][0] {
          _id,
          _type,
          slug,
          publisher,
          copyright,
          editor,
          url,
          "piece": *[_type == "piece" && references(^._id)][0] {
            _id,
            piece_title,
            composer,
            year_of_composition,
            era,
            slug
          }
        }`
        const editionData = await client.fetch(editionQuery, { editionId })
        
        if (!editionData) {
          console.error('Edition not found:', editionId)
          return NextResponse.json({ error: 'Edition not found' }, { status: 404 })
        }

        // Get the edition slug
        const editionSlug = editionData.slug?.current

        // Add to sheets
        const baseUrl = process.env.VERCEL === '1' 
          ? 'https://scorereviewer.vercel.app'
          : 'http://localhost:3000'

        const sheetsResponse = await fetch(`${baseUrl}/api/sheets`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'add_edition',
            data: {
              _id: editionData._id,
              _type: editionData._type,
              slug: editionData.slug,
              publisher: editionData.publisher,
              copyright: editionData.copyright,
              editor: editionData.editor,
              url: editionData.url,
              piece: editionData.piece
            }
          }),
        })

        if (!sheetsResponse.ok) {
          const errorData = await sheetsResponse.json()
          console.error('Failed to add to sheets:', errorData)
          // Don't fail the request if sheets integration fails
        }
      } catch (error) {
        console.error('Error in sheets integration:', error)
        // Don't fail the request if sheets integration fails
      }
    } else if (status === 'rejected') {
      // Fetch the edition slug
      const edition = await client.fetch(
        groq`*[_type == "edition" && _id == $editionId][0]{
          slug
        }`,
        { editionId }
      )

      if (!edition) {
        throw new Error('Edition not found after update')
      }

      // Remove from sheets
      const baseUrl = process.env.VERCEL === '1'
        ? 'https://scorereviewer.vercel.app'
        : 'http://localhost:3000'

      const sheetsResponse = await fetch(`${baseUrl}/api/sheets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'remove_edition',
          data: edition,
        }),
      })

      if (!sheetsResponse.ok) {
        const error = await sheetsResponse.json()
        console.error('Failed to remove edition from sheets:', error)
        throw new Error('Failed to remove edition from sheets')
      }
    }
    
    return NextResponse.json(updatedEdition)
  } catch (error) {
    console.error('Error updating edition:', error)
    return NextResponse.json({ 
      error: 'Failed to update edition',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { pieceId, editionId, status } = body

    if (!pieceId || !editionId || !status) {
      return NextResponse.json(
        { error: 'Piece ID, edition ID, and status are required' },
        { status: 400 }
      )
    }

    // Update the edition status
    const result = await client
      .patch(editionId)
      .set({ status })
      .commit()

    // Handle sheets integration based on status
    if (status === 'approved') {
      try {
        // Get the full edition data
        const editionQuery = `*[_type == "edition" && _id == $editionId][0] {
          _id,
          _type,
          slug,
          publisher,
          copyright,
          editor,
          url,
          "piece": *[_type == "piece" && references(^._id)][0] {
            _id,
            piece_title,
            composer,
            year_of_composition,
            era,
            slug
          }
        }`
        const editionData = await client.fetch(editionQuery, { editionId })
        
        if (!editionData) {
          console.error('Edition not found:', editionId)
          return NextResponse.json({ error: 'Edition not found' }, { status: 404 })
        }

        // Get the edition slug
        const editionSlug = editionData.slug?.current

        // Add to sheets
        const baseUrl = process.env.VERCEL === '1' 
          ? 'https://scorereviewer.vercel.app'
          : 'http://localhost:3000'

        const sheetsResponse = await fetch(`${baseUrl}/api/sheets`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'add_edition',
            data: {
              _id: editionData._id,
              _type: editionData._type,
              slug: editionData.slug,
              publisher: editionData.publisher,
              copyright: editionData.copyright,
              editor: editionData.editor,
              url: editionData.url,
              piece: editionData.piece
            }
          }),
        })

        if (!sheetsResponse.ok) {
          const errorData = await sheetsResponse.json()
          console.error('Failed to add to sheets:', errorData)
          // Don't fail the request if sheets integration fails
        }
      } catch (error) {
        console.error('Error in sheets integration:', error)
        // Don't fail the request if sheets integration fails
      }
    } else if (status === 'rejected') {
      // Fetch the edition slug
      const edition = await client.fetch(
        groq`*[_type == "edition" && _id == $editionId][0]{
          slug
        }`,
        { editionId }
      )

      if (!edition) {
        throw new Error('Edition not found after update')
      }

      // Remove from sheets
      const baseUrl = process.env.VERCEL === '1'
        ? 'https://scorereviewer.vercel.app'
        : 'http://localhost:3000'

      const sheetsResponse = await fetch(`${baseUrl}/api/sheets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'remove_edition',
          data: edition,
        }),
      })

      if (!sheetsResponse.ok) {
        const error = await sheetsResponse.json()
        console.error('Failed to remove edition from sheets:', error)
        throw new Error('Failed to remove edition from sheets')
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error updating edition:', error)
    return NextResponse.json({ 
      error: 'Failed to update edition',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  }
} 