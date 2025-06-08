import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import puppeteer from 'puppeteer-core'

const BUCKET_NAME = 'tonebase-emails'
const REGION = 'us-east-1'
const APPROVED_PREFIX = 'Q2_2021/Q2W4/Scores/general'

// Example of properly formatted cookies:
const EXAMPLE_COOKIES = [
  {
    name: '_clck',
    value: '14225r1%7C2%7Cfwl%7C0%7C1985',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: '_clsk',
    value: 'c9yosg%7C1749354226036%7C3%7C0%7Ck.clarity.ms%2Fcollect',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: '_ga',
    value: 'GA1.2.1307290984.1749354194',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: '_ga_8370FT5CWW',
    value: 'GS2.2.s1749354194$o1$g1$t1749354226$j28$l0$h0',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: '_gid',
    value: 'GA1.2.1583301422.1749354195',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: 'BOT_DETECT_CLEARED',
    value: '3',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: 'CLID',
    value: 'c949bcbddbd649bba166a5e6dd721b3d.20250608.20260608',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: 'imslp_wiki_session',
    value: 'fd9f4069110a35df487b8f84b31f2ea4',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: 'imslp_wikiLanguageSelectorLanguage',
    value: 'en',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: 'imslp_wikiToken',
    value: '7ff80c7561e2c2c50ec8066b417791a7',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: 'imslp_wikiUserID',
    value: '479878',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: 'imslp_wikiUserName',
    value: 'Aidan1',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: 'mc',
    value: '684506d1-d1462-8a317-eb6ef',
    domain: '.imslp.org',
    path: '/'
  },
  {
    name: 'MUID',
    value: '31965B4902256FC036D94E3F03DE6E5F',
    domain: '.imslp.org',
    path: '/'
  }
]

// Validate environment variables
const requiredEnvVars = {
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  BROWSERLESS_API_KEY: process.env.BROWSERLESS_API_KEY,
  IMSLP_COOKIES: process.env.IMSLP_COOKIES
}

// Check for missing environment variables
const missingEnvVars = Object.entries(requiredEnvVars)
  .filter(([_, value]) => !value)
  .map(([key]) => key)

if (missingEnvVars.length > 0) {
  console.error('Missing required environment variables:', missingEnvVars)
  throw new Error(`Missing required environment variables: ${missingEnvVars.join(', ')}`)
}

// Helper function for consistent logging
function logWithTimestamp(message: string, data?: any) {
  const timestamp = new Date().toISOString()
  const logMessage = data 
    ? `[${timestamp}] ${message} ${JSON.stringify(data, null, 2)}`
    : `[${timestamp}] ${message}`
  console.log(logMessage)
}

// Helper function to get page metrics
async function getPageMetrics(page: any) {
  try {
    const metrics = await page.metrics()
    const performance = await page.evaluate(() => ({
      memory: performance.memory ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
      } : null,
      timing: performance.timing
    }))
    return { metrics, performance }
  } catch (error) {
    console.error('Failed to get page metrics:', error)
    return null
  }
}

// Helper function to log page state
async function logPageState(page: any, context: string) {
  try {
    const url = page.url()
    const title = await page.title()
    const metrics = await getPageMetrics(page)
    const cookies = await page.cookies()
    
    logWithTimestamp(`Page State [${context}]`, {
      url,
      title,
      metrics,
      cookiesCount: cookies.length,
      viewport: await page.viewport(),
      isClosed: page.isClosed(),
    })
  } catch (error) {
    console.error(`Failed to log page state for ${context}:`, error)
  }
}

const s3Client = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

// Helper function to validate Browserless.io connection
async function validateBrowserlessConnection(wsEndpoint: string) {
  try {
    logWithTimestamp('Validating Browserless.io connection', { 
      wsEndpoint: wsEndpoint.replace(/token=([^&]+)/, 'token=****') // Hide API key in logs
    })

    // Try a basic HTTP request to check API key
    const statusUrl = `https://chrome.browserless.io/json/version?token=${process.env.BROWSERLESS_API_KEY}`
    const statusResponse = await fetch(statusUrl)
    
    if (!statusResponse.ok) {
      if (statusResponse.status === 402) {
        throw new Error('Browserless.io quota exceeded or payment required')
      } else if (statusResponse.status === 401) {
        throw new Error('Invalid Browserless.io API key')
      } else {
        throw new Error(`Browserless.io service error: ${statusResponse.status} ${statusResponse.statusText}`)
      }
    }

    const status = await statusResponse.json()
    logWithTimestamp('Browserless.io status check successful', {
      webSocketDebuggerUrl: status.webSocketDebuggerUrl ? 'present' : 'missing',
      browser: status.Browser,
      protocol: status['Protocol-Version']
    })

    return true
  } catch (error) {
    const err = error as Error
    logWithTimestamp('Browserless.io validation failed', {
      error: err.message,
      stack: err.stack
    })
    throw error
  }
}

// Get browser connection based on environment
async function getBrowser() {
  const isDev = process.env.NODE_ENV === 'development'
  
  logWithTimestamp('Initializing browser connection', {
    environment: isDev ? 'development' : 'production',
    type: isDev ? 'local-chrome' : 'browserless.io',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch
  })
  
  if (isDev) {
    try {
      // In development, connect to local Chrome instance
      const browser = await puppeteer.connect({
        browserURL: 'http://localhost:9222',
        defaultViewport: null,
      })
      
      const version = await browser.version()
      const wsEndpoint = browser.wsEndpoint()
      
      logWithTimestamp('Connected to local Chrome', {
        version,
        wsEndpoint,
        targetCount: (await browser.targets()).length
      })
      
      return browser
    } catch (error) {
      console.error('Failed to connect to local Chrome:', error)
      throw new Error('Failed to connect to local Chrome. Make sure Chrome is running with --remote-debugging-port=9222')
    }
  } else {
    // In production, use Browserless.io
    if (!process.env.BROWSERLESS_API_KEY) {
      throw new Error('BROWSERLESS_API_KEY environment variable is required')
    }

    if (process.env.BROWSERLESS_API_KEY.includes('"')) {
      throw new Error('BROWSERLESS_API_KEY contains quotes - please remove them')
    }
    
    try {
      const wsEndpoint = `wss://chrome.browserless.io?token=${process.env.BROWSERLESS_API_KEY}&--proxy-server=http://brd.superproxy.io:22225`
      
      // Validate connection before attempting to connect
      await validateBrowserlessConnection(wsEndpoint)
      
      logWithTimestamp('Connecting to Browserless.io', { 
        wsEndpoint: wsEndpoint.replace(/token=([^&]+)/, 'token=****') // Hide API key in logs
      })
      
      const browser = await puppeteer.connect({
        browserWSEndpoint: wsEndpoint,
        defaultViewport: null,
      })
      
      const version = await browser.version()
      const wsConnection = browser.wsEndpoint()
      
      logWithTimestamp('Connected to Browserless.io', {
        version,
        wsConnection: wsConnection.replace(/token=([^&]+)/, 'token=****'),
        targetCount: (await browser.targets()).length,
        connected: browser.isConnected()
      })
      
      return browser
    } catch (error) {
      const err = error as Error
      logWithTimestamp('Browserless.io connection error', {
        message: err.message,
        stack: err.stack,
        apiKey: process.env.BROWSERLESS_API_KEY ? 'present' : 'missing',
        apiKeyLength: process.env.BROWSERLESS_API_KEY?.length
      })
      
      // Provide more specific error messages
      if (err.message.includes('401')) {
        throw new Error('Invalid Browserless.io API key - please check your environment variables')
      } else if (err.message.includes('402')) {
        throw new Error('Browserless.io quota exceeded - please check your usage limits')
      } else if (err.message.includes('WebSocket')) {
        throw new Error('Failed to establish WebSocket connection with Browserless.io - check your network and firewall settings')
      }
      
      throw new Error(`Failed to connect to Browserless.io: ${err.message}`)
    }
  }
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()
  let browser;
  let page;

  try {
    const { scoreUrl, slug } = await request.json()
    logWithTimestamp('PDF processing request received', { scoreUrl, slug })

    if (!scoreUrl || !slug) {
      logWithTimestamp('Missing required parameters', { scoreUrl, slug })
      return NextResponse.json({ 
        error: 'Missing required parameters' 
      }, { status: 400 })
    }

    // Validate IMSLP cookies
    if (!process.env.IMSLP_COOKIES) {
      throw new Error('IMSLP_COOKIES environment variable is required')
    }

    let cookies;
    try {
      cookies = JSON.parse(process.env.IMSLP_COOKIES)
      if (!Array.isArray(cookies)) {
        throw new Error('IMSLP_COOKIES must be a JSON array')
      }
    } catch (error) {
      console.error('Failed to parse IMSLP_COOKIES:', error)
      throw new Error('Invalid IMSLP_COOKIES format. Must be a valid JSON array.')
    }

    // Get browser instance based on environment
    browser = await getBrowser()
    logWithTimestamp('Browser connection established')

    // Create a new page in the browser
    page = await browser.newPage()
    logWithTimestamp('New page created', {
      targetCount: (await browser.targets()).length,
      pagesCount: (await browser.pages()).length
    })

    // Set up page event listeners
    page.on('console', msg => logWithTimestamp('Browser Console:', {
      type: msg.type(),
      text: msg.text()
    }))
    
    page.on('pageerror', error => logWithTimestamp('Browser Page Error:', {
      message: error.message,
      stack: error.stack
    }))
    
    page.on('requestfailed', request => logWithTimestamp('Failed Request:', {
      url: request.url(),
      errorText: request.failure()?.errorText,
      method: request.method()
    }))

    // Set cookies
    try {
      const currentCookies = await page.cookies()
      logWithTimestamp('Cookies set successfully', {
        cookiesCount: currentCookies.length,
        domains: [...new Set(currentCookies.map(c => c.domain))]
      })
    } catch (error) {
      console.error('Failed to set cookies:', error)
      throw new Error('Failed to set IMSLP cookies')
    }

    // Navigate to IMSLP page
    logWithTimestamp('Starting navigation to IMSLP page', { url: scoreUrl })
    const response = await page.goto(scoreUrl, { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    })

    if (!response) {
      logWithTimestamp('Failed to get response from IMSLP page')
      await logPageState(page, 'navigation-failed')
      throw new Error('Failed to get response from IMSLP page')
    }

    await logPageState(page, 'post-navigation')

    // Check if we got a PDF directly
    const contentType = response.headers()['content-type'] || ''
    const status = response.status()
    logWithTimestamp('Response details', { 
      contentType,
      status,
      statusText: response.statusText(),
      headers: response.headers()
    })

    if (contentType.includes('application/pdf')) {
      logWithTimestamp('Direct PDF response received')
      const pdfBuffer = await response.buffer()
      logWithTimestamp('PDF downloaded directly', { size: pdfBuffer.byteLength })
      
      // Upload to S3
      const fileName = `${slug}.pdf`
      const newKey = `${APPROVED_PREFIX}/${fileName}`
      logWithTimestamp('Uploading PDF to S3', { bucket: BUCKET_NAME, key: newKey })
      
      try {
        await s3Client.send(new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: newKey,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
        }))
        logWithTimestamp('S3 upload successful')
      } catch (error) {
        console.error('Failed to upload to S3:', error)
        throw new Error('Failed to upload PDF to S3')
      }
      
      const newUrl = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/${newKey}`
      logWithTimestamp('Processing completed successfully', { 
        duration: Date.now() - startTime,
        newUrl 
      })

      return NextResponse.json({ 
        success: true,
        url: newUrl
      })
    }

    // Handle IMSLP download page
    logWithTimestamp('Handling IMSLP download page')
    
    // Before clicking "I understand" button
    await logPageState(page, 'before-understand-button')

    try {
      logWithTimestamp('Looking for "I understand" button')
      const understandButton = await page.waitForSelector('button:has-text("I understand")', { timeout: 5000 })
      if (understandButton) {
        const buttonPosition = await understandButton.boundingBox()
        logWithTimestamp('"I understand" button found', { buttonPosition })
        await understandButton.click()
        await page.waitForTimeout(1000)
        logWithTimestamp('"I understand" button clicked')
        await logPageState(page, 'after-understand-button')
      }
    } catch (e) {
      logWithTimestamp('No immediate "I understand" button found')
    }

    // Look for the download link
    logWithTimestamp('Looking for download link')
    const pageContent = await page.content()
    const downloadLink = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'))
      const pdfLink = links.find(link => 
        link.href?.includes('.pdf') || 
        link.getAttribute('data-id')?.includes('.pdf')
      )
      return {
        href: pdfLink?.href,
        dataId: pdfLink?.getAttribute('data-id'),
        text: pdfLink?.textContent,
        isVisible: pdfLink ? window.getComputedStyle(pdfLink).display !== 'none' : false
      }
    })

    if (!downloadLink?.href) {
      logWithTimestamp('No download link found', {
        pageTitle: await page.title(),
        currentUrl: page.url(),
        pageContentLength: pageContent.length,
        pageContentPreview: pageContent.substring(0, 1000)
      })
      throw new Error('No download link found on IMSLP page')
    }

    logWithTimestamp('Found download link', downloadLink)

    // Download the PDF
    logWithTimestamp('Downloading PDF')
    const pdfResponse = await page.goto(downloadLink.href, { waitUntil: 'networkidle0' })

    if (!pdfResponse) {
      logWithTimestamp('Failed to download PDF')
      throw new Error('Failed to download PDF from IMSLP')
    }

    const pdfBuffer = await pdfResponse.buffer()
    logWithTimestamp('PDF downloaded', { size: pdfBuffer.byteLength })

    if (pdfBuffer.byteLength === 0) {
      throw new Error('Downloaded PDF is empty')
    }

    // Generate S3 key and upload
    const fileName = `${slug}.pdf`
    const newKey = `${APPROVED_PREFIX}/${fileName}`
    logWithTimestamp('Generated S3 path', {
      bucket: BUCKET_NAME,
      key: newKey
    })

    // Upload to S3
    logWithTimestamp('Starting S3 upload')
    try {
      await s3Client.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: newKey,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
      }))
      logWithTimestamp('S3 upload successful')
    } catch (error) {
      console.error('Failed to upload to S3:', error)
      throw new Error('Failed to upload PDF to S3')
    }

    const newUrl = `https://${BUCKET_NAME}.s3.${REGION}.amazonaws.com/${newKey}`
    logWithTimestamp('Processing completed successfully', { 
      duration: Date.now() - startTime,
      newUrl 
    })

    return NextResponse.json({ 
      success: true,
      url: newUrl
    })

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const errorDetails = {
      message: errorMessage,
      type: error instanceof Error ? error.constructor.name : typeof error,
      stack: error instanceof Error ? error.stack : undefined,
      duration: Date.now() - startTime
    }
    
    // Log final page state if available
    if (page) {
      try {
        await logPageState(page, 'error-state')
      } catch (e) {
        console.error('Failed to log error page state:', e)
      }
    }
    
    logWithTimestamp('PDF processing error', errorDetails)
    
    return NextResponse.json({ 
      error: 'Failed to process PDF',
      details: errorDetails
    }, { status: 500 })
  } finally {
    if (browser) {
      try {
        logWithTimestamp('Cleaning up browser resources', {
          pagesCount: page ? (await browser.pages()).length : 0,
          targetCount: (await browser.targets()).length
        })
        if (page && !page.isClosed()) {
          await page.close()
        }
        await browser.disconnect()
        logWithTimestamp('Browser cleanup completed')
      } catch (error) {
        console.error('Error during browser cleanup:', error)
      }
    }
  }
} 