function detectLanguageFromContent(content) {
    content = content.slice(0, 12000);
    // Prefer distinctive syntax before generic constructs.
    if (/std::|^\s*template\s*<|#include\s*<(iostream|vector|string)>/m.test(content)) return "cpp";
    if (/^\s*package\s+main|fmt\.Print|^\s*func\s+/m.test(content)) return "go";
    if (/^\s*(interface|type)\s+\w+|:\s*(string|number|boolean)\b/m.test(content)) return "typescript";
    if (/^\s*[\[{]/.test(content)) {
        try { JSON.parse(content); return "json"; } catch {}
    }
    if (/^\s*(import|export)\s+.*\bfrom\s+[\'"]|^\s*(const|let|var)\s+|=>/m.test(content)) return "javascript";
    if (
        /^\s*#include\s+<.*>|^\s*int\s+main\s*\(|^\s*printf\s*\(/m.test(
            content
        )
    )
        return "c";
    if (
        /^\s*#include\s+<.*>|std::|::std::|^\s*template\s*</m.test(content)
    )
        return "cpp";
    // Rust
    if (
        /^\s*fn\s+main\s*\(|^\s*use\s+[a-zA-Z0-9_:]+;|Cargo\.toml/m.test(
            content
        )
    )
        return "rust";
    if (
        /^\s*package\s+|System\.out\.println|public\s+class\s+/m.test(
            content
        )
    )
        return "java";
    if (/^\s*package\s+main|fmt\.Print|go\s+mod\s+/m.test(content))
        return "go";
    if (
        /^\s*SELECT\s+|^\s*INSERT\s+|^\s*UPDATE\s+|^\s*DELETE\s+/im.test(
            content
        )
    )
        return "sql";
    if (/^\s*---|: \w+\s*$/m.test(content) && /:\s*\w+/m.test(content))
        return "yaml";
    if (
        /^#!\/bin\/(bash|sh)|^\s*echo\s+"|^\s*for\s+\w+\s+in/m.test(content)
    )
        return "shell";
    if (/^\s*def\s+|import\s+|print\(|:\s*$/m.test(content))
        return "python";
    if (/^\s*function\s+|=>\s+|const\s+|let\s+|var\s+/m.test(content))
        return "javascript";
    if (/<[a-z][\s\S]*?>/i.test(content) && /<\/[a-z]+>/i.test(content))
        return "html";
    if (/{[\s\S]*?:[\s\S]*?}/.test(content) && /^[\[{]/.test(content))
        return "json";
    if (/(?:^|\n)\s*[.#]?[\w-]+[^\n{}]*\{[^}]*:/.test(content)) return "css";
    if (/^#\s|\*\s|^\s*\d+\.\s/.test(content)) return "markdown";
    return "plaintext";
}


if (typeof module !== "undefined") module.exports = { detectLanguageFromContent };
