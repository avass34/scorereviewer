'use client'

/**
 * This configuration is used to for the Sanity Studio that's mounted on the `/app/studio/[[...tool]]/page.tsx` route
 */

import { defineConfig } from 'sanity'
import { deskTool } from 'sanity/desk'
import { visionTool } from '@sanity/vision'
import { schemaTypes } from './src/sanity/schemaTypes'

// Go to https://www.sanity.io/docs/api-versioning to learn how API versioning works
const apiVersion = process.env.NEXT_PUBLIC_SANITY_API_VERSION || '2024-02-20'
import {dataset, projectId} from './src/sanity/env'

export default defineConfig({
  name: 'default',
  title: 'Score Reviewer',
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID!,
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET!,
  basePath: '/studio',
  plugins: [
    deskTool(),
    visionTool(),
  ],
  schema: {
    types: schemaTypes,
  },
})
