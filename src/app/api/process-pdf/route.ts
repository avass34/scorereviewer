import { NextRequest, NextResponse } from 'next/server'
import { chromium } from 'playwright-core'
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
  let browser = null
  
  try {
    const { scoreUrl, slug } = await request.json()

    if (!scoreUrl || !slug) {
      return NextResponse.json({ 
        error: 'Missing required parameters' 
      }, { status: 400 })
    }

    console.log('Processing score:', { scoreUrl, slug })

    // Launch browser
    browser = await chromium.launch()
    console.log('Browser launched')

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    })
    const page = await context.newPage()

    // Navigate to score URL with timeout and wait for network idle
    console.log('Navigating to score URL:', scoreUrl)
    await page.goto(scoreUrl, { 
      waitUntil: 'networkidle',
      timeout: 60000 // 60 second timeout
    })

    // Look for PDF links
    const pdfUrl = await page.evaluate(() => {
      const patterns = [
        /href="(https:\/\/[^"]+\.pdf[^"]*)"/, // Standard href pattern
        /data-id="(https:\/\/[^"]+\.pdf[^"]*)"/, // Data-id pattern
        /"url":"(https:\/\/[^"]+\.pdf[^"]*)"/, // JSON URL pattern
        /window\.location\.href\s*=\s*["'](https:\/\/[^"']+\.pdf[^"']*)["']/ // JavaScript redirect pattern
      ]
      
      const content = document.documentElement.innerHTML
      for (const pattern of patterns) {
        const match = content.match(pattern)
        if (match && match[1]) {
          return match[1]
        }
      }
      return null
    })

    if (!pdfUrl) {
      throw new Error('Could not find PDF URL')
    }

    console.log('Found PDF URL:', pdfUrl)

    // Download PDF
    const pdfResponse = await page.goto(pdfUrl)
    if (!pdfResponse) {
      throw new Error('Failed to download PDF')
    }

    const pdfBuffer = await pdfResponse.body()
    console.log('Downloaded PDF, size:', pdfBuffer.byteLength)

    // Generate S3 key
    const fileName = `${slug}.pdf`
    const newKey = `${APPROVED_PREFIX}/${fileName}`
    console.log('Generated S3 path:', {
      bucket: BUCKET_NAME,
      key: newKey
    })

    // Upload to S3
    console.log('Starting S3 upload...')
    const uploadCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: newKey,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
    })

    await s3Client.send(uploadCommand)
    console.log('S3 upload successful')

    const newUrl = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/${newKey}`
    return NextResponse.json({ 
      success: true,
      url: newUrl
    })

  } catch (error) {
    console.error('PDF processing error:', error)
    return NextResponse.json({ 
      error: 'Failed to process PDF',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  } finally {
    if (browser) {
      await browser.close()
      console.log('Browser closed')
    }
  }
} 