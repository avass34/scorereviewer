import { NextRequest, NextResponse } from 'next/server'
import { ImageResponse } from '@vercel/og'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const BUCKET_NAME = 'tonebase-emails'
const REGION = 'us-east-1'
const APPROVED_PREFIX = 'Q2_2021/Q2W4/Scores/general'

const s3Client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

export const runtime = 'edge'
export const preferredRegion = 'iad1' // Use US East region for better IMSLP access

export async function POST(request: NextRequest) {
  try {
    const { scoreUrl, slug } = await request.json()

    if (!scoreUrl || !slug) {
      return NextResponse.json({ 
        error: 'Missing required parameters' 
      }, { status: 400 })
    }

    console.log('Processing score:', { scoreUrl, slug })

    // Fetch the PDF URL directly first
    const response = await fetch(scoreUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    })

    let pdfUrl = scoreUrl
    const contentType = response.headers.get('content-type')

    // If the response is HTML, we need to parse it for the PDF URL
    if (contentType && contentType.includes('text/html')) {
      const html = await response.text()
      
      const patterns = [
        /href="(https:\/\/[^"]+\.pdf[^"]*)"/, // Standard href pattern
        /data-id="(https:\/\/[^"]+\.pdf[^"]*)"/, // Data-id pattern
        /"url":"(https:\/\/[^"]+\.pdf[^"]*)"/, // JSON URL pattern
        /window\.location\.href\s*=\s*["'](https:\/\/[^"']+\.pdf[^"']*)["']/ // JavaScript redirect pattern
      ]
      
      for (const pattern of patterns) {
        const match = html.match(pattern)
        if (match && match[1]) {
          pdfUrl = match[1]
          break
        }
      }
    }

    if (!pdfUrl) {
      throw new Error('Could not find PDF URL')
    }

    console.log('Found PDF URL:', pdfUrl)

    // Download the PDF
    const pdfResponse = await fetch(pdfUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    })

    if (!pdfResponse.ok || !pdfResponse.body) {
      throw new Error('Failed to download PDF')
    }

    // Convert the response to a buffer
    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer())
    console.log('Downloaded PDF, size:', pdfBuffer.byteLength)

    // Generate S3 key
    const fileName = `${slug}.pdf`
    const newKey = `${APPROVED_PREFIX}/${fileName}`
    console.log('Generated S3 path:', {
      bucket: BUCKET_NAME,
      key: newKey
    })

    // Upload to S3 with timeout
    console.log('Starting S3 upload...')
    const uploadCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: newKey,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
    })

    // Set a timeout for S3 upload
    const uploadPromise = s3Client.send(uploadCommand)
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('S3 upload timeout')), 20000)
    )

    await Promise.race([uploadPromise, timeoutPromise])
    console.log('S3 upload successful')

    const newUrl = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/${newKey}`
    return NextResponse.json({ 
      success: true,
      url: newUrl
    })

  } catch (error) {
    console.error('PDF processing error:', error)
    
    // Provide more detailed error information
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorDetails = {
      message: errorMessage,
      type: error instanceof Error ? error.constructor.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined
    }
    
    return NextResponse.json({ 
      error: 'Failed to process PDF',
      details: errorDetails
    }, { status: 500 })
  }
} 