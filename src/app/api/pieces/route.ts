import { NextRequest, NextResponse } from 'next/server'
import { client } from '@/sanity/lib/client'
import { groq } from 'next-sanity'

// Create a write client with token
const writeClient = client.withConfig({
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
})

// Helper function to get base URL
function getBaseUrl() {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`
  }
  if (process.env.NODE_ENV === 'development') {
    return 'http://localhost:3000'
  }
  return ''
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { pieceId, status, summary } = body

    if (!pieceId) {
      return NextResponse.json({ error: 'Piece ID is required' }, { status: 400 })
    }

    // If we're updating the summary
    if (summary !== undefined) {
      const result = await writeClient
        .patch(pieceId)
        .set({ summary })
        .commit()

      return NextResponse.json(result)
    }

    // If we're updating the status
    if (status) {
      // First, fetch the full piece data before updating
      const piece = await client.fetch(
        groq`*[_type == "piece" && _id == $pieceId][0]{
          _id,
          _type,
          slug,
          piece_title,
          composer,
          year_of_composition,
          era,
          summary
        }`,
        { pieceId }
      )

      if (!piece) {
        throw new Error('Piece not found')
      }

      // Generate summary if needed
      if (summary) {
        try {
          const baseUrl = process.env.VERCEL === '1' 
            ? 'https://scorereviewer.vercel.app'
            : 'http://localhost:3000'

          const response = await fetch(`${baseUrl}/api/generate-summary`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              pieceId,
              summary,
            }),
          })

          if (!response.ok) {
            const error = await response.json()
            console.error('Failed to generate summary:', error)
            // Don't fail the request if summary generation fails
          }
        } catch (error) {
          console.error('Error generating summary:', error)
          // Don't fail the request if summary generation fails
        }
      }

      // Update the piece status and summary in Sanity
      const result = await writeClient
        .patch(pieceId)
        .set({ 
          status,
          summary: summary || piece.summary
        })
        .commit()

      // Handle sheets integration
      if (status === 'reviewed') {
        try {
          // Get the full piece data
          const pieceQuery = `*[_type == "piece" && _id == $pieceId][0] {
            _id,
            _type,
            piece_title,
            composer,
            year_of_composition,
            era,
            slug,
            summary
          }`
          const pieceData = await client.fetch(pieceQuery, { pieceId })
          
          if (!pieceData) {
            console.error('Piece not found:', pieceId)
            return NextResponse.json({ error: 'Piece not found' }, { status: 404 })
          }

          // Get the piece slug
          const pieceSlug = pieceData.slug?.current

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
              action: 'add_piece',
              data: {
                _id: pieceData._id,
                _type: pieceData._type,
                piece_title: pieceData.piece_title,
                composer: pieceData.composer,
                year_of_composition: pieceData.year_of_composition,
                era: pieceData.era,
                slug: pieceData.slug,
                summary: pieceData.summary
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
      }

      return NextResponse.json(result)
    }

    return NextResponse.json({ error: 'No valid update provided' }, { status: 400 })
  } catch (error) {
    console.error('Error updating piece:', error)
    return NextResponse.json({ 
      error: 'Failed to update piece',
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
    const result = await writeClient
      .patch(editionId)
      .set({ status })
      .commit()

    // Handle sheets integration based on status
    if (status === 'approved') {
      // Fetch the full edition data
      const edition = await client.fetch(
        groq`*[_type == "edition" && _id == $editionId][0]{
          _id,
          _type,
          slug,
          editor,
          publisher,
          copyright,
          url,
          piece->{
            _id,
            _type,
            slug,
            piece_title,
            composer,
            year_of_composition,
            era,
            summary
          }
        }`,
        { editionId }
      )

      if (!edition) {
        throw new Error('Edition not found after update')
      }

      // Add to sheets
      const baseUrl = getBaseUrl()
      const sheetsResponse = await fetch(`${baseUrl}/api/sheets`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'add_edition',
          data: edition,
        }),
      })

      if (!sheetsResponse.ok) {
        const error = await sheetsResponse.json()
        console.error('Failed to add edition to sheets:', error)
        throw new Error('Failed to add edition to sheets')
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
      const baseUrl = getBaseUrl()
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