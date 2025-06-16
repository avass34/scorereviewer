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
  score_url: string
  score_type: string
  score_notes: string
}

const client = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET!,
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
  apiVersion: '2024-02-20',
})

function cleanYear(yearStr: string): number | null {
  if (!yearStr) return null
  const match = yearStr.match(/\d{4}/)
  if (match) {
    const year = parseInt(match[0])
    if (year >= 1000 && year <= new Date().getFullYear()) {
      return year
    }
  }
  return null
}

async function uploadTestScores() {
  try {
    console.log('Starting test upload...')
    const csvPath = path.join(process.cwd(), 'data', 'unique_pieces.csv')
    console.log('Reading CSV file from:', csvPath)
    
    const fileContent = fs.readFileSync(csvPath, { encoding: 'utf-8' })
    console.log('CSV file read successfully')
    
    const rows = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
    }) as CsvRow[]

    // Take only first 10 rows
    const testRows = rows.slice(0, 10)
    console.log(`Processing ${testRows.length} test rows`)
    console.log('First row sample:', testRows[0])

    const transaction = client.transaction()

    for (const row of testRows) {
      const year = cleanYear(row.year_of_composition)
      const doc = {
        _type: 'score',
        piece_title: row.piece_title,
        composer: row.composer,
        year_of_composition: year,
        era: row.era,
        piece_slug: row.piece_slug,
        score_url: row.score_url,
        score_type: row.score_type,
        score_notes: row.score_notes || '',
      }
      transaction.create(doc)
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