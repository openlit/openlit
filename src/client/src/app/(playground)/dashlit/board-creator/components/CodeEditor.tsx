"use client"

import type React from "react"
import { useRef } from "react"
import Editor from "@monaco-editor/react"
import type { EditorProps } from "../types"
import { CLICKHOUSE_LANGUAGE_CONFIG } from "../constants"

const CodeEditor: React.FC<EditorProps> = ({
  value,
  onChange,
  language = "sql",
  height = "100%",
  fullScreen = false,
}) => {
  const editorRef = useRef<any>(null)

  // Handle Monaco Editor mount
  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor
  }

  return (
    <Editor
      height={height}
      defaultLanguage={language}
      value={value}
      onChange={onChange}
      onMount={handleEditorDidMount}
      options={{
        minimap: { enabled: fullScreen },
        scrollBeyondLastLine: false,
        fontSize: 14,
        wordWrap: "on",
        automaticLayout: true,
      }}
      beforeMount={(monaco) => {
        // Register ClickHouse SQL language
        if (language === "clickhouse-sql") {
          monaco.languages.register({ id: "clickhouse-sql" })
          monaco.languages.setMonarchTokensProvider("clickhouse-sql", CLICKHOUSE_LANGUAGE_CONFIG.loader().language)
          monaco.editor.defineTheme("clickhouse-dark", {
            base: "vs-dark",
            inherit: true,
            rules: [
              { token: "keyword", foreground: "569CD6", fontStyle: "bold" },
              { token: "operator", foreground: "D4D4D4" },
              { token: "string", foreground: "CE9178" },
              { token: "number", foreground: "B5CEA8" },
              { token: "comment", foreground: "6A9955", fontStyle: "italic" },
              { token: "predefined", foreground: "DCDCAA" },
            ],
            colors: {
              "editor.background": "#1E1E1E",
            },
          })
          monaco.editor.setTheme("clickhouse-dark")
        }
      }}
    />
  )
}

export default CodeEditor

