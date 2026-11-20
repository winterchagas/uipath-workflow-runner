import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { editorTheme } from '../editorTheme.ts'

// CodeMirror is most of the bundle, so this module is loaded lazily (see lazyCodeEditor.ts).
const extensions = [javascript(), editorTheme]

type Props = { value: string; readOnly: boolean; onChange: (value: string) => void }

export default function CodeEditor({ value, readOnly, onChange }: Props) {
  return <CodeMirror value={value} height="280px" theme="none" extensions={extensions} readOnly={readOnly} onChange={onChange} />
}
