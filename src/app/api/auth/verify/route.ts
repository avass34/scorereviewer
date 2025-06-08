import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const { password } = await request.json()
    
    if (!process.env.PASSWORD) {
      return new NextResponse('Password not configured', { status: 500 })
    }

    if (password === process.env.PASSWORD) {
      // Create a response with the auth cookie
      const response = new NextResponse('OK', { status: 200 })
      
      // Set the auth cookie
      response.cookies.set('auth', 'true', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/',
      })

      return response
    }

    return new NextResponse('Invalid password', { status: 401 })
  } catch (error) {
    return new NextResponse('Internal error', { status: 500 })
  }
} 