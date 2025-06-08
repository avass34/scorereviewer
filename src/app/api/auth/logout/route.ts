import { NextResponse } from 'next/server'

export async function POST() {
  const response = new NextResponse('Logged out', { status: 200 })
  
  // Clear the auth cookie
  response.cookies.set('auth', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    expires: new Date(0), // Set expiration to the past to delete the cookie
  })

  return response
} 