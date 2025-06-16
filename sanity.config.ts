'use client'

/**
 * This configuration is used to for the Sanity Studio that's mounted on the `/app/studio/[[...tool]]/page.tsx` route
 */

import {visionTool} from '@sanity/vision'
import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {deskTool} from 'sanity/desk'

// Go to https://www.sanity.io/docs/api-versioning to learn how API versioning works
import {apiVersion, dataset, projectId} from './src/sanity/env'
import {schema} from './src/sanity/schemaTypes'
import {structure} from './src/sanity/structure'

export default defineConfig({
  name: 'default',
  title: 'TB Score Reviewer',

  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID! || '',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',

  basePath: '/studio',

  plugins: [
    structureTool({structure}),
    // Vision is for querying with GROQ from inside the Studio
    // https://www.sanity.io/docs/the-vision-plugin
    visionTool({defaultApiVersion: apiVersion}),
    deskTool(),
  ],

  schema: {
    types: [
      {
        name: 'score',
        title: 'Score',
        type: 'document',
        fields: [
          {name: 'pieceName', type: 'string', title: 'Piece Name'},
          {name: 'composerName', type: 'string', title: 'Composer Name'},
          {name: 'language', type: 'string', title: 'Language'},
          {name: 'summary', type: 'text', title: 'Summary'},
          {name: 'status', type: 'string', title: 'Status', options: {list: ['approved', 'rejected', 'unreviewed']}},
          {name: 'slug', type: 'slug', title: 'Slug'},
          {name: 'editor', type: 'string', title: 'Editor'},
          {name: 'publisher', type: 'string', title: 'Publisher'},
          {name: 'copyright', type: 'string', title: 'Copyright'},
          {name: 'scoreUrl', type: 'url', title: 'Score URL'},
          {name: 'reviewedAt', type: 'datetime', title: 'Reviewed At'}
        ]
      },
      {
        name: 'piece',
        title: 'Piece',
        type: 'document',
        fields: [
          {name: 'piece_title', type: 'string', title: 'Piece Title'},
          {name: 'composer', type: 'string', title: 'Composer'},
          {name: 'year_of_composition', type: 'number', title: 'Year of Composition'},
          {name: 'era', type: 'string', title: 'Era'},
          {name: 'slug', type: 'slug', title: 'Slug'},
          {
            name: 'status',
            type: 'string',
            title: 'Status',
            options: {
              list: [
                {title: 'Unreviewed', value: 'unreviewed'},
                {title: 'Reviewed', value: 'reviewed'}
              ]
            },
            initialValue: 'unreviewed'
          }
        ]
      },
      {
        name: 'edition',
        title: 'Edition',
        type: 'document',
        fields: [
          {name: 'slug', type: 'slug', title: 'Slug'},
          {name: 'publisher', type: 'string', title: 'Publisher'},
          {name: 'copyright', type: 'string', title: 'Copyright'},
          {name: 'editor', type: 'string', title: 'Editor'},
          {name: 'url', type: 'url', title: 'URL'},
          {
            name: 'piece',
            title: 'Piece',
            type: 'reference',
            to: [{type: 'piece'}]
          },
          {
            name: 'status',
            type: 'string',
            title: 'Status',
            options: {
              list: [
                {title: 'Unreviewed', value: 'unreviewed'},
                {title: 'Approved', value: 'approved'},
                {title: 'Rejected', value: 'rejected'}
              ]
            },
            initialValue: 'unreviewed'
          },
          {name: 'rejectionReason', type: 'text', title: 'Rejection Reason'},
          {name: 'reviewedAt', type: 'datetime', title: 'Reviewed At'}
        ]
      }
    ]
  },
})
