import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'
import { JWT } from 'google-auth-library'

// Queue system for processing approvals
class ApprovalQueue {
  private queue: Array<() => Promise<void>> = []
  private processing = false

  async add(task: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          await task()
          resolve()
        } catch (error) {
          reject(error)
        }
      })
      this.processQueue()
    })
  }

  private async processQueue() {
    if (this.processing || this.queue.length === 0) return
    
    this.processing = true
    try {
      const task = this.queue.shift()
      if (task) {
        await task()
      }
    } finally {
      this.processing = false
      if (this.queue.length > 0) {
        await this.processQueue()
      }
    }
  }
}

const approvalQueue = new ApprovalQueue()

// Define error type for Google API errors
interface GoogleAPIError extends Error {
  response?: {
    status: number;
    statusText: string;
    data: any;
  };
}

// Validate environment variables
const requiredEnvVars = {
  GOOGLE_SERVICE_ACCOUNT_EMAIL: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,
  GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID
}

// Check for missing environment variables
const missingEnvVars = Object.entries(requiredEnvVars)
  .filter(([_, value]) => !value)
  .map(([key]) => key)

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars)
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`)
}

// Initialize Google Sheets client
const auth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})

console.log('Sheets API initialized with email:', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL)

const sheets = google.sheets({ version: 'v4', auth })
const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID
const APPROVED_EDITIONS_SHEET = 'Approved Editions'
const PIECES_SHEET = 'Pieces'

console.log('Using spreadsheet ID:', SPREADSHEET_ID)

// Cache for sheet ID
let sheetId: number | null = null

// Helper function to create a slug from composer name and piece name
function createSlug(composerName: string, pieceName: string): string {
  return `${composerName}-${pieceName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric chars with hyphens
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
}

// Helper function to get sheet ID
async function getSheetId(sheetName: string): Promise<number> {
  if (sheetId !== null) return sheetId

  try {
    console.log(`Fetching sheet ID for: "${sheetName}"`)
    const response = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
    })

    console.log('Spreadsheet details:', {
      title: response.data.properties?.title,
      sheets: response.data.sheets?.map(s => s.properties?.title),
    })

    const sheet = response.data.sheets?.find(
      (s) => s.properties?.title === sheetName
    )

    if (!sheet?.properties?.sheetId) {
      console.error(`Sheet "${sheetName}" not found`)
      throw new Error(`Sheet "${sheetName}" not found`)
    }

    sheetId = sheet.properties.sheetId
    console.log(`Found sheet ID: ${sheetId}`)
    return sheetId
  } catch (error) {
    console.error(`Error getting sheet ID for "${sheetName}":`, error)
    throw error
  }
}

async function ensureSheetExists(sheetName: string, headers: string[]) {
  try {
    console.log(`Checking if sheet "${sheetName}" exists...`)
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A1:${String.fromCharCode(65 + headers.length - 1)}1`,
    })
    
    if (headerResponse.data.values) {
      console.log(`Sheet "${sheetName}" exists, headers:`, headerResponse.data.values[0])
      return
    }
  } catch (error) {
    console.log(`Sheet "${sheetName}" does not exist, will create it`)
  }

  try {
    console.log(`Creating new sheet "${sheetName}"...`)
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          addSheet: {
            properties: {
              title: sheetName,
            },
          },
        }],
      },
    })

    console.log(`Adding headers to "${sheetName}":`, headers)
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A1:${String.fromCharCode(65 + headers.length - 1)}1`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [headers],
      },
    })
    console.log('Headers added successfully')
  } catch (error) {
    console.error(`Error creating sheet "${sheetName}":`, error)
    throw error
  }
}

async function findPieceBySlug(slug: string): Promise<number | null> {
  try {
    console.log('Looking for piece with slug:', slug)
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${PIECES_SHEET}'!A:E`,
    })

    if (!response.data.values) {
      console.log('No values found in sheet')
      return null
    }

    // Get all rows including header
    const allRows = response.data.values
    console.log('Total rows in sheet:', allRows.length)

    // Find the row with exact slug match (case sensitive)
    for (let i = 1; i < allRows.length; i++) {
      const row = allRows[i]
      if (row && row[0] === slug) {
        console.log('Found existing piece at row:', i + 1, 'Row data:', row)
        return i + 1 // Return 1-based row number
      }
    }

    console.log('No existing piece found for slug:', slug)
    return null
  } catch (error) {
    console.error('Error finding piece by slug:', error)
    throw error
  }
}

async function addPieceIfNotExists(score: any): Promise<string> {
  const slug = createSlug(score.composerName, score.pieceName)
  
  try {
    // First check if piece exists - do this in a loop to handle race conditions
    let retries = 0
    const maxRetries = 3
    let existingRowIndex: number | null = null

    while (retries < maxRetries) {
      existingRowIndex = await findPieceBySlug(slug)
      
      if (existingRowIndex !== null) {
        console.log('Piece already exists with slug:', slug, 'at row:', existingRowIndex)
        return slug
      }

      // If we get here, the piece doesn't exist. Let's try to add it.
      try {
        // Only generate summary for new pieces
        let summary = score.summary || ''
        if (!summary) {
          try {
            console.log('Attempting to generate summary for new piece:', {
              pieceName: score.pieceName,
              composerName: score.composerName
            })
            
            const baseUrl = process.env.VERCEL_URL 
              ? `https://${process.env.VERCEL_URL}` 
              : process.env.NODE_ENV === 'development'
                ? 'http://localhost:3000'
                : ''
            
            const summaryResponse = await fetch(`${baseUrl}/api/generate-summary`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                pieceName: score.pieceName,
                composerName: score.composerName,
              }),
            })

            if (summaryResponse.ok) {
              const data = await summaryResponse.json()
              summary = data.summary
              console.log('Generated summary for new piece:', summary)
              
              // Update Sanity with the summary
              await fetch('/api/scores', {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  scoreId: score._id,
                  summary: summary,
                }),
              })
            } else {
              console.error('Failed to generate summary:', await summaryResponse.text())
            }
          } catch (error) {
            console.error('Error generating summary for new piece:', error)
          }
        }

        // Check one more time before adding to handle race conditions
        const finalCheck = await findPieceBySlug(slug)
        if (finalCheck !== null) {
          console.log('Piece was added by another process, using existing piece')
          return slug
        }

        // Add new piece with generated or existing summary
        const pieceRow = [
          slug,               // Slug
          score.pieceName,    // Piece Name
          score.composerName, // Composer
          score.language,     // Language
          summary,           // Summary
        ]

        console.log('Adding new piece row:', pieceRow)

        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `'${PIECES_SHEET}'!A:E`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [pieceRow],
          },
        })

        console.log('Successfully added new piece')
        return slug
      } catch (error) {
        console.error(`Error adding piece (attempt ${retries + 1}):`, error)
        retries++
        if (retries === maxRetries) {
          throw error
        }
        // Wait a short time before retrying
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    throw new Error('Failed to add piece after maximum retries')
  } catch (error) {
    console.error('Error in addPieceIfNotExists:', error)
    throw error
  }
}

async function addEditionToSheet(score: any, pieceSlug: string) {
  try {
    console.log('Adding edition for piece:', {
      pieceSlug,
      editor: score.editor,
      publisher: score.publisher,
      scoreUrl: score.scoreUrl
    })

    const editionRow = [
      pieceSlug,           // Piece Slug
      score.editor,        // Editor
      score.publisher,     // Publisher
      score.copyright,     // Copyright
      score.scoreUrl,      // Score URL
      new Date().toISOString(), // Approval Date
    ]

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${APPROVED_EDITIONS_SHEET}'!A:F`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [editionRow],
      },
    })

    console.log('Successfully added edition')
  } catch (error) {
    console.error('Error adding edition:', error)
    throw error
  }
}

async function removeEditionFromSheet(score: any) {
  try {
    const pieceSlug = createSlug(score.composerName, score.pieceName)
    console.log('Removing edition for piece:', {
      pieceSlug,
      scoreUrl: score.scoreUrl,
    })

    // Get all values from the editions sheet
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${APPROVED_EDITIONS_SHEET}'!A:F`,
    })

    const values = response.data.values || []
    console.log('Found', values.length, 'rows in editions sheet')
    
    // Find the row index that matches both the piece slug and score URL
    const rowIndex = values.findIndex(row => row[0] === pieceSlug && row[4] === score.scoreUrl)
    console.log('Found matching edition at index:', rowIndex)
    
    if (rowIndex === -1) {
      console.log('No matching edition found, skipping deletion')
      return
    }

    const sheetId = await getSheetId(APPROVED_EDITIONS_SHEET)
    console.log('Retrieved editions sheet ID:', sheetId)

    // Delete the row
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex,
              endIndex: rowIndex + 1,
            },
          },
        }],
      },
    })
    console.log('Edition removed successfully')
  } catch (error) {
    console.error('Error removing edition:', error)
    throw error
  }
}

async function cleanupDuplicatePieces() {
  try {
    console.log('Starting duplicate piece cleanup')
    
    // Get all pieces
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${PIECES_SHEET}'!A:E`,
    })

    if (!response.data.values) {
      console.log('No values found in sheet')
      return
    }

    const allRows = response.data.values
    const header = allRows[0]
    const rows = allRows.slice(1)

    // Track unique slugs and their first occurrence
    const slugMap = new Map<string, number>()
    const duplicateRows: number[] = []

    rows.forEach((row, index) => {
      const slug = row[0] as string
      if (!slugMap.has(slug)) {
        slugMap.set(slug, index + 2) // +2 for 1-based index and header
      } else {
        duplicateRows.push(index + 2)
      }
    })

    if (duplicateRows.length === 0) {
      console.log('No duplicate pieces found')
      return
    }

    console.log('Found duplicate rows:', duplicateRows)

    // Get sheet ID for deletion
    const sheetId = await getSheetId(PIECES_SHEET)

    // Delete duplicate rows in reverse order to maintain correct indices
    const sortedDuplicates = duplicateRows.sort((a, b) => b - a)
    
    for (const rowIndex of sortedDuplicates) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS',
                startIndex: rowIndex - 1, // Convert to 0-based index
                endIndex: rowIndex // endIndex is exclusive
              }
            }
          }]
        }
      })
      console.log('Deleted duplicate row:', rowIndex)
    }

    console.log('Cleanup completed, removed', duplicateRows.length, 'duplicate pieces')
  } catch (error) {
    console.error('Error during duplicate cleanup:', error)
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, score } = body

    console.log('Received request:', { 
      action, 
      score: { 
        pieceName: score.pieceName,
        composerName: score.composerName,
        status: score.status,
      }
    })

    // Ensure both sheets exist with correct headers
    await ensureSheetExists(PIECES_SHEET, ['Slug', 'Piece Name', 'Composer', 'Language', 'Summary'])
    await ensureSheetExists(APPROVED_EDITIONS_SHEET, ['Piece Slug', 'Editor', 'Publisher', 'Copyright', 'Score URL', 'Approval Date'])

    // Process actions through the queue
    if (action === 'add') {
      // Return immediately but queue the actual processing
      const processPromise = approvalQueue.add(async () => {
        await cleanupDuplicatePieces()
        const pieceSlug = await addPieceIfNotExists(score)
        await addEditionToSheet(score, pieceSlug)
      })

      // Wait for queue processing to complete before sending response
      await processPromise
    } else if (action === 'remove') {
      await approvalQueue.add(async () => {
        await removeEditionFromSheet(score)
      })
    } else {
      console.error('Invalid action:', action)
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    console.log('Operation completed successfully')
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Sheets API error:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ 
      error: 'Failed to update sheet',
      details: errorMessage
    }, { status: 500 })
  }
} 