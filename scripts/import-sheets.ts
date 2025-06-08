import { createClient } from '@sanity/client'
import { parse } from 'csv-parse'
import { createReadStream } from 'fs'
import dotenv from 'dotenv'
import path from 'path'

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' })

// Verify environment variables are loaded
if (!process.env.NEXT_PUBLIC_SANITY_PROJECT_ID) {
  throw new Error('NEXT_PUBLIC_SANITY_PROJECT_ID is not set in .env.local')
}
if (!process.env.NEXT_PUBLIC_SANITY_DATASET) {
  throw new Error('NEXT_PUBLIC_SANITY_DATASET is not set in .env.local')
}
if (!process.env.SANITY_API_TOKEN) {
  throw new Error('SANITY_API_TOKEN is not set in .env.local')
}

// Define types for our documents
interface SanityScore {
  _id: string
  _type: 'score'
  pieceName: string
  composerName: string
  language: string
  summary?: string
  status: 'approved' | 'rejected' | 'unreviewed'
  slug: {
    _type: 'slug'
    current: string
  }
  editor?: string
  publisher?: string
  copyright?: string
  scoreUrl?: string
  reviewedAt?: string
}

interface CsvRow {
  composer: string            // CSV: "composer"
  piece_title: string        // CSV: "piece_title"
  publisher: string          // CSV: "publisher"
  year_of_composition: string // CSV: "year_of_composition"
  era: string               // CSV: "era"
  copyright: string         // CSV: "copyright"
  editor: string           // CSV: "editor"
  url: string              // CSV: "url"
  [key: string]: string    // Allow string indexing
}

interface SanityDocument {
  _id: string
  _type: string
}

// Initialize Sanity client
const sanityClient = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET!,
  token: process.env.SANITY_API_TOKEN!, // Make sure this is set in .env.local
  apiVersion: '2023-05-03',
  useCdn: false,
})

// Helper function to create slug
function createSlug(text: string): string {
  // Generate a random 4-character string
  const randomStr = Math.random().toString(36).substring(2, 6)
  
  // Create the base slug
  const baseSlug = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  // Append the random string
  return `${baseSlug}-${randomStr}`
}

// Track the last used ID
let currentId = 0

// Helper function to create a unique ID
function createUniqueId(): string {
  currentId++
  return `imported-${currentId.toString().padStart(6, '0')}`
}

// Helper function to clean composer name
function cleanComposerName(composer: string): string {
  // Remove ", FirstName" pattern and any extra whitespace
  // Preserve UTF-8 characters
  return composer.split(',')[0].trim()
}

async function readCsvFile(filePath: string): Promise<CsvRow[]> {
  return new Promise((resolve, reject) => {
    const results: CsvRow[] = []
    createReadStream(filePath, { encoding: 'utf8' }) // Explicitly set UTF-8 encoding
      .pipe(parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        encoding: 'utf8', // Ensure CSV parser uses UTF-8
        bom: true // Handle UTF-8 BOM if present
      }))
      .on('data', (data: CsvRow) => {
        // Ensure all string fields are properly decoded
        Object.keys(data).forEach(key => {
          if (typeof data[key] === 'string') {
            data[key] = data[key].normalize('NFC') // Normalize Unicode composition
          }
        })
        results.push(data)
      })
      .on('end', () => resolve(results))
      .on('error', reject)
  })
}

async function createSanityDocuments(documents: SanityScore[]) {
  // Create a transaction with properly typed mutations
  const transaction = documents.reduce((tx, doc) => {
    return tx.create(doc) // Changed from createIfNotExists to create
  }, sanityClient.transaction())

  return transaction.commit()
}

async function deleteAllScores() {
  console.log('Deleting all existing scores...')
  try {
    // Query for all score documents
    const query = '*[_type == "score"]'
    const scores = await sanityClient.fetch<SanityDocument[]>(query)
    console.log(`Found ${scores.length} existing scores to delete`)

    if (scores.length === 0) {
      console.log('No existing scores to delete')
      return
    }

    // Create a transaction to delete all scores
    const transaction = scores.reduce((tx: any, score: SanityDocument) => {
      return tx.delete(score._id)
    }, sanityClient.transaction())

    await transaction.commit()
    console.log('Successfully deleted all existing scores')
  } catch (error) {
    console.error('Error deleting scores:', error)
    throw error
  }
}

async function importData() {
  try {
    // Delete all existing scores first
    await deleteAllScores()

    // Reset the ID counter
    currentId = 0

    // Read the CSV file
    console.log('Reading CSV file...')
    const csvPath = path.join(process.cwd(), 'data', 'scores.csv')
    const rows = await readCsvFile(csvPath)
    console.log(`Found ${rows.length} rows in CSV`)

    // Log first row to verify UTF-8 handling
    if (rows.length > 0) {
      console.log('Sample row with potential UTF-8 characters:', JSON.stringify(rows[0], null, 2))
    }

    // Convert to Sanity documents
    const documents: SanityScore[] = []
    const batchSize = 50 // Adjust based on your needs
    let processed = 0

    for (const row of rows) {
      // Clean up composer name to remove the ", FirstName" pattern
      const composerName = cleanComposerName(row.composer)
      // Create slug from normalized text (for URL compatibility)
      const slug = createSlug(`${composerName}-${row.piece_title}`)
      
      // Create the document with a simple sequential ID
      const doc: SanityScore = {
        _id: createUniqueId(),
        _type: 'score',
        pieceName: row.piece_title,
        composerName: row.composer,
        language: 'French',
        status: 'unreviewed',
        slug: {
          _type: 'slug',
          current: slug
        },
        // Only add editor if it's not empty and not 'nan'
        ...(row.editor && row.editor.trim() !== '' && row.editor.toLowerCase() !== 'nan' && { editor: row.editor.trim() }),
        publisher: row.publisher,
        copyright: row.copyright,
        scoreUrl: row.url
      }

      // Log the first few documents to verify data
      if (processed < 2) {
        console.log('Sample document:', JSON.stringify(doc, null, 2))
      }

      documents.push(doc)

      // Process in batches
      if (documents.length >= batchSize) {
        console.log(`Creating batch of ${documents.length} documents...`)
        await createSanityDocuments(documents)
        processed += documents.length
        console.log(`Processed ${processed} documents`)
        documents.length = 0 // Clear the array
      }
    }

    // Process remaining documents
    if (documents.length > 0) {
      console.log(`Creating final batch of ${documents.length} documents...`)
      await createSanityDocuments(documents)
      processed += documents.length
    }

    console.log(`Import completed. Total documents processed: ${processed}`)
  } catch (error) {
    console.error('Import failed:', error)
  }
}

// Run the import
importData().catch(console.error) 