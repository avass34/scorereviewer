import { createClient } from '@sanity/client'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { parse } from 'csv-parse/sync'

// Load environment variables
dotenv.config({ path: '.env.local' })

// Log environment variables (without token)
console.log('Environment variables loaded:', {
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET,
  hasToken: !!process.env.SANITY_API_TOKEN
})

interface CsvRow {
  piece_title: string
  composer: string
  year_of_composition: string
  era: string
  piece_slug: string
}

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET!,
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
  apiVersion: '2024-02-20',
})

// Helper function to clean year string
function cleanYear(yearStr: string): number | null {
  if (!yearStr) return null
  
  // Extract first year from ranges like "1890-91" or "1887 (February)*"
  const match = yearStr.match(/\d{4}/)
  if (match) {
    const year = parseInt(match[0])
    if (year >= 1000 && year <= new Date().getFullYear()) {
      return year
    }
  }
  return null
}

// Helper function to clean composer name
function cleanComposerName(name: string): string {
  // Remove the ", FirstName" pattern but preserve special characters
  return name.replace(/,.*$/, '').trim()
}

async function deleteAllPieces() {
  try {
    console.log('Deleting all existing pieces...')
    const query = `*[_type == "piece"]._id`
    const ids = await client.fetch(query)
    
    if (ids.length === 0) {
      console.log('No existing pieces found to delete')
      return
    }

    console.log(`Found ${ids.length} existing pieces to delete`)
    
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
    
    console.log('Successfully deleted all existing pieces')
  } catch (error) {
    console.error('Error deleting pieces:', {
      error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })
    throw error
  }
}

async function importPieces() {
  try {
    // First delete all existing pieces
    await deleteAllPieces()

    console.log('Starting import process...')
    const csvPath = path.join(process.cwd(), 'data', 'unique_pieces.csv')
    console.log('Reading CSV file from:', csvPath)
    
    const fileContent = fs.readFileSync(csvPath, { encoding: 'utf-8' })
    console.log('CSV file read successfully')
    
    const rows = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
    }) as CsvRow[]

    console.log(`Found ${rows.length} pieces to import`)
    console.log('First row sample:', rows[0])

    const batchSize = 50
    let processed = 0

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      console.log(`\nProcessing batch ${i / batchSize + 1} (${i + 1} to ${i + batch.length} of ${rows.length})`)
      
      const transaction = client.transaction()

      for (const row of batch) {
        const year = cleanYear(row.year_of_composition)
        const composer = cleanComposerName(row.composer)

        const doc = {
          _type: 'piece',
          piece_title: row.piece_title,
          composer: composer,
          year_of_composition: year,
          era: row.era,
          slug: {
            _type: 'slug',
            current: row.piece_slug
          }
        }

        // Log a sample document to verify UTF-8 handling
        if (processed === 0) {
          console.log('Sample document:', JSON.stringify(doc, null, 2))
        }

        transaction.create(doc)
      }

      try {
        console.log(`Committing batch ${i / batchSize + 1}...`)
        const result = await transaction.commit()
        console.log(`Batch ${i / batchSize + 1} committed successfully:`, {
          transactionId: result.transactionId,
          documentCount: result.results.length
        })
        processed += batch.length
        console.log(`Processed ${processed}/${rows.length} pieces`)
      } catch (error) {
        console.error(`Error processing batch starting at index ${i}:`, {
          error,
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        })
        throw error // Re-throw to stop the process on error
      }
    }

    console.log(`Successfully imported ${processed} pieces`)
  } catch (error) {
    console.error('Error importing pieces:', {
      error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    })
  }
}

console.log('Script starting...')
importPieces() 