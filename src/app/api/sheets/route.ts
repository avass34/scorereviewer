import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'
import { JWT } from 'google-auth-library'

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
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${PIECES_SHEET}'!A2:D`,
    })

    const rows = response.data.values || []
    const rowIndex = rows.findIndex(row => row[0] === slug)
    return rowIndex !== -1 ? rowIndex + 2 : null // +2 because of 1-based index and header row
  } catch (error) {
    console.error('Error finding piece by slug:', error)
    throw error
  }
}

async function addPieceIfNotExists(score: any): Promise<string> {
  const slug = createSlug(score.composerName, score.pieceName)
  
  try {
    // Check if piece already exists
    const existingRowIndex = await findPieceBySlug(slug)
    if (existingRowIndex !== null) {
      console.log('Piece already exists with slug:', slug)
      return slug
    }

    // Add new piece
    const pieceRow = [
      slug,               // Slug
      score.pieceName,    // Piece Name
      score.composerName, // Composer
      score.language,     // Language
    ]

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${PIECES_SHEET}'!A:D`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [pieceRow],
      },
    })

    console.log('Added new piece with slug:', slug)
    return slug
  } catch (error) {
    console.error('Error adding piece:', error)
    throw error
  }
}

async function addEditionToSheet(score: any, pieceSlug: string) {
  try {
    console.log('Adding edition for piece:', {
      pieceSlug,
      editor: score.editor,
      publisher: score.publisher,
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

    console.log('Edition added successfully')
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
    await ensureSheetExists(PIECES_SHEET, ['Slug', 'Piece Name', 'Composer', 'Language'])
    await ensureSheetExists(APPROVED_EDITIONS_SHEET, ['Piece Slug', 'Editor', 'Publisher', 'Copyright', 'Score URL', 'Approval Date'])

    switch (action) {
      case 'add':
        const pieceSlug = await addPieceIfNotExists(score)
        await addEditionToSheet(score, pieceSlug)
        break
      case 'remove':
        await removeEditionFromSheet(score)
        break
      default:
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