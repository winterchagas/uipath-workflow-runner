import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

// Matches the app palette instead of a stock editor theme.
const view = EditorView.theme(
  {
    '&': { color: '#ece8e1', backgroundColor: '#141311', fontSize: '12.5px' },
    '.cm-content': { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", caretColor: '#ff7a1a', padding: '8px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#ff7a1a', borderLeftWidth: '2px' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#3a3226 !important' },
    '.cm-gutters': { backgroundColor: '#141311', color: '#5d5850', border: 'none', fontFamily: "'IBM Plex Mono', monospace" },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.025)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#b8b1a6' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(255, 122, 26, 0.18)', outline: 'none' },
    '.cm-tooltip': { backgroundColor: '#211f1c', border: '1px solid #3a3732' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#2a2824', color: '#ece8e1' },
  },
  { dark: true },
)

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: '#e0a370' },
  { tag: [t.string, t.special(t.string), t.regexp], color: '#a8c79a' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#d7b56d' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#6b665e', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#ece8e1', fontWeight: '500' },
  { tag: [t.propertyName], color: '#c9b8a3' },
  { tag: [t.variableName, t.definition(t.variableName)], color: '#ece8e1' },
  { tag: [t.operator, t.punctuation, t.bracket], color: '#8f897f' },
])

export const editorTheme = [view, syntaxHighlighting(highlight)]
