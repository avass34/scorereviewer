import {StructureBuilder} from 'sanity/desk'

// https://www.sanity.io/docs/structure-builder-cheat-sheet
export const structure = (S: StructureBuilder) =>
  S.list()
    .title('Content')
    .items([
      S.listItem()
        .title('Scores')
        .child(S.documentTypeList('score')),
      S.listItem()
        .title('Pieces')
        .child(S.documentTypeList('piece')),
      S.listItem()
        .title('Editions')
        .child(S.documentTypeList('edition')),
    ])
