import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')
  
  if (!url) {
    console.error('Proxy error: No URL parameter provided')
    return NextResponse.json({ error: 'URL parameter is required' }, { status: 400 })
  }

  try {
    console.log('Proxy: Processing URL:', {
      url,
      isIMSLP: url.includes('imslp.org'),
      isImageFromIndex: url.includes('Special:ImagefromIndex'),
      isPDF: url.toLowerCase().endsWith('.pdf')
    })
    
    // If it's an IMSLP URL but not a direct PDF, try to find the PDF link
    if (url.includes('imslp.org') && !url.toLowerCase().endsWith('.pdf')) {
      console.log('Proxy: Handling IMSLP URL')
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
      })
      
      if (!response.ok) {
        console.error('Proxy: IMSLP fetch failed:', {
          status: response.status,
          statusText: response.statusText
        })
        return NextResponse.json({ 
          error: 'Failed to fetch from IMSLP',
          details: {
            status: response.status,
            statusText: response.statusText
          }
        }, { status: response.status })
      }
      
      const text = await response.text()
      console.log('Proxy: Received IMSLP page content length:', text.length)
      
      // Try different patterns for finding PDF links
      const patterns = [
        /href="(https:\/\/[^"]+\.pdf[^"]*)"/, // Standard href pattern
        /data-id="(https:\/\/[^"]+\.pdf[^"]*)"/, // Data-id pattern
        /"url":"(https:\/\/[^"]+\.pdf[^"]*)"/, // JSON URL pattern
        /window\.location\.href\s*=\s*["'](https:\/\/[^"']+\.pdf[^"']*)["']/ // JavaScript redirect pattern
      ]
      
      let pdfUrl = null
      for (const pattern of patterns) {
        const match = text.match(pattern)
        if (match && match[1]) {
          pdfUrl = match[1]
          console.log('Proxy: Found PDF URL using pattern:', {
            pattern: pattern.toString(),
            url: pdfUrl
          })
          break
        }
      }
      
      if (pdfUrl) {
        console.log('Proxy: Found PDF URL from IMSLP:', pdfUrl)
        
        // Redirect to the PDF URL through our proxy
        const pdfResponse = await fetch(pdfUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        })
        
        if (!pdfResponse.ok) {
          console.error('Proxy: PDF fetch failed:', {
            status: pdfResponse.status,
            statusText: pdfResponse.statusText,
            url: pdfUrl
          })
          return NextResponse.json({ 
            error: 'Failed to fetch PDF from IMSLP',
            details: {
              status: pdfResponse.status,
              statusText: pdfResponse.statusText,
              url: pdfUrl
            }
          }, { status: pdfResponse.status })
        }
        
        const contentType = pdfResponse.headers.get('content-type')
        console.log('Proxy: PDF response content type:', contentType)
        
        if (!contentType?.includes('application/pdf')) {
          console.error('Proxy: Invalid content type from PDF URL:', {
            contentType,
            url: pdfUrl
          })
          return NextResponse.json({ 
            error: 'Invalid content type from PDF URL',
            details: {
              contentType,
              url: pdfUrl
            }
          }, { status: 400 })
        }
        
        const arrayBuffer = await pdfResponse.arrayBuffer()
        return new NextResponse(arrayBuffer, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'inline',
          },
        })
      } else {
        console.error('Proxy: No PDF link found in IMSLP page. Page excerpt:', text.substring(0, 1000))
        return NextResponse.json({ 
          error: 'No PDF link found in IMSLP page',
          details: {
            url,
            pageLength: text.length,
            pageExcerpt: text.substring(0, 1000)
          }
        }, { status: 404 })
      }
    }

    // For direct URLs (including direct PDF URLs from IMSLP)
    console.log('Proxy: Fetching direct URL')
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    })
    
    if (!response.ok) {
      console.error('Proxy: Direct URL fetch failed:', {
        status: response.status,
        statusText: response.statusText,
        url: url
      })
      return NextResponse.json({ 
        error: 'Failed to fetch from URL',
        details: {
          status: response.status,
          statusText: response.statusText,
          url: url
        }
      }, { status: response.status })
    }
    
    const contentType = response.headers.get('content-type')
    console.log('Proxy: Content-Type:', contentType)
    
    // Some servers might send octet-stream for PDFs
    if (contentType?.includes('application/pdf') || 
        (url.toLowerCase().endsWith('.pdf') && contentType?.includes('application/octet-stream'))) {
      const arrayBuffer = await response.arrayBuffer()
      return new NextResponse(arrayBuffer, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline',
        },
      })
    }

    console.error('Proxy: Invalid content type:', {
      contentType,
      url,
      isPDF: url.toLowerCase().endsWith('.pdf')
    })
    return NextResponse.json({ 
      error: 'Invalid content type',
      details: { 
        contentType,
        url,
        isPDF: url.toLowerCase().endsWith('.pdf')
      }
    }, { status: 400 })
  } catch (error) {
    const err = error as Error
    console.error('Proxy error:', {
      message: err.message,
      stack: err.stack,
      url: url
    })
    return NextResponse.json({ 
      error: 'Failed to proxy request',
      details: {
        message: err.message,
        url: url
      }
    }, { status: 500 })
  }
} 