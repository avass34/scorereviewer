import { createClient } from '@sanity/client'
import dotenv from 'dotenv'

// Load environment variables
dotenv.config({ path: '.env.local' })

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET!,
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
  apiVersion: '2024-02-20',
})

async function deleteAllScores() {
  try {
    console.log('Deleting all existing scores...')
    const query = `*[_type == "score"]._id`
    const ids = await client.fetch(query)
    
    if (ids.length === 0) {
      console.log('No existing scores found to delete')
      return
    }

    console.log(`Found ${ids.length} existing scores to delete`)
    
    // Delete in batches of 50
    const batchSize = 50
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize)
      const transaction = client.transaction()
      
      batch.forEach((id: string) => {
        transaction.delete(id)
      })

      try {
        console.log(`Deleting batch ${Math.floor(i / batchSize) + 1}...`)
        const result = await transaction.commit()
        console.log(`Deleted batch ${Math.floor(i / batchSize) + 1} successfully`)
      } catch (error) {
        console.error(`Error deleting batch starting at index ${i}:`, {
          error,
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        })
        throw error
      }
    }
    
    console.log('Successfully deleted all existing scores')
  } catch (error) {
    console.error('Error deleting scores:', {
      error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })
    throw error
  }
}

async function uploadTestScores() {
  try {
    // First delete all existing scores
    await deleteAllScores()
    
    console.log('Starting test upload...')
    
    const testScores = [
      {
        _type: 'score',
        pieceName: 'Test Score 1',
        composerName: 'Test Composer 1',
        slug: {
          _type: 'slug',
          current: 'test-score-1'
        },
        scoreUrl: 'https://example.com/score1.pdf',
        scoreS3Url: 'https://s3.example.com/score1.pdf',
        editor: 'Test Editor',
        publisher: 'Test Publisher',
        language: 'English',
        copyright: '© 2024',
        summary: 'This is a test score summary',
        status: 'pending',
        reviewedAt: new Date().toISOString()
      },
      {
        _type: 'score',
        pieceName: 'Test Score 2',
        composerName: 'Test Composer 2',
        slug: {
          _type: 'slug',
          current: 'test-score-2'
        },
        scoreUrl: 'https://example.com/score2.pdf',
        scoreS3Url: 'https://s3.example.com/score2.pdf',
        editor: 'Test Editor 2',
        publisher: 'Test Publisher 2',
        language: 'French',
        copyright: '© 2024',
        summary: 'This is another test score summary',
        status: 'pending',
        reviewedAt: new Date().toISOString()
      }
    ]

    const transaction = client.transaction()

    for (const score of testScores) {
      transaction.create(score)
    }

    try {
      console.log('Committing test scores...')
      const result = await transaction.commit()
      console.log('Test scores committed successfully:', {
        transactionId: result.transactionId,
        documentCount: result.results.length
      })
    } catch (error) {
      console.error('Error committing test scores:', {
        error,
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      })
      throw error
    }

  } catch (error) {
    console.error('Error in test upload:', {
      error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })
  }
}

console.log('Test script starting...')
uploadTestScores() 